import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import type { Barber, Service } from '../types';

// ponytail: single-city launch → list all approved barbers; distance sort/search
// arrives with the Google Places + lat/lng work
export default function DiscoverScreen() {
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selected, setSelected] = useState<Barber | null>(null);

  useEffect(() => {
    supabase.from('barbers')
      .select('id, shop_name, shop_address, bio, status, id_document_path')
      .eq('status', 'approved').order('created_at')
      .then(({ data, error }) => {
        if (error) Alert.alert('Could not load barbers', error.message);
        else setBarbers(data);
      });
  }, []);

  if (selected) return <BarberDetail barber={selected} onBack={() => setSelected(null)} />;

  return (
    <FlatList
      data={barbers}
      keyExtractor={(b) => b.id}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No barbers available yet.</Text>}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => setSelected(item)}>
          <Text style={styles.cardTitle}>{item.shop_name}</Text>
          <Text style={styles.meta}>{item.shop_address}</Text>
          {!!item.bio && <Text style={styles.meta} numberOfLines={2}>{item.bio}</Text>}
        </TouchableOpacity>
      )}
    />
  );
}

// ---------- detail + booking ----------

type Window = { weekday: number; start_min: number; end_min: number };
type Range = { starts_at: string; ends_at: string };
const DAYS_AHEAD = 14;
const SLOT_STEP_MIN = 30;

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function freeSlots(day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[]): Date[] {
  if (daysOff.includes(localDateStr(day))) return [];
  const now = Date.now();
  const slots: Date[] = [];
  for (const w of windows.filter((w) => w.weekday === day.getDay())) {
    for (let t = w.start_min; t + durationMin <= w.end_min; t += SLOT_STEP_MIN) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t);
      const end = start.getTime() + durationMin * 60_000;
      if (start.getTime() <= now) continue;
      if (booked.some((b) => start.getTime() < new Date(b.ends_at).getTime()
        && end > new Date(b.starts_at).getTime())) continue;
      slots.push(start);
    }
  }
  return slots;
}

function BarberDetail({ barber, onBack }: { barber: Barber; onBack: () => void }) {
  const [services, setServices] = useState<Service[]>([]);
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [booked, setBooked] = useState<Range[]>([]);
  const [bookingService, setBookingService] = useState<Service | null>(null);
  const [dayIndex, setDayIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, i) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  }, []);

  async function loadCalendar() {
    const from = new Date();
    const to = new Date(from.getTime() + DAYS_AHEAD * 86_400_000);
    const [av, off, bk] = await Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barber.id),
      supabase.from('days_off').select('day').eq('barber_id', barber.id),
      supabase.rpc('booked_ranges', { p_barber: barber.id, p_from: from.toISOString(), p_to: to.toISOString() }),
    ]);
    setWindows(av.data ?? []);
    setDaysOff((off.data ?? []).map((d) => d.day));
    setBooked(bk.data ?? []);
  }

  useEffect(() => {
    supabase.from('services')
      .select('id, name, price_cents, duration_min, is_active')
      .eq('barber_id', barber.id).eq('is_active', true).order('price_cents')
      .then(({ data, error }) => {
        if (error) Alert.alert('Could not load services', error.message);
        else setServices(data);
      });
    loadCalendar();
  }, [barber.id]);

  async function book(slot: Date) {
    const svc = bookingService!;
    const when = `${slot.toDateString()} ${slot.toTimeString().slice(0, 5)}`;
    Alert.alert('Confirm booking', `${svc.name} at ${barber.shop_name}\n${when}\n${(svc.price_cents / 100).toFixed(2)} MAD, paid at the shop`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Book',
        onPress: async () => {
          setBusy(true);
          const { data: auth } = await supabase.auth.getUser();
          const { error } = await supabase.from('bookings').insert({
            customer_id: auth.user!.id,
            barber_id: barber.id,
            service_id: svc.id,
            starts_at: slot.toISOString(),
          });
          setBusy(false);
          if (error) Alert.alert('Could not book', error.message);
          else {
            Alert.alert('Booked!', 'Your appointment is confirmed. Pay at the shop.');
            setBookingService(null);
            loadCalendar(); // slot disappears from the grid
          }
        },
      },
    ]);
  }

  const slots = bookingService
    ? freeSlots(days[dayIndex], bookingService.duration_min, windows, booked, daysOff)
    : [];

  return (
    <ScrollView contentContainerStyle={styles.detail}>
      <Button title="← Back" onPress={onBack} />
      <Text style={styles.cardTitle}>{barber.shop_name}</Text>
      <Text style={styles.meta}>{barber.shop_address}</Text>
      {!!barber.bio && <Text style={styles.bio}>{barber.bio}</Text>}

      <Text style={styles.section}>Services</Text>
      {services.length === 0 && <Text style={styles.empty}>No services listed yet.</Text>}
      {services.map((s) => (
        <TouchableOpacity key={s.id}
          style={[styles.serviceRow, bookingService?.id === s.id && styles.serviceActive]}
          onPress={() => setBookingService(bookingService?.id === s.id ? null : s)}>
          <Text style={styles.serviceName}>{s.name}</Text>
          <Text style={styles.meta}>{(s.price_cents / 100).toFixed(2)} · {s.duration_min} min</Text>
        </TouchableOpacity>
      ))}

      {bookingService && (
        <>
          <Text style={styles.section}>Pick a day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.dayStrip}>
              {days.map((d, i) => (
                <TouchableOpacity key={i}
                  style={[styles.dayBtn, i === dayIndex && styles.dayBtnActive]}
                  onPress={() => setDayIndex(i)}>
                  <Text style={i === dayIndex ? styles.dayBtnTextActive : undefined}>
                    {d.toDateString().slice(0, 10)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <Text style={styles.section}>Free slots</Text>
          <View style={styles.slotGrid}>
            {slots.length === 0 && <Text style={styles.empty}>No free slots this day.</Text>}
            {slots.map((s) => (
              <TouchableOpacity key={s.getTime()} style={styles.slot} disabled={busy}
                onPress={() => book(s)}>
                <Text>{s.toTimeString().slice(0, 5)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 16, gap: 4 },
  cardTitle: { fontSize: 18, fontWeight: 'bold' },
  meta: { color: '#666' },
  bio: { marginTop: 4 },
  empty: { textAlign: 'center', color: '#666', marginVertical: 12 },
  detail: { padding: 16, gap: 8 },
  section: { fontSize: 16, fontWeight: 'bold', marginTop: 12 },
  serviceRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  serviceActive: { backgroundColor: '#f0f0f0', borderRadius: 8 },
  serviceName: { flex: 1 },
  dayStrip: { flexDirection: 'row', gap: 8 },
  dayBtn: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  dayBtnActive: { backgroundColor: '#222', borderColor: '#222' },
  dayBtnTextActive: { color: '#fff' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { borderWidth: 1, borderColor: '#222', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
});
