import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Chip, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import type { Barber, Profile } from '../types';
import CouponsScreen from './CouponsScreen';
import HelpCenterScreen from './HelpCenterScreen';
import MyBookingsScreen from './MyBookingsScreen';
import WalletScreen from './WalletScreen';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Under review', approved: 'Live', rejected: 'Not approved',
};

type MenuItem = { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean };

export default function ProfileScreen({ profile, barber, phone, onProfileChanged, onChromeHidden }: {
  profile: Profile; barber: Barber | null; phone: string | null;
  onProfileChanged: () => void; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [view, setView] = useState<'menu' | 'edit' | 'bookings' | 'wallet' | 'coupons' | 'help'>('menu');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url ?? null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const initials = (profile.full_name ?? '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  function go(next: 'menu' | 'edit' | 'bookings' | 'wallet' | 'coupons' | 'help') {
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
  if (view === 'wallet') return <WalletScreen onBack={() => go('menu')} />;
  if (view === 'coupons') return <CouponsScreen onBack={() => go('menu')} />;
  if (view === 'help') return <HelpCenterScreen onBack={() => go('menu')} />;

  // TODO(backlog): Payment Methods / My Coupons / My Wallet — no payment rail yet
  const items: MenuItem[] = [
    { icon: 'person-outline', label: 'Your profile', onPress: () => go('edit') },
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
      <ScreenHeader title="Profile" />

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
        <View style={s.saveRow}>
          <PillButton title="Save changes" onPress={save} loading={busy} />
        </View>
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14) },
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
});
