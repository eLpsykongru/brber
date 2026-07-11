import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Image, Linking, Pressable, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Empty, Field, PillButton, ScreenHeader, Stars } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import type { Service, Specialist } from '../types';
import ChatScreen from './ChatScreen';

type Props = {
  barber: Specialist;
  salonName: string;
  onBack: () => void;
  onChromeHidden?: (hidden: boolean) => void;
};

type Tab = 'services' | 'about' | 'gallery' | 'reviews';
type Window = { weekday: number; start_min: number; end_min: number };
type Range = { starts_at: string; ends_at: string };
type Review = {
  id: string; rating: number; comment: string | null; created_at: string;
  customer: { full_name: string | null } | null;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SLOT_STEP_MIN = 30;

function toHHMM(mins: number) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? 's' : ''} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? 's' : ''} ago`;
}

type SlotStatus = 'free' | 'full' | 'past';
type Slot = { time: Date; status: SlotStatus };

// all slots in the day's working window, each tagged free / full (booked) / past.
// full & past are shown but disabled; full gets a strike-through.
function daySlots(day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[]): Slot[] {
  if (daysOff.includes(localDateStr(day))) return [];
  const now = Date.now();
  const slots: Slot[] = [];
  for (const w of windows.filter((w) => w.weekday === day.getDay())) {
    for (let t = w.start_min; t + durationMin <= w.end_min; t += SLOT_STEP_MIN) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t);
      const end = start.getTime() + durationMin * 60_000;
      const full = booked.some((b) => start.getTime() < new Date(b.ends_at).getTime()
        && end > new Date(b.starts_at).getTime());
      const status: SlotStatus = start.getTime() <= now ? 'past' : full ? 'full' : 'free';
      slots.push({ time: start, status });
    }
  }
  return slots;
}

// Monday-based start of the week containing `d`
function weekStartOf(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = s.getDay(); // 0 = Sun
  s.setDate(s.getDate() - (day === 0 ? 6 : day - 1));
  return s;
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export default function BarberDetailScreen({ barber, salonName, onBack, onChromeHidden }: Props) {
  const [tab, setTab] = useState<Tab>('services');
  const [services, setServices] = useState<Service[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [booked, setBooked] = useState<Range[]>([]);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [selected, setSelected] = useState<Service | null>(null);
  const [slotMode, setSlotMode] = useState(false);
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [selectedTime, setSelectedTime] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [reviewQuery, setReviewQuery] = useState('');
  const [chatBookingId, setChatBookingId] = useState<string | null>(null);
  const [meId, setMeId] = useState('');

  const name = barber.profiles?.full_name ?? 'Barber';
  const avg = barber.reviews.length
    ? barber.reviews.reduce((s, r) => s + r.rating, 0) / barber.reviews.length
    : null;

  const today = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }, []);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i)),
    [weekStart],
  );
  const canGoPrev = weekStart.getTime() > weekStartOf(today).getTime();

  async function loadBooked(ws: Date) {
    const from = new Date(Math.max(ws.getTime(), Date.now()));
    const to = new Date(ws.getTime() + 7 * 86_400_000);
    const { data } = await supabase.rpc('booked_ranges',
      { p_barber: barber.id, p_from: from.toISOString(), p_to: to.toISOString() });
    setBooked(data ?? []);
  }

  async function loadCalendar() {
    const [av, off] = await Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barber.id),
      supabase.from('days_off').select('day').eq('barber_id', barber.id),
    ]);
    setWindows(av.data ?? []);
    setDaysOff((off.data ?? []).map((d) => d.day));
    loadBooked(weekStart);
  }

  function changeWeek(dir: 'prev' | 'next') {
    if (dir === 'prev' && !canGoPrev) return;
    const ws = new Date(weekStart);
    ws.setDate(ws.getDate() + (dir === 'next' ? 7 : -7));
    setWeekStart(ws);
    setSelectedTime(null);
    // land on the first bookable day of the new week (today if it's this week)
    const firstDay = ws.getTime() <= today.getTime() ? today : ws;
    setSelectedDay(firstDay);
    loadBooked(ws);
  }

  useEffect(() => {
    supabase.from('services')
      .select('id, name, price_cents, duration_min, is_active')
      .eq('barber_id', barber.id).eq('is_active', true).order('price_cents')
      .then(({ data }) => setServices(data ?? []));
    supabase.from('reviews')
      .select('id, rating, comment, created_at, customer:profiles!customer_id(full_name)')
      .eq('barber_id', barber.id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setReviews((data as unknown as Review[]) ?? []));
    supabase.rpc('barber_customer_count', { p_barber: barber.id })
      .then(({ data }) => setCustomerCount(typeof data === 'number' ? data : null));
    listPortfolio(barber.id).then(setPhotos);
    loadCalendar();
  }, [barber.id]);

  function share() {
    Share.share({ message: `${name} — ${barber.specialty ?? 'Barber'} at ${salonName}. Book on brber!` });
  }

  async function openChat() {
    const { data: auth } = await supabase.auth.getUser();
    const { data } = await supabase.from('bookings').select('id')
      .eq('customer_id', auth.user!.id).eq('barber_id', barber.id)
      .in('status', ['pending', 'confirmed']).order('starts_at').limit(1);
    if (!data?.length) {
      return Alert.alert('No booking yet', 'Book an appointment first to message this barber.');
    }
    setMeId(auth.user!.id);
    setChatBookingId(data[0].id);
    onChromeHidden?.(true);
  }

  function call() {
    const phone = barber.profiles?.phone;
    if (phone) Linking.openURL(`tel:${phone}`);
  }

  async function book(slot: Date) {
    const svc = selected!;
    const when = `${slot.toDateString()} ${slot.toTimeString().slice(0, 5)}`;
    Alert.alert('Confirm booking',
      `${svc.name} with ${name} at ${salonName}\n${when}\n${(svc.price_cents / 100).toFixed(2)} DH, paid at the shop`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Book',
          onPress: async () => {
            setBusy(true);
            const { data: auth } = await supabase.auth.getUser();
            const { error } = await supabase.from('bookings').insert({
              customer_id: auth.user!.id, barber_id: barber.id,
              service_id: svc.id, starts_at: slot.toISOString(),
            });
            setBusy(false);
            if (error) Alert.alert('Could not book', error.message);
            else {
              Alert.alert('Booked!', 'Your appointment is confirmed. Pay at the shop.');
              setSlotMode(false);
              setSelected(null);
              setSelectedTime(null);
              loadCalendar();
            }
          },
        },
      ]);
  }

  if (chatBookingId) {
    return <ChatScreen bookingId={chatBookingId} myId={meId} title={name}
      onBack={() => { setChatBookingId(null); onChromeHidden?.(false); }} />;
  }

  // ---------- slot picking (weekly day selector + time grid) ----------
  if (slotMode && selected) {
    const slots = daySlots(selectedDay, selected.duration_min, windows, booked, daysOff);
    return (
      <View style={s.screen}>
        <ScreenHeader title="Pick a time" onBack={() => setSlotMode(false)} />
        <Text style={s.slotSubtitle}>
          {selected.name} · {selected.duration_min} min · {(selected.price_cents / 100).toFixed(2)} DH
        </Text>

        {/* week header — no month/year, just navigation */}
        <View style={s.weekHead}>
          <Text style={s.weekLabel}>Select a date</Text>
          <View style={s.weekNav}>
            <Pressable onPress={() => changeWeek('prev')} disabled={!canGoPrev} hitSlop={6}
              accessibilityLabel="Previous week"
              style={({ pressed }) => [s.navBtn, pressed && s.pressed, !canGoPrev && s.navDisabled]}>
              <Ionicons name="chevron-back" size={18} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => changeWeek('next')} hitSlop={6} accessibilityLabel="Next week"
              style={({ pressed }) => [s.navBtn, pressed && s.pressed]}>
              <Ionicons name="chevron-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>

        {/* 7-day row */}
        <View style={s.weekRow}>
          {weekDays.map((d) => {
            const isPast = d.getTime() < today.getTime();
            const isSel = sameDay(d, selectedDay);
            return (
              <Pressable key={d.toISOString()} disabled={isPast} style={s.dayCol}
                onPress={() => { setSelectedDay(d); setSelectedTime(null); }}>
                <Text style={[s.dayDow, isPast && s.dayMuted]}>
                  {d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 2)}
                </Text>
                <View style={[s.dayNum, isSel && s.dayNumActive, isPast && s.dayNumPast]}>
                  <Text style={[s.dayNumText, isSel && s.dayNumTextActive, isPast && s.dayMuted]}>
                    {d.getDate()}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* time grid */}
        <ScrollView contentContainerStyle={s.slotScroll}>
          {slots.length === 0 && <Empty text="Not working this day." />}
          <View style={s.slotGrid}>
            {slots.map(({ time, status }) => {
              const isSel = selectedTime?.getTime() === time.getTime();
              const disabled = status !== 'free';
              return (
                <Pressable key={time.getTime()} disabled={disabled}
                  onPress={() => setSelectedTime(time)}
                  style={[s.slot, isSel && s.slotSel, status === 'full' && s.slotFull, status === 'past' && s.slotPast]}>
                  <Text style={[
                    s.slotText,
                    isSel && s.slotTextSel,
                    status === 'full' && s.slotTextFull,
                    status === 'past' && s.slotTextPast,
                  ]}>
                    {time.toTimeString().slice(0, 5)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {slots.some((sl) => sl.status === 'full') && (
            <Text style={s.legend}>Crossed-out times are already booked.</Text>
          )}
        </ScrollView>

        {/* confirm */}
        <View style={s.slotCta}>
          <PillButton title={selectedTime ? `Book ${selectedTime.toTimeString().slice(0, 5)}` : 'Select a time'}
            disabled={!selectedTime || busy} onPress={() => selectedTime && book(selectedTime)} />
        </View>
      </View>
    );
  }

  // ---------- main specialist screen ----------
  const filteredReviews = reviews.filter((r) => {
    const q = reviewQuery.trim().toLowerCase();
    return !q || r.comment?.toLowerCase().includes(q) || r.customer?.full_name?.toLowerCase().includes(q);
  });
  const openDays = WEEKDAYS
    .map((label, i) => ({ label, w: windows.find((w) => w.weekday === i) }))
    .filter((x) => x.w);

  const stats: { icon: keyof typeof Ionicons.glyphMap; value: string; label: string }[] = [
    { icon: 'people-outline', value: customerCount != null ? String(customerCount) : '–', label: 'Customers' },
    { icon: 'briefcase-outline', value: barber.years_experience != null ? `${barber.years_experience}+` : '–', label: 'Years Exp' },
    { icon: 'star-outline', value: avg != null ? avg.toFixed(1) : '–', label: 'Rating' },
    { icon: 'chatbubble-outline', value: String(barber.reviews.length), label: 'Reviews' },
  ];

  return (
    <View style={s.screen}>
      <ScreenHeader title="Specialist" onBack={onBack}
        right={
          <Pressable onPress={share} hitSlop={8} accessibilityLabel="Share this specialist"
            style={({ pressed }) => pressed && s.pressed}>
            <Ionicons name="share-social-outline" size={18} color={colors.text} />
          </Pressable>
        } />

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* profile block */}
        <View style={s.profileRow}>
          <View>
            {barber.profiles?.avatar_url
              ? <Image source={{ uri: barber.profiles.avatar_url }} style={s.avatar} />
              : (
                <View style={[s.avatar, s.avatarFallback]}>
                  <Text style={s.avatarInitials}>
                    {name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </Text>
                </View>
              )}
            <View style={s.badge}>
              <Ionicons name="checkmark-circle" size={22} color={colors.text} />
            </View>
          </View>
          <View style={s.profileText}>
            <Text style={s.name}>{name}</Text>
            <Text style={s.subtitle} numberOfLines={1}>
              {barber.specialty ?? 'Barber'} | {salonName}
            </Text>
          </View>
        </View>

        <View style={s.divider} />

        {/* stats row */}
        <View style={s.statsRow}>
          {stats.map((st) => (
            <View key={st.label} style={s.stat}>
              <View style={s.statCircle}>
                <Ionicons name={st.icon} size={20} color={colors.textSecondary} />
              </View>
              <Text style={s.statValue}>{st.value}</Text>
              <Text style={s.statLabel}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* tabs */}
        <View style={s.tabsRow}>
          {(['services', 'about', 'gallery', 'reviews'] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={s.tabBtn}
              accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={[s.tabText, tab === t && s.tabTextActive]}>
                {t === 'reviews' ? 'Review' : t[0].toUpperCase() + t.slice(1)}
              </Text>
              {tab === t && <View style={s.tabUnderline} />}
            </Pressable>
          ))}
        </View>

        {/* SERVICES */}
        {tab === 'services' && (
          <View style={s.tabBody}>
            <Text style={s.sectionTitle}>Services <Text style={s.count}>({services.length})</Text></Text>
            {services.length === 0 && <Empty text="No services listed yet." />}
            {services.map((sv) => {
              const on = selected?.id === sv.id;
              return (
                <TouchableOpacity key={sv.id} style={[s.serviceCard, on && s.serviceCardActive]}
                  onPress={() => setSelected(on ? null : sv)}>
                  <View style={s.grow}>
                    <Text style={s.serviceName}>{sv.name}</Text>
                    <Text style={s.meta}>{sv.duration_min} minutes</Text>
                  </View>
                  <Text style={s.servicePrice}>{(sv.price_cents / 100).toFixed(2)} DH</Text>
                  <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22}
                    color={on ? colors.accent : colors.border} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ABOUT */}
        {tab === 'about' && (
          <View style={s.tabBody}>
            <Text style={s.sectionTitle}>About specialist</Text>
            {barber.bio ? (
              <Pressable onPress={() => setBioExpanded(!bioExpanded)}>
                <Text style={s.bodyText} numberOfLines={bioExpanded ? undefined : 3}>{barber.bio}</Text>
                {barber.bio.length > 120 && (
                  <Text style={s.readMore}>{bioExpanded ? 'Read less' : 'Read more'}</Text>
                )}
              </Pressable>
            ) : <Text style={s.meta}>No bio yet.</Text>}

            <Text style={s.sectionTitle}>Specialist contact</Text>
            <View style={s.contactRow}>
              <View style={[s.contactAvatar, s.avatarFallback]}>
                <Text style={s.contactInitials}>
                  {name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
              <View style={s.grow}>
                <Text style={s.contactName}>{name}</Text>
                <Text style={s.meta}>{barber.specialty ?? 'Barber'}</Text>
              </View>
              <Pressable onPress={openChat} hitSlop={6} accessibilityLabel="Message"
                style={({ pressed }) => [s.roundBtn, pressed && s.pressed]}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.text} />
              </Pressable>
              {!!barber.profiles?.phone && (
                <Pressable onPress={call} hitSlop={6} accessibilityLabel="Call"
                  style={({ pressed }) => [s.roundBtn, pressed && s.pressed]}>
                  <Ionicons name="call-outline" size={18} color={colors.text} />
                </Pressable>
              )}
            </View>

            <Text style={s.sectionTitle}>Working hours</Text>
            {openDays.length === 0 && <Text style={s.meta}>Hours not set yet.</Text>}
            {openDays.map(({ label, w }) => (
              <View key={label} style={s.hoursRow}>
                <Text style={s.bodyText}>{label}</Text>
                <Text style={s.hoursText}>{toHHMM(w!.start_min)} – {toHHMM(w!.end_min)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* GALLERY */}
        {tab === 'gallery' && (
          <View style={s.tabBody}>
            <Text style={s.sectionTitle}>Gallery <Text style={s.count}>({photos.length})</Text></Text>
            {photos.length === 0 && <Empty text="No photos yet." />}
            <View style={s.galleryGrid}>
              {photos.map((p) => (
                <Image key={p.name} source={{ uri: p.url }} style={s.galleryPhoto} />
              ))}
            </View>
          </View>
        )}

        {/* REVIEWS */}
        {tab === 'reviews' && (
          <View style={s.tabBody}>
            <Text style={s.sectionTitle}>Reviews <Text style={s.count}>({reviews.length})</Text></Text>
            {reviews.length > 3 && (
              <Field placeholder="Search in reviews" value={reviewQuery} onChangeText={setReviewQuery} />
            )}
            {filteredReviews.length === 0 && <Empty text="No reviews yet." />}
            {filteredReviews.map((r) => (
              <View key={r.id} style={s.reviewCard}>
                <View style={s.reviewTop}>
                  <Text style={s.reviewName}>{r.customer?.full_name ?? 'Customer'}</Text>
                  <Text style={s.meta}>{timeAgo(r.created_at)}</Text>
                </View>
                {!!r.comment && <Text style={s.bodyText}>{r.comment}</Text>}
                <Stars rating={r.rating} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* pinned CTA */}
      <View style={s.cta}>
        <PillButton title="Book Appointment"
          onPress={() => {
            if (!selected) {
              setTab('services');
              return Alert.alert('Pick a service', 'Select a service first, then book.');
            }
            setWeekStart(weekStartOf(today));
            setSelectedDay(today);
            setSelectedTime(null);
            loadBooked(weekStartOf(today));
            setSlotMode(true);
          }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.bg },
  content: { paddingBottom: 120, gap: sp(3) },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },

  profileRow: { flexDirection: 'row', alignItems: 'center', gap: sp(4), marginTop: sp(2) },
  avatar: { width: 92, height: 92, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { fontSize: 30, fontWeight: '700', color: colors.accent },
  badge: {
    position: 'absolute', bottom: 0, right: 0, backgroundColor: colors.bg,
    borderRadius: radius.pill,
  },
  profileText: { flex: 1, gap: 2 },
  name: { fontSize: font.title, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: font.small, color: colors.textSecondary },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: sp(1) },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', gap: 2, flex: 1 },
  statCircle: {
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: sp(1),
  },
  statValue: { fontSize: font.body, fontWeight: '700', color: colors.text },
  statLabel: { fontSize: font.tiny, color: colors.textSecondary },

  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: sp(2.5) },
  tabText: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabUnderline: {
    position: 'absolute', bottom: -1, height: 3, width: 36,
    backgroundColor: colors.accent, borderRadius: 2,
  },
  tabBody: { gap: sp(2.5) },
  sectionTitle: { fontSize: font.body, fontWeight: '700', color: colors.text, marginTop: sp(1) },
  count: { color: colors.textTertiary, fontWeight: '400' },
  meta: { fontSize: font.small, color: colors.textSecondary },
  bodyText: { fontSize: font.body, color: colors.text, lineHeight: 22 },
  readMore: { color: colors.accent, fontWeight: '600', fontSize: font.small, marginTop: 2 },

  serviceCard: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: sp(4), backgroundColor: colors.bg,
  },
  serviceCardActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  serviceName: { fontSize: font.body, fontWeight: '600', color: colors.text },
  servicePrice: { fontSize: font.body, fontWeight: '700', color: colors.text },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  contactAvatar: { width: 48, height: 48, borderRadius: radius.pill },
  contactInitials: { fontSize: font.body, fontWeight: '700', color: colors.accent },
  contactName: { fontSize: font.body, fontWeight: '600', color: colors.text },
  roundBtn: {
    width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: sp(1) },
  hoursText: { fontSize: font.body, color: colors.textSecondary },

  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  galleryPhoto: {
    width: '48.5%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface,
  },

  reviewCard: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg,
    padding: sp(3.5), gap: sp(1.5), backgroundColor: colors.bg,
  },
  reviewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewName: { fontSize: font.small, fontWeight: '700', color: colors.text },

  cta: { position: 'absolute', left: sp(5), right: sp(5), bottom: sp(7) },

  slotSubtitle: { textAlign: 'center', color: colors.textSecondary, fontSize: font.small, marginBottom: sp(3) },

  weekHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: sp(2) },
  weekLabel: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  weekNav: { flexDirection: 'row', gap: sp(2) },
  navBtn: {
    width: 34, height: 34, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  navDisabled: { opacity: 0.35 },

  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: sp(4) },
  dayCol: { alignItems: 'center', gap: sp(1.5), flex: 1 },
  dayDow: { fontSize: font.tiny, color: colors.textSecondary },
  dayMuted: { color: colors.textTertiary },
  dayNum: {
    width: 38, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
  },
  dayNumActive: { backgroundColor: colors.accent },
  dayNumPast: { opacity: 0.5 },
  dayNumText: { fontSize: font.body, fontWeight: '700', color: colors.text },
  dayNumTextActive: { color: colors.onAccent },

  slotScroll: { paddingBottom: 100 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  slot: {
    width: '31%', alignItems: 'center', paddingVertical: sp(3), borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  slotSel: { backgroundColor: colors.accent, borderColor: colors.accent },
  slotFull: { backgroundColor: colors.surface, borderColor: colors.surface },
  slotPast: { opacity: 0.5 },
  slotText: { color: colors.text, fontWeight: '600', fontSize: font.small },
  slotTextSel: { color: colors.onAccent },
  slotTextFull: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  slotTextPast: { color: colors.textTertiary },
  legend: { fontSize: font.tiny, color: colors.textTertiary, marginTop: sp(3) },
  slotCta: { position: 'absolute', left: sp(5), right: sp(5), bottom: sp(7) },
});
