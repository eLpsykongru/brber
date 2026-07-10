import { useEffect, useState } from 'react';
import {
  Alert, Button, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../lib/supabase';

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

export default function AvailabilityScreen({ barberId, onBack }: { barberId: string; onBack: () => void }) {
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
    <ScrollView contentContainerStyle={styles.screen}>
      <Button title="← Back" onPress={onBack} />
      <Text style={styles.title}>Working hours</Text>
      {WEEKDAYS.map((label, i) => (
        <View key={label} style={styles.dayRow}>
          <Switch value={days[i].open} onValueChange={(v) => setDay(i, { open: v })} />
          <Text style={styles.dayLabel}>{label.slice(0, 3)}</Text>
          {days[i].open ? (
            <>
              <TextInput style={styles.time} value={days[i].start}
                onChangeText={(t) => setDay(i, { start: t })} keyboardType="numbers-and-punctuation" />
              <Text>–</Text>
              <TextInput style={styles.time} value={days[i].end}
                onChangeText={(t) => setDay(i, { end: t })} keyboardType="numbers-and-punctuation" />
            </>
          ) : (
            <Text style={styles.closed}>Closed</Text>
          )}
        </View>
      ))}
      <Button title={busy ? '...' : 'Save hours'} disabled={busy} onPress={save} />

      <Text style={styles.title}>Days off</Text>
      <View style={styles.dayRow}>
        <TextInput style={[styles.time, styles.grow]} placeholder="YYYY-MM-DD"
          value={newDayOff} onChangeText={setNewDayOff} />
        <Button title="Add" onPress={addDayOff} />
      </View>
      {daysOff.map((d) => (
        <View key={d.id} style={styles.dayRow}>
          <Text style={styles.grow}>{d.day}</Text>
          <TouchableOpacity onPress={() => removeDayOff(d.id)}><Text style={styles.remove}>✕</Text></TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 10 },
  title: { fontSize: 20, fontWeight: 'bold', marginTop: 12 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayLabel: { width: 40 },
  time: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 8, minWidth: 70, textAlign: 'center' },
  grow: { flex: 1 },
  closed: { color: '#999' },
  remove: { color: '#c00', fontSize: 18, paddingHorizontal: 8 },
});
