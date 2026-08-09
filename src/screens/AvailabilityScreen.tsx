import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Ico, Serif, T, Toggle } from '../components/dark';
import { Field } from '../components/ui';
import { setLastFix } from '../lib/lastFix';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, inter, radius, sp } from '../theme';

const AMBER = D.amber;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
const STEP = 30;

type DayRow = { open: boolean; start: string; end: string };
type OffRow = { id: string; day: string; label: string | null };
type BlockRow = { id: string; label: string | null; day: string | null; start_min: number; end_min: number };
type SheetKind = 'break' | 'dayoff' | 'vacation' | 'custom';

// how buffer conflicts get auto-fixed
type Strategy = 'trim' | 'extend' | 'shift';
const STRATEGIES: { key: Strategy; label: string }[] = [
  { key: 'trim', label: 'TRIM BUFFER' },
  { key: 'extend', label: 'EXTEND BREAK' },
  { key: 'shift', label: 'SHIFT HOURS' },
];
type FixPlan = {
  strategy: Strategy;
  targets: BlockRow[];                            // the conflicting blocks being addressed
  scopeDay: string | null;                        // null = entire week; iso = that day only
  blocks: { b: BlockRow; newEnd: number }[];      // extend / shift (updates)
  inserts: { b: BlockRow; day: string; start_min: number; end_min: number }[]; // day-scoped override of a recurring block
  buffer?: { before: number; after: number };     // trim
  hours?: { weekday: number; newEnd: string }[];  // shift: later closing per open day
};

// preview range bars: context + change colors (legend always names them in text)
const BAR = {
  ctx: 'rgba(255,255,255,0.08)',
  block: 'rgba(232,184,75,0.45)',
  added: '#E8B84B',
  overflow: 'rgba(210,59,59,0.55)',
};
type UndoPayload = {
  label: string;
  blocks: { id: string; end_min: number }[];
  insertedIds?: string[]; // day-override blocks created by the fix — undo deletes them
  buffer?: { before: number; after: number };
  hours?: DayRow[];
};

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prettyDay = (iso: string) => {
  const ds = new Date(`${iso}T12:00:00`).toDateString(); // "Mon Jul 21 2026"
  return `${ds.slice(0, 3)}, ${ds.slice(4, 10)}`;
};

function upcomingDays(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });
}

function TimeBox({ value, onChange, label, min = 0, max = 24 * 60 }: {
  value: string; onChange: (v: string) => void; label: string; min?: number; max?: number;
}) {
  const mins = toMin(value);
  const step = (delta: number) => {
    const next = mins + delta;
    if (next >= min && next <= max) onChange(toHHMM(next));
  };
  return (
    <View style={s.timeBox}>
      <Pressable onPress={() => step(-STEP)} hitSlop={10} accessibilityLabel={`${label} earlier`}
        style={({ pressed }) => pressed && s.pressed}>
        <Ionicons name="remove" size={13} color={D.sub} />
      </Pressable>
      <Text style={s.timeText}>{value}</Text>
      <Pressable onPress={() => step(STEP)} hitSlop={10} accessibilityLabel={`${label} later`}
        style={({ pressed }) => pressed && s.pressed}>
        <Ionicons name="add" size={13} color={D.sub} />
      </Pressable>
    </View>
  );
}

// one half of 1u's BOOKING BUFFERS card — a big tabular number over five preset chips
function BufferCol({ icon, label, value, onPick }: {
  icon: 'log-in-outline' | 'log-out-outline'; label: string;
  value: number; onPick: (v: number) => void;
}) {
  return (
    <View style={s.bufCol}>
      <View style={s.bufColHead}>
        <Ionicons name={icon} size={12} color={D.sub} />
        <Text style={s.bufColLabel}>{label}</Text>
      </View>
      <Text style={s.bufValue}>{value} <Text style={s.bufUnit}>min</Text></Text>
      <View style={s.chipWrap}>
        {[0, 5, 10, 15, 30].map((v) => (
          <Pressable key={v} onPress={() => onPick(v)}
            accessibilityLabel={`${label.toLowerCase()} ${v} minutes`}
            accessibilityState={{ selected: value === v }}
            style={({ pressed }) => [s.bufChip, value === v && s.bufChipOn, pressed && s.pressed]}>
            <Text style={[s.bufChipText, value === v && s.bufChipTextOn]}>{v}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// stacked-lane minute bar: each lane is a list of [from,to] segments on a shared domain
function RangeBar({ domain, lanes }: {
  domain: [number, number];
  lanes: { from: number; to: number; color: string }[][];
}) {
  const [d0, d1] = domain;
  const span = Math.max(1, d1 - d0);
  const clamp = (v: number) => Math.max(d0, Math.min(d1, v));
  return (
    <View style={s.rbWrap}>
      {lanes.map((segs, li) => (
        <View key={li} style={s.rbLane}>
          {segs.map((seg, i) => (
            <View key={i} style={[s.rbSeg, {
              left: `${((clamp(seg.from) - d0) / span) * 100}%` as const,
              width: `${((clamp(seg.to) - clamp(seg.from)) / span) * 100}%` as const,
              backgroundColor: seg.color,
            }]} />
          ))}
        </View>
      ))}
      <View style={s.rbLabels}>
        <Text style={s.rbLabel}>{toHHMM(d0)}</Text>
        <Text style={s.rbLabel}>{toHHMM(d1)}</Text>
      </View>
    </View>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <View style={s.legendRow}>
      {items.map((it) => (
        <View key={it.label} style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: it.color }]} />
          <Text style={s.legendText}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function AvailabilityScreen({ barberId, onBack }: { barberId: string; onBack?: () => void }) {
  const [days, setDays] = useState<DayRow[]>(
    WEEKDAYS.map(() => ({ open: false, start: '09:00', end: '18:00' })),
  );
  const serverDays = useRef<DayRow[]>([]);
  const [accepting, setAccepting] = useState(true);
  // salon opening-hours envelope (0028) — barber hours must sit within it
  const [envelope, setEnvelope] = useState<{ open: number; close: number } | null>(null);
  // booking buffers: prep before + cleanup after every booking
  const [before, setBefore] = useState(0);
  const [after, setAfter] = useState(0);
  const [linkBoth, setLinkBoth] = useState(false);
  const serverBuf = useRef({ before: 0, after: 0 });
  const [seg, setSeg] = useState<'hours' | 'off'>('hours');
  const [daysOff, setDaysOff] = useState<OffRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [busy, setBusy] = useState(false);

  // previewed auto-fix plan (single conflict or Fix all)
  const [fixPreview, setFixPreview] = useState<FixPlan | null>(null);
  // last applied fix, revertible while the snackbar shows
  const [undoFix, setUndoFix] = useState<UndoPayload | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('extend');

  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  useEffect(() => {
    AsyncStorage.getItem(`fix-strategy:${barberId}`)
      .then((v) => { if (v === 'trim' || v === 'extend' || v === 'shift') setStrategy(v); });
  }, [barberId]);

  function pickStrategy(v: Strategy) {
    setStrategy(v);
    AsyncStorage.setItem(`fix-strategy:${barberId}`, v).catch(() => {});
  }

  // add-block sheet state
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [bufOpen, setBufOpen] = useState(false); // 1f shows the gap as one line; tap to tune it
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('13:30');
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId)
      .then(({ data }) => {
        if (!data) return;
        const next = WEEKDAYS.map((_, i) => {
          const row = data.find((r) => r.weekday === i);
          return row ? { open: true, start: toHHMM(row.start_min), end: toHHMM(row.end_min) }
            : { open: false, start: '09:00', end: '18:00' };
        });
        serverDays.current = next.map((d) => ({ ...d }));
        setDays(next);
      });
    supabase.from('barbers').select('accepting_bookings, buffer_before_min, buffer_after_min, salon_id')
      .eq('id', barberId).single()
      .then(({ data }) => {
        if (!data) return;
        setAccepting(data.accepting_bookings);
        setBefore(data.buffer_before_min); setAfter(data.buffer_after_min);
        serverBuf.current = { before: data.buffer_before_min, after: data.buffer_after_min };
        if (data.salon_id) {
          supabase.from('salons').select('open_min, close_min').eq('id', data.salon_id).single()
            .then(({ data: sal }) => {
              if (sal && !(sal.open_min === 0 && sal.close_min === 1440)) {
                setEnvelope({ open: sal.open_min, close: sal.close_min });
              }
            });
        }
      });
    loadOff();
  }, [barberId]);

  async function loadOff() {
    const [off, blk] = await Promise.all([
      supabase.from('days_off').select('id, day, label').eq('barber_id', barberId)
        .gte('day', isoOf(new Date())).order('day'),
      // breaks only — an 'open' row (8k) is room he made on one date, not a
      // recurring block, and it has no business in the breaks editor
      supabase.from('time_blocks').select('id, label, day, start_min, end_min')
        .eq('barber_id', barberId).eq('kind', 'block').order('created_at'),
    ]);
    setDaysOff((off.data ?? []) as OffRow[]);
    setBlocks((blk.data ?? []) as BlockRow[]);
  }

  async function toggleAccepting(v: boolean) {
    setAccepting(v);
    const { error } = await supabase.from('barbers')
      .update({ accepting_bookings: v }).eq('id', barberId);
    if (error) { setAccepting(!v); Alert.alert('Could not update', error.message); }
  }

  function setDay(i: number, patch: Partial<DayRow>) {
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  function copyToAll() {
    const first = DISPLAY_ORDER.map((i) => days[i]).find((d) => d.open);
    if (!first) return;
    setDays((prev) => prev.map((d) => (d.open ? { ...d, start: first.start, end: first.end } : d)));
  }

  async function save() {
    const rows = [];
    for (let i = 0; i < 7; i++) {
      if (!days[i].open) continue;
      if (toMin(days[i].end) <= toMin(days[i].start)) {
        return Alert.alert('Invalid hours', `${WEEKDAYS[i]}: closing time must be after opening.`);
      }
      if (envelope && (toMin(days[i].start) < envelope.open || toMin(days[i].end) > envelope.close)) {
        return Alert.alert('Outside salon hours',
          `${WEEKDAYS[i]}: hours must be within the salon's ${toHHMM(envelope.open)}–${toHHMM(envelope.close)}.`);
      }
      rows.push({ barber_id: barberId, weekday: i, start_min: toMin(days[i].start), end_min: toMin(days[i].end) });
    }
    setBusy(true);
    // ponytail: replace-all sync — delete own rows, insert the open ones
    const del = await supabase.from('availability').delete().eq('barber_id', barberId);
    const ins = rows.length ? await supabase.from('availability').insert(rows) : { error: null };
    const buf = await supabase.from('barbers')
      .update({ buffer_before_min: before, buffer_after_min: after }).eq('id', barberId);
    setBusy(false);
    const error = del.error ?? ins.error ?? buf.error;
    if (error) Alert.alert('Could not save', error.message);
    else {
      serverDays.current = days.map((d) => ({ ...d }));
      serverBuf.current = { before, after };
      Alert.alert('Saved', 'Your availability is updated.');
    }
  }

  function cancel() {
    if (serverDays.current.length) setDays(serverDays.current.map((d) => ({ ...d })));
    setBefore(serverBuf.current.before);
    setAfter(serverBuf.current.after);
  }

  function pickBefore(v: number) { setBefore(v); if (linkBoth) setAfter(v); }
  function pickAfter(v: number) { setAfter(v); if (linkBoth) setBefore(v); }

  // build the previewable change-set for the chosen strategy; nothing writes until applyPlan.
  // scopeDay (extend only): recurring blocks get a dated override on that day instead of
  // a weekly change; dated blocks on other days drop out of the plan.
  function buildPlan(strat: Strategy, targets: BlockRow[], scopeDay: string | null = null): FixPlan {
    const gap = before + after;
    if (strat === 'trim') {
      // shrink the gap to fit the shortest conflicting block: shed cleanup first, then prep
      const minLen = Math.min(...targets.map((b) => b.end_min - b.start_min));
      const deficit = gap - minLen;
      const afterNew = Math.max(0, after - deficit);
      const beforeNew = Math.max(0, before - (deficit - (after - afterNew)));
      return { strategy: strat, targets, scopeDay: null, blocks: [], inserts: [], buffer: { before: beforeNew, after: afterNew } };
    }
    if (strat === 'extend' && scopeDay) {
      return {
        strategy: strat, targets, scopeDay,
        blocks: targets.filter((b) => b.day === scopeDay)
          .map((b) => ({ b, newEnd: Math.min(1440, b.start_min + gap) })),
        inserts: targets.filter((b) => b.day === null)
          .map((b) => ({ b, day: scopeDay, start_min: b.start_min, end_min: Math.min(1440, b.start_min + gap) })),
      };
    }
    const blockChanges = targets.map((b) => ({ b, newEnd: Math.min(1440, b.start_min + gap) }));
    if (strat === 'extend') return { strategy: strat, targets, scopeDay: null, blocks: blockChanges, inserts: [] };
    // shift: extend the blocks AND close later so bookable time is preserved.
    // ponytail: hours are weekly, so only recurring (every-day) blocks can be compensated;
    // dated blocks just extend, same as 'extend'.
    const delta = targets.filter((b) => b.day === null)
      .reduce((a, b) => a + (gap - (b.end_min - b.start_min)), 0);
    const hours = delta > 0
      ? days.map((d, weekday) => ({ d, weekday }))
        .filter(({ d }) => d.open)
        .map(({ d, weekday }) => ({ weekday, newEnd: toHHMM(Math.min(envelope?.close ?? 1440, toMin(d.end) + delta)) }))
        .filter(({ weekday, newEnd }) => newEnd !== days[weekday].end)
      : [];
    return { strategy: strat, targets, scopeDay: null, blocks: blockChanges, inserts: [], hours };
  }

  // representative working window for a block's day (recurring → span of all open days)
  function windowFor(day: string | null): { start: number; end: number } | null {
    if (day === null) {
      const open = days.filter((d) => d.open);
      if (!open.length) return null;
      return { start: Math.min(...open.map((d) => toMin(d.start))), end: Math.max(...open.map((d) => toMin(d.end))) };
    }
    const wd = days[new Date(`${day}T12:00:00`).getDay()];
    return wd.open ? { start: toMin(wd.start), end: toMin(wd.end) } : null;
  }

  // replace-all write of weekly hours from a DayRow[7] (same sync save() uses)
  async function writeHours(rows: DayRow[]) {
    const inserts = rows.flatMap((d, i) => d.open
      ? [{ barber_id: barberId, weekday: i, start_min: toMin(d.start), end_min: toMin(d.end) }] : []);
    const del = await supabase.from('availability').delete().eq('barber_id', barberId);
    const ins = inserts.length ? await supabase.from('availability').insert(inserts) : { error: null };
    return del.error ?? ins.error;
  }

  async function applyPlan(plan: FixPlan) {
    const nChanges = plan.blocks.length + plan.inserts.length;
    const undo: UndoPayload = {
      label: plan.strategy === 'trim' ? 'Buffers trimmed'
        : plan.strategy === 'shift' ? 'Breaks extended, hours shifted'
        : plan.scopeDay ? `Fixed for ${prettyDay(plan.scopeDay)} only`
        : nChanges === 1 && plan.blocks.length ? `"${plan.blocks[0].b.label ?? 'Block'}" extended`
        : `${nChanges} blocks extended`,
      blocks: plan.blocks.map(({ b }) => ({ id: b.id, end_min: b.end_min })),
    };
    let error = null;
    if (plan.blocks.length) {
      const results = await Promise.all(plan.blocks.map(({ b, newEnd }) =>
        supabase.from('time_blocks').update({ end_min: newEnd }).eq('id', b.id)));
      error = results.find((r) => r.error)?.error ?? null;
    }
    let insertedIds: string[] = [];
    if (!error && plan.inserts.length) {
      const { data, error: insErr } = await supabase.from('time_blocks')
        .insert(plan.inserts.map(({ b, day, start_min, end_min }) => ({
          barber_id: barberId, label: b.label, day, start_min, end_min,
        })))
        .select('id');
      error = insErr;
      insertedIds = (data ?? []).map((r) => r.id);
      undo.insertedIds = insertedIds;
    }
    if (!error && plan.buffer) {
      undo.buffer = { before, after };
      const res = await supabase.from('barbers')
        .update({ buffer_before_min: plan.buffer.before, buffer_after_min: plan.buffer.after })
        .eq('id', barberId);
      error = res.error;
      if (!error) {
        setBefore(plan.buffer.before); setAfter(plan.buffer.after);
        serverBuf.current = { ...plan.buffer };
      }
    }
    if (!error && plan.hours?.length) {
      undo.hours = days.map((d) => ({ ...d }));
      const next = days.map((d, i) => {
        const h = plan.hours!.find((x) => x.weekday === i);
        return h ? { ...d, end: h.newEnd } : d;
      });
      error = await writeHours(next);
      if (!error) {
        setDays(next);
        serverDays.current = next.map((d) => ({ ...d }));
      }
    }
    if (error) Alert.alert('Could not apply fix', error.message);
    else {
      setUndoFix(undo);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndoFix(null), 6000);
      setLastFix([...plan.blocks.map(({ b }) => b.id), ...insertedIds]); // MY DAY glows these once
    }
    setFixPreview(null);
    loadOff();
  }

  async function undoLastFix() {
    if (!undoFix) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    let error = null;
    if (undoFix.blocks.length) {
      const results = await Promise.all(undoFix.blocks.map((b) =>
        supabase.from('time_blocks').update({ end_min: b.end_min }).eq('id', b.id)));
      error = results.find((r) => r.error)?.error ?? null;
    }
    if (!error && undoFix.insertedIds?.length) {
      const res = await supabase.from('time_blocks').delete().in('id', undoFix.insertedIds);
      error = res.error;
    }
    if (!error && undoFix.buffer) {
      const res = await supabase.from('barbers')
        .update({ buffer_before_min: undoFix.buffer.before, buffer_after_min: undoFix.buffer.after })
        .eq('id', barberId);
      error = res.error;
      if (!error) {
        setBefore(undoFix.buffer.before); setAfter(undoFix.buffer.after);
        serverBuf.current = { ...undoFix.buffer };
      }
    }
    if (!error && undoFix.hours) {
      error = await writeHours(undoFix.hours);
      if (!error) {
        setDays(undoFix.hours.map((d) => ({ ...d })));
        serverDays.current = undoFix.hours.map((d) => ({ ...d }));
      }
    }
    if (error) Alert.alert('Could not undo', error.message);
    else setLastFix(undoFix.blocks.map((b) => b.id)); // reverted blocks glow too
    setUndoFix(null);
    loadOff();
  }

  function openSheet(kind: SheetKind) {
    setLabel(''); setPickedDay(null); setRangeStart(null); setRangeEnd(null);
    setStart(kind === 'break' ? '13:00' : '15:00');
    setEnd(kind === 'break' ? '13:30' : '16:00');
    setSheet(kind);
  }

  async function addBreakOrCustom() {
    if (toMin(end) <= toMin(start)) return Alert.alert('Invalid time', 'End must be after start.');
    if (sheet === 'custom' && !pickedDay) return Alert.alert('Pick a date', 'Choose the day to block.');
    const { error } = await supabase.from('time_blocks').insert({
      barber_id: barberId,
      label: label.trim() || (sheet === 'break' ? 'Break' : 'Blocked'),
      day: sheet === 'break' ? null : pickedDay,
      start_min: toMin(start), end_min: toMin(end),
    });
    if (error) return Alert.alert('Could not add', error.message);
    setSheet(null); loadOff();
  }

  async function addDayOff(iso: string) {
    const { error } = await supabase.from('days_off')
      .insert({ barber_id: barberId, day: iso, label: 'Day off' });
    if (error) return Alert.alert('Could not add', error.message);
    setSheet(null); loadOff();
  }

  async function addVacation() {
    if (!rangeStart || !rangeEnd) return Alert.alert('Pick the dates', 'Choose first and last day.');
    const from = new Date(`${rangeStart}T12:00:00`);
    const to = new Date(`${rangeEnd}T12:00:00`);
    const rows = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      rows.push({ barber_id: barberId, day: isoOf(d), label: 'Vacation' });
    }
    const { error } = await supabase.from('days_off')
      .upsert(rows, { onConflict: 'barber_id,day', ignoreDuplicates: true });
    if (error) return Alert.alert('Could not add', error.message);
    setSheet(null); loadOff();
  }

  async function removeOff(kind: 'block' | 'day', id: string) {
    await supabase.from(kind === 'block' ? 'time_blocks' : 'days_off').delete().eq('id', id);
    loadOff();
  }

  function pickVacationDay(iso: string) {
    if (!rangeStart || (rangeStart && rangeEnd)) { setRangeStart(iso); setRangeEnd(null); return; }
    if (iso < rangeStart) { setRangeStart(iso); return; }
    setRangeEnd(iso);
  }

  const openCount = days.filter((d) => d.open).length;
  const totalGap = before + after;
  // a block shorter than the total gap gets swallowed by the buffers around it
  const conflicts = totalGap > 0
    ? blocks.filter((b) => b.end_min - b.start_min < totalGap)
    : [];
  // 1f draws one preview card per conflict the chosen strategy would move
  const previews = conflicts.length ? buildPlan(strategy, conflicts).blocks : [];
  // unified time-off list: recurring blocks first, then dated items chronologically
  const offList = [
    ...blocks.filter((b) => b.day === null).map((b) => ({ kind: 'block' as const, b, sortKey: '' })),
    ...[
      ...blocks.filter((b) => b.day !== null).map((b) => ({ kind: 'block' as const, b, sortKey: b.day! })),
      ...daysOff.map((o) => ({ kind: 'day' as const, b: null as unknown as BlockRow, o, sortKey: o.day })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
  ] as ({ kind: 'block'; b: BlockRow; sortKey: string } | { kind: 'day'; o: OffRow; sortKey: string })[];

  const vacationLabel = rangeStart && rangeEnd
    ? `Add vacation (${Math.round((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / 86_400_000) + 1} days)`
    : 'Pick first and last day';

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* header */}
        <View style={s.head}>
          {onBack
            ? <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back"
                style={({ pressed }) => [s.backBtn, pressed && s.pressed]}>
                <Ico name="arrow-left" size={16} />
              </Pressable>
            : <View style={s.headSide} />}
          <Serif size={17} ls={0.16} style={s.headTitle}>Schedule</Serif>
          <View style={s.headSide} />
        </View>

        {/* the gap in one line; the pill opens the prep/cleanup detail */}
        <Pressable onPress={() => setBufOpen(!bufOpen)} accessibilityRole="button"
          accessibilityState={{ expanded: bufOpen }} accessibilityLabel="Buffer between clients"
          style={({ pressed }) => [s.bufRow, pressed && s.pressed]}>
          <View style={s.grow}>
            <T w="b" size={13}>Buffer between clients</T>
            <T size={11} c={D.sub} style={{ marginTop: 2 }}>{before} min prep · {after} min cleanup</T>
          </View>
          <View style={s.bufPill}><T w="b" size={12}>{totalGap} min</T></View>
        </Pressable>

        {bufOpen && (
          <View style={s.bufCard}>
            <View style={s.bufHead}>
              <View style={s.bufTitleRow}>
                <Ico name="shield" size={14} color={D.sub} />
                <Text style={s.sectionLabel}>BOOKING BUFFERS</Text>
              </View>
              <Pressable onPress={() => { setLinkBoth(!linkBoth); if (!linkBoth) setAfter(before); }}
                accessibilityLabel="Link both buffers" accessibilityState={{ checked: linkBoth }}
                style={({ pressed }) => [s.linkRow, pressed && s.pressed]}>
                <View style={[s.miniTrack, linkBoth && s.miniTrackOn]}>
                  <View style={[s.miniThumb, linkBoth && s.miniThumbOn]} />
                </View>
                <Text style={s.linkText}>LINK BOTH</Text>
              </Pressable>
            </View>
            <Text style={s.cardNote}>
              Auto-protect gaps around every booking. Clients won't see these slots.
            </Text>
            <View style={s.bufCols}>
              <BufferCol icon="log-in-outline" label="PREP BEFORE" value={before} onPick={pickBefore} />
              <View style={s.bufDivider} />
              <BufferCol icon="log-out-outline" label="CLEANUP AFTER" value={after} onPick={pickAfter} />
            </View>
          </View>
        )}

        {/* buffer conflicts */}
        {conflicts.length > 0 && (
          <>
            <View style={s.conflictHead}>
              <T w="b" size={11} c={D.red} ls={1.65} style={s.grow}>
                {conflicts.length} BUFFER CONFLICT{conflicts.length === 1 ? '' : 'S'}
              </T>
              {conflicts.length > 1 && (
                <Pressable onPress={() => setFixPreview(buildPlan(strategy, conflicts))}
                  accessibilityRole="button" accessibilityLabel="Fix all conflicts"
                  style={({ pressed }) => [s.fixPill, pressed && s.pressed]}>
                  <T w="b" size={11}>Fix all</T>
                </Pressable>
              )}
            </View>
            <View style={{ gap: 8 }}>
              {conflicts.map((b) => (
                <View key={b.id} style={s.conflictRow}>
                  <View style={[s.swatch, { backgroundColor: b.day === null ? AMBER : 'rgba(232,161,0,0.5)' }]} />
                  <View style={s.grow}>
                    <T w="b" size={13}>
                      {b.label ?? 'Blocked'} · {toHHMM(b.start_min)} – {toHHMM(b.end_min)}
                    </T>
                    <T size={11} c={D.red} style={{ marginTop: 2 }}>
                      Buffer needs {totalGap} min, only {b.end_min - b.start_min} free
                    </T>
                  </View>
                  <Pressable onPress={() => setFixPreview(buildPlan(strategy, [b]))}
                    accessibilityRole="button" accessibilityLabel={`Fix conflict with ${b.label ?? 'block'}`}
                    style={({ pressed }) => [s.fixPill, pressed && s.pressed]}>
                    <T w="b" size={11}>Fix</T>
                  </Pressable>
                </View>
              ))}
            </View>

            <T w="b" size={11} c={D.sub} ls={1.65} style={{ marginTop: 2 }}>HOW TO FIX IT</T>
            <View style={s.stratRowNew}>
              {STRATEGIES.map((st) => (
                <Pressable key={st.key} onPress={() => pickStrategy(st.key)}
                  accessibilityRole="button" accessibilityLabel={`Auto-fix strategy: ${st.label}`}
                  accessibilityState={{ selected: strategy === st.key }}
                  style={({ pressed }) => [s.stratBtn, strategy === st.key && s.stratBtnOn, pressed && s.pressed]}>
                  <T w="b" size={11} ls={0.55} c={strategy === st.key ? '#fff' : D.sub}>
                    {st.label.toUpperCase()}
                  </T>
                </Pressable>
              ))}
            </View>

            {/* what the chosen strategy would do, per conflict */}
            {previews.map(({ b, newEnd }, i) => {
              const win = windowFor(b.day);
              // the working window IS the domain — lane 1 fills it end to end, as 1f draws it
              const d0 = Math.min(win?.start ?? b.start_min, b.start_min);
              const d1 = Math.max(win?.end ?? newEnd, newEnd);
              const rest = previews.length - 1;
              return (
                <View key={b.id} style={{ gap: 13 }}>
                  <View style={s.previewCard}>
                    <View>
                      <T w="b" size={13}>
                        {b.label ?? 'Blocked'} → {toHHMM(b.start_min)} – {toHHMM(newEnd)}
                      </T>
                      <T size={11} c={D.sub} style={{ marginTop: 3 }}>
                        Adds {newEnd - b.end_min} min so the buffer fits.{' '}
                        {b.day === null ? 'Every day.' : prettyDay(b.day) + ' only.'}
                      </T>
                    </View>
                    <RangeBar domain={[d0, d1]} lanes={[
                      [{ from: d0, to: d1, color: BAR.ctx }],
                      [{ from: b.start_min, to: b.end_min, color: BAR.block }],
                      [{ from: b.end_min, to: newEnd, color: BAR.added }],
                    ]} />
                    <Legend items={[
                      { color: BAR.ctx, label: 'working hours' },
                      { color: BAR.block, label: 'break now' },
                      { color: BAR.added, label: 'added' },
                    ]} />
                  </View>
                  {i === 0 && (
                    <T size={11} c={D.sub} style={s.footnote}>
                      Nothing is saved until you apply.
                      {rest === 1 ? ` “${previews[1].b.label ?? 'Blocked'}” has its own preview below.`
                        : rest > 1 ? ` ${rest} more previews below.` : ''}
                    </T>
                  )}
                </View>
              );
            })}
          </>
        )}

        {/* accepting bookings */}
        <View style={s.card}>
          <View style={s.grow}>
            <Text style={s.cardTitle}>Accepting bookings</Text>
            <Text style={s.cardSub}>Open {openCount} day{openCount === 1 ? '' : 's'}/week</Text>
          </View>
          <Toggle on={accepting} onPress={() => toggleAccepting(!accepting)} color={colors.accent} />
        </View>

        {/* segment */}
        <View style={s.segment}>
          <Pressable onPress={() => setSeg('hours')} accessibilityState={{ selected: seg === 'hours' }}
            style={[s.segItem, seg === 'hours' && s.segOn]}>
            <Text style={[s.segText, seg === 'hours' && s.segTextOn]}>WEEKLY HOURS</Text>
          </Pressable>
          <Pressable onPress={() => setSeg('off')} accessibilityState={{ selected: seg === 'off' }}
            style={[s.segItem, seg === 'off' && s.segOn]}>
            <Text style={[s.segText, seg === 'off' && s.segTextOn]}>TIME OFF</Text>
          </Pressable>
        </View>

        {seg === 'hours' ? (
          <>
            <View style={s.sectionRow}>
              <Text style={s.sectionLabel}>RECURRING AVAILABILITY</Text>
              <Pressable onPress={copyToAll} hitSlop={6} accessibilityLabel="Copy first open day's hours to all"
                style={({ pressed }) => [s.copyAll, pressed && s.pressed]}>
                <Ionicons name="copy-outline" size={13} color={colors.accent} />
                <Text style={s.copyAllText}>Copy to all</Text>
              </Pressable>
            </View>
            {envelope && (
              <View style={s.envelopeHint}>
                <Ico name="home" size={14} color={D.sub} />
                <Text style={s.envelopeText}>Salon is open {toHHMM(envelope.open)}–{toHHMM(envelope.close)} — set your hours within it.</Text>
              </View>
            )}
            <View style={s.stack9}>
            {DISPLAY_ORDER.map((i) => {
              const d = days[i];
              const name = WEEKDAYS[i].slice(0, 3);
              return (
                <View key={i} style={[s.dayCard, !d.open && s.dayCardClosed]}>
                  <Pressable onPress={() => setDay(i, { open: !d.open })}
                    accessibilityLabel={`${WEEKDAYS[i]} ${d.open ? 'open' : 'closed'}`}
                    style={({ pressed }) => [s.check, d.open ? s.checkOn : s.checkOff, pressed && s.pressed]}>
                    {d.open
                      ? <Ionicons name="checkmark" size={16} color={colors.accent} />
                      : <Text style={s.checkLetter}>{name[0]}</Text>}
                  </Pressable>
                  <View style={s.grow}>
                    <Text style={s.dayName}>{name}</Text>
                    <Text style={s.cardSub}>{d.open ? `${d.start} — ${d.end}` : 'Closed'}</Text>
                    {d.open && (
                      <View style={s.timesRow}>
                        <TimeBox value={d.start} label={`${WEEKDAYS[i]} opening`}
                          min={envelope?.open ?? 0} max={envelope?.close ?? 24 * 60}
                          onChange={(v) => setDay(i, { start: v })} />
                        <Text style={s.dash}>–</Text>
                        <TimeBox value={d.end} label={`${WEEKDAYS[i]} closing`}
                          min={envelope?.open ?? 0} max={envelope?.close ?? 24 * 60}
                          onChange={(v) => setDay(i, { end: v })} />
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
            </View>
          </>
        ) : (
          <>
            {/* 1u: the block kinds sit inside TIME OFF, above the list they add to */}
            <Text style={s.sectionLabel}>ADD A BLOCK</Text>
            <View style={s.addRow}>
              {([['break', 'BREAK', 'coffee', AMBER], ['dayoff', 'DAY OFF', 'slash', D.sub],
                ['vacation', 'VACATION', 'calendar', D.sub]] as const).map(([kind, label, icon, tint]) => (
                <Pressable key={kind} onPress={() => openSheet(kind)} accessibilityRole="button"
                  accessibilityLabel={label}
                  style={({ pressed }) => [s.addBtn, pressed && s.pressed]}>
                  <Ico name={icon} size={14} color={tint} />
                  <T w="b" size={12} c={tint}>{label}</T>
                </Pressable>
              ))}
            </View>

            <Text style={s.sectionLabel}>BLOCKS • {offList.length}</Text>

            <View style={s.stack9}>
            {offList.map((item) => item.kind === 'block' ? (
              <View key={`b-${item.b.id}`} style={s.blockRow}>
                <View style={[s.blockIcon, item.b.day === null && s.blockIconBreak]}>
                  <Ionicons name={item.b.day === null ? 'cafe' : 'time-outline'} size={17}
                    color={item.b.day === null ? '#E8B84B' : D.text} />
                </View>
                <View style={s.grow}>
                  <Text style={s.cardTitle}>{item.b.label ?? 'Blocked'}</Text>
                  <Text style={s.cardSub}>
                    {item.b.day === null ? 'Every day' : prettyDay(item.b.day)} • {toHHMM(item.b.start_min)} – {toHHMM(item.b.end_min)}
                  </Text>
                </View>
                <Pressable onPress={() => removeOff('block', item.b.id)} hitSlop={6}
                  accessibilityLabel={`Remove ${item.b.label ?? 'block'}`}
                  style={({ pressed }) => pressed && s.pressed}>
                  <Ionicons name="trash-outline" size={17} color={D.sub} />
                </Pressable>
              </View>
            ) : (
              <View key={`d-${item.o.id}`} style={s.blockRow}>
                <View style={[s.blockIcon, s.blockIconOff]}>
                  <Ionicons name="ban" size={17} color={colors.accent} />
                </View>
                <View style={s.grow}>
                  <Text style={s.cardTitle}>{item.o.label ?? 'Day off'}</Text>
                  <Text style={s.cardSub}>{prettyDay(item.o.day)} • All day</Text>
                </View>
                <Pressable onPress={() => removeOff('day', item.o.id)} hitSlop={6}
                  accessibilityLabel={`Remove ${item.o.label ?? 'day off'}`}
                  style={({ pressed }) => pressed && s.pressed}>
                  <Ionicons name="trash-outline" size={17} color={D.sub} />
                </Pressable>
              </View>
            ))}

            <Pressable onPress={() => openSheet('custom')} accessibilityLabel="Block off custom time"
              style={({ pressed }) => [s.customRow, pressed && s.pressed]}>
              <Ionicons name="add" size={15} color={D.sub} />
              <Text style={s.customText}>Block off custom time</Text>
            </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      {/* undo snackbar */}
      {undoFix && (
        <View style={s.snackbar}>
          <Ionicons name="checkmark-circle-outline" size={16} color={D.green} />
          <Text style={s.snackText} numberOfLines={1}>{undoFix.label}</Text>
          <Pressable onPress={undoLastFix} hitSlop={8} accessibilityLabel="Undo last fix"
            style={({ pressed }) => pressed && s.pressed}>
            <Text style={s.snackUndo}>UNDO</Text>
          </Pressable>
        </View>
      )}

      {/* bottom bar */}
      <View style={s.bottomBar}>
        <Pressable onPress={cancel} accessibilityLabel="Cancel"
          style={({ pressed }) => [s.cancelBtn, pressed && s.pressed]}>
          <Text style={s.cancelText}>Cancel</Text>
        </Pressable>
        <Pressable onPress={save} disabled={busy} accessibilityLabel="Save availability"
          style={({ pressed }) => [s.saveBtn, pressed && s.pressed]}>
          <Text style={s.saveText}>{busy ? 'Saving…' : 'Save availability'}</Text>
        </Pressable>
      </View>

      {/* buffer-fix preview */}
      <Modal visible={!!fixPreview} transparent animationType="slide" onRequestClose={() => setFixPreview(null)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setFixPreview(null)} />
        {fixPreview && (() => {
          const n = fixPreview.blocks.length + fixPreview.inserts.length
            + (fixPreview.buffer ? 1 : 0) + (fixPreview.hours?.length ?? 0);
          return (
            <View style={s.sheet}>
              <Text style={s.sheetTitle}>Preview — {n} change{n === 1 ? '' : 's'}</Text>
              <Text style={s.cardSub}>
                {fixPreview.strategy === 'trim'
                  ? 'Buffers shrink to fit the break. This gap applies around every booking.'
                  : fixPreview.strategy === 'shift'
                  ? 'Breaks extend to the buffer gap and your closing time moves later to keep the same bookable hours.'
                  : `Blocks extend to match your ${totalGap}-min buffer gap.`}
                {' '}Nothing is saved until you apply.
              </Text>
              {fixPreview.strategy === 'extend' && (
                <>
                  <View style={s.scopeRow}>
                    <Pressable onPress={() => setFixPreview(buildPlan('extend', fixPreview.targets, null))}
                      accessibilityLabel="Apply to entire week"
                      accessibilityState={{ selected: !fixPreview.scopeDay }}
                      style={({ pressed }) => [s.bufChip, !fixPreview.scopeDay && s.bufChipOn, pressed && s.pressed]}>
                      <Text style={[s.bufChipText, !fixPreview.scopeDay && s.bufChipTextOn]}>ENTIRE WEEK</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setFixPreview(buildPlan('extend', fixPreview.targets, fixPreview.scopeDay ?? isoOf(new Date())))}
                      accessibilityLabel="Apply to one day only"
                      accessibilityState={{ selected: !!fixPreview.scopeDay }}
                      style={({ pressed }) => [s.bufChip, !!fixPreview.scopeDay && s.bufChipOn, pressed && s.pressed]}>
                      <Text style={[s.bufChipText, !!fixPreview.scopeDay && s.bufChipTextOn]}>ONE DAY</Text>
                    </Pressable>
                  </View>
                  {fixPreview.scopeDay && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={s.dayStrip}>
                        {upcomingDays(14).map((d) => {
                          const iso = isoOf(d);
                          const on = fixPreview.scopeDay === iso;
                          return (
                            <Pressable key={iso}
                              onPress={() => setFixPreview(buildPlan('extend', fixPreview.targets, iso))}
                              accessibilityLabel={prettyDay(iso)}
                              style={({ pressed }) => [s.dayCell, on && s.dayCellOn, pressed && s.pressed]}>
                              <Text style={[s.dayCellWk, on && s.dayCellTextOn]}>{d.toDateString().slice(0, 3)}</Text>
                              <Text style={[s.dayCellNum, on && s.dayCellTextOn]}>{d.getDate()}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </ScrollView>
                  )}
                  {fixPreview.scopeDay && n === 0 && (
                    <Text style={s.cardSub}>No conflicting blocks touch {prettyDay(fixPreview.scopeDay)}.</Text>
                  )}
                </>
              )}
              {fixPreview.blocks.map(({ b, newEnd }) => {
                const win = windowFor(b.day);
                const d0 = Math.max(0, Math.min(win?.start ?? b.start_min, b.start_min) - 30);
                const d1 = Math.min(1440, Math.max(win?.end ?? newEnd, newEnd) + 30);
                return (
                  <View key={b.id} style={s.previewRow}>
                    <View style={[s.blockIcon, b.day === null && s.blockIconBreak]}>
                      <Ionicons name={b.day === null ? 'cafe' : 'time-outline'} size={17}
                        color={b.day === null ? '#E8B84B' : D.text} />
                    </View>
                    <View style={s.grow}>
                      <Text style={s.cardTitle}>{b.label ?? 'Blocked'}</Text>
                      <Text style={s.cardSub}>{b.day === null ? 'Every day' : prettyDay(b.day)}</Text>
                      <View style={s.previewDiff}>
                        <Text style={s.previewOld}>{toHHMM(b.start_min)} – {toHHMM(b.end_min)}</Text>
                        <Ionicons name="arrow-forward" size={13} color={D.sub} />
                        <Text style={s.previewNew}>{toHHMM(b.start_min)} – {toHHMM(newEnd)}</Text>
                        <Text style={s.previewDelta}>+{newEnd - b.end_min} min</Text>
                      </View>
                      <RangeBar domain={[d0, d1]} lanes={[
                        ...(win ? [[{ from: win.start, to: win.end, color: BAR.ctx }]] : []),
                        [{ from: b.start_min, to: b.end_min, color: BAR.block }],
                        [{ from: b.end_min, to: newEnd, color: BAR.added }],
                      ]} />
                      <Legend items={[
                        ...(win ? [{ color: BAR.ctx, label: 'working hours' }] : []),
                        { color: BAR.block, label: 'break now' },
                        { color: BAR.added, label: 'added' },
                      ]} />
                    </View>
                  </View>
                );
              })}
              {fixPreview.inserts.map(({ b, day, start_min, end_min }) => {
                const win = windowFor(day);
                const d0 = Math.max(0, Math.min(win?.start ?? start_min, start_min) - 30);
                const d1 = Math.min(1440, Math.max(win?.end ?? end_min, end_min) + 30);
                return (
                  <View key={`ins-${b.id}`} style={s.previewRow}>
                    <View style={[s.blockIcon, s.blockIconBreak]}>
                      <Ionicons name="calendar-outline" size={17} color="#E8B84B" />
                    </View>
                    <View style={s.grow}>
                      <Text style={s.cardTitle}>{b.label ?? 'Blocked'} — {prettyDay(day)} only</Text>
                      <Text style={s.cardSub}>weekly break stays {toHHMM(b.start_min)} – {toHHMM(b.end_min)}</Text>
                      <View style={s.previewDiff}>
                        <Text style={s.previewOld}>{toHHMM(b.start_min)} – {toHHMM(b.end_min)}</Text>
                        <Ionicons name="arrow-forward" size={13} color={D.sub} />
                        <Text style={s.previewNew}>{toHHMM(start_min)} – {toHHMM(end_min)}</Text>
                        <Text style={s.previewDelta}>+{end_min - b.end_min} min that day</Text>
                      </View>
                      <RangeBar domain={[d0, d1]} lanes={[
                        ...(win ? [[{ from: win.start, to: win.end, color: BAR.ctx }]] : []),
                        [{ from: b.start_min, to: b.end_min, color: BAR.block }],
                        [{ from: b.end_min, to: end_min, color: BAR.added }],
                      ]} />
                      <Legend items={[
                        ...(win ? [{ color: BAR.ctx, label: 'working hours' }] : []),
                        { color: BAR.block, label: 'break now' },
                        { color: BAR.added, label: 'added that day' },
                      ]} />
                    </View>
                  </View>
                );
              })}
              {fixPreview.buffer && (() => {
                const newGap = fixPreview.buffer.before + fixPreview.buffer.after;
                const anchor = [...fixPreview.targets]
                  .sort((a, b) => (a.end_min - a.start_min) - (b.end_min - b.start_min))[0];
                return (
                  <View style={s.previewRow}>
                    <View style={s.blockIcon}>
                      <Ionicons name="shield-outline" size={17} color={D.text} />
                    </View>
                    <View style={s.grow}>
                      <Text style={s.cardTitle}>Booking buffers</Text>
                      <Text style={s.cardSub}>Prep + cleanup, around every booking</Text>
                      <View style={s.previewDiff}>
                        <Text style={s.previewOld}>{before} + {after} min</Text>
                        <Ionicons name="arrow-forward" size={13} color={D.sub} />
                        <Text style={s.previewNew}>{fixPreview.buffer.before} + {fixPreview.buffer.after} min</Text>
                        <Text style={s.previewDelta}>−{totalGap - newGap} min gap</Text>
                      </View>
                      {anchor && (
                        <>
                          <RangeBar
                            domain={[Math.max(0, anchor.start_min - 30),
                              Math.min(1440, Math.max(anchor.start_min + totalGap, anchor.end_min) + 30)]}
                            lanes={[
                              [{ from: anchor.start_min, to: anchor.end_min, color: BAR.block }],
                              [{ from: anchor.start_min, to: anchor.start_min + totalGap, color: BAR.overflow }],
                              [{ from: anchor.start_min, to: anchor.start_min + newGap, color: colors.success }],
                            ]} />
                          <Legend items={[
                            { color: BAR.block, label: `"${anchor.label ?? 'break'}"` },
                            { color: BAR.overflow, label: 'gap now (overflows)' },
                            { color: colors.success, label: 'gap after fix' },
                          ]} />
                        </>
                      )}
                    </View>
                  </View>
                );
              })()}
              {fixPreview.hours?.map(({ weekday, newEnd }) => {
                const st = toMin(days[weekday].start);
                const oldEnd = toMin(days[weekday].end);
                const newEndMin = toMin(newEnd);
                return (
                  <View key={weekday} style={s.previewRow}>
                    <View style={s.blockIcon}>
                      <Ionicons name="time-outline" size={17} color={D.text} />
                    </View>
                    <View style={s.grow}>
                      <Text style={s.cardTitle}>{WEEKDAYS[weekday].slice(0, 3)} — closing time</Text>
                      <View style={s.previewDiff}>
                        <Text style={s.previewOld}>{days[weekday].end}</Text>
                        <Ionicons name="arrow-forward" size={13} color={D.sub} />
                        <Text style={s.previewNew}>{newEnd}</Text>
                      </View>
                      <RangeBar domain={[Math.max(0, st - 30), Math.min(1440, newEndMin + 30)]} lanes={[
                        [{ from: st, to: oldEnd, color: BAR.ctx }],
                        [{ from: oldEnd, to: newEndMin, color: colors.success }],
                      ]} />
                      <Legend items={[
                        { color: BAR.ctx, label: 'hours now' },
                        { color: colors.success, label: 'added' },
                      ]} />
                    </View>
                  </View>
                );
              })}
              <View style={s.previewActions}>
                <Pressable onPress={() => setFixPreview(null)} accessibilityLabel="Cancel"
                  style={({ pressed }) => [s.cancelBtn, pressed && s.pressed]}>
                  <Text style={s.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={() => applyPlan(fixPreview)} disabled={n === 0}
                  accessibilityLabel="Apply changes"
                  style={({ pressed }) => [s.saveBtn, n === 0 && s.btnDisabled, pressed && s.pressed]}>
                  <Text style={s.saveText}>Apply {n === 1 ? 'change' : `${n} changes`}</Text>
                </Pressable>
              </View>
            </View>
          );
        })()}
      </Modal>

      {/* add-block sheet */}
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
        <Pressable style={s.sheetBackdrop} onPress={() => setSheet(null)} />
        <View style={s.sheet}>
          <Text style={s.sheetTitle}>
            {sheet === 'break' ? 'Add a break' : sheet === 'dayoff' ? 'Day off'
              : sheet === 'vacation' ? 'Vacation' : 'Block off custom time'}
          </Text>

          {(sheet === 'break' || sheet === 'custom') && (
            <>
              <Field placeholder={sheet === 'break' ? 'Label (e.g. Lunch)' : 'Label (e.g. Dentist)'}
                placeholderTextColor={D.sub} style={s.darkField}
                value={label} onChangeText={setLabel} />
              {sheet === 'custom' && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.dayStrip}>
                    {upcomingDays(30).map((d) => {
                      const iso = isoOf(d);
                      const on = pickedDay === iso;
                      return (
                        <Pressable key={iso} onPress={() => setPickedDay(iso)}
                          accessibilityLabel={prettyDay(iso)}
                          style={({ pressed }) => [s.dayCell, on && s.dayCellOn, pressed && s.pressed]}>
                          <Text style={[s.dayCellWk, on && s.dayCellTextOn]}>{d.toDateString().slice(0, 3)}</Text>
                          <Text style={[s.dayCellNum, on && s.dayCellTextOn]}>{d.getDate()}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              )}
              <View style={s.sheetTimes}>
                <TimeBox value={start} label="Start" onChange={setStart} />
                <Text style={s.dash}>–</Text>
                <TimeBox value={end} label="End" onChange={setEnd} />
              </View>
              <Pressable onPress={addBreakOrCustom} accessibilityLabel="Add block"
                style={({ pressed }) => [s.saveBtn, pressed && s.pressed]}>
                <Text style={s.saveText}>{sheet === 'break' ? 'Add break (every day)' : 'Block this time'}</Text>
              </Pressable>
            </>
          )}

          {sheet === 'dayoff' && (
            <>
              <Text style={s.cardSub}>Tap the day the shop is closed.</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.dayStrip}>
                  {upcomingDays(30).map((d) => {
                    const iso = isoOf(d);
                    const taken = daysOff.some((o) => o.day === iso);
                    return (
                      <Pressable key={iso} disabled={taken} onPress={() => addDayOff(iso)}
                        accessibilityLabel={prettyDay(iso)}
                        style={({ pressed }) => [s.dayCell, taken && s.dayCellTaken, pressed && s.pressed]}>
                        <Text style={s.dayCellWk}>{d.toDateString().slice(0, 3)}</Text>
                        <Text style={s.dayCellNum}>{d.getDate()}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            </>
          )}

          {sheet === 'vacation' && (
            <>
              <Text style={s.cardSub}>
                {rangeStart && rangeEnd ? `${prettyDay(rangeStart)} → ${prettyDay(rangeEnd)}`
                  : rangeStart ? `${prettyDay(rangeStart)} → tap the last day`
                  : 'Tap the first day.'}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={s.dayStrip}>
                  {upcomingDays(60).map((d) => {
                    const iso = isoOf(d);
                    const inRange = rangeStart && iso >= rangeStart && (rangeEnd ? iso <= rangeEnd : iso === rangeStart);
                    return (
                      <Pressable key={iso} onPress={() => pickVacationDay(iso)}
                        accessibilityLabel={prettyDay(iso)}
                        style={({ pressed }) => [s.dayCell, inRange && s.dayCellOn, pressed && s.pressed]}>
                        <Text style={[s.dayCellWk, inRange && s.dayCellTextOn]}>{d.toDateString().slice(0, 3)}</Text>
                        <Text style={[s.dayCellNum, inRange && s.dayCellTextOn]}>{d.getDate()}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              <Pressable onPress={addVacation} disabled={!rangeStart || !rangeEnd}
                accessibilityLabel="Add vacation"
                style={({ pressed }) => [s.saveBtn, (!rangeStart || !rangeEnd) && s.btnDisabled, pressed && s.pressed]}>
                <Text style={s.saveText}>{vacationLabel}</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  // --- 1f / 1t / 1u, numbers lifted from the artboards
  bufRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: D.card, borderRadius: 18, padding: 14, paddingHorizontal: 16,
  },
  bufPill: {
    height: 32, borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  conflictHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fixPill: {
    height: 30, borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  conflictRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: D.card, borderRadius: 16, padding: 13, paddingHorizontal: 14,
  },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  stratRowNew: { flexDirection: 'row', gap: 8 },
  stratBtn: {
    flex: 1, height: 40, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  stratBtnOn: { backgroundColor: colors.accent },
  previewCard: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 13 },
  footnote: { lineHeight: 16.5 },
  addRow: { flexDirection: 'row', gap: 8 },
  addBtn: {
    flex: 1, height: 40, borderRadius: 999, backgroundColor: D.card2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },

  screen: { flex: 1, backgroundColor: D.bg },
  // 118 clears the save bar (14 + 48 + 30), same as the artboards' bottom padding
  content: { paddingTop: 62, paddingHorizontal: 20, gap: 13, paddingBottom: 118 },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  stack9: { gap: 9 },  // day cards and time-off rows sit tighter than the page gap

  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headSide: { width: 38 },
  backBtn: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  headTitle: { flex: 1, textAlign: 'center' },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 18, padding: 14, paddingHorizontal: 16,
  },
  cardTitle: { fontFamily: inter.sb, fontSize: 14, color: D.text },
  cardSub: { fontFamily: inter.r, fontSize: 11, color: D.sub, marginTop: 2 },
  cardNote: { fontFamily: inter.r, fontSize: 11, lineHeight: 16.5, color: D.sub },

  // booking buffers (1u) — the one card that sits on the raised surface
  bufCard: { backgroundColor: D.card2, borderRadius: 18, padding: 16, gap: 11 },
  bufHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bufTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  linkText: { fontFamily: inter.b, fontSize: 10, color: D.sub, letterSpacing: 1 },
  miniTrack: {
    width: 30, height: 18, borderRadius: 999, backgroundColor: D.muted,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2,
  },
  miniTrackOn: { backgroundColor: colors.accent, justifyContent: 'flex-end' },
  miniThumb: { width: 14, height: 14, borderRadius: 999, backgroundColor: D.sub },
  miniThumbOn: { backgroundColor: colors.onAccent },
  bufCols: { flexDirection: 'row', gap: 14 },
  bufCol: { flex: 1, gap: 8 },
  bufDivider: { width: 1, backgroundColor: '#2C2C31' },
  bufColHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bufColLabel: { fontFamily: inter.b, fontSize: 9, color: D.sub, letterSpacing: 1.08 },
  bufValue: { fontFamily: inter.b, fontSize: 20, color: D.text, fontVariant: ['tabular-nums'] },
  bufUnit: { fontFamily: inter.m, fontSize: 11, color: D.sub },
  chipWrap: { flexDirection: 'row', gap: 5 },
  bufChip: {
    flex: 1, height: 26, borderRadius: 8, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  bufChipOn: { backgroundColor: colors.accent },
  bufChipText: { fontFamily: inter.sb, fontSize: 11, color: D.sub },
  bufChipTextOn: { fontFamily: inter.b, color: colors.onAccent },

  // fix preview
  previewRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card2, borderRadius: radius.md, padding: sp(3.5),
  },
  previewDiff: { flexDirection: 'row', alignItems: 'center', gap: sp(2), marginTop: sp(1) },
  previewOld: {
    fontFamily: inter.r, fontSize: font.small, color: D.sub, textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  previewNew: { fontFamily: inter.b, fontSize: font.small, color: D.text, fontVariant: ['tabular-nums'] },
  previewDelta: { fontFamily: inter.b, fontSize: font.tiny, color: '#E8B84B' },
  previewActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: sp(1) },

  scopeRow: { flexDirection: 'row', gap: 5 },

  // preview range bars — three 9px lanes on the #212125 track, as 1f draws them
  rbWrap: { gap: 5 },
  rbLane: { height: 9, borderRadius: 4, backgroundColor: D.card2, overflow: 'hidden' },
  rbSeg: { position: 'absolute', top: 0, bottom: 0 },
  rbLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  rbLabel: { fontFamily: inter.r, fontSize: 10, color: D.sub, fontVariant: ['tabular-nums'] },
  legendRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 14,
    borderTopWidth: 1, borderTopColor: D.border, paddingTop: 12,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 3 },
  legendText: { fontFamily: inter.r, fontSize: 10, color: D.sub },

  segment: { flexDirection: 'row', backgroundColor: D.card, borderRadius: 14, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: D.card2 },
  segText: { fontFamily: inter.b, fontSize: 11, color: D.sub, letterSpacing: 0.88 },
  segTextOn: { color: D.text },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontFamily: inter.b, fontSize: 11, color: D.sub, letterSpacing: 1.65 },
  envelopeHint: {
    flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: D.card,
    borderRadius: 14, padding: 12, paddingHorizontal: 14,
  },
  envelopeText: { flex: 1, fontFamily: inter.r, fontSize: 11, lineHeight: 16, color: D.sub },
  copyAll: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  copyAllText: { fontFamily: inter.sb, fontSize: 12, color: colors.accent },

  dayCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: D.card, borderRadius: 18, padding: 14,
  },
  dayCardClosed: { alignItems: 'center' },
  check: { width: 34, height: 34, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: D.accentSoft },
  checkOff: { borderWidth: 1.5, borderColor: D.muted },
  checkLetter: { fontFamily: inter.b, fontSize: 12, color: D.sub },
  dayName: { fontFamily: inter.b, fontSize: 14, color: D.text },
  timesRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10 },
  dash: { fontFamily: inter.r, fontSize: 12, color: D.sub },
  timeBox: {
    flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: D.card2,
    borderRadius: 11, height: 34, paddingHorizontal: 11,
  },
  timeText: { fontFamily: inter.sb, fontSize: 13, color: D.text, fontVariant: ['tabular-nums'] },

  blockRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 18, padding: 13, paddingHorizontal: 14,
  },
  blockIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  blockIconBreak: { backgroundColor: 'rgba(232,184,75,0.16)' },
  blockIconOff: { backgroundColor: D.accentSoft },
  customRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: D.muted, borderStyle: 'dashed', borderRadius: 16, padding: 13,
  },
  customText: { fontFamily: inter.m, fontSize: 13, color: D.sub },

  snackbar: {
    position: 'absolute', left: 16, right: 16, bottom: 96,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: D.card2, borderRadius: 14, padding: 12, paddingHorizontal: 14,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 22, shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  snackText: { flex: 1, fontFamily: inter.sb, fontSize: 12, color: D.text },
  snackUndo: { fontFamily: inter.eb, fontSize: 11, color: colors.accent, letterSpacing: 0.88 },
  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingTop: 14, paddingHorizontal: 16, paddingBottom: 30,
    backgroundColor: D.bg, borderTopWidth: 1, borderTopColor: '#1E1E22',
  },
  cancelBtn: {
    height: 48, borderRadius: 999, borderWidth: 1, borderColor: D.border,
    paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontFamily: inter.sb, fontSize: 13, color: D.sub },
  saveBtn: {
    flex: 1, height: 48, borderRadius: 999, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  saveText: { fontFamily: inter.b, fontSize: 13, color: colors.onAccent },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: sp(5), paddingBottom: sp(10), gap: sp(3),
  },
  sheetTitle: { fontFamily: inter.b, fontSize: font.h2, color: D.text },
  sheetTimes: { flexDirection: 'row', alignItems: 'center', gap: sp(2), alignSelf: 'center' },
  darkField: { backgroundColor: D.card2, color: D.text },

  dayStrip: { flexDirection: 'row', gap: sp(2), paddingVertical: sp(1) },
  dayCell: {
    width: 52, paddingVertical: sp(2), borderRadius: radius.md, alignItems: 'center', gap: 2,
    backgroundColor: D.card2,
  },
  dayCellOn: { backgroundColor: colors.accent },
  dayCellTaken: { opacity: 0.35 },
  dayCellWk: { fontFamily: inter.sb, fontSize: font.tiny, color: D.sub },
  dayCellNum: { fontFamily: inter.b, fontSize: font.body, color: D.text },
  dayCellTextOn: { color: colors.onAccent },
});
