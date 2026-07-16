import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { Block, daySlots, Range, sameDay, weekStartOf, Window } from '../lib/slots';
import { colors, font, radius, sp } from '../theme';

// Weekly day selector + time grid. Full slots are struck-through and disabled.
export default function SlotPicker({ barberId, durationMin, selected, onSelect }: {
  barberId: string; durationMin: number; selected: Date | null; onSelect: (t: Date) => void;
}) {
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [bufferMin, setBufferMin] = useState(0);
  const [booked, setBooked] = useState<Range[]>([]);
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  const today = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }, []);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)),
    [weekStart],
  );
  const canGoPrev = weekStart.getTime() > weekStartOf(today).getTime();

  const loadBooked = useCallback(async (ws: Date) => {
    const from = new Date(Math.max(ws.getTime(), Date.now()));
    const to = new Date(ws.getTime() + 7 * 86_400_000);
    const { data } = await supabase.rpc('booked_ranges',
      { p_barber: barberId, p_from: from.toISOString(), p_to: to.toISOString() });
    setBooked(data ?? []);
  }, [barberId]);

  useEffect(() => {
    Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
      supabase.from('days_off').select('day').eq('barber_id', barberId),
      supabase.from('time_blocks').select('day, start_min, end_min').eq('barber_id', barberId),
      supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', barberId).single(),
    ]).then(([av, off, blk, buf]) => {
      setWindows(av.data ?? []);
      setDaysOff((off.data ?? []).map((d) => d.day));
      setBlocks(blk.data ?? []);
      if (buf.data) setBufferMin(buf.data.buffer_before_min + buf.data.buffer_after_min);
    });
    loadBooked(weekStart);
  }, [barberId]);

  function changeWeek(dir: 'prev' | 'next') {
    if (dir === 'prev' && !canGoPrev) return;
    const ws = new Date(weekStart);
    ws.setDate(ws.getDate() + (dir === 'next' ? 7 : -7));
    setWeekStart(ws);
    setSelectedDay(ws.getTime() <= today.getTime() ? today : ws);
    loadBooked(ws);
  }

  const slots = daySlots(selectedDay, durationMin, windows, booked, daysOff, blocks, bufferMin);

  return (
    <View>
      <View style={s.weekHead}>
        <Text style={s.weekLabel}>Select a date</Text>
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
          return (
            <Pressable key={d.toISOString()} disabled={isPast} style={s.dayCol}
              onPress={() => setSelectedDay(d)}>
              <Text style={[s.dayDow, isPast && s.muted]}>
                {d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}
              </Text>
              <View style={[s.dayNum, isSel && s.dayNumActive, isPast && s.dayNumPast]}>
                <Text style={[s.dayNumText, isSel && s.dayNumTextActive, isPast && s.muted]}>{d.getDate()}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={s.slotGrid}>
        {slots.length === 0 && <Text style={s.empty}>Not working this day.</Text>}
        {slots.map(({ time, status }) => {
          const isSel = selected?.getTime() === time.getTime();
          return (
            <Pressable key={time.getTime()} disabled={status !== 'free'} onPress={() => onSelect(time)}
              style={[s.slot, isSel && s.slotSel, status === 'full' && s.slotFull, status === 'past' && s.slotPast]}>
              <Text style={[s.slotText, isSel && s.slotTextSel,
                status === 'full' && s.slotTextFull, status === 'past' && s.slotTextPast]}>
                {time.toTimeString().slice(0, 5)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {slots.some((sl) => sl.status === 'full') && (
        <Text style={s.legend}>Crossed-out times are already booked.</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp(2) },
  weekLabel: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  weekNav: { flexDirection: 'row', gap: sp(2) },
  navBtn: {
    width: 34, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  navDisabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: sp(4) },
  dayCol: { alignItems: 'center', gap: sp(1.5), flex: 1 },
  dayDow: { fontSize: font.tiny, color: colors.textSecondary },
  muted: { color: colors.textTertiary },
  dayNum: { width: 38, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dayNumActive: { backgroundColor: colors.accent },
  dayNumPast: { opacity: 0.5 },
  dayNumText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  dayNumTextActive: { color: colors.onAccent },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  slot: {
    width: '31%', alignItems: 'center', paddingVertical: sp(3), borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  slotSel: { backgroundColor: colors.accent, borderColor: colors.accent },
  slotFull: { backgroundColor: colors.surface, borderColor: colors.surface },
  slotPast: { opacity: 0.5 },
  slotText: { color: colors.text, fontWeight: '600', fontSize: font.small },
  slotTextSel: { color: colors.onAccent },
  slotTextFull: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  slotTextPast: { color: colors.textTertiary },
  empty: { color: colors.textTertiary, fontSize: font.small, paddingVertical: sp(4) },
  legend: { fontSize: font.tiny, color: colors.textTertiary, marginTop: sp(3) },
});
