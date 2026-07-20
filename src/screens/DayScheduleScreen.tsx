import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import SlotPicker from '../components/SlotPicker';
import { Field, PillButton } from '../components/ui';
import { takeLastFix } from '../lib/lastFix';
import { Block, dayStatus, DayState, daySlots, sameDay, Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';
import ChatScreen from './ChatScreen';

const STEP = 30;

type Service = { id: string; name: string; price_cents: number; duration_min: number };
type BlockRow = Block & { id: string; label: string | null };
type DayBooking = {
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
type Hist = Record<string, { visits: number; noShows: number }>;

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function upcomingDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
}

const nameOf = (b: DayBooking, barberId: string) =>
  b.walk_in_name ?? (b.customer_id === barberId ? 'Walk-in' : b.customer?.full_name ?? 'Client');

const initialsOf = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// reliability: 5★ minus each past no-show; null = new client (no history)
function reliabilityOf(customerId: string, hist: Hist): number | null {
  const h = hist[customerId];
  if (!h || (h.visits === 0 && h.noShows === 0)) return null;
  return Math.max(1, 5 - h.noShows);
}

function Avatar({ url, name, size = 44 }: { url?: string | null; name: string; size?: number }) {
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 999 }} />;
  return (
    <View style={[s.avatarFallback, { width: size, height: size, borderRadius: 999 }]}>
      <Text style={[s.avatarText, size >= 44 && { fontSize: font.body }]}>{initialsOf(name)}</Text>
    </View>
  );
}

function RelStars({ n }: { n: number }) {
  return (
    <View style={s.relRow} accessible accessibilityLabel={`${n} of 5 reliability stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name="star" size={11} color={i <= n ? colors.star : D.border} />
      ))}
    </View>
  );
}

function StatusBadge({ state, count }: { state: DayState; count: number }) {
  if (state === 'closed') return null;
  if (state === 'empty') return <View style={s.badgeHollow} />;
  if (state === 'full') {
    return (
      <View style={[s.badge, { backgroundColor: colors.success }]}>
        <Ionicons name="checkmark" size={9} color={colors.onAccent} />
      </View>
    );
  }
  return (
    <View style={[s.badge, { backgroundColor: colors.warning }]}>
      <Text style={s.badgeText}>{count}</Text>
    </View>
  );
}

export default function DayScheduleScreen({ barberId, onBack, autoAddNow, prefillName, prefillServiceId, preferMin }: {
  barberId: string;
  onBack: () => void;
  autoAddNow?: boolean;    // open the add sheet at today's next free slot on arrival
  prefillName?: string;    // client name prefilled in the add sheet (quick add → existing client)
  prefillServiceId?: string; // client's usual service — listed first with a USUAL tag
  preferMin?: number;      // client's usual time — auto-open at the nearest free slot
}) {
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [bufferMin, setBufferMin] = useState(0);
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [allBookings, setAllBookings] = useState<DayBooking[]>([]);
  const [history, setHistory] = useState<Hist>({});
  const [services, setServices] = useState<Service[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [sheetBooking, setSheetBooking] = useState<DayBooking | null>(null);
  const [reschedule, setReschedule] = useState<DayBooking | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState<Date | null>(null);
  const [addAt, setAddAt] = useState<Date | null>(null);
  const [walkInName, setWalkInName] = useState(prefillName ?? '');
  const [usualServiceId, setUsualServiceId] = useState(prefillServiceId ?? null);
  const [addBusy, setAddBusy] = useState(false);
  const [chat, setChat] = useState<DayBooking | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now()); // ticks so "late"/"over" counters advance while open
  const didAutoAdd = useRef(false);

  const scrollRef = useRef<ScrollView>(null);
  const timelineY = useRef(0);
  const rowY = useRef<Record<string, number>>({});

  // blocks touched by the last schedule fix pulse once on arrival
  const [glowIds] = useState<string[]>(() => takeLastFix());
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!glowIds.length) return;
    // fresh timing nodes per pulse — composed animations are single-use
    const pulse = () => Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]);
    Animated.sequence([pulse(), pulse(), pulse()]).start();
  }, [glowIds]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const strip = upcomingDays(14);

  const load = useCallback(async () => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from.getTime() + 14 * 86_400_000);
    const [bk, av, off, blk, sv, buf] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, ends_at, status, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name, avatar_url, phone)')
        .eq('barber_id', barberId)
        .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
        .in('status', ['pending', 'confirmed', 'no_show'])
        .order('starts_at'),
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
      supabase.from('days_off').select('day').eq('barber_id', barberId).gte('day', isoOf(new Date())),
      supabase.from('time_blocks').select('id, label, day, start_min, end_min').eq('barber_id', barberId),
      supabase.from('services').select('id, name, price_cents, duration_min')
        .eq('barber_id', barberId).eq('is_active', true).order('name'),
      supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', barberId).single(),
    ]);
    if (bk.error) Alert.alert('Could not load bookings', bk.error.message);
    else setAllBookings(bk.data as unknown as DayBooking[]);
    setWindows(av.data ?? []);
    setDaysOff((off.data ?? []).map((d) => d.day));
    setBlocks((blk.data ?? []) as BlockRow[]);
    setServices(sv.data ?? []);
    if (buf.data) setBufferMin(buf.data.buffer_before_min + buf.data.buffer_after_min);
    setLoaded(true);
  }, [barberId]);

  useEffect(() => {
    load();
    // client reputation: past attended vs no-shows, per customer (walk-ins excluded)
    supabase.from('bookings').select('customer_id, status')
      .eq('barber_id', barberId).in('status', ['confirmed', 'no_show'])
      .lt('ends_at', new Date().toISOString())
      .then(({ data }) => {
        const h: Hist = {};
        for (const b of data ?? []) {
          if (b.customer_id === barberId) continue;
          const e = (h[b.customer_id] ??= { visits: 0, noShows: 0 });
          if (b.status === 'no_show') e.noShows++; else e.visits++;
        }
        setHistory(h);
      });
  }, [barberId]);

  // quick add: "start now" jumps to today's next free slot; a picked client jumps
  // to the free slot nearest their usual time ('free' already excludes past ticks)
  useEffect(() => {
    if ((!autoAddNow && preferMin == null) || didAutoAdd.current || !loaded) return;
    didAutoAdd.current = true;
    const today = new Date();
    const live = allBookings.filter((b) => b.status !== 'no_show' && sameDay(new Date(b.starts_at), today));
    const free = daySlots(today, STEP, windows, live, daysOff, blocks, bufferMin)
      .filter((sl) => sl.status === 'free');
    if (!free.length) return Alert.alert('No free slot today', 'Pick a slot on the timeline yourself.');
    const minOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
    const pick = preferMin == null ? free[0]
      : free.reduce((a, b) => (Math.abs(minOf(b.time) - preferMin) < Math.abs(minOf(a.time) - preferMin) ? b : a));
    setAddAt(pick.time);
  }, [loaded]);

  async function addWalkIn(service: Service) {
    if (!addAt) return;
    setAddBusy(true);
    const { error } = await supabase.from('bookings').insert({
      customer_id: barberId, barber_id: barberId, service_id: service.id,
      starts_at: addAt.toISOString(), walk_in_name: walkInName.trim() || null,
    });
    setAddBusy(false);
    if (error) {
      const msg = error.message.includes('no_double_booking')
        ? 'That time overlaps another booking.' : error.message;
      return Alert.alert('Could not add', msg);
    }
    setAddAt(null); setWalkInName(''); setUsualServiceId(null); // habits apply to the first add only
    load();
  }

  async function rpcAndReload(rpc: string, booking: string, errTitle: string) {
    const { error } = await supabase.rpc(rpc, { p_booking: booking });
    if (error) Alert.alert(errTitle, error.message);
    setSheetBooking(null);
    load();
  }

  async function confirmReschedule() {
    if (!reschedule || !rescheduleAt) return;
    const { error } = await supabase.rpc('reschedule_booking', {
      p_booking: reschedule.id, p_new_start: rescheduleAt.toISOString(),
    });
    if (error) Alert.alert('Could not reschedule', error.message);
    setReschedule(null); setRescheduleAt(null);
    load();
  }

  function openChat(b: DayBooking | null) {
    setSheetBooking(null);
    setChat(b);
  }

  function goToClient(b: DayBooking) {
    setHighlightId(b.id);
    const y = timelineY.current + (rowY.current[b.id] ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
  }

  if (chat) {
    return <ChatScreen bookingId={chat.id} myId={barberId}
      title={chat.customer?.full_name ?? 'Customer'} onBack={() => openChat(null)} />;
  }

  // per-day status for the strip badges (no-shows don't hold a slot)
  const byDay = new Map<string, DayBooking[]>();
  for (const b of allBookings) {
    if (b.status === 'no_show') continue;
    const key = isoOf(new Date(b.starts_at));
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(b);
  }

  const dayAll = allBookings.filter((b) => sameDay(new Date(b.starts_at), selectedDay));
  const dayLive = dayAll.filter((b) => b.status !== 'no_show');
  const dayBlocks = blocks.filter((b) => b.day === null || b.day === isoOf(selectedDay));
  const freeTicks = daySlots(selectedDay, STEP, windows, dayLive, daysOff, blocks, bufferMin)
    .filter((sl) => sl.status === 'free')
    .map((sl) => sl.time);
  const midnight = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate());
  const timeline = [
    ...dayAll.map((b) => ({ at: new Date(b.starts_at), booking: b as DayBooking | null, block: null as BlockRow | null })),
    ...freeTicks.map((t) => ({ at: t, booking: null as DayBooking | null, block: null as BlockRow | null })),
    ...dayBlocks.map((b) => ({
      at: new Date(midnight.getTime() + b.start_min * 60_000),
      booking: null as DayBooking | null, block: b,
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const isDayOff = daysOff.includes(isoOf(selectedDay));
  const worksThisDay = windows.some((w) => w.weekday === selectedDay.getDay());

  return (
    <View style={s.screen}>
      <ScrollView ref={scrollRef} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.head}>
          <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back"
            style={({ pressed }) => [s.circleBtn, pressed && s.pressed]}>
            <Ionicons name="chevron-back" size={20} color={D.text} />
          </Pressable>
          <Text style={s.headTitle}>MY DAY</Text>
          <View style={s.circleBtn} />
        </View>

        {/* day strip with busyness badges */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.strip}>
            {strip.map((d) => {
              const st = dayStatus(d, windows, byDay.get(isoOf(d)) ?? [], daysOff, blocks, bufferMin);
              const sel = sameDay(d, selectedDay);
              const fill = st.state === 'partial' ? s.fillPartial
                : st.state === 'full' ? s.fillFull
                : st.state === 'empty' ? s.fillEmpty : s.fillClosed;
              const muted = st.state === 'closed';
              return (
                <Pressable key={d.toDateString()} onPress={() => setSelectedDay(d)}
                  accessibilityRole="button" accessibilityLabel={`${d.toDateString()}, ${st.state}${st.state === 'partial' ? `, ${st.count} booked` : ''}`}
                  accessibilityState={{ selected: sel }}
                  style={({ pressed }) => [s.dayCell, fill, sel && s.dayCellSel, pressed && s.pressed]}>
                  <StatusBadge state={st.state} count={st.count} />
                  <Text style={[s.dayCellWk, muted && s.textMuted]}>{d.toDateString().slice(0, 3)}</Text>
                  <Text style={[s.dayCellNum, muted && s.textMuted]}>{d.getDate()}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* clients of the day (first → last), tap to jump to their slot */}
        {dayLive.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.clientRow}>
            {dayLive.map((b) => {
              const isWalkIn = b.customer_id === barberId;
              const stars = isWalkIn ? null : reliabilityOf(b.customer_id, history);
              return (
                <Pressable key={b.id} onPress={() => goToClient(b)}
                  accessibilityRole="button" accessibilityLabel={`${nameOf(b, barberId)} at ${hhmm(b.starts_at)}`}
                  style={({ pressed }) => [s.clientCard, highlightId === b.id && s.clientCardActive, pressed && s.pressed]}>
                  <Avatar url={isWalkIn ? null : b.customer?.avatar_url} name={nameOf(b, barberId)} />
                  <Text style={s.clientName} numberOfLines={1}>{nameOf(b, barberId)}</Text>
                  {isWalkIn ? <Text style={s.clientTag}>Walk-in</Text>
                    : stars != null ? <RelStars n={stars} />
                    : <Text style={s.clientTag}>New</Text>}
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        {/* timeline */}
        <View style={s.timeline} onLayout={(e) => { timelineY.current = e.nativeEvent.layout.y; }}>
          {isDayOff && <Text style={s.note}>Day off — the shop is closed.</Text>}
          {!isDayOff && !worksThisDay && <Text style={s.note}>Not working this day (edit hours in the Calendar tab).</Text>}
          {!isDayOff && worksThisDay && timeline.length === 0 && <Text style={s.note}>The day is over.</Text>}
          {!isDayOff && timeline.map((item) => {
            if (item.block) {
              return (
                <View key={`blk-${item.block.id}`} style={s.slotBlock}>
                  {glowIds.includes(item.block.id) && (
                    <Animated.View pointerEvents="none"
                      style={[StyleSheet.absoluteFillObject, s.glowOverlay, { opacity: glow }]} />
                  )}
                  <Ionicons name={item.block.day === null ? 'cafe-outline' : 'time-outline'} size={15} color={D.sub} />
                  <Text style={s.slotBlockText}>
                    {item.block.label ?? 'Blocked'} · {minToHHMM(item.block.start_min)}–{minToHHMM(item.block.end_min)}
                  </Text>
                  {glowIds.includes(item.block.id) && <Text style={s.glowTag}>updated</Text>}
                </View>
              );
            }
            if (item.booking) {
              const b = item.booking;
              const pending = b.status === 'pending';
              const expired = pending && new Date(b.starts_at).getTime() <= Date.now();
              const done = !!b.completed_at;
              const inChair = !!b.started_at && !done;
              const checkedIn = !!b.checked_in_at && !b.started_at;
              // late = confirmed slot whose start passed but nobody's in the chair;
              // over = a cut running past its scheduled end. Both put the next client at risk.
              const lateMin = !pending && b.status !== 'no_show' && !done && !b.started_at
                ? Math.floor((now - new Date(b.starts_at).getTime()) / 60_000) : 0;
              const overMin = inChair
                ? Math.floor((now - new Date(b.ends_at).getTime()) / 60_000) : 0;
              const lateLabel = overMin > 0 ? `${overMin} min over` : lateMin > 0 ? `${lateMin} min late` : null;
              return (
                <Pressable key={b.id}
                  onLayout={(e) => { rowY.current[b.id] = e.nativeEvent.layout.y; }}
                  onPress={() => setSheetBooking(b)}
                  accessibilityRole="button" accessibilityLabel={`${pending ? 'Request' : 'Booking'} at ${hhmm(b.starts_at)}`}
                  style={({ pressed }) => [
                    s.slotBooked, pending && s.slotPending,
                    highlightId === b.id && s.slotHighlight, pressed && s.pressed,
                  ]}>
                  <View style={[s.slotBar,
                    b.status === 'no_show' && s.slotBarNoShow,
                    pending && s.slotBarPending,
                    done && s.slotBarDone,
                    lateLabel && s.slotBarLate]} />
                  <View style={s.grow}>
                    <Text style={[s.slotName, (b.status === 'no_show' || expired) && s.struck]}>
                      {nameOf(b, barberId)}
                    </Text>
                    <Text style={s.slotMeta}>
                      {hhmm(b.starts_at)}–{hhmm(b.ends_at)} · {b.services?.name ?? 'Service'}
                      {b.status === 'no_show' ? ' · no-show' : expired ? ' · request expired' : pending ? ' · PENDING' : done ? ' · completed ✓' : inChair ? ' · in chair' : checkedIn ? ' · checked in' : ''}
                      {lateLabel && <Text style={s.lateTag}> · {lateLabel}</Text>}
                    </Text>
                  </View>
                  <Text style={s.slotPrice}>{(b.price_cents / 100).toFixed(0)} DH</Text>
                </Pressable>
              );
            }
            return (
              <Pressable key={item.at.getTime()} onPress={() => setAddAt(item.at)}
                accessibilityRole="button" accessibilityLabel={`Add booking at ${item.at.toTimeString().slice(0, 5)}`}
                style={({ pressed }) => [s.slotFree, pressed && s.pressed]}>
                <Ionicons name="add" size={16} color={colors.accent} />
                <Text style={s.slotFreeText}>{item.at.toTimeString().slice(0, 5)}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* client profile panel */}
      <Modal visible={!!sheetBooking} transparent animationType="slide" onRequestClose={() => setSheetBooking(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setSheetBooking(null)} />
        {sheetBooking && (() => {
          const b = sheetBooking;
          const isWalkIn = b.customer_id === barberId;
          const started = new Date(b.starts_at).getTime() <= Date.now();
          const pending = b.status === 'pending';
          const done = !!b.completed_at;
          const inChair = !!b.started_at && !done;
          const stars = !isWalkIn ? reliabilityOf(b.customer_id, history) : null;
          const visits = !isWalkIn ? (history[b.customer_id]?.visits ?? 0) : 0;
          const phone = b.customer?.phone;
          return (
            <View style={s.sheet} onAccessibilityEscape={() => setSheetBooking(null)}>
              <View style={s.panelHead}>
                <Avatar url={isWalkIn ? null : b.customer?.avatar_url} name={nameOf(b, barberId)} size={56} />
                <View style={s.grow}>
                  <Text style={s.panelName}>{nameOf(b, barberId)}</Text>
                  {isWalkIn ? <Text style={s.clientTag}>Walk-in (no account)</Text>
                    : stars != null ? <RelStars n={stars} />
                    : <Text style={s.clientTag}>New client</Text>}
                  {!isWalkIn && (
                    <Text style={s.panelMeta}>
                      {visits === 0 ? 'First visit with you' : `${visits} previous visit${visits === 1 ? '' : 's'} with you`}
                    </Text>
                  )}
                </View>
                {pending && !started && <View style={s.pendingPill}><Text style={s.pendingPillText}>PENDING</Text></View>}
              </View>
              <Text style={s.panelBooking}>
                {b.services?.name ?? 'Service'} · {hhmm(b.starts_at)}–{hhmm(b.ends_at)} · {(b.price_cents / 100).toFixed(0)} DH
                {b.status === 'no_show' ? ' · no-show' : done ? ` · completed ${hhmm(b.completed_at!)}` : ''}
              </Text>

              {pending && !started ? (
                <View style={s.panelActions}>
                  <PanelBtn icon="checkmark-circle-outline" label="Accept"
                    onPress={() => rpcAndReload('accept_booking', b.id, 'Could not accept')} />
                  <PanelBtn icon="swap-horizontal-outline" label="Reschedule"
                    onPress={() => { setSheetBooking(null); setReschedule(b); setRescheduleAt(null); }} />
                  {!isWalkIn && <PanelBtn icon="chatbubble-ellipses-outline" label="Chat" onPress={() => openChat(b)} />}
                  <PanelBtn danger icon="close-circle-outline" label="Decline"
                    onPress={() => rpcAndReload('cancel_booking', b.id, 'Could not decline')} />
                </View>
              ) : (
                <View style={s.panelActions}>
                  {!isWalkIn && phone && (
                    <PanelBtn icon="call-outline" label="Call" onPress={() => Linking.openURL(`tel:${phone}`)} />
                  )}
                  {!isWalkIn && (
                    <PanelBtn icon="chatbubble-ellipses-outline" label="Chat" onPress={() => openChat(b)} />
                  )}
                  {inChair && (
                    <PanelBtn icon="checkbox-outline" label="Complete"
                      onPress={async () => {
                        const { error } = await supabase.rpc('advance_booking', { p_booking: b.id, p_stage: 'complete' });
                        if (error) Alert.alert('Could not complete', error.message);
                        setSheetBooking(null); load();
                      }} />
                  )}
                  {!done && !inChair && b.status !== 'no_show' && (!started || !isWalkIn) && (
                    <PanelBtn danger icon={started ? 'close-circle-outline' : 'trash-outline'}
                      label={started ? 'No-show' : isWalkIn ? 'Remove' : 'Cancel'}
                      onPress={() => rpcAndReload(started ? 'mark_no_show' : 'cancel_booking', b.id, 'Could not update')} />
                  )}
                </View>
              )}
            </View>
          );
        })()}
      </Modal>

      {/* reschedule sheet */}
      <Modal visible={!!reschedule} transparent animationType="slide"
        onRequestClose={() => setReschedule(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setReschedule(null)} />
        {reschedule && (
          <View style={[s.sheet, s.sheetLight]} onAccessibilityEscape={() => setReschedule(null)}>
            <Text style={s.sheetTitleLight}>
              Move {nameOf(reschedule, barberId)} · {(new Date(reschedule.ends_at).getTime() - new Date(reschedule.starts_at).getTime()) / 60_000} min
            </Text>
            {/* ponytail: SlotPicker is light-themed; lives on a light sheet until a dark variant matters */}
            <SlotPicker barberId={barberId}
              durationMin={(new Date(reschedule.ends_at).getTime() - new Date(reschedule.starts_at).getTime()) / 60_000}
              selected={rescheduleAt} onSelect={setRescheduleAt} />
            <PillButton title={rescheduleAt ? `Move to ${rescheduleAt.toTimeString().slice(0, 5)}` : 'Pick a new time'}
              disabled={!rescheduleAt} onPress={confirmReschedule} />
          </View>
        )}
      </Modal>

      {/* add walk-in sheet */}
      <Modal visible={!!addAt} transparent animationType="slide" onRequestClose={() => setAddAt(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.sheetBackdrop} onPress={() => setAddAt(null)} />
        <View style={s.sheet} onAccessibilityEscape={() => setAddAt(null)}>
          <Text style={s.sheetTitle}>
            New booking · {addAt ? `${addAt.toDateString().slice(0, 10)}, ${addAt.toTimeString().slice(0, 5)}` : ''}
          </Text>
          <Field placeholder="Client name (optional — shows as Walk-in)" placeholderTextColor={D.sub}
            style={s.darkField} value={walkInName} onChangeText={setWalkInName} />
          <Text style={s.sheetLabel}>Service</Text>
          {services.length === 0 && <Text style={s.note}>Add a service first (Profile → My Services).</Text>}
          {[...services].sort((a, b) => Number(b.id === usualServiceId) - Number(a.id === usualServiceId)).map((sv) => (
            <Pressable key={sv.id} disabled={addBusy} onPress={() => addWalkIn(sv)}
              accessibilityRole="button"
              accessibilityLabel={`${sv.name}, ${sv.duration_min} min, ${(sv.price_cents / 100).toFixed(0)} DH${sv.id === usualServiceId ? ', their usual' : ''}`}
              style={({ pressed }) => [s.svcRow, sv.id === usualServiceId && s.svcRowUsual, pressed && s.pressed]}>
              <View style={s.grow}>
                <View style={s.svcNameRow}>
                  <Text style={s.slotName}>{sv.name}</Text>
                  {sv.id === usualServiceId && <View style={s.usualTag}><Text style={s.usualTagText}>USUAL</Text></View>}
                </View>
                <Text style={s.slotMeta}>{sv.duration_min} min</Text>
              </View>
              <Text style={s.slotPrice}>{(sv.price_cents / 100).toFixed(0)} DH</Text>
            </Pressable>
          ))}
        </View>
      </Modal>
    </View>
  );
}

function PanelBtn({ icon, label, onPress, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.panelBtn, pressed && s.pressed]}>
      <View style={[s.panelBtnIcon, danger && s.panelBtnIconDanger]}>
        <Ionicons name={icon} size={20} color={danger ? colors.danger : D.text} />
      </View>
      <Text style={[s.panelBtnLabel, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  content: { padding: sp(5), paddingTop: sp(14), gap: sp(3), paddingBottom: sp(10) },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  note: { color: D.sub, fontSize: font.small, paddingVertical: sp(2) },

  head: { flexDirection: 'row', alignItems: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: D.text, letterSpacing: 1 },
  circleBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  relRow: { flexDirection: 'row', gap: 1 },

  strip: { flexDirection: 'row', gap: sp(2), paddingVertical: sp(1) },
  dayCell: {
    width: 52, paddingVertical: sp(2), borderRadius: radius.md, alignItems: 'center', gap: 2,
    borderWidth: 2, borderColor: 'transparent',
  },
  dayCellSel: { borderColor: colors.accent },
  fillEmpty: { backgroundColor: D.card },
  fillPartial: { backgroundColor: 'rgba(154,107,0,0.25)' },
  fillFull: { backgroundColor: 'rgba(30,142,79,0.28)' },
  fillClosed: { backgroundColor: D.bg, borderColor: D.border },
  dayCellWk: { fontSize: font.tiny, fontWeight: '600', color: D.sub },
  dayCellNum: { fontSize: font.body, fontWeight: '700', color: D.text },
  textMuted: { color: D.border },

  badge: {
    position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16, borderRadius: 8,
    paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: D.bg,
  },
  badgeText: { fontSize: 9, fontWeight: '800', color: colors.onAccent },
  badgeHollow: {
    position: 'absolute', top: -6, right: -6, width: 14, height: 14, borderRadius: 7,
    borderWidth: 1.5, borderColor: D.sub, backgroundColor: D.bg,
  },

  clientRow: { flexDirection: 'row', gap: sp(3) },
  clientCard: {
    width: 92, alignItems: 'center', gap: sp(1.5), padding: sp(2.5),
    borderRadius: radius.md, backgroundColor: D.card, borderWidth: 2, borderColor: 'transparent',
  },
  clientCardActive: { borderColor: colors.accent },
  clientName: { fontSize: font.small, fontWeight: '700', color: D.text, maxWidth: '100%' },
  clientTag: { fontSize: font.tiny, fontWeight: '600', color: D.sub },

  timeline: { gap: sp(2) },
  slotBooked: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    borderRadius: radius.md, padding: sp(3), backgroundColor: D.card,
    borderWidth: 2, borderColor: 'transparent',
  },
  slotPending: { backgroundColor: 'rgba(154,107,0,0.16)' },
  slotHighlight: { borderColor: colors.accent },
  slotBar: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.accent },
  slotBarNoShow: { backgroundColor: D.border },
  slotBarPending: { backgroundColor: colors.warning },
  slotBarDone: { backgroundColor: colors.success },
  slotBarLate: { backgroundColor: colors.danger },
  slotName: { fontSize: font.body, fontWeight: '700', color: D.text },
  struck: { textDecorationLine: 'line-through', color: D.sub },
  slotMeta: { fontSize: font.small, color: D.sub },
  lateTag: { color: colors.danger, fontWeight: '700' },
  slotPrice: { fontSize: font.small, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  slotFree: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    borderWidth: 1, borderColor: D.border, borderStyle: 'dashed', borderRadius: radius.md,
    paddingVertical: sp(2.5), paddingHorizontal: sp(3),
  },
  slotFreeText: { fontSize: font.small, fontWeight: '600', color: D.sub, fontVariant: ['tabular-nums'] },
  slotBlock: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    borderRadius: radius.md, paddingVertical: sp(2.5), paddingHorizontal: sp(3),
    backgroundColor: D.card2, opacity: 0.8,
  },
  slotBlockText: { fontSize: font.small, color: D.sub, fontWeight: '600' },
  glowOverlay: { backgroundColor: 'rgba(232,184,75,0.35)', borderRadius: radius.md },
  glowTag: { fontSize: font.tiny, fontWeight: '700', color: '#E8B84B', marginLeft: 'auto' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: sp(5), paddingBottom: sp(10), gap: sp(2.5),
  },
  sheetLight: { backgroundColor: colors.bg },
  sheetTitle: { fontSize: font.h2, fontWeight: '700', color: D.text },
  sheetTitleLight: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  sheetLabel: { fontSize: font.small, fontWeight: '600', color: D.sub, marginTop: sp(1) },
  darkField: { backgroundColor: D.card2, color: D.text },
  svcRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    borderRadius: radius.md, padding: sp(3.5), backgroundColor: D.card2,
  },
  svcRowUsual: { borderWidth: 1, borderColor: colors.accent },
  svcNameRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  usualTag: {
    backgroundColor: 'rgba(232,71,79,0.15)', borderRadius: radius.sm,
    paddingVertical: 2, paddingHorizontal: sp(1.5),
  },
  usualTagText: { fontSize: 9, fontWeight: '800', color: colors.accent, letterSpacing: 0.5 },

  panelHead: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  panelName: { fontSize: font.h2, fontWeight: '700', color: D.text },
  panelMeta: { fontSize: font.small, color: D.sub, marginTop: 2 },
  panelBooking: { fontSize: font.small, color: D.sub },
  pendingPill: {
    backgroundColor: 'rgba(154,107,0,0.25)', borderRadius: radius.pill,
    paddingVertical: 4, paddingHorizontal: sp(2.5),
  },
  pendingPillText: { fontSize: font.tiny, fontWeight: '800', color: '#E8B84B', letterSpacing: 0.5 },
  panelActions: { flexDirection: 'row', gap: sp(4), marginTop: sp(2), flexWrap: 'wrap' },
  panelBtn: { alignItems: 'center', gap: sp(1) },
  panelBtnIcon: {
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  panelBtnIconDanger: { backgroundColor: 'rgba(210,59,59,0.18)' },
  panelBtnLabel: { fontSize: font.small, fontWeight: '600', color: D.text },
});
