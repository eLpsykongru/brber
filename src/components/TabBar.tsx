import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, dark as d, font, inter, radius, sp } from '../theme';

export type TabItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;       // filled variant, used when active
  iconOutline: keyof typeof Ionicons.glyphMap; // outline variant, used when inactive
};

// Floating pill tab bar. Rendered as an overlay; screens add TAB_BAR_INSET bottom
// padding so content never hides behind it. `center` renders the accent FAB in the
// middle of the items (barber side). `dark` switches to the barber canvas geometry
// from "Barber App.dc.html" 1a: #17171A bar, inline 48px FAB, label only when active.
export default function TabBar({ items, active, onChange, center, dark, centerOff }: {
  items: TabItem[]; active: string; onChange: (key: string) => void;
  center?: { onPress: () => void; label: string };
  dark?: boolean; centerOff?: boolean;
}) {
  const mid = Math.ceil(items.length / 2);
  const renderItem = (t: TabItem) => {
    const on = t.key === active;
    return (
      <Pressable key={t.key} onPress={() => onChange(t.key)} accessibilityRole="tab"
        accessibilityState={{ selected: on }} accessibilityLabel={t.label}
        style={({ pressed }) => [
          dark ? (on ? s.dItemActive : s.dItem) : [s.item, on && s.itemActive],
          pressed && s.pressed,
        ]}>
        <Ionicons name={on ? t.icon : t.iconOutline} size={dark ? 17 : 18}
          color={on ? colors.onAccent : (dark ? d.sub : colors.tabInactiveText)} />
        {on && <Text style={dark ? s.dLabel : s.label}>{t.label}</Text>}
      </Pressable>
    );
  };
  return (
    <View style={[s.wrap, dark && s.dWrap]} pointerEvents="box-none">
      <View style={dark ? s.dBar : s.bar}>
        {items.slice(0, center ? mid : items.length).map(renderItem)}
        {center && (
          <Pressable onPress={center.onPress} accessibilityRole="button" accessibilityLabel={center.label}
            disabled={centerOff}
            style={({ pressed }) => [
              dark ? [s.dFab, centerOff && s.dFabOff] : s.fab, pressed && s.pressed,
            ]}>
            <Ionicons name="add" size={dark ? 20 : 28}
              color={dark && centerOff ? d.sub : colors.onAccent} />
          </Pressable>
        )}
        {center && items.slice(mid).map(renderItem)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: sp(7), alignItems: 'center' },
  bar: {
    flexDirection: 'row', backgroundColor: colors.tabBg, borderRadius: radius.pill,
    padding: sp(1.5), gap: sp(0.5),
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: sp(1.5),
    minHeight: 44, paddingHorizontal: sp(4), borderRadius: radius.pill,
  },
  itemActive: { backgroundColor: colors.tabActive },
  label: { color: colors.onAccent, fontSize: font.small, fontWeight: '700' },
  fab: {
    width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginTop: -sp(5), marginHorizontal: sp(1),
    borderWidth: 4, borderColor: colors.tabBg,
    shadowColor: colors.accent, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },

  // --- barber (dark) geometry, 1:1 with the mock
  dWrap: { bottom: 26 },
  dBar: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: d.card, borderWidth: 1, borderColor: d.border, borderRadius: 999, padding: 6,
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 28, shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  dItem: { width: 42, height: 42, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  dItemActive: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    height: 44, paddingHorizontal: 15, borderRadius: 999, backgroundColor: d.card2,
  },
  dLabel: { color: '#fff', fontSize: 12, fontFamily: inter.b },
  dFab: {
    width: 48, height: 48, borderRadius: 999, backgroundColor: d.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: d.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  dFabOff: { backgroundColor: d.card2, shadowOpacity: 0 },

  pressed: { opacity: 0.7 },
});
