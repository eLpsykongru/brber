import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle,
} from 'react-native';
import { colors, font, radius, sp } from '../theme';

// Shared primitives — every screen builds from these so the app reads as one system.

export function ScreenHeader({ title, onBack, right }: {
  title: string; onBack?: () => void; right?: ReactNode;
}) {
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Go back"
          style={({ pressed }) => [s.backBtn, pressed && s.pressed]}>
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </Pressable>
      ) : <View style={s.backBtn} />}
      <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
      <View style={s.backBtn}>{right}</View>
    </View>
  );
}

export function Card({ children, style, onPress }: {
  children: ReactNode; style?: ViewStyle; onPress?: () => void;
}) {
  if (!onPress) return <View style={[s.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && s.pressed]}>
      {children}
    </Pressable>
  );
}

export function PillButton({ title, onPress, variant = 'primary', disabled, loading }: {
  title: string; onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; loading?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button"
      style={({ pressed }) => [
        s.pill, s[`pill_${variant}`], pressed && s.pressed, off && s.disabled,
      ]}>
      {loading
        ? <ActivityIndicator color={variant === 'secondary' ? colors.text : colors.onAccent} />
        : <Text style={[s.pillText, variant === 'secondary' && s.pillTextSecondary]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress}
      style={({ pressed }) => [s.chip, active && s.chipActive, pressed && s.pressed]}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.textTertiary} {...props} style={[s.field, props.style]} />;
}

export function Stars({ rating, count }: { rating: number; count?: number }) {
  return (
    <View style={s.starsRow}>
      <Ionicons name="star" size={13} color={colors.star} />
      <Text style={s.starsText}>{rating.toFixed(1)}{count != null ? ` (${count})` : ''}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <Text style={s.empty}>{text}</Text>;
}

// list content bottom inset so nothing hides behind the floating tab bar
export const TAB_BAR_INSET = 104;

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: sp(3), gap: sp(2) },
  backBtn: {
    width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: colors.text },
  card: {
    backgroundColor: colors.bg, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: sp(4), gap: sp(1),
  },
  pill: {
    minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: sp(6),
  },
  pill_primary: { backgroundColor: colors.accent },
  pill_secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  pill_danger: { backgroundColor: colors.danger },
  pillText: { color: colors.onAccent, fontSize: font.body, fontWeight: '700' },
  pillTextSecondary: { color: colors.text },
  chip: {
    paddingVertical: sp(2), paddingHorizontal: sp(4), borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: font.small, fontWeight: '600' },
  chipTextActive: { color: colors.accent },
  field: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: sp(4), minHeight: 48, fontSize: font.body, color: colors.text,
  },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  starsText: { color: colors.textSecondary, fontSize: font.small, fontWeight: '600' },
  empty: { textAlign: 'center', color: colors.textTertiary, marginVertical: sp(6), fontSize: font.body },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
