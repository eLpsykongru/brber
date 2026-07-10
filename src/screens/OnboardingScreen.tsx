import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Alert, Button, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity,
} from 'react-native';
import { supabase } from '../lib/supabase';
import type { Barber } from '../types';

type Props = { barber: Barber; onDone: () => void };

export default function OnboardingScreen({ barber, onDone }: Props) {
  const [shopName, setShopName] = useState(barber.shop_name ?? '');
  // ponytail: plain-text address for now; Google Places autocomplete + lat/lng land with Phase 2 discovery
  const [shopAddress, setShopAddress] = useState(barber.shop_address ?? '');
  const [bio, setBio] = useState(barber.bio ?? '');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) setPhotoUri(res.assets[0].uri);
  }

  async function submit() {
    if (!shopName.trim() || !shopAddress.trim()) {
      return Alert.alert('Missing info', 'Shop name and address are required.');
    }
    if (!photoUri) {
      return Alert.alert('Missing ID', 'A photo of your ID is required for verification.');
    }
    setBusy(true);
    try {
      // unique filename per upload → no overwrite, so the insert-only storage policy suffices
      const path = `${barber.id}/id-${Date.now()}.jpg`;
      const body = await fetch(photoUri).then((r) => r.arrayBuffer());
      const up = await supabase.storage.from('id-documents').upload(path, body, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;

      const { error } = await supabase.from('barbers')
        .update({ shop_name: shopName.trim(), shop_address: shopAddress.trim(), bio: bio.trim(), id_document_path: path })
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
    <ScrollView contentContainerStyle={styles.form}>
      <Text style={styles.title}>Set up your shop</Text>
      <Text style={styles.hint}>This is reviewed manually before you appear in the app.</Text>
      <TextInput style={styles.input} placeholder="Shop name" value={shopName} onChangeText={setShopName} />
      <TextInput style={styles.input} placeholder="Shop address" value={shopAddress} onChangeText={setShopAddress} />
      <TextInput style={[styles.input, styles.multiline]} placeholder="Short bio (optional)"
        multiline value={bio} onChangeText={setBio} />
      <TouchableOpacity style={styles.photoBox} onPress={pickPhoto}>
        {photoUri
          ? <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          : <Text>Tap to add a photo of your ID</Text>}
      </TouchableOpacity>
      <Button title={busy ? 'Submitting…' : 'Submit for review'} disabled={busy} onPress={submit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center' },
  hint: { textAlign: 'center', color: '#666', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  photoBox: {
    borderWidth: 1, borderColor: '#ccc', borderStyle: 'dashed', borderRadius: 8,
    height: 180, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
});
