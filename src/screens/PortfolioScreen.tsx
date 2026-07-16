import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Empty, PillButton, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';

export default function PortfolioScreen({ barberId, onBack }: { barberId: string; onBack?: () => void }) {
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setPhotos(await listPortfolio(barberId)), [barberId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return;
    setBusy(true);
    try {
      const path = `${barberId}/${Date.now()}.jpg`;
      const buf = await fetch(res.assets[0].uri).then((r) => r.arrayBuffer());
      const { error } = await supabase.storage.from('portfolio').upload(path, buf, { contentType: 'image/jpeg' });
      if (error) throw error;
      await load();
    } catch (e: any) {
      Alert.alert('Could not upload', e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  function remove(name: string) {
    Alert.alert('Remove photo?', '', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.storage.from('portfolio').remove([name]);
          if (error) Alert.alert('Could not remove', error.message);
          else load();
        },
      },
    ]);
  }

  return (
    <View style={s.screen}>
      <ScreenHeader title="My work" onBack={onBack} />
      <PillButton title="Add photo" onPress={add} loading={busy} />
      <FlatList
        data={photos}
        numColumns={2}
        keyExtractor={(p) => p.name}
        columnWrapperStyle={s.rowGap}
        contentContainerStyle={s.grid}
        ListEmptyComponent={<Empty text="No photos yet — show off your best cuts." />}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={s.cell} onLongPress={() => remove(item.name)}
            accessibilityLabel={`${index === 0 ? 'Cover photo' : 'Portfolio photo'}, long-press to remove`}>
            <Image source={{ uri: item.url }} style={s.photo} />
            {index === 0 && (
              <View style={s.coverBadge}>
                <Ionicons name="star" size={10} color={colors.onAccent} />
                <Text style={s.coverText}>Cover</Text>
              </View>
            )}
            <Text style={s.hint}>
              {index === 0 ? 'customers see this first' : 'long-press to remove'}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), gap: sp(3) },
  rowGap: { gap: sp(2) },
  grid: { gap: sp(2), paddingBottom: TAB_BAR_INSET, paddingTop: sp(1) },
  cell: { flex: 1 },
  photo: { width: '100%', aspectRatio: 1, borderRadius: radius.md, backgroundColor: colors.surface },
  hint: { fontSize: font.tiny, color: colors.textTertiary, textAlign: 'center', marginTop: 2 },
  coverBadge: {
    position: 'absolute', top: sp(2), left: sp(2), flexDirection: 'row', alignItems: 'center',
    gap: 3, backgroundColor: colors.accent, borderRadius: radius.sm,
    paddingVertical: 2, paddingHorizontal: sp(1.5),
  },
  coverText: { fontSize: font.tiny, fontWeight: '700', color: colors.onAccent },
});
