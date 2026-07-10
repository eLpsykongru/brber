import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Empty, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, sp } from '../theme';
import ChatScreen from './ChatScreen';

type BookingRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_cents: number;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
};

export default function BookingsScreen({ barberId, onChromeHidden }: {
  barberId: string; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [chat, setChat] = useState<BookingRow | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bookings')
      .select('id, starts_at, ends_at, status, price_cents, services(name), customer:profiles!customer_id(full_name)')
      .eq('barber_id', barberId)
      .gte('ends_at', new Date().toISOString())
      .in('status', ['pending', 'confirmed'])
      .order('starts_at');
    if (error) Alert.alert('Could not load bookings', error.message);
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

  function openChat(row: BookingRow | null) {
    setChat(row);
    onChromeHidden?.(!!row);
  }

  if (chat) {
    return <ChatScreen bookingId={chat.id} myId={barberId}
      title={chat.customer?.full_name ?? 'Customer'} onBack={() => openChat(null)} />;
  }

  return (
    <View style={s.screen}>
      <ScreenHeader title="Upcoming bookings" />
      <FlatList
        data={bookings}
        keyExtractor={(b) => b.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Empty text="Nothing booked yet." />}
        renderItem={({ item }) => {
          const d = new Date(item.starts_at);
          return (
            <Card>
              <View style={s.rowTop}>
                <Text style={s.when}>
                  {d.toDateString()} · {d.toTimeString().slice(0, 5)}–{new Date(item.ends_at).toTimeString().slice(0, 5)}
                </Text>
                <Text style={[s.status, { color: item.status === 'confirmed' ? colors.success : colors.warning }]}>
                  {item.status}
                </Text>
              </View>
              <Text style={s.meta}>
                {item.customer?.full_name ?? 'Customer'} · {item.services?.name ?? 'Service'} · {(item.price_cents / 100).toFixed(2)} MAD
              </Text>
              <View style={s.actions}>
                <Pressable onPress={() => openChat(item)} hitSlop={8} accessibilityLabel="Open chat"
                  style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.text} />
                </Pressable>
                <Pressable onPress={() => cancel(item.id)} hitSlop={8} accessibilityLabel="Cancel booking"
                  style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                  <Ionicons name="close" size={18} color={colors.danger} />
                </Pressable>
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), gap: sp(3) },
  list: { gap: sp(3), paddingBottom: TAB_BAR_INSET },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: sp(2) },
  when: { fontSize: font.small, fontWeight: '700', color: colors.text, flex: 1 },
  status: { fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase' },
  meta: { fontSize: font.small, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: sp(2), marginTop: sp(2) },
  iconBtn: {
    width: 40, height: 40, borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
