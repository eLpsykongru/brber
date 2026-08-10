import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import CancelledGap, { FreedSlot } from '../components/CancelledGap';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import { Clash, ConflictSheet, OfflineBar, OfflineLimits } from '../components/Trouble';
import { drop, enqueue, useConnection, useOutbox } from '../lib/sync';
import { Ico, Serif, T } from '../components/dark';
import SlotPicker from '../components/SlotPicker';
import { Field, PillButton } from '../components/ui';
import { takeLastFix } from '../lib/lastFix';
import { Block, dayStatus, daySlots, sameDay, Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, inter, radius, sp } from '../theme';
import ChatScreen from './ChatScreen';
import WaitingListScreen from './WaitingListScreen';
import OutboxScreen from './OutboxScreen';

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
  const [chat, setChat] = useState<{ id: string; title: string } | null>(null);
  const [waitlist, setWaitlist] = useState<FreedSlot | null>(null);
  // turn 10 — the day has to keep running whether or not we can be reached
  const { online, since: offlineSince } = useConnection();
  const queued = useOutbox();
  const [clash, setClash] = useState<Clash | null>(null);
  const [outbox, setOutbox] = useState(false);
  const [sheetClient, setSheetClient] = useState<ClientRef | null>(null);
  const [toast, setToast] = useState<{ booking: DayBooking; clearStart: boolean; clearCheckin: boolean } | null>(null);
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

  // auto-dismiss the completion toast after 5s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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
      supabase.from('time_blocks').select('id, label, day, start_min, end_min, kind').eq('barber_id', barberId),
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
    const row = {
      customer_id: barberId, barber_id: barberId, service_id: service.id,
      starts_at: addAt.toISOString(), walk_in_name: walkInName.trim() || null,
    };
    const who = walkInName.trim() || 'Walk-in';

    // 10a — the chair does not wait for the network. Offline this goes on the
    // queue and onto his timeline immediately; `no_double_booking` still has the
    // final say when it sends, and 10b is what that refusal looks like.
    if (!online) {
      await enqueue({
        at: new Date().toISOString(), icon: 'plus',
        label: `Walk-in added · ${who} ${hhmm(row.starts_at)}`,
        meta: { startsAt: row.starts_at, who, service: service.name },
        call: { insert: 'bookings', row },
      });
      setAddAt(null); setWalkInName(''); setUsualServiceId(null);
      return;
    }

    setAddBusy(true);
    const { error } = await supabase.from('bookings').insert(row);
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

  // capture only what this call set, so undo restores the exact prior state
  async function markComplete(b: DayBooking) {
    // 10a — marking a cut done is the one thing he does with a client standing
    // up in front of him. It never blocks on a round trip.
    if (!online) {
      await enqueue({
        at: new Date().toISOString(), icon: 'check', cents: b.price_cents,
        label: `${nameOf(b, barberId)} marked done · ${Math.round(b.price_cents / 100)} DH`,
        meta: { bookingId: b.id },
        call: { rpc: 'advance_booking', args: { p_booking: b.id, p_stage: 'complete' } },
      });
      setSheetBooking(null);
      return;
    }
    const { error } = await supabase.rpc('advance_booking', { p_booking: b.id, p_stage: 'complete' });
    if (error) return Alert.alert('Could not complete', error.message);
    setToast({ booking: b, clearStart: !b.started_at, clearCheckin: !b.checked_in_at });
    setSheetBooking(null);
    load();
  }

  async function undoComplete() {
    if (!toast) return;
    const { booking, clearStart, clearCheckin } = toast;
    setToast(null);
    const { error } = await supabase.rpc('revert_completion', {
      p_booking: booking.id, p_clear_start: clearStart, p_clear_checkin: clearCheckin,
    });
    if (error) Alert.alert('Could not undo', error.message);
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
    setChat(b ? { id: b.id, title: nameOf(b, barberId) } : null);
  }

  const clientRefOf = (b: DayBooking): ClientRef => ({
    name: nameOf(b, barberId),
    avatarUrl: b.customer_id === barberId ? null : b.customer?.avatar_url ?? null,
    phone: b.customer_id === barberId ? null : b.customer?.phone ?? null,
    customerId: b.customer_id,
    walkInName: b.walk_in_name,
  });

  function goToClient(b: DayBooking) {
    setHighlightId(b.id);
    const y = timelineY.current + (rowY.current[b.id] ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 90), animated: true });
  }

  if (chat) {
    return <ChatScreen dark bookingId={chat.id} myId={barberId}
      title={chat.title} onBack={() => openChat(null)} />;
  }

  // 8b's "Tell your waiting list" → 8h. He arrives with a freed slot in hand,
  // which is what makes the OFFER button on each row mean anything: an offer is
  // always anchored to a slot somebody walked away from.
  if (waitlist) {
    return <WaitingListScreen barberId={barberId} slot={waitlist}
      onBack={() => { setWaitlist(null); load(); }} />;
  }

  // 10f — reached from the offline bar, because that is where he notices
  if (outbox) return <OutboxScreen onBack={() => { setOutbox(false); load(); }} />;

  // 10b — a queued walk-in that came back refused. The slot now belongs to
  // whoever the server let in, and the two names, the deposit and the next free
  // time are all already on this screen, which is why the sheet lives here.
  function openClash(job: typeof queued[number]) {
    const at = new Date(job.meta!.startsAt!);
    const theirs = allBookings.find((b) =>
      b.customer_id !== barberId && new Date(b.starts_at).getTime() === at.getTime());
    setClash({
      job,
      at,
      theirs: theirs ? {
        name: nameOf(theirs, barberId),
        bookedAt: hhmm(theirs.starts_at),
        deposit_cents: 0,
        visits: allBookings.filter((b) => b.customer_id === theirs.customer_id).length,
      } : null,
      mine: { name: job.meta?.who ?? 'Walk-in', addedAt: hhmm(job.at) },
      freeAt: freeTicks.find((t) => t.getTime() > at.getTime()) ?? null,
    });
  }

  // per-day status for the strip badges (no-shows don't hold a slot)
  const byDay = new Map<string, DayBooking[]>();
  for (const b of allBookings) {
    if (b.status === 'no_show') continue;
    const key = isoOf(new Date(b.starts_at));
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(b);
  }

  // 10a's "TODAY · FROM MEMORY". What he did while offline is on this phone and
  // nowhere else, so the timeline has to hold both or it would show him a day he
  // has already changed. Queued walk-ins become rows; queued completions mark
  // the row they belong to.
  const pending = queued.filter((j) => !j.conflict);
  const doneOffline = new Set(pending.map((j) => j.meta?.bookingId).filter(Boolean) as string[]);
  const queuedRows: DayBooking[] = pending
    .filter((j) => j.meta?.startsAt && sameDay(new Date(j.meta.startsAt), selectedDay))
    .map((j) => ({
      id: `queued:${j.id}`, starts_at: j.meta!.startsAt!,
      ends_at: new Date(new Date(j.meta!.startsAt!).getTime() + STEP * 60_000).toISOString(),
      status: 'confirmed', price_cents: 0, walk_in_name: j.meta?.who ?? 'Walk-in',
      customer_id: barberId, checked_in_at: null, started_at: null, completed_at: null,
      services: { name: j.meta?.service ?? 'Service' }, customer: null,
    } as unknown as DayBooking));

  const dayAll = [...allBookings.filter((b) => sameDay(new Date(b.starts_at), selectedDay)), ...queuedRows]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const dayLive = dayAll.filter((b) => b.status !== 'no_show');
  // 8k's openings ride in the same table but show as a free tick, not as a break
  const dayBlocks = blocks.filter((b) => b.kind !== 'open' && (b.day === null || b.day === isoOf(selectedDay)));
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
            <Ico name="chevron-left" size={16} />
          </Pressable>
          <Serif size={17} style={s.headTitle}>My day</Serif>
          <Pressable onPress={() => freeTicks[0] && setAddAt(freeTicks[0])} hitSlop={8}
            accessibilityRole="button" accessibilityLabel="Add a booking"
            style={({ pressed }) => [s.circleBtn, pressed && s.pressed]}>
            <Ico name="plus" size={16} />
          </Pressable>
        </View>

        {/* 10a — the day still runs. This sits above the strip because it changes
            what the timeline below it means, not what he can do with it. */}
        {!online && (
          <OfflineBar since={offlineSince} jobs={queued} onOpen={() => setOutbox(true)} />
        )}

        {/* 10b's way in. A refused walk-in must not sit silently in the outbox —
            somebody is standing in his shop expecting that time. */}
        {queued.filter((j) => j.conflict && j.meta?.startsAt).map((j) => (
          <Pressable key={j.id} style={s.clashBar} onPress={() => openClash(j)}>
            <Ico name="alert-triangle" size={16} color={D.amber} />
            <View style={s.grow}>
              <T w="b" size={13} c={D.amber}>
                Two people at {hhmm(j.meta!.startsAt!)}
              </T>
              <T size={11} c={D.sub}>{j.meta?.who ?? 'Your walk-in'} couldn't be added — sort it</T>
            </View>
            <Ico name="chevron-right" size={16} color={D.sub} />
          </Pressable>
        ))}

        {/* day strip — a dot per day: coral when it has work, grey when it's clear */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.strip}>
            {strip.map((d) => {
              const st = dayStatus(d, windows, byDay.get(isoOf(d)) ?? [], daysOff, blocks, bufferMin);
              const sel = sameDay(d, selectedDay);
              const closed = st.state === 'closed';
              const dot = sel ? '#fff' : closed ? 'transparent' : st.count ? D.accent : D.muted;
              return (
                <Pressable key={d.toDateString()} onPress={() => setSelectedDay(d)}
                  accessibilityRole="button" accessibilityLabel={`${d.toDateString()}, ${st.state}${st.state === 'partial' ? `, ${st.count} booked` : ''}`}
                  accessibilityState={{ selected: sel }}
                  style={({ pressed }) => [
                    s.dayCell, sel && s.dayCellSel, closed && s.dayCellOff, pressed && s.pressed,
                  ]}>
                  <T size={10} c={sel ? 'rgba(255,255,255,0.8)' : D.sub}>
                    {d.toDateString().slice(0, 3)}
                  </T>
                  <T w="b" size={14}>{String(d.getDate()).padStart(2, '0')}</T>
                  <View style={[s.dayDot, { backgroundColor: dot }]} />
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {/* 8b/8f — a customer walked away from a slot on this day. The hole, his
            words, and something to do about it; or, once refilled, who took it. */}
        <CancelledGap barberId={barberId} day={selectedDay}
          bookedTodayCents={dayLive.reduce((a, b) => a + b.price_cents, 0)}
          onChat={(id, title) => setChat({ id, title })}
          onBreak={async (at, minutes) => {
            // 8b's TAKE A BREAK: the freed slot becomes a block, so nothing can
            // be booked into it and the day stops offering it.
            const start = at.getHours() * 60 + at.getMinutes();
            const { error } = await supabase.from('time_blocks').insert({
              barber_id: barberId, label: 'Break', day: isoOf(at),
              start_min: start, end_min: start + minutes,
            });
            if (error) Alert.alert('Could not add the break', error.message);
            load();
          }}
          onWaitingList={setWaitlist}
          onReload={load} />

        {/* 10a's honest footer — the two things that genuinely need a signal.
            Below the day, because it is the last thing he needs, not the first. */}
        {!online && <OfflineLimits />}

        {/* what the day adds up to */}
        <View style={s.summary}>
          <T size={11} c={D.sub}>
            {dayLive.length} booked · {freeTicks.length} free
            {dayBlocks.length ? ` · ${dayBlocks.length} break${dayBlocks.length > 1 ? 's' : ''}` : ''}
          </T>
          <View style={s.grow} />
          <T w="b" size={11} c={D.accent}>
            {Math.round(dayLive.reduce((a, b) => a + b.price_cents, 0) / 100)} DH
          </T>
        </View>

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
              const blk = item.block;
              return (
                <View key={`blk-${blk.id}`} style={s.trow}>
                  <T w="b" size={11} c={D.sub} style={s.ttime}>{minToHHMM(blk.start_min)}</T>
                  <View style={[s.trail, { backgroundColor: D.amber }]} />
                  <View style={s.slotBlock}>
                    {glowIds.includes(blk.id) && (
                      <Animated.View pointerEvents="none"
                        style={[StyleSheet.absoluteFillObject, s.glowOverlay, { opacity: glow }]} />
                    )}
                    <Ico name={blk.day === null ? 'coffee' : 'clock'} size={14} color={D.amber} />
                    <T w="sb" size={12} c={D.amber} style={s.grow}>
                      {blk.label ?? 'Break'} · {blk.end_min - blk.start_min} min
                    </T>
                    {glowIds.includes(blk.id) && <T w="b" size={10} c={D.green}>updated</T>}
                  </View>
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
              const noShow = b.status === 'no_show';
              const hot = highlightId === b.id;
              // the rail colour is the whole status vocabulary in one 3px stripe
              const rail = noShow ? D.red : done ? D.muted : inChair ? D.green
                : pending ? D.amber : lateLabel ? D.red : hot ? D.accent : D.muted;
              const isWalkIn = b.customer_id === barberId;
              const stars = isWalkIn ? null : reliabilityOf(b.customer_id, history);
              return (
                <View key={b.id} style={s.trow}
                  onLayout={(e) => { rowY.current[b.id] = e.nativeEvent.layout.y; }}>
                  <T w="b" size={11} c={hot ? D.accent : D.sub} style={s.ttime}>{hhmm(b.starts_at)}</T>
                  <View style={[s.trail, { backgroundColor: rail }]} />
                  <Pressable onPress={() => setSheetBooking(b)} accessibilityRole="button"
                    accessibilityLabel={`${pending ? 'Request' : 'Booking'} at ${hhmm(b.starts_at)}`}
                    style={({ pressed }) => [
                      s.slotBooked, hot && s.slotHighlight, done && s.slotDone, pressed && s.pressed,
                    ]}>
                    {hot && (
                      <View style={s.hotHead}>
                        <Avatar url={isWalkIn ? null : b.customer?.avatar_url} name={nameOf(b, barberId)} size={28} />
                        <Text style={[s.slotName, s.grow]}>{nameOf(b, barberId)}</Text>
                        {stars != null && <RelStars n={stars} />}
                      </View>
                    )}
                    {!hot && (
                      <Text style={[s.slotName, (noShow || expired || done) && s.struck]}>
                        {nameOf(b, barberId)}
                        {inChair ? <Text style={s.chairTag}> · IN CHAIR</Text> : null}
                        {pending ? <Text style={s.pendTag}> · PENDING</Text> : null}
                        {isWalkIn ? <Text style={s.walkTag}> · NO ACCOUNT</Text> : null}
                      </Text>
                    )}
                    <Text style={[s.slotMeta, hot && { marginTop: 6 }]}>
                      {b.services?.name ?? 'Service'} · {(b.price_cents / 100).toFixed(0)} DH
                      {noShow ? <Text style={s.lateTag}> · no-show</Text>
                        : expired ? ' · request expired'
                        : done ? ' · completed ✓'
                        : inChair && b.started_at ? ` · started ${hhmm(b.started_at)}`
                        : checkedIn ? ' · checked in' : ''}
                      {lateLabel && <Text style={s.lateTag}> · {lateLabel}</Text>}
                    </Text>
                  </Pressable>
                </View>
              );
            }
            return (
              <View key={item.at.getTime()} style={s.trow}>
                <T w="b" size={11} c={D.sub} style={s.ttime}>{item.at.toTimeString().slice(0, 5)}</T>
                <View style={[s.trail, { backgroundColor: D.card2 }]} />
                <Pressable onPress={() => setAddAt(item.at)} accessibilityRole="button"
                  accessibilityLabel={`Add booking at ${item.at.toTimeString().slice(0, 5)}`}
                  style={({ pressed }) => [s.slotFree, pressed && s.pressed]}>
                  <Ico name="plus" size={14} color={D.sub} />
                  <T size={12} c={D.sub}>Free — tap to add a walk-in</T>
                </Pressable>
              </View>
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
              <Pressable onPress={() => { setSheetBooking(null); setSheetClient(clientRefOf(b)); }}
                accessibilityRole="button" accessibilityLabel={`View ${nameOf(b, barberId)}'s profile and history`}
                style={({ pressed }) => [s.panelHead, pressed && s.pressed]}>
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
                <Ionicons name="chevron-forward" size={18} color={D.sub} />
              </Pressable>
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
                    <PanelBtn icon="checkbox-outline" label="Complete" onPress={() => markComplete(b)} />
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

      {/* client profile preview → full history */}
      <ClientSheet client={sheetClient} barberId={barberId}
        onClose={() => setSheetClient(null)}
        onChat={(id, title) => { setSheetClient(null); setChat({ id, title }); }} />

      {/* 10b — two people, one slot */}
      <ConflictSheet clash={clash} onClose={() => setClash(null)}
        onResolve={async (choice) => {
          const c = clash!;
          setClash(null);
          if (choice === 'both' || !c.freeAt) {
            // he keeps both: the walk-in re-enters at the same time and the
            // exclusion constraint will refuse it again, so put it in the only
            // place it can go — a break he shortens by hand. Say so plainly.
            await drop(c.job.id);
            Alert.alert('Both kept',
              'Add the second one at a time that is free — the book will not hold two people in one slot.');
            return load();
          }
          if (choice === 'move-mine') {
            const call = c.job.call;
            if ('insert' in call) {
              await drop(c.job.id);
              const { error } = await supabase.from('bookings')
                .insert({ ...call.row, starts_at: c.freeAt.toISOString() });
              if (error) Alert.alert('Could not move him', error.message);
            }
            return load();
          }
          // move the paid booking instead — the customer gets told and can refuse
          const theirs = allBookings.find((b) =>
            b.customer_id !== barberId && new Date(b.starts_at).getTime() === c.at.getTime());
          if (theirs) {
            const { error } = await supabase.rpc('reschedule_booking',
              { p_booking: theirs.id, p_starts_at: c.freeAt.toISOString() });
            if (error) Alert.alert('Could not move it', error.message);
          }
          await drop(c.job.id);
          load();
        }} />

      {/* completion toast with undo */}
      {toast && (
        <View style={s.toast}>
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
          <Text style={s.toastText} numberOfLines={1}>{nameOf(toast.booking, barberId)} — completed</Text>
          <Pressable onPress={undoComplete} accessibilityRole="button" accessibilityLabel="Undo completion"
            hitSlop={8} style={({ pressed }) => pressed && s.pressed}>
            <Text style={s.toastUndo}>UNDO</Text>
          </Pressable>
        </View>
      )}
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
  content: { paddingTop: 62, paddingHorizontal: 20, gap: 13, paddingBottom: 40 },
  pressed: { opacity: 0.7 },
  toast: {
    position: 'absolute', left: sp(5), right: sp(5), bottom: sp(9),
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card2, borderRadius: radius.lg, padding: sp(3.5),
    borderWidth: 1, borderColor: D.border,
  },
  toastText: { flex: 1, fontSize: font.small, fontWeight: '700', color: D.text },
  toastUndo: { fontSize: font.small, fontWeight: '800', color: colors.accent, letterSpacing: 0.5 },
  grow: { flex: 1 },
  note: { color: D.sub, fontSize: font.small, paddingVertical: sp(2) },

  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headTitle: { flex: 1, textAlign: 'center' },
  circleBtn: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: D.card,
    borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
  },
  clashBar: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
  },
  trow: { flexDirection: 'row', gap: 11, alignItems: 'stretch' },
  ttime: { width: 44, paddingTop: 14, fontVariant: ['tabular-nums'] },
  trail: { width: 3, borderRadius: 2 },
  hotHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  chairTag: { fontSize: 10, letterSpacing: 0.8, color: D.green },
  pendTag: { fontSize: 10, letterSpacing: 0.8, color: D.amber },
  walkTag: { fontSize: 10, letterSpacing: 0.8, color: D.sub },

  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  relRow: { flexDirection: 'row', gap: 1 },

  strip: { flexDirection: 'row', gap: 7 },
  dayCell: {
    width: 62, paddingVertical: 9, borderRadius: 14, alignItems: 'center', gap: 5,
    backgroundColor: D.card,
  },
  dayCellSel: { backgroundColor: colors.accent },
  dayCellOff: { opacity: 0.5 },
  dayDot: { width: 5, height: 5, borderRadius: 999 },

  clientRow: { flexDirection: 'row', gap: sp(3) },
  clientCard: {
    width: 92, alignItems: 'center', gap: sp(1.5), padding: sp(2.5),
    borderRadius: radius.md, backgroundColor: D.card, borderWidth: 2, borderColor: 'transparent',
  },
  clientCardActive: { borderColor: colors.accent },
  clientName: { fontSize: font.small, fontWeight: '700', color: D.text, maxWidth: '100%' },
  clientTag: { fontSize: font.tiny, fontWeight: '600', color: D.sub },

  timeline: { gap: 9 },
  slotBooked: {
    flex: 1, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14, backgroundColor: D.card,
  },
  slotHighlight: { borderWidth: 2, borderColor: colors.accent },
  slotDone: { opacity: 0.6 },
  slotName: { fontFamily: inter.b, fontSize: 13, color: D.text },
  struck: { textDecorationLine: 'line-through', color: D.sub },
  slotMeta: { fontFamily: inter.r, fontSize: 11, color: D.sub, marginTop: 2 },
  lateTag: { color: D.red },
  slotPrice: { fontSize: font.small, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  slotFree: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: D.muted, borderStyle: 'dashed', borderRadius: 16,
    paddingVertical: 12, paddingHorizontal: 14,
  },
  slotFreeText: { fontSize: font.small, fontWeight: '600', color: D.sub, fontVariant: ['tabular-nums'] },
  slotBlock: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: D.card,
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
