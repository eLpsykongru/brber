import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Ico, Screen, Serif, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { colors, dark as D } from '../theme';
import { loc, tr, trn } from '../lib/i18n';

// 9c / 9d of "Barber App.dc.html" — the applying shop's own status screen, the
// other side of admin 1f.
//
// The checklist here is deliberately the **same five derived items** that
// `admin_approvals` (0043) approves against, not the four the canvas draws.
// Showing an applicant a list that isn't the one gating him is the single thing
// this screen must not do — he'd tick four boxes and still be told no.
//
// Only one row has a control, and that is honest: the pin is the only item he can
// satisfy from here. The rest live on screens he already has.

type Item = { key: string; label: string; ok: boolean };
type App = {
  salon: string | null; name: string; address: string | null; status: string;
  submitted_at: string | null; reviewed_at: string | null; review_note: string | null;
  lat: number | null; lng: number | null; reviewer: string | null;
  checklist: Item[];
  preview: {
    services: number; from_cents: number | null; reviews: number;
    hours: { days: number; from: number | null; to: number | null };
  };
};

// Tangier, so an unpinned shop opens somewhere its owner recognises
const CITY = { latitude: 35.7595, longitude: -5.834, latitudeDelta: 0.06, longitudeDelta: 0.06 };

const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const dayMonth = (iso: string) =>
  new Date(iso).toLocaleDateString(loc('en-US'), { month: 'short', day: 'numeric' });
const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function ApplicationScreen({ onBack, onGo }: {
  onBack?: () => void;
  /** 9d's FIRST THINGS — each is a screen he already has */
  onGo?: (where: 'qr' | 'hours' | 'wallet') => void;
}) {
  const [app, setApp] = useState<App | null>(null);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_salon_application');
    if (error) return Alert.alert(tr('Could not load your application'), error.message);
    const a = data as App;
    setApp(a);
    if (a.lat != null && a.lng != null) setPin({ latitude: a.lat, longitude: a.lng });
  }, []);
  useEffect(() => { load(); }, [load]);

  async function useMyLocation() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      return Alert.alert(tr('Location is off'),
        tr('Turn it on, or drag the pin to your door by hand.'));
    }
    const at = await Location.getCurrentPositionAsync({});
    setPin({ latitude: at.coords.latitude, longitude: at.coords.longitude });
  }

  async function savePin() {
    if (!pin) return;
    setBusy(true);
    const { error } = await supabase.rpc('set_salon_pin',
      { p_lat: pin.latitude, p_lng: pin.longitude });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not save the pin'), error.message);
    load();
  }

  if (!app) return <Screen bottom={TAB_INSET}><TopBar title={tr('Your shop')} onBack={onBack} /></Screen>;
  if (!app.salon) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title={tr('Your shop')} onBack={onBack} />
        <T size={13} c={D.sub}>{tr('You don\'t own a shop yet.')}</T>
      </Screen>
    );
  }

  // ---- 9d · you're live ----
  if (app.status === 'live') return <LiveScreen app={app} onBack={onBack} onGo={onGo} />;

  const done = app.checklist.filter((c) => c.ok).length;
  const left = app.checklist.length - done;
  const rejected = app.status === 'rejected';

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={tr('Your shop')} onBack={onBack} />

      <View style={s.shopHead}>
        <View style={s.shopAvatar}><T w="b" size={11} c={D.sub}>{initials(app.name)}</T></View>
        <View style={s.grow}>
          <T w="b" size={14}>{app.name}</T>
          <T size={11} c={D.sub} style={s.mt2}>
            {app.submitted_at ? tr('Applied {submitted_at}', { submitted_at: dayMonth(app.submitted_at) }) : tr('Not submitted')}
            {rejected ? tr(' · not accepted') : tr(' · not live yet')}
          </T>
        </View>
        {left > 0 && !rejected && (
          <View style={s.todoChip}>
            <T w="b" size={10} c="#0D0D0F" ls={0.8}>{tr('{left} TO DO', { left })}</T>
          </View>
        )}
      </View>

      <View style={s.progress}>
        <T w="b" size={10} c={D.sub} ls={1.4}>{tr('{done} OF {count} DONE', { done, count: app.checklist.length })}</T>
        <Serif size={22} style={s.progressTitle}>
          {rejected ? tr('Not accepted')
            : left === 0 ? tr('With ops now')
              : left === 1 ? tr('One thing left') : tr('{left} things left', { left })}
        </Serif>
        <View style={s.bars}>
          {app.checklist.map((c) => (
            <View key={c.key} style={[s.bar, c.ok && s.barOn]} />
          ))}
        </View>
      </View>

      {/* ops said why, so say it — a rejection with no reason is a dead end */}
      {rejected && !!app.review_note && (
        <View style={s.rejectCard}>
          <Ico name="alert-circle" size={15} color={D.red} />
          <T size={12.5} c={D.textDim} style={s.rejectText}>{app.review_note}</T>
        </View>
      )}

      {app.checklist.filter((c) => c.key !== 'pin').map((c) => (
        <View key={c.key} style={s.checkRow}>
          <View style={[s.checkDot, c.ok && s.checkDotOn]}>
            {c.ok
              ? <Ico name="check" size={13} color={D.green} />
              : <View style={s.checkPip} />}
          </View>
          <T w="sb" size={12.5} c={c.ok ? D.sub : D.text} style={s.grow}>{c.label}</T>
          {!c.ok && <T size={10.5} c={D.muted}>{tr('still needed')}</T>}
        </View>
      ))}

      {/* the pin: the one row he can finish from here, so it gets the map */}
      <View style={[s.pinCard, !app.lat && s.pinCardOpen]}>
        <View style={s.row12}>
          <View style={[s.checkDot, app.lat != null && s.checkDotOn, !app.lat && s.checkDotOpen]}>
            {app.lat != null
              ? <Ico name="check" size={13} color={D.green} />
              : <View style={s.checkPipHot} />}
          </View>
          <View style={s.grow}>
            <T w="b" size={13}>{tr('Drop a pin on your door')}</T>
            <T size={11} c={D.sub} style={s.mt3}>
              {tr('We can\'t list a shop we can\'t put on the map')}
            </T>
          </View>
        </View>

        <View style={s.mapWrap}>
          <MapView style={s.map}
            initialRegion={pin ? { ...pin, latitudeDelta: 0.004, longitudeDelta: 0.004 } : CITY}
            onPress={(e) => setPin(e.nativeEvent.coordinate)}>
            {!!pin && (
              <Marker coordinate={pin} draggable pinColor={D.accent}
                onDragEnd={(e) => setPin(e.nativeEvent.coordinate)} />
            )}
          </MapView>
          {!pin && (
            <View pointerEvents="none" style={s.mapHint}>
              <T w="b" size={10} c={D.sub} ls={0.8}>{tr('TAP YOUR DOOR')}</T>
            </View>
          )}
        </View>

        <View style={s.pinBtns}>
          <Pressable onPress={useMyLocation} style={s.ghostBtn}>
            <Ico name="crosshair" size={14} color={D.text} />
            <T w="b" size={11.5}>{tr('I\'M AT THE SHOP')}</T>
          </Pressable>
          <Pressable disabled={!pin || busy} onPress={savePin}
            style={[s.saveBtn, (!pin || busy) && s.dim55]}>
            <T w="b" size={11.5} c="#fff" ls={0.5}>{busy ? tr('SAVING…') : tr('SAVE THE PIN')}</T>
          </Pressable>
        </View>
      </View>

      <View style={s.note}>
        <Ico name="info" size={15} color={D.sub} />
        <T size={12} c={D.sub} style={s.noteText}>
          {left === 0
            ? tr('Everything is in. Ops looks at new shops within two working days.')
            : tr('Ops can only look at your shop once all of these are in.')}
        </T>
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// 9d — You're live
// ---------------------------------------------------------------------------
// The Explore preview is drawn in the *customer's* palette on purpose: it is a
// picture of somewhere else, and the one question he has is "what do they see".
function LiveScreen({ app, onBack, onGo }: {
  app: App; onBack?: () => void; onGo?: (w: 'qr' | 'hours' | 'wallet') => void;
}) {
  const at = app.reviewed_at ? new Date(app.reviewed_at).toTimeString().slice(0, 5) : null;
  const h = app.preview.hours;
  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={tr('Your shop')} onBack={onBack} />

      <View style={s.hero}>
        <View style={s.heroCircle}><Ico name="check" size={29} color={D.green} /></View>
        <Serif size={25} style={s.heroTitle}>{tr('{name}\nis live', { name: app.name })}</Serif>
        <T size={12.5} c={D.sub} style={s.heroBody}>
          {tr('{x}{x2}. People searching can find you from now.', { x: app.reviewer ? tr('Approved by {reviewer}', { reviewer: app.reviewer }) : tr('Approved'), x2: at ? tr(' at {at}', { at }) : '' })}
        </T>
      </View>

      <View style={s.exploreCard}>
        <T w="b" size={10} c={D.sub} ls={1.4}>{tr('HOW YOU LOOK IN EXPLORE')}</T>
        <View style={s.preview}>
          <View style={s.previewImg} />
          <View style={s.grow}>
            <View style={s.row6}>
              <T w="b" size={13.5} c="#111" style={s.grow}>{app.name}</T>
              <T w="b" size={11} c="#8A8A85">{app.preview.reviews >= 3 ? tr('Rated') : tr('New')}</T>
            </View>
            {!!app.address && <T size={11} c="#8A8A85" style={s.mt5}>{app.address}</T>}
            <T size={11} c="#8A8A85" style={s.mt3}>
              {trn(app.preview.services, '{x}{n} service', '{x}{n} services', { x: app.preview.from_cents != null
                ? tr('From {round} DH · ', { round: Math.round(app.preview.from_cents / 100) })
                : '' })}
            </T>
          </View>
        </View>
        <T size={11} c={D.muted} style={s.previewNote}>
          {tr('New shops show a "New" badge instead of a rating until the first 3 reviews land.')}
        </T>
      </View>

      <T w="b" size={11} c={D.sub} ls={1.65} style={s.mt2}>{tr('FIRST THINGS')}</T>
      <FirstThing icon="grid" ring title={tr('Print your walk-in QR')}
        sub={tr('Stick it outside the door')} onPress={() => onGo?.('qr')} />
      <FirstThing icon="calendar" title={tr('Check your opening hours')}
        sub={h.from != null
          ? trn(h.days, '{from} – {hhmm}, {n} day a week', '{from} – {hhmm}, {n} days a week', { from: hhmm(h.from), hhmm: hhmm(h.to!) })
          : tr('Not set yet')}
        onPress={() => onGo?.('hours')} />
      <FirstThing icon="credit-card" title={tr('Take cash top-ups')}
        sub={tr('Your float starts at 0 DH')} onPress={() => onGo?.('wallet')} />
    </Screen>
  );
}

function FirstThing({ icon, title, sub, ring, onPress }: {
  icon: 'grid' | 'calendar' | 'credit-card'; title: string; sub: string;
  ring?: boolean; onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[s.firstRow, ring && s.firstRowRing]}>
      <View style={[s.firstIcon, ring && s.firstIconOn]}>
        <Ico name={icon} size={16} color={ring ? D.accent : D.sub} />
      </View>
      <View style={s.grow}>
        <T w={ring ? 'b' : 'sb'} size={12.5}>{title}</T>
        <T size={10.5} c={D.sub} style={s.mt2}>{sub}</T>
      </View>
      <Ico name="chevron-right" size={15} color={D.muted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  mt3: { marginTop: 3 },
  mt5: { marginTop: 5 },
  dim55: { opacity: 0.55 },
  row6: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row12: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  // 9c
  shopHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  shopAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  todoChip: { backgroundColor: D.amber, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 },
  progress: { backgroundColor: D.card, borderRadius: 22, padding: 18, gap: 14 },
  progressTitle: { marginTop: -8 },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#2F2F35' },
  barOn: { backgroundColor: D.green },
  rejectCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: D.card,
    borderWidth: 1, borderColor: D.redLine, borderRadius: 16,
    paddingHorizontal: 15, paddingVertical: 13,
  },
  rejectText: { flex: 1, lineHeight: 19 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13,
  },
  checkDot: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkDotOn: { backgroundColor: D.greenSoft },
  checkDotOpen: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: D.accent },
  checkPip: { width: 7, height: 7, borderRadius: 4, backgroundColor: D.muted },
  checkPipHot: { width: 7, height: 7, borderRadius: 4, backgroundColor: D.accent },
  pinCard: {
    backgroundColor: D.card, borderRadius: 18, padding: 15, gap: 13,
    borderWidth: 2, borderColor: 'transparent',
  },
  pinCardOpen: { borderColor: D.accent },
  mapWrap: { height: 150, borderRadius: 12, overflow: 'hidden', backgroundColor: D.card2 },
  map: { flex: 1 },
  mapHint: {
    position: 'absolute', left: 12, bottom: 10, backgroundColor: 'rgba(13,13,15,0.75)',
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
  },
  pinBtns: { flexDirection: 'row', gap: 9 },
  ghostBtn: {
    flex: 1, height: 42, borderRadius: 999, backgroundColor: D.card2, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  saveBtn: {
    flex: 1, height: 42, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
  },
  noteText: { flex: 1, lineHeight: 18 },

  // 9d
  hero: { alignItems: 'center', gap: 13, paddingTop: 4 },
  heroCircle: {
    width: 66, height: 66, borderRadius: 33, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { textAlign: 'center', lineHeight: 28 },
  heroBody: { textAlign: 'center', lineHeight: 19, maxWidth: 280, marginTop: -5 },
  exploreCard: { backgroundColor: D.card, borderRadius: 22, padding: 16, gap: 13 },
  preview: {
    flexDirection: 'row', gap: 12, backgroundColor: colors.bg, borderRadius: 16, padding: 11,
  },
  previewImg: { width: 66, height: 66, borderRadius: 12, backgroundColor: '#E9E6DE' },
  previewNote: { lineHeight: 17 },
  firstRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13,
    borderWidth: 2, borderColor: 'transparent',
  },
  firstRowRing: { borderColor: D.accent },
  firstIcon: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  firstIconOn: { backgroundColor: D.accentSoft },
});
