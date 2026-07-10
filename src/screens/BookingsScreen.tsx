import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_cents: number;
  services: { name: string } | null;
};

export default function BookingsScreen({ barberId, onBack }: { barberId: string; onBack: () => void }) {
  const [bookings, setBookings] = useState<BookingRow[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bookings')
      .select('id, starts_at, ends_at, status, price_cents, services(name)')
      .eq('barber_id', barberId)
      .gte('ends_at', new Date().toISOString())
      .in('status', ['pending', 'confirmed'])
      .order('starts_at');
    if (error) Alert.alert('Could not load bookings', error.message);
    // ponytail: customer name lands with the messaging phase (needs a profiles RLS tweak)
    else setBookings(data as unknown as BookingRow[]);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  function cancel(id: string) {
    Alert.alert('Cancel this booking?', 'The customer will see it as cancelled.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel booking', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('cancel_booking', { p_booking: id });
          if (error) Alert.alert('Could not cancel', error.message);
          else load();
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <Button title="← Back" onPress={onBack} />
      <Text style={styles.title}>Upcoming bookings</Text>
      <FlatList
        data={bookings}
        keyExtractor={(b) => b.id}
        ListEmptyComponent={<Text style={styles.empty}>Nothing booked yet.</Text>}
        renderItem={({ item }) => {
          const d = new Date(item.starts_at);
          return (
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text style={styles.when}>
                  {d.toDateString()} · {d.toTimeString().slice(0, 5)}–{new Date(item.ends_at).toTimeString().slice(0, 5)}
                </Text>
                <Text style={styles.meta}>
                  {item.services?.name ?? 'Service'} · {(item.price_cents / 100).toFixed(2)}
                </Text>
              </View>
              <Text style={item.status === 'confirmed' ? styles.confirmed : styles.pending}>{item.status}</Text>
              <TouchableOpacity onPress={() => cancel(item.id)}>
                <Text style={styles.cancel}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  grow: { flex: 1 },
  when: { fontWeight: 'bold' },
  meta: { color: '#666', fontSize: 12 },
  pending: { color: '#b80', fontWeight: 'bold' },
  confirmed: { color: '#080', fontWeight: 'bold' },
  empty: { textAlign: 'center', color: '#666', marginTop: 24 },
  cancel: { color: '#c00', fontSize: 16, paddingLeft: 12 },
});
