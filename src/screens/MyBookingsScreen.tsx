import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Empty, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  completed_at: string | null;
  price_cents: number;
  services: { name: string; duration_min: number } | null;
  barbers: {
    id: string;
    profiles: { full_name: string | null } | null;
    salon: { name: string; address: string | null } | null;
  } | null;
};

type Filter = 'upcoming' | 'completed' | 'cancelled';

// short human booking code from the uuid — stable, real
function shortId(id: string) {
  return `#${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${date} - ${d.toTimeString().slice(0, 5)}`;
}

// barber's first portfolio photo as the card image, storefront icon otherwise
function BookingPhoto({ barberId }: { barberId: string | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (barberId) listPortfolio(barberId).then((p) => { if (alive && p.length) setUrl(p[0].url); });
    return () => { alive = false; };
  }, [barberId]);
  if (url) return <Image source={{ uri: url }} style={s.photo} />;
  return (
    <View style={[s.photo, s.photoFallback]}>
      <Ionicons name="storefront-outline" size={26} color={colors.accent} />
    </View>
  );
}

export default function MyBookingsScreen({ customerId, onChromeHidden }: {
  customerId: string; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [sub, setSub] = useState<{ type: 'rate' | 'receipt'; row: Row } | null>(null);

  const load = useCallback(async () => {
    const [bk, rv] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, ends_at, status, completed_at, price_cents, services(name, duration_min), barbers(id, profiles(full_name), salon:salons!salon_id(name, address))')
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

  function openSub(next: { type: 'rate' | 'receipt'; row: Row } | null) {
    setSub(next);
    onChromeHidden?.(!!next);
  }

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

  if (sub?.type === 'rate') {
    return <RateForm booking={sub.row}
      onDone={() => { openSub(null); load(); }} onBack={() => openSub(null)} />;
  }
  if (sub?.type === 'receipt') {
    return <Receipt booking={sub.row} onBack={() => openSub(null)} />;
  }

  const now = Date.now();
  const filtered = rows.filter((r) => {
    const live = ['pending', 'confirmed'].includes(r.status);
    // completed_at = barber finished the service (possibly before the slot time)
    const done = r.status === 'confirmed' && (!!r.completed_at || new Date(r.ends_at).getTime() < now);
    if (filter === 'upcoming') return live && !done && new Date(r.ends_at).getTime() >= now;
    if (filter === 'completed') return done;
    return !live; // cancelled / no_show
  });

  const TAB_LABEL: Record<Filter, string> = {
    upcoming: 'Upcoming', completed: 'Completed', cancelled: 'Cancelled',
  };

  return (
    <View style={s.screen}>
      <ScreenHeader title="My Bookings" />
      <View style={s.tabsRow}>
        {(['upcoming', 'completed', 'cancelled'] as Filter[]).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={s.tabBtn}
            accessibilityRole="tab" accessibilityState={{ selected: filter === f }}>
            <Text style={[s.tabText, filter === f && s.tabTextActive]}>{TAB_LABEL[f]}</Text>
            {filter === f && <View style={s.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Empty text={`No ${filter} bookings.`} />}
        renderItem={({ item }) => {
          const upcoming = new Date(item.starts_at).getTime() > now;
          const live = ['pending', 'confirmed'].includes(item.status);
          const done = item.status === 'confirmed' && (!!item.completed_at || new Date(item.ends_at).getTime() < now);
          return (
            <View style={s.card}>
              <View style={s.cardHeadRow}>
                <View style={s.statusBadge}>
                  <Text style={[s.statusBadgeText, filter === 'upcoming' && item.status === 'pending' && s.statusBadgePending]}>
                    {filter === 'upcoming'
                      ? (item.status === 'pending' ? 'Waiting for barber' : 'Upcoming')
                      : filter === 'completed' ? 'Completed' : item.status}
                  </Text>
                </View>
              </View>

              <View style={s.cardBody}>
                <BookingPhoto barberId={item.barbers?.id} />
                <View style={s.grow}>
                  {!!item.services?.name && (
                    <View style={s.serviceChip}><Text style={s.serviceChipText}>{item.services.name}</Text></View>
                  )}
                  <Text style={s.salonName} numberOfLines={1}>{item.barbers?.salon?.name ?? 'Salon'}</Text>
                  <View style={s.iconLine}>
                    <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                    <Text style={s.meta} numberOfLines={1}>{item.barbers?.salon?.address ?? 'Tangier'}</Text>
                  </View>
                  <View style={s.iconLine}>
                    <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                    <Text style={s.meta}>{item.services?.duration_min ?? 0} Mins</Text>
                  </View>
                </View>
              </View>

              <View style={s.detailRow}>
                <View>
                  <Text style={s.detailLabel}>Booking ID</Text>
                  <Text style={s.detailValue}>{shortId(item.id)}</Text>
                </View>
                <View>
                  <Text style={s.detailLabel}>Booking Date & Time</Text>
                  <Text style={s.detailValue}>{fmtDate(item.starts_at)}</Text>
                </View>
              </View>

              <View style={s.actions}>
                {live && upcoming && !done && (
                  <View style={s.grow}>
                    <PillButton title="Cancel" variant="secondary" onPress={() => cancel(item.id)} />
                  </View>
                )}
                {done && !reviewed.has(item.id) && (
                  <View style={s.grow}>
                    <PillButton title="Rate" variant="secondary"
                      onPress={() => openSub({ type: 'rate', row: item })} />
                  </View>
                )}
                <View style={s.grow}>
                  <PillButton title="View Receipt" onPress={() => openSub({ type: 'receipt', row: item })} />
                </View>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function Receipt({ booking, onBack }: { booking: Row; onBack: () => void }) {
  const d = new Date(booking.starts_at);
  const lines: [string, string][] = [
    ['Booking ID', shortId(booking.id)],
    ['Salon', booking.barbers?.salon?.name ?? '—'],
    ['Barber', booking.barbers?.profiles?.full_name ?? '—'],
    ['Service', booking.services?.name ?? '—'],
    ['Date', d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })],
    ['Time', d.toTimeString().slice(0, 5)],
    ['Duration', `${booking.services?.duration_min ?? 0} min`],
  ];
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.receiptContent}>
      <ScreenHeader title="Receipt" onBack={onBack} />
      <View style={s.receiptCard}>
        <Ionicons name="checkmark-circle" size={48} color={colors.accent} style={s.receiptIcon} />
        <Text style={s.receiptTitle}>Booking {booking.status}</Text>
        {/* ponytail: no QR — barbers have no scanner; add when a check-in flow exists */}
        {lines.map(([k, v]) => (
          <View key={k} style={s.receiptRow}>
            <Text style={s.receiptKey}>{k}</Text>
            <Text style={s.receiptVal}>{v}</Text>
          </View>
        ))}
        <View style={s.receiptDivider} />
        <View style={s.receiptRow}>
          <Text style={s.receiptTotalKey}>To pay at the shop</Text>
          <Text style={s.receiptTotalVal}>{(booking.price_cents / 100).toFixed(2)} DH</Text>
        </View>
      </View>
    </ScrollView>
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
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: sp(2.5) },
  tabText: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabUnderline: {
    position: 'absolute', bottom: -1, height: 3, width: 48, backgroundColor: colors.accent, borderRadius: 2,
  },
  list: { gap: sp(3), paddingBottom: TAB_BAR_INSET, paddingTop: sp(1) },

  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: sp(4), gap: sp(3), backgroundColor: colors.bg,
  },
  cardHeadRow: { flexDirection: 'row' },
  statusBadge: {
    backgroundColor: colors.surface, borderRadius: radius.sm,
    paddingVertical: 4, paddingHorizontal: sp(2.5),
  },
  statusBadgeText: { fontSize: font.tiny, fontWeight: '700', color: colors.textSecondary, textTransform: 'capitalize' },
  statusBadgePending: { color: colors.warning },
  cardBody: { flexDirection: 'row', gap: sp(3) },
  photo: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surface },
  photoFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1 },
  serviceChip: {
    alignSelf: 'flex-start', backgroundColor: colors.accentSoft, borderRadius: radius.sm,
    paddingVertical: 2, paddingHorizontal: sp(2), marginBottom: sp(1),
  },
  serviceChipText: { fontSize: font.tiny, fontWeight: '700', color: colors.accent },
  salonName: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  iconLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meta: { fontSize: font.small, color: colors.textSecondary, flexShrink: 1 },

  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: colors.border, paddingTop: sp(3),
  },
  detailLabel: { fontSize: font.tiny, color: colors.textTertiary },
  detailValue: { fontSize: font.small, fontWeight: '700', color: colors.text, marginTop: 2 },

  actions: { flexDirection: 'row', gap: sp(3) },

  // receipt
  receiptContent: { paddingBottom: sp(10) },
  receiptCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: sp(5), gap: sp(2), backgroundColor: colors.bg,
  },
  receiptIcon: { alignSelf: 'center' },
  receiptTitle: {
    textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: colors.text,
    textTransform: 'capitalize', marginBottom: sp(2),
  },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp(1) },
  receiptKey: { fontSize: font.small, color: colors.textSecondary },
  receiptVal: { fontSize: font.small, fontWeight: '600', color: colors.text },
  receiptDivider: { height: 1, backgroundColor: colors.border, marginVertical: sp(2) },
  receiptTotalKey: { fontSize: font.body, fontWeight: '700', color: colors.text },
  receiptTotalVal: { fontSize: font.body, fontWeight: '700', color: colors.accent },

  // rate
  stars: { flexDirection: 'row', justifyContent: 'center', gap: sp(2), marginVertical: sp(4) },
  commentField: { minHeight: 90, textAlignVertical: 'top', paddingTop: sp(3) },
});
