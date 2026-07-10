import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, Chip, Empty, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, sp } from '../theme';
import ChatScreen from './ChatScreen';

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_cents: number;
  services: { name: string } | null;
  barbers: { profiles: { full_name: string | null } | null; salon: { name: string } | null } | null;
};

const STATUS_COLOR: Record<string, string> = {
  confirmed: colors.success, pending: colors.warning, cancelled: colors.textTertiary,
  completed: colors.textSecondary, no_show: colors.danger,
};

type Filter = 'upcoming' | 'past' | 'cancelled';

export default function MyBookingsScreen({ customerId, onChromeHidden }: {
  customerId: string; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [chat, setChat] = useState<Row | null>(null);
  const [rateTarget, setRateTarget] = useState<Row | null>(null);

  const load = useCallback(async () => {
    const [bk, rv] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, ends_at, status, price_cents, services(name), barbers(profiles(full_name), salon:salons!salon_id(name))')
        .eq('customer_id', customerId)
        .order('starts_at', { ascending: false })
        .limit(50),
      supabase.from('reviews').select('booking_id').eq('customer_id', customerId),
    ]);
    if (bk.error) Alert.alert('Could not load bookings', bk.error.message);
    else setRows(bk.data as unknown as Row[]);
    if (rv.data) setReviewed(new Set(rv.data.map((r) => r.booking_id)));
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

  function openChat(row: Row | null) {
    setChat(row);
    onChromeHidden?.(!!row);
  }

  if (chat) {
    return <ChatScreen bookingId={chat.id} myId={customerId}
      title={chat.barbers?.profiles?.full_name ?? 'Chat'} onBack={() => openChat(null)} />;
  }
  if (rateTarget) {
    return <RateForm booking={rateTarget}
      onDone={() => { setRateTarget(null); load(); }}
      onBack={() => setRateTarget(null)} />;
  }

  const now = Date.now();
  const filtered = rows.filter((r) => {
    const live = ['pending', 'confirmed'].includes(r.status);
    if (filter === 'upcoming') return live && new Date(r.ends_at).getTime() >= now;
    if (filter === 'past') return live && new Date(r.ends_at).getTime() < now;
    return !live; // cancelled / no_show
  });

  return (
    <View style={s.screen}>
      <ScreenHeader title="My bookings" />
      <View style={s.filters}>
        {(['upcoming', 'past', 'cancelled'] as Filter[]).map((f) => (
          <Chip key={f} label={f[0].toUpperCase() + f.slice(1)} active={filter === f}
            onPress={() => setFilter(f)} />
        ))}
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Empty text={`No ${filter} bookings.`} />}
        renderItem={({ item }) => {
          const d = new Date(item.starts_at);
          const upcoming = d.getTime() > now;
          const live = ['pending', 'confirmed'].includes(item.status);
          const done = item.status === 'confirmed' && new Date(item.ends_at).getTime() < now;
          return (
            <Card>
              <View style={s.rowTop}>
                <Text style={s.when}>{d.toDateString()} · {d.toTimeString().slice(0, 5)}</Text>
                <Text style={[s.status, { color: STATUS_COLOR[item.status] ?? colors.text }]}>
                  {item.status}
                </Text>
              </View>
              <Text style={s.meta}>
                {item.services?.name ?? 'Service'} with {item.barbers?.profiles?.full_name ?? 'barber'}
              </Text>
              <Text style={s.meta}>
                {item.barbers?.salon?.name ?? 'Salon'} · {(item.price_cents / 100).toFixed(2)} MAD
              </Text>
              <View style={s.actions}>
                {live && (
                  <Pressable onPress={() => openChat(item)} hitSlop={8} accessibilityLabel="Open chat"
                    style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                    <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.text} />
                  </Pressable>
                )}
                {done && !reviewed.has(item.id) && (
                  <Chip label="Rate ★" active onPress={() => setRateTarget(item)} />
                )}
                {live && upcoming && (
                  <Pressable onPress={() => cancel(item.id)} hitSlop={8} accessibilityLabel="Cancel booking"
                    style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                    <Ionicons name="close" size={18} color={colors.danger} />
                  </Pressable>
                )}
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}

function RateForm({ booking, onDone, onBack }: { booking: Row; onDone: () => void; onBack: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (rating === 0) return Alert.alert('Pick a rating', 'Tap the stars first.');
    setBusy(true);
    const { error } = await supabase.from('reviews')
      .insert({ booking_id: booking.id, rating, comment: comment.trim() || null });
    setBusy(false);
    if (error) Alert.alert('Could not submit', error.message);
    else onDone();
  }

  return (
    <View style={s.screen}>
      <ScreenHeader title={`Rate ${booking.barbers?.profiles?.full_name ?? 'your barber'}`} onBack={onBack} />
      <View style={s.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}
            accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}>
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={38}
              color={n <= rating ? colors.star : colors.textTertiary} />
          </Pressable>
        ))}
      </View>
      <Field placeholder="Anything to add? (optional)" multiline value={comment}
        onChangeText={setComment} style={s.commentField} />
      <PillButton title="Submit review" onPress={submit} loading={busy} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), gap: sp(3) },
  filters: { flexDirection: 'row', gap: sp(2) },
  list: { gap: sp(3), paddingBottom: TAB_BAR_INSET },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  when: { fontSize: font.body, fontWeight: '700', color: colors.text },
  status: { fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase' },
  meta: { fontSize: font.small, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: sp(2), marginTop: sp(2), alignItems: 'center' },
  iconBtn: {
    width: 40, height: 40, borderRadius: 999, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: sp(2), marginVertical: sp(4) },
  commentField: { minHeight: 90, textAlignVertical: 'top', paddingTop: sp(3) },
  pressed: { opacity: 0.7 },
});
