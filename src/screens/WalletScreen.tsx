import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Display } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, sp } from '../theme';

// Turn 7 of "Customer App 1.dc.html" — 7a My Wallet, 7b the add-money alert,
// 7c the empty and loading states.
//
// Since 0035 the ledger runs both ways: cash top-ups taken by the agent (0022)
// credit it, booking deposits debit it, and a barber-side cancellation credits
// it back. The balance is just the sum, so a row that goes the wrong way is
// visible here rather than hidden behind a computed field.

type Kind = 'cash_topup' | 'deposit' | 'deposit_refund' | 'referral';

type Tx = {
  id: string;
  kind: Kind;
  amount_cents: number;
  created_at: string;
  booking_id: string | null;
  salon: { name: string } | null;
  booking: { price_cents: number; starts_at: string } | null;
};

const LABEL: Record<Kind, string> = {
  cash_topup: 'Cash top-up',
  deposit: 'Deposit',
  deposit_refund: 'Deposit refunded',
  referral: 'Referral reward',
};

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · `
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function WalletScreen({ customerId, onBack }: {
  customerId: string; onBack: () => void;
}) {
  const [txs, setTxs] = useState<Tx[] | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('wallet_transactions')
      .select('id, kind, amount_cents, created_at, booking_id, salon:salons!salon_id(name),'
        + ' booking:bookings!booking_id(price_cents, starts_at)')
      .eq('user_id', customerId).order('created_at', { ascending: false });
    if (error) Alert.alert('Could not load wallet', error.message);
    else setTxs(data as unknown as Tx[]);
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const rows = txs ?? [];
  const balance = rows.reduce((a, t) => a + t.amount_cents, 0) / 100;

  // "24 DH paid on 1 booking" — deposits still riding on a live booking, i.e.
  // debits with no matching refund. Cheap enough to derive; no column for it.
  const refunded = new Set(rows.filter((t) => t.kind === 'deposit_refund').map((t) => t.booking_id));
  const held = rows.filter((t) => t.kind === 'deposit' && !refunded.has(t.booking_id));
  const heldTotal = held.reduce((a, t) => a - t.amount_cents, 0) / 100;
  const latestHeld = held[0];

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={8}
            style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headerTitle}>My wallet</Display>
          <Pressable hitSlop={8} accessibilityLabel="How the wallet works"
            onPress={() => Alert.alert('How the wallet works',
              'Top up with cash at your barber. Use the balance as a deposit — 40% minimum — and pay the rest at the shop.')}
            style={({ pressed }) => [s.puck, pressed && s.pressed]}>
            <Ionicons name="information-circle-outline" size={16} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.balanceCard}>
          <View>
            <Text style={s.balanceLabel}>Wallet Balance</Text>
            <Text style={s.balance}>
              {balance.toLocaleString('en-US')}<Text style={s.balanceUnit}> DH</Text>
            </Text>
            {heldTotal > 0 && (
              <Text style={s.balanceNote}>{heldTotal} DH paid toward an upcoming booking</Text>
            )}
          </View>
          {/* 7b — the honest alert. Card top-ups need the rail that isn't here yet. */}
          <Pressable accessibilityRole="button"
            onPress={() => Alert.alert('Add money',
              'Card top-ups are coming soon — for now, top up with cash at your barber.')}
            style={({ pressed }) => [s.addBtn, pressed && s.pressed]}>
            <Text style={s.addText}>ADD MONEY</Text>
          </Pressable>
        </View>

        {held.length > 0 && (
          <View style={s.heldRow}>
            <View style={s.heldIcon}>
              <Ionicons name="lock-closed-outline" size={17} color={colors.accent} />
            </View>
            <View style={s.grow}>
              <Text style={s.heldTitle}>
                {heldTotal} DH paid on {held.length} booking{held.length > 1 ? 's' : ''}
              </Text>
              <Text style={s.heldSub}>
                Deposit{latestHeld?.salon ? ` · ${latestHeld.salon.name}` : ''}
                {latestHeld?.booking ? `, ${dayOf(latestHeld.booking.starts_at)}` : ''}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
          </View>
        )}

        <View style={s.noteCard}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary}
            style={s.noteIcon} />
          <Text style={s.noteText}>
            Top up with cash at your barber. Use the balance as a deposit — 40% minimum — and pay
            the rest at the shop.
          </Text>
        </View>

        <Text style={s.section}>Transactions</Text>

        {txs === null && <ActivityIndicator style={s.spinner} color={colors.textSecondary} />}
        {txs?.length === 0 && (
          <Text style={s.empty}>No transactions yet. Top up with cash at your barber.</Text>
        )}

        <View style={s.txList}>
          {rows.map((t) => {
            const credit = t.amount_cents > 0;
            const pct = t.kind === 'deposit' && t.booking
              ? ` · ${Math.round((-t.amount_cents / t.booking.price_cents) * 100)}% of ${t.booking.price_cents / 100} DH`
              : '';
            return (
              <View key={t.id} style={s.tx}>
                <View style={s.grow}>
                  <Text style={s.txLabel}>
                    {LABEL[t.kind]}{t.salon ? ` · ${t.salon.name}` : ''}
                  </Text>
                  <Text style={s.txWhen}>
                    {when(t.created_at)}
                    {pct || (t.kind === 'deposit_refund' ? ' · barber cancelled'
                      : t.kind === 'referral' ? ' · first visit completed' : '')}
                  </Text>
                </View>
                <Text style={[s.txDelta, credit && s.txCredit]}>
                  {credit ? '+' : '−'} {Math.abs(t.amount_cents) / 100} DH
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 66, paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },

  balanceCard: {
    backgroundColor: colors.ink, borderRadius: 24, paddingVertical: 22, paddingHorizontal: 20, gap: 16,
  },
  balanceLabel: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  balance: {
    fontFamily: serif, fontSize: 44, lineHeight: 46, color: '#fff', marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  balanceUnit: { fontSize: 20, letterSpacing: 0.8 },
  balanceNote: { fontSize: font.tiny, color: 'rgba(255,255,255,0.45)', marginTop: 6 },
  addBtn: {
    height: 50, borderRadius: radius.pill, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  addText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.04, color: colors.text },

  heldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, ...shadow,
  },
  heldIcon: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(232,68,46,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  heldTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  heldSub: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },

  noteCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  noteIcon: { marginTop: 1 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },

  section: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 2 },
  spinner: { marginTop: sp(4) },
  empty: { fontSize: 12, color: colors.textSecondary },

  txList: { gap: 10 },
  tx: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderColor: colors.border, borderRadius: 18,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  txLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  txWhen: { fontSize: font.tiny, color: colors.textTertiary, marginTop: 2 },
  txDelta: { fontSize: 14, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  txCredit: { color: '#16A34A' },
});
