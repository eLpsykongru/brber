import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, Image, Linking, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import SlotPicker from '../components/SlotPicker';
import { Field, PillButton, TAB_BAR_INSET } from '../components/ui';
import { daySlots } from '../lib/slots';
import type { Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';
import ChatScreen from './ChatScreen';

// Calendar tab: day timeline / week summary of what's on the books.
// Hours & breaks are EDITED in Profile → Schedule settings; here they're only shown.
type CalBooking = {
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
  customer: { full_name: string | null; phone: string | null; avatar_url: string | null } | null;
};
type BlockRow = { id: string; label: string | null; day: string | null; start_min: number; end_min: number };
type Service = { id: string; name: string; price_cents: number; duration_min: number };
type ClientHit = { name: string; avatar: string | null; app: boolean };

const DAY_MS = 86_400_000;
const HOUR_H = 112; // timeline px per hour
const STEP = 15;    // drag reschedule snaps to 15-min increments
const AMBER = '#E8B84B';
const CANCEL_REASONS = ['Client requested', 'Client no-show', "I'm unavailable", 'Double booked', 'Emergency'];
const MOVE_REASONS = ['Client requested', 'Running late', 'Schedule conflict', 'Better slot', 'Emergency'];
const toggleReason = (xs: string[], r: string) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]);

const sundayOf = (d: Date) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay());
  return x;
};
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const ampm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
const minLabel = (m: number) => {
  const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
const dh = (cents: number) => `${(cents / 100).toFixed(0)} DH`;
const minutesOf = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const durMin = (b: { starts_at: string; ends_at: string }) =>
  Math.round((new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000);
const nameOf = (b: CalBooking, barberId: string) =>
  b.walk_in_name ?? (b.customer_id === barberId ? 'Walk-in' : b.customer?.full_name ?? 'Client');

function Avatar({ url, name, size = 44 }: { url?: string | null; name: string; size?: number }) {
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 999 }} />;
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[s.avatarFallback, { width: size, height: size, borderRadius: 999 }]}>
      <Text style={s.avatarInitials}>{initials}</Text>
    </View>
  );
}

function InfoRow({ icon, label, value, right }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; value: string; right?: string;
}) {
  return (
    <View style={s.infoRow}>
      <View style={s.infoIcon}><Ionicons name={icon} size={16} color={D.sub} /></View>
      <View style={s.grow}>
        <Text style={s.infoLabel}>{label}</Text>
        <Text style={s.infoValue}>{value}</Text>
      </View>
      {right ? <Text style={s.infoRight}>{right}</Text> : null}
    </View>
  );
}

function SheetBtn({ icon, label, onPress, danger }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.sheetBtn, danger && s.sheetBtnDanger, pressed && s.pressed]}>
      <Ionicons name={icon} size={16} color={danger ? colors.danger : D.text} />
      <Text style={[s.sheetBtnText, danger && { color: colors.danger }]}>{label}</Text>
    </Pressable>
  );
}

function ReasonChips({ options, selected, onToggle, light }: {
  options: string[]; selected: string[]; onToggle: (r: string) => void; light?: boolean;
}) {
  return (
    <View style={s.reasonWrap}>
      {options.map((r) => {
        const on = selected.includes(r);
        return (
          <Pressable key={r} onPress={() => onToggle(r)} accessibilityRole="button"
            accessibilityState={{ selected: on }} accessibilityLabel={r}
            style={({ pressed }) => [s.reasonChip, light ? s.reasonChipLight : s.reasonChipDark,
              on && s.reasonChipOn, pressed && s.pressed]}>
            {on && <Ionicons name="checkmark" size={12} color={colors.onAccent} />}
            <Text style={[s.reasonChipText, light ? s.reasonTextLight : s.reasonTextDark,
              on && s.reasonChipTextOn]}>{r}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterRow({ label, on, color, onPress }: {
  label: string; on: boolean; color: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      accessibilityLabel={(on ? 'Hide ' : 'Show ') + label} accessibilityState={{ checked: on }}
      style={({ pressed }) => [s.filterOpt, pressed && s.pressed]}>
      <View style={[s.filterDot, { backgroundColor: color, borderColor: color }]} />
      <Text style={s.filterOptText}>{label}</Text>
      <View style={[s.filterCheck, on && s.filterCheckOn]}>
        {on ? <Ionicons name="checkmark" size={13} color={colors.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

export default function CalendarScreen({ barberId, onChromeHidden }: {
  barberId: string;
  onChromeHidden?: (hidden: boolean) => void;
}) {
  const [view, setView] = useState<'day' | 'week'>('day');
  const [weekStart, setWeekStart] = useState(() => sundayOf(new Date()));
  const [selected, setSelected] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [bookings, setBookings] = useState<CalBooking[] | null>(null); // null = load in flight
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [windows, setWindows] = useState<Window[]>([]);
  const [sheet, setSheet] = useState<CalBooking | null>(null);
  const [blockSheet, setBlockSheet] = useState<BlockRow | null>(null);
  const [resched, setResched] = useState<CalBooking | null>(null);
  const [reschedAt, setReschedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<{ id: string; title: string } | null>(null);
  const [sheetClient, setSheetClient] = useState<ClientRef | null>(null);
  // drag-and-drop reschedule (day view)
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [proposed, setProposed] = useState<{ b: CalBooking; startMin: number } | null>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragBaseMin = useRef(0);
  // quick filters (day timeline)
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ appts: true, breaks: true, timeOff: true });
  const [daysOff, setDaysOff] = useState<{ day: string; label: string | null }[]>([]);
  // tap-to-create (empty slot → new booking sheet)
  const [services, setServices] = useState<Service[]>([]);
  const [newAt, setNewAt] = useState<Date | null>(null);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'walkin' | 'appt'>('walkin');
  const [addBusy, setAddBusy] = useState(false);
  const [clients, setClients] = useState<ClientHit[] | null>(null);
  const [cancelling, setCancelling] = useState<CalBooking | null>(null);
  const [cancelReasons, setCancelReasons] = useState<string[]>([]);
  const [moveReasons, setMoveReasons] = useState<string[]>([]);
  const [toast, setToast] = useState<{ booking: CalBooking; clearStart: boolean; clearCheckin: boolean } | null>(null);
  const filterAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!showFilters) return;
    filterAnim.setValue(0);
    Animated.timing(filterAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [showFilters]);

  const load = useCallback(async () => {
    setBookings(null);
    const to = new Date(weekStart.getTime() + 7 * DAY_MS);
    const [bk, blk, av, off, sv] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, ends_at, status, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name, phone, avatar_url)')
        .eq('barber_id', barberId)
        .gte('starts_at', weekStart.toISOString()).lt('starts_at', to.toISOString())
        .in('status', ['pending', 'confirmed'])
        .order('starts_at'),
      supabase.from('time_blocks').select('id, label, day, start_min, end_min').eq('barber_id', barberId),
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
      supabase.from('days_off').select('day, label').eq('barber_id', barberId)
        .gte('day', isoOf(weekStart)).lt('day', isoOf(to)),
      supabase.from('services').select('id, name, price_cents, duration_min')
        .eq('barber_id', barberId).eq('is_active', true).order('name'),
    ]);
    if (bk.error) Alert.alert('Could not load calendar', bk.error.message);
    setBookings((bk.data as unknown as CalBooking[]) ?? []);
    setBlocks((blk.data ?? []) as BlockRow[]);
    setWindows(av.data ?? []);
    setDaysOff((off.data ?? []) as { day: string; label: string | null }[]);
    setServices((sv.data ?? []) as Service[]);
  }, [barberId, weekStart]);

  useEffect(() => { load(); }, [load]);

  // auto-dismiss the completion toast after 5s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // known clients for the Appointment search — loaded once, on first sheet open
  useEffect(() => {
    if (!newAt || clients !== null) return;
    supabase.from('bookings')
      .select('customer_id, walk_in_name, customer:profiles!customer_id(full_name, avatar_url)')
      .eq('barber_id', barberId).in('status', ['confirmed', 'no_show'])
      .order('starts_at', { ascending: false }).limit(200)
      .then(({ data }) => {
        const seen = new Map<string, ClientHit>();
        for (const r of (data ?? []) as any[]) {
          const app = r.customer_id !== barberId;
          const name = app ? r.customer?.full_name : r.walk_in_name;
          if (!name || seen.has(name.toLowerCase())) continue;
          seen.set(name.toLowerCase(), { name, avatar: app ? r.customer?.avatar_url ?? null : null, app });
        }
        setClients([...seen.values()]);
      });
  }, [newAt]);

  function openChat(b: CalBooking | null) {
    setSheet(null);
    setChat(b ? { id: b.id, title: nameOf(b, barberId) } : null);
    onChromeHidden?.(!!b);
  }

  const clientRefOf = (b: CalBooking): ClientRef => ({
    name: nameOf(b, barberId),
    avatarUrl: b.customer_id === barberId ? null : b.customer?.avatar_url ?? null,
    phone: b.customer_id === barberId ? null : b.customer?.phone ?? null,
    customerId: b.customer_id,
    walkInName: b.walk_in_name,
  });

  function shiftWeek(deltaDays: number) {
    const ws = new Date(weekStart.getTime() + deltaDays * DAY_MS);
    setWeekStart(ws);
    setSelected(new Date(ws.getTime() + selected.getDay() * DAY_MS));
  }

  function goToday() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    setSelected(t);
    setWeekStart(sundayOf(t));
  }

  async function confirmBooking(b: CalBooking) {
    const { error } = await supabase.rpc('accept_booking', { p_booking: b.id });
    if (error) Alert.alert('Could not confirm', error.message);
    setSheet(null); load();
  }

  // complete implies started; 'start' also backfills check-in server-side
  async function markComplete(b: CalBooking) {
    setBusy(true);
    if (!b.started_at) {
      const r = await supabase.rpc('advance_booking', { p_booking: b.id, p_stage: 'start' });
      if (r.error) { setBusy(false); return Alert.alert('Could not complete', r.error.message); }
    }
    const { error } = await supabase.rpc('advance_booking', { p_booking: b.id, p_stage: 'complete' });
    setBusy(false);
    if (error) return Alert.alert('Could not complete', error.message);
    // capture only what this call set, so undo restores the exact prior state
    setToast({ booking: b, clearStart: !b.started_at, clearCheckin: !b.checked_in_at });
    setSheet(null); load();
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

  function cancelBooking(b: CalBooking) {
    setSheet(null); setCancelReasons([]); setCancelling(b);
  }
  async function doCancel() {
    if (!cancelling) return;
    setBusy(true);
    const { error } = await supabase.rpc('cancel_booking', {
      p_booking: cancelling.id, p_reason: cancelReasons.length ? cancelReasons.join(', ') : null,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not cancel', error.message);
    setCancelling(null); load();
  }

  async function confirmReschedule() {
    if (!resched || !reschedAt) return;
    const { error } = await supabase.rpc('reschedule_booking', {
      p_booking: resched.id, p_new_start: reschedAt.toISOString(),
      p_reason: moveReasons.length ? moveReasons.join(', ') : null,
    });
    if (error) Alert.alert('Could not reschedule', error.message);
    setResched(null); setReschedAt(null);
    load();
  }

  // drag-and-drop: the drop position IS the new start time (snapped to STEP)
  async function confirmDrag() {
    if (!proposed) return;
    setBusy(true);
    const d = new Date(selected);
    d.setHours(Math.floor(proposed.startMin / 60), proposed.startMin % 60, 0, 0);
    const { error } = await supabase.rpc('reschedule_booking', {
      p_booking: proposed.b.id, p_new_start: d.toISOString(),
    });
    setBusy(false);
    if (error) {
      const msg = error.message.includes('no_double_booking')
        ? 'That time overlaps another booking.' : error.message;
      return Alert.alert('Could not move', msg);
    }
    setProposed(null);
    load();
  }

  // tap-to-create: barber self-booking (walk-in row) at the tapped slot
  async function addBooking(service: Service) {
    if (!newAt) return;
    setAddBusy(true);
    const { error } = await supabase.from('bookings').insert({
      customer_id: barberId, barber_id: barberId, service_id: service.id,
      starts_at: newAt.toISOString(), walk_in_name: newName.trim() || null,
    });
    setAddBusy(false);
    if (error) {
      const msg = error.message.includes('no_double_booking')
        ? 'That time overlaps another booking.' : error.message;
      return Alert.alert('Could not add', msg);
    }
    setNewAt(null); setNewName('');
    load();
  }

  function removeBlock(b: BlockRow) {
    Alert.alert('Remove this break?',
      b.day === null ? 'It repeats every day — removing deletes it everywhere.' : (b.label ?? 'Break'),
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('time_blocks').delete().eq('id', b.id);
            if (error) Alert.alert('Could not remove', error.message);
            setBlockSheet(null); load();
          },
        },
      ]);
  }

  if (chat) {
    return <ChatScreen bookingId={chat.id} myId={barberId}
      title={chat.title} onBack={() => openChat(null)} />;
  }

  // ---- derive ----
  const week = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY_MS));
  const rows = bookings ?? [];
  const ofDay = (d: Date) => rows.filter((b) => sameDay(new Date(b.starts_at), d));
  const dayRows = ofDay(selected);
  const bookedHours = dayRows.reduce((a, b) => a + durMin(b), 0) / 60;
  const revenue = dayRows.reduce((a, b) => a + b.price_cents, 0);
  const maxCount = Math.max(...week.map((d) => ofDay(d).length), 1);
  const monthLabel = `${selected.toLocaleDateString('en-US', { month: 'long' }).toUpperCase()} ${selected.getFullYear()}`;

  const dayBlocks = blocks.filter((b) => b.day === null || b.day === isoOf(selected));
  const offToday = daysOff.find((d) => d.day === isoOf(selected)) ?? null;
  const anyHidden = !filters.appts || !filters.breaks || !filters.timeOff;
  const vBookings = filters.appts ? dayRows : [];
  const vBlocks = filters.breaks ? dayBlocks : [];
  const showOff = filters.timeOff && !!offToday;
  const bothHidden = !filters.appts && !filters.breaks;
  const dayOffOnly = showOff && vBookings.length === 0 && vBlocks.length === 0;
  // timeline bounds: working window ∪ bookings ∪ blocks; 8–21 when nothing else says
  const wd = windows.filter((w) => w.weekday === selected.getDay());
  let m0 = wd.length ? Math.min(...wd.map((w) => w.start_min)) : 8 * 60;
  let m1 = wd.length ? Math.max(...wd.map((w) => w.end_min)) : 21 * 60;
  for (const b of dayRows) { m0 = Math.min(m0, minutesOf(b.starts_at)); m1 = Math.max(m1, minutesOf(b.starts_at) + durMin(b)); }
  for (const b of dayBlocks) { m0 = Math.min(m0, b.start_min); m1 = Math.max(m1, b.end_min); }
  const hStart = Math.floor(m0 / 60);
  const hEnd = Math.ceil(m1 / 60);
  const hours = Array.from({ length: hEnd - hStart + 1 }, (_, i) => hStart + i);

  // Appointment name type-ahead: shows from the 2nd character on
  const q = newName.trim().toLowerCase();
  const clientMatches = (newKind === 'appt' && q.length >= 2 && clients)
    ? clients.filter((c) => {
        const n = c.name.toLowerCase();
        return n !== q && n.split(/\s+/).some((w) => w.startsWith(q));
      }).slice(0, 4)
    : [];

  return (
    <View style={s.screen}>
      <ScrollView scrollEnabled={scrollEnabled} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* header */}
        <View style={s.headRow}>
          <View style={s.grow}>
            <Text style={s.monthLabel}>{monthLabel}</Text>
            <Text style={s.title}>Calendar</Text>
          </View>
          <Pressable onPress={goToday} accessibilityRole="button" accessibilityLabel="Jump to today"
            style={({ pressed }) => [s.todayPill, pressed && s.pressed]}>
            <Text style={s.todayText}>Today</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Filters"
            accessibilityState={{ expanded: showFilters }}
            onPress={() => setShowFilters((v) => !v)}
            style={({ pressed }) => [s.circleBtn, pressed && s.pressed]}>
            <Ionicons name="funnel-outline" size={15} color={anyHidden ? colors.accent : D.text} />
            {anyHidden && <View style={s.funnelDot} />}
          </Pressable>
        </View>

        {/* day / week toggle */}
        <View style={s.segment}>
          {(['day', 'week'] as const).map((v) => (
            <Pressable key={v} onPress={() => setView(v)} accessibilityRole="button"
              accessibilityLabel={v === 'day' ? 'Day view' : 'Week view'}
              accessibilityState={{ selected: view === v }}
              style={({ pressed }) => [s.segBtn, view === v && s.segBtnOn, pressed && s.pressed]}>
              <Text style={[s.segText, view === v && s.segTextOn]}>
                {v === 'day' ? 'Day View' : 'Week View'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* week strip */}
        <View style={s.strip}>
          <Pressable onPress={() => shiftWeek(-7)} hitSlop={8} accessibilityRole="button"
            accessibilityLabel="Previous week" style={({ pressed }) => pressed && s.pressed}>
            <Ionicons name="chevron-back" size={16} color={D.sub} />
          </Pressable>
          {week.map((d) => {
            const sel = sameDay(d, selected);
            return (
              <Pressable key={isoOf(d)} onPress={() => setSelected(d)} accessibilityRole="button"
                accessibilityLabel={d.toDateString()} accessibilityState={{ selected: sel }}
                style={({ pressed }) => [s.stripCell, sel && s.stripCellSel, pressed && s.pressed]}>
                <Text style={[s.stripWk, sel && s.stripSelText]}>{d.toDateString()[0]}</Text>
                <Text style={[s.stripNum, sel && s.stripSelText]}>{d.getDate()}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => shiftWeek(7)} hitSlop={8} accessibilityRole="button"
            accessibilityLabel="Next week" style={({ pressed }) => pressed && s.pressed}>
            <Ionicons name="chevron-forward" size={16} color={D.sub} />
          </Pressable>
        </View>

        <View style={s.divider} />

        {/* selected-day stats */}
        <View style={s.tileRow}>
          <View style={s.tile}>
            <Text style={s.tileLabel}>BOOKED</Text>
            <Text style={s.tileValue}>{dayRows.length}</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>HOURS</Text>
            <Text style={s.tileValue}>{bookedHours.toFixed(1)}</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>REVENUE</Text>
            <Text style={[s.tileValue, s.revValue]}>{dh(revenue)}</Text>
          </View>
        </View>

        {bookings === null && (
          <ActivityIndicator style={s.spinner} color={colors.accent} accessibilityLabel="Loading calendar" />
        )}

        {/* WEEK VIEW: one row per day */}
        {bookings !== null && view === 'week' && week.map((d) => {
          const list = ofDay(d);
          const rev = list.reduce((a, b) => a + b.price_cents, 0);
          return (
            <Pressable key={isoOf(d)} onPress={() => { setSelected(d); setView('day'); }}
              accessibilityRole="button"
              accessibilityLabel={`${d.toDateString()}, ${list.length} bookings, ${dh(rev)}`}
              style={({ pressed }) => [s.weekRow, pressed && s.pressed]}>
              <View style={s.weekDayBox}>
                <Text style={s.stripWk}>{d.toDateString()[0]}</Text>
                <Text style={s.weekDayNum}>{d.getDate()}</Text>
              </View>
              <View style={s.grow}>
                <Text style={s.weekCount}>{list.length} booking{list.length === 1 ? '' : 's'}</Text>
                <View style={s.track}>
                  <View style={[s.fill, { width: `${(list.length / maxCount) * 100}%` as const }]} />
                </View>
              </View>
              <Text style={s.weekRev}>{dh(rev)}</Text>
            </Pressable>
          );
        })}

        {/* DAY VIEW: hour timeline */}
        {bookings !== null && view === 'day' && (
          dayOffOnly ? (
            <View style={s.offBanner}>
              <Ionicons name="pause-circle-outline" size={18} color={AMBER} />
              <View style={s.grow}>
                <Text style={s.offBannerLabel}>TIME OFF</Text>
                <Text style={s.offBannerText}>{offToday!.label ?? 'Day off'}</Text>
              </View>
            </View>
          ) : bothHidden ? (
            <Text style={s.empty}>Nothing matches your filters.</Text>
          ) : (
            <>
              {showOff && (
                <View style={s.offBanner}>
                  <Ionicons name="pause-circle-outline" size={18} color={AMBER} />
                  <View style={s.grow}>
                    <Text style={s.offBannerLabel}>TIME OFF</Text>
                    <Text style={s.offBannerText}>{offToday!.label ?? 'Day off'}</Text>
                  </View>
                </View>
              )}
              <View style={[s.timeline, { height: (hEnd - hStart) * HOUR_H + sp(8) }]}>
                <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button"
                  accessibilityLabel="Add a booking at this time"
                  onPress={(e) => {
                    const raw = hStart * 60 + (e.nativeEvent.locationY / HOUR_H) * 60;
                    const snapped = Math.max(hStart * 60, Math.min(hEnd * 60 - STEP, Math.round(raw / STEP) * STEP));
                    const d = new Date(selected);
                    d.setHours(Math.floor(snapped / 60), snapped % 60, 0, 0);
                    setNewName(''); setNewKind('walkin'); setNewAt(d);
                  }} />
                {hours.map((h, i) => (
                  <View key={h} pointerEvents="none" style={[s.hourRow, { top: i * HOUR_H }]}>
                    <Text style={s.hourLabel}>{hourLabel(h)}</Text>
                    <View style={s.hourLine} />
                  </View>
                ))}
                {vBookings.length === 0 && vBlocks.length === 0 && (
                  <View pointerEvents="none" style={s.tapHint}>
                    <Ionicons name="add-circle-outline" size={22} color={D.sub} />
                    <Text style={s.tapHintText}>Tap a time to add a booking</Text>
                  </View>
                )}
              {vBlocks.map((b) => (
                <Pressable key={b.id} onPress={() => setBlockSheet(b)} accessibilityRole="button"
                  accessibilityLabel={`${b.label ?? 'Break'}, ${minLabel(b.start_min)} to ${minLabel(b.end_min)}`}
                  style={({ pressed }) => [s.card, s.blockCard, pressed && s.pressed, {
                    top: ((b.start_min - hStart * 60) / 60) * HOUR_H + 10,
                    height: Math.max(36, ((b.end_min - b.start_min) / 60) * HOUR_H - 6),
                  }]}>
                  <View style={s.cardTopRow}>
                    <Text style={s.blockName} numberOfLines={1}>{b.label ?? 'Break'}</Text>
                    <Ionicons name="cafe-outline" size={13} color={AMBER} />
                  </View>
                  <Text style={s.cardTime}>{minLabel(b.start_min)} – {minLabel(b.end_min)}</Text>
                </Pressable>
              ))}
              {vBookings.map((b) => {
                const dur = durMin(b);
                const pending = b.status === 'pending';
                const isDragging = draggingId === b.id;
                const isProposed = proposed?.b.id === b.id;
                const startMin = isProposed ? proposed!.startMin : minutesOf(b.starts_at);
                // fresh per render → captures the current baseline; one card drags at a time
                const pan = PanResponder.create({
                  onStartShouldSetPanResponderCapture: () => true,
                  onPanResponderGrant: () => {
                    dragBaseMin.current = startMin;
                    dragY.setValue(0);
                    setDraggingId(b.id);
                    setScrollEnabled(false);
                  },
                  onPanResponderMove: Animated.event([null, { dy: dragY }], { useNativeDriver: false }),
                  onPanResponderRelease: (_e, g) => {
                    setScrollEnabled(true);
                    setDraggingId(null);
                    dragY.setValue(0);
                    const deltaMin = Math.round((g.dy / (HOUR_H / 60)) / STEP) * STEP;
                    if (deltaMin === 0) return; // tap / no move
                    const start = Math.max(0, Math.min(24 * 60 - dur, dragBaseMin.current + deltaMin));
                    setProposed({ b, startMin: start });
                  },
                  onPanResponderTerminate: () => {
                    setScrollEnabled(true); setDraggingId(null); dragY.setValue(0);
                  },
                });
                return (
                  <Animated.View key={b.id}
                    style={[s.card, pending && s.cardPending, isProposed && s.cardProposed, {
                      top: ((startMin - hStart * 60) / 60) * HOUR_H + 10,
                      height: Math.max(52, (dur / 60) * HOUR_H - 6),
                      ...(isDragging ? { transform: [{ translateY: dragY }], zIndex: 30, elevation: 12 } : null),
                    }]}>
                    <Pressable onPress={() => setSheet(b)} accessibilityRole="button"
                      accessibilityLabel={`${nameOf(b, barberId)}, ${b.services?.name ?? 'Service'}, ${minLabel(startMin)}`}
                      style={s.cardInner}>
                      <View style={s.cardTopRow}>
                        <Text style={s.cardName} numberOfLines={1}>{nameOf(b, barberId)}</Text>
                        <Ionicons name="cut-outline" size={14} color={pending ? AMBER : colors.accent} />
                      </View>
                      {dur >= 40 && (
                        <Text style={s.cardService} numberOfLines={1}>
                          {b.services?.name ?? 'Service'}{pending ? ' · PENDING' : ''}
                        </Text>
                      )}
                      <View style={s.cardBottomRow}>
                        <Text style={s.cardTime}>{minLabel(startMin)} – {minLabel(startMin + dur)}</Text>
                        <Text style={s.cardPrice}>{dh(b.price_cents)}</Text>
                      </View>
                    </Pressable>
                    <View {...pan.panHandlers} style={s.dragHandle} accessibilityRole="adjustable"
                      accessibilityLabel={`Drag to reschedule ${nameOf(b, barberId)}`}>
                      <Ionicons name="reorder-two-outline" size={18} color={isDragging ? colors.accent : D.sub} />
                    </View>
                  </Animated.View>
                );
              })}
              </View>
            </>
          )
        )}
      </ScrollView>

      {/* tap-to-create: new booking at the tapped slot */}
      <Modal visible={!!newAt} transparent animationType="slide" onRequestClose={() => setNewAt(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.backdrop}
          onPress={() => setNewAt(null)} />
        {newAt && (
          <View style={s.sheet} onAccessibilityEscape={() => setNewAt(null)}>
            <View style={s.handle} />
            <View style={s.sheetHead}>
              <View style={s.grow}>
                <Text style={s.sheetName}>New booking</Text>
                <Text style={s.sheetSub}>{newAt.toDateString().slice(0, 10)} · {ampm(newAt.toISOString())}</Text>
              </View>
              <Pressable onPress={() => setNewAt(null)} hitSlop={8} accessibilityRole="button"
                accessibilityLabel="Close" style={({ pressed }) => [s.closeBtn, pressed && s.pressed]}>
                <Ionicons name="close" size={18} color={D.text} />
              </Pressable>
            </View>

            <View style={s.kindSeg}>
              {(['walkin', 'appt'] as const).map((k) => (
                <Pressable key={k} onPress={() => setNewKind(k)} accessibilityRole="button"
                  accessibilityLabel={k === 'walkin' ? 'Walk-in' : 'Scheduled appointment'}
                  accessibilityState={{ selected: newKind === k }}
                  style={({ pressed }) => [s.kindBtn, newKind === k && s.kindBtnOn, pressed && s.pressed]}>
                  <Ionicons name={k === 'walkin' ? 'walk-outline' : 'calendar-outline'} size={15}
                    color={newKind === k ? colors.onAccent : D.sub} />
                  <Text style={[s.kindTxt, newKind === k && s.kindTxtOn]}>
                    {k === 'walkin' ? 'Walk-in' : 'Appointment'}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Field placeholder={newKind === 'walkin' ? 'Name (optional)' : 'Search client name'}
              placeholderTextColor={D.sub} style={s.darkField}
              value={newName} onChangeText={setNewName} />

            {clientMatches.length > 0 && (
              <View style={s.searchList}>
                {clientMatches.map((c) => (
                  <Pressable key={c.name} onPress={() => setNewName(c.name)} accessibilityRole="button"
                    accessibilityLabel={`Use ${c.name}`}
                    style={({ pressed }) => [s.searchRow, pressed && s.pressed]}>
                    {c.avatar
                      ? <Image source={{ uri: c.avatar }} style={s.searchAvatar} />
                      : <View style={[s.searchAvatar, s.searchAvatarFallback]}>
                          <Text style={s.searchInitials}>
                            {c.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                          </Text>
                        </View>}
                    <Text style={s.searchName} numberOfLines={1}>{c.name}</Text>
                    {c.app && (
                      <View style={s.appTag}>
                        <Ionicons name="person" size={9} color={colors.accent} />
                        <Text style={s.appTagText}>App</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            <Text style={s.sheetLabel}>SERVICE</Text>
            {services.length === 0 && (
              <Text style={s.sheetSub}>Add a service first in Profile → My Services.</Text>
            )}
            {services.map((sv) => (
              <Pressable key={sv.id} disabled={addBusy} onPress={() => addBooking(sv)}
                accessibilityRole="button"
                accessibilityLabel={`${sv.name}, ${sv.duration_min} min, ${dh(sv.price_cents)}`}
                style={({ pressed }) => [s.svcRow, pressed && s.pressed]}>
                <View style={s.grow}>
                  <Text style={s.svcName}>{sv.name}</Text>
                  <Text style={s.svcMeta}>{sv.duration_min} min</Text>
                </View>
                <Text style={s.svcPrice}>{dh(sv.price_cents)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Modal>

      {/* filter popover — floating panel anchored under the funnel */}
      <Modal visible={showFilters} transparent animationType="fade" onRequestClose={() => setShowFilters(false)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close filters"
          style={s.filterBackdrop} onPress={() => setShowFilters(false)} />
        <Animated.View onAccessibilityEscape={() => setShowFilters(false)}
          style={[s.filterPanel, { opacity: filterAnim,
            transform: [{ scale: filterAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}>
          <Text style={s.filterPanelTitle}>SHOW ON CALENDAR</Text>
          <FilterRow label="Appointments" on={filters.appts} color={colors.accent}
            onPress={() => setFilters((f) => ({ ...f, appts: !f.appts }))} />
          <FilterRow label="Breaks" on={filters.breaks} color={AMBER}
            onPress={() => setFilters((f) => ({ ...f, breaks: !f.breaks }))} />
          <FilterRow label="Time off" on={filters.timeOff} color={D.sub}
            onPress={() => setFilters((f) => ({ ...f, timeOff: !f.timeOff }))} />
        </Animated.View>
      </Modal>

      {/* appointment sheet */}
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.backdrop}
          onPress={() => setSheet(null)} />
        {sheet && (() => {
          const b = sheet;
          const isWalkIn = b.customer_id === barberId;
          const phone = isWalkIn ? null : b.customer?.phone;
          const done = !!b.completed_at;
          const pending = b.status === 'pending';
          const canCancel = !done && !b.started_at && new Date(b.starts_at).getTime() > Date.now();
          return (
            <View style={s.sheet} onAccessibilityEscape={() => setSheet(null)}>
              <View style={s.handle} />
              <View style={s.sheetTopRow}>
                <View style={s.tagRow}>
                  <View style={s.tagIcon}>
                    <Ionicons name="cut-outline" size={12} color={colors.accent} />
                  </View>
                  <Text style={s.tagText}>{pending ? 'REQUEST' : 'APPOINTMENT'}</Text>
                </View>
                <Pressable onPress={() => setSheet(null)} hitSlop={8} accessibilityRole="button"
                  accessibilityLabel="Close" style={({ pressed }) => [s.closeBtn, pressed && s.pressed]}>
                  <Ionicons name="close" size={18} color={D.text} />
                </Pressable>
              </View>
              <Pressable onPress={() => { setSheet(null); setSheetClient(clientRefOf(b)); }}
                accessibilityRole="button"
                accessibilityLabel={`View ${nameOf(b, barberId)}'s profile and history`}
                style={({ pressed }) => [s.clientPreview, pressed && s.pressed]}>
                <Avatar url={isWalkIn ? null : b.customer?.avatar_url} name={nameOf(b, barberId)} size={48} />
                <View style={s.grow}>
                  <Text style={s.sheetName}>{nameOf(b, barberId)}</Text>
                  <Text style={s.sheetSub}>
                    {isWalkIn ? 'Walk-in (no account)' : `${b.services?.name ?? 'Service'} · view history`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={D.sub} />
              </Pressable>

              <View style={s.infoCard}>
                <InfoRow icon="time-outline" label="TIME"
                  value={`${ampm(b.starts_at)} – ${ampm(b.ends_at)}`} right={`${durMin(b)} min`} />
                <InfoRow icon="card-outline" label="SERVICE PRICE" value={dh(b.price_cents)} />
                {phone ? <InfoRow icon="call-outline" label="CLIENT PHONE" value={phone} /> : null}
              </View>
              {/* TODO(backlog): NOTES card needs a bookings.notes column (client book bet) */}

              {done ? (
                <View style={s.doneRow}>
                  <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                  <Text style={s.doneText}>Completed {ampm(b.completed_at!)}</Text>
                </View>
              ) : (
                <Pressable disabled={busy} accessibilityRole="button"
                  accessibilityLabel={pending ? 'Confirm booking' : 'Mark as complete'}
                  onPress={() => (pending ? confirmBooking(b) : markComplete(b))}
                  style={({ pressed }) => [s.primaryBtn, (pressed || busy) && s.pressed]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.onAccent} />
                  <Text style={s.primaryText}>{pending ? 'Confirm booking' : 'Mark as complete'}</Text>
                </Pressable>
              )}

              <View style={s.btnRow}>
                {!done && (
                  <SheetBtn icon="calendar-outline" label="Reschedule"
                    onPress={() => { setSheet(null); setResched(b); setReschedAt(null); setMoveReasons([]); }} />
                )}
                {!isWalkIn && (
                  <SheetBtn icon="chatbox-outline" label="Message" onPress={() => openChat(b)} />
                )}
              </View>
              {(phone || canCancel) ? (
                <View style={s.btnRow}>
                  {phone && (
                    <SheetBtn icon="call-outline" label="Call"
                      onPress={() => Linking.openURL(`tel:${phone}`)} />
                  )}
                  {canCancel && (
                    <SheetBtn danger icon="trash-outline" label="Cancel" onPress={() => cancelBooking(b)} />
                  )}
                </View>
              ) : null}
            </View>
          );
        })()}
      </Modal>

      {/* client profile preview → full history */}
      <ClientSheet client={sheetClient} barberId={barberId}
        onClose={() => setSheetClient(null)}
        onChat={(id, title) => { setSheetClient(null); setChat({ id, title }); onChromeHidden?.(true); }} />

      {/* break sheet */}
      <Modal visible={!!blockSheet} transparent animationType="slide" onRequestClose={() => setBlockSheet(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.backdrop}
          onPress={() => setBlockSheet(null)} />
        {blockSheet && (() => {
          const b = blockSheet;
          return (
            <View style={s.sheet} onAccessibilityEscape={() => setBlockSheet(null)}>
              <View style={s.handle} />
              <View style={s.sheetHead}>
                <View style={s.grow}>
                  <View style={s.tagRow}>
                    <View style={[s.tagIcon, s.tagIconAmber]}>
                      <Ionicons name="cafe-outline" size={12} color={AMBER} />
                    </View>
                    <Text style={[s.tagText, { color: AMBER }]}>BREAK</Text>
                  </View>
                  <Text style={s.sheetName}>{b.label ?? 'Break'}</Text>
                  {b.day === null && <Text style={s.sheetSub}>Repeats every day</Text>}
                </View>
                <Pressable onPress={() => setBlockSheet(null)} hitSlop={8} accessibilityRole="button"
                  accessibilityLabel="Close" style={({ pressed }) => [s.closeBtn, pressed && s.pressed]}>
                  <Ionicons name="close" size={18} color={D.text} />
                </Pressable>
              </View>

              <View style={s.infoCard}>
                <InfoRow icon="time-outline" label="TIME"
                  value={`${minLabel(b.start_min)} – ${minLabel(b.end_min)}`}
                  right={`${b.end_min - b.start_min} min`} />
              </View>

              <View style={s.btnRow}>
                <SheetBtn icon="calendar-outline" label="Reschedule"
                  onPress={() => Alert.alert('Edit this break', 'Break times are edited in Profile → Schedule settings.')} />
                <SheetBtn danger icon="trash-outline" label="Remove" onPress={() => removeBlock(b)} />
              </View>
            </View>
          );
        })()}
      </Modal>

      {/* reschedule */}
      <Modal visible={!!resched} transparent animationType="slide" onRequestClose={() => setResched(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.backdrop}
          onPress={() => setResched(null)} />
        {resched && (
          <View style={[s.sheet, s.sheetLight]} onAccessibilityEscape={() => setResched(null)}>
            <Text style={s.sheetTitleLight}>
              Move {nameOf(resched, barberId)} · {durMin(resched)} min
            </Text>
            {/* ponytail: SlotPicker is light-themed; lives on a light sheet until a dark variant matters */}
            <SlotPicker barberId={barberId} durationMin={durMin(resched)}
              selected={reschedAt} onSelect={setReschedAt} />
            <Text style={s.reasonLabelLight}>Reason (optional) — tap any</Text>
            <ReasonChips light options={MOVE_REASONS} selected={moveReasons}
              onToggle={(r) => setMoveReasons((xs) => toggleReason(xs, r))} />
            <PillButton title={reschedAt ? `Move to ${reschedAt.toTimeString().slice(0, 5)}` : 'Pick a new time'}
              disabled={!reschedAt} onPress={confirmReschedule} />
          </View>
        )}
      </Modal>

      {/* cancel confirmation with reason */}
      <Modal visible={!!cancelling} transparent animationType="slide" onRequestClose={() => setCancelling(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Keep booking" style={s.backdrop}
          onPress={() => setCancelling(null)} />
        {cancelling && (
          <View style={s.sheet} onAccessibilityEscape={() => setCancelling(null)}>
            <View style={s.handle} />
            <View style={s.sheetHead}>
              <View style={s.grow}>
                <Text style={s.sheetName}>Cancel this booking?</Text>
                <Text style={s.sheetSub}>{nameOf(cancelling, barberId)} · {ampm(cancelling.starts_at)}</Text>
              </View>
            </View>
            <Text style={s.reasonLabel}>REASON (OPTIONAL) — TAP ANY</Text>
            <ReasonChips options={CANCEL_REASONS} selected={cancelReasons}
              onToggle={(r) => setCancelReasons((xs) => toggleReason(xs, r))} />
            <View style={s.btnRow}>
              <Pressable onPress={() => setCancelling(null)} accessibilityRole="button"
                accessibilityLabel="Keep booking" style={({ pressed }) => [s.sheetBtn, pressed && s.pressed]}>
                <Text style={s.sheetBtnText}>Keep</Text>
              </Pressable>
              <Pressable onPress={doCancel} disabled={busy} accessibilityRole="button"
                accessibilityLabel="Cancel booking"
                style={({ pressed }) => [s.sheetBtn, s.sheetBtnDanger, (pressed || busy) && s.pressed]}>
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={[s.sheetBtnText, { color: colors.danger }]}>Cancel booking</Text>
              </Pressable>
            </View>
          </View>
        )}
      </Modal>

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

      {/* drag confirm bar + real-time conflict check */}
      {proposed && (() => {
        const b = proposed.b;
        const dur = durMin(b);
        const startMin = proposed.startMin;
        const endMin = startMin + dur;
        // every check runs on already-loaded data → instant, before any server call
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const past = sameDay(selected, now) && startMin <= nowMin;
        const others = dayRows.filter((x) => x.id !== b.id && x.status !== 'no_show');
        const clash = others.find((x) => startMin < minutesOf(x.ends_at) && endMin > minutesOf(x.starts_at));
        const brk = dayBlocks.find((bl) => startMin < bl.end_min && endMin > bl.start_min);
        const wins = windows.filter((w) => w.weekday === selected.getDay());
        const inHours = wins.some((w) => startMin >= w.start_min && endMin <= w.end_min);
        // block = the DB would reject it; soft = allowed but worth flagging
        const warn = past ? { block: true, msg: 'That time is already past' }
          : clash ? { block: true, msg: `Overlaps ${nameOf(clash, barberId)}` }
          : offToday ? { block: false, msg: "You're marked off this day" }
          : wins.length === 0 ? { block: false, msg: 'Outside your working days' }
          : !inHours ? { block: false, msg: 'Outside your working hours' }
          : brk ? { block: false, msg: `Overlaps ${brk.label ?? 'a break'}` }
          : null;
        // one-tap fix: nearest free, conflict-free slot for this duration
        let suggestion: number | null = null;
        if (warn) {
          const free = daySlots(selected, dur, windows, others, daysOff.map((d) => d.day), blocks, 0)
            .filter((sl) => sl.status === 'free')
            .map((sl) => sl.time.getHours() * 60 + sl.time.getMinutes());
          if (free.length) suggestion = free.reduce((a, m) => (Math.abs(m - startMin) < Math.abs(a - startMin) ? m : a));
        }
        return (
          <View style={s.confirmBar}>
            <View style={s.confirmRow}>
              <View style={s.grow}>
                <Text style={s.confirmTitle} numberOfLines={1}>Move {nameOf(b, barberId)}</Text>
                <Text style={s.confirmSub}>to {minLabel(startMin)} · {selected.toDateString().slice(0, 10)}</Text>
              </View>
              <Pressable onPress={() => setProposed(null)} accessibilityRole="button" accessibilityLabel="Cancel move"
                style={({ pressed }) => [s.confirmCancel, pressed && s.pressed]}>
                <Text style={s.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={confirmDrag} disabled={busy || warn?.block}
                accessibilityRole="button" accessibilityLabel="Confirm new time"
                style={({ pressed }) => [s.confirmOk, warn?.block && s.confirmOkDisabled, (pressed || busy) && s.pressed]}>
                <Text style={s.confirmOkText}>Confirm</Text>
              </Pressable>
            </View>
            {warn && (
              <View style={[s.warnRow, warn.block ? s.warnRowBlock : s.warnRowSoft]}>
                <Ionicons name={warn.block ? 'alert-circle' : 'warning-outline'} size={15}
                  color={warn.block ? colors.danger : AMBER} />
                <Text style={s.warnText} numberOfLines={1}>{warn.msg}</Text>
                {suggestion != null && (
                  <Pressable onPress={() => setProposed({ b, startMin: suggestion! })}
                    accessibilityRole="button" accessibilityLabel={`Move to ${minLabel(suggestion)} instead`}
                    style={({ pressed }) => [s.fixBtn, pressed && s.pressed]}>
                    <Ionicons name="sparkles-outline" size={12} color={colors.onAccent} />
                    <Text style={s.fixText}>Use {minLabel(suggestion)}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      })()}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  content: { padding: sp(5), paddingTop: sp(14), gap: sp(3), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  spinner: { marginVertical: sp(8) },
  empty: { fontSize: font.small, color: D.sub, textAlign: 'center', marginTop: sp(6) },
  divider: { height: 1, backgroundColor: D.border },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2.5) },
  monthLabel: { fontSize: font.tiny, fontWeight: '700', color: colors.accent, letterSpacing: 2 },
  title: { fontSize: font.title, fontWeight: '700', color: D.text, marginTop: 2 },
  todayPill: {
    paddingHorizontal: sp(3.5), height: 36, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  todayText: { fontSize: font.small, fontWeight: '700', color: D.text },
  circleBtn: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  funnelDot: {
    position: 'absolute', top: 5, right: 5, width: 7, height: 7, borderRadius: 4,
    backgroundColor: colors.accent, borderWidth: 1.5, borderColor: D.card2,
  },
  filterBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  filterPanel: {
    position: 'absolute', top: sp(24), right: sp(5), minWidth: 224,
    backgroundColor: D.card, borderRadius: radius.lg, borderWidth: 1, borderColor: D.border,
    padding: sp(2), gap: 2,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  filterPanelTitle: {
    fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1,
    paddingHorizontal: sp(2), paddingTop: sp(2), paddingBottom: sp(1),
  },
  filterDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  filterOpt: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    paddingHorizontal: sp(2), paddingVertical: sp(2.5), borderRadius: radius.md,
  },
  filterOptText: { flex: 1, fontSize: font.body, fontWeight: '600', color: D.text },
  filterCheck: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },
  filterCheckOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  offBanner: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: 'rgba(232,184,75,0.10)', borderWidth: 1, borderColor: 'rgba(232,184,75,0.4)',
    borderRadius: radius.lg, padding: sp(4),
  },
  offBannerLabel: { fontSize: font.tiny, fontWeight: '800', color: AMBER, letterSpacing: 1 },
  offBannerText: { fontSize: font.body, fontWeight: '700', color: D.text, marginTop: 2 },

  segment: { flexDirection: 'row', backgroundColor: D.card, borderRadius: radius.pill, padding: 4 },
  segBtn: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: colors.accent },
  segText: { fontSize: font.small, fontWeight: '700', color: D.sub },
  segTextOn: { color: colors.onAccent },

  strip: { flexDirection: 'row', alignItems: 'center', gap: sp(1) },
  stripCell: {
    flex: 1, alignItems: 'center', gap: 4, paddingVertical: sp(2), borderRadius: radius.md,
  },
  stripCellSel: { backgroundColor: colors.accent },
  stripWk: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  stripNum: { fontSize: font.body, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  stripSelText: { color: colors.onAccent },

  tileRow: { flexDirection: 'row', gap: sp(2.5) },
  tile: {
    flex: 1, backgroundColor: D.card, borderRadius: radius.lg, padding: sp(3.5), gap: 4,
    borderWidth: 1, borderColor: D.border,
  },
  tileLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  tileValue: { fontSize: 20, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  revValue: { color: colors.accent },

  weekRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3.5),
    backgroundColor: D.card, borderRadius: radius.lg, padding: sp(3.5),
  },
  weekDayBox: {
    width: 44, height: 48, borderRadius: radius.md, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  weekDayNum: { fontSize: font.h2, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  weekCount: { fontSize: font.body, fontWeight: '700', color: D.text },
  track: {
    height: 6, borderRadius: 3, backgroundColor: D.card2, marginTop: sp(2), overflow: 'hidden',
  },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  weekRev: { fontSize: font.small, fontWeight: '700', color: colors.accent, fontVariant: ['tabular-nums'] },

  timeline: { position: 'relative' },
  hourRow: {
    position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: sp(2),
  },
  hourLabel: { width: 48, fontSize: font.tiny, color: D.sub, fontVariant: ['tabular-nums'] },
  hourLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' },
  card: {
    position: 'absolute', left: 60, right: 2, borderRadius: radius.md,
    backgroundColor: 'rgba(232,71,79,0.10)', borderWidth: 1, borderColor: 'rgba(232,71,79,0.55)',
    overflow: 'hidden', gap: 2,
  },
  cardInner: { flex: 1, gap: 2, padding: sp(2.5), paddingRight: 26 },
  cardProposed: { borderStyle: 'dashed', borderColor: colors.accent, backgroundColor: 'rgba(232,71,79,0.18)' },
  dragHandle: {
    position: 'absolute', top: 0, right: 0, bottom: 0, width: 26,
    alignItems: 'center', justifyContent: 'center',
    borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.07)',
  },
  cardPending: { borderStyle: 'dashed', borderColor: AMBER, backgroundColor: 'rgba(232,184,75,0.08)' },
  blockCard: {
    backgroundColor: 'rgba(232,184,75,0.10)', borderColor: 'rgba(232,184,75,0.4)', padding: sp(2.5),
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp(2) },
  cardName: { flex: 1, fontSize: font.small, fontWeight: '700', color: D.text },
  blockName: { flex: 1, fontSize: font.small, fontWeight: '700', color: AMBER },
  cardService: { fontSize: font.tiny, color: D.sub },
  cardBottomRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto' },
  cardTime: { fontSize: font.tiny, color: D.sub, fontVariant: ['tabular-nums'] },
  cardPrice: { fontSize: font.tiny, fontWeight: '700', color: colors.accent, fontVariant: ['tabular-nums'] },

  confirmBar: {
    position: 'absolute', left: sp(5), right: sp(5), bottom: TAB_BAR_INSET - sp(2),
    gap: sp(2.5),
    backgroundColor: D.card2, borderRadius: radius.lg, padding: sp(2.5),
    borderWidth: 1, borderColor: D.border,
  },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  warnRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    borderRadius: radius.md, paddingVertical: sp(2), paddingHorizontal: sp(2.5),
  },
  warnRowBlock: { backgroundColor: 'rgba(232,71,79,0.12)' },
  warnRowSoft: { backgroundColor: 'rgba(232,184,75,0.12)' },
  warnText: { flex: 1, fontSize: font.tiny, fontWeight: '600', color: D.text },
  fixBtn: {
    flexDirection: 'row', alignItems: 'center', gap: sp(1),
    paddingHorizontal: sp(2.5), height: 30, borderRadius: radius.pill, backgroundColor: colors.accent,
  },
  fixText: { fontSize: font.tiny, fontWeight: '800', color: colors.onAccent, fontVariant: ['tabular-nums'] },
  confirmOkDisabled: { opacity: 0.4 },
  confirmTitle: { fontSize: font.small, fontWeight: '700', color: D.text },
  confirmSub: { fontSize: font.tiny, color: D.sub, marginTop: 1, fontVariant: ['tabular-nums'] },
  confirmCancel: {
    paddingHorizontal: sp(3), height: 38, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: D.card,
  },
  confirmCancelText: { fontSize: font.small, fontWeight: '700', color: D.sub },
  confirmOk: {
    paddingHorizontal: sp(3.5), height: 38, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
  },
  confirmOkText: { fontSize: font.small, fontWeight: '700', color: colors.onAccent },

  kindSeg: { flexDirection: 'row', backgroundColor: D.card2, borderRadius: radius.pill, padding: 4, gap: 4 },
  kindBtn: {
    flex: 1, height: 38, borderRadius: radius.pill, flexDirection: 'row', gap: sp(1.5),
    alignItems: 'center', justifyContent: 'center',
  },
  kindBtnOn: { backgroundColor: colors.accent },
  kindTxt: { fontSize: font.small, fontWeight: '700', color: D.sub },
  kindTxtOn: { color: colors.onAccent },
  darkField: { backgroundColor: D.card2, color: D.text },
  sheetLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1, marginTop: sp(1) },
  svcRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card2, borderRadius: radius.md, padding: sp(3.5),
  },
  svcName: { fontSize: font.body, fontWeight: '700', color: D.text },
  svcMeta: { fontSize: font.small, color: D.sub, marginTop: 1 },
  svcPrice: { fontSize: font.small, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  tapHint: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', gap: sp(1),
  },
  tapHintText: { fontSize: font.small, color: D.sub },
  searchList: { backgroundColor: D.card2, borderRadius: radius.md, overflow: 'hidden' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3), padding: sp(2.5) },
  searchAvatar: { width: 32, height: 32, borderRadius: radius.pill },
  searchAvatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  searchInitials: { fontSize: font.tiny, fontWeight: '700', color: colors.accent },
  searchName: { flex: 1, fontSize: font.body, fontWeight: '600', color: D.text },
  appTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(232,71,79,0.15)', borderRadius: radius.sm,
    paddingVertical: 2, paddingHorizontal: sp(1.5),
  },
  appTagText: { fontSize: 9, fontWeight: '800', color: colors.accent, letterSpacing: 0.5 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  reasonChip: {
    flexDirection: 'row', alignItems: 'center', gap: sp(1),
    paddingHorizontal: sp(3), height: 34, borderRadius: radius.pill, borderWidth: 1,
  },
  reasonChipDark: { backgroundColor: D.card2, borderColor: D.border },
  reasonChipLight: { backgroundColor: colors.surface, borderColor: colors.border },
  reasonChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  reasonChipText: { fontSize: font.small, fontWeight: '700' },
  reasonTextDark: { color: D.text },
  reasonTextLight: { color: colors.text },
  reasonChipTextOn: { color: colors.onAccent },
  reasonLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  reasonLabelLight: { fontSize: font.small, fontWeight: '700', color: colors.textSecondary },
  toast: {
    position: 'absolute', left: sp(5), right: sp(5), bottom: TAB_BAR_INSET - sp(2),
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card2, borderRadius: radius.lg, padding: sp(3.5),
    borderWidth: 1, borderColor: D.border,
  },
  toastText: { flex: 1, fontSize: font.small, fontWeight: '700', color: D.text },
  toastUndo: { fontSize: font.small, fontWeight: '800', color: colors.accent, letterSpacing: 0.5 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: sp(5), paddingBottom: sp(10), gap: sp(3),
  },
  sheetLight: { backgroundColor: colors.bg },
  sheetTitleLight: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: D.border },
  sheetHead: { flexDirection: 'row', gap: sp(3) },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2), marginBottom: sp(1.5) },
  tagIcon: {
    width: 22, height: 22, borderRadius: radius.sm, backgroundColor: 'rgba(232,71,79,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  tagIconAmber: { backgroundColor: 'rgba(232,184,75,0.15)' },
  tagText: { fontSize: font.tiny, fontWeight: '800', color: colors.accent, letterSpacing: 1.5 },
  sheetName: { fontSize: font.title, fontWeight: '700', color: D.text },
  sheetSub: { fontSize: font.small, color: D.sub, marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  clientPreview: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card2, borderRadius: radius.lg, padding: sp(3),
  },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: font.body, fontWeight: '700', color: colors.accent },

  infoCard: { backgroundColor: D.card2, borderRadius: radius.lg, padding: sp(3), gap: sp(3) },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  infoIcon: {
    width: 34, height: 34, borderRadius: radius.sm, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  infoLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  infoValue: { fontSize: font.body, fontWeight: '600', color: D.text, marginTop: 1 },
  infoRight: { fontSize: font.small, color: D.sub },

  primaryBtn: {
    height: 48, borderRadius: radius.pill, backgroundColor: colors.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(2),
  },
  primaryText: { fontSize: font.body, fontWeight: '700', color: colors.onAccent },
  doneRow: {
    height: 48, borderRadius: radius.pill, backgroundColor: D.card2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(2),
  },
  doneText: { fontSize: font.body, fontWeight: '700', color: colors.success },
  btnRow: { flexDirection: 'row', gap: sp(2.5) },
  sheetBtn: {
    flex: 1, height: 46, borderRadius: radius.pill, backgroundColor: D.card2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(2),
  },
  sheetBtnDanger: {
    backgroundColor: 'rgba(232,71,79,0.10)', borderWidth: 1, borderColor: 'rgba(232,71,79,0.45)',
  },
  sheetBtnText: { fontSize: font.small, fontWeight: '700', color: D.text },
});
