import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { Btn, Ico, T, TAB_INSET, TopBar } from '../components/dark';
import { listPortfolio } from '../lib/portfolio';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// 1o — My work. Two-up grid, first photo is the cover customers see in search.
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

  // the trailing dashed tile is a grid cell, so it lives in the data
  const cells: ({ name: string; url: string } | null)[] = [...photos, null];

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <TopBar title="My work" onBack={onBack} plain />
        <Btn title="ADD PHOTO" height={50} icon="plus" ls={0.6} onPress={add}
          style={busy ? { opacity: 0.6 } : undefined} />
        <T size={11} c={D.sub} style={s.hint}>
          The first photo is your cover — it's what customers see in search. Long-press to remove.
        </T>
      </View>
      <FlatList
        data={cells}
        numColumns={2}
        keyExtractor={(p, i) => p?.name ?? `add-${i}`}
        columnWrapperStyle={s.rowGap}
        contentContainerStyle={s.grid}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => {
          if (!item) {
            return (
              <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add photo"
                style={({ pressed }) => [s.cell, pressed && s.pressed]}>
                <View style={s.addTile}>
                  <Ico name="camera" size={20} color={D.sub} />
                  <T w="sb" size={10} c={D.sub}>Add photo</T>
                </View>
              </Pressable>
            );
          }
          return (
            <Pressable onLongPress={() => remove(item.name)} style={({ pressed }) => [s.cell, pressed && s.pressed]}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${index === 0 ? 'Cover photo' : 'Portfolio photo'}, long-press to remove`}>
              <View style={s.photoWrap}>
                <Image source={{ uri: item.url }} style={s.photo} />
                {index === 0 && (
                  <View style={s.coverBadge}>
                    <Ico name="star" size={10} color="#fff" />
                    <T w="b" size={9} c="#fff">Cover</T>
                  </View>
                )}
              </View>
              <T size={10} c={D.sub} style={s.caption}>
                {index === 0 ? 'customers see this first' : 'long-press to remove'}
              </T>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  head: { paddingTop: 62, paddingHorizontal: 20, gap: 13 },
  hint: { lineHeight: 17 },
  pressed: { opacity: 0.7 },

  rowGap: { gap: 10 },
  grid: { gap: 10, paddingTop: 13, paddingHorizontal: 20, paddingBottom: TAB_INSET },
  cell: { flex: 1, gap: 5 },
  photoWrap: { aspectRatio: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: D.card },
  photo: { width: '100%', height: '100%' },
  caption: { textAlign: 'center' },
  coverBadge: {
    position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center',
    gap: 4, backgroundColor: D.accent, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8,
  },
  addTile: {
    aspectRatio: 1, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: D.muted,
    alignItems: 'center', justifyContent: 'center', gap: 7,
  },
});
