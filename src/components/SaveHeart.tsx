import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, ViewStyle } from 'react-native';
import { useSaved } from '../lib/wishlist';
import { colors, radius } from '../theme';
import { Press } from './motion';

// EXPL-29 — one heart for both halves of the wishlist.
//
// It stays a component rather than a hook call at the row site because
// `useSaved` cannot run inside a `.map` (that was already the reason on
// Explore's cards); generalising it from `salonId` to `{kind, id}` is what
// makes a *person* keepable, which is the whole point of the slice.
//
// ponytail: two looks, one ternary. `plain` is Explore's bare icon over a
// photo, `puck` is the filled circle the design draws on list rows.

export default function SaveHeart({ kind, id, variant = 'plain', style }: {
  kind: 'barber' | 'salon';
  id: string;
  variant?: 'plain' | 'puck';
  style?: ViewStyle;
}) {
  const [saved, toggle] = useSaved(kind, id);
  const puck = variant === 'puck';
  return (
    <Press onPress={toggle} hitSlop={8} scale={0.86}
      accessibilityLabel={saved ? 'Remove from saved' : 'Save to saved'}
      style={[puck ? (saved ? s.puckOn : s.puck) : s.plain, style] as ViewStyle[]}>
      <Ionicons
        name={saved ? 'heart' : 'heart-outline'}
        size={puck ? 16 : 18}
        color={puck ? (saved ? colors.onAccent : colors.textSecondary) : (saved ? colors.accent : colors.text)} />
    </Press>
  );
}

const s = StyleSheet.create({
  plain: { alignItems: 'center', justifyContent: 'center' },
  puck: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  puckOn: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOpacity: 0.3, shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
});
