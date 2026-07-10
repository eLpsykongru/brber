import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, sp } from '../theme';

export type TabItem = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;       // filled variant, used when active
  iconOutline: keyof typeof Ionicons.glyphMap; // outline variant, used when inactive
};

// Floating dark pill tab bar (per the chosen mockup). Rendered as an overlay;
// screens add TAB_BAR_INSET bottom padding so content never hides behind it.
export default function TabBar({ items, active, onChange }: {
  items: TabItem[]; active: string; onChange: (key: string) => void;
}) {
  return (
    <View style={s.wrap} pointerEvents="box-none">
      <View style={s.bar}>
        {items.map((t) => {
          const on = t.key === active;
          return (
            <Pressable key={t.key} onPress={() => onChange(t.key)} accessibilityRole="tab"
              accessibilityState={{ selected: on }} accessibilityLabel={t.label}
              style={({ pressed }) => [s.item, on && s.itemActive, pressed && s.pressed]}>
              <Ionicons name={on ? t.icon : t.iconOutline} size={18}
                color={on ? colors.onAccent : colors.tabInactiveText} />
              {on && <Text style={s.label}>{t.label}</Text>}
            </Pressable>
          );
        })}
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
  pressed: { opacity: 0.7 },
});
