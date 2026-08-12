import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import { Ico, Serif, T } from '../components/dark';
import SlotPicker from '../components/SlotPicker';
import { Field, PillButton, TAB_BAR_INSET } from '../components/ui';
import { daySlots } from '../lib/slots';
import type { Window } from '../lib/slots';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, inter, radius, sp } from '../theme';
import ChatScreen from './ChatScreen';

// Calendar tab: day timeline / week summary of what's on the books.
// Hours & breaks are EDITED in Profile â†’ Schedule settings; here they're only shown.
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
type BlockRow = {
  id: string; label: string | null; day: string | null; start_min: number; end_min: number;
  kind?: string | null;   // 'open' = room he made (8k), which draws as free, not as a break
};
type Service = { id: string; name: string; price_cents: number; duration_min: number };
type ClientHit = { name: string; avatar: string | null; app: boolean };

const DAY_MS = 86_400_000;
const HOUR_H = 112; // timeline px per hour
const STEP = 15;    // drag reschedule snaps to 15-min increments
const AMBER = '#E8B84B';
const CANCEL_REASONS = ['Client requested', 'Client no-show', "I'm unavailable", 'Double booked', 'Emergency'];
const MOVE_REASONS = ['Client requested', 'Running late', 'Schedule conflict', 'Better slot', 'Emergency'];
const toggleReason = (xs: string[], r: string) => (xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]);

// the mock's grid is a rolling 3-week window, Monday-based: last week (dimmed
// once past), this week, next week â€” not a calendar month.
const GRID_DAYS = 21;
// 20px screen padding either side, six 5px gaps between seven cells
const CELL = Math.floor((Dimensions.get('window').width - 40 - 30) / 7);
const mondayOf = (d: Date) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const gridStartFor = (d: Date) => {
  const m = mondayOf(d); m.setDate(m.getDate() - 7);
  return m;
};
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const ampm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h < 12 ? 'AM' : 'PM'}`;
const minToHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
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


export default function CalendarScreen({ barberId, onChromeHidden }: {
  barberId: string;
  onChromeHidden?: (hidden: boolean) => void;
}) {
  const [gridStart, setGridStart] = useState(() => gridStartFor(new Date()));
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
  // the agenda's one-of-four filter chips
  const [filter, setFilter] = useState<'all' | 'appts' | 'walkins' | 'off'>('all');
  const [daysOff, setDaysOff] = useState<{ day: string; label: string | null }[]>([]);
  // tap-to-create (empty slot â†’ new booking sheet)
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

  const load = useCallback(async () => {
    setBookings(null);
    const weekStart = gridStart;
    const to = new Date(gridStart.getTime() + GRID_DAYS * DAY_MS);
    const [bk, blk, av, off, sv] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, ends_at, status, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name, phone, avatar_url)')
        .eq('barber_id', barberId)
        .gte('starts_at', weekStart.toISOString()).lt('starts_at', to.toISOString())
        .in('status', ['pending', 'confirmed'])
        .order('starts_at'),
      supabase.from('time_blocks').select('id, label, day, start_min, end_min, kind').eq('barber_id', barberId),
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
  }, [barberId, gridStart]);

  useEffect(() => { load(); }, [load]);

  // auto-dismiss the completion toast after 5s
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // known clients for the Appointment search â€” loaded once, on first sheet open
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

  function shiftGrid(deltaWeeks: number) {
    const gs = new Date(gridStart.getTime() + deltaWeeks * 7 * DAY_MS);
    setGridStart(gs);
    // keep the same weekday+row under the cursor so the selection doesn't jump about
    const offset = Math.round((selected.getTime() - gridStart.getTime()) / DAY_MS);
    setSelected(new Date(gs.getTime() + offset * DAY_MS));
  }

  function goToday() {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    setSelected(t);
    setGridStart(gridStartFor(t));
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
      b.day === null ? 'It repeats every day â€” removing deletes it everywhere.' : (b.label ?? 'Break'),
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

  // the calendar is a tab root, so only the chat above it answers
  useAndroidBack(chat ? () => openChat(null) : null);

  if (chat) {
    return <ChatScreen dark bookingId={chat.id} myId={barberId}
      title={chat.title} onBack={() => openChat(null)} />;
  }

  // ---- derive ----
  const grid = Array.from({ length: GRID_DAYS }, (_, i) => new Date(gridStart.getTime() + i * DAY_MS));
  const rows = bookings ?? [];
  const ofDay = (d: Date) => rows.filter((b) => sameDay(new Date(b.starts_at), d));
  const dayAll = ofDay(selected);
  // 8k's openings ride in the same table but draw as free time, not as a break
  const dayBlocks = blocks.filter((b) => b.kind !== 'open' && (b.day === null || b.day === isoOf(selected)));
  const offToday = daysOff.find((d) => d.day === isoOf(selected)) ?? null;
  const offOf = (d: Date) => daysOff.find((x) => x.day === isoOf(d)) ?? null;

  // one-of-four chips: the agenda narrows, the grid never does
  const dayRows = filter === 'walkins' ? dayAll.filter((b) => b.customer_id === barberId)
    : filter === 'appts' ? dayAll.filter((b) => b.customer_id !== barberId)
    : filter === 'off' ? [] : dayAll;
  const showBlocks = filter === 'all' || filter === 'off';
  const revenue = dayAll.reduce((a, b) => a + b.price_cents, 0);
  const monthLabel = `${selected.toLocaleDateString('en-US', { month: 'long' })} ${selected.getFullYear()}`;
  const agendaLabel = selected.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }).toUpperCase();

  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);

  // long-press an empty day â†’ open the new-booking sheet on its first free slot
  function addOnDay(d: Date) {
    const free = daySlots(d, 30, windows, ofDay(d), daysOff.map((x) => x.day), blocks)
      .find((sl) => sl.status === 'free');
    if (!free) return Alert.alert('Nothing free', 'No open slot left on that day.');
    setNewName(''); setNewKind('walkin'); setNewAt(free.time);
  }

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
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* header */}
        <View style={s.headRow}>
          <Serif size={20} ls={0.04}>{monthLabel}</Serif>
          <View style={s.grow} />
          <Pressable onPress={goToday} accessibilityRole="button" accessibilityLabel="Jump to today"
            style={({ pressed }) => [s.todayPill, pressed && s.pressed]}>
            <T w="b" size={12}>Today</T>
          </Pressable>
          <Pressable onPress={() => shiftGrid(-1)} hitSlop={6} accessibilityRole="button"
            accessibilityLabel="Previous week" style={({ pressed }) => [s.navPuck, pressed && s.pressed]}>
            <Ico name="chevron-left" size={14} />
          </Pressable>
          <Pressable onPress={() => shiftGrid(1)} hitSlop={6} accessibilityRole="button"
            accessibilityLabel="Next week" style={({ pressed }) => [s.navPuck, pressed && s.pressed]}>
            <Ico name="chevron-right" size={14} />
          </Pressable>
        </View>

        {/* three-week grid â€” a dot when the day has work, a tag when it's off */}
        <View style={s.grid}>
          {['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((w) => (
            <T key={w} w="b" size={9} c={D.sub} ls={0.72} style={s.gridHead}>{w}</T>
          ))}
          {grid.map((d) => {
            const sel = sameDay(d, selected);
            const past = d < midnight;
            const list = ofDay(d);
            const off = offOf(d);
            const tag = off ? (off.label ?? '').toLowerCase().includes('vac') ? 'VAC' : 'OFF' : null;
            return (
              <Pressable key={isoOf(d)} onPress={() => setSelected(d)} onLongPress={() => addOnDay(d)}
                accessibilityRole="button" accessibilityState={{ selected: sel }}
                accessibilityLabel={`${d.toDateString()}${off ? ', time off' : list.length ? `, ${list.length} bookings` : ', free'}`}
                style={({ pressed }) => [
                  s.cell, past && !sel && s.cellPast,
                  tag && !sel && s.cellOff, sel && s.cellSel, pressed && s.pressed,
                ]}>
                <T w={sel ? 'eb' : 'sb'} size={12} c={tag && !sel ? D.amber : D.text}>{d.getDate()}</T>
                {tag && !sel
                  ? <T w="b" size={7} c={D.amber} ls={0.4}>{tag}</T>
                  : (sel || list.length > 0)
                    ? <View style={[s.cellDot, { backgroundColor: sel ? '#fff' : D.accent }]} />
                    : null}
              </Pressable>
            );
          })}
        </View>

        {/* agenda filter */}
        <View style={s.chipRow}>
          {([['all', 'All'], ['appts', 'Appointments'], ['walkins', 'Walk-ins'], ['off', 'Time off']] as const)
            .map(([k, label]) => (
              <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="button"
                accessibilityState={{ selected: filter === k }}
                style={({ pressed }) => [s.chip, filter === k && s.chipOn, pressed && s.pressed]}>
                <T w={filter === k ? 'b' : 'sb'} size={11} c={filter === k ? '#fff' : D.sub}>{label}</T>
              </Pressable>
            ))}
        </View>

        {bookings === null && (
          <ActivityIndicator style={s.spinner} color={colors.accent} accessibilityLabel="Loading calendar" />
        )}

        {bookings !== null && (
          <View style={s.agendaHead}>
            <T w="b" size={11} c={D.sub} ls={1.65}>
              {agendaLabel} Â· {dayAll.length} BOOKING{dayAll.length === 1 ? '' : 'S'}
            </T>
            <T w="b" size={12} c={D.accent}>{dh(revenue)}</T>
          </View>
        )}

        {/* AGENDA: the selected day, in order */}
        {bookings !== null && (
          <View style={s.agenda}>
            {offToday && (filter === 'all' || filter === 'off') && (
              <View style={s.offBanner}>
                <Ionicons name="pause-circle-outline" size={18} color={AMBER} />
                <View style={s.grow}>
                  <Text style={s.offBannerLabel}>TIME OFF</Text>
                  <Text style={s.offBannerText}>{offToday.label ?? 'Day off'}</Text>
                </View>
              </View>
            )}

            {showBlocks && dayBlocks.map((b) => (
              <Pressable key={b.id} onPress={() => setBlockSheet(b)} accessibilityRole="button"
                accessibilityLabel={`${b.label ?? 'Break'}, ${minLabel(b.start_min)} to ${minLabel(b.end_min)}`}
                style={({ pressed }) => [s.agendaRow, pressed && s.pressed]}>
                <T w="b" size={12} c={AMBER} style={s.agendaTime}>{minToHHMM(b.start_min)}</T>
                <View style={s.grow}>
                  <T w="b" size={13} c={AMBER}>{b.label ?? 'Break'}</T>
                  <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                    {b.end_min - b.start_min} min{b.day === null ? ' Â· every day' : ''}
                  </T>
                </View>
                <Ionicons name="cafe-outline" size={14} color={AMBER} />
              </Pressable>
            ))}

            {dayRows.map((b) => (
              <Pressable key={b.id} onPress={() => setSheet(b)} accessibilityRole="button"
                accessibilityLabel={`${nameOf(b, barberId)}, ${b.services?.name ?? 'Service'}, ${ampm(b.starts_at)}`}
                style={({ pressed }) => [s.agendaRow, pressed && s.pressed]}>
                <T w="b" size={12} c={D.accent} style={s.agendaTime}>
                  {new Date(b.starts_at).toTimeString().slice(0, 5)}
                </T>
                <View style={s.grow}>
                  <T w="b" size={13}>{nameOf(b, barberId)}</T>
                  <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                    {b.services?.name ?? 'Service'} Â· {dh(b.price_cents)}
                    {b.status === 'pending' ? ' Â· PENDING' : b.completed_at ? ' Â· done' : ''}
                  </T>
                </View>
                <Ico name="chevron-right" size={14} color={D.muted} />
              </Pressable>
            ))}

            {dayRows.length === 0 && !(showBlocks && dayBlocks.length) && !offToday && (
              <Pressable onPress={() => addOnDay(selected)} accessibilityRole="button"
                accessibilityLabel="Add a booking on this day"
                style={({ pressed }) => [s.agendaEmpty, pressed && s.pressed]}>
                <Ico name="plus" size={14} color={D.sub} />
                <T size={12} c={D.sub}>
                  {filter === 'all' ? 'Nothing booked â€” tap to add' : 'Nothing matches this filter'}
                </T>
              </Pressable>
            )}
          </View>
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
                <Text style={s.sheetSub}>{newAt.toDateString().slice(0, 10)} Â· {ampm(newAt.toISOString())}</Text>
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
              <Text style={s.sheetSub}>Add a service first in Profile â†’ My Services.</Text>
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
                    {isWalkIn ? 'Walk-in (no account)' : `${b.services?.name ?? 'Service'} Â· view history`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={D.sub} />
              </Pressable>

              <View style={s.infoCard}>
                <InfoRow icon="time-outline" label="TIME"
                  value={`${ampm(b.starts_at)} â€“ ${ampm(b.ends_at)}`} right={`${durMin(b)} min`} />
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

      {/* client profile preview â†’ full history */}
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
                  value={`${minLabel(b.start_min)} â€“ ${minLabel(b.end_min)}`}
                  right={`${b.end_min - b.start_min} min`} />
              </View>

              <View style={s.btnRow}>
                <SheetBtn icon="calendar-outline" label="Reschedule"
                  onPress={() => Alert.alert('Edit this break', 'Break times are edited in Profile â†’ Schedule settings.')} />
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
              Move {nameOf(resched, barberId)} Â· {durMin(resched)} min
            </Text>
            {/* ponytail: SlotPicker is light-themed; lives on a light sheet until a dark variant matters */}
            <SlotPicker barberId={barberId} durationMin={durMin(resched)}
              selected={reschedAt} onSelect={setReschedAt} />
            <Text style={s.reasonLabelLight}>Reason (optional) â€” tap any</Text>
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
                <Text style={s.sheetSub}>{nameOf(cancelling, barberId)} Â· {ampm(cancelling.starts_at)}</Text>
              </View>
            </View>
            <Text style={s.reasonLabel}>REASON (OPTIONAL) â€” TAP ANY</Text>
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
          <Text style={s.toastText} numberOfLines={1}>{nameOf(toast.booking, barberId)} â€” completed</Text>
          <Pressable onPress={undoComplete} accessibilityRole="button" accessibilityLabel="Undo completion"
            hitSlop={8} style={({ pressed }) => pressed && s.pressed}>
            <Text style={s.toastUndo}>UNDO</Text>
          </Pressable>
        </View>
      )}

    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  content: { paddingTop: 62, paddingHorizontal: 20, gap: 13, paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  spinner: { marginVertical: sp(8) },
  empty: { fontSize: font.small, color: D.sub, textAlign: 'center', marginTop: sp(6) },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  todayPill: {
    paddingHorizontal: 13, height: 32, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  navPuck: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  // 7-column grid: RN has no CSS grid, and a 100/7% width would overflow the gaps,
  // so the cell size is measured off the screen once.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  gridHead: { width: CELL, textAlign: 'center', marginBottom: 1 },
  cell: {
    width: CELL, height: CELL, borderRadius: 11, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  cellPast: { opacity: 0.4 },
  cellSel: { backgroundColor: colors.accent },
  cellOff: { backgroundColor: D.amberSoft },
  cellDot: { width: 4, height: 4, borderRadius: 999 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, backgroundColor: D.card2, paddingVertical: 8, paddingHorizontal: 14 },
  chipOn: { backgroundColor: colors.accent },

  agendaHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  agenda: { gap: 9 },
  agendaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 16, padding: 13, paddingHorizontal: 15,
  },
  agendaTime: { width: 42, fontVariant: ['tabular-nums'] },
  agendaEmpty: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 16,
    borderWidth: 1, borderStyle: 'dashed', borderColor: D.muted,
    paddingVertical: 14, paddingHorizontal: 15,
  },
  offBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine,
    borderRadius: 20, padding: 15, paddingHorizontal: 16,
  },
  offBannerLabel: { fontFamily: inter.b, fontSize: 10, color: AMBER, letterSpacing: 1.4 },
  offBannerText: { fontFamily: inter.b, fontSize: 13, color: D.text, marginTop: 2 },

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
