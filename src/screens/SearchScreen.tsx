import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Display, Stars, TAB_BAR_INSET } from '../components/ui';
import SaveHeart from '../components/SaveHeart';
import { useAndroidBack } from '../lib/back';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, shadow, sp, TOP_INSET } from '../theme';
import type { SalonCard } from './SalonDetailScreen';

const RECENT_KEY = 'search:recent';
const RECENT_MAX = 6;
// EXPL-15's chips. Free text on the row (0074 stores text[]), so this list is a
// starting point for what people ask for, not a schema.
const WANT_TAGS = ['Fade', 'Beard', 'Kids', 'Shave'];

type Specialist = SalonCard['barbers'][number];
type Hit = { salon: SalonCard; barber: Specialist };

function avgOf(reviews: { rating: number }[]): number | null {
  if (!reviews.length) return null;
  return reviews.reduce((a, r) => a + r.rating, 0) / reviews.length;
}

function startingPrice(s: SalonCard): number | null {
  const p = s.barbers.flatMap((b) => b.services)
    .filter((sv) => sv.is_active && sv.price_cents != null)
    .map((sv) => sv.price_cents!);
  return p.length ? Math.min(...p) : null;
}

/** Thumbnail = first portfolio photo among the salon's barbers, as elsewhere. */
function Thumb({ salon, style }: { salon: SalonCard; style: object }) {
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
  // §11: an empty photo well is a flat block, never a stock barbershop shot
  return <View style={[style, { backgroundColor: colors.slotEmpty }]} />;
}

/**
 * EXPL-13 / 14 / 15 — one screen, three states, because they are one moment:
 * you tap the search field, you type, and either something comes back or
 * nothing does. Splitting them would duplicate the field and the cancel.
 *
 * The salon list is passed in rather than fetched: Discover and Explore both
 * already hold the identical query, and a third copy would be a third thing to
 * keep in sync (and a third round trip on a connection that can't spare one).
 */
export default function SearchScreen({ salons, kmFor, onPick, onClose }: {
  salons: SalonCard[];
  kmFor?: (s: SalonCard) => number | null;
  onPick: (s: SalonCard) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  // the logged miss for the query on screen — 0074 returns it so NOTIFY ME can
  // attach tags to the row that was already written
  const [miss, setMiss] = useState<{ id: string; asks: number; forQuery: string } | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [notified, setNotified] = useState(false);

  useAndroidBack(onClose);

  useEffect(() => {
    AsyncStorage.getItem(RECENT_KEY)
      .then((raw) => setRecent(raw ? JSON.parse(raw) : []))
      .catch(() => setRecent([]));
  }, []);

  const remember = useCallback((q: string) => {
    setRecent((prev) => {
      const next = [q, ...prev.filter((r) => r !== q)].slice(0, RECENT_MAX);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  function clearRecent() {
    setRecent([]);
    AsyncStorage.removeItem(RECENT_KEY).catch(() => {});
  }

  function dropRecent(q: string) {
    setRecent((prev) => {
      const next = prev.filter((r) => r !== q);
      AsyncStorage.setItem(RECENT_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  const q = query.trim().toLowerCase();

  const salonHits = useMemo(() => (!q ? [] : salons.filter((s) =>
    s.name.toLowerCase().includes(q)
    || (s.district ?? '').toLowerCase().includes(q)
    || (s.address ?? '').toLowerCase().includes(q)
    || s.barbers.some((b) => b.services.some((sv) => sv.is_active && sv.name.toLowerCase().includes(q))))),
  [q, salons]);

  // "salons and specialists in one list, not tabs" — in Tangier people search a
  // barber's name as often as a shop's, and tabs make them guess which they meant
  const barberHits = useMemo<Hit[]>(() => (!q ? [] : salons.flatMap((s) =>
    s.barbers.filter((b) => b.profiles?.full_name?.toLowerCase().includes(q)
      || (b.specialty ?? '').toLowerCase().includes(q))
      .map((b) => ({ salon: s, barber: b })))),
  [q, salons]);

  const empty = q.length > 0 && salonHits.length === 0 && barberHits.length === 0;

  // The district the query names, if it names one we know. Guessing a district
  // out of free text would put a real place name next to a number we invented,
  // so this only ever matches districts that already exist on a salon row.
  const districts = useMemo(
    () => [...new Set(salons.map((s) => s.district).filter((d): d is string => !!d))],
    [salons],
  );
  const namedDistrict = useMemo(
    () => districts.find((d) => q.includes(d.toLowerCase())) ?? null,
    [districts, q],
  );

  // §7.4 — the write is not optional, and it happens on the empty result rather
  // than on the NOTIFY ME tap: a miss nobody acts on is still the signal.
  // ponytail: one row per distinct query string, guarded by `forQuery` — a row
  // per keystroke would drown the desk. Debounce server-side if it still does.
  useEffect(() => {
    if (!empty || q.length < 3 || miss?.forQuery === q) return;
    let alive = true;
    const t = setTimeout(() => {
      supabase.rpc('log_search_miss', { p_query: query.trim(), p_district: namedDistrict })
        .then(({ data, error }) => {
          if (!alive || error || !data?.[0]) return;
          setMiss({ id: data[0].search_id, asks: data[0].asks, forQuery: q });
          setTags([]); setNotified(false);
        });
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [empty, q, query, namedDistrict, miss?.forQuery]);

  async function notifyMe() {
    if (!miss) return;
    const { error } = await supabase.rpc('set_search_notify', { p_search: miss.id, p_tags: tags, p_notify: true });
    if (!error) setNotified(true);
  }

  function pick(s: SalonCard) {
    if (query.trim()) remember(query.trim());
    onPick(s);
  }

  // EXPL-13's "suggested" (README §3) — top rated, which is a claim the data
  // supports. The design labels this strip BUSY NEAR YOU; nothing measures how
  // busy a shop is, so it says what it actually sorted by.
  const suggested = useMemo(() => salons
    .map((s) => ({ s, avg: avgOf(s.barbers.flatMap((b) => b.reviews)) }))
    .filter((x): x is { s: SalonCard; avg: number } => x.avg != null)
    .sort((a, b) => b.avg - a.avg).slice(0, 3), [salons]);

  const services = useMemo(() => [...new Set(salons
    .flatMap((s) => s.barbers.flatMap((b) => b.services))
    .filter((sv) => sv.is_active).map((sv) => sv.name))].slice(0, 6), [salons]);

  const closest = useMemo(() => {
    if (!salons.length) return null;
    if (!kmFor) return salons[0];
    return [...salons].sort((a, b) => (kmFor(a) ?? Infinity) - (kmFor(b) ?? Infinity))[0];
  }, [salons, kmFor]);

  const header = (
    <View style={s.searchRow}>
      <View style={s.pill}>
        <Ionicons name="search" size={16} color={colors.text} />
        <TextInput style={s.input} value={query} onChangeText={setQuery} autoFocus
          placeholder="Search salon or barber…" placeholderTextColor={colors.textSecondary}
          returnKeyType="search" />
        {query.length > 0 && (
          <Pressable hitSlop={8} onPress={() => setQuery('')} accessibilityLabel="Clear search">
            <Ionicons name="close" size={16} color={colors.textTertiary} />
          </Pressable>
        )}
      </View>
      <Pressable hitSlop={8} onPress={onClose}><Text style={s.cancel}>Cancel</Text></Pressable>
    </View>
  );

  return (
    <View style={s.screen}>
      {header}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.body}>
        {/* ---- EXPL-13 · before typing ---- */}
        {!q && (
          <>
            {recent.length > 0 && (
              <View style={s.section}>
                <View style={s.sectionHead}>
                  <Text style={s.eyebrow}>Recent</Text>
                  <Pressable hitSlop={8} onPress={clearRecent}><Text style={s.link}>Clear</Text></Pressable>
                </View>
                {recent.map((r) => (
                  <Pressable key={r} style={s.recentRow} onPress={() => setQuery(r)}>
                    <Ionicons name="time-outline" size={15} color={colors.textSecondary} />
                    <Text style={s.recentText}>{r}</Text>
                    <Pressable hitSlop={8} onPress={() => dropRecent(r)} accessibilityLabel={`Remove ${r}`}>
                      <Ionicons name="close" size={13} color={colors.textTertiary} />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            )}
            {services.length > 0 && (
              <View style={s.section}>
                <Text style={s.eyebrow}>Services</Text>
                <View style={s.wrapRow}>
                  {services.map((name) => (
                    <Pressable key={name} style={s.svcChip} onPress={() => setQuery(name)}>
                      <Text style={s.svcChipText}>{name}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            {suggested.length > 0 && (
              <View style={s.section}>
                <Text style={s.eyebrow}>Suggested</Text>
                {suggested.map(({ s: sal, avg }) => (
                  <Pressable key={sal.id} style={s.row} onPress={() => pick(sal)}>
                    <Thumb salon={sal} style={s.thumbSm} />
                    <View style={s.grow}>
                      <Text style={s.rowTitle} numberOfLines={1}>{sal.name}</Text>
                      <Stars rating={avg} />
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        {/* ---- EXPL-14 · salons and specialists in one list ---- */}
        {q.length > 0 && !empty && (
          <>
            {salonHits.length > 0 && (
              <View style={s.section}>
                <Text style={s.eyebrow}>Salons · {salonHits.length}</Text>
                {salonHits.map((sal) => {
                  const avg = avgOf(sal.barbers.flatMap((b) => b.reviews));
                  const price = startingPrice(sal);
                  const km = kmFor?.(sal);
                  return (
                    <Pressable key={sal.id} style={s.card} onPress={() => pick(sal)}>
                      <Thumb salon={sal} style={s.thumb} />
                      <View style={s.grow}>
                        <Text style={s.cardTitle} numberOfLines={1}>{sal.name}</Text>
                        <Text style={s.meta} numberOfLines={1}>
                          {[avg != null ? `${avg.toFixed(1)} ★` : null,
                            km != null ? `${km.toFixed(1)} Km` : sal.district,
                            price != null ? `from ${Math.round(price / 100)} DH` : null,
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <SaveHeart kind="salon" id={sal.id} variant="puck" />
                    </Pressable>
                  );
                })}
              </View>
            )}
            {barberHits.length > 0 && (
              <View style={s.section}>
                <Text style={s.eyebrow}>Specialists · {barberHits.length}</Text>
                {barberHits.map(({ salon: sal, barber: b }) => {
                  const avg = avgOf(b.reviews);
                  return (
                    <Pressable key={b.id} style={s.card} onPress={() => pick(sal)}>
                      {b.profiles?.avatar_url
                        ? <Image source={{ uri: b.profiles.avatar_url }} style={s.avatar} />
                        : <View style={[s.avatar, { backgroundColor: colors.slotEmpty }]} />}
                      <View style={s.grow}>
                        <Text style={s.cardTitle} numberOfLines={1}>{b.profiles?.full_name ?? 'Barber'}</Text>
                        <Text style={s.meta} numberOfLines={1}>
                          {[b.specialty, sal.name].filter(Boolean).join(' · ')}
                        </Text>
                        {avg != null && <Text style={s.meta}>{avg.toFixed(1)} ★</Text>}
                      </View>
                      {/* EXPL-29 — keep him without opening his page. Replaces
                          the chevron, as the design draws it: the row is still
                          the way in. */}
                      <SaveHeart kind="barber" id={b.id} variant="puck" />
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        )}

        {/* ---- EXPL-15 · not an error state. A demand signal. ---- */}
        {empty && (
          <>
            <View style={s.missHead}>
              <View style={s.missIcon}>
                <Ionicons name="search" size={22} color={colors.textSecondary} />
              </View>
              <Display size={21} style={s.missTitle}>
                {namedDistrict ? `Nothing in ${namedDistrict} yet` : 'Nothing matched that'}
              </Display>
              <Text style={s.missBody}>
                {namedDistrict
                  ? `We have ${salons.length} shop${salons.length === 1 ? '' : 's'} in Tangier, but none in that district. Tell us and we'll go find one.`
                  : `We have ${salons.length} shop${salons.length === 1 ? '' : 's'} in Tangier and none of them match. Tell us what you're after and we'll go find it.`}
              </Text>
            </View>

            <View style={s.tellCard}>
              <Text style={s.tellEyebrow}>Tell us where</Text>
              <View style={s.tellPlace}>
                <Ionicons name="location-outline" size={15} color={colors.accent} />
                <Text style={s.tellPlaceText}>
                  {namedDistrict ? `${namedDistrict}, Tangier` : `“${query.trim()}” · Tangier`}
                </Text>
              </View>
              <View style={s.wrapRow}>
                {WANT_TAGS.map((t) => {
                  const on = tags.includes(t);
                  return (
                    <Pressable key={t} disabled={notified}
                      style={[s.tag, on && s.tagOn]}
                      onPress={() => setTags((p) => (on ? p.filter((x) => x !== t) : [...p, t]))}>
                      <Text style={[s.tagText, on && s.tagTextOn]}>{t}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable style={[s.notifyBtn, notified && s.notifyDone]}
                disabled={notified || !miss} onPress={notifyMe}>
                <Text style={[s.notifyText, notified && s.notifyTextDone]}>
                  {notified ? "WE'LL TELL YOU" : 'NOTIFY ME WHEN THERE IS ONE'}
                </Text>
              </Pressable>
              {miss != null && miss.asks > 1 && (
                <Text style={s.tellFoot}>
                  {miss.asks} people asked for {namedDistrict ?? 'this'} this month
                </Text>
              )}
            </View>

            {closest && (
              <View style={s.section}>
                <Text style={s.eyebrow}>{kmFor ? 'Closest instead' : 'Try instead'}</Text>
                <Pressable style={s.card} onPress={() => pick(closest)}>
                  <Thumb salon={closest} style={s.thumb} />
                  <View style={s.grow}>
                    <Text style={s.cardTitle} numberOfLines={1}>{closest.name}</Text>
                    <Text style={s.meta} numberOfLines={1}>
                      {[kmFor?.(closest) != null ? `${kmFor!(closest)!.toFixed(1)} Km away` : closest.district,
                        avgOf(closest.barbers.flatMap((b) => b.reviews))?.toFixed(1)
                          ? `${avgOf(closest.barbers.flatMap((b) => b.reviews))!.toFixed(1)} ★` : null,
                      ].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: TOP_INSET, backgroundColor: colors.surface },
  grow: { flex: 1 },
  body: { paddingHorizontal: sp(5), paddingBottom: TAB_BAR_INSET, gap: sp(5) },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: sp(2.5), paddingHorizontal: sp(5), marginBottom: sp(3) },
  pill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: sp(2.5), height: 48,
    paddingHorizontal: sp(4.5), borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.ink, ...shadow,
  },
  input: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text, padding: 0 },
  cancel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },

  section: { gap: sp(2.5) },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  eyebrow: {
    fontSize: font.tiny, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 1.65, textTransform: 'uppercase',
  },
  link: { fontSize: 12, fontWeight: '600', color: colors.accent },

  recentRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3), paddingVertical: sp(2.75) },
  recentText: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },

  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  svcChip: { borderRadius: radius.pill, backgroundColor: colors.bg, paddingVertical: 10, paddingHorizontal: 16 },
  svcChipText: { fontSize: font.small, fontWeight: '600', color: colors.text },

  row: { flexDirection: 'row', alignItems: 'center', gap: sp(3), backgroundColor: colors.bg, borderRadius: radius.md, padding: sp(2.75) },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  thumbSm: { width: 42, height: 42, borderRadius: 12 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: colors.bg, borderRadius: 18, padding: sp(3), ...shadow,
  },
  thumb: { width: 58, height: 58, borderRadius: 14 },
  avatar: { width: 52, height: 52, borderRadius: radius.pill },
  cardTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  meta: { fontSize: 11.5, color: colors.textSecondary },
  chev: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },

  // EXPL-15
  missHead: { alignItems: 'center', gap: sp(2.5), paddingTop: sp(6) },
  missIcon: {
    width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.hairline,
    alignItems: 'center', justifyContent: 'center',
  },
  missTitle: { textAlign: 'center', marginTop: sp(1) },
  missBody: { fontSize: font.small, lineHeight: 20, color: colors.textSecondary, textAlign: 'center', maxWidth: 270 },

  tellCard: { backgroundColor: colors.ink, borderRadius: 22, padding: sp(4.5), gap: sp(3.5) },
  tellEyebrow: {
    fontSize: font.tiny, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 1.65, textTransform: 'uppercase',
  },
  tellPlace: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2.5),
    backgroundColor: '#1C1C1A', borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14,
  },
  tellPlaceText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.onAccent },
  tag: { borderRadius: radius.pill, backgroundColor: '#1C1C1A', paddingVertical: 8, paddingHorizontal: 13 },
  tagOn: { backgroundColor: colors.accent },
  tagText: { fontSize: 12, fontWeight: '600', color: '#9A9A95' },
  tagTextOn: { color: colors.onAccent },
  notifyBtn: {
    height: 50, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  notifyDone: { backgroundColor: 'rgba(255,255,255,0.12)' },
  notifyText: { fontSize: 12.5, fontWeight: '700', color: colors.text, letterSpacing: 1 },
  notifyTextDone: { color: colors.onAccent },
  tellFoot: { fontSize: font.tiny, lineHeight: 16, color: '#6E6E69', textAlign: 'center' },
});
