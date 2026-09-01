import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { Block, daySlots, mergeSlots, Range, sameDay, weekStartOf, Window } from '../lib/slots';
import { colors, font, radius, shadow, sp } from '../theme';

type Chair = { windows: Window[]; daysOff: string[]; blocks: Block[]; bufferMin: number; booked: Range[] };
const EMPTY_CHAIR: Chair = { windows: [], daysOff: [], blocks: [], bufferMin: 0, booked: [] };

// Weekly day selector + time grid. Full slots are struck-through and disabled.
// `markDay` rings a day and captions it NOW — the reschedule sheet (11a) uses it
// to keep the appointment's current day visible while you pick a different one.
//
// BOOK-21 — `barberId` takes a list as well as one id. With several, a time is
// free if *anyone* is free then, and `onSelect` says who: that is what "Anyone
// free" means, and resolving it here rather than at confirm time keeps the grid
// and the booking from ever disagreeing about who was actually available.
// Existing single-barber callers are unaffected — a `string` still satisfies the
// type, and a handler that ignores the second argument is still assignable.
export default function SlotPicker({ barberId, durationMin, selected, onSelect, label, markDay, renderFull }: {
  barberId: string | string[]; durationMin: number; selected: Date | null;
  onSelect: (t: Date, barberId: string) => void;
  label?: string; markDay?: Date | null;
  /** 36a — drawn in place of the grid when the chosen day has nothing free at all */
  renderFull?: (day: Date) => React.ReactNode;
}) {
  const ids = useMemo(() => (Array.isArray(barberId) ? barberId : [barberId]), [
    Array.isArray(barberId) ? barberId.join(',') : barberId,
  ]);
  const [chairs, setChairs] = useState<Record<string, Chair>>({});
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  const today = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }, []);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)),
    [weekStart],
  );
  const canGoPrev = weekStart.getTime() > weekStartOf(today).getTime();

  // ponytail: one round of queries per chair. At launch a shop has a handful of
  // barbers, so N small queries beats an RPC nobody has written yet — revisit if
  // "Anyone free" ever runs against a twenty-chair shop.
  const loadBooked = useCallback(async (ws: Date) => {
    const from = new Date(Math.max(ws.getTime(), Date.now()));
    const to = new Date(ws.getTime() + 7 * 86_400_000);
    const rows = await Promise.all(ids.map(async (id) => {
      const { data } = await supabase.rpc('booked_ranges',
        { p_barber: id, p_from: from.toISOString(), p_to: to.toISOString() });
      return [id, (data ?? []) as Range[]] as const;
    }));
    setChairs((cur) => {
      const next = { ...cur };
      for (const [id, booked] of rows) next[id] = { ...(next[id] ?? EMPTY_CHAIR), booked };
      return next;
    });
  }, [ids]);

  useEffect(() => {
    let alive = true;
    Promise.all(ids.map(async (id) => {
      const [av, off, blk, buf] = await Promise.all([
        supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', id),
        supabase.from('days_off').select('day').eq('barber_id', id),
        supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', id),
        supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', id).single(),
      ]);
      return [id, {
        windows: av.data ?? [],
        daysOff: (off.data ?? []).map((d) => d.day),
        blocks: blk.data ?? [],
        bufferMin: buf.data ? buf.data.buffer_before_min + buf.data.buffer_after_min : 0,
      }] as const;
    })).then((rows) => {
      if (!alive) return;
      setChairs((cur) => {
        const next = { ...cur };
        for (const [id, d] of rows) next[id] = { ...(next[id] ?? EMPTY_CHAIR), ...d };
        return next;
      });
    });
    loadBooked(weekStart);
    return () => { alive = false; };
  }, [ids]);

  function changeWeek(dir: 'prev' | 'next') {
    if (dir === 'prev' && !canGoPrev) return;
    const ws = new Date(weekStart);
    ws.setDate(ws.getDate() + (dir === 'next' ? 7 : -7));
    setWeekStart(ws);
    setSelectedDay(ws.getTime() <= today.getTime() ? today : ws);
    loadBooked(ws);
  }

  // One grid over every chair asked about — the merge itself lives in
  // lib/slots.ts so `npm run check` can pin it.
  const { slots, freeBy } = useMemo(() => mergeSlots(ids.map((id) => {
    const c = chairs[id] ?? EMPTY_CHAIR;
    return { id, slots: daySlots(selectedDay, durationMin, c.windows, c.booked, c.daysOff, c.blocks, c.bufferMin) };
  })), [ids, chairs, selectedDay, durationMin]);

  return (
    <View>
      <View style={s.weekHead}>
        <Text style={[s.weekLabel, !!label && s.weekEyebrow]}>{label ?? 'Select a date'}</Text>
        <View style={s.weekNav}>
          <Pressable onPress={() => changeWeek('prev')} disabled={!canGoPrev} hitSlop={6}
            accessibilityLabel="Previous week"
            style={({ pressed }) => [s.navBtn, pressed && s.pressed, !canGoPrev && s.navDisabled]}>
            <Ionicons name="chevron-back" size={18} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => changeWeek('next')} hitSlop={6} accessibilityLabel="Next week"
            style={({ pressed }) => [s.navBtn, pressed && s.pressed]}>
            <Ionicons name="chevron-forward" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <View style={s.weekRow}>
        {weekDays.map((d) => {
          const isPast = d.getTime() < today.getTime();
          const isSel = sameDay(d, selectedDay);
          const isNow = !!markDay && sameDay(d, markDay);
          return (
            <Pressable key={d.toISOString()} disabled={isPast} style={s.dayCol}
              onPress={() => setSelectedDay(d)}>
              <Text style={[s.dayDow, isPast && s.muted]}>
                {d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}
              </Text>
              <View style={[s.dayNum, isNow && !isSel && s.dayNumNow,
                isSel && s.dayNumActive, isPast && s.dayNumPast]}>
                <Text style={[s.dayNumText, isSel && s.dayNumTextActive, isPast && s.muted]}>{d.getDate()}</Text>
                {isNow && <Text style={s.dayNowTag}>NOW</Text>}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* a day that exists but has nothing left is a different thing from a day
          off, and it's the only moment an ask makes sense */}
      {renderFull && slots.length > 0 && !slots.some((sl) => sl.status === 'free')
        ? renderFull(selectedDay)
        : (
      <View style={s.slotGrid}>
        {slots.length === 0 && <Text style={s.empty}>Not working this day.</Text>}
        {slots.map(({ time, status }) => {
          const isSel = selected?.getTime() === time.getTime();
          return (
            <Pressable key={time.getTime()} disabled={status !== 'free'}
              onPress={() => onSelect(time, freeBy.get(time.getTime()) ?? ids[0])}
              style={[s.slot, isSel && s.slotSel, status === 'full' && s.slotFull, status === 'past' && s.slotPast]}>
              <Text style={[s.slotText, isSel && s.slotTextSel,
                status === 'full' && s.slotTextFull, status === 'past' && s.slotTextPast]}>
                {time.toTimeString().slice(0, 5)}
              </Text>
            </Pressable>
          );
        })}
      </View>
        )}
      {slots.some((sl) => sl.status === 'free') && slots.some((sl) => sl.status === 'full') && (
        <Text style={s.legend}>Crossed-out times are already booked.</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp(2) },
  weekLabel: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  weekEyebrow: { fontSize: font.tiny, fontWeight: '700', letterSpacing: 1.65 },
  weekNav: { flexDirection: 'row', gap: sp(2) },
  navBtn: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  navDisabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: sp(4) },
  dayCol: { alignItems: 'center', gap: sp(1.5), flex: 1 },
  dayDow: { fontSize: font.tiny, color: colors.textSecondary },
  muted: { color: colors.textTertiary },
  dayNum: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dayNumActive: { backgroundColor: colors.ink },
  dayNumNow: { borderWidth: 1.5, borderColor: '#C9C5BB' },
  dayNowTag: {
    position: 'absolute', bottom: -10, fontSize: 8, letterSpacing: 0.48,
    fontWeight: '700', color: colors.textTertiary,
  },
  dayNumPast: { opacity: 0.5 },
  dayNumText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  dayNumTextActive: { color: colors.onAccent },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  slot: {
    width: '31%', height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14,
    backgroundColor: colors.bg,
  },
  slotSel: { backgroundColor: colors.ink },
  slotFull: { backgroundColor: '#E9E6DE' },
  slotPast: { opacity: 0.5 },
  slotText: { color: colors.text, fontWeight: '600', fontSize: font.small },
  slotTextSel: { color: colors.onAccent },
  slotTextFull: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  slotTextPast: { color: colors.textTertiary },
  empty: { color: colors.textTertiary, fontSize: font.small, paddingVertical: sp(4) },
  legend: { fontSize: font.tiny, color: colors.textTertiary, marginTop: sp(3) },
});
