import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Field, Stars } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import SalonDetailScreen, { SalonCard } from './SalonDetailScreen';

// TODO(backlog): placeholder distance — replace with haversine(user, salon lat/lng)
function pseudoKm(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 900;
  return 1 + h / 100; // 1.0 – 9.99, stable per salon
}

function startingPrice(s: SalonCard): number | null {
  const prices = s.barbers
    .flatMap((b) => b.services)
    .filter((sv) => sv.is_active && sv.price_cents != null)
    .map((sv) => sv.price_cents!);
  return prices.length ? Math.min(...prices) : null;
}

function avgOf(reviews: { rating: number }[]): number | null {
  if (!reviews.length) return null;
  return reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
}

// preset scatter positions for up to 5 map pins (top/left %)
const PIN_POS = [
  { top: '18%', left: '12%' }, { top: '14%', left: '68%' },
  { top: '46%', left: '58%' }, { top: '58%', left: '24%' },
  { top: '40%', left: '82%' },
] as const;

function SalonPhoto({ salon, style }: { salon: SalonCard; style: object }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const b of salon.barbers) {
        const photos = await listPortfolio(b.id);
        if (photos.length && alive) { setUrl(photos[0].url); return; }
      }
    })();
    return () => { alive = false; };
  }, [salon.id]);
  if (url) return <Image source={{ uri: url }} style={style} />;
  return (
    <View style={[style, styles.photoFallback]}>
      <Ionicons name="storefront-outline" size={28} color={colors.accent} />
    </View>
  );
}

export default function ExploreScreen({ onChromeHidden }: {
  onChromeHidden?: (hidden: boolean) => void;
}) {
  const [salons, setSalons] = useState<SalonCard[]>([]);
  const [query, setQuery] = useState('');
  const [salon, setSalon] = useState<SalonCard | null>(null);

  useEffect(() => {
    supabase.from('salons')
      .select('id, name, address, bio, website, barbers!salon_id(id, bio, status, specialty, years_experience, profiles(full_name, avatar_url, phone), reviews(rating), services(id, name, price_cents, duration_min, is_active, category))')
      .order('name')
      .then(({ data, error }) => {
        if (error) return Alert.alert('Could not load salons', error.message);
        const cards = (data as unknown as SalonCard[])
          .map((s) => ({ ...s, barbers: s.barbers.filter((b) => b.status === 'approved') }))
          .filter((s) => s.barbers.length > 0);
        setSalons(cards);
      });
  }, []);

  function open(next: SalonCard | null) {
    setSalon(next);
    onChromeHidden?.(!!next);
  }

  const visible = salons.filter((s) => {
    const q = query.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q)
      || s.barbers.some((b) => b.profiles?.full_name?.toLowerCase().includes(q));
  });

  if (salon) {
    return <SalonDetailScreen salon={salon} onBack={() => open(null)} onChromeHidden={onChromeHidden} />;
  }

  // ---- explore landing (map placeholder + carousel) ----
  const pinned = visible.slice(0, PIN_POS.length);
  return (
    <View style={styles.screen}>
      {/* search + filter */}
      <View style={styles.searchRow}>
        <View style={styles.grow}>
          <Field placeholder="Search Salon or Specialist" value={query} onChangeText={setQuery} />
        </View>
        <Pressable style={({ pressed }) => [styles.filterBtn, pressed && styles.pressed]}
          accessibilityLabel="Filters"
          /* TODO(backlog): real filter sheet (gender, category, rating, distance, price) */
          onPress={() => Alert.alert('Filters', 'Coming soon — see BACKLOG.md')}>
          <Ionicons name="options-outline" size={22} color={colors.onAccent} />
        </Pressable>
      </View>

      {/* TODO(backlog): styled placeholder for the real map (needs lat/lng + react-native-maps) */}
      <View style={styles.map}>
        <View style={[styles.street, styles.streetA]} />
        <View style={[styles.street, styles.streetB]} />
        <View style={[styles.street, styles.streetC]} />
        {pinned.map((s, i) => (
          <TouchableOpacity key={s.id} style={[styles.pinWrap, PIN_POS[i]]} onPress={() => open(s)}>
            <View style={styles.pin}>
              <Ionicons name="cut" size={16} color={colors.accent} />
            </View>
            <Text style={styles.pinLabel}>{pseudoKm(s.id).toFixed(1)} Km</Text>
          </TouchableOpacity>
        ))}
        {/* user location marker */}
        <View style={styles.userPin}>
          <Ionicons name="navigate" size={16} color={colors.onAccent} />
        </View>
        {/* locate-me FAB */}
        <Pressable style={({ pressed }) => [styles.locateBtn, pressed && styles.pressed]}
          accessibilityLabel="Locate me"
          /* TODO(backlog): expo-location permission + recenter on user */
          onPress={() => Alert.alert('Location', 'Coming soon — see BACKLOG.md')}>
          <Ionicons name="locate" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* bottom carousel */}
      <View style={styles.carousel}>
        <FlatList
          data={visible}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.carouselContent}
          ListEmptyComponent={<Text style={styles.meta}>No salons yet.</Text>}
          renderItem={({ item }) => {
            const avg = avgOf(item.barbers.flatMap((b) => b.reviews));
            const price = startingPrice(item);
            const km = pseudoKm(item.id);
            return (
              <TouchableOpacity style={styles.card} onPress={() => open(item)} activeOpacity={0.9}>
                <View style={styles.cardTopRow}>
                  {/* TODO(backlog): real promotions */}
                  <View style={styles.offBadge}>
                    <Ionicons name="pricetag" size={11} color={colors.accent} />
                    <Text style={styles.offText}>5% OFF</Text>
                  </View>
                  {/* TODO(backlog): wishlist table + toggle */}
                  <Pressable hitSlop={8} style={styles.heart} accessibilityLabel="Save to wishlist"
                    onPress={() => Alert.alert('Wishlist', 'Coming soon — see BACKLOG.md')}>
                    <Ionicons name="heart-outline" size={18} color={colors.text} />
                  </Pressable>
                </View>
                <SalonPhoto salon={item} style={styles.cardPhoto} />
                <View style={styles.cardNameRow}>
                  <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                  {avg != null && <Stars rating={avg} />}
                </View>
                <View style={styles.iconLine}>
                  <Ionicons name="location-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.meta} numberOfLines={1}>{item.address ?? 'Tangier'}</Text>
                </View>
                <View style={styles.iconLine}>
                  <Ionicons name="pricetag-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.meta}>
                    {price != null ? `Starting @ ${(price / 100).toFixed(2)} DH` : 'No services yet'}
                  </Text>
                </View>
                <View style={styles.cardBottomRow}>
                  <View style={styles.iconLine}>
                    <Ionicons name="walk-outline" size={13} color={colors.textSecondary} />
                    {/* TODO(backlog): real distance + ETA */}
                    <Text style={styles.meta}>{(km * 0.62).toFixed(1)} Miles • {Math.round(km * 4)} Min</Text>
                  </View>
                  <Pressable style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
                    accessibilityLabel="Navigate to salon"
                    /* TODO(backlog): open device maps to salon coords */
                    onPress={() => Alert.alert('Directions', 'Coming soon — see BACKLOG.md')}>
                    <Ionicons name="paper-plane" size={16} color={colors.onAccent} />
                  </Pressable>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), backgroundColor: colors.bg },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  searchRow: { flexDirection: 'row', gap: sp(2), paddingHorizontal: sp(5), marginBottom: sp(3) },
  filterBtn: {
    width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },

  // map placeholder
  map: { flex: 1, marginHorizontal: sp(5), borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  street: { position: 'absolute', backgroundColor: colors.border },
  streetA: { width: '160%', height: 10, top: '30%', left: '-10%', transform: [{ rotate: '-18deg' }] },
  streetB: { width: '160%', height: 10, top: '62%', left: '-10%', transform: [{ rotate: '-12deg' }] },
  streetC: { width: 10, height: '160%', top: '-10%', left: '55%', transform: [{ rotate: '15deg' }] },
  pinWrap: { position: 'absolute', alignItems: 'center' },
  pin: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg,
  },
  pinLabel: { fontSize: font.tiny, fontWeight: '700', color: colors.text, marginTop: 2 },
  userPin: {
    position: 'absolute', top: '44%', left: '44%', width: 40, height: 40, borderRadius: radius.pill,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.bg,
  },
  locateBtn: {
    position: 'absolute', right: sp(3), bottom: sp(3), width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },

  // carousel
  carousel: { paddingVertical: sp(3) },
  carouselContent: { paddingHorizontal: sp(5), gap: sp(3) },
  card: {
    width: 300, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: sp(3), gap: sp(2), backgroundColor: colors.bg,
  },
  cardTopRow: {
    position: 'absolute', top: sp(5), left: sp(5), right: sp(5), zIndex: 2,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  offBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.bg,
    borderRadius: radius.sm, paddingVertical: 3, paddingHorizontal: sp(2),
  },
  offText: { fontSize: font.tiny, fontWeight: '700', color: colors.accent },
  heart: {
    width: 30, height: 30, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  cardPhoto: { width: '100%', height: 130, borderRadius: radius.md, backgroundColor: colors.surface },
  photoFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  cardNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: sp(2) },
  cardName: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  iconLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: font.small, color: colors.textSecondary, flexShrink: 1 },
  cardBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  navBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },

  // salon detail
  salonScreen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5) },
  salonContent: { gap: sp(2), paddingBottom: sp(10) },
  section: { fontSize: font.body, fontWeight: '700', marginTop: sp(3), color: colors.text },
  barberRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: sp(3.5),
    backgroundColor: colors.bg,
  },
  barberName: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
