import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Eyebrow, Ico, IconName, Screen, T, Toggle, TopBar } from '../components/dark';
import { pushPermission } from '../lib/push';
import { Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// Turn 4 — 4b the inbox, 4c the settings behind its gear. What buzzes is decided
// server-side by notif_should_push() (0032); this screen owns the toggles it reads.

type Kind = 'booking_request' | 'reschedule' | 'cancellation' | 'checked_in' | 'wallet' | 'message' | 'review' | 'digest';

type Notif = {
  id: string; kind: Kind; title: string; body: string | null;
  booking_id: string | null; amount_cents: number | null;
  read_at: string | null; created_at: string;
};

type Prefs = {
  push_booking_request: boolean; push_cancellation: boolean; push_checked_in: boolean;
  push_wallet: boolean; push_message: boolean; push_review: boolean;
  silent_while_cutting: boolean; quiet_outside_hours: boolean; urgent_always: boolean;
};

const DEFAULTS: Prefs = {
  push_booking_request: true, push_cancellation: true, push_checked_in: true,
  push_wallet: true, push_message: true, push_review: false,
  silent_while_cutting: true, quiet_outside_hours: true, urgent_always: true,
};

const LOOK: Record<Kind, { icon: IconName; tint: string; bg: string }> = {
  booking_request: { icon: 'calendar', tint: D.accent, bg: D.accentSoft },
  reschedule: { icon: 'repeat', tint: D.accent, bg: D.accentSoft },
  cancellation: { icon: 'x', tint: D.red, bg: 'rgba(248,113,113,0.14)' },
  checked_in: { icon: 'check', tint: D.green, bg: 'rgba(74,222,128,0.14)' },
  wallet: { icon: 'credit-card', tint: D.accent, bg: D.accentSoft },
  message: { icon: 'message-circle', tint: D.sub, bg: D.card2 },
  review: { icon: 'star', tint: D.amber, bg: D.amberSoft },
  digest: { icon: 'trending-up', tint: D.sub, bg: D.card2 },
};

const GROUPS: Record<string, Kind[]> = {
  bookings: ['booking_request', 'reschedule', 'cancellation', 'checked_in'],
  money: ['wallet', 'digest'],
  reviews: ['review'],
};

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? `${Math.round(min / 60)}h`
    : d.toTimeString().slice(0, 5);
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export default function NotificationsScreen({ barberId, onBack, onOpenBooking }: {
  barberId: string; onBack: () => void; onOpenBooking?: (bookingId: string) => void;
}) {
  const [settings, setSettings] = useState(false);
  const [rows, setRows] = useState<Notif[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'bookings' | 'money' | 'reviews'>('all');

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('notifications')
      .select('id, kind, title, body, booking_id, amount_cents, read_at, created_at')
      .eq('user_id', barberId).order('created_at', { ascending: false }).limit(80);
    if (error) return Alert.alert('Could not load notifications', error.message);
    setRows((data ?? []) as Notif[]);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  async function markAllRead() {
    setRows((cur) => cur?.map((n) => n.read_at ? n : { ...n, read_at: new Date().toISOString() }) ?? null);
    const { error } = await supabase.rpc('notif_mark_all_read');
    if (error) { load(); Alert.alert('Could not update', error.message); }
  }

  async function markRead(n: Notif) {
    if (n.read_at) return;
    setRows((cur) => cur?.map((x) => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x) ?? null);
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id);
  }

  async function act(n: Notif, accept: boolean) {
    if (!n.booking_id) return;
    // a reschedule answers its open request; everything else answers the booking
    let error;
    if (n.kind === 'reschedule') {
      const { data: req } = await supabase.from('reschedule_requests')
        .select('id').eq('booking_id', n.booking_id).eq('status', 'pending').maybeSingle();
      if (!req) { markRead(n); return Alert.alert('Already answered', 'That request is no longer open.'); }
      ({ error } = await supabase.rpc('respond_reschedule', { p_request: req.id, p_accept: accept }));
    } else {
      ({ error } = accept
        ? await supabase.rpc('accept_booking', { p_booking: n.booking_id })
        : await supabase.rpc('cancel_booking', { p_booking: n.booking_id, p_reason: 'Declined' }));
    }
    if (error) return Alert.alert(accept ? 'Could not accept' : 'Could not decline', error.message);
    markRead(n);
    load();
  }

  if (settings) {
    return <NotificationSettings barberId={barberId} onBack={() => setSettings(false)} />;
  }

  const all = rows ?? [];
  const unread = all.filter((n) => !n.read_at).length;
  const shown = filter === 'all' ? all : all.filter((n) => GROUPS[filter].includes(n.kind));
  const today = shown.filter((n) => isToday(n.created_at));
  const older = shown.filter((n) => !isToday(n.created_at));

  const row = (n: Notif, dim: boolean) => {
    const look = LOOK[n.kind];
    const actionable = (n.kind === 'booking_request' || n.kind === 'reschedule')
      && !n.read_at && !!n.booking_id;
    return (
      <Pressable key={n.id}
        onPress={() => { markRead(n); if (n.booking_id) onOpenBooking?.(n.booking_id); }}
        accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body ?? ''}`}
        style={({ pressed }) => [
          dim ? s.rowDim : s.row, actionable && s.rowHot, pressed && s.pressed,
        ]}>
        <View style={s.rowTop}>
          <View style={[s.icon, { backgroundColor: look.bg }]}>
            <Ico name={look.icon} size={17} color={look.tint} />
          </View>
          <View style={s.grow}>
            <View style={s.titleRow}>
              <T w="b" size={14} style={s.grow}>{n.title}</T>
              <T size={11} c={D.sub}>{ago(n.created_at)}</T>
            </View>
            {!!n.body && <T size={12} c={D.sub} style={s.body}>{n.body}</T>}
          </View>
          {!n.read_at && <View style={s.unread} />}
        </View>
        {actionable && (
          <View style={s.actions}>
            <Pressable onPress={() => act(n, false)} accessibilityRole="button" accessibilityLabel="Decline"
              style={({ pressed }) => [s.decline, pressed && s.pressed]}>
              <T w="b" size={12} c={D.sub}>Decline</T>
            </Pressable>
            <Pressable onPress={() => act(n, true)} accessibilityRole="button" accessibilityLabel="Accept"
              style={({ pressed }) => [s.accept, pressed && s.pressed]}>
              <T w="eb" size={12} c={D.bg}>Accept</T>
            </Pressable>
          </View>
        )}
      </Pressable>
    );
  };

  return (
    <Screen gap={13}>
      <TopBar title="Notifications" onBack={onBack} plain
        right="settings" onRight={() => setSettings(true)} />

      <View style={s.chipRow}>
        {([['all', 'All'], ['bookings', 'Bookings'], ['money', 'Money'], ['reviews', 'Reviews']] as const)
          .map(([k, label]) => (
            <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="button"
              accessibilityState={{ selected: filter === k }}
              style={({ pressed }) => [s.chip, filter === k && s.chipOn, pressed && s.pressed]}>
              <T w={filter === k ? 'b' : 'sb'} size={12} c={filter === k ? '#fff' : D.sub}>
                {label}{k === 'all' && unread ? <T w="b" size={12} c="rgba(255,255,255,0.7)">{` ${unread}`}</T> : null}
              </T>
            </Pressable>
          ))}
      </View>

      {rows === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading notifications" />}
      {rows !== null && shown.length === 0 && (
        <T size={13} c={D.sub} style={s.empty}>Nothing here yet — this is where the shop talks to you.</T>
      )}

      {today.length > 0 && (
        <>
          <View style={s.sectionRow}>
            <Eyebrow ls={1.65}>TODAY</Eyebrow>
            {unread > 0 && (
              <Pressable onPress={markAllRead} hitSlop={6} accessibilityRole="button"
                accessibilityLabel="Mark all read" style={({ pressed }) => pressed && s.pressed}>
                <T w="sb" size={12} c={D.accent}>Mark all read</T>
              </Pressable>
            )}
          </View>
          <View style={{ gap: 9 }}>{today.map((n) => row(n, false))}</View>
        </>
      )}

      {older.length > 0 && (
        <>
          <Eyebrow ls={1.65} style={{ marginTop: 2 }}>EARLIER</Eyebrow>
          <View style={{ gap: 9 }}>{older.map((n) => row(n, true))}</View>
        </>
      )}
    </Screen>
  );
}

// ---- 4c · notification settings -------------------------------------------
const PUSH_ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'push_booking_request', label: 'New booking requests', hint: 'Accept or decline from the banner' },
  { key: 'push_cancellation', label: 'Cancellations', hint: 'A slot just opened up' },
  { key: 'push_checked_in', label: 'Client checked in', hint: "He's in the shop waiting" },
  { key: 'push_wallet', label: 'Wallet & top-ups', hint: 'Cash credited to a customer' },
  { key: 'push_message', label: 'Messages', hint: 'From clients and the team' },
  { key: 'push_review', label: 'New reviews', hint: 'Waits for the inbox' },
];

function NotificationSettings({ barberId, onBack }: { barberId: string; onBack: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [perm, setPerm] = useState<'granted' | 'denied' | 'undetermined'>('undetermined');
  const [hours, setHours] = useState<Window | null>(null);

  useEffect(() => {
    supabase.from('notification_prefs').select('*').eq('user_id', barberId).maybeSingle()
      .then(({ data }) => { if (data) setPrefs(data as Prefs); });
    supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId)
      .then(({ data }) => {
        const w = (data ?? []) as Window[];
        if (!w.length) return;
        setHours({
          weekday: -1,
          start_min: Math.min(...w.map((x) => x.start_min)),
          end_min: Math.max(...w.map((x) => x.end_min)),
        });
      });
    pushPermission().then(setPerm);
  }, [barberId]);

  async function set(key: keyof Prefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const { error } = await supabase.from('notification_prefs')
      .upsert({ user_id: barberId, ...next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' });
    if (error) { setPrefs(prefs); Alert.alert('Could not save', error.message); }
  }

  const openPct = hours ? (hours.start_min / 1440) * 100 : 40;
  const closePct = hours ? (hours.end_min / 1440) * 100 : 79;
  const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  return (
    <Screen gap={13}>
      <TopBar title="Notifications" onBack={onBack} plain />

      <Pressable onPress={perm === 'granted' ? undefined : () => Linking.openSettings()}
        accessibilityRole={perm === 'granted' ? undefined : 'button'}
        accessibilityLabel={perm === 'granted' ? 'Push is on' : 'Turn push on in system settings'}
        style={({ pressed }) => [s.permCard, perm !== 'granted' && s.permCardOff, pressed && s.pressed]}>
        <View style={[s.permIcon, perm !== 'granted' && { backgroundColor: D.amberSoft16 }]}>
          <Ico name={perm === 'granted' ? 'bell' : 'bell-off'} size={17}
            color={perm === 'granted' ? D.green : D.amber} />
        </View>
        <View style={s.grow}>
          <T w="b" size={14} c={perm === 'granted' ? D.text : D.amber}>
            {perm === 'granted' ? 'Push is on' : 'Push is off'}
          </T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>
            {perm === 'granted' ? 'Allowed in your phone settings' : 'Tap to allow it in your phone settings'}
          </T>
        </View>
      </Pressable>

      <View style={s.cuttingCard}>
        <View style={s.cuttingIcon}><Ico name="scissors" size={17} color={D.amber} /></View>
        <View style={s.grow}>
          <T w="b" size={14} c={D.amber}>Silent while cutting</T>
          <T size={11} c={D.sub} style={s.hint}>Nothing buzzes from check-in to mark-done</T>
        </View>
        <Toggle on={prefs.silent_while_cutting} color={D.amber}
          onPress={() => set('silent_while_cutting', !prefs.silent_while_cutting)} />
      </View>

      <Eyebrow ls={1.65} style={{ marginTop: 2 }}>PUSH ME FOR</Eyebrow>
      <View style={s.listCard}>
        {PUSH_ROWS.map((r, i) => (
          <View key={r.key} style={[s.listRow, i < PUSH_ROWS.length - 1 && s.listLine]}>
            <View style={s.grow}>
              <T w="sb" size={14}>{r.label}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>{r.hint}</T>
            </View>
            <Toggle small on={prefs[r.key]} color={D.accent}
              onPress={() => set(r.key, !prefs[r.key])} />
          </View>
        ))}
      </View>

      <Eyebrow ls={1.65} style={{ marginTop: 2 }}>QUIET HOURS</Eyebrow>
      <View style={s.quietCard}>
        <View style={s.quietTop}>
          <View style={s.grow}>
            <T w="b" size={14}>Outside working hours</T>
            <T size={11} c={D.sub} style={{ marginTop: 2 }}>
              {hours ? `${hh(hours.end_min)} – ${hh(hours.start_min)} and days off` : 'Set your hours first'}
            </T>
          </View>
          <Toggle on={prefs.quiet_outside_hours}
            onPress={() => set('quiet_outside_hours', !prefs.quiet_outside_hours)} color={D.accent} />
        </View>
        <View style={s.dayBar}>
          <View style={[s.barSeg, { left: '0%', width: `${openPct}%`, backgroundColor: 'rgba(255,255,255,0.06)' }]} />
          <View style={[s.barSeg, {
            left: `${openPct}%`, width: `${Math.max(0, closePct - openPct)}%`,
            backgroundColor: prefs.quiet_outside_hours ? 'rgba(232,68,46,0.35)' : 'rgba(232,68,46,0.2)',
          }]} />
          <View style={[s.barSeg, { left: `${closePct}%`, right: 0, backgroundColor: 'rgba(255,255,255,0.06)' }]} />
        </View>
        <View style={s.axis}>
          <T size={10} c={D.sub}>00:00</T>
          <T size={10} c={D.sub}>{hours ? hh(hours.start_min) : '09:30'}</T>
          <T size={10} c={D.sub}>{hours ? hh(hours.end_min) : '19:00'}</T>
          <T size={10} c={D.sub}>24:00</T>
        </View>
        <View style={s.legend}>
          <View style={[s.swatch, { backgroundColor: 'rgba(232,68,46,0.35)' }]} />
          <T size={12} c={D.sub} style={s.grow}>Buzzing</T>
          <View style={[s.swatch, { backgroundColor: 'rgba(255,255,255,0.06)' }]} />
          <T size={12} c={D.sub}>Silent · lands in inbox</T>
        </View>
      </View>

      <View style={s.urgentCard}>
        <View style={s.grow}>
          <T w="b" size={14}>Urgent gets through anyway</T>
          <T size={11} c={D.sub} style={s.hint}>A cancellation inside 2 hours always buzzes</T>
        </View>
        <Toggle on={prefs.urgent_always} color={D.accent}
          onPress={() => set('urgent_always', !prefs.urgent_always)} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  empty: { paddingVertical: 20 },
  hint: { marginTop: 2, lineHeight: 16 },

  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { borderRadius: 999, backgroundColor: D.card2, paddingVertical: 9, paddingHorizontal: 15 },
  chipOn: { backgroundColor: D.accent },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },

  row: { backgroundColor: D.card, borderRadius: 20, padding: 14, paddingHorizontal: 15, gap: 12 },
  rowDim: { backgroundColor: '#141416', borderRadius: 20, padding: 14, paddingHorizontal: 15, gap: 12 },
  rowHot: { borderWidth: 2, borderColor: D.accent },
  rowTop: { flexDirection: 'row', gap: 12 },
  icon: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  body: { marginTop: 3, lineHeight: 17 },
  unread: { width: 8, height: 8, borderRadius: 999, backgroundColor: D.accent, marginTop: 5 },
  actions: {
    flexDirection: 'row', gap: 9, borderTopWidth: 1, borderTopColor: D.border, paddingTop: 11,
  },
  decline: {
    flex: 1, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  accept: {
    flex: 1.3, height: 38, borderRadius: 999, backgroundColor: D.green,
    alignItems: 'center', justifyContent: 'center',
  },

  permCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 20, padding: 16,
  },
  permCardOff: { backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine },
  permIcon: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  cuttingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, padding: 16,
    backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine,
  },
  cuttingIcon: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: 'rgba(232,161,0,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },

  listCard: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  listLine: { borderBottomWidth: 1, borderBottomColor: D.border },

  quietCard: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 13 },
  quietTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dayBar: { height: 26, borderRadius: 8, backgroundColor: D.card2, overflow: 'hidden' },
  barSeg: { position: 'absolute', top: 0, bottom: 0 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  legend: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderTopWidth: 1, borderTopColor: D.border, paddingTop: 12,
  },
  swatch: { width: 10, height: 10, borderRadius: 3 },

  urgentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 20, padding: 15, paddingHorizontal: 16,
  },
});
