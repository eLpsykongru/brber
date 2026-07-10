import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';

type Row = {
  id: string;
  starts_at: string;
  status: string;
  price_cents: number;
  services: { name: string } | null;
  barbers: { shop_name: string | null } | null;
};

const STATUS_COLOR: Record<string, string> = {
  confirmed: '#080', pending: '#b80', cancelled: '#999', completed: '#444', no_show: '#c00',
};

export default function MyBookingsScreen({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bookings')
      .select('id, starts_at, status, price_cents, services(name), barbers(shop_name)')
      .eq('customer_id', customerId)
      .order('starts_at', { ascending: false })
      .limit(30);
    if (error) Alert.alert('Could not load bookings', error.message);
    else setRows(data as unknown as Row[]);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  function cancel(id: string) {
    Alert.alert('Cancel booking?', 'This frees the slot for someone else.', [
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
      <Text style={styles.title}>My bookings</Text>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.empty}>No bookings yet.</Text>}
        renderItem={({ item }) => {
          const d = new Date(item.starts_at);
          const cancellable = ['pending', 'confirmed'].includes(item.status) && d.getTime() > Date.now();
          return (
            <View style={styles.row}>
              <View style={styles.grow}>
                <Text style={styles.when}>{d.toDateString()} · {d.toTimeString().slice(0, 5)}</Text>
                <Text style={styles.meta}>
                  {item.services?.name ?? 'Service'} at {item.barbers?.shop_name ?? 'shop'} · {(item.price_cents / 100).toFixed(2)} MAD
                </Text>
                <Text style={[styles.status, { color: STATUS_COLOR[item.status] ?? '#444' }]}>{item.status}</Text>
              </View>
              {cancellable && (
                <TouchableOpacity onPress={() => cancel(item.id)}>
                  <Text style={styles.cancel}>Cancel</Text>
                </TouchableOpacity>
              )}
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
  status: { fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  cancel: { color: '#c00', padding: 8 },
  empty: { textAlign: 'center', color: '#666', marginTop: 24 },
});
