import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { Display } from '../components/ui';
import { pushPermission } from '../lib/push';
import { supabase } from '../lib/supabase';
import { colors, font, radius, shadow } from '../theme';

// Turns 14 and 15, customer side — 14a the inbox behind the Home bell, 14b its
// settings, 15a the reminder-timing picker, 15b the empty inbox.
//
// What actually buzzes is decided server-side by notif_should_push() (0037).
// This screen owns the switches that function reads; it never gates delivery
// itself, so the phone and the inbox can't disagree.

type Kind =
  | 'queue_next' | 'booking_answer' | 'cancellation' | 'wallet'
  | 'message' | 'review_ask' | 'reminder' | 'offer'
  | 'booking_request' | 'reschedule' | 'checked_in' | 'review' | 'digest';

type Notif = {
  id: string; kind: Kind; title: string; body: string | null;
  booking_id: string | null; amount_cents: number | null;
  read_at: string | null; created_at: string;
};

type Prefs = {
  push_queue_next: boolean; push_queue_moves: boolean; push_booking_answer: boolean;
  push_wallet: boolean; push_message: boolean; push_review_ask: boolean;
  push_offers: boolean; reminder_min: number;
};

const DEFAULTS: Prefs = {
  push_queue_next: true, push_queue_moves: false, push_booking_answer: true,
  push_wallet: true, push_message: true, push_review_ask: true,
  push_offers: false, reminder_min: 60,
};

// icon + the two tints per event, straight off 14a
const LOOK: Record<Kind, { icon: keyof typeof Ionicons.glyphMap; tint: string; bg: string }> = {
  queue_next: { icon: 'git-branch-outline', tint: '#fff', bg: colors.ink },
  booking_answer: { icon: 'calendar-outline', tint: colors.text, bg: colors.surface },
  cancellation: { icon: 'close', tint: colors.accent, bg: 'rgba(232,68,46,0.10)' },
  wallet: { icon: 'card-outline', tint: '#16A34A', bg: 'rgba(74,222,128,0.16)' },
  message: { icon: 'chatbubble-ellipses-outline', tint: colors.text, bg: colors.surface },
  review_ask: { icon: 'star', tint: colors.accent, bg: 'rgba(232,68,46,0.10)' },
  reminder: { icon: 'time-outline', tint: colors.text, bg: colors.surface },
  offer: { icon: 'pricetag-outline', tint: colors.text, bg: colors.surface },
  booking_request: { icon: 'calendar-outline', tint: colors.text, bg: colors.surface },
  reschedule: { icon: 'repeat', tint: colors.text, bg: colors.surface },
  checked_in: { icon: 'checkmark', tint: colors.text, bg: colors.surface },
  review: { icon: 'star', tint: colors.accent, bg: 'rgba(232,68,46,0.10)' },
  digest: { icon: 'trending-up-outline', tint: colors.text, bg: colors.surface },
};

// 15a's options. -1 is the evening before; 0 turns reminders off entirely.
const LEADS: { min: number; label: string; hint?: string }[] = [
  { min: 15, label: '15 minutes before' },
  { min: 30, label: '30 minutes before' },
  { min: 60, label: '1 hour before' },
  { min: 120, label: '2 hours before' },
  { min: -1, label: 'The evening before', hint: 'Sent at 8:00 PM' },
];

const leadLabel = (m: number) =>
  m === -1 ? 'Evening' : m === 0 ? 'Off' : m >= 60 ? `${m / 60} h` : `${m} min`;

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function bucket(iso: string): 'TODAY' | 'YESTERDAY' | 'EARLIER' {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'TODAY';
  if (d.toDateString() === yest.toDateString()) return 'YESTERDAY';
  return 'EARLIER';
}

export default function CustomerNotificationsScreen({ userId, onBack, onOpenBooking, onRate }: {
  userId: string; onBack: () => void;
  onOpenBooking?: (bookingId: string) => void; onRate?: (bookingId: string) => void;
}) {
  const [rows, setRows] = useState<Notif[] | null>(null);
  const [settings, setSettings] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('notifications')
      .select('id, kind, title, body, booking_id, amount_cents, read_at, created_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(80);
    if (error) return Alert.alert('Could not load notifications', error.message);
    setRows((data ?? []) as Notif[]);
  }, [userId]);

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

  if (settings) {
    return <NotificationSettings userId={userId} onBack={() => setSettings(false)} />;
  }

  const all = rows ?? [];
  const unread = all.filter((n) => !n.read_at).length;
  const groups: ['TODAY' | 'YESTERDAY' | 'EARLIER', Notif[]][] =
    (['TODAY', 'YESTERDAY', 'EARLIER'] as const)
      .map((g) => [g, all.filter((n) => bucket(n.created_at) === g)] as const)
      .filter(([, list]) => list.length > 0)
      .map(([g, list]) => [g, list]);

  const header = (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={8}
        style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
        <Ionicons name="arrow-back" size={16} color={colors.text} />
      </Pressable>
      <Display size={18} style={s.headerTitle}>Notifications</Display>
      {unread > 0
        ? <Text style={s.markAll} onPress={markAllRead}>Mark all read</Text>
        : <View style={s.puckGhost} />}
    </View>
  );

  // 15b — nothing to show
  if (rows !== null && all.length === 0) {
    return (
      <View style={s.screen}>
        {header}
        <View style={s.empty}>
          <View style={s.emptyCircle}>
            <Ionicons name="notifications-outline" size={34} color={colors.textTertiary} />
          </View>
          <View>
            <Display size={19} style={s.emptyTitle}>All caught up</Display>
            <Text style={s.emptyText}>
              Queue updates, booking answers and wallet activity land here.
            </Text>
          </View>
          <Pressable onPress={() => setSettings(true)}
            style={({ pressed }) => [s.emptyBtn, pressed && s.pressed]}>
            <Text style={s.emptyBtnText}>NOTIFICATION SETTINGS</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      {header}
      <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
        {groups.map(([label, list]) => (
          <View key={label} style={s.group}>
            <Text style={s.groupLabel}>{label}</Text>
            <View style={s.groupRows}>
              {list.map((n) => {
                const look = LOOK[n.kind] ?? LOOK.digest;
                const askingForReview = n.kind === 'review_ask' && !!n.booking_id;
                return (
                  <Pressable key={n.id}
                    onPress={() => { markRead(n); if (n.booking_id) onOpenBooking?.(n.booking_id); }}
                    accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body ?? ''}`}
                    style={({ pressed }) => [s.row, !n.read_at && s.rowUnread, pressed && s.pressed]}>
                    <View style={[s.icon, { backgroundColor: look.bg }]}>
                      <Ionicons name={look.icon} size={17} color={look.tint} />
                    </View>
                    <View style={s.grow}>
                      <Text style={s.rowTitle}>{n.title}</Text>
                      {!!n.body && <Text style={s.rowBody}>{n.body}</Text>}
                      {askingForReview ? (
                        <View style={s.rowActionLine}>
                          <Pressable onPress={() => { markRead(n); onRate?.(n.booking_id!); }}
                            style={({ pressed }) => [s.rateBtn, pressed && s.pressed]}>
                            <Text style={s.rateText}>RATE NOW</Text>
                          </Pressable>
                          <Text style={s.rowTime}>{clock(n.created_at)}</Text>
                        </View>
                      ) : (
                        <Text style={s.rowTime}>
                          {label === 'EARLIER'
                            ? new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : clock(n.created_at)}
                        </Text>
                      )}
                    </View>
                    {!n.read_at && <View style={s.dot} />}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

// ---- 14b -----------------------------------------------------------------
const QUEUE_ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'push_queue_next', label: "You're next in line", hint: 'When one person is ahead of you' },
  { key: 'push_queue_moves', label: 'Queue position changes', hint: 'Every time the line moves' },
  { key: 'push_booking_answer', label: 'Booking confirmed or declined', hint: 'Includes reschedule answers' },
];
const MONEY_ROWS: { key: keyof Prefs; label: string; hint: string }[] = [
  { key: 'push_wallet', label: 'Deposits & refunds', hint: 'Money in or out of your wallet' },
  { key: 'push_message', label: 'New messages', hint: 'From your barber' },
  { key: 'push_review_ask', label: 'Review reminders', hint: 'After a completed visit' },
];

function NotificationSettings({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    supabase.from('notification_prefs').select('*').eq('user_id', userId).maybeSingle()
      .then(({ data }) => { if (data) setPrefs({ ...DEFAULTS, ...data }); });
    pushPermission().then((p) => setGranted(p === 'granted'));
  }, [userId]);

  async function save(patch: Partial<Prefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    const { error } = await supabase.from('notification_prefs')
      .upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' });
    if (error) Alert.alert('Could not save', error.message);
  }

  const rowsCard = (list: typeof QUEUE_ROWS) => (
    <View style={s.card}>
      {list.map((r, i) => (
        <View key={r.key} style={[s.prefRow, i < list.length - 1 && s.prefRowBorder]}>
          <View style={s.grow}>
            <Text style={s.prefLabel}>{r.label}</Text>
            <Text style={s.prefHint}>{r.hint}</Text>
          </View>
          <Switch value={prefs[r.key] as boolean} onValueChange={(v) => save({ [r.key]: v } as Partial<Prefs>)}
            trackColor={{ false: '#DDD9CF', true: colors.accent }} thumbColor="#fff" />
        </View>
      ))}
    </View>
  );

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={onBack} hitSlop={8}
          style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={16} color={colors.text} />
        </Pressable>
        <Display size={18} style={s.headerTitle}>Notifications</Display>
        <View style={s.puckGhost} />
      </View>

      <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
        {/* the OS has the final say; this card reports it rather than pretending */}
        <View style={s.permCard}>
          <View style={s.permIcon}>
            <Ionicons name="notifications-outline" size={17} color="#fff" />
          </View>
          <View style={s.grow}>
            <Text style={s.permTitle}>Push notifications</Text>
            <Text style={s.permSub}>
              {granted === null ? 'Checking…'
                : granted ? 'Allowed on this phone' : 'Blocked — tap to open Settings'}
            </Text>
          </View>
          {granted
            ? <View style={s.permOn}><View style={s.permKnob} /></View>
            : (
              <Pressable onPress={() => Linking.openSettings()}
                style={({ pressed }) => [s.permOff, pressed && s.pressed]}>
                <View style={s.permKnob} />
              </Pressable>
            )}
        </View>

        <Text style={s.section}>QUEUE &amp; BOOKINGS</Text>
        <View style={s.card}>
          {QUEUE_ROWS.map((r) => (
            <View key={r.key} style={[s.prefRow, s.prefRowBorder]}>
              <View style={s.grow}>
                <Text style={s.prefLabel}>{r.label}</Text>
                <Text style={s.prefHint}>{r.hint}</Text>
              </View>
              <Switch value={prefs[r.key] as boolean}
                onValueChange={(v) => save({ [r.key]: v } as Partial<Prefs>)}
                trackColor={{ false: '#DDD9CF', true: colors.accent }} thumbColor="#fff" />
            </View>
          ))}
          <Pressable onPress={() => setPickerOpen(true)} style={s.prefRow}
            accessibilityRole="button" accessibilityLabel="Reminder timing">
            <View style={s.grow}>
              <Text style={s.prefLabel}>Reminder before your slot</Text>
              <Text style={s.prefHint}>
                {prefs.reminder_min === 0 ? 'Off'
                  : prefs.reminder_min === -1 ? 'The evening before'
                    : `${leadLabel(prefs.reminder_min)} before`}
              </Text>
            </View>
            <Text style={s.prefValue}>{leadLabel(prefs.reminder_min)}</Text>
            <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
          </Pressable>
        </View>

        <Text style={s.section}>WALLET &amp; MESSAGES</Text>
        {rowsCard(MONEY_ROWS)}

        <Text style={s.section}>OFFERS</Text>
        <View style={s.card}>
          <View style={s.prefRow}>
            <View style={s.grow}>
              <Text style={s.prefLabel}>Deals near you</Text>
              <Text style={s.prefHint}>Discounts from Tangier salons</Text>
            </View>
            <Switch value={prefs.push_offers} onValueChange={(v) => save({ push_offers: v })}
              trackColor={{ false: '#DDD9CF', true: colors.accent }} thumbColor="#fff" />
          </View>
        </View>
      </ScrollView>

      <ReminderSheet visible={pickerOpen} value={prefs.reminder_min}
        onClose={() => setPickerOpen(false)}
        onPick={(m) => { save({ reminder_min: m }); setPickerOpen(false); }} />
    </View>
  );
}

// ---- 15a -----------------------------------------------------------------
function ReminderSheet({ visible, value, onClose, onPick }: {
  visible: boolean; value: number; onClose: () => void; onPick: (min: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <View style={s.sheetHead}>
          <View style={s.sheetSlot} />
          <Display size={18} style={s.sheetTitle}>Remind me</Display>
          <Pressable onPress={onClose} hitSlop={8} style={[s.sheetSlot, s.sheetSlotEnd]}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>
        <Text style={s.sheetSub}>How long before your slot should we ping you?</Text>

        <View style={s.optionList}>
          {LEADS.map((o) => {
            const on = draft === o.min;
            // the mock recommends 1 h off the salon's travel time; without a
            // distance we say why it is the default instead of inventing minutes
            const hint = o.hint ?? (o.min === 60 ? 'Recommended' : undefined);
            return (
              <Pressable key={o.min} onPress={() => setDraft(o.min)}
                accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.option, on && s.optionOn, pressed && s.pressed]}>
                <View style={s.grow}>
                  <Text style={[s.optionLabel, on && s.optionLabelOn]}>{o.label}</Text>
                  {(on || o.hint) && !!hint && <Text style={s.optionHint}>{hint}</Text>}
                </View>
                <View style={[s.radio, on && s.radioOn]}>
                  {on && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={s.noteText}>
            Queue tickets always ping you when you're next, whatever you pick here.
          </Text>
        </View>

        <Pressable onPress={() => onPick(draft)}
          style={({ pressed }) => [s.saveBtn, pressed && s.pressed]}>
          <Text style={s.saveText}>SAVE</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: 66, paddingHorizontal: 20, gap: 14, backgroundColor: colors.surface },
  grow: { flex: 1 },
  pressed: { opacity: 0.75 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  puckGhost: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },
  markAll: { width: 40, fontSize: 11, fontWeight: '600', color: colors.accent, lineHeight: 13 },

  list: { gap: 14, paddingBottom: 40 },
  group: { gap: 14 },
  groupLabel: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: colors.textTertiary },
  groupRows: { gap: 10 },

  row: {
    flexDirection: 'row', gap: 12, backgroundColor: colors.bg, borderRadius: 20,
    paddingVertical: 15, paddingHorizontal: 16, ...shadow,
  },
  rowUnread: { borderWidth: 2, borderColor: colors.accent },
  icon: {
    width: 38, height: 38, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowBody: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 3 },
  rowTime: { fontSize: 11, color: colors.textTertiary, marginTop: 5 },
  rowActionLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  rateBtn: {
    height: 32, borderRadius: radius.pill, backgroundColor: colors.ink,
    justifyContent: 'center', paddingHorizontal: 15,
  },
  rateText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: '#fff' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 4 },

  // 15b
  empty: { alignItems: 'center', gap: 16, paddingTop: 150 },
  emptyCircle: {
    width: 96, height: 96, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: '#C9C5BB', alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { textAlign: 'center' },
  emptyText: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20,
    maxWidth: 260, textAlign: 'center',
  },
  emptyBtn: {
    height: 50, borderRadius: radius.pill, backgroundColor: colors.ink,
    justifyContent: 'center', paddingHorizontal: 30,
  },
  emptyBtnText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.96, color: '#fff' },

  // 14b
  permCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.ink,
    borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18,
  },
  permIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  permTitle: { fontSize: font.small, fontWeight: '700', color: '#fff' },
  permSub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  permOn: {
    width: 42, height: 26, borderRadius: 999, backgroundColor: colors.accent,
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', padding: 3,
  },
  permOff: {
    width: 42, height: 26, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', padding: 3,
  },
  permKnob: { width: 20, height: 20, borderRadius: 999, backgroundColor: '#fff' },

  section: {
    fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary, marginTop: 2,
  },
  card: { backgroundColor: colors.bg, borderRadius: 24, paddingHorizontal: 18, ...shadow },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  prefRowBorder: { borderBottomWidth: 1, borderBottomColor: '#EFECE4' },
  prefLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  prefHint: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  prefValue: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },

  // 15a
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  sheetSlot: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  sheetSlotEnd: { alignItems: 'flex-end' },
  sheetTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.54 },
  sheetSub: {
    textAlign: 'center', fontSize: font.small, color: colors.textSecondary,
    lineHeight: 20, marginTop: -2,
  },
  optionList: { gap: 9, marginTop: 4 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 18, paddingVertical: 15, paddingHorizontal: 16, ...shadow,
  },
  optionOn: { borderWidth: 2, borderColor: colors.ink },
  optionLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  optionLabelOn: { fontWeight: '700' },
  optionHint: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  radio: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 1.5, borderColor: '#D8D4CA',
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },
  saveBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  saveText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },
});
