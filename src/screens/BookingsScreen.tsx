import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import SlotPicker from '../components/SlotPicker';
import { PillButton, TAB_BAR_INSET } from '../components/ui';
import { Block, daySlots, Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';
import type { Barber, Profile } from '../types';
import ChatScreen from './ChatScreen';
import EarningsScreen from './EarningsScreen';
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

const dh = (cents: number) => `${(cents / 100).toFixed(2)} DH`;
const ampm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const nameOf = (b: BookingRow, barberId: string) =>
  b.walk_in_name ?? (b.customer_id === barberId ? 'Walk-in' : b.customer?.full_name ?? 'Client');

function ClientAvatar({ b, barberId, size = 44 }: { b: BookingRow; barberId: string; size?: number }) {
  const url = b.customer_id === barberId ? null : b.customer?.avatar_url;
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 999 }} />;
  const initials = nameOf(b, barberId).split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[s.avatarFallback, { width: size, height: size, borderRadius: 999 }]}>
      <Text style={s.avatarInitials}>{initials}</Text>
    </View>
  );
}

function MenuRow({ icon, label, onPress, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.menuRow, pressed && s.pressed]}>
      <View style={s.menuRowIcon}>
        <Ionicons name={icon} size={19} color={danger ? colors.danger : D.text} />
      </View>
      <Text style={[s.menuRowLabel, danger && { color: colors.danger }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={D.sub} />
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
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [chat, setChat] = useState<{ id: string; title: string } | null>(null);
  const [sheetClient, setSheetClient] = useState<ClientRef | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [menuBooking, setMenuBooking] = useState<BookingRow | null>(null);
  const [resched, setResched] = useState<BookingRow | null>(null);
  const [reschedAt, setReschedAt] = useState<Date | null>(null);
  const [completedB, setCompletedB] = useState<BookingRow | null>(null);
  const [showEarnings, setShowEarnings] = useState(false);

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
      supabase.from('time_blocks').select('day, start_min, end_min').eq('barber_id', barberId),
    ]);
    setWindows(av.data ?? []);
    setDaysOff(off.data ?? []);
    setBlocks(blk.data ?? []);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  async function accept(b: BookingRow) {
    const { error } = await supabase.rpc('accept_booking', { p_booking: b.id });
    if (error) Alert.alert('Could not accept', error.message);
    load();
  }

  function decline(b: BookingRow) {
    Alert.alert('Decline this request?', `${nameOf(b, barberId)} · ${ampm(b.starts_at)}`, [
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
    const { error } = await supabase.rpc('advance_booking', { p_booking: b.id, p_stage: stage });
    if (error) Alert.alert('Could not update', error.message);
    else if (stage === 'complete') setCompletedB(b);
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
    else { setCompletedB(null); Alert.alert('Sent', 'Review ask sent in chat.'); }
  }

  function askReviewBySms(b: BookingRow) {
    const phone = b.customer?.phone;
    if (!phone) return;
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(reviewMsg(b))}`)
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
    return <ChatScreen bookingId={chat.id} myId={barberId}
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

  // theoretical slots today, minus breaks — 'full' here only means blocked, since booked=[]
  const capacity = daySlots(new Date(), 30, windows, [], [], blocks)
    .filter((sl) => sl.status !== 'full').length;
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
  const shown = expanded ? remaining : remaining.slice(0, 3);

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* header */}
        <View style={s.headRow}>
          <View style={s.grow}>
            <Text style={s.headName} numberOfLines={1}>
              {profile.full_name ?? 'Barber'}
              {salonName ? <Text style={s.headSalon}>  /  {salonName}</Text> : null}
            </Text>
            <Text style={s.headDate}>{dateLabel}</Text>
          </View>
          <Pressable onPress={() => setRequestsOpen(true)} accessibilityRole="button" accessibilityLabel={`Booking requests, ${requests.length} waiting`}
            style={({ pressed }) => [s.circleBtn, pressed && s.pressed]}>
            <Ionicons name="notifications-outline" size={20} color={D.text} />
            {requests.length > 0 && <View style={s.bellDot} />}
          </Pressable>
          <Pressable onPress={() => openProfile(true)} accessibilityRole="button" accessibilityLabel="Your profile"
            style={({ pressed }) => pressed && s.pressed}>
            {profile.avatar_url
              ? <Image source={{ uri: profile.avatar_url }} style={s.headAvatar} />
              : <View style={[s.headAvatar, s.avatarFallback]}>
                  <Text style={s.avatarInitials}>
                    {(profile.full_name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </Text>
                </View>}
          </Pressable>
        </View>

        {/* daily earnings — tap for the full breakdown */}
        <Pressable onPress={() => openEarnings(true)} accessibilityRole="button" accessibilityLabel="Earnings details"
          style={({ pressed }) => [s.earnCard, pressed && s.pressed]}>
          <View style={s.earnTop}>
            <Text style={s.tileLabel}>DAILY EARNINGS</Text>
            <View style={s.earnTopRight}>
              <View style={s.liveBadge}>
                <View style={s.liveDot} />
                <Text style={s.liveText}>LIVE</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={D.sub} />
            </View>
          </View>
          <Text style={s.earnValue}>{dh(earnedToday)}</Text>
          <View style={s.chart} accessible
            accessibilityLabel={`Booked earnings, last 7 days, today ${dh(earnedToday)}`}>
            {week.map((v, i) => (
              <View key={i} style={[s.bar, {
                height: Math.max(8, Math.round((v / weekMax) * 64)),
                backgroundColor: i === 6 ? colors.accent : D.barMuted,
              }]} />
            ))}
          </View>
        </Pressable>

        {/* stat tiles */}
        <View style={s.tileRow}>
          <View style={s.tile}>
            <Text style={s.tileLabel}>TODAY</Text>
            <Text style={s.tileValue}>{todayConfirmed.length}</Text>
            <Text style={s.tileSub}>/ {capacity} slots</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>WALK-INS</Text>
            <Text style={s.tileValue}>{walkIns.length}</Text>
            <Text style={s.tileSub}>{(walkInsDH / 100).toFixed(0)} DH</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>TIPS</Text>
            <Text style={s.tileValue}>0 <Text style={s.tileSub}>DH</Text></Text>
            {/* TODO(backlog): tips need the wallet/payment rail */}
            <Text style={s.tileSub}>soon</Text>
          </View>
        </View>

        {/* action chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.chipRow}>
            <Pressable onPress={goSchedule} accessibilityRole="button" accessibilityLabel="New booking"
              style={({ pressed }) => [s.chip, s.chipPrimary, pressed && s.pressed]}>
              <Ionicons name="add" size={16} color={colors.onAccent} />
              <Text style={[s.chipText, { color: colors.onAccent }]}>New Booking</Text>
            </Pressable>
            <Pressable onPress={toggleClockOut} accessibilityRole="button" accessibilityLabel={todayOff ? 'Clock back in' : 'Clock out'}
              style={({ pressed }) => [s.chip, pressed && s.pressed]}>
              <Ionicons name="time-outline" size={16} color={D.text} />
              <Text style={s.chipText}>{todayOff ? 'Clocked out · undo' : 'Clock Out'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Inventory"
              /* TODO(backlog): product inventory */
              onPress={() => Alert.alert('Inventory', 'Coming soon — see BACKLOG.md')}
              style={({ pressed }) => [s.chip, pressed && s.pressed]}>
              <Ionicons name="cube-outline" size={16} color={D.text} />
              <Text style={s.chipText}>Inventory</Text>
            </Pressable>
          </View>
        </ScrollView>

        {/* schedule */}
        <View style={s.schedHead}>
          <Text style={s.tileLabel}>SCHEDULE • {remaining.length} REMAINING</Text>
          {remaining.length > 3 && (
            <Pressable onPress={() => setExpanded(!expanded)} hitSlop={6} accessibilityState={{ expanded }}
              accessibilityRole="button" accessibilityLabel={expanded ? 'Show fewer appointments' : `View all ${remaining.length} appointments`}
              style={({ pressed }) => pressed && s.pressed}>
              <Text style={s.viewAll}>{expanded ? 'Show less ⌄' : `View all (${remaining.length}) ›`}</Text>
            </Pressable>
          )}
        </View>
        {bookings === null && (
          <View style={s.schedCard}>
            <ActivityIndicator color={colors.accent} accessibilityLabel="Loading appointments" />
          </View>
        )}
        {bookings !== null && remaining.length === 0 && (
          <View style={s.schedCard}>
            <Text style={s.tileSub}>{todayOff ? 'Clocked out for today.' : 'Nothing left today.'}</Text>
          </View>
        )}
        {shown.map((b) => {
          const st = stageOf(b)!;
          const inChair = st === 'in_chair';
          return (
            <View key={b.id} style={[s.schedCard, inChair && s.schedCardHot]}>
              <Pressable onPress={() => setSheetClient(clientRefOf(b))}
                accessibilityRole="button" accessibilityLabel={`${nameOf(b, barberId)}, view client`} style={s.schedTop}>
                <ClientAvatar b={b} barberId={barberId} />
                <View style={s.grow}>
                  <Text style={s.schedName}>{nameOf(b, barberId)}</Text>
                  <Text style={s.schedService}>{b.services?.name ?? 'Service'}</Text>
                  <Text style={s.schedPrice}>{(b.price_cents / 100).toFixed(0)} DH</Text>
                </View>
                <View style={s.schedRight}>
                  {inChair
                    ? <View style={s.chairPill}><Text style={s.chairPillText}>In chair</Text></View>
                    : <View style={s.timeBadge}><Text style={s.timeBadgeText}>{ampm(b.starts_at)}</Text></View>}
                  {st === 'confirm' && <Text style={s.statusWait}>Awaiting confirmation</Text>}
                  {st === 'check_in' && <Text style={s.statusOk}>✓ Confirmed</Text>}
                  {st === 'start' && <Text style={s.statusHot}>Checked in</Text>}
                  {inChair && b.started_at && <Text style={s.statusHot}>● Started {ampm(b.started_at)}</Text>}
                </View>
              </Pressable>
              <View style={s.startRow}>
                {st === 'confirm' && (
                  <Pressable onPress={() => accept(b)} accessibilityRole="button" accessibilityLabel="Confirm booking"
                    style={({ pressed }) => [s.stageBtn, s.stageBtnRed, pressed && s.pressed]}>
                    <Ionicons name="checkmark" size={16} color={colors.onAccent} />
                    <Text style={s.stageTextLight}>Confirm</Text>
                  </Pressable>
                )}
                {st === 'check_in' && (
                  <Pressable onPress={() => advance(b, 'check_in')} accessibilityRole="button" accessibilityLabel="Check in"
                    style={({ pressed }) => [s.stageBtn, s.stageBtnDark, pressed && s.pressed]}>
                    <Text style={s.stageTextDark}>Check in</Text>
                  </Pressable>
                )}
                {st === 'start' && (
                  <Pressable onPress={() => advance(b, 'start')} accessibilityRole="button" accessibilityLabel="Start appointment"
                    style={({ pressed }) => [s.stageBtn, s.stageBtnRed, pressed && s.pressed]}>
                    <Ionicons name="play" size={14} color={colors.onAccent} />
                    <Text style={s.stageTextLight}>Start</Text>
                  </Pressable>
                )}
                {inChair && (
                  <Pressable onPress={() => advance(b, 'complete')} accessibilityRole="button" accessibilityLabel="Complete appointment"
                    style={({ pressed }) => [s.stageBtn, s.stageBtnGreen, pressed && s.pressed]}>
                    <Ionicons name="square-outline" size={14} color={colors.onAccent} />
                    <Text style={s.stageTextLight}>Complete</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setMenuBooking(b)} accessibilityRole="button" accessibilityLabel="More actions"
                  style={({ pressed }) => [s.moreBtn, pressed && s.pressed]}>
                  <Ionicons name="ellipsis-horizontal" size={18} color={D.text} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {/* client quick-view */}
      <ClientSheet client={sheetClient} barberId={barberId}
        onClose={() => setSheetClient(null)}
        onChat={(id, title) => openChat({ id, title })} />

      {/* … actions menu */}
      <Modal visible={!!menuBooking} transparent animationType="slide" onRequestClose={() => setMenuBooking(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setMenuBooking(null)} />
        {menuBooking && (() => {
          const b = menuBooking;
          const canNoShow = b.status === 'confirmed' && new Date(b.starts_at).getTime() <= now && !b.completed_at;
          const canCancel = !b.started_at && new Date(b.starts_at).getTime() > now;
          return (
            <View style={s.sheet} onAccessibilityEscape={() => setMenuBooking(null)}>
              <View style={s.handle} />
              <View style={s.menuHead}>
                <View style={s.grow}>
                  <Text style={s.sheetTitle}>{nameOf(b, barberId)}</Text>
                  <Text style={s.tileSub}>{ampm(b.starts_at)} • {b.services?.name ?? 'Service'}</Text>
                </View>
                <Pressable onPress={() => setMenuBooking(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"
                  style={({ pressed }) => [s.menuClose, pressed && s.pressed]}>
                  <Ionicons name="close" size={18} color={D.text} />
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
                  onPress={() => menuAction(b, 'cancel_booking')} />
              )}
            </View>
          );
        })()}
      </Modal>

      {/* reschedule */}
      <Modal visible={!!resched} transparent animationType="slide" onRequestClose={() => setResched(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setResched(null)} />
        {resched && (
          <View style={[s.sheet, s.sheetLight]} onAccessibilityEscape={() => setResched(null)}>
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

      {/* service complete — the mirror moment */}
      <Modal visible={!!completedB} transparent animationType="slide" onRequestClose={() => setCompletedB(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setCompletedB(null)} />
        {completedB && (() => {
          const b = completedB;
          const isWalkIn = b.customer_id === barberId;
          const firstName = nameOf(b, barberId).split(' ')[0];
          return (
            <View style={s.sheet} onAccessibilityEscape={() => setCompletedB(null)}>
              <View style={s.handle} />
              <View style={s.menuHead}>
                <ClientAvatar b={b} barberId={barberId} size={48} />
                <View style={s.grow}>
                  <View style={s.doneTagRow}>
                    <Ionicons name="checkmark" size={13} color={colors.success} />
                    <Text style={s.doneTag}>SERVICE COMPLETE</Text>
                  </View>
                  <Text style={s.sheetTitle}>{nameOf(b, barberId)}</Text>
                  <Text style={s.tileSub}>{b.services?.name ?? 'Service'} • {(b.price_cents / 100).toFixed(0)} DH</Text>
                </View>
                <Pressable onPress={() => setCompletedB(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"
                  style={({ pressed }) => [s.menuClose, pressed && s.pressed]}>
                  <Ionicons name="close" size={18} color={D.text} />
                </Pressable>
              </View>

              <View style={s.reviewCard}>
                <View style={s.starsRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Ionicons key={i} name="star" size={22} color={colors.star} />
                  ))}
                </View>
                <Text style={s.reviewTitle}>Ask {firstName} for a review</Text>
                <Text style={s.tileSub}>
                  {isWalkIn
                    ? "Walk-ins have no account, so they can't leave a review yet."
                    : 'Fresh-cut clients leave the best reviews — ask now.'}
                </Text>
              </View>

              {!isWalkIn && (
                <MenuRow icon="paper-plane-outline" label="Ask in chat" onPress={() => askReviewInChat(b)} />
              )}
              {!isWalkIn && b.customer?.phone && (
                <MenuRow icon="chatbox-ellipses-outline" label="Send by SMS"
                  onPress={() => { setCompletedB(null); askReviewBySms(b); }} />
              )}
            </View>
          );
        })()}
      </Modal>

      {/* booking requests sheet (bell) */}
      <Modal visible={requestsOpen} transparent animationType="slide" onRequestClose={() => setRequestsOpen(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setRequestsOpen(false)} />
        <View style={s.sheet} onAccessibilityEscape={() => setRequestsOpen(false)}>
          <Text style={s.sheetTitle}>Booking requests</Text>
          {bookings === null && <ActivityIndicator color={colors.accent} accessibilityLabel="Loading requests" />}
          {bookings !== null && requests.length === 0 && <Text style={s.tileSub}>All caught up.</Text>}
          {requests.map((b) => (
            <View key={b.id} style={s.reqRow}>
              <ClientAvatar b={b} barberId={barberId} size={40} />
              <View style={s.grow}>
                <Text style={s.schedName}>{nameOf(b, barberId)}</Text>
                <Text style={s.tileSub}>
                  {b.services?.name ?? 'Service'} · {new Date(b.starts_at).toDateString().slice(0, 10)} {ampm(b.starts_at)} · {(b.price_cents / 100).toFixed(0)} DH
                </Text>
              </View>
              <Pressable onPress={() => decline(b)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Decline"
                style={({ pressed }) => [s.reqIcon, pressed && s.pressed]}>
                <Ionicons name="close" size={18} color={colors.danger} />
              </Pressable>
              <Pressable onPress={() => accept(b)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Accept"
                style={({ pressed }) => [s.reqIcon, s.reqIconAccept, pressed && s.pressed]}>
                <Ionicons name="checkmark" size={18} color={colors.onAccent} />
              </Pressable>
            </View>
          ))}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  content: { padding: sp(5), paddingTop: sp(14), gap: sp(3), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  headName: { fontSize: font.title, fontWeight: '700', color: D.text },
  headSalon: { fontSize: font.body, fontWeight: '600', color: D.sub },
  headDate: { fontSize: font.small, color: D.sub, marginTop: 2 },
  circleBtn: {
    width: 42, height: 42, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute', top: 9, right: 10, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.accent, borderWidth: 1.5, borderColor: D.card2,
  },
  headAvatar: { width: 42, height: 42, borderRadius: radius.pill, borderWidth: 2, borderColor: D.card2 },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: font.small, fontWeight: '700', color: colors.accent },

  earnCard: { backgroundColor: D.card, borderRadius: radius.lg, padding: sp(4), gap: sp(2) },
  earnTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  earnTopRight: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  tileLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(232,71,79,0.15)',
    borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: sp(2),
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  liveText: { fontSize: font.tiny, fontWeight: '800', color: colors.accent, letterSpacing: 0.5 },
  earnValue: { fontSize: 34, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: sp(2), height: 64, marginTop: sp(1) },
  bar: { flex: 1, borderRadius: 4 },

  tileRow: { flexDirection: 'row', gap: sp(2.5) },
  tile: { flex: 1, backgroundColor: D.card, borderRadius: radius.lg, padding: sp(3.5), gap: 3 },
  tileValue: { fontSize: 22, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  tileSub: { fontSize: font.small, color: D.sub },

  chipRow: { flexDirection: 'row', gap: sp(2.5) },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: sp(1.5), minHeight: 44,
    paddingHorizontal: sp(4), borderRadius: radius.pill, backgroundColor: D.card,
    borderWidth: 1, borderColor: D.border,
  },
  chipPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: font.small, fontWeight: '700', color: D.text },

  schedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: sp(1) },
  viewAll: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  schedCard: { backgroundColor: D.card, borderRadius: radius.lg, padding: sp(4), gap: sp(3) },
  schedTop: { flexDirection: 'row', gap: sp(3) },
  schedName: { fontSize: font.body, fontWeight: '700', color: D.text },
  schedService: { fontSize: font.small, color: D.sub, marginTop: 1 },
  schedPrice: { fontSize: font.small, fontWeight: '700', color: D.text, marginTop: 3, fontVariant: ['tabular-nums'] },
  schedRight: { alignItems: 'flex-end', gap: sp(2) },
  timeBadge: { backgroundColor: D.card2, borderRadius: radius.sm, paddingVertical: 3, paddingHorizontal: sp(2) },
  timeBadgeText: { fontSize: font.tiny, fontWeight: '700', color: colors.accent },
  statusHot: { fontSize: font.small, fontWeight: '600', color: colors.accent },
  statusOk: { fontSize: font.small, color: D.sub },
  startRow: { flexDirection: 'row', gap: sp(2.5) },
  startBtn: {
    flex: 1, height: 44, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  startText: { fontSize: font.body, fontWeight: '700', color: colors.onAccent },
  moreBtn: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: D.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: sp(5), paddingBottom: sp(10), gap: sp(3),
  },
  sheetTitle: { fontSize: font.h2, fontWeight: '700', color: D.text },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  reqIcon: {
    width: 40, height: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },
  reqIconAccept: { backgroundColor: colors.success, borderColor: colors.success },

  // stage cards
  schedCardHot: { borderWidth: 1.5, borderColor: colors.accent },
  chairPill: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingVertical: 3, paddingHorizontal: sp(2) },
  chairPillText: { fontSize: font.tiny, fontWeight: '800', color: colors.onAccent },
  statusWait: { fontSize: font.small, fontWeight: '600', color: '#E8B84B' },
  stageBtn: {
    flex: 1, height: 44, borderRadius: radius.pill, flexDirection: 'row', gap: sp(1.5),
    alignItems: 'center', justifyContent: 'center',
  },
  stageBtnRed: { backgroundColor: colors.accent },
  stageBtnGreen: { backgroundColor: colors.success },
  stageBtnDark: { backgroundColor: D.card2, borderWidth: 1, borderColor: D.border },
  stageTextLight: { fontSize: font.body, fontWeight: '700', color: colors.onAccent },
  stageTextDark: { fontSize: font.body, fontWeight: '700', color: D.text },

  // menu / completion sheets
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: D.border, marginBottom: sp(2) },
  menuHead: { flexDirection: 'row', alignItems: 'center', gap: sp(3), marginBottom: sp(1) },
  menuClose: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3.5), paddingVertical: sp(3) },
  menuRowIcon: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  menuRowLabel: { flex: 1, fontSize: font.body, fontWeight: '700', color: D.text },
  sheetLight: { backgroundColor: colors.bg },
  sheetTitleLight: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  doneTagRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  doneTag: { fontSize: font.tiny, fontWeight: '800', color: colors.success, letterSpacing: 1 },
  reviewCard: { backgroundColor: D.card2, borderRadius: radius.lg, padding: sp(4), gap: sp(2) },
  starsRow: { flexDirection: 'row', gap: sp(1) },
  reviewTitle: { fontSize: font.body, fontWeight: '700', color: D.text },
});
