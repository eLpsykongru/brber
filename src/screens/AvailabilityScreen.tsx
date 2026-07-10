import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Card, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, sp } from '../theme';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type DayRow = { open: boolean; start: string; end: string };

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return mins <= 1440 && parseInt(m[2], 10) < 60 ? mins : null;
}

function toHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

export default function AvailabilityScreen({ barberId }: { barberId: string }) {
  const [days, setDays] = useState<DayRow[]>(
    WEEKDAYS.map(() => ({ open: false, start: '09:00', end: '18:00' })),
  );
  const [daysOff, setDaysOff] = useState<{ id: string; day: string }[]>([]);
  const [newDayOff, setNewDayOff] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId)
      .then(({ data }) => {
        if (!data) return;
        setDays((prev) => prev.map((d, i) => {
          const row = data.find((r) => r.weekday === i);
          return row ? { open: true, start: toHHMM(row.start_min), end: toHHMM(row.end_min) } : d;
        }));
      });
    loadDaysOff();
  }, []);

  async function loadDaysOff() {
    const { data } = await supabase.from('days_off').select('id, day')
      .eq('barber_id', barberId).gte('day', new Date().toISOString().slice(0, 10)).order('day');
    if (data) setDaysOff(data);
  }

  function setDay(i: number, patch: Partial<DayRow>) {
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  async function save() {
    const rows = [];
    for (let i = 0; i < 7; i++) {
      if (!days[i].open) continue;
      const start = toMinutes(days[i].start);
      const end = toMinutes(days[i].end);
      if (start === null || end === null || end <= start) {
        return Alert.alert('Invalid hours', `${WEEKDAYS[i]}: use HH:MM and make sure closing is after opening.`);
      }
      rows.push({ barber_id: barberId, weekday: i, start_min: start, end_min: end });
    }
    setBusy(true);
    // ponytail: replace-all sync — delete own rows, insert the open ones
    const del = await supabase.from('availability').delete().eq('barber_id', barberId);
    const ins = rows.length ? await supabase.from('availability').insert(rows) : { error: null };
    setBusy(false);
    const error = del.error ?? ins.error;
    if (error) Alert.alert('Could not save', error.message);
    else Alert.alert('Saved', 'Your weekly hours are updated.');
  }

  async function addDayOff() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDayOff.trim())) {
      return Alert.alert('Invalid date', 'Use YYYY-MM-DD, e.g. 2026-07-15');
    }
    const { error } = await supabase.from('days_off')
      .insert({ barber_id: barberId, day: newDayOff.trim() });
    if (error) Alert.alert('Could not add', error.message);
    else { setNewDayOff(''); loadDaysOff(); }
  }

  async function removeDayOff(id: string) {
    await supabase.from('days_off').delete().eq('id', id);
    loadDaysOff();
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <ScreenHeader title="Working hours" />
      <Card>
        {WEEKDAYS.map((label, i) => (
          <View key={label} style={s.dayRow}>
            <Switch value={days[i].open} onValueChange={(v) => setDay(i, { open: v })}
              trackColor={{ true: colors.accent }} />
            <Text style={s.dayLabel}>{label.slice(0, 3)}</Text>
            {days[i].open ? (
              <>
                <Field value={days[i].start} onChangeText={(t) => setDay(i, { start: t })}
                  keyboardType="numbers-and-punctuation" style={s.time} />
                <Text style={s.dash}>–</Text>
                <Field value={days[i].end} onChangeText={(t) => setDay(i, { end: t })}
                  keyboardType="numbers-and-punctuation" style={s.time} />
              </>
            ) : (
              <Text style={s.closed}>Closed</Text>
            )}
          </View>
        ))}
        <PillButton title="Save hours" onPress={save} loading={busy} />
      </Card>

      <Text style={s.section}>Days off</Text>
      <View style={s.dayOffAdd}>
        <Field placeholder="YYYY-MM-DD" value={newDayOff} onChangeText={setNewDayOff} style={s.grow} />
        <PillButton title="Add" variant="secondary" onPress={addDayOff} />
      </View>
      {daysOff.map((d) => (
        <View key={d.id} style={s.dayOffRow}>
          <Text style={s.dayOffText}>{d.day}</Text>
          <Pressable onPress={() => removeDayOff(d.id)} hitSlop={8} accessibilityLabel={`Remove ${d.day}`}
            style={({ pressed }) => pressed && s.pressed}>
            <Ionicons name="close-circle" size={22} color={colors.danger} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14) },
  content: { paddingHorizontal: sp(5), gap: sp(3), paddingBottom: TAB_BAR_INSET },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2), marginBottom: sp(2) },
  dayLabel: { width: 40, fontSize: font.body, fontWeight: '600', color: colors.text },
  time: { minWidth: 78, textAlign: 'center', minHeight: 42 },
  dash: { color: colors.textSecondary },
  closed: { color: colors.textTertiary, fontSize: font.small },
  section: { fontSize: font.h2, fontWeight: '700', color: colors.text, marginTop: sp(2) },
  dayOffAdd: { flexDirection: 'row', gap: sp(2), alignItems: 'center' },
  dayOffRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: colors.border, borderRadius: 14,
    paddingVertical: sp(2.5), paddingHorizontal: sp(3.5), backgroundColor: colors.bg,
  },
  dayOffText: { fontSize: font.body, color: colors.text },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
});
