import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PillButton, ScreenHeader } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';

// REAL since 0022: balance + transactions read wallet_transactions (cash top-ups
// taken at the salon). The old fake Add-Money flow was removed — card top-ups
// return with the payment rail (TODO(backlog): YouCan Pay); until then customers
// top up with cash at the barber. Spending the balance on bookings is also TODO.

type Tx = { id: string; amount_cents: number; created_at: string; salon: { name: string } | null };

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

export default function WalletScreen({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const [txs, setTxs] = useState<Tx[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('wallet_transactions')
      .select('id, amount_cents, created_at, salon:salons!salon_id(name)')
      .eq('user_id', customerId).order('created_at', { ascending: false });
    if (error) Alert.alert('Could not load wallet', error.message);
    else setTxs(data as unknown as Tx[]);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const balance = (txs ?? []).reduce((a, t) => a + t.amount_cents, 0) / 100;

  return (
    <View style={s.screen}>
      <ScreenHeader title="My Wallet" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.walletCard}>
          <Text style={s.balanceLabel}>Wallet Balance</Text>
          <Text style={s.walletBalance}>{balance.toLocaleString('en-US')} DH</Text>
          <PillButton title="Add Money" onPress={() =>
            Alert.alert('Add money', 'Card top-ups are coming soon — for now, top up with cash at your barber.')} />
        </View>
        <Text style={s.section}>Transactions</Text>
        {txs === null && <ActivityIndicator style={s.spinner} />}
        {txs?.length === 0 && (
          <Text style={s.empty}>No transactions yet. Top up with cash at your barber.</Text>
        )}
        {txs?.map((t) => (
          <View key={t.id} style={s.txRow}>
            <View style={s.grow}>
              <Text style={s.txLabel}>Cash top-up{t.salon ? ` · ${t.salon.name}` : ''}</Text>
              <Text style={s.txWhen}>{when(t.created_at)}</Text>
            </View>
            <Text style={s.txDelta}>+ {t.amount_cents / 100} DH</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), backgroundColor: colors.bg },
  content: { gap: sp(3), paddingBottom: sp(10) },
  grow: { flex: 1 },

  walletCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: sp(5), gap: sp(3) },
  balanceLabel: { fontSize: font.small, color: colors.textSecondary },
  walletBalance: { fontSize: 30, fontWeight: '800', color: colors.text },
  section: { fontSize: font.h2, fontWeight: '700', color: colors.text, marginTop: sp(2) },
  spinner: { marginTop: sp(4) },
  empty: { fontSize: font.small, color: colors.textSecondary },

  txRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: sp(3.5),
  },
  txLabel: { fontSize: font.body, fontWeight: '600', color: colors.text },
  txWhen: { fontSize: font.tiny, color: colors.textTertiary, marginTop: 2 },
  txDelta: { fontSize: font.body, fontWeight: '700', color: colors.success },
});
