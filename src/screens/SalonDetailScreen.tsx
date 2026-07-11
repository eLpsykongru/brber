import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  Alert, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import BookingSheet from '../components/BookingSheet';
import { Empty, Field, Stars } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import type { Specialist } from '../types';
import BarberDetailScreen from './BarberDetailScreen';

export type SalonCard = {
  id: string;
  name: string;
  address: string | null;
  bio: string | null;
  website?: string | null;
  barbers: Specialist[];
};

type Tab = 'about' | 'services' | 'specialist' | 'package' | 'gallery' | 'review';
type Review = { id: string; rating: number; comment: string | null; created_at: string; customer: { full_name: string | null } | null };

function avgOf(reviews: { rating: number }[]): number | null {
  if (!reviews.length) return null;
  return reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
}

// TODO(backlog): placeholder distance until lat/lng lands
function pseudoKm(id: string) {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 900;
  return 1 + h / 100;
}

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const m = Math.floor(days / 30);
  return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`;
}

export default function SalonDetailScreen({ salon, onBack, onChromeHidden }: {
  salon: SalonCard; onBack: () => void; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>('about');
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewQuery, setReviewQuery] = useState('');
  const [bioExpanded, setBioExpanded] = useState(false);
  const [profileBarber, setProfileBarber] = useState<Specialist | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const allReviews = salon.barbers.flatMap((b) => b.reviews);
  const avg = avgOf(allReviews);
  const prices = salon.barbers.flatMap((b) => b.services).filter((sv) => sv.is_active).map((sv) => sv.price_cents);
  const priceRange = prices.length
    ? (Math.min(...prices) === Math.max(...prices)
      ? `${(Math.min(...prices) / 100).toFixed(0)} DH`
      : `${(Math.min(...prices) / 100).toFixed(0)} - ${(Math.max(...prices) / 100).toFixed(0)} DH`)
    : null;
  const km = pseudoKm(salon.id);

  useEffect(() => {
    (async () => setPhotos((await Promise.all(salon.barbers.map((b) => listPortfolio(b.id)))).flat()))();
    supabase.from('reviews')
      .select('id, rating, comment, created_at, customer:profiles!customer_id(full_name)')
      .in('barber_id', salon.barbers.map((b) => b.id))
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setReviews((data as unknown as Review[]) ?? []));
  }, [salon.id]);

  if (profileBarber) {
    return <BarberDetailScreen barber={profileBarber} salonName={salon.name}
      onBack={() => setProfileBarber(null)} onChromeHidden={onChromeHidden} />;
  }

  // service categories → "Category · N types"
  const cats = new Map<string, Set<string>>();
  for (const b of salon.barbers) for (const sv of b.services) {
    if (!sv.is_active) continue;
    const c = sv.category ?? 'Hair Services';
    if (!cats.has(c)) cats.set(c, new Set());
    cats.get(c)!.add(sv.name);
  }
  const serviceCount = new Set(salon.barbers.flatMap((b) => b.services.filter((sv) => sv.is_active).map((sv) => sv.name))).size;

  const filteredReviews = reviews.filter((r) => {
    const q = reviewQuery.trim().toLowerCase();
    return !q || r.comment?.toLowerCase().includes(q) || r.customer?.full_name?.toLowerCase().includes(q);
  });

  const hero = photos[0]?.url;
  const thumbs = photos.slice(1, 6);
  const moreCount = Math.max(0, photos.length - 6);
  const TABS: Tab[] = ['about', 'services', 'specialist', 'package', 'gallery', 'review'];

  function action(name: string, url?: string | null) {
    if (url) Linking.openURL(url).catch(() => Alert.alert(name, 'Could not open.'));
    else Alert.alert(name, 'Coming soon — see BACKLOG.md');
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* hero */}
        <View style={s.hero}>
          {hero
            ? <Image source={{ uri: hero }} style={s.heroImg} />
            : <View style={[s.heroImg, s.heroFallback]} />}
          <View style={s.heroTop}>
            <Pressable onPress={onBack} style={s.circleBtn} hitSlop={8} accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </Pressable>
            <View style={s.heroTopRight}>
              <Pressable onPress={() => Share.share({ message: `${salon.name} on brber!` })}
                style={s.circleBtn} hitSlop={8} accessibilityLabel="Share">
                <Ionicons name="share-social-outline" size={18} color={colors.text} />
              </Pressable>
              {/* TODO(backlog): wishlist */}
              <Pressable onPress={() => action('Wishlist')} style={s.circleBtn} hitSlop={8} accessibilityLabel="Save">
                <Ionicons name="heart-outline" size={18} color={colors.text} />
              </Pressable>
            </View>
          </View>
        </View>

        {/* thumbnail strip */}
        {thumbs.length > 0 && (
          <View style={s.thumbRow}>
            {thumbs.map((p, i) => (
              <View key={p.name} style={s.thumbWrap}>
                <Image source={{ uri: p.url }} style={s.thumb} />
                {i === thumbs.length - 1 && moreCount > 0 && (
                  <View style={s.thumbOverlay}><Text style={s.thumbMore}>+{moreCount}</Text></View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* sticky tab bar is index 2 — but we need info above it; put info as index 1,
            so wrap header info + tabs together. Simpler: don't stick; render inline. */}
        <View>
          {/* badges + rating */}
          <View style={s.badgeRow}>
            {/* TODO(backlog): promotions */}
            <View style={s.offBadge}>
              <Ionicons name="pricetag" size={12} color={colors.accent} />
              <Text style={s.offText}>10% OFF</Text>
            </View>
            {avg != null && <Stars rating={avg} count={allReviews.length} />}
          </View>

          <Text style={s.title}>{salon.name}</Text>
          <View style={s.metaLine}>
            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
            <Text style={s.meta}>{salon.address ?? 'Tangier, Morocco'}</Text>
          </View>
          <View style={s.metaGroup}>
            {/* TODO(backlog): real distance/ETA */}
            <View style={s.metaLine}>
              <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
              <Text style={s.meta}>{Math.round(km * 4)} Min • {(km * 0.62).toFixed(1)} Miles</Text>
            </View>
            {priceRange && (
              <View style={s.metaLine}>
                <Ionicons name="pricetag-outline" size={14} color={colors.textSecondary} />
                <Text style={s.meta}>{priceRange}</Text>
              </View>
            )}
          </View>

          {/* actions */}
          <View style={s.actions}>
            <Action icon="globe-outline" label="Website" onPress={() => action('Website', salon.website)} />
            <Action icon="map-outline" label="Direction" onPress={() => action('Direction')} />
            <Action icon="chatbubble-outline" label="Message" onPress={() => action('Message')} />
            <Action icon="paper-plane-outline" label="Share"
              onPress={() => Share.share({ message: `${salon.name} on brber!` })} />
          </View>
        </View>

        {/* tabs (sticky) */}
        <View style={s.tabsBarWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.tabsBar}>
              {TABS.map((t) => (
                <Pressable key={t} onPress={() => setTab(t)} style={s.tabBtn}>
                  <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                    {t === 'review' ? 'Review' : t[0].toUpperCase() + t.slice(1)}
                  </Text>
                  {tab === t && <View style={s.tabUnderline} />}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* tab content */}
        <View style={s.tabBody}>
          {tab === 'about' && (
            salon.bio ? (
              <Pressable onPress={() => setBioExpanded(!bioExpanded)}>
                <Text style={s.section}>About</Text>
                <Text style={s.body} numberOfLines={bioExpanded ? undefined : 4}>{salon.bio}</Text>
                {salon.bio.length > 120 && <Text style={s.readMore}>{bioExpanded ? 'Read less' : 'Read more'}</Text>}
              </Pressable>
            ) : <Empty text="No description yet." />
          )}

          {tab === 'services' && (
            <>
              <Text style={s.section}>Services <Text style={s.count}>({serviceCount})</Text></Text>
              {cats.size === 0 && <Empty text="No services yet." />}
              {[...cats.entries()].map(([cat, names]) => (
                <Pressable key={cat} onPress={() => setSheetOpen(true)}
                  style={({ pressed }) => [s.row, pressed && s.pressed]}>
                  <Text style={s.rowName}>{cat}</Text>
                  <Text style={s.rowMeta}>{names.size} Type{names.size > 1 ? 's' : ''}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              ))}
            </>
          )}

          {tab === 'specialist' && (
            <>
              <Text style={s.section}>Specialist <Text style={s.count}>({salon.barbers.length})</Text></Text>
              <View style={s.specialistGrid}>
                {salon.barbers.map((b) => {
                  const a = avgOf(b.reviews);
                  return (
                    <TouchableOpacity key={b.id} style={s.specialistCard} onPress={() => setProfileBarber(b)}>
                      {b.profiles?.avatar_url
                        ? <Image source={{ uri: b.profiles.avatar_url }} style={s.specialistAvatar} />
                        : <View style={[s.specialistAvatar, s.avatarFallback]}>
                            <Text style={s.avatarText}>
                              {(b.profiles?.full_name ?? 'B').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                            </Text>
                          </View>}
                      <Text style={s.specialistName} numberOfLines={1}>{b.profiles?.full_name ?? 'Barber'}</Text>
                      <Text style={s.rowMeta} numberOfLines={1}>{b.specialty ?? 'Barber'}</Text>
                      {a != null && <Stars rating={a} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {tab === 'package' && (
            // TODO(backlog): packages table + package→booking mapping
            <Empty text="Packages are coming soon." />
          )}

          {tab === 'gallery' && (
            <>
              <Text style={s.section}>Gallery <Text style={s.count}>({photos.length})</Text></Text>
              {photos.length === 0 && <Empty text="No photos yet." />}
              <View style={s.galleryGrid}>
                {photos.map((p) => <Image key={p.name} source={{ uri: p.url }} style={s.galleryPhoto} />)}
              </View>
            </>
          )}

          {tab === 'review' && (
            <>
              <Text style={s.section}>Reviews <Text style={s.count}>({reviews.length})</Text></Text>
              {reviews.length > 3 && (
                <Field placeholder="Search in reviews" value={reviewQuery} onChangeText={setReviewQuery} />
              )}
              {filteredReviews.length === 0 && <Empty text="No reviews yet." />}
              {filteredReviews.map((r) => (
                <View key={r.id} style={s.reviewCard}>
                  <View style={s.reviewTop}>
                    <Text style={s.rowName}>{r.customer?.full_name ?? 'Customer'}</Text>
                    <Text style={s.rowMeta}>{timeAgo(r.created_at)}</Text>
                  </View>
                  {!!r.comment && <Text style={s.body}>{r.comment}</Text>}
                  <Stars rating={r.rating} />
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      {/* pinned CTA */}
      <View style={s.cta}>
        <Pressable onPress={() => setSheetOpen(true)}
          style={({ pressed }) => [s.bookBtn, pressed && s.pressed]}>
          <Text style={s.bookText}>Book Appointment</Text>
        </Pressable>
      </View>

      <BookingSheet visible={sheetOpen} salon={salon}
        onClose={() => setSheetOpen(false)} onBooked={() => setSheetOpen(false)} />
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable style={s.action} onPress={onPress} accessibilityLabel={label}>
      <View style={s.actionCircle}><Ionicons name={icon} size={20} color={colors.text} /></View>
      <Text style={s.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: 120 },
  pressed: { opacity: 0.7 },

  hero: { height: 200 },
  heroImg: { width: '100%', height: '100%' },
  heroFallback: { backgroundColor: colors.surface },
  heroTop: { ...StyleSheet.absoluteFillObject, paddingTop: sp(13), paddingHorizontal: sp(5) },
  heroTopRight: { position: 'absolute', top: sp(13), right: sp(5), flexDirection: 'row', gap: sp(2) },
  circleBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbRow: { flexDirection: 'row', gap: sp(1.5), paddingHorizontal: sp(5), marginTop: sp(3) },
  thumbWrap: { width: 60, height: 60 },
  thumb: { width: 60, height: 60, borderRadius: radius.sm, backgroundColor: colors.surface },
  thumbOverlay: {
    ...StyleSheet.absoluteFillObject, borderRadius: radius.sm,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
  },
  thumbMore: { color: colors.onAccent, fontWeight: '700', fontSize: font.small },

  badgeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: sp(5), marginTop: sp(4),
  },
  offBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.accentSoft,
    borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: sp(3),
  },
  offText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text, paddingHorizontal: sp(5), marginTop: sp(2) },
  metaGroup: { flexDirection: 'row', gap: sp(4), paddingHorizontal: sp(5), marginTop: sp(1) },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: sp(5), marginTop: sp(1) },
  meta: { fontSize: font.small, color: colors.textSecondary },

  actions: {
    flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: sp(4),
    marginTop: sp(4), paddingBottom: sp(3),
  },
  action: { alignItems: 'center', gap: sp(1.5) },
  actionCircle: {
    width: 48, height: 48, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { fontSize: font.tiny, color: colors.textSecondary, fontWeight: '600' },

  tabsBarWrap: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabsBar: { flexDirection: 'row', paddingHorizontal: sp(5), gap: sp(5) },
  tabBtn: { paddingVertical: sp(3) },
  tabText: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabUnderline: { position: 'absolute', bottom: -1, left: '15%', right: '15%', height: 3, backgroundColor: colors.accent, borderRadius: 2 },

  tabBody: { padding: sp(5), gap: sp(2.5) },
  section: { fontSize: font.h2, fontWeight: '700', color: colors.text },
  count: { color: colors.textTertiary, fontWeight: '400' },
  body: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  readMore: { color: colors.accent, fontWeight: '600', fontSize: font.small, marginTop: 4 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: sp(4), backgroundColor: colors.bg,
  },
  rowName: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  rowMeta: { fontSize: font.small, color: colors.textSecondary },

  specialistGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(3) },
  specialistCard: {
    width: '47%', borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: sp(4), alignItems: 'center', gap: 2, backgroundColor: colors.bg,
  },
  specialistAvatar: { width: 64, height: 64, borderRadius: radius.pill, marginBottom: sp(1) },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.body, fontWeight: '700', color: colors.accent },
  specialistName: { fontSize: font.body, fontWeight: '700', color: colors.text },

  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  galleryPhoto: { width: '48.5%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },

  reviewCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: sp(4), gap: sp(1.5), backgroundColor: colors.bg,
  },
  reviewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  cta: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: sp(5), paddingBottom: sp(8),
    backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border,
  },
  bookBtn: {
    minHeight: 52, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  bookText: { color: colors.onAccent, fontSize: font.body, fontWeight: '700' },
});
