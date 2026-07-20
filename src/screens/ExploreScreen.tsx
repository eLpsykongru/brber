import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Chip, Field, Stars } from '../components/ui';
import { DEFAULT_REGION, LatLng, haversineKm, openDirections, walkMin } from '../lib/geo';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import SalonDetailScreen, { SalonCard } from './SalonDetailScreen';

const CARD_W = 300;
const CARD_GAP = sp(3);

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

const RATING_OPTS = [{ label: 'Any', v: null }, { label: '4+', v: 4 }, { label: '4.5+', v: 4.5 }] as const;
const KM_OPTS = [{ label: 'Any', v: null }, { label: '< 1 Km', v: 1 }, { label: '< 3 Km', v: 3 }, { label: '< 5 Km', v: 5 }] as const;
const PRICE_OPTS = [{ label: 'Any', v: null }, { label: '≤ 50 DH', v: 5000 }, { label: '≤ 100 DH', v: 10000 }, { label: '≤ 200 DH', v: 20000 }] as const;

export default function ExploreScreen({ onChromeHidden }: {
  onChromeHidden?: (hidden: boolean) => void;
}) {
  const [salons, setSalons] = useState<SalonCard[]>([]);
  const [query, setQuery] = useState('');
  const [salon, setSalon] = useState<SalonCard | null>(null);
  const [userLoc, setUserLoc] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [maxKm, setMaxKm] = useState<number | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const mapRef = useRef<MapView>(null);
  const listRef = useRef<FlatList<SalonCard>>(null);

  useEffect(() => {
    supabase.from('salons')
      .select('id, name, address, lat, lng, bio, website, barbers!salon_id(id, bio, status, salon_status, specialty, years_experience, profiles(full_name, avatar_url, phone), reviews(rating), services(id, name, price_cents, duration_min, is_active, category))')
      .order('name')
      .then(({ data, error }) => {
        if (error) return Alert.alert('Could not load salons', error.message);
        const cards = (data as unknown as SalonCard[])
          .map((s) => ({ ...s, barbers: s.barbers.filter((b) => b.status === 'approved' && b.salon_status === 'approved') }))
          .filter((s) => s.barbers.length > 0);
        setSalons(cards);
      });
    locate(false);
  }, []);

  async function locate(recenter: boolean) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      if (recenter) Alert.alert('Location', 'Allow location access to see distances and recenter the map.');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const loc = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    setUserLoc(loc);
    if (recenter) mapRef.current?.animateToRegion({ ...loc, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
  }

  function kmFor(s: SalonCard): number | null {
    if (!userLoc || s.lat == null || s.lng == null) return null;
    return haversineKm(userLoc, { latitude: s.lat, longitude: s.lng });
  }

  function open(next: SalonCard | null) {
    setSalon(next);
    onChromeHidden?.(!!next);
  }

  function selectFromMap(s: SalonCard, index: number) {
    setSelectedId(s.id);
    listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }

  const visible = salons.filter((s) => {
    const q = query.trim().toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q)
      || s.barbers.some((b) => b.profiles?.full_name?.toLowerCase().includes(q));
    const avg = avgOf(s.barbers.flatMap((b) => b.reviews));
    const matchR = minRating == null || (avg != null && avg >= minRating);
    const km = kmFor(s);
    // no user location → the distance filter can't judge anyone; skip it
    const matchD = maxKm == null || !userLoc || (km != null && km <= maxKm);
    const price = startingPrice(s);
    const matchP = maxPrice == null || (price != null && price <= maxPrice);
    return matchQ && matchR && matchD && matchP;
  });
  // nearby first; salons without a pin (or no user location) sink to the end
  const sorted = [...visible].sort((a, b) => (kmFor(a) ?? Infinity) - (kmFor(b) ?? Infinity));

  if (salon) {
    return <SalonDetailScreen salon={salon} km={kmFor(salon)} onBack={() => open(null)}
      onChromeHidden={onChromeHidden} />;
  }

  const filtersOn = minRating != null || maxKm != null || maxPrice != null;

  return (
    <View style={styles.screen}>
      {/* search + filter */}
      <View style={styles.searchRow}>
        <View style={styles.grow}>
          <Field placeholder="Search Salon or Specialist" value={query} onChangeText={setQuery} />
        </View>
        <Pressable style={({ pressed }) => [styles.filterBtn, pressed && styles.pressed]}
          accessibilityLabel="Filters" onPress={() => setFilterOpen(true)}>
          <Ionicons name="options-outline" size={22} color={colors.onAccent} />
          {filtersOn && <View style={styles.filterDot} />}
        </Pressable>
      </View>

      {/* map */}
      <View style={styles.mapWrap}>
        <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={DEFAULT_REGION}
          showsUserLocation showsMyLocationButton={false}>
          {sorted.map((s, i) => {
            if (s.lat == null || s.lng == null) return null;
            const km = kmFor(s);
            const sel = selectedId === s.id;
            return (
              // key carries selection + km: markers are rasterized (tracksViewChanges off),
              // so remount is what repaints them when either changes
              <Marker key={`${s.id}-${sel}-${km?.toFixed(1) ?? 'x'}`}
                coordinate={{ latitude: s.lat, longitude: s.lng }}
                onPress={() => selectFromMap(s, i)} tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.pinWrap}>
                  <View style={[styles.pin, sel && styles.pinSelected]}>
                    <Ionicons name="cut" size={16} color={sel ? colors.onAccent : colors.accent} />
                  </View>
                  {km != null && <Text style={styles.pinLabel}>{km.toFixed(1)} Km</Text>}
                </View>
              </Marker>
            );
          })}
        </MapView>
        {/* locate-me FAB */}
        <Pressable style={({ pressed }) => [styles.locateBtn, pressed && styles.pressed]}
          accessibilityLabel="Locate me" onPress={() => locate(true)}>
          <Ionicons name="locate" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* bottom carousel — nearest first */}
      <View style={styles.carousel}>
        <FlatList
          ref={listRef}
          data={sorted}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.carouselContent}
          getItemLayout={(_, i) => ({ length: CARD_W + CARD_GAP, offset: i * (CARD_W + CARD_GAP), index: i })}
          ListEmptyComponent={<Text style={styles.meta}>No salons match.</Text>}
          renderItem={({ item }) => {
            const avg = avgOf(item.barbers.flatMap((b) => b.reviews));
            const price = startingPrice(item);
            const km = kmFor(item);
            return (
              <TouchableOpacity
                style={[styles.card, selectedId === item.id && styles.cardSelected]}
                onPress={() => open(item)} activeOpacity={0.9}>
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
                    <Text style={styles.meta}>
                      {km != null ? `${km.toFixed(1)} Km • ${walkMin(km)} Min` : 'Distance unknown'}
                    </Text>
                  </View>
                  <Pressable style={({ pressed }) => [styles.navBtn, pressed && styles.pressed]}
                    accessibilityLabel="Navigate to salon"
                    onPress={() => (item.lat != null && item.lng != null
                      ? openDirections(item.lat, item.lng, item.name)
                      : Alert.alert('Directions', 'This salon has not set its map location yet.'))}>
                    <Ionicons name="paper-plane" size={16} color={colors.onAccent} />
                  </Pressable>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* filter sheet */}
      <Modal visible={filterOpen} transparent animationType="slide"
        onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setFilterOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <Pressable hitSlop={8}
              onPress={() => { setMinRating(null); setMaxKm(null); setMaxPrice(null); }}>
              <Text style={styles.sheetReset}>Reset</Text>
            </Pressable>
          </View>
          <Text style={styles.sheetLabel}>Rating</Text>
          <View style={styles.chipRow}>
            {RATING_OPTS.map((o) => (
              <Chip key={o.label} label={o.label} active={minRating === o.v}
                onPress={() => setMinRating(o.v)} />
            ))}
          </View>
          <Text style={styles.sheetLabel}>Distance{!userLoc ? ' (needs location access)' : ''}</Text>
          <View style={styles.chipRow}>
            {KM_OPTS.map((o) => (
              <Chip key={o.label} label={o.label} active={maxKm === o.v}
                onPress={() => setMaxKm(o.v)} />
            ))}
          </View>
          <Text style={styles.sheetLabel}>Starting price</Text>
          <View style={styles.chipRow}>
            {PRICE_OPTS.map((o) => (
              <Chip key={o.label} label={o.label} active={maxPrice === o.v}
                onPress={() => setMaxPrice(o.v)} />
            ))}
          </View>
          <Pressable style={({ pressed }) => [styles.sheetDone, pressed && styles.pressed]}
            onPress={() => setFilterOpen(false)}>
            <Text style={styles.sheetDoneText}>Show {sorted.length} salon{sorted.length === 1 ? '' : 's'}</Text>
          </Pressable>
        </View>
      </Modal>
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
  filterDot: {
    position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: radius.pill,
    backgroundColor: colors.onAccent,
  },

  mapWrap: { flex: 1, marginHorizontal: sp(5), borderRadius: radius.lg, overflow: 'hidden' },
  pinWrap: { alignItems: 'center' },
  pin: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg,
  },
  pinSelected: { backgroundColor: colors.accent },
  pinLabel: { fontSize: font.tiny, fontWeight: '700', color: colors.text, marginTop: 2 },
  locateBtn: {
    position: 'absolute', right: sp(3), bottom: sp(3), width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
  },

  // carousel
  carousel: { paddingVertical: sp(3) },
  carouselContent: { paddingHorizontal: sp(5), gap: CARD_GAP },
  card: {
    width: CARD_W, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: sp(3), gap: sp(2), backgroundColor: colors.bg,
  },
  cardSelected: { borderColor: colors.accent, borderWidth: 2 },
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

  // filter sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: sp(5), paddingBottom: sp(10), gap: sp(2),
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetTitle: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  sheetReset: { fontSize: font.small, fontWeight: '600', color: colors.accent },
  sheetLabel: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary, marginTop: sp(2) },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  sheetDone: {
    marginTop: sp(4), backgroundColor: colors.accent, borderRadius: radius.pill,
    paddingVertical: sp(3.5), alignItems: 'center',
  },
  sheetDoneText: { color: colors.onAccent, fontSize: font.body, fontWeight: '700' },
});
