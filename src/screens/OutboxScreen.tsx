import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ico, Screen, Serif, T, TAB_INSET, TopBar } from '../components/dark';
import { summarise } from '../lib/outbox';
import { drop, flush, useConnection, useOutbox } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// 10f / 10e of "Barber App.dc.html" — the two screens about standing rather than
// about the day: what hasn't reached us, and what happens when we've had to hide
// the shop. Both exist to end the same worry, and both answer it the same way:
// **say what still works before saying what doesn't.**

const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

// ---------------------------------------------------------------------------
// 10f — Sync failed · nothing lost
// ---------------------------------------------------------------------------
export default function OutboxScreen({ onBack, onOps }: {
  onBack?: () => void; onOps?: () => void;
}) {
  const jobs = useOutbox();
  const { online } = useConnection();
  const [busy, setBusy] = useState(false);
  const sum = summarise(jobs);

  async function retry() {
    setBusy(true);
    await flush();
    setBusy(false);
  }

  if (jobs.length === 0) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title="WAITING TO SEND" onBack={onBack} plain />
        <View style={s.empty}>
          <View style={s.emptyCircle}><Ico name="check" size={28} color={D.green} /></View>
          <Serif size={20} style={s.center}>Everything's sent</Serif>
          <T size={13} c={D.sub} style={s.emptyBody}>
            Nothing is waiting on this phone. Anything you do without a signal shows
            up here until it lands.
          </T>
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="WAITING TO SEND" onBack={onBack} plain />

      <View style={s.head}>
        <View style={s.headIcon}><Ico name="refresh-cw" size={16} color={D.red} /></View>
        <View style={s.grow}>
          <T w="b" size={13} c={D.red}>
            {sum.count} thing{sum.count === 1 ? '' : 's'} won't send
          </T>
          <T size={11} c={D.sub} style={s.mt2}>
            {sum.tries > 0
              ? `Tried ${sum.tries} time${sum.tries === 1 ? '' : 's'}${sum.since ? ` since ${clock(sum.since)}` : ''}`
              : 'Not tried yet'}
            {' · '}they're safe on this phone
          </T>
        </View>
      </View>

      <T w="b" size={11} c={D.sub} ls={1.65} style={s.mt2}>STUCK</T>
      {jobs.map((j) => (
        <View key={j.id} style={[s.row, j.conflict && s.rowClash]}>
          <View style={[s.rowIcon, j.conflict && s.rowIconClash]}>
            <Ico name={j.conflict ? 'alert-triangle' : j.icon} size={15}
              color={j.conflict ? D.amber : D.sub} />
          </View>
          <View style={s.grow}>
            <T w="sb" size={12.5}>{j.label}</T>
            <T size={10.5} c={j.conflict ? D.amber : D.sub} style={s.mt2}>
              {clock(j.at)}
              {j.conflict ? ' · the slot went to someone else' : ''}
            </T>
          </View>
          {/* only a job that can never send gets a way off the list — dropping a
              retryable one is how work disappears silently */}
          {j.conflict && (
            <Pressable hitSlop={8} onPress={() => drop(j.id)}>
              <T w="b" size={11} c={D.accent}>Drop</T>
            </Pressable>
          )}
        </View>
      ))}

      <View style={s.note}>
        <Ico name="info" size={14} color={D.sub} />
        <T size={12} c={D.sub} style={s.noteText}>
          Keep working. Don't reinstall the app or clear it — that's the only way to
          lose these.
        </T>
      </View>

      <Pressable disabled={busy} onPress={retry} style={[s.primary, busy && s.dim55]}>
        <T w="b" size={12.5} c="#fff" ls={0.78}>
          {busy ? 'SENDING…' : online ? 'TRY SENDING NOW' : 'NO SIGNAL YET'}
        </T>
      </Pressable>
      <Pressable onPress={onOps} style={s.centerBtn}>
        <T w="sb" size={12} c={D.sub}>Tell ops about it</T>
      </Pressable>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// 10e — Hidden from search
// ---------------------------------------------------------------------------
// Not a lock screen. The shop is still running: walk-ins, the QR and every
// booking already made keep working, and the screen leads with that. The one
// number that argues for acting today is what search normally brings him.
type Standing = {
  barber: string | null; salon: string | null; salon_status: string | null;
  licence_expires_at: string | null; days_left: number | null;
  hidden: boolean; expired: boolean; bookings_ahead: number;
  search_cuts_per_day: number | null; licence_task: string | null;
};

export function HiddenScreen({ onBack, onOps, onSent }: {
  onBack?: () => void; onOps?: () => void; onSent?: () => void;
}) {
  const [st, setSt] = useState<Standing | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_standing');
    if (error) return Alert.alert('Could not load your standing', error.message);
    setSt(data as Standing);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function sendLicence() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera is off', 'Sterncut needs it to photograph the licence.');
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || !shot.assets[0]) return;

    setBusy(true);
    const me = (await supabase.auth.getUser()).data.user?.id;
    const path = `${me}/licence-${Date.now()}.jpg`;
    const body = await (await fetch(shot.assets[0].uri)).arrayBuffer();
    const up = await supabase.storage.from('id-documents')
      .upload(path, body, { contentType: 'image/jpeg', upsert: true });
    if (up.error) { setBusy(false); return Alert.alert('Could not send it', up.error.message); }

    const { error } = await supabase.rpc('submit_licence', { p_path: path, p_expires: null });
    setBusy(false);
    if (error) return Alert.alert('Could not send it', error.message);
    Alert.alert('Sent', 'Ops looks at it within a day. The shop comes back the moment they accept it.');
    load();
    onSent?.();
  }

  if (!st) return <Screen bottom={TAB_INSET}><TopBar title="Your shop" onBack={onBack} /></Screen>;

  const on = st.licence_expires_at
    ? new Date(`${st.licence_expires_at}T00:00:00`)
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  const cuts = st.search_cuts_per_day;

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="Your shop" onBack={onBack} />

      <View style={s.hero}>
        <View style={s.heroCircle}><Ico name="eye-off" size={27} color={D.red} /></View>
        <Serif size={23} style={s.heroTitle}>Nobody new{'\n'}can find you</Serif>
        <T size={12.5} c={D.sub} style={s.heroBody}>
          {st.expired && on
            ? `Your licence expired on ${on} and we had to hide the shop. Send us the new one and you're back in minutes.`
            : 'Ops has hidden the shop for now. Message them to find out what they need.'}
        </T>
      </View>

      <View style={s.worksCard}>
        <T w="b" size={10} c={D.sub} ls={1.4}>WHAT STILL WORKS</T>
        <Works ok>
          Your {st.bookings_ahead} booking{st.bookings_ahead === 1 ? '' : 's'} ahead stand
        </Works>
        <Works ok>Walk-ins and the QR still work</Works>
        <Works ok>Regulars who follow you can still book</Works>
        <Works>You're out of Explore and the map</Works>
      </View>

      {cuts != null && cuts > 0 && (
        <View style={s.costCard}>
          <View style={s.costIcon}><Ico name="trending-up" size={16} color={D.sub} /></View>
          <View style={s.grow}>
            <T w="b" size={12.5}>Costing you about {cuts} cut{cuts === 1 ? '' : 's'} a day</T>
            <T size={11} c={D.sub} style={s.mt2}>Based on what search normally brings you</T>
          </View>
        </View>
      )}

      {st.expired && (
        <Pressable disabled={busy} onPress={sendLicence} style={[s.bigPrimary, busy && s.dim55]}>
          <Ico name="camera" size={16} color="#fff" />
          <T w="b" size={13} c="#fff" ls={0.65}>
            {busy ? 'SENDING…' : 'SEND THE NEW LICENCE'}
          </T>
        </Pressable>
      )}
      <View style={s.twoBtns}>
        <Pressable onPress={onOps} style={s.solidGhost}>
          <T w="b" size={12} ls={0.4}>MESSAGE OPS</T>
        </Pressable>
        <Pressable onPress={() => Alert.alert(
          st.licence_task ? 'It\'s with ops' : 'Nothing received yet',
          st.licence_task
            ? 'They have it. The shop comes back the moment they accept it.'
            : 'We have no licence photo from you. Send one and it goes straight to ops.',
        )} style={s.outlineGhost}>
          <T w="b" size={12} c={D.sub} ls={0.4}>I ALREADY SENT IT</T>
        </Pressable>
      </View>
      <T size={11} c={D.muted} style={s.footNote}>
        The shop un-hides itself the moment ops accepts it — no waiting on us.
      </T>
    </Screen>
  );
}

function Works({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <View style={s.worksRow}>
      <View style={[s.worksDot, ok && s.worksDotOn]}>
        <Ico name={ok ? 'check' : 'x'} size={10} color={ok ? D.green : D.muted} />
      </View>
      <T size={12.5} c={ok ? D.textDim : D.sub} style={s.grow}>{children}</T>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  center: { textAlign: 'center' },
  dim55: { opacity: 0.55 },

  // 10f
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(248,113,113,0.08)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.28)',
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 15,
  },
  headIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(248,113,113,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13,
    borderWidth: 1, borderColor: 'transparent',
  },
  rowClash: { borderColor: D.amberLine },
  rowIcon: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconClash: { backgroundColor: D.amberSoft },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
  },
  noteText: { flex: 1, lineHeight: 18 },
  primary: {
    height: 52, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  centerBtn: { alignItems: 'center', paddingVertical: 2 },

  // 10e
  hero: { alignItems: 'center', gap: 12, paddingTop: 4 },
  heroCircle: {
    width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(248,113,113,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { textAlign: 'center', lineHeight: 26 },
  heroBody: { textAlign: 'center', lineHeight: 19, maxWidth: 280, marginTop: -4 },
  worksCard: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 12 },
  worksRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  worksDot: {
    width: 19, height: 19, borderRadius: 10, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  worksDotOn: { backgroundColor: D.greenSoft },
  costCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.bg,
    borderWidth: 1, borderColor: '#1E1E22', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 15,
  },
  costIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  bigPrimary: {
    height: 54, borderRadius: 999, backgroundColor: D.accent, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  twoBtns: { flexDirection: 'row', gap: 9 },
  solidGhost: {
    flex: 1, height: 48, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  outlineGhost: {
    flex: 1, height: 48, borderRadius: 999, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },
  footNote: { textAlign: 'center', lineHeight: 17, color: D.muted },

  empty: { alignItems: 'center', gap: 14, paddingTop: 40, paddingHorizontal: 20 },
  emptyCircle: {
    width: 74, height: 74, borderRadius: 37, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyBody: { textAlign: 'center', lineHeight: 20 },
});
