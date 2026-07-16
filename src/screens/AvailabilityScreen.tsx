import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { Field, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first
const STEP = 30;

type DayRow = { open: boolean; start: string; end: string };
type OffRow = { id: string; day: string; label: string | null };
type BlockRow = { id: string; label: string | null; day: string | null; start_min: number; end_min: number };
type SheetKind = 'break' | 'dayoff' | 'vacation' | 'custom';

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

function TimeBox({ value, onChange, label }: {
  value: string; onChange: (v: string) => void; label: string;
}) {
  const mins = toMin(value);
  const step = (delta: number) => {
    const next = mins + delta;
    if (next >= 0 && next <= 24 * 60) onChange(toHHMM(next));
  };
  return (
    <View style={s.timeBox}>
      <Pressable onPress={() => step(-STEP)} hitSlop={6} accessibilityLabel={`${label} earlier`}
        style={({ pressed }) => [s.timeBtn, pressed && s.pressed]}>
        <Ionicons name="remove" size={14} color={D.sub} />
      </Pressable>
      <Text style={s.timeText}>{value}</Text>
      <Pressable onPress={() => step(STEP)} hitSlop={6} accessibilityLabel={`${label} later`}
        style={({ pressed }) => [s.timeBtn, pressed && s.pressed]}>
        <Ionicons name="add" size={14} color={D.sub} />
      </Pressable>
    </View>
  );
}

export default function AvailabilityScreen({ barberId }: { barberId: string }) {
  const [days, setDays] = useState<DayRow[]>(
    WEEKDAYS.map(() => ({ open: false, start: '09:00', end: '18:00' })),
  );
  const serverDays = useRef<DayRow[]>([]);
  const [accepting, setAccepting] = useState(true);
  const [seg, setSeg] = useState<'hours' | 'off'>('hours');
  const [daysOff, setDaysOff] = useState<OffRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [busy, setBusy] = useState(false);

  // add-block sheet state
  const [sheet, setSheet] = useState<SheetKind | null>(null);
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
    supabase.from('barbers').select('accepting_bookings').eq('id', barberId).single()
      .then(({ data }) => { if (data) setAccepting(data.accepting_bookings); });
    loadOff();
  }, [barberId]);

  async function loadOff() {
    const [off, blk] = await Promise.all([
      supabase.from('days_off').select('id, day, label').eq('barber_id', barberId)
        .gte('day', isoOf(new Date())).order('day'),
      supabase.from('time_blocks').select('id, label, day, start_min, end_min')
        .eq('barber_id', barberId).order('created_at'),
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
      rows.push({ barber_id: barberId, weekday: i, start_min: toMin(days[i].start), end_min: toMin(days[i].end) });
    }
    setBusy(true);
    // ponytail: replace-all sync — delete own rows, insert the open ones
    const del = await supabase.from('availability').delete().eq('barber_id', barberId);
    const ins = rows.length ? await supabase.from('availability').insert(rows) : { error: null };
    setBusy(false);
    const error = del.error ?? ins.error;
    if (error) Alert.alert('Could not save', error.message);
    else {
      serverDays.current = days.map((d) => ({ ...d }));
      Alert.alert('Saved', 'Your availability is updated.');
    }
  }

  function cancel() {
    if (serverDays.current.length) setDays(serverDays.current.map((d) => ({ ...d })));
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
          <View style={s.headSide} />
          <Text style={s.headTitle}>SCHEDULE</Text>
          <Pressable onPress={save} disabled={busy} accessibilityLabel="Save"
            style={({ pressed }) => [s.savePill, pressed && s.pressed]}>
            <Text style={s.savePillText}>Save</Text>
          </Pressable>
        </View>
        <View style={s.divider} />

        {/* accepting bookings */}
        <View style={s.card}>
          <View style={s.grow}>
            <Text style={s.cardTitle}>Accepting bookings</Text>
            <Text style={s.cardSub}>Open {openCount} day{openCount === 1 ? '' : 's'}/week</Text>
          </View>
          <Switch value={accepting} onValueChange={toggleAccepting}
            trackColor={{ true: colors.accent, false: D.card2 }} thumbColor={D.text} />
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
            {DISPLAY_ORDER.map((i) => {
              const d = days[i];
              const name = WEEKDAYS[i].slice(0, 3);
              return (
                <View key={i} style={s.dayCard}>
                  <Pressable onPress={() => setDay(i, { open: !d.open })}
                    accessibilityLabel={`${WEEKDAYS[i]} ${d.open ? 'open' : 'closed'}`}
                    style={({ pressed }) => [s.check, d.open && s.checkOn, pressed && s.pressed]}>
                    {d.open
                      ? <Ionicons name="checkmark" size={16} color={colors.accent} />
                      : <Text style={s.checkLetter}>{name[0]}</Text>}
                  </Pressable>
                  <View style={s.grow}>
                    <Text style={s.dayName}>{name}</Text>
                    <Text style={s.cardSub}>{d.open ? `${d.start} — ${d.end}` : 'Closed'}</Text>
                  </View>
                  {d.open && (
                    <View style={s.timesRow}>
                      <TimeBox value={d.start} label={`${WEEKDAYS[i]} opening`}
                        onChange={(v) => setDay(i, { start: v })} />
                      <Text style={s.dash}>–</Text>
                      <TimeBox value={d.end} label={`${WEEKDAYS[i]} closing`}
                        onChange={(v) => setDay(i, { end: v })} />
                    </View>
                  )}
                </View>
              );
            })}
          </>
        ) : (
          <>
            <Text style={s.sectionLabel}>BLOCKS • {offList.length}</Text>
            <View style={s.quickRow}>
              {([
                { kind: 'break', icon: 'cafe-outline', label: 'BREAK' },
                { kind: 'dayoff', icon: 'ban-outline', label: 'DAY OFF' },
                { kind: 'vacation', icon: 'calendar-outline', label: 'VACATION' },
              ] as const).map((q) => (
                <Pressable key={q.kind} onPress={() => openSheet(q.kind)} accessibilityLabel={q.label}
                  style={({ pressed }) => [s.quickCard, pressed && s.pressed]}>
                  <Ionicons name={q.icon} size={20} color={colors.accent} />
                  <Text style={s.quickLabel}>{q.label}</Text>
                </Pressable>
              ))}
            </View>

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
                  style={({ pressed }) => [s.trash, pressed && s.pressed]}>
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
                  style={({ pressed }) => [s.trash, pressed && s.pressed]}>
                  <Ionicons name="trash-outline" size={17} color={D.sub} />
                </Pressable>
              </View>
            ))}

            <Pressable onPress={() => openSheet('custom')} accessibilityLabel="Block off custom time"
              style={({ pressed }) => [s.customRow, pressed && s.pressed]}>
              <Ionicons name="add" size={16} color={D.sub} />
              <Text style={s.customText}>Block off custom time</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

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
  screen: { flex: 1, backgroundColor: D.bg },
  content: { padding: sp(5), paddingTop: sp(14), gap: sp(3), paddingBottom: TAB_BAR_INSET + 70 },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },

  head: { flexDirection: 'row', alignItems: 'center' },
  headSide: { width: 64 },
  headTitle: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: D.text, letterSpacing: 2 },
  savePill: {
    width: 64, height: 34, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  savePillText: { fontSize: font.small, fontWeight: '700', color: colors.onAccent },
  divider: { height: 1, backgroundColor: D.border },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card, borderRadius: radius.lg, padding: sp(4),
  },
  cardTitle: { fontSize: font.body, fontWeight: '700', color: D.text },
  cardSub: { fontSize: font.small, color: D.sub, marginTop: 2 },

  segment: { flexDirection: 'row', backgroundColor: D.card, borderRadius: radius.pill, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.accent },
  segText: { fontSize: font.small, fontWeight: '700', color: D.sub, letterSpacing: 0.5 },
  segTextOn: { color: colors.onAccent },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  copyAll: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyAllText: { fontSize: font.small, fontWeight: '700', color: colors.accent },

  dayCard: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card, borderRadius: radius.lg, padding: sp(3.5),
  },
  check: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkOn: { backgroundColor: 'rgba(232,71,79,0.18)' },
  checkLetter: { fontSize: font.small, fontWeight: '700', color: D.sub },
  dayName: { fontSize: font.body, fontWeight: '700', color: D.text },
  timesRow: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  dash: { color: D.sub },
  timeBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: D.card2,
    borderRadius: radius.sm, borderWidth: 1, borderColor: D.border, paddingHorizontal: 2,
  },
  timeBtn: { width: 24, height: 36, alignItems: 'center', justifyContent: 'center' },
  timeText: { fontSize: font.small, fontWeight: '700', color: D.text, width: 44, textAlign: 'center', fontVariant: ['tabular-nums'] },

  quickRow: { flexDirection: 'row', gap: sp(2.5) },
  quickCard: {
    flex: 1, backgroundColor: D.card, borderRadius: radius.lg, paddingVertical: sp(4),
    alignItems: 'center', gap: sp(2),
  },
  quickLabel: { fontSize: font.tiny, fontWeight: '700', color: D.text, letterSpacing: 0.5 },

  blockRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card, borderRadius: radius.lg, padding: sp(3.5),
  },
  blockIcon: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  blockIconBreak: { backgroundColor: 'rgba(232,184,75,0.15)' },
  blockIconOff: { backgroundColor: 'rgba(232,71,79,0.15)' },
  trash: {
    width: 38, height: 38, borderRadius: radius.md, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  customRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(2),
    borderWidth: 1, borderColor: D.border, borderStyle: 'dashed', borderRadius: radius.lg,
    paddingVertical: sp(3.5),
  },
  customText: { fontSize: font.small, fontWeight: '600', color: D.sub },

  bottomBar: {
    position: 'absolute', left: sp(5), right: sp(5), bottom: TAB_BAR_INSET - sp(2),
    flexDirection: 'row', gap: sp(3),
  },
  cancelBtn: {
    flex: 1, height: 50, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: font.body, fontWeight: '700', color: D.text },
  saveBtn: {
    flex: 2, height: 50, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  saveText: { fontSize: font.body, fontWeight: '700', color: colors.onAccent },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: sp(5), paddingBottom: sp(10), gap: sp(3),
  },
  sheetTitle: { fontSize: font.h2, fontWeight: '700', color: D.text },
  sheetTimes: { flexDirection: 'row', alignItems: 'center', gap: sp(2), alignSelf: 'center' },
  darkField: { backgroundColor: D.card2, color: D.text },

  dayStrip: { flexDirection: 'row', gap: sp(2), paddingVertical: sp(1) },
  dayCell: {
    width: 52, paddingVertical: sp(2), borderRadius: radius.md, alignItems: 'center', gap: 2,
    backgroundColor: D.card2,
  },
  dayCellOn: { backgroundColor: colors.accent },
  dayCellTaken: { opacity: 0.35 },
  dayCellWk: { fontSize: font.tiny, fontWeight: '600', color: D.sub },
  dayCellNum: { fontSize: font.body, fontWeight: '700', color: D.text },
  dayCellTextOn: { color: colors.onAccent },
});
