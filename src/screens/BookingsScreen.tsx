import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import {
  Avatar, Eyebrow, Ico, Screen, Serif, Sheet, SheetHead, Stat, T, TAB_INSET,
} from '../components/dark';
import BookingPanelSheet, { BookingRequestSheet, PanelBooking } from '../components/BookingPanels';
import CancelBookingSheet from '../components/CancelBookingSheet';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import RateClientSheet from '../components/RateClientSheet';
import SettleBundleSheet from '../components/SettleBundleSheet';
import SlotPicker from '../components/SlotPicker';
import { PillButton } from '../components/ui';
import { Block, daySlots, Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { colors, dark as D, inter, radius, sp } from '../theme';
import type { Barber, Profile } from '../types';
import BarberQueueScreen from './BarberQueueScreen';
import ChatScreen from './ChatScreen';
import EarningsScreen from './EarningsScreen';
import NotificationsScreen from './NotificationsScreen';
import ProfileScreen from './ProfileScreen';

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_cents: number;
  walk_in_name: string | null;
  customer_id: string;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null; avatar_url: string | null; phone: string | null } | null;
};

// where a live appointment sits in its lifecycle → which single button the card shows
type Stage = 'confirm' | 'check_in' | 'start' | 'in_chair';
function stageOf(b: BookingRow): Stage | null {
  if (b.status === 'pending') return 'confirm';
  if (b.status !== 'confirmed' || b.completed_at) return null;
  if (b.started_at) return 'in_chair';
  if (b.checked_in_at) return 'start';
  return 'check_in';
}

const dh = (cents: number) => `${Math.round(cents / 100)} DH`;
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const minLabel = (min: number) => new Date(0, 0, 0, 0, min).toTimeString().slice(0, 5);
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const nameOf = (b: BookingRow, barberId: string) =>
  b.walk_in_name ?? (b.customer_id === barberId ? 'Walk-in' : b.customer?.full_name ?? 'Client');
const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function ClientAvatar({ b, barberId, size = 46, warm }: {
  b: BookingRow; barberId: string; size?: number; warm?: boolean;
}) {
  const url = b.customer_id === barberId ? null : b.customer?.avatar_url;
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 999 }} />;
  if (b.customer_id === barberId && !b.walk_in_name) {
    return <Avatar size={size} icon="user" />;
  }
  return <Avatar size={size} warm={warm} initials={initialsOf(nameOf(b, barberId))} />;
}

function MenuRow({ icon, label, onPress, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.menuRow, pressed && s.pressed]}>
      <View style={s.menuRowIcon}>
        <Ionicons name={icon} size={19} color={danger ? D.red : D.text} />
      </View>
      <T w="b" size={14} c={danger ? D.red : D.text} style={s.grow}>{label}</T>
      <Ionicons name="chevron-forward" size={18} color={D.muted} />
    </Pressable>
  );
}

export default function BookingsScreen({ barber, profile, phone, onProfileChanged, onChromeHidden, goSchedule }: {
  barber: Barber;
  profile: Profile;
  phone: string | null;
  onProfileChanged: () => void;
  onChromeHidden?: (hidden: boolean) => void;
  goSchedule: () => void;
}) {
  const barberId = barber.id;
  const [bookings, setBookings] = useState<BookingRow[] | null>(null); // null = first load in flight
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<{ id: string; day: string }[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [salonName, setSalonName] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [chat, setChat] = useState<{ id: string; title: string } | null>(null);
  const [sheetClient, setSheetClient] = useState<ClientRef | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [menuBooking, setMenuBooking] = useState<BookingRow | null>(null);
  const [resched, setResched] = useState<BookingRow | null>(null);
  const [reschedAt, setReschedAt] = useState<Date | null>(null);
  const [completedB, setCompletedB] = useState<BookingRow | null>(null);
  const [settleB, setSettleB] = useState<BookingRow | null>(null);
  const [cancelling, setCancelling] = useState<BookingRow | null>(null);
  const [showEarnings, setShowEarnings] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [panel, setPanel] = useState<BookingRow | null>(null);      // 1d
  const [request, setRequest] = useState<BookingRow | null>(null);  // 3d

  useEffect(() => {
    if (!barber.salon_id) return;
    supabase.from('salons').select('name').eq('id', barber.salon_id).single()
      .then(({ data }) => setSalonName(data?.name ?? null));
  }, [barber.salon_id]);

  // one window: last 7 days (earnings bars) through +14 days (requests)
  const load = useCallback(async () => {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
    const to = new Date(); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 14);
    const { data, error } = await supabase.from('bookings')
      .select('id, starts_at, ends_at, status, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name, avatar_url, phone)')
      .eq('barber_id', barberId)
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
      .in('status', ['pending', 'confirmed'])
      .order('starts_at');
    if (error) Alert.alert('Could not load bookings', error.message);
    else setBookings(data as unknown as BookingRow[]);
    const [av, off, blk] = await Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
      supabase.from('days_off').select('id, day').eq('barber_id', barberId)
        .gte('day', isoDay(new Date())),
      supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', barberId),
    ]);
    setWindows(av.data ?? []);
    setDaysOff(off.data ?? []);
    setBlocks(blk.data ?? []);
    const { count } = await supabase.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('barber_id', barberId).is('read_at', null);
    setUnread(count ?? 0);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  async function accept(b: BookingRow) {
    const { error } = await supabase.rpc('accept_booking', { p_booking: b.id });
    if (error) Alert.alert('Could not accept', error.message);
    load();
  }

  function decline(b: BookingRow) {
    Alert.alert('Decline this request?', `${nameOf(b, barberId)} · ${hhmm(b.starts_at)}`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Decline', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_booking', { p_booking: b.id });
          if (error) Alert.alert('Could not decline', error.message);
          load();
        },
      },
    ]);
  }

  function openChat(req: { id: string; title: string } | null) {
    setSheetClient(null);
    setChat(req);
    onChromeHidden?.(!!req);
  }

  const panelOf = (b: BookingRow): PanelBooking => ({
    id: b.id, customerId: b.customer_id, name: nameOf(b, barberId),
    initials: initialsOf(nameOf(b, barberId)),
    service: b.services?.name ?? 'Service',
    durationMin: Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000),
    whenLabel: new Date(b.starts_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    timeLabel: hhmm(b.starts_at),
    priceCents: b.price_cents,
    checkedInAt: b.checked_in_at, startedAt: b.started_at,
    phone: b.customer_id === barberId ? null : b.customer?.phone ?? null,
    isWalkIn: b.customer_id === barberId,
  });

  const clientRefOf = (b: BookingRow): ClientRef => ({
    name: nameOf(b, barberId),
    avatarUrl: b.customer_id === barberId ? null : b.customer?.avatar_url ?? null,
    phone: b.customer_id === barberId ? null : b.customer?.phone ?? null,
    customerId: b.customer_id,
    walkInName: b.walk_in_name,
  });

  function openEarnings(v: boolean) {
    setShowEarnings(v);
    onChromeHidden?.(v);
  }

  function openProfile(v: boolean) {
    setShowProfile(v);
    onChromeHidden?.(v);
  }

  // stage transitions: confirm uses accept_booking; the rest go through advance_booking
  async function advance(b: BookingRow, stage: 'check_in' | 'start' | 'complete') {
    // 34f — completing settles first: what was actually done decides the price,
    // and a half-taken bundle loses its saving. The sheet runs advance_booking
    // itself, and closes straight through when there is only one service.
    if (stage === 'complete') return setSettleB(b);
    const { error } = await supabase.rpc('advance_booking', { p_booking: b.id, p_stage: stage });
    if (error) Alert.alert('Could not update', error.message);
    load();
  }

  async function menuAction(b: BookingRow, rpc: 'cancel_booking' | 'mark_no_show') {
    setMenuBooking(null);
    const { error } = await supabase.rpc(rpc, { p_booking: b.id });
    if (error) Alert.alert('Could not update', error.message);
    load();
  }

  async function confirmReschedule() {
    if (!resched || !reschedAt) return;
    const { error } = await supabase.rpc('reschedule_booking', {
      p_booking: resched.id, p_new_start: reschedAt.toISOString(),
    });
    if (error) Alert.alert('Could not reschedule', error.message);
    setResched(null); setReschedAt(null);
    load();
  }

  const reviewMsg = (b: BookingRow) =>
    `Thanks for coming in! How was your ${b.services?.name ?? 'cut'}? You can rate it in the app: My Bookings → Rate ⭐`;

  async function askReviewInChat(b: BookingRow) {
    const { error } = await supabase.from('messages')
      .insert({ booking_id: b.id, sender_id: barberId, body: reviewMsg(b) });
    if (error) Alert.alert('Could not send', error.message);
    else Alert.alert('Sent', 'Review ask sent in chat.');
  }

  function askReviewBySms(b: BookingRow) {
    const to = b.customer?.phone;
    if (!to) return;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${to}${sep}body=${encodeURIComponent(reviewMsg(b))}`)
      .catch(() => Alert.alert('SMS', 'Could not open the SMS app.'));
  }

  const todayOff = daysOff.find((d) => d.day === isoDay(new Date()));
  async function toggleClockOut() {
    if (todayOff) {
      await supabase.from('days_off').delete().eq('id', todayOff.id);
      return load();
    }
    Alert.alert('Clock out?', 'The shop closes for the rest of today — new bookings for today are blocked. Existing ones stay.', [
      { text: 'Keep working', style: 'cancel' },
      {
        text: 'Clock out', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('days_off')
            .insert({ barber_id: barberId, day: isoDay(new Date()), label: 'Clocked out' });
          if (error) Alert.alert('Could not clock out', error.message);
          load();
        },
      },
    ]);
  }

  if (chat) {
    return <ChatScreen dark bookingId={chat.id} myId={barberId}
      title={chat.title} onBack={() => openChat(null)} />;
  }
  if (showProfile) {
    return <ProfileScreen profile={profile} barber={barber} phone={phone}
      onProfileChanged={onProfileChanged} onChromeHidden={onChromeHidden}
      onBack={() => openProfile(false)} />;
  }
  if (showEarnings) {
    return <EarningsScreen barberId={barberId} onBack={() => openEarnings(false)} />;
  }
  if (showQueue) {
    return <BarberQueueScreen barberId={barberId}
      onBack={() => { setShowQueue(false); onChromeHidden?.(false); load(); }} />;
  }
  if (inboxOpen) {
    return <NotificationsScreen barberId={barberId}
      onBack={() => { setInboxOpen(false); onChromeHidden?.(false); load(); }} />;
  }

  // ---- derive the dashboard ----
  const now = Date.now();
  const todayKey = new Date().toDateString();
  const rows = bookings ?? [];
  const confirmed = rows.filter((b) => b.status === 'confirmed');
  const todayConfirmed = confirmed.filter((b) => new Date(b.starts_at).toDateString() === todayKey);
  const earnedToday = todayConfirmed.reduce((a, b) => a + b.price_cents, 0);

  // 7-day earnings bars (booked value per day; today last, accent-emphasized)
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.toDateString();
    return confirmed.filter((b) => new Date(b.starts_at).toDateString() === key)
      .reduce((a, b) => a + b.price_cents, 0);
  });
  const weekMax = Math.max(...week, 1);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 6);

  // theoretical slots today, minus breaks — 'full' here only means blocked, since booked=[]
  const capacity = daySlots(new Date(), 30, windows, [], [], blocks)
    .filter((sl) => sl.status !== 'full').length;
  const freeSlots = Math.max(0, capacity - todayConfirmed.length);
  const walkIns = todayConfirmed.filter((b) => b.customer_id === barberId);
  const walkInsDH = walkIns.reduce((a, b) => a + b.price_cents, 0);

  const requests = rows.filter((b) => b.status === 'pending' && new Date(b.starts_at).getTime() > now);
  // today's live cards: pending requests inline + confirmed until completed
  // (an in-chair client running past his slot stays visible until Complete)
  const remaining = rows
    .filter((b) => {
      if (new Date(b.starts_at).toDateString() !== todayKey) return false;
      if (b.status === 'pending') return new Date(b.starts_at).getTime() > now;
      if (b.status !== 'confirmed' || b.completed_at) return false;
      return new Date(b.ends_at).getTime() > now || !!b.checked_in_at;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nextUp = remaining.find((b) => b.status === 'confirmed') ?? null;
  const pending = remaining.filter((b) => b.status === 'pending');

  const today = new Date();
  const dateLabel = today
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();
  const firstName = (profile.full_name ?? 'Barber').split(' ')[0];
  const hours = windows.find((w) => w.weekday === today.getDay());
  const nextShift = windows.length
    ? (() => {
      for (let i = 1; i <= 7; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        const w = windows.find((x) => x.weekday === d.getDay());
        if (w && !daysOff.some((o) => o.day === isoDay(d))) {
          return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${minLabel(w.start_min)}`;
        }
      }
      return '—';
    })()
    : '—';

  // first genuinely free slot in the next week, minus the booking we're about to drop —
  // 1r offers it to the client in the same breath as the cancellation
  function nextFreeSlot(excludeId: string): string | null {
    const busy = confirmed.filter((b) => b.id !== excludeId);
    const off = daysOff.map((d) => d.day);
    for (let i = 0; i <= 7; i++) {
      const day = new Date(); day.setDate(day.getDate() + i);
      const free = daySlots(day, 30, windows, busy, off, blocks)
        .find((sl) => sl.status === 'free');
      if (free) {
        return `${free.time.toLocaleDateString('en-US', { weekday: 'short' })} ${free.time.toTimeString().slice(0, 5)}`;
      }
    }
    return null;
  }

  const bars = (
    <View style={s.chart} accessible
      accessibilityLabel={`Booked value, last 7 days, today ${dh(earnedToday)}`}>
      {week.map((v, i) => (
        <View key={i} style={[s.bar, {
          height: Math.max(3, Math.round((v / weekMax) * 52)),
          backgroundColor: i === 6 ? (todayOff ? D.muted : D.accent) : D.barMuted,
        }]} />
      ))}
    </View>
  );

  return (
    <View style={s.root}>
      <Screen gap={14} bottom={TAB_INSET}>
        {/* 1a header — eyebrow date over the Playfair greeting, bell with its unread dot */}
        <View style={s.headRow}>
          <Pressable onPress={() => openProfile(true)} accessibilityRole="button"
            accessibilityLabel="Your profile" style={({ pressed }) => [s.grow, pressed && s.pressed]}>
            <Eyebrow ls={1.8}>{dateLabel}</Eyebrow>
            <Serif size={26} ls={0.03} style={s.greet}>Salam, {firstName}</Serif>
          </Pressable>
          <Pressable onPress={() => { setInboxOpen(true); onChromeHidden?.(true); }}
            accessibilityRole="button"
            accessibilityLabel={`Notifications, ${unread} unread`}
            style={({ pressed }) => [s.bell, pressed && s.pressed]}>
            <Ico name="bell" size={16} />
            {unread > 0 && <View style={s.bellDot} />}
          </Pressable>
        </View>

        {/* 1s — the clocked-out banner replaces nothing, it sits above the number */}
        {todayOff && (
          <View style={s.clockedCard}>
            <View style={s.clockedIcon}><Ico name="slash" size={16} color={D.amber} /></View>
            <View style={s.grow}>
              <T w="b" size={13} c={D.amber}>Clocked out for today</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>New bookings for today are blocked</T>
            </View>
            <Pressable onPress={toggleClockOut} accessibilityRole="button" accessibilityLabel="Clock back in"
              style={({ pressed }) => [s.undoBtn, pressed && s.pressed]}>
              <T w="eb" size={11} c={D.bg} ls={0.55}>UNDO</T>
            </Pressable>
          </View>
        )}

        {/* booked today + the 7-day sparkline */}
        <Pressable onPress={() => openEarnings(true)} accessibilityRole="button"
          accessibilityLabel="Earnings details" style={({ pressed }) => pressed && s.pressed}>
          <Eyebrow ls={1.6}>BOOKED TODAY</Eyebrow>
          <Serif size={44} ls={0} style={[s.bigMoney, todayOff && { color: D.muted }]}>
            {dh(earnedToday)}
          </Serif>
          {bars}
          <View style={s.chartAxis}>
            <T size={11} c={D.sub}>{weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</T>
            <T size={11} c={D.sub}>Today</T>
          </View>
        </Pressable>

        {/* three-up tiles */}
        <View style={s.tileRow}>
          <Stat label="TODAY" value={String(todayConfirmed.length)}
            valueColor={todayOff ? D.muted : undefined} />
          <Stat label="WALK-INS" value={String(walkIns.length)}
            sub={todayOff ? undefined : dh(walkInsDH)} valueColor={todayOff ? D.muted : undefined} />
          {todayOff
            ? <View style={s.tile}>
                <Eyebrow ls={0.8}>NEXT SHIFT</Eyebrow>
                <T w="b" size={16} style={{ marginTop: 4 }}>{nextShift}</T>
              </View>
            : <Stat label="FREE SLOTS" value={String(freeSlots)} />}
        </View>

        {/* open / clock-out strip */}
        {!todayOff && (
          <View style={s.openRow}>
            <Pressable onPress={() => { setShowQueue(true); onChromeHidden?.(true); }}
              accessibilityRole="button" accessibilityLabel="Live queue"
              style={({ pressed }) => [s.openTap, pressed && s.pressed]}>
              <View style={s.openDotWrap}><View style={s.openDot} /></View>
              <View style={s.grow}>
                <T w="b" size={13}>Open · taking walk-ins</T>
                <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                  {hours ? `Working ${minLabel(hours.start_min)} – ${minLabel(hours.end_min)} today` : 'No hours set for today'}
                </T>
              </View>
            </Pressable>
            <Pressable onPress={toggleClockOut} accessibilityRole="button" accessibilityLabel="Clock out"
              style={({ pressed }) => [s.clockOutBtn, pressed && s.pressed]}>
              <T w="b" size={11} ls={0.55}>CLOCK OUT</T>
            </Pressable>
          </View>
        )}

        {/* next up */}
        {!todayOff && (
          <View style={s.sectionRow}>
            <Eyebrow ls={1.65}>NEXT UP</Eyebrow>
            <Pressable onPress={goSchedule} hitSlop={6} accessibilityRole="button" accessibilityLabel="My day"
              style={({ pressed }) => pressed && s.pressed}>
              <T w="sb" size={12} c={D.accent}>My day</T>
            </Pressable>
          </View>
        )}

        {bookings === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading appointments" />}

        {nextUp && !todayOff && (() => {
          const st = stageOf(nextUp)!;
          const mins = Math.round((new Date(nextUp.starts_at).getTime() - now) / 60_000);
          const when = st === 'in_chair' ? 'IN CHAIR'
            : mins <= 0 ? 'NOW' : mins < 60 ? `IN ${mins} MIN` : `IN ${Math.round(mins / 60)} H`;
          const cta = st === 'check_in' ? 'CHECK IN'
            : st === 'start' ? 'START' : `MARK DONE · COLLECT ${dh(nextUp.price_cents)}`;
          const dur = Math.round(
            (new Date(nextUp.ends_at).getTime() - new Date(nextUp.starts_at).getTime()) / 60_000);
          return (
            <View style={s.nextCard}>
              <Pressable onPress={() => setPanel(nextUp)} accessibilityRole="button"
                accessibilityLabel={`${nameOf(nextUp, barberId)}, open booking`} style={s.nextTop}>
                <ClientAvatar b={nextUp} barberId={barberId} size={46} warm />
                <View style={s.grow}>
                  <T w="b" size={15}>{nameOf(nextUp, barberId)}</T>
                  <T size={12} c={D.sub} style={{ marginTop: 2 }}>
                    {nextUp.services?.name ?? 'Service'} · {dur} min · {dh(nextUp.price_cents)}
                  </T>
                </View>
                <View style={s.nextRight}>
                  <T w="eb" size={15} c={D.accent} style={s.tnum}>{hhmm(nextUp.starts_at)}</T>
                  <T size={10} c={D.sub} ls={0.8} style={{ marginTop: 2 }}>{when}</T>
                </View>
              </Pressable>
              {/* ponytail: deposits were removed in 0005_no_deposits — the strip carries
                  what the shop actually collects until the wallet deposit rail lands. */}
              <View style={s.moneyStrip}>
                <Ico name="check" size={13} color={D.green} />
                <T size={11} c={D.sub} style={s.grow}>
                  {nextUp.checked_in_at ? `Checked in ${hhmm(nextUp.checked_in_at)} · ` : ''}
                  {dh(nextUp.price_cents)} in cash
                </T>
              </View>
              <View style={s.nextBtns}>
                <Pressable onPress={() => advance(nextUp, st === 'check_in' ? 'check_in' : st === 'start' ? 'start' : 'complete')}
                  accessibilityRole="button" accessibilityLabel={cta}
                  style={({ pressed }) => [s.cta, st === 'in_chair' && { backgroundColor: D.green }, pressed && s.pressed]}>
                  <T w="b" size={12} c={st === 'in_chair' ? D.bg : '#fff'} ls={0.72}>{cta}</T>
                </Pressable>
                {nextUp.customer_id !== barberId && (
                  <Pressable onPress={() => openChat({ id: nextUp.id, title: nameOf(nextUp, barberId) })}
                    accessibilityRole="button" accessibilityLabel="Message client"
                    style={({ pressed }) => [s.puck42, pressed && s.pressed]}>
                    <Ico name="message-circle" size={17} />
                  </Pressable>
                )}
                <Pressable onPress={() => setMenuBooking(nextUp)} accessibilityRole="button"
                  accessibilityLabel="More actions"
                  style={({ pressed }) => [s.puck42, pressed && s.pressed]}>
                  <Ico name="more-vertical" size={16} />
                </Pressable>
              </View>
            </View>
          );
        })()}

        {/* pending requests, inline and dashed */}
        {!todayOff && pending.map((b) => (
          <View key={b.id} style={s.pendingCard}>
            <Pressable onPress={() => setRequest(b)} accessibilityRole="button"
              accessibilityLabel={`${nameOf(b, barberId)}, open request`} style={s.pendingTap}>
              <ClientAvatar b={b} barberId={barberId} size={40} />
              <View style={s.grow}>
                <View style={s.pendingNameRow}>
                  <T w="b" size={14}>{nameOf(b, barberId)}</T>
                  <View style={s.pendingChip}><T w="b" size={10} c={D.accent} ls={1}>PENDING</T></View>
                </View>
                <T size={12} c={D.sub} style={{ marginTop: 3 }}>
                  {b.services?.name ?? 'Service'} · {hhmm(b.starts_at)} · {dh(b.price_cents)}
                </T>
              </View>
            </Pressable>
            <Pressable onPress={() => decline(b)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Decline"
              style={({ pressed }) => [s.puck36, pressed && s.pressed]}>
              <Ico name="x" size={15} color={D.red} />
            </Pressable>
            <Pressable onPress={() => accept(b)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Accept"
              style={({ pressed }) => [s.puck36, { backgroundColor: D.green }, pressed && s.pressed]}>
              <Ico name="check" size={15} color={D.bg} />
            </Pressable>
          </View>
        ))}

        {/* 1s — nothing left today */}
        {bookings !== null && !nextUp && pending.length === 0 && (
          <View style={s.emptyWrap}>
            <View style={s.emptyCircle}><Ico name="scissors" size={32} color={D.muted} /></View>
            <View style={{ alignItems: 'center' }}>
              <Serif size={19} ls={0.03}>Nothing left today</Serif>
              <T size={13} c={D.sub} style={s.emptyText}>
                {todayOff
                  ? `Enjoy the day. You're back ${nextShift}.`
                  : 'Enjoy the day. The chair is free until tomorrow.'}
              </T>
            </View>
            <Pressable onPress={goSchedule} accessibilityRole="button" accessibilityLabel="See the schedule"
              style={({ pressed }) => [s.emptyBtn, pressed && s.pressed]}>
              <T w="b" size={12} ls={0.72}>SEE THE SCHEDULE</T>
            </Pressable>
          </View>
        )}
      </Screen>

      {/* client quick-view */}
      <ClientSheet client={sheetClient} barberId={barberId}
        onClose={() => setSheetClient(null)}
        onChat={(id, title) => openChat({ id, title })} />

      {/* 34f — tick off what was actually done, then complete. Hands off to 3a. */}
      <SettleBundleSheet
        booking={settleB && {
          id: settleB.id,
          starts_at: settleB.starts_at,
          client: nameOf(settleB, barberId),
        }}
        onClose={() => setSettleB(null)}
        onDone={() => { setCompletedB(settleB); setSettleB(null); load(); }} />

      {/* 3a–3c — rate the client, raised straight after MARK DONE */}
      <RateClientSheet
        visible={!!completedB}
        onClose={() => setCompletedB(null)}
        barberId={barberId}
        booking={completedB && {
          id: completedB.id,
          customerId: completedB.customer_id,
          name: nameOf(completedB, barberId),
          initials: initialsOf(nameOf(completedB, barberId)),
          service: completedB.services?.name ?? 'Service',
          time: hhmm(completedB.starts_at),
          priceCents: completedB.price_cents,
          isWalkIn: completedB.customer_id === barberId,
          hasPhone: !!completedB.customer?.phone,
          lateMin: completedB.checked_in_at
            ? Math.max(0, Math.round(
              (new Date(completedB.checked_in_at).getTime() - new Date(completedB.starts_at).getTime()) / 60_000))
            : null,
        }}
        bookedTodayCents={earnedToday}
        next={(() => {
          const n = remaining.find((b) => b.id !== completedB?.id && b.status === 'confirmed');
          if (!n) return null;
          return {
            ticket: String(remaining.indexOf(n) + 1).padStart(2, '0'),
            label: nameOf(n, barberId),
            service: n.services?.name ?? 'Service',
            waitingMin: Math.max(0, Math.round((now - new Date(n.starts_at).getTime()) / 60_000)),
            priceCents: n.price_cents,
          };
        })()}
        onAskInChat={() => completedB && askReviewInChat(completedB)}
        onAskBySms={() => { const b = completedB; setCompletedB(null); if (b) askReviewBySms(b); }}
        onDone={() => { setCompletedB(null); load(); }}
      />

      {/* 1d — the booking in the chair */}
      <BookingPanelSheet
        visible={!!panel}
        booking={panel && panelOf(panel)}
        onClose={() => setPanel(null)}
        onDone={() => { const b = panel; setPanel(null); if (b) advance(b, 'complete'); }}
        onChat={() => { const b = panel; setPanel(null); if (b) openChat({ id: b.id, title: nameOf(b, barberId) }); }}
        onHistory={() => { const b = panel; setPanel(null); if (b) setSheetClient(clientRefOf(b)); }}
        onReschedule={() => { const b = panel; setPanel(null); setResched(b); setReschedAt(null); }}
        onNoShow={() => { const b = panel; setPanel(null); if (b) menuAction(b, 'mark_no_show'); }}
      />

      {/* 3d — a request, with the shop's flag on it */}
      <BookingRequestSheet
        visible={!!request}
        booking={request && panelOf(request)}
        onClose={() => setRequest(null)}
        onAccept={() => { const b = request; setRequest(null); if (b) accept(b); }}
        onDecline={() => { const b = request; setRequest(null); if (b) setCancelling(b); }}
        onClearFlag={async () => {
          const b = request; setRequest(null);
          if (!b) return;
          const { error } = await supabase.from('client_flags')
            .update({ reason: null, require_full_payment: false, blocked: false })
            .eq('barber_id', barberId).eq('customer_id', b.customer_id);
          if (error) Alert.alert('Could not clear the flag', error.message);
        }}
      />

      {/* 1r — cancel a booking */}
      <CancelBookingSheet
        visible={!!cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={() => { setCancelling(null); load(); }}
        target={cancelling && {
          id: cancelling.id,
          name: nameOf(cancelling, barberId),
          time: hhmm(cancelling.starts_at),
          isWalkIn: cancelling.customer_id === barberId,
          nextFreeLabel: nextFreeSlot(cancelling.id),
        }}
      />

      {/* … actions menu */}
      <Modal visible={!!menuBooking} transparent animationType="slide" onRequestClose={() => setMenuBooking(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setMenuBooking(null)} />
        {menuBooking && (() => {
          const b = menuBooking;
          const canNoShow = b.status === 'confirmed' && new Date(b.starts_at).getTime() <= now && !b.completed_at;
          const canCancel = !b.started_at && new Date(b.starts_at).getTime() > now;
          return (
            <View style={s.menuSheet} onAccessibilityEscape={() => setMenuBooking(null)}>
              <View style={s.handle} />
              <View style={s.menuHead}>
                <View style={s.grow}>
                  <T w="b" size={17}>{nameOf(b, barberId)}</T>
                  <T size={12} c={D.sub}>{hhmm(b.starts_at)} · {b.services?.name ?? 'Service'}</T>
                </View>
                <Pressable onPress={() => setMenuBooking(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"
                  style={({ pressed }) => [s.menuClose, pressed && s.pressed]}>
                  <Ico name="x" size={16} />
                </Pressable>
              </View>
              {!b.started_at && (
                <MenuRow icon="calendar-outline" label="Reschedule"
                  onPress={() => { setMenuBooking(null); setResched(b); setReschedAt(null); }} />
              )}
              {b.customer_id !== barberId && (
                <MenuRow icon="chatbox-outline" label="Message client"
                  onPress={() => { setMenuBooking(null); openChat({ id: b.id, title: nameOf(b, barberId) }); }} />
              )}
              {canNoShow && (
                <MenuRow icon="person-remove-outline" label="Mark as no-show"
                  onPress={() => menuAction(b, 'mark_no_show')} />
              )}
              {canCancel && (
                <MenuRow danger icon="trash-outline"
                  label={b.status === 'pending' ? 'Decline request' : 'Cancel booking'}
                  onPress={() => { setMenuBooking(null); setCancelling(b); }} />
              )}
            </View>
          );
        })()}
      </Modal>

      {/* reschedule */}
      <Modal visible={!!resched} transparent animationType="slide" onRequestClose={() => setResched(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setResched(null)} />
        {resched && (
          <View style={[s.menuSheet, s.sheetLight]} onAccessibilityEscape={() => setResched(null)}>
            <Text style={s.sheetTitleLight}>
              Move {nameOf(resched, barberId)} · {(new Date(resched.ends_at).getTime() - new Date(resched.starts_at).getTime()) / 60_000} min
            </Text>
            {/* ponytail: SlotPicker is light-themed; lives on a light sheet until a dark variant matters */}
            <SlotPicker barberId={barberId}
              durationMin={(new Date(resched.ends_at).getTime() - new Date(resched.starts_at).getTime()) / 60_000}
              selected={reschedAt} onSelect={setReschedAt} />
            <PillButton title={reschedAt ? `Move to ${reschedAt.toTimeString().slice(0, 5)}` : 'Pick a new time'}
              disabled={!reschedAt} onPress={confirmReschedule} />
          </View>
        )}
      </Modal>

    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: D.bg },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  tnum: { fontVariant: ['tabular-nums'] },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  greet: { marginTop: 5 },
  bell: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9, width: 7, height: 7, borderRadius: 999,
    backgroundColor: D.accent,
  },

  clockedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 20, padding: 15,
    paddingHorizontal: 16, backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine,
  },
  clockedIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: 'rgba(232,161,0,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  undoBtn: {
    height: 32, borderRadius: 999, backgroundColor: D.amber, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },

  bigMoney: { marginTop: 4, fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 52, marginTop: 12 },
  bar: { flex: 1, borderRadius: 3 },
  chartAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },

  tileRow: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: D.card, borderRadius: 20, padding: 14, gap: 3 },

  openRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card,
    borderRadius: 20, padding: 14, paddingHorizontal: 16,
  },
  openTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  openDotWrap: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  openDot: { width: 9, height: 9, borderRadius: 999, backgroundColor: D.green },
  clockOutBtn: {
    height: 34, borderRadius: 999, borderWidth: 1, borderColor: D.border,
    paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
  },

  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },

  nextCard: {
    backgroundColor: D.card, borderRadius: 22, padding: 16, gap: 13,
    borderWidth: 2, borderColor: D.accent,
  },
  nextTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextRight: { alignItems: 'flex-end' },
  moneyStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: D.card2,
    borderRadius: 12, padding: 10, paddingHorizontal: 12,
  },
  nextBtns: { flexDirection: 'row', gap: 9 },
  cta: {
    flex: 1, height: 42, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  puck42: {
    width: 42, height: 42, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  puck36: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  pendingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 22, padding: 15, paddingHorizontal: 16,
    borderWidth: 1, borderStyle: 'dashed', borderColor: D.muted,
  },
  pendingTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  pendingNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pendingChip: { backgroundColor: D.accentSoft, borderRadius: 6, paddingVertical: 3, paddingHorizontal: 7 },

  emptyWrap: { alignItems: 'center', gap: 15, paddingTop: 44 },
  emptyCircle: {
    width: 88, height: 88, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: D.muted, alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { textAlign: 'center', marginTop: 8, maxWidth: 250, lineHeight: 20 },
  emptyBtn: {
    height: 48, borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 26,
    alignItems: 'center', justifyContent: 'center',
  },

  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  sheetBackdrop: { flex: 1, backgroundColor: D.scrim },
  menuSheet: {
    backgroundColor: D.sheet, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    padding: sp(5), paddingBottom: sp(10), gap: sp(3),
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: D.hairline, marginBottom: sp(2) },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: sp(3), marginBottom: sp(1) },
  menuClose: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3.5), paddingVertical: sp(3) },
  menuRowIcon: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetLight: { backgroundColor: colors.bg },
  sheetTitleLight: { fontFamily: inter.b, fontSize: 18, color: colors.text },
});
