import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Field, PillButton, ScreenHeader } from '../components/ui';
import { colors, font, radius, sp } from '../theme';

// TODO(backlog): wallet is a UI shell — needs a payment rail + wallet_transactions ledger.
const BALANCE = 1200;
const TX = [
  { id: '1', label: 'Money Added to Wallet', when: 'Today · 11:30', delta: 250, bal: 1450 },
  { id: '2', label: 'Booking #SL562542', when: 'Yesterday · 10:30', delta: -500, bal: 1200 },
  { id: '3', label: 'Money Added to Wallet', when: '07 Jan · 08:30', delta: 500, bal: 1700 },
  { id: '4', label: 'Booking #SL562856', when: '07 Jan · 07:48', delta: -250, bal: 1200 },
];
const PRESETS = [100, 200, 500, 1000, 2000, 3000, 4000, 5000];

export default function WalletScreen({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<'wallet' | 'add' | 'success'>('wallet');
  const [amount, setAmount] = useState('');

  if (view === 'success') {
    return (
      <View style={[s.screen, s.center]}>
        <View style={s.successBadge}><Ionicons name="checkmark" size={40} color={colors.onAccent} /></View>
        <Text style={s.successTitle}>Top Up Successful!</Text>
        <Text style={s.successSub}>You added {amount || '0'} DH to your wallet.</Text>
        <View style={s.successCta}>
          <PillButton title="OK" onPress={() => { setView('wallet'); setAmount(''); }} />
        </View>
      </View>
    );
  }

  if (view === 'add') {
    return (
      <View style={s.screen}>
        <ScreenHeader title="Add Money" onBack={() => setView('wallet')} />
        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>Wallet Balance</Text>
          <Text style={s.balanceValue}>{BALANCE} DH</Text>
          <View style={s.presetGrid}>
            {PRESETS.map((p) => (
              <Pressable key={p} style={({ pressed }) => [s.preset, pressed && s.pressed]}
                onPress={() => setAmount(String(p))}>
                <Text style={s.presetText}>+ {p}</Text>
              </Pressable>
            ))}
          </View>
          <Field placeholder="Enter amount" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
          <View style={s.addCta}>
            <PillButton title="Add Money" disabled={!amount} onPress={() => setView('success')} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <ScreenHeader title="My Wallet" />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.walletCard}>
          <Text style={s.balanceLabel}>Wallet Balance</Text>
          <Text style={s.walletBalance}>{BALANCE} DH</Text>
          <PillButton title="Add Money" onPress={() => setView('add')} />
        </View>
        <Text style={s.section}>Transactions</Text>
        {TX.map((t) => (
          <View key={t.id} style={s.txRow}>
            <View style={s.grow}>
              <Text style={s.txLabel}>{t.label}</Text>
              <Text style={s.txWhen}>{t.when}</Text>
            </View>
            <View style={s.txRight}>
              <Text style={[s.txDelta, { color: t.delta > 0 ? colors.success : colors.text }]}>
                {t.delta > 0 ? '+' : '-'} {Math.abs(t.delta)} DH
              </Text>
              <Text style={s.txBal}>Balance {t.bal} DH</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { gap: sp(3), paddingBottom: sp(10) },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  walletCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: sp(5), gap: sp(3) },
  balanceLabel: { fontSize: font.small, color: colors.textSecondary },
  walletBalance: { fontSize: 30, fontWeight: '800', color: colors.text },
  section: { fontSize: font.h2, fontWeight: '700', color: colors.text, marginTop: sp(2) },

  txRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: sp(3.5),
  },
  txLabel: { fontSize: font.body, fontWeight: '600', color: colors.text },
  txWhen: { fontSize: font.tiny, color: colors.textTertiary, marginTop: 2 },
  txRight: { alignItems: 'flex-end' },
  txDelta: { fontSize: font.body, fontWeight: '700' },
  txBal: { fontSize: font.tiny, color: colors.textTertiary, marginTop: 2 },

  balanceCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: sp(4), gap: sp(3) },
  balanceValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  preset: {
    width: '23%', alignItems: 'center', paddingVertical: sp(3), borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg,
  },
  presetText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  addCta: { marginTop: sp(1) },

  successBadge: {
    width: 96, height: 96, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', marginBottom: sp(4),
  },
  successTitle: { fontSize: font.title, fontWeight: '700', color: colors.text },
  successSub: { fontSize: font.body, color: colors.textSecondary, marginTop: sp(2), textAlign: 'center' },
  successCta: { position: 'absolute', left: sp(5), right: sp(5), bottom: sp(8) },
});
