import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { colors, font, radius, serif, shadow, sp } from '../theme';

// Shared primitives — every screen builds from these so the app reads as one system.

// Serif display type (Playfair, uppercase) — the Rentra signature.
export function Display({ children, size = 24, style }: {
  children: ReactNode; size?: number; style?: TextStyle;
}) {
  return (
    <Text style={[s.display, { fontSize: size, letterSpacing: size * 0.02 }, style]}>
      {children}
    </Text>
  );
}

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
      ) : <View style={s.backBtnGhost} />}
      <Display size={18} style={s.headerTitle}>{title}</Display>
      <View style={s.backBtnGhost}>{right}</View>
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
      <Text style={s.starsValue}>{rating.toFixed(1)} ★</Text>
      {count != null && <Text style={s.starsText}>({count})</Text>}
    </View>
  );
}

export function Empty({ text, title, icon }: {
  text: string; title?: string; icon?: keyof typeof Ionicons.glyphMap;
}) {
  if (!title) return <Text style={s.empty}>{text}</Text>;
  return (
    <View style={s.emptyWrap}>
      <View style={s.emptyCircle}>
        <Ionicons name={icon ?? 'calendar-outline'} size={34} color={colors.textTertiary} />
      </View>
      <Display size={19} style={s.emptyTitle}>{title}</Display>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

// list content bottom inset so nothing hides behind the floating tab bar
export const TAB_BAR_INSET = 104;

const s = StyleSheet.create({
  display: { fontFamily: serif, color: colors.text, textTransform: 'uppercase' },

  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: sp(3), gap: sp(2) },
  backBtn: {
    width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.bg, ...shadow,
  },
  backBtnGhost: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center' },
  card: {
    backgroundColor: colors.bg, borderRadius: radius.lg, padding: sp(4), gap: sp(1), ...shadow,
  },
  pill: {
    minHeight: 52, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: sp(6),
  },
  pill_primary: { backgroundColor: colors.ink },
  pill_secondary: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.border },
  pill_danger: { backgroundColor: colors.danger },
  pillText: {
    color: colors.onAccent, fontSize: font.small, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.2,
  },
  pillTextSecondary: { color: '#5C5C58' },
  chip: {
    paddingVertical: sp(2.5), paddingHorizontal: sp(4.5), borderRadius: radius.pill,
    backgroundColor: colors.bg, ...shadow,
  },
  chipActive: { backgroundColor: colors.ink },
  chipText: { color: '#5C5C58', fontSize: font.small, fontWeight: '600' },
  chipTextActive: { color: colors.onAccent },
  field: {
    backgroundColor: colors.bg, borderRadius: radius.md,
    paddingHorizontal: sp(4.5), minHeight: 50, fontSize: font.body, color: colors.text,
    ...shadow,
  },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  starsValue: { color: colors.text, fontSize: font.small, fontWeight: '700' },
  starsText: { color: colors.textSecondary, fontSize: font.small, fontWeight: '600' },
  empty: { textAlign: 'center', color: colors.textTertiary, marginVertical: sp(6), fontSize: font.body },
  emptyWrap: { alignItems: 'center', gap: sp(4), paddingVertical: sp(14) },
  emptyCircle: {
    width: 96, height: 96, borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed',
    borderColor: '#C9C5BB', alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { textAlign: 'center' },
  emptyText: {
    textAlign: 'center', fontSize: font.small, lineHeight: 19,
    color: colors.textSecondary, maxWidth: 250, marginTop: -sp(2),
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
});
