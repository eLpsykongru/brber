import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView from 'react-native-maps';
import { DEFAULT_REGION, LatLng } from '../lib/geo';
import { colors, font, radius, sp } from '../theme';
import { PillButton } from './ui';

// Center-pin picker: the map moves under a fixed pin; confirm takes the map center.
export default function LocationPicker({ visible, initial, onPick, onClose }: {
  visible: boolean;
  initial?: LatLng | null;
  onPick: (coords: LatLng) => void;
  onClose: () => void;
}) {
  const center = useRef<LatLng>(initial ?? DEFAULT_REGION);
  const region = initial
    ? { ...initial, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : DEFAULT_REGION;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={s.screen}>
        <MapView
          style={s.map}
          initialRegion={region}
          onRegionChangeComplete={(r) => { center.current = { latitude: r.latitude, longitude: r.longitude }; }}
        />
        {/* fixed pin over the map center */}
        <View pointerEvents="none" style={s.pinWrap}>
          <Ionicons name="location" size={44} color={colors.accent} style={s.pin} />
        </View>
        <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8} accessibilityLabel="Cancel">
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
        <View style={s.footer}>
          <Text style={s.hint}>Move the map until the pin sits on your salon</Text>
          <PillButton title="Use this location" onPress={() => onPick(center.current)} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  pinWrap: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
  },
  pin: { marginBottom: 40 }, // tip of the icon ≈ map center
  closeBtn: {
    position: 'absolute', top: sp(14), left: sp(5), width: 40, height: 40,
    borderRadius: radius.pill, backgroundColor: colors.bg, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: sp(5), paddingBottom: sp(10),
    gap: sp(3), backgroundColor: colors.bg, borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  hint: { textAlign: 'center', color: colors.textSecondary, fontSize: font.small },
});
