import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { TAB_BAR_INSET } from '../components/ui';
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
  services: { name: string } | null;
  customer: { full_name: string | null; avatar_url: string | null } | null;
};

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

export default function BookingsScreen({ barber, profile, phone, onProfileChanged, onChromeHidden, goSchedule }: {
  barber: Barber;
  profile: Profile;
  phone: string | null;
  onProfileChanged: () => void;
  onChromeHidden?: (hidden: boolean) => void;
  goSchedule: () => void;
}) {
  const barberId = barber.id;
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<{ id: string; day: string }[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [salonName, setSalonName] = useState<string | null>(null);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [chat, setChat] = useState<BookingRow | null>(null);
  const [showProfile, setShowProfile] = useState(false);
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
      .select('id, starts_at, ends_at, status, price_cents, walk_in_name, customer_id, services(name), customer:profiles!customer_id(full_name, avatar_url)')
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

  function openChat(row: BookingRow | null) {
    setChat(row);
    onChromeHidden?.(!!row);
  }

  function openEarnings(v: boolean) {
    setShowEarnings(v);
    onChromeHidden?.(v);
  }

  function openProfile(v: boolean) {
    setShowProfile(v);
    onChromeHidden?.(v);
  }

  function bookingMenu(b: BookingRow) {
    Alert.alert(nameOf(b, barberId), `${b.services?.name ?? 'Service'} · ${ampm(b.starts_at)}`, [
      ...(b.customer_id !== barberId ? [{ text: 'Chat', onPress: () => openChat(b) }] : []),
      {
        text: 'Cancel booking', style: 'destructive' as const,
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_booking', { p_booking: b.id });
          if (error) Alert.alert('Could not cancel', error.message);
          else load();
        },
      },
      { text: 'Close', style: 'cancel' as const },
    ]);
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
      title={chat.customer?.full_name ?? 'Customer'} onBack={() => openChat(null)} />;
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
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
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

  const requests = bookings.filter((b) => b.status === 'pending' && new Date(b.starts_at).getTime() > now);
  const remaining = todayConfirmed
    .filter((b) => new Date(b.ends_at).getTime() > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

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
          <Pressable onPress={() => setRequestsOpen(true)} accessibilityLabel={`Booking requests, ${requests.length} waiting`}
            style={({ pressed }) => [s.circleBtn, pressed && s.pressed]}>
            <Ionicons name="notifications-outline" size={20} color={D.text} />
            {requests.length > 0 && <View style={s.bellDot} />}
          </Pressable>
          <Pressable onPress={() => openProfile(true)} accessibilityLabel="Your profile"
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
        <Pressable onPress={() => openEarnings(true)} accessibilityLabel="Earnings details"
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
          <View style={s.chart}
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
            <Pressable onPress={goSchedule} accessibilityLabel="New booking"
              style={({ pressed }) => [s.chip, s.chipPrimary, pressed && s.pressed]}>
              <Ionicons name="add" size={16} color={colors.onAccent} />
              <Text style={[s.chipText, { color: colors.onAccent }]}>New Booking</Text>
            </Pressable>
            <Pressable onPress={toggleClockOut} accessibilityLabel={todayOff ? 'Clock back in' : 'Clock out'}
              style={({ pressed }) => [s.chip, pressed && s.pressed]}>
              <Ionicons name="time-outline" size={16} color={D.text} />
              <Text style={s.chipText}>{todayOff ? 'Clocked out · undo' : 'Clock Out'}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Inventory"
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
          <Pressable onPress={goSchedule} hitSlop={6} style={({ pressed }) => pressed && s.pressed}>
            <Text style={s.viewAll}>View all</Text>
          </Pressable>
        </View>
        {remaining.length === 0 && (
          <View style={s.schedCard}>
            <Text style={s.tileSub}>{todayOff ? 'Clocked out for today.' : 'Nothing left today.'}</Text>
          </View>
        )}
        {remaining.map((b, i) => {
          const inProgress = new Date(b.starts_at).getTime() <= now;
          const first = i === 0;
          return (
            <View key={b.id} style={s.schedCard}>
              <View style={s.schedTop}>
                <ClientAvatar b={b} barberId={barberId} />
                <View style={s.grow}>
                  <Text style={s.schedName}>{nameOf(b, barberId)}</Text>
                  <Text style={s.schedService}>{b.services?.name ?? 'Service'}</Text>
                  <Text style={s.schedPrice}>{(b.price_cents / 100).toFixed(0)} DH</Text>
                </View>
                <View style={s.schedRight}>
                  <View style={s.timeBadge}><Text style={s.timeBadgeText}>{ampm(b.starts_at)}</Text></View>
                  {first
                    ? <Text style={s.statusHot}>{inProgress ? 'In progress' : 'Up next'}</Text>
                    : <Text style={s.statusOk}>✓ Confirmed</Text>}
                </View>
              </View>
              {first && (
                <View style={s.startRow}>
                  <Pressable accessibilityLabel="Start appointment"
                    /* TODO(backlog): check-in / service timer flow */
                    onPress={() => Alert.alert('Start', 'Check-in & service timer coming soon — see BACKLOG.md')}
                    style={({ pressed }) => [s.startBtn, pressed && s.pressed]}>
                    <Text style={s.startText}>Start</Text>
                  </Pressable>
                  <Pressable onPress={() => bookingMenu(b)} accessibilityLabel="More actions"
                    style={({ pressed }) => [s.moreBtn, pressed && s.pressed]}>
                    <Ionicons name="ellipsis-horizontal" size={18} color={D.text} />
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* booking requests sheet (bell) */}
      <Modal visible={requestsOpen} transparent animationType="slide" onRequestClose={() => setRequestsOpen(false)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setRequestsOpen(false)} />
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>Booking requests</Text>
          {requests.length === 0 && <Text style={s.tileSub}>All caught up.</Text>}
          {requests.map((b) => (
            <View key={b.id} style={s.reqRow}>
              <ClientAvatar b={b} barberId={barberId} size={40} />
              <View style={s.grow}>
                <Text style={s.schedName}>{nameOf(b, barberId)}</Text>
                <Text style={s.tileSub}>
                  {b.services?.name ?? 'Service'} · {new Date(b.starts_at).toDateString().slice(0, 10)} {ampm(b.starts_at)} · {(b.price_cents / 100).toFixed(0)} DH
                </Text>
              </View>
              <Pressable onPress={() => decline(b)} hitSlop={6} accessibilityLabel="Decline"
                style={({ pressed }) => [s.reqIcon, pressed && s.pressed]}>
                <Ionicons name="close" size={18} color={colors.danger} />
              </Pressable>
              <Pressable onPress={() => accept(b)} hitSlop={6} accessibilityLabel="Accept"
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
});
