import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Card, Empty, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, sp } from '../theme';
import ChatScreen from './ChatScreen';

// One conversation per active booking (chat is booking-scoped by design).
type Convo = {
  id: string;
  starts_at: string;
  services: { name: string } | null;
  barbers: { profiles: { full_name: string | null } | null; salon: { name: string } | null } | null;
};

export default function ChatsScreen({ customerId, onChromeHidden }: {
  customerId: string; onChromeHidden: (hidden: boolean) => void;
}) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [open, setOpen] = useState<Convo | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('bookings')
      .select('id, starts_at, services(name), barbers(profiles(full_name), salon:salons!salon_id(name))')
      .eq('customer_id', customerId)
      .in('status', ['pending', 'confirmed'])
      .order('starts_at');
    setConvos((data as unknown as Convo[]) ?? []);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  function openChat(c: Convo | null) {
    setOpen(c);
    onChromeHidden(!!c); // hide the floating tab bar behind the chat input
  }

  if (open) {
    return <ChatScreen bookingId={open.id} myId={customerId}
      title={open.barbers?.profiles?.full_name ?? 'Chat'} onBack={() => openChat(null)} />;
  }

  return (
    <View style={s.screen}>
      <ScreenHeader title="Chat" />
      <FlatList
        data={convos}
        keyExtractor={(c) => c.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Empty text="Chats appear here once you have a booking." />}
        renderItem={({ item }) => {
          const d = new Date(item.starts_at);
          return (
            <Card onPress={() => openChat(item)}>
              <Text style={s.name}>{item.barbers?.profiles?.full_name ?? 'Barber'}</Text>
              <Text style={s.meta}>
                {item.services?.name ?? 'Booking'} at {item.barbers?.salon?.name ?? 'salon'}
              </Text>
              <Text style={s.meta}>{d.toDateString()} · {d.toTimeString().slice(0, 5)}</Text>
            </Card>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5) },
  list: { gap: sp(3), paddingBottom: TAB_BAR_INSET },
  name: { fontSize: font.body, fontWeight: '700', color: colors.text },
  meta: { fontSize: font.small, color: colors.textSecondary },
});
