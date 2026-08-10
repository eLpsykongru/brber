import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Ico, Screen, Serif, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// 9a / 9b of "Barber App.dc.html" — the task inbox, and what happens after he
// answers one.
//
// Turn 9's premise: ops was issuing obligations into a void and then counting the
// silence as non-compliance. This is the surface that was missing. Two rules it
// keeps: an open task always says **what happens if he ignores it and when**, and
// nothing here can be closed by the barber — only answered. Ops closes it.

type Task = {
  id: string; ref: string; kind: string; title: string; body: string | null;
  due_at: string | null; action: string | null; status: string;
  proof_at: string | null; proof_path: string | null;
  issued_because: string | null; created_at: string; days_left: number | null;
};
type Done = {
  id: string; ref: string; title: string; resolved_at: string;
  resolution: string | null; on_time: boolean;
};
type Payload = {
  salon: string | null; name?: string; open: Task[]; done: Done[];
  standing: { overdue: number; done_on_time: number };
};

const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

/** 9a's chip. Overdue is its own word — "due in -2 days" is not a sentence. */
function dueLabel(t: Task) {
  if (t.days_left == null) return 'NO DEADLINE';
  if (t.days_left < 0) return `${-t.days_left} DAY${t.days_left === -1 ? '' : 'S'} OVERDUE`;
  if (t.days_left === 0) return 'DUE TODAY';
  return `DUE IN ${t.days_left} DAY${t.days_left === 1 ? '' : 'S'}`;
}

export default function ShopTasksScreen({ onBack, onChat }: {
  onBack?: () => void;
  /** the puck next to SEND A PHOTO — ops is reachable from the task, not from a menu */
  onChat?: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: j, error } = await supabase.rpc('my_shop_tasks');
    if (error) return Alert.alert('Could not load your tasks', error.message);
    const p = j as Payload;
    setData(p);
    // keep the open task in step with the server after a proof lands
    setOpen((cur) => (cur ? p.open.find((t) => t.id === cur.id) ?? null : null));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function sendPhoto(t: Task) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return Alert.alert('Camera is off',
        'Sterncut needs the camera to send ops a photo of the poster.');
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (shot.canceled || !shot.assets[0]) return;

    setBusy(true);
    // the location is the evidence: a poster photo without a place is a photo of
    // a poster. Asking is fine here — he is standing at his own door.
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const loc = await Location.requestForegroundPermissionsAsync();
      if (loc.granted) {
        const at = await Location.getCurrentPositionAsync({});
        lat = at.coords.latitude;
        lng = at.coords.longitude;
      }
    } catch { /* a photo without a pin is still worth sending */ }

    const asset = shot.assets[0];
    const path = `${t.id}/${Date.now()}.jpg`;
    const body = await (await fetch(asset.uri)).arrayBuffer();
    const up = await supabase.storage.from('task-proof')
      .upload(path, body, { contentType: 'image/jpeg', upsert: true });
    if (up.error) { setBusy(false); return Alert.alert('Could not send it', up.error.message); }

    const { error } = await supabase.rpc('submit_task_proof',
      { p_task: t.id, p_path: path, p_lat: lat, p_lng: lng });
    setBusy(false);
    if (error) return Alert.alert('Could not send it', error.message);
    load();
  }

  // ---- 9b · proof sent, waiting on ops ----
  if (open && open.status === 'sent') {
    return <ProofSent task={open} onBack={() => setOpen(null)}
      onReplace={() => sendPhoto(open)} busy={busy} />;
  }

  const good = data && data.standing.overdue === 0;

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="To do" onBack={onBack} />

      {!!data?.salon && (
        <View style={s.standing}>
          <View style={[s.shield, good ? s.shieldGood : s.shieldBad]}>
            <Ico name={good ? 'shield' : 'alert-triangle'} size={16}
              color={good ? D.green : D.amber} />
          </View>
          <View style={s.grow}>
            <T w="b" size={13}>
              {good
                ? `${data.name} is in good standing`
                : `${data.standing.overdue} thing${data.standing.overdue === 1 ? '' : 's'} overdue`}
            </T>
            <T size={11} c={D.sub} style={s.mt2}>
              {good ? 'Nothing overdue' : 'Ops is waiting on you'}
              {' · '}{data.standing.done_on_time} task{data.standing.done_on_time === 1 ? '' : 's'} done on time
            </T>
          </View>
        </View>
      )}

      {(data?.open.length ?? 0) > 0 && (
        <T w="b" size={11} c={D.sub} ls={1.65} style={s.mt2}>OPEN · {data!.open.length}</T>
      )}

      {data?.open.map((t) => {
        const urgent = t.days_left != null && t.days_left <= 7;
        const sent = t.status === 'sent';
        return (
          <View key={t.id} style={[s.card, urgent && !sent && s.cardUrgent]}>
            <View style={s.row10}>
              <View style={[s.dueChip, urgent && !sent && s.dueChipHot]}>
                <T w="b" size={10} ls={0.8} c={urgent && !sent ? '#0D0D0F' : D.sub}>
                  {sent ? 'WITH OPS' : dueLabel(t)}
                </T>
              </View>
              <View style={s.grow} />
              <T size={10} c={D.muted} style={s.mono}>{t.ref}</T>
            </View>

            <View>
              <T w="b" size={15}>{t.title}</T>
              {!!t.body && <T size={12} c={D.sub} style={s.body}>{t.body}</T>}
            </View>

            {!!t.due_at && (
              <View style={s.dueRow}>
                <Ico name="clock" size={14} color={D.sub} />
                <T size={11.5} c={D.sub} style={s.grow}>
                  {dayMonth(t.due_at)} · nothing happens to your page before then
                </T>
              </View>
            )}

            {t.action === 'photo' && (
              <View style={s.actionRow}>
                <Pressable disabled={busy} onPress={() => (sent ? setOpen(t) : sendPhoto(t))}
                  style={[s.primary, busy && s.dim55]}>
                  <Ico name={sent ? 'clock' : 'camera'} size={15} color="#fff" />
                  <T w="b" size={12} c="#fff" ls={0.6}>
                    {busy ? 'SENDING…' : sent ? 'SEE WHAT YOU SENT' : 'SEND A PHOTO'}
                  </T>
                </Pressable>
                <Pressable onPress={onChat} style={s.puck46}>
                  <Ico name="message-square" size={17} />
                </Pressable>
              </View>
            )}
            {t.action === 'invite' && (
              <Pressable style={s.secondary} onPress={onChat}>
                <T w="b" size={12} ls={0.6}>INVITE HIM</T>
              </Pressable>
            )}
            {t.action === 'settle' && (
              <Pressable style={s.secondary} onPress={onChat}>
                <T w="b" size={12} ls={0.6}>SETTLE UP</T>
              </Pressable>
            )}
          </View>
        );
      })}

      {(data?.done.length ?? 0) > 0 && (
        <T w="b" size={11} c={D.sub} ls={1.65} style={s.mt2}>DONE</T>
      )}
      {data?.done.map((t) => (
        <View key={t.id} style={s.doneRow}>
          <View style={s.doneIcon}><Ico name="check" size={14} color={D.green} /></View>
          <View style={s.grow}>
            <T w="sb" size={12.5}>{t.title}</T>
            <T size={10.5} c={D.muted} style={s.mt2}>
              {new Date(t.resolved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {t.resolution ? ` · ${t.resolution}` : ''} · {t.on_time ? 'on time' : 'late'}
            </T>
          </View>
        </View>
      ))}

      {data && data.open.length === 0 && data.done.length === 0 && (
        <View style={s.empty}>
          <View style={s.emptyCircle}><Ico name="check" size={28} color={D.muted} /></View>
          <Serif size={20} style={s.center}>Nothing to do</Serif>
          <T size={13} c={D.sub} style={s.emptyBody}>
            When Sterncut needs something from the shop it lands here, with a date and
            what happens if it passes.
          </T>
        </View>
      )}

      {data && !data.salon && (
        <View style={s.empty}>
          <T size={13} c={D.sub} style={s.center}>Only a shop owner has tasks.</T>
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// 9b — Proof sent · waiting on ops
// ---------------------------------------------------------------------------
// The timeline exists to answer the only question he has after sending: is this
// on me now, or on them? Three nodes, and the live one is unmistakable.
function ProofSent({ task, onBack, onReplace, busy }: {
  task: Task; onBack: () => void; onReplace: () => void; busy: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!task.proof_path) return;
    supabase.storage.from('task-proof').createSignedUrl(task.proof_path, 600)
      .then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [task.proof_path]);

  const by = task.proof_at ? new Date(task.proof_at) : new Date();
  by.setDate(by.getDate() + 2);
  const early = task.due_at && task.proof_at
    ? Math.floor((new Date(task.due_at).getTime() - new Date(task.proof_at).getTime()) / 86_400_000)
    : null;

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={`TASK · ${task.ref}`} onBack={onBack} plain />

      <View style={s.hero}>
        <View style={s.heroCircle}><Ico name="clock" size={26} color={D.amber} /></View>
        <Serif size={22} style={s.center}>Sent for checking</Serif>
        <T size={12.5} c={D.sub} style={s.heroBody}>
          Ops looks at it within a day. You don't need to do anything else.
        </T>
      </View>

      <View style={s.proofCard}>
        {url
          ? <Image source={{ uri: url }} style={s.proofImg} resizeMode="cover" />
          : <View style={[s.proofImg, s.proofBlank]} />}
        <View style={s.row9}>
          <T size={11.5} c={D.sub} style={s.grow}>
            {task.proof_at
              ? `Sent ${dayMonth(task.proof_at)}, ${clock(task.proof_at)}`
              : 'Sent'}
            {" · with your shop's location"}
          </T>
          <Pressable disabled={busy} onPress={onReplace} hitSlop={8}>
            <T w="b" size={11.5} c={D.accent}>{busy ? 'Sending…' : 'Replace'}</T>
          </Pressable>
        </View>
      </View>

      <View style={s.timeline}>
        <Node done label="Task issued"
          sub={`${dayMonth(task.created_at)}${task.issued_because ? ` · ${task.issued_because}` : ''}`} />
        <Node now label="You sent a photo"
          sub={`${task.proof_at ? `${dayMonth(task.proof_at)} ${clock(task.proof_at)}` : 'Just now'}`
            + (early != null && early > 0 ? ` · ${early} days before it was due` : '')} />
        <Node last label="Ops confirms it" sub={`By ${dayMonth(by.toISOString())}`} />
      </View>

      <View style={s.shieldNote}>
        <Ico name="shield" size={14} color={D.green} />
        <T size={12} c={D.sub} style={s.shieldNoteText}>
          Once it's outside, scan times count as arrival times again — so a late client
          can't blame the shop.
        </T>
      </View>
    </Screen>
  );
}

function Node({ label, sub, done, now, last }: {
  label: string; sub: string; done?: boolean; now?: boolean; last?: boolean;
}) {
  return (
    <View style={s.nodeRow}>
      <View style={s.nodeRail}>
        <View style={[s.nodeDot, done && s.nodeDotDone, now && s.nodeDotNow,
          last && s.nodeDotNext]}>
          {done && <Ico name="check" size={11} color={D.sub} />}
          {now && <View style={s.nodePip} />}
        </View>
        {!last && <View style={s.nodeLine} />}
      </View>
      <View style={[s.grow, !last && s.nodePad]}>
        <View style={s.row6}>
          <T w={now ? 'b' : 'sb'} size={12.5} c={now ? D.text : last ? D.muted : D.sub}>{label}</T>
          {now && <View style={s.nowChip}><T w="b" size={9.5} c={D.amber} ls={0.8}>NOW</T></View>}
        </View>
        <T size={10.5} c={D.muted} style={s.mt2}>{sub}</T>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  center: { textAlign: 'center' },
  dim55: { opacity: 0.55 },
  mono: { fontVariant: ['tabular-nums'] },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row9: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  row10: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  // 9a
  standing: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
  },
  shield: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  shieldGood: { backgroundColor: 'rgba(74,222,128,0.16)' },
  shieldBad: { backgroundColor: 'rgba(232,161,0,0.16)' },
  card: {
    backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 13,
    borderWidth: 2, borderColor: 'transparent',
  },
  cardUrgent: { borderColor: D.amber },
  dueChip: { backgroundColor: D.card2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  dueChipHot: { backgroundColor: D.amber },
  body: { marginTop: 6, lineHeight: 18 },
  dueRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: D.bg, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11,
  },
  actionRow: { flexDirection: 'row', gap: 9 },
  primary: {
    flex: 1, height: 46, borderRadius: 999, backgroundColor: D.accent, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  secondary: {
    height: 44, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  puck46: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  doneRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13, opacity: 0.6,
  },
  doneIcon: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(74,222,128,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },

  // 9b
  hero: { alignItems: 'center', gap: 12, paddingTop: 2 },
  heroCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  heroBody: { textAlign: 'center', lineHeight: 19, maxWidth: 270, marginTop: -4 },
  proofCard: { backgroundColor: D.card, borderRadius: 20, padding: 14, gap: 12 },
  proofImg: { height: 158, borderRadius: 14, backgroundColor: D.card2 },
  proofBlank: { opacity: 0.5 },
  timeline: {
    backgroundColor: D.bg, borderWidth: 1, borderColor: D.border, borderRadius: 20, padding: 16,
  },
  nodeRow: { flexDirection: 'row', gap: 12 },
  nodeRail: { width: 20, alignItems: 'center' },
  nodeDot: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  nodeDotDone: { backgroundColor: D.card2 },
  nodeDotNow: { backgroundColor: D.amber },
  nodeDotNext: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: D.muted, borderStyle: 'dashed' },
  nodePip: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#0D0D0F' },
  nodeLine: { flex: 1, width: 2, backgroundColor: D.border },
  nodePad: { paddingBottom: 15 },
  nowChip: {
    backgroundColor: 'rgba(232,161,0,0.14)', borderRadius: 5,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  shieldNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
  },
  shieldNoteText: { flex: 1, lineHeight: 18 },

  empty: { alignItems: 'center', gap: 14, paddingTop: 40, paddingHorizontal: 20 },
  emptyCircle: {
    width: 74, height: 74, borderRadius: 37, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyBody: { textAlign: 'center', lineHeight: 20 },
});
