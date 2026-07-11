import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert, FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Field, Stars, TAB_BAR_INSET } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import SalonDetailScreen, { SalonCard } from './SalonDetailScreen';

// category chips filter by service-name keywords — no category column needed
const CATEGORIES: { label: string; icon: keyof typeof Ionicons.glyphMap; re: RegExp }[] = [
  { label: 'Haircut', icon: 'cut-outline', re: /hair|cut/i },
  { label: 'Beard', icon: 'man-outline', re: /beard/i },
  { label: 'Shave', icon: 'water-outline', re: /shav|rasage/i },
  { label: 'Color', icon: 'color-palette-outline', re: /color|couleur/i },
];

// salon card image = first portfolio photo found among its barbers.
// ponytail: one storage list per card — fine at launch scale; add a salon photo column when it isn't
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

// ponytail: avg computed client-side from embedded ratings — a materialized avg
// column is worth it only when salon count makes this query heavy
function avgOf(reviews: { rating: number }[]): number | null {
  if (!reviews.length) return null;
  return reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
}

// ponytail: single-city launch → list all salons; distance sort/search
// arrives with the Google Places + lat/lng work
export default function DiscoverScreen({ onChromeHidden }: {
  onChromeHidden?: (hidden: boolean) => void;
}) {
  const [salons, setSalons] = useState<SalonCard[]>([]);
  const [salon, setSalon] = useState<SalonCard | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    // barbers!salon_id: disambiguates from the salons.owner_id relationship
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
    onChromeHidden?.(!!next); // salon detail has its own pinned CTA — hide the tab bar
  }

  const cat = CATEGORIES.find((c) => c.label === category);
  const visible = salons.filter((s) => {
    const q = query.trim().toLowerCase();
    const matchQ = !q
      || s.name.toLowerCase().includes(q)
      || s.barbers.some((b) => b.profiles?.full_name?.toLowerCase().includes(q));
    const matchC = !cat
      || s.barbers.some((b) => b.services.some((sv) => sv.is_active && cat.re.test(sv.name)));
    return matchQ && matchC;
  });

  const topRated = salons
    .map((s) => ({ s, avg: avgOf(s.barbers.flatMap((b) => b.reviews)) }))
    .filter((x): x is { s: SalonCard; avg: number } => x.avg != null)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  if (salon) {
    return <SalonDetailScreen salon={salon} onBack={() => open(null)} onChromeHidden={onChromeHidden} />;
  }

  const header = (
    <View style={styles.homeHeader}>
      {/* ponytail: single-city launch — location is a label, not a picker */}
      <Text style={styles.locationLabel}>Location</Text>
      <View style={styles.locationRow}>
        <Ionicons name="location" size={16} color={colors.accent} />
        <Text style={styles.locationText}>Tangier, Morocco</Text>
      </View>

      <Field placeholder="Search salon or barber…" value={query} onChangeText={setQuery} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catStrip}>
        <View style={styles.catRow}>
          {CATEGORIES.map((c) => {
            const on = category === c.label;
            return (
              <TouchableOpacity key={c.label} style={styles.catItem}
                onPress={() => setCategory(on ? null : c.label)}>
                <View style={[styles.catCircle, on && styles.catCircleActive]}>
                  <Ionicons name={c.icon} size={22} color={on ? colors.onAccent : colors.accent} />
                </View>
                <Text style={[styles.catLabel, on && styles.catLabelActive]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {topRated.length > 0 && !query && !category && (
        <>
          <Text style={styles.section}>Top rated salons</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.topStrip}>
            <View style={styles.topRow}>
              {topRated.map(({ s, avg }) => (
                <TouchableOpacity key={s.id} style={styles.topCard} onPress={() => open(s)}>
                  <SalonPhoto salon={s} style={styles.topPhoto} />
                  <View style={styles.topBody}>
                    <Text style={styles.topName} numberOfLines={1}>{s.name}</Text>
                    <Stars rating={avg} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </>
      )}

      <Text style={styles.section}>All salons</Text>
    </View>
  );

  return (
    <View style={styles.tabScreen}>
      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.empty}>No salons match.</Text>}
        renderItem={({ item }) => {
          const avg = avgOf(item.barbers.flatMap((b) => b.reviews));
          return (
            <TouchableOpacity style={styles.card} onPress={() => open(item)}>
              <SalonPhoto salon={item} style={styles.cardPhoto} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                {avg != null && <Stars rating={avg} count={item.barbers.flatMap((b) => b.reviews).length} />}
                <Text style={styles.meta}>{item.address}</Text>
                <View style={styles.chipRow}>
                  <Text style={styles.chipText}>
                    {item.barbers.length} barber{item.barbers.length > 1 ? 's' : ''}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabScreen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5) },
  list: { gap: sp(3), paddingBottom: TAB_BAR_INSET },

  // home header
  homeHeader: { gap: sp(3), marginBottom: sp(1) },
  locationLabel: { fontSize: font.tiny, color: colors.textTertiary },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: -sp(2) },
  locationText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  catStrip: { marginHorizontal: -sp(5) },
  catRow: { flexDirection: 'row', gap: sp(4), paddingHorizontal: sp(5) },
  catItem: { alignItems: 'center', gap: sp(1), width: 64 },
  catCircle: {
    width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  catCircleActive: { backgroundColor: colors.accent },
  catLabel: { fontSize: font.tiny, color: colors.textSecondary, fontWeight: '600' },
  catLabelActive: { color: colors.accent },
  topStrip: { marginHorizontal: -sp(5) },
  topRow: { flexDirection: 'row', gap: sp(3), paddingHorizontal: sp(5) },
  topCard: {
    width: 190, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    backgroundColor: colors.bg, overflow: 'hidden',
  },
  topPhoto: { width: '100%', height: 110 },
  topBody: { padding: sp(2.5), gap: 2 },
  topName: { fontSize: font.small, fontWeight: '700', color: colors.text },
  photoFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },

  card: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    backgroundColor: colors.bg, overflow: 'hidden',
  },
  cardPhoto: { width: '100%', height: 130 },
  cardBody: { padding: sp(4), gap: sp(1) },
  cardTitle: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  chipRow: { flexDirection: 'row', marginTop: sp(1) },
  chipText: {
    fontSize: font.tiny, fontWeight: '700', color: colors.accent,
    backgroundColor: colors.accentSoft, paddingVertical: 3, paddingHorizontal: sp(2.5),
    borderRadius: radius.pill, overflow: 'hidden',
  },
  meta: { color: colors.textSecondary, fontSize: font.small },
  bio: { marginTop: sp(1), color: colors.text, fontSize: font.body },
  empty: { textAlign: 'center', color: colors.textTertiary, marginVertical: sp(3) },
  detail: { gap: sp(2), paddingBottom: TAB_BAR_INSET },
  section: { fontSize: font.body, fontWeight: '700', marginTop: sp(3), color: colors.text },
  grow: { flex: 1 },
  barberRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: sp(3.5),
    backgroundColor: colors.bg,
  },
  barberName: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
