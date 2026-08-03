import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, FlatList, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Display, Field, Stars, TAB_BAR_INSET } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, sp } from '../theme';
import { OfflineBanner, useOnline } from '../components/Offline';
import { clearQueueActivity, syncQueueActivity } from '../lib/queueActivity';
import CustomerNotificationsScreen from './CustomerNotificationsScreen';
import MyBookingScreen from './MyBookingScreen';
import CheckInScreen, { WalkInTicketScreen, YoureNextScreen } from './QueueScreens';
import QueueScreen, { DayQueueRow, minutesUntil, QUEUE_POLL_MS } from './QueueScreen';
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

type MyBooking = {
  id: string;
  starts_at: string;
  barbers: { id: string; profiles: { full_name: string | null } | null; salon: { name: string } | null } | null;
};

// ponytail: single-city launch → list all salons; distance sort/search
// arrives with the Google Places + lat/lng work
// 29b — mirror the live queue onto the lock screen for as long as it is live.
// Lives next to the poll that already knows the answer rather than opening a
// second subscription to say the same thing.
function useQueueActivity(
  mine: DayQueueRow | null,
  queue: DayQueueRow[],
  booking: MyBooking | null,
) {
  useEffect(() => {
    if (!mine || !booking) { clearQueueActivity(); return; }
    if (mine.stage === 'done') { clearQueueActivity(); return; }

    const ahead = queue.filter((r) => r.stage !== 'done' && r.booking_id !== mine.booking_id
      && new Date(r.starts_at).getTime() < new Date(mine.starts_at).getTime()).length;
    syncQueueActivity({
      phase: mine.stage === 'in_chair' ? 'chair' : ahead === 0 ? 'next' : 'waiting',
      ticketNo: queue.findIndex((r) => r.booking_id === mine.booking_id) + 1,
      ahead,
      etaMin: minutesUntil(mine.starts_at),
      barberName: booking.barbers?.profiles?.full_name ?? 'Your barber',
      salonName: booking.barbers?.salon?.name ?? 'the shop',
    });
  }, [mine?.booking_id, mine?.stage, mine?.starts_at, queue.length, booking?.id]);

  // the card must not outlive the screen that owns it
  useEffect(() => () => { clearQueueActivity(); }, []);
}

export default function DiscoverScreen({ name, customerId, onChromeHidden, onExplore, onBookings }: {
  name?: string | null; customerId?: string;
  onChromeHidden?: (hidden: boolean) => void; onExplore?: () => void; onBookings?: () => void;
}) {
  const [salons, setSalons] = useState<SalonCard[]>([]);
  const [salon, setSalon] = useState<SalonCard | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [booking, setBooking] = useState<MyBooking | null>(null);
  const [dayQueue, setDayQueue] = useState<DayQueueRow[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false); // 9a, behind the queue's MY BOOKING
  const [inboxOpen, setInboxOpen] = useState(false);   // 14a, behind the bell
  const [unread, setUnread] = useState(0);
  const [checkIn, setCheckIn] = useState(false);       // 27a, the counter code
  const [walkIn, setWalkIn] = useState<string | null>(null); // 27c, the fresh ticket
  const [ackedTakeover, setAckedTakeover] = useState<string | null>(null); // 28
  const { online, since } = useOnline();                                   // 25

  // QUEUE MODE — the live ticket is your next *confirmed* booking today; it pops
  // up once the barber confirms and shows your spot in his day. Polled: other
  // customers' booking rows are RLS-hidden, so realtime can't signal their moves.
  useEffect(() => {
    if (!customerId) return;
    let alive = true;
    async function loadTicket() {
      const d = new Date();
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const { data } = await supabase.from('bookings')
        .select('id, starts_at, barbers(id, profiles(full_name), salon:salons!salon_id(name))')
        .eq('customer_id', customerId!)
        .eq('status', 'confirmed')
        .is('completed_at', null)
        .gte('starts_at', dayStart.toISOString())
        .lt('starts_at', dayEnd.toISOString())
        .gte('ends_at', new Date().toISOString())
        .order('starts_at')
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      const b = data as unknown as MyBooking | null;
      setBooking(b);
      if (b?.barbers?.id) {
        const { data: q } = await supabase.rpc('barber_day_queue', { p_barber: b.barbers.id });
        if (alive) setDayQueue((q as DayQueueRow[]) ?? []);
      } else {
        setDayQueue([]);
      }
    }
    loadTicket();
    const t = setInterval(loadTicket, QUEUE_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [customerId]);

  useEffect(() => {
    // barbers!salon_id: disambiguates from the salons.owner_id relationship
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
  }, []);

  const loadUnread = useCallback(async () => {
    if (!customerId) return;
    const { count } = await supabase.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', customerId).is('read_at', null);
    setUnread(count ?? 0);
  }, [customerId]);
  useEffect(() => { loadUnread(); }, [loadUnread]);

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

  // 28 — the takeover. Fires off the same poll that drives the Home ticket, so
  // it appears without the customer touching anything.
  const mineQ = dayQueue.find((r) => r.booking_id === booking?.id) ?? null;
  useQueueActivity(mineQ, dayQueue, booking);
  const aheadOfMe = mineQ
    ? dayQueue.filter((r) => r.stage !== 'done' && r.booking_id !== mineQ.booking_id
      && new Date(r.starts_at).getTime() < new Date(mineQ.starts_at).getTime()).length
    : 0;
  const phase: 'next' | 'chair' | null = !mineQ ? null
    : mineQ.stage === 'in_chair' ? 'chair'
      : aheadOfMe === 0 ? 'next' : null;

  if (phase && booking && ackedTakeover !== `${booking.id}:${phase}`) {
    const bName = booking.barbers?.profiles?.full_name ?? 'Your barber';
    return <YoureNextScreen phase={phase}
      ticketNo={dayQueue.findIndex((r) => r.booking_id === booking.id) + 1}
      barberName={bName} salonName={booking.barbers?.salon?.name ?? 'the shop'}
      etaMin={minutesUntil(mineQ!.starts_at)}
      startedAt={mineQ!.stage === 'in_chair' ? mineQ!.starts_at : null}
      depositCents={0} priceCents={0}
      onAck={() => setAckedTakeover(`${booking.id}:${phase}`)}
      onMessage={() => { setAckedTakeover(`${booking.id}:${phase}`); setDetailOpen(true); }} />;
  }

  if (checkIn && customerId) {
    return <CheckInScreen onClose={() => { setCheckIn(false); onChromeHidden?.(false); }}
      onJoined={(id) => { setCheckIn(false); setWalkIn(id); }} />;
  }
  if (walkIn && booking) {
    return <WalkInTicketScreen
      ticketNo={Math.max(1, dayQueue.findIndex((r) => r.booking_id === walkIn) + 1)}
      ahead={aheadOfMe} waitMin={minutesUntil(booking.starts_at)}
      barberName={booking.barbers?.profiles?.full_name ?? 'Your barber'}
      salonName={booking.barbers?.salon?.name ?? 'the shop'}
      priceCents={0}
      onQueue={() => { setWalkIn(null); setQueueOpen(true); }}
      onLeave={async () => {
        await supabase.rpc('leave_queue', { p_booking: walkIn });
        setWalkIn(null); onChromeHidden?.(false);
      }} />;
  }
  if (inboxOpen && customerId) {
    return <CustomerNotificationsScreen userId={customerId}
      onBack={() => { setInboxOpen(false); onChromeHidden?.(false); loadUnread(); }}
      onOpenBooking={() => { setInboxOpen(false); setDetailOpen(true); }}
      onRate={() => { setInboxOpen(false); onChromeHidden?.(false); onBookings?.(); }} />;
  }
  if (detailOpen && booking && customerId) {
    return <MyBookingScreen bookingId={booking.id} myId={customerId}
      onBack={() => { setDetailOpen(false); onChromeHidden?.(false); }}
      onQueue={() => { setDetailOpen(false); setQueueOpen(true); }} />;
  }
  if (queueOpen && booking?.barbers?.id) {
    return <QueueScreen barberId={booking.barbers.id} myBookingId={booking.id}
      barberLine={`${(booking.barbers.profiles?.full_name ?? 'Barber').split(' ')[0]} · ${booking.barbers.salon?.name ?? 'Salon'}`}
      onBack={() => { setQueueOpen(false); onChromeHidden?.(false); }}
      onBookings={() => { setQueueOpen(false); setDetailOpen(true); onChromeHidden?.(true); }} />;
  }
  if (salon) {
    return <SalonDetailScreen salon={salon} onBack={() => open(null)} onChromeHidden={onChromeHidden} />;
  }

  const header = (
    <View style={styles.homeHeader}>
      {/* 25a — the banner over whatever loaded before the connection went */}
      {!online && <OfflineBanner since={since} onRetry={() => loadUnread()} />}
      {/* ponytail: single-city launch — location is a label, not a picker */}
      <View style={styles.locationHead}>
        <View>
          <Text style={styles.locationLabel}>Location</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location" size={16} color={colors.accent} />
            <Text style={styles.locationText}>Tangier, Morocco</Text>
          </View>
        </View>
        <View style={styles.headActions}>
          {/* 27a — scanning the counter code is the walk-in's way in */}
          <TouchableOpacity style={styles.bellBtn} accessibilityLabel="Check in with a shop code"
            onPress={() => { setCheckIn(true); onChromeHidden?.(true); }}>
            <Ionicons name="qr-code-outline" size={18} color={colors.text} />
          </TouchableOpacity>
          {/* 14a — the inbox behind the bell; the dot is a real unread count */}
          <TouchableOpacity style={styles.bellBtn} accessibilityLabel="Notifications"
            onPress={() => { setInboxOpen(true); onChromeHidden?.(true); }}>
            <Ionicons name="notifications-outline" size={18} color={colors.text} />
            {unread > 0 && <View style={styles.bellDot} />}
          </TouchableOpacity>
        </View>
      </View>

      <Display size={32} style={styles.greeting}>
        {greeting()},{'\n'}{(name ?? 'there').split(' ')[0]}
      </Display>

      <Field placeholder="Search salon or barber…" value={query} onChangeText={setQuery}
        style={styles.searchPill} />

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

      {/* live queue ticket (design 1a) — pops up once the barber confirms today's booking */}
      {booking && (() => {
        const mine = dayQueue.find((r) => r.booking_id === booking.id);
        const ticketNo = dayQueue.findIndex((r) => r.booking_id === booking.id) + 1;
        const ahead = dayQueue.filter((r) => r.booking_id !== booking.id && r.stage !== 'done'
          && new Date(r.starts_at).getTime() < new Date(booking.starts_at).getTime());
        const etaMin = minutesUntil(booking.starts_at);
        const slot = new Date(booking.starts_at).toTimeString().slice(0, 5);
        const inChair = mine?.stage === 'in_chair';
        const initials = (booking.barbers?.profiles?.full_name ?? 'B')
          .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
        return (
          <TouchableOpacity activeOpacity={0.9} style={styles.qCard}
            onPress={() => { setQueueOpen(true); onChromeHidden?.(true); }}>
            <View style={styles.qTop}>
              <View style={styles.qLiveRow}>
                <View style={styles.qLiveDot} />
                <Text style={styles.qLiveLabel}>LIVE QUEUE</Text>
              </View>
              <View style={styles.qTicketBadge}>
                <Text style={styles.qTicketBadgeText}>TICKET Nº {String(Math.max(ticketNo, 1)).padStart(2, '0')}</Text>
              </View>
            </View>
            <Text style={styles.qBig}>{inChair ? "You're up" : `${ahead.length} ahead`}</Text>
            <Text style={styles.qSub}>
              {inChair ? 'Take a seat — the chair is yours' : `Estimated wait ~${etaMin} min · your slot ${slot}`}
            </Text>
            <View style={styles.qProgress}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={[styles.qSeg, i < 4 - Math.min(ahead.length, 3) && styles.qSegOn]} />
              ))}
            </View>
            <View style={styles.qFoot}>
              <View style={styles.qAvatar}><Text style={styles.qAvatarText}>{initials}</Text></View>
              <Text style={styles.qFootText}>
                {(booking.barbers?.profiles?.full_name ?? 'Barber').split(' ')[0]} · {booking.barbers?.salon?.name ?? 'Salon'}
              </Text>
              <View style={styles.qArrow}>
                <Ionicons name="arrow-up" size={13} color={colors.accent} style={styles.qArrowIcon} />
              </View>
            </View>
          </TouchableOpacity>
        );
      })()}

      {topRated.length > 0 && !query && !category && (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.section}>Top rated</Text>
            {onExplore && <Text style={styles.seeAll} onPress={onExplore}>See all</Text>}
          </View>
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
  tabScreen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.surface },
  list: { gap: sp(3), paddingBottom: TAB_BAR_INSET },

  // home header
  homeHeader: { gap: sp(3), marginBottom: sp(1) },
  locationHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  locationLabel: {
    fontSize: 10, color: colors.textSecondary, fontWeight: '600',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: sp(1) },
  headActions: { flexDirection: 'row', gap: 8 },
  bellBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  bellDot: {
    position: 'absolute', top: 9, right: 10, width: 7, height: 7,
    borderRadius: 4, backgroundColor: colors.accent,
  },
  locationText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  greeting: { lineHeight: 34, marginTop: sp(1) },
  searchPill: { borderRadius: radius.pill },
  catStrip: { marginHorizontal: -sp(5) },
  catRow: { flexDirection: 'row', gap: sp(4), paddingHorizontal: sp(5) },
  catItem: { alignItems: 'center', gap: sp(1.5), width: 64 },
  catCircle: {
    width: 54, height: 54, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  catCircleActive: { backgroundColor: colors.accent },
  catLabel: { fontSize: font.tiny, color: '#5C5C58', fontWeight: '600' },
  catLabelActive: { color: colors.accent },
  topStrip: { marginHorizontal: -sp(5) },
  topRow: { flexDirection: 'row', gap: sp(3), paddingHorizontal: sp(5) },
  topCard: {
    width: 190, borderRadius: radius.lg, backgroundColor: colors.bg, overflow: 'hidden', ...shadow,
  },
  topPhoto: { width: '100%', height: 110 },
  topBody: { padding: sp(2.5), gap: 2 },
  topName: { fontSize: font.small, fontWeight: '700', color: colors.text },
  photoFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },

  card: { borderRadius: radius.lg, backgroundColor: colors.bg, overflow: 'hidden', ...shadow },
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

  // live queue ticket card (design 1a)
  qCard: { backgroundColor: colors.ink, borderRadius: radius.xl, padding: sp(5), gap: sp(3) },
  qTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  qLiveRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  qLiveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ADE80' },
  qLiveLabel: { fontSize: 10, letterSpacing: 1.8, fontWeight: '700', color: 'rgba(255,255,255,0.55)' },
  qTicketBadge: {
    backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.pill,
    paddingVertical: 5, paddingHorizontal: 10,
  },
  qTicketBadgeText: { fontSize: 10, letterSpacing: 1.2, fontWeight: '700', color: colors.onAccent },
  qBig: {
    fontFamily: serif, fontSize: 40, lineHeight: 42, color: colors.onAccent,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  qSub: { fontSize: font.small, color: 'rgba(255,255,255,0.6)', marginTop: -sp(1.5) },
  qProgress: { flexDirection: 'row', gap: 5 },
  qSeg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)' },
  qSegOn: { backgroundColor: colors.accent },
  qFoot: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2.5),
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: sp(3.5),
  },
  qAvatar: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  qAvatarText: { fontSize: font.tiny, fontWeight: '700', color: colors.onAccent },
  qFootText: { flex: 1, fontSize: font.small, fontWeight: '600', color: colors.onAccent },
  qArrow: {
    width: 30, height: 30, borderRadius: radius.pill, backgroundColor: 'rgba(232,68,46,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },
  qArrowIcon: { transform: [{ rotate: '45deg' }] },
  empty: { textAlign: 'center', color: colors.textTertiary, marginVertical: sp(3) },
  detail: { gap: sp(2), paddingBottom: TAB_BAR_INSET },
  section: {
    fontSize: font.tiny, fontWeight: '700', marginTop: sp(3), color: colors.textSecondary,
    letterSpacing: 1.8, textTransform: 'uppercase',
  },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  seeAll: { fontSize: font.small, fontWeight: '600', color: colors.accent },
  grow: { flex: 1 },
  barberRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2),
    borderRadius: radius.lg, padding: sp(3.5), backgroundColor: colors.bg, ...shadow,
  },
  barberName: { fontSize: font.body, fontWeight: '700', color: colors.text },
});
