import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import LocationPicker from '../components/LocationPicker';
import { Card, Chip, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import type { LatLng } from '../lib/geo';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import type { Barber, Profile } from '../types';
import { ActivityIndicator } from 'react-native';
import CouponsScreen from './CouponsScreen';
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

export default function ProfileScreen({ profile, barber, phone, onProfileChanged, onChromeHidden, onBack }: {
  profile: Profile; barber: Barber | null; phone: string | null;
  onProfileChanged: () => void; onChromeHidden?: (hidden: boolean) => void;
  onBack?: () => void;
}) {
  type View = 'menu' | 'edit' | 'bookings' | 'wallet' | 'coupons' | 'help' | 'preview' | 'services' | 'work' | 'schedule' | 'salon';
  const [view, setView] = useState<View>('menu');
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

  function go(next: View) {
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
  if (view === 'salon' && barber) return <SalonScreen barberId={barber.id} onBack={() => go('menu')} />;
  if (view === 'schedule' && barber) return <AvailabilityScreen barberId={barber.id} onBack={() => go('menu')} />;
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
        {barber && (
          <Chip label={STATUS_LABEL[barber.status] ?? barber.status} active={barber.status === 'approved'} />
        )}
      </View>

      <View style={s.menu}>
        {items.map((it) => (
          <Pressable key={it.label} onPress={it.onPress}
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            accessibilityRole="button" accessibilityLabel={it.label}>
            <View style={[s.rowIcon, it.danger && s.rowIconDanger]}>
              <Ionicons name={it.icon} size={20} color={it.danger ? colors.danger : colors.text} />
            </View>
            <Text style={[s.rowLabel, it.danger && s.rowLabelDanger]}>{it.label}</Text>
            {!it.danger && <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />}
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

// "how customers see me" — fetches the salon in SalonCard shape and reuses the customer screen
function PreviewPage({ salonId, onBack, onChromeHidden }: {
  salonId: string; onBack: () => void; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [salon, setSalon] = useState<SalonCard | null>(null);

  useEffect(() => {
    supabase.from('salons')
      .select('id, name, address, lat, lng, bio, website, barbers!salon_id(id, bio, status, specialty, years_experience, profiles(full_name, avatar_url, phone), reviews(rating), services(id, name, price_cents, duration_min, is_active, category))')
      .eq('id', salonId).single()
      .then(({ data, error }) => {
        if (error) { Alert.alert('Could not load preview', error.message); onBack(); return; }
        const card = data as unknown as SalonCard;
        setSalon({ ...card, barbers: card.barbers.filter((b) => b.status === 'approved') });
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
  screen: { flex: 1, paddingTop: sp(14) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: sp(5), gap: sp(4), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },

  avatarWrap: { alignItems: 'center', gap: sp(2) },
  avatar: { width: 96, height: 96, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 30, fontWeight: '700', color: colors.accent },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: radius.pill,
    backgroundColor: colors.tabActive, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  name: { fontSize: font.h2, fontWeight: '700', color: colors.text, marginTop: sp(1) },

  menu: { gap: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3), paddingVertical: sp(3),
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.surface },
  rowIcon: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: colors.accentSoft },
  rowLabel: { flex: 1, fontSize: font.body, fontWeight: '600', color: colors.text },
  rowLabelDanger: { color: colors.danger },

  label: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary, marginTop: sp(2) },
  saveRow: { marginTop: sp(3) },
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(2),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: sp(3), backgroundColor: colors.surface,
  },
  locationBtnText: { fontSize: font.body, fontWeight: '600', color: colors.text },
});
