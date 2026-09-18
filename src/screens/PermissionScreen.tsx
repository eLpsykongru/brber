import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { PillButton } from '../components/ui';
import { colors, font, radius, sp } from '../theme';
import { tr } from '../lib/i18n';

// Reusable onboarding permission prompt. TODO(backlog): wire to expo-notifications /
// expo-location and place in the first-run flow.
export default function PermissionScreen({ icon, title, subtitle, primaryLabel, secondaryLabel, onPrimary, onSecondary }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string; subtitle: string; primaryLabel: string; secondaryLabel: string;
  onPrimary: () => void; onSecondary: () => void;
}) {
  return (
    <View style={s.screen}>
      <View style={s.iconCircle}><Ionicons name={icon} size={40} color={colors.textSecondary} /></View>
      <Text style={s.title}>{title}</Text>
      <Text style={s.subtitle}>{subtitle}</Text>
      <View style={s.cta}>
        <PillButton title={primaryLabel} onPress={onPrimary} />
        <Text style={s.secondary} onPress={onSecondary}>{secondaryLabel}</Text>
      </View>
    </View>
  );
}

// Convenience presets matching the mockups.
export const NotificationPermission = (p: { onAllow: () => void; onSkip: () => void }) => (
  <PermissionScreen icon="notifications-outline" title={tr('Enable Notification Access')}
    subtitle={tr('Enable notifications to receive real-time updates.')}
    primaryLabel={tr('Allow Notification')} secondaryLabel={tr('Maybe Later')}
    onPrimary={p.onAllow} onSecondary={p.onSkip} />
);

export const LocationPermission = (p: { onAllow: () => void; onManual: () => void }) => (
  <PermissionScreen icon="location-outline" title={tr('What is Your Location?')}
    subtitle={tr('Allow location access to find services near you.')}
    primaryLabel={tr('Allow Location Access')} secondaryLabel={tr('Enter Location Manually')}
    onPrimary={p.onAllow} onSecondary={p.onManual} />
);

const s = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: sp(8), backgroundColor: colors.bg },
  iconCircle: {
    width: 96, height: 96, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginBottom: sp(6),
  },
  title: { fontSize: font.title, fontWeight: '700', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: font.body, color: colors.textSecondary, textAlign: 'center', marginTop: sp(2) },
  cta: { position: 'absolute', left: sp(6), right: sp(6), bottom: sp(10), gap: sp(3), alignItems: 'center' },
  secondary: { fontSize: font.body, color: colors.textTertiary, fontWeight: '600' },
});
