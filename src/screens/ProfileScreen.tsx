import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import LocationPicker from '../components/LocationPicker';
import { Eyebrow, Ico, IconName, Screen, Serif, T, TAB_INSET } from '../components/dark';
import { Card, Chip, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import type { LatLng } from '../lib/geo';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, serif, shadow, sp } from '../theme';
import type { Barber, Profile } from '../types';
import { ActivityIndicator } from 'react-native';
import CouponsScreen from './CouponsScreen';
import EarningsScreen from './EarningsScreen';
import HelpCenterScreen from './HelpCenterScreen';
import MyBookingsScreen from './MyBookingsScreen';
import PortfolioScreen from './PortfolioScreen';
import AvailabilityScreen from './AvailabilityScreen';
import SalonScreen from './SalonScreen';
import SalonDetailScreen, { SalonCard } from './SalonDetailScreen';
import ServicesScreen from './ServicesScreen';
import WalletScreen from './WalletScreen';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Under review', approved: 'Live', rejected: 'Not approved',
};

type MenuItem = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean };

type ProfileView =
  | 'menu' | 'edit' | 'bookings' | 'wallet' | 'coupons' | 'help'
  | 'preview' | 'services' | 'work' | 'schedule' | 'salon' | 'earnings';

export default function ProfileScreen({ profile, barber, phone, onProfileChanged, onChromeHidden, onBack }: {
  profile: Profile; barber: Barber | null; phone: string | null;
  onProfileChanged: () => void; onChromeHidden?: (hidden: boolean) => void;
  onBack?: () => void;
}) {
  const [view, setView] = useState<ProfileView>('menu');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  // owner (not just any barber in a salon) gets the Salon management row
  const [ownsSalon, setOwnsSalon] = useState(false);

  useEffect(() => {
    if (!barber?.salon_id) return;
    supabase.from('salons').select('id')
      .eq('id', barber.salon_id).eq('owner_id', barber.id).maybeSingle()
      .then(({ data }) => setOwnsSalon(!!data));
  }, [barber?.salon_id, barber?.id]);

  const initials = (profile.full_name ?? '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  function go(next: ProfileView) {
    setView(next);
    onChromeHidden?.(next !== 'menu');
  }

  function soon(feature: string) {
    Alert.alert(feature, 'Coming soon — see BACKLOG.md');
  }

  async function changeAvatar() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [1, 1],
    });
    if (res.canceled) return;
    setAvatarBusy(true);
    try {
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const buf = await fetch(res.assets[0].uri).then((r) => r.arrayBuffer());
      const up = await supabase.storage.from('avatars').upload(path, buf, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', profile.id);
      if (error) throw error;
      setAvatarUrl(url);
      onProfileChanged();
    } catch (e: any) {
      Alert.alert('Could not update photo', e.message ?? String(e));
    } finally {
      setAvatarBusy(false);
    }
  }

  function signOut() {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, Logout', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

  if (view === 'edit') {
    return <EditProfile profile={profile} barber={barber} phone={phone}
      onDone={() => { onProfileChanged(); go('menu'); }} onBack={() => go('menu')} />;
  }
  if (view === 'bookings') {
    return <MyBookingsScreen customerId={profile.id} onChromeHidden={onChromeHidden} />;
  }
  if (view === 'wallet') return <WalletScreen customerId={profile.id} onBack={() => go('menu')} />;
  if (view === 'coupons') return <CouponsScreen onBack={() => go('menu')} />;
  if (view === 'help') return <HelpCenterScreen onBack={() => go('menu')} />;
  if (view === 'preview' && barber?.salon_id) {
    return <PreviewPage salonId={barber.salon_id} onBack={() => go('menu')}
      onChromeHidden={onChromeHidden} />;
  }
  if (view === 'salon' && barber) return <SalonScreen barberId={barber.id} onBack={() => go('menu')}
    onManageServices={() => go('services')} onEditSalon={() => go('edit')} />;
  if (view === 'schedule' && barber) return <AvailabilityScreen barberId={barber.id} onBack={() => go('menu')} />;
  if (view === 'earnings' && barber) return <EarningsScreen barberId={barber.id} onBack={() => go('menu')} />;
  if (view === 'services' && barber) return <ServicesScreen barberId={barber.id} onBack={() => go('menu')} />;
  if (view === 'work' && barber) return <PortfolioScreen barberId={barber.id} onBack={() => go('menu')} />;

  // TODO(backlog): Payment Methods / My Coupons / My Wallet — no payment rail yet
  const items: MenuItem[] = [
    { icon: 'person-outline', label: 'Your profile', onPress: () => go('edit') },
    ...(barber ? [
      { icon: 'calendar-outline', label: 'Schedule settings', onPress: () => go('schedule') },
      { icon: 'cut-outline', label: 'My Services', onPress: () => go('services') },
      { icon: 'images-outline', label: 'My Work', onPress: () => go('work') },
    ] as MenuItem[] : []),
    ...(barber?.salon_id ? [
      { icon: 'eye-outline', label: 'Preview my page', onPress: () => go('preview') },
    ] as MenuItem[] : []),
    ...(ownsSalon ? [
      { icon: 'storefront-outline', label: 'Salon management', onPress: () => go('salon') },
    ] as MenuItem[] : []),
    ...(barber ? [] : [
      { icon: 'card-outline', label: 'Payment Methods', onPress: () => soon('Payment Methods') },
      { icon: 'calendar-outline', label: 'My Bookings', onPress: () => go('bookings') },
      { icon: 'ticket-outline', label: 'My Coupons', onPress: () => go('coupons') },
      { icon: 'wallet-outline', label: 'My Wallet', onPress: () => go('wallet') },
    ] as MenuItem[]),
    { icon: 'settings-outline', label: 'Settings', onPress: () => soon('Settings') },
    { icon: 'help-circle-outline', label: 'Help Center', onPress: () => go('help') },
    { icon: 'log-out-outline', label: 'Logout', onPress: signOut, danger: true },
  ];

  if (barber) {
    return <BarberProfile profile={profile} barber={barber} avatarUrl={avatarUrl}
      avatarBusy={avatarBusy} initials={initials} ownsSalon={ownsSalon}
      onAvatar={changeAvatar} onSignOut={signOut} go={go} />;
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <ScreenHeader title="Profile" onBack={onBack} />

      <View style={s.avatarWrap}>
        <Pressable onPress={changeAvatar} disabled={avatarBusy} accessibilityLabel="Change profile photo"
          style={({ pressed }) => pressed && s.pressed}>
          {avatarUrl
            ? <Image source={{ uri: avatarUrl }} style={s.avatar} />
            : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarText}>{initials}</Text></View>}
          <View style={s.editBadge}>
            <Ionicons name={avatarBusy ? 'hourglass-outline' : 'pencil'} size={14} color={colors.onAccent} />
          </View>
        </Pressable>
        <Text style={s.name}>{profile.full_name ?? 'Your name'}</Text>
        {!!phone && <Text style={s.phone}>{phone}</Text>}
      </View>

      <View style={s.menu}>
        {items.map((it) => (
          <Pressable key={it.label} onPress={it.onPress}
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            accessibilityRole="button" accessibilityLabel={it.label}>
            <View style={[s.rowIcon, it.danger && s.rowIconDanger]}>
              <Ionicons name={it.icon} size={20} color={it.danger ? colors.accent : colors.text} />
            </View>
            <Text style={[s.rowLabel, it.danger && s.rowLabelDanger]}>{it.label}</Text>
            {!it.danger && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

// 1q — the barber's profile. Same rows, dark canvas, with the numbers that
// tell him whether his page is actually working.
function BarberProfile({
  profile, barber, avatarUrl, avatarBusy, initials, ownsSalon, onAvatar, onSignOut, go,
}: {
  profile: Profile; barber: Barber; avatarUrl: string | null; avatarBusy: boolean;
  initials: string; ownsSalon: boolean;
  onAvatar: () => void; onSignOut: () => void; go: (v: ProfileView) => void;
}) {
  const [stats, setStats] = useState<{
    salon: string | null; rating: number | null; reviews: number;
    clients: number | null; services: number; photos: number;
  }>({ salon: null, rating: null, reviews: 0, clients: null, services: 0, photos: 0 });

  useEffect(() => {
    (async () => {
      const [salon, rev, clients, svc, photos] = await Promise.all([
        barber.salon_id
          ? supabase.from('salons').select('name').eq('id', barber.salon_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('reviews').select('rating').eq('barber_id', barber.id),
        supabase.rpc('barber_customer_count', { p_barber: barber.id }),
        supabase.from('services').select('id', { count: 'exact', head: true })
          .eq('barber_id', barber.id).eq('is_active', true),
        listPortfolio(barber.id),
      ]);
      const ratings = (rev.data ?? []).map((r: any) => r.rating as number);
      setStats({
        salon: (salon.data as any)?.name ?? null,
        rating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
        reviews: ratings.length,
        clients: typeof clients.data === 'number' ? clients.data : null,
        services: svc.count ?? 0,
        photos: photos.length,
      });
    })();
  }, [barber.id, barber.salon_id]);

  const live = barber.status === 'approved';

  const rows: { icon: IconName; label: string; value?: string; onPress: () => void }[] = [
    { icon: 'user', label: 'Your profile', onPress: () => go('edit') },
    { icon: 'calendar', label: 'Schedule settings', onPress: () => go('schedule') },
    { icon: 'scissors', label: 'My services', value: String(stats.services), onPress: () => go('services') },
    { icon: 'image', label: 'My work', value: `${stats.photos} photo${stats.photos === 1 ? '' : 's'}`, onPress: () => go('work') },
    ...(ownsSalon ? [{ icon: 'edit-2' as IconName, label: 'Salon management', onPress: () => go('salon') }] : []),
    { icon: 'trending-up', label: 'Earnings', onPress: () => go('earnings') },
    { icon: 'help-circle', label: 'Help Center', onPress: () => go('help') },
  ];

  return (
    <Screen gap={15} bottom={TAB_INSET}>
      <Serif size={17} ls={0.18} style={{ textAlign: 'center' }}>Profile</Serif>

      <View style={d.headRow}>
        <Pressable onPress={onAvatar} disabled={avatarBusy} accessibilityRole="button"
          accessibilityLabel="Change profile photo" style={({ pressed }) => [d.avatarWrap, pressed && s.pressed]}>
          {avatarUrl
            ? <Image source={{ uri: avatarUrl }} style={d.avatar} />
            : <View style={d.avatar}>
                <Text style={d.avatarText}>{initials}</Text>
              </View>}
          <View style={d.editBadge}>
            <Ico name={avatarBusy ? 'clock' : 'edit-2'} size={11} color="#fff" />
          </View>
        </Pressable>
        <View style={s.grow}>
          <T w="b" size={17}>{profile.full_name ?? 'Your name'}</T>
          <T size={12} c={D.sub} style={{ marginTop: 3 }}>
            {[barber.specialty ?? 'Barber', stats.salon].filter(Boolean).join(' · ')}
          </T>
          <View style={d.ratingRow}>
            <T w="b" size={12}>{stats.rating != null ? `${stats.rating.toFixed(1)} ★` : 'No reviews yet'}</T>
            <T size={12} c={D.sub}>
              {stats.reviews} review{stats.reviews === 1 ? '' : 's'}
              {stats.clients != null ? ` · ${stats.clients} clients` : ''}
            </T>
          </View>
        </View>
      </View>

      <View style={d.liveCard}>
        <View style={[d.liveIcon, !live && { backgroundColor: D.amberSoft16 }]}>
          <Ico name={live ? 'check-circle' : 'clock'} size={16} color={live ? D.green : D.amber} />
        </View>
        <View style={s.grow}>
          <T w="b" size={13}>{live ? 'Page is live' : STATUS_LABEL[barber.status] ?? barber.status}</T>
          <T size={11} c={D.sub} style={{ marginTop: 2 }}>
            {live ? 'Customers can find and book you' : 'We’ll email you when it’s approved'}
          </T>
        </View>
        {barber.salon_id && (
          <Pressable onPress={() => go('preview')} hitSlop={8} accessibilityRole="button"
            style={({ pressed }) => pressed && s.pressed}>
            <T w="sb" size={12} c={D.accent}>Preview</T>
          </Pressable>
        )}
      </View>

      <View style={d.menu}>
        {rows.map((r, i) => (
          <Pressable key={r.label} onPress={r.onPress} accessibilityRole="button" accessibilityLabel={r.label}
            style={({ pressed }) => [d.row, i < rows.length - 1 && d.rowLine, pressed && s.pressed]}>
            <View style={d.rowIcon}><Ico name={r.icon} size={15} /></View>
            <T w="sb" size={14} style={s.grow}>{r.label}</T>
            {r.value ? <T size={12} c={D.sub}>{r.value}</T> : null}
            <Ico name="chevron-right" size={14} color={D.muted} />
          </Pressable>
        ))}
        <Pressable onPress={onSignOut} accessibilityRole="button" accessibilityLabel="Logout"
          style={({ pressed }) => [d.row, d.rowLine, pressed && s.pressed]}>
          <View style={[d.rowIcon, { backgroundColor: D.accentSoft }]}>
            <Ico name="log-out" size={15} color={D.accent} />
          </View>
          <T w="sb" size={14} c={D.accent} style={s.grow}>Logout</T>
        </Pressable>
      </View>
    </Screen>
  );
}

const d = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarWrap: { width: 76, height: 76 },
  avatar: {
    width: 76, height: 76, borderRadius: 999, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontFamily: serif, fontSize: 26, color: '#fff' },
  editBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 26, height: 26, borderRadius: 999,
    backgroundColor: D.accent, borderWidth: 3, borderColor: D.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 6 },

  liveCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 18, padding: 14, paddingHorizontal: 16,
  },
  liveIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },

  menu: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: D.border },
  rowIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
});

// "how customers see me" — fetches the salon in SalonCard shape and reuses the customer screen
function PreviewPage({ salonId, onBack, onChromeHidden }: {
  salonId: string; onBack: () => void; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [salon, setSalon] = useState<SalonCard | null>(null);

  useEffect(() => {
    supabase.from('salons')
      .select('id, name, address, lat, lng, bio, website, barbers!salon_id(id, bio, status, salon_status, specialty, years_experience, profiles(full_name, avatar_url, phone), reviews(rating), services(id, name, price_cents, duration_min, is_active, category))')
      .eq('id', salonId).single()
      .then(({ data, error }) => {
        if (error) { Alert.alert('Could not load preview', error.message); onBack(); return; }
        const card = data as unknown as SalonCard;
        setSalon({ ...card, barbers: card.barbers.filter((b) => b.status === 'approved' && b.salon_status === 'approved') });
      });
  }, [salonId]);

  if (!salon) return <View style={s.center}><ActivityIndicator /></View>;
  return <SalonDetailScreen salon={salon} onBack={onBack} onChromeHidden={onChromeHidden} />;
}

function EditProfile({ profile, barber, phone, onDone, onBack }: {
  profile: Profile; barber: Barber | null; phone: string | null;
  onDone: () => void; onBack: () => void;
}) {
  const [name, setName] = useState(profile.full_name ?? '');
  const [phoneVal, setPhoneVal] = useState(phone ?? '');
  const [specialty, setSpecialty] = useState(barber?.specialty ?? '');
  const [yearsExp, setYearsExp] = useState(
    barber?.years_experience != null ? String(barber.years_experience) : '',
  );
  const [busy, setBusy] = useState(false);
  // owned salon (if any) → owner can set/move the map pin
  const [salon, setSalon] = useState<{ id: string; name: string; lat: number | null; lng: number | null } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!barber?.salon_id) return;
    supabase.from('salons').select('id, name, lat, lng')
      .eq('id', barber.salon_id).eq('owner_id', barber.id).maybeSingle()
      .then(({ data }) => setSalon(data));
  }, [barber?.salon_id]);

  async function savePin(c: LatLng) {
    setPickerOpen(false);
    if (!salon) return;
    const { error } = await supabase.from('salons')
      .update({ lat: c.latitude, lng: c.longitude }).eq('id', salon.id);
    if (error) Alert.alert('Could not save location', error.message);
    else setSalon({ ...salon, lat: c.latitude, lng: c.longitude });
  }

  async function save() {
    if (!name.trim()) return Alert.alert('Missing name', 'Your name cannot be empty.');
    setBusy(true);
    const { error } = await supabase.from('profiles')
      .update({ full_name: name.trim(), phone: phoneVal.trim() || null })
      .eq('id', profile.id);
    let barberError = null;
    if (!error && barber) {
      const years = parseInt(yearsExp, 10);
      const res = await supabase.from('barbers').update({
        specialty: specialty.trim() || null,
        years_experience: Number.isInteger(years) && years >= 0 ? years : null,
      }).eq('id', barber.id);
      barberError = res.error;
    }
    setBusy(false);
    const err = error ?? barberError;
    if (err) Alert.alert('Could not save', err.message);
    else onDone();
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <ScreenHeader title="Your profile" onBack={onBack} />
      <Card>
        <Text style={s.label}>Full name</Text>
        <Field value={name} onChangeText={setName} placeholder="Your name" />
        <Text style={s.label}>Phone</Text>
        <Field value={phoneVal} onChangeText={setPhoneVal} placeholder="Phone" keyboardType="phone-pad" />
        {barber && (
          <>
            <Text style={s.label}>Specialty</Text>
            <Field value={specialty} onChangeText={setSpecialty} placeholder="e.g. Barber, Fade specialist" />
            <Text style={s.label}>Years of experience</Text>
            <Field value={yearsExp} onChangeText={setYearsExp} placeholder="e.g. 8" keyboardType="number-pad" />
          </>
        )}
        {salon && (
          <>
            <Text style={s.label}>Salon location ({salon.name})</Text>
            <TouchableOpacity style={s.locationBtn} onPress={() => setPickerOpen(true)}
              accessibilityLabel="Set salon location on map">
              <Ionicons name={salon.lat != null ? 'checkmark-circle' : 'location-outline'} size={20}
                color={salon.lat != null ? colors.success : colors.accent} />
              <Text style={s.locationBtnText}>
                {salon.lat != null ? 'On the map — tap to move the pin' : 'Set location on map'}
              </Text>
            </TouchableOpacity>
          </>
        )}
        <View style={s.saveRow}>
          <PillButton title="Save changes" onPress={save} loading={busy} />
        </View>
      </Card>
      {salon && (
        <LocationPicker visible={pickerOpen}
          initial={salon.lat != null && salon.lng != null
            ? { latitude: salon.lat, longitude: salon.lng } : null}
          onPick={savePin} onClose={() => setPickerOpen(false)} />
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), backgroundColor: colors.surface },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: sp(5), gap: sp(4), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },

  avatarWrap: { alignItems: 'center', gap: sp(2) },
  avatar: { width: 96, height: 96, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontWeight: '700', color: colors.accent },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: radius.pill,
    backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: colors.surface,
  },
  name: { fontSize: font.h2, fontWeight: '700', color: colors.text, marginTop: sp(1) },
  phone: { fontSize: font.small, color: colors.textSecondary, marginTop: -sp(1) },

  menu: {
    backgroundColor: colors.bg, borderRadius: radius.xl, paddingHorizontal: sp(4.5),
    paddingVertical: sp(1.5), ...shadow,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3.5), paddingVertical: sp(3.25),
    borderBottomWidth: 1, borderBottomColor: '#EFECE4',
  },
  rowPressed: { opacity: 0.7 },
  rowIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: colors.accentSoft },
  rowLabel: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  rowLabelDanger: { color: colors.accent },

  label: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary, marginTop: sp(2) },
  saveRow: { marginTop: sp(3) },
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(2),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: sp(3), backgroundColor: colors.surface,
  },
  locationBtnText: { fontSize: font.body, fontWeight: '600', color: colors.text },
});
