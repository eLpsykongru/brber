import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import LocationPicker from '../components/LocationPicker';
import { Card, Chip, Field, PillButton } from '../components/ui';
import type { LatLng } from '../lib/geo';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import type { Barber, Salon } from '../types';

type Props = { barber: Barber; onDone: () => void };

export default function OnboardingScreen({ barber, onDone }: Props) {
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [salons, setSalons] = useState<Salon[]>([]);
  const [joinSalonId, setJoinSalonId] = useState<string | null>(null);
  const [salonName, setSalonName] = useState('');
  // ponytail: plain-text address + a map pin; Google Places autocomplete if typing addresses bites
  const [salonAddress, setSalonAddress] = useState('');
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bio, setBio] = useState(barber.bio ?? '');
  const [specialty, setSpecialty] = useState(barber.specialty ?? '');
  const [yearsExp, setYearsExp] = useState(
    barber.years_experience != null ? String(barber.years_experience) : '',
  );
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('salons').select('id, name, address, bio').order('name')
      .then(({ data }) => setSalons(data ?? []));
  }, []);

  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) setPhotoUri(res.assets[0].uri);
  }

  async function submit() {
    if (mode === 'create' && (!salonName.trim() || !salonAddress.trim())) {
      return Alert.alert('Missing info', 'Salon name and address are required.');
    }
    if (mode === 'create' && !coords) {
      return Alert.alert('Missing location', 'Set your salon location on the map so clients can find you.');
    }
    if (mode === 'join' && !joinSalonId) {
      return Alert.alert('Missing info', 'Pick the salon you work at.');
    }
    if (!photoUri) {
      return Alert.alert('Missing ID', 'A photo of your ID is required for verification.');
    }
    setBusy(true);
    try {
      let salonId = joinSalonId;
      if (mode === 'create') {
        const { data, error } = await supabase.from('salons')
          .insert({
            owner_id: barber.id, name: salonName.trim(), address: salonAddress.trim(),
            lat: coords!.latitude, lng: coords!.longitude,
          })
          .select('id').single();
        if (error) throw error;
        salonId = data.id;
      }
      // unique filename per upload → no overwrite, so the insert-only storage policy suffices
      const path = `${barber.id}/id-${Date.now()}.jpg`;
      const body = await fetch(photoUri).then((r) => r.arrayBuffer());
      const up = await supabase.storage.from('id-documents').upload(path, body, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;

      const years = parseInt(yearsExp, 10);
      const { error } = await supabase.from('barbers')
        .update({
          salon_id: salonId, bio: bio.trim(), id_document_path: path,
          specialty: specialty.trim() || null,
          years_experience: Number.isInteger(years) && years >= 0 ? years : null,
        })
        .eq('id', barber.id);
      if (error) throw error;
      onDone();
    } catch (e: any) {
      Alert.alert('Could not submit', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Set up your profile</Text>
      <Text style={s.hint}>This is reviewed manually before you appear in the app.</Text>

      <View style={s.modeRow}>
        <Chip label="New salon" active={mode === 'create'} onPress={() => setMode('create')} />
        <Chip label="Join a salon" active={mode === 'join'} onPress={() => setMode('join')} />
      </View>

      {mode === 'create' ? (
        <>
          <Field placeholder="Salon name" value={salonName} onChangeText={setSalonName} />
          <Field placeholder="Salon address" value={salonAddress} onChangeText={setSalonAddress} />
          <TouchableOpacity style={s.locationBtn} onPress={() => setPickerOpen(true)}
            accessibilityLabel="Set salon location on map">
            <Ionicons name={coords ? 'checkmark-circle' : 'location-outline'} size={20}
              color={coords ? colors.success : colors.accent} />
            <Text style={s.locationBtnText}>
              {coords ? 'Location set — tap to adjust' : 'Set location on map'}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={s.salonList}>
          {salons.length === 0 && <Text style={s.hint}>No salons yet — create one instead.</Text>}
          {salons.map((sl) => (
            <Card key={sl.id} onPress={() => setJoinSalonId(sl.id)}
              style={joinSalonId === sl.id ? s.salonActive : undefined}>
              <Text style={s.salonName}>{sl.name}</Text>
              {!!sl.address && <Text style={s.salonMeta}>{sl.address}</Text>}
            </Card>
          ))}
        </View>
      )}

      <View style={s.fieldRow}>
        <Field placeholder="Specialty (e.g. Barber)" value={specialty} onChangeText={setSpecialty}
          style={s.grow} />
        <Field placeholder="Years exp." keyboardType="number-pad" value={yearsExp}
          onChangeText={setYearsExp} style={s.years} />
      </View>
      <Field placeholder="Short bio (optional)" multiline value={bio} onChangeText={setBio}
        style={s.multiline} />
      <TouchableOpacity style={s.photoBox} onPress={pickPhoto} accessibilityLabel="Add a photo of your ID">
        {photoUri
          ? <Image source={{ uri: photoUri }} style={s.photo} resizeMode="cover" />
          : <Text style={s.photoHint}>Tap to add a photo of your ID</Text>}
      </TouchableOpacity>
      <PillButton title="Submit for review" onPress={submit} loading={busy} />
      <LocationPicker visible={pickerOpen} initial={coords}
        onPick={(c) => { setCoords(c); setPickerOpen(false); }}
        onClose={() => setPickerOpen(false)} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  form: { padding: sp(6), paddingTop: sp(16), gap: sp(3) },
  title: { fontSize: font.title, fontWeight: '700', textAlign: 'center', color: colors.text },
  hint: { textAlign: 'center', color: colors.textSecondary, fontSize: font.small },
  modeRow: { flexDirection: 'row', gap: sp(2), justifyContent: 'center', marginVertical: sp(1) },
  salonList: { gap: sp(2) },
  salonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  salonName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  salonMeta: { fontSize: font.small, color: colors.textSecondary },
  multiline: { minHeight: 80, textAlignVertical: 'top', paddingTop: sp(3) },
  fieldRow: { flexDirection: 'row', gap: sp(2) },
  grow: { flex: 1 },
  years: { width: 110 },
  photoBox: {
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.lg,
    height: 180, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  photoHint: { color: colors.textSecondary, fontSize: font.body },
  photo: { width: '100%', height: '100%' },
  locationBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(2),
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: sp(3), backgroundColor: colors.surface,
  },
  locationBtnText: { fontSize: font.body, fontWeight: '600', color: colors.text },
});
