import { Ionicons } from '@expo/vector-icons';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ScreenHeader } from '../components/ui';
import { colors, font, radius, sp } from '../theme';

// TODO(backlog): coupons are a UI shell — needs a promotions/coupons table + apply logic.
const COUPONS = [
  { code: 'WELCOME50', note: 'Unlock this offer by adding 400 DH more', deal: 'Get 50% OFF' },
  { code: 'CASHBACK20', note: 'Just 200 DH more to go', deal: 'Up to 20 DH cashback' },
  { code: 'FEST2STYLE', note: 'Unlock this offer by adding 200 DH more', deal: 'Get 25% OFF for combo' },
  { code: 'FEST2DEAL', note: 'Unlock this offer by adding 300 DH more', deal: 'Get 10% OFF' },
];

export default function CouponsScreen({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.screen}>
      <ScreenHeader title="My Coupons" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.heading}>Coupons for you</Text>
        {COUPONS.map((c) => (
          <View key={c.code} style={s.card}>
            <View style={s.top}>
              <Text style={s.code}>{c.code}</Text>
              <Text style={s.note}>{c.note}</Text>
              <View style={s.dealRow}>
                <Ionicons name="pricetag" size={13} color={colors.accent} />
                <Text style={s.deal}>{c.deal}</Text>
              </View>
            </View>
            <TouchableOpacity style={s.copy} onPress={() => Alert.alert('Coupon', `${c.code} copied (shell)`)}>
              <Text style={s.copyText}>COPY CODE</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.bg },
  content: { gap: sp(3), paddingBottom: sp(10) },
  heading: { fontSize: font.h2, fontWeight: '700', color: colors.text, marginBottom: sp(1) },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, overflow: 'hidden' },
  top: { padding: sp(4), gap: sp(1) },
  code: { fontSize: font.body, fontWeight: '700', color: colors.text },
  note: { fontSize: font.small, color: colors.textSecondary },
  dealRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: sp(1) },
  deal: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  copy: { backgroundColor: colors.surface, alignItems: 'center', paddingVertical: sp(3) },
  copyText: { fontSize: font.small, fontWeight: '700', color: colors.textSecondary, letterSpacing: 1 },
});
