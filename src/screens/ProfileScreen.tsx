import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Chip, Field, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import type { Barber, Profile } from '../types';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Under review', approved: 'Live', rejected: 'Not approved',
};

export default function ProfileScreen({ profile, barber, phone, onProfileChanged }: {
  profile: Profile; barber: Barber | null; phone: string | null; onProfileChanged: () => void;
}) {
  const [name, setName] = useState(profile.full_name ?? '');
  const [phoneVal, setPhoneVal] = useState(phone ?? '');
  const [specialty, setSpecialty] = useState(barber?.specialty ?? '');
  const [yearsExp, setYearsExp] = useState(
    barber?.years_experience != null ? String(barber.years_experience) : '',
  );
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url ?? null);
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const initials = (profile.full_name ?? '?')
    .split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

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
    else onProfileChanged();
  }

  function signOut() {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, log out', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);
  }

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
        {barber && (
          <Chip label={STATUS_LABEL[barber.status] ?? barber.status} active={barber.status === 'approved'} />
        )}
      </View>

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

      <PillButton title="Log out" variant="secondary" onPress={signOut} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14) },
  content: { paddingHorizontal: sp(5), gap: sp(4), paddingBottom: TAB_BAR_INSET },
  avatarWrap: { alignItems: 'center', gap: sp(2) },
  avatar: { width: 88, height: 88, borderRadius: radius.pill },
  avatarFallback: {
    backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 28, fontWeight: '700', color: colors.accent },
  editBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: radius.pill,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.bg,
  },
  label: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary, marginTop: sp(2) },
  saveRow: { marginTop: sp(3) },
  pressed: { opacity: 0.7 },
});
