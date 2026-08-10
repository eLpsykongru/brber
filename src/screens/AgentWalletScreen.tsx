import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Note, Serif, TAB_INSET } from '../components/dark';
import { TopUpAttempt, TopUpFailedSheet } from '../components/Trouble';
import { OPS_PHONE } from './BarberSupportScreens';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, inter, radius, sp } from '../theme';

// REAL since 0022: float + activity read wallet_transactions; Top-up calls the
// agent_cash_topup RPC (owner-only, phone lookup, no commission — decided 2026-07-19).
// TODO(backlog): settlement/netting, card rail, and paying bookings from the wallet
// are still open — the float only ever grows until settlement lands.

type Tx = { id: string; name: string; phone: string | null; amount_cents: number; created_at: string };

const dh = (n: number) => `${n.toLocaleString('en-US')} DH`;
const mask = (p: string | null) => {
  if (!p) return 'No phone';
  const t = p.trim();
  return t.length > 6 ? `${t.slice(0, t.length - 6)}••• ${t.slice(-3)}` : t;
};
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Opens the OS print dialog (also offers Save-as-PDF → share to WhatsApp).
async function printReceipt(t: Tx) {
  const d = new Date(t.created_at);
  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body style="font-family:-apple-system,Roboto,sans-serif;color:#17181C;padding:24px">
      <div style="max-width:360px;margin:0 auto">
        <div style="text-align:center;border-bottom:2px solid #E8474F;padding-bottom:12px">
          <div style="font-size:26px;font-weight:800;color:#E8474F;letter-spacing:1px">brber</div>
          <div style="font-size:13px;color:#6E7076;margin-top:2px">Cash Top-up Receipt</div>
        </div>
        <table style="width:100%;font-size:14px;margin-top:16px;border-collapse:collapse">
          <tr><td style="color:#6E7076;padding:4px 0">Reference</td><td style="text-align:right;font-weight:600">${t.id.slice(0, 8).toUpperCase()}</td></tr>
          <tr><td style="color:#6E7076;padding:4px 0">Date</td><td style="text-align:right">${d.toLocaleDateString('en-GB')} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</td></tr>
          <tr><td style="color:#6E7076;padding:4px 0">Customer</td><td style="text-align:right">${t.name}</td></tr>
          ${t.phone ? `<tr><td style="color:#6E7076;padding:4px 0">Contact</td><td style="text-align:right">${mask(t.phone)}</td></tr>` : ''}
          <tr><td style="color:#6E7076;padding:4px 0">Method</td><td style="text-align:right">Cash</td></tr>
        </table>
        <div style="background:#FDE7E8;border-radius:12px;text-align:center;padding:16px;margin-top:16px">
          <div style="font-size:12px;color:#6E7076;letter-spacing:1px">AMOUNT TOPPED UP</div>
          <div style="font-size:30px;font-weight:800">${t.amount_cents / 100} DH</div>
        </div>
        <div style="text-align:center;font-size:12px;color:#A0A2A8;margin-top:16px">
          Funds are available immediately in your brber wallet.<br/>Thank you.
        </div>
      </div>
    </body></html>`;
  try {
    await Print.printAsync({ html });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!/didn'?t complete|cancel/i.test(msg)) Alert.alert('Could not print receipt', msg);
  }
}

export default function AgentWalletScreen({ barberId }: { barberId: string }) {
  const [hidden, setHidden] = useState(false);
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [sheet, setSheet] = useState(false);
  // 10c — the last attempt, kept only long enough to tell him nothing moved
  const [failed, setFailed] = useState<TopUpAttempt | null>(null);
  const [lastTry, setLastTry] = useState<{ phone: string; dh: number } | null>(null);
  const [salon, setSalon] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('salons').select('name').eq('owner_id', barberId).maybeSingle()
      .then(({ data }) => setSalon(data?.name ?? null));
  }, [barberId]);

  // ponytail: loads the whole till ledger and sums client-side; paginate + aggregate
  // server-side when a till has thousands of rows
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('wallet_transactions')
      .select('id, amount_cents, created_at, user:profiles!user_id(full_name, phone)')
      .eq('created_by', barberId).order('created_at', { ascending: false });
    if (error) { Alert.alert('Could not load wallet', error.message); return; }
    setTxs((data as any[]).map((r) => ({
      id: r.id, amount_cents: r.amount_cents, created_at: r.created_at,
      name: r.user?.full_name ?? 'Client', phone: r.user?.phone ?? null,
    })));
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  const float_ = (txs ?? []).reduce((a, t) => a + t.amount_cents, 0) / 100;

  async function topup(phone: string, amountDh: number) {
    setLastTry({ phone, dh: amountDh });
    const { data, error } = await supabase.rpc('agent_cash_topup', {
      customer_phone: phone, topup_cents: amountDh * 100,
    });
    // 10c — he is holding this person's cash right now. An alert that says
    // "failed" and nothing else leaves him guessing whether it went half through,
    // so the sheet spells out that neither the wallet nor the float moved.
    if (error) {
      setFailed({
        customer: { id: '', name: 'That client', phone },
        cents: amountDh * 100, balance_cents: null,
        float_cents: Math.round(float_ * 100), salon: salon ?? '',
      });
      return;
    }
    setSheet(false);
    await load();
    const row = Array.isArray(data) ? data[0] : data;
    const tx: Tx = {
      id: row?.tx_id ?? '', name: row?.customer_name ?? 'Client', phone,
      amount_cents: amountDh * 100, created_at: new Date().toISOString(),
    };
    Alert.alert('Top-up confirmed', `${amountDh} DH credited to ${tx.name}.`, [
      { text: 'Print receipt', onPress: () => printReceipt(tx) },
      { text: 'OK' },
    ]);
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.headText}>
          <Text style={s.overline}>AGENT · {(salon ?? 'SALON').toUpperCase()}</Text>
          <Text style={s.headTitle}>Wallet</Text>
        </View>

        {/* float balance */}
        <View style={s.floatCard}>
          <View style={s.rowCenter}>
            <View style={s.redChip}><Ionicons name="wallet" size={18} color={colors.accent} /></View>
            <Text style={s.floatLabel}>FLOAT BALANCE</Text>
            <View style={s.grow} />
            <Pressable onPress={() => setHidden(!hidden)} hitSlop={8}
              accessibilityLabel={hidden ? 'Show balance' : 'Hide balance'}
              style={({ pressed }) => [s.eyeBtn, pressed && s.pressed]}>
              <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={D.sub} />
            </Pressable>
          </View>
          <Serif size={40} ls={0} style={s.floatValue}>{hidden ? '••  •••' : dh(float_)}</Serif>
          <Text style={s.floatSub}>Cash collected for customer top-ups</Text>
          <Pressable onPress={() => setSheet(true)} accessibilityLabel="Top-up"
            style={({ pressed }) => [s.topupBtn, pressed && s.pressed]}>
            <Ionicons name="arrow-down" size={18} color={colors.onAccent} />
            <Text style={s.topupText}>Top-up</Text>
          </Pressable>
        </View>

        {/* activity */}
        <View style={s.rowCenter}>
          <Text style={s.section}>Activity</Text>
          <View style={s.grow} />
          <Pressable onPress={() => Alert.alert('Export', 'Coming soon — see BACKLOG.md')} accessibilityLabel="Export"
            style={({ pressed }) => [s.rowCenter, pressed && s.pressed]}>
            <Ionicons name="funnel-outline" size={14} color={D.sub} />
            <Text style={s.exportText}>Export</Text>
          </Pressable>
        </View>
        {txs === null && <ActivityIndicator style={s.spinner} />}
        {txs?.length === 0 && <Text style={s.empty}>No top-ups yet — take the first one.</Text>}
        {txs?.map((t) => (
          <View key={t.id} style={s.txRow}>
            <View style={s.txIcon}>
              <Ionicons name="arrow-down" size={16} color={colors.accent} />
            </View>
            <View style={s.grow}>
              <Text style={s.txName}>{t.name}</Text>
              <Text style={s.txMeta}>{mask(t.phone)}</Text>
            </View>
            <View style={s.txRight}>
              <Text style={[s.txAmt, s.accentText]}>+{dh(t.amount_cents / 100)}</Text>
              <Text style={s.txTime}>{when(t.created_at)}</Text>
            </View>
            <Pressable onPress={() => printReceipt(t)} hitSlop={8}
              accessibilityLabel={`Print receipt for ${t.name}`}
              style={({ pressed }) => [s.receiptBtn, pressed && s.pressed]}>
              <Ionicons name="print-outline" size={16} color={D.sub} />
            </Pressable>
          </View>
        ))}
        <Note>The float only grows until settlement — no commission is taken on top-ups.</Note>
      </ScrollView>

      {sheet && <TopupSheet onClose={() => setSheet(false)} onConfirm={topup} />}

      {/* 10c — the top-up that didn't land, and the two things he can do while
          holding somebody's cash */}
      <TopUpFailedSheet attempt={failed}
        onClose={() => setFailed(null)}
        onRetry={() => { setFailed(null); if (lastTry) topup(lastTry.phone, lastTry.dh); }}
        onCallOps={() => { setFailed(null); Linking.openURL(`tel:${OPS_PHONE}`); }} />
    </View>
  );
}

function TopupSheet({ onClose, onConfirm }: {
  onClose: () => void; onConfirm: (phone: string, amountDh: number) => Promise<void>;
}) {
  const [mode, setMode] = useState<'phone' | 'qr'>('phone');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const n = parseInt(amount, 10) || 0;
  const valid = n > 0 && mode === 'phone' && phone.trim().length >= 6;

  async function confirm() {
    if (mode === 'qr') {
      Alert.alert('Scan QR', 'Coming soon — see BACKLOG.md');
      return;
    }
    if (!valid || busy) return;
    setBusy(true);
    try { await onConfirm(phone.trim(), n); } finally { setBusy(false); }
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdropWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.rowCenter}>
            <Text style={s.sheetTitle}>Cash top-up</Text>
            <View style={s.grow} />
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close"
              style={({ pressed }) => [s.closeBtn, pressed && s.pressed]}>
              <Ionicons name="close" size={18} color={D.text} />
            </Pressable>
          </View>

          <View style={s.segment}>
            <Pressable onPress={() => setMode('phone')} accessibilityState={{ selected: mode === 'phone' }}
              style={[s.segItem, mode === 'phone' && s.segItemOn]}>
              <Ionicons name="call-outline" size={15} color={mode === 'phone' ? colors.onAccent : D.sub} />
              <Text style={[s.segText, mode === 'phone' && s.segTextOn]}>Phone</Text>
            </Pressable>
            <Pressable onPress={() => setMode('qr')} accessibilityState={{ selected: mode === 'qr' }}
              style={[s.segItem, mode === 'qr' && s.segItemOn]}>
              <Ionicons name="scan-outline" size={15} color={mode === 'qr' ? colors.onAccent : D.sub} />
              <Text style={[s.segText, mode === 'qr' && s.segTextOn]}>Scan QR</Text>
            </Pressable>
          </View>

          {mode === 'phone' ? (
            <>
              <Text style={s.fieldLabel}>CUSTOMER PHONE</Text>
              <View style={s.inputRow}>
                <Ionicons name="search" size={16} color={D.sub} />
                <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                  placeholder="+212 6•• ••• •••" placeholderTextColor={D.sub}
                  style={s.input} accessibilityLabel="Customer phone" />
              </View>
            </>
          ) : (
            // TODO(backlog): no customer QR exists yet; needs expo-camera + a QR payload when real
            <View style={s.qrBox}>
              <Ionicons name="qr-code" size={72} color={D.sub} />
              <Text style={s.qrText}>Point camera at customer's brber QR</Text>
            </View>
          )}

          <Text style={s.fieldLabel}>AMOUNT (DH)</Text>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="number-pad"
            placeholder="0" placeholderTextColor={D.sub} style={s.amountInput}
            accessibilityLabel="Amount in dirhams" />
          <View style={s.quickRow}>
            {[50, 100, 200, 500].map((q) => (
              <Pressable key={q} onPress={() => setAmount(String(n + q))} accessibilityLabel={`Add ${q} dirhams`}
                style={({ pressed }) => [s.quickChip, pressed && s.pressed]}>
                <Text style={s.quickText}>+{q}</Text>
              </Pressable>
            ))}
          </View>

          <View style={s.afterRow}>
            <Text style={s.afterLabel}>Amount to credit</Text>
            <Text style={s.afterValue}>{n} DH</Text>
          </View>

          <Pressable disabled={busy || (mode === 'phone' && !valid)} onPress={confirm}
            accessibilityLabel="Confirm cash received"
            style={({ pressed }) => [s.cta, (busy || (mode === 'phone' && !valid)) && s.ctaDisabled, pressed && s.pressed]}>
            {busy ? <ActivityIndicator color={colors.onAccent} />
              : <Text style={[s.ctaText, mode === 'phone' && !valid && s.ctaTextDisabled]}>Confirm cash received</Text>}
          </Pressable>
          <View style={s.footNote}>
            <Ionicons name="information-circle-outline" size={13} color={D.sub} />
            <Text style={s.footText}>Credited to the customer's wallet instantly</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  content: { paddingTop: 62, paddingHorizontal: 20, gap: 14, paddingBottom: TAB_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accentText: { color: colors.accent },

  headText: { gap: 3 },
  overline: { fontFamily: inter.b, fontSize: 10, color: D.sub, letterSpacing: 1.8 },
  headTitle: { fontFamily: inter.b, fontSize: 17, color: D.text },

  floatCard: {
    backgroundColor: '#1D1416', borderWidth: 1, borderColor: '#332124',
    borderRadius: 20, padding: 18, gap: 14,
  },
  redChip: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: D.accentSoft16,
    alignItems: 'center', justifyContent: 'center',
  },
  floatLabel: { fontFamily: inter.b, fontSize: 10, color: D.sub, letterSpacing: 1.6 },
  afterRow: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: D.card,
    borderRadius: 16, padding: 14, paddingHorizontal: 16,
  },
  afterLabel: { fontFamily: inter.r, fontSize: 12, color: D.sub },
  afterValue: { fontFamily: inter.eb, fontSize: 14, color: D.text, fontVariant: ['tabular-nums'] },
  eyeBtn: {
    width: 32, height: 32, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  floatValue: { fontVariant: ['tabular-nums'] },
  floatSub: { fontFamily: inter.r, fontSize: 12, color: D.sub },
  topupBtn: {
    flexDirection: 'row', height: 52, borderRadius: 16, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  topupText: { fontFamily: inter.b, fontSize: 14, color: colors.onAccent },

  section: { fontFamily: inter.b, fontSize: 15, color: D.text, marginTop: 2 },
  exportText: { fontFamily: inter.r, fontSize: 12, color: D.sub },
  spinner: { marginTop: sp(6) },
  empty: { fontFamily: inter.r, fontSize: 13, color: D.sub, paddingVertical: sp(2) },

  txRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 16, padding: 13, paddingHorizontal: 14,
  },
  txIcon: {
    width: 36, height: 36, borderRadius: 999, backgroundColor: D.accentSoft16,
    alignItems: 'center', justifyContent: 'center',
  },
  txName: { fontFamily: inter.b, fontSize: 14, color: D.text },
  txMeta: { fontFamily: inter.r, fontSize: 11, color: D.sub, marginTop: 2 },
  txRight: { alignItems: 'flex-end', gap: 2 },
  txAmt: { fontFamily: inter.b, fontSize: 14, color: D.text, fontVariant: ['tabular-nums'] },
  txTime: { fontFamily: inter.r, fontSize: 10, color: D.sub },
  receiptBtn: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  backdropWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.sheet, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingTop: 12, paddingHorizontal: 22, paddingBottom: 34, gap: 14,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: D.hairline },
  sheetTitle: { fontFamily: inter.b, fontSize: 17, color: D.text },
  closeBtn: {
    width: 32, height: 32, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  segment: { flexDirection: 'row', backgroundColor: D.card2, borderRadius: radius.pill, padding: 4, gap: 4 },
  segItem: {
    flex: 1, height: 40, borderRadius: radius.pill, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  segItemOn: { backgroundColor: colors.accent },
  segText: { fontFamily: inter.b, fontSize: 13, color: D.sub },
  segTextOn: { color: colors.onAccent },

  fieldLabel: { fontFamily: inter.b, fontSize: 10, color: D.sub, letterSpacing: 1.4 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: D.card2, borderRadius: 16, paddingHorizontal: 16,
  },
  input: { flex: 1, height: 48, fontFamily: inter.m, fontSize: 14, color: D.text },
  amountInput: {
    backgroundColor: D.card2, borderRadius: 16, paddingHorizontal: 16,
    height: 60, fontFamily: inter.b, fontSize: 30, color: D.text, fontVariant: ['tabular-nums'],
  },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickChip: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999,
    borderWidth: 1, borderColor: D.hairline, backgroundColor: 'transparent',
  },
  quickText: { fontFamily: inter.b, fontSize: 12, color: D.text },

  qrBox: {
    borderWidth: 1, borderColor: '#3A3A40', borderStyle: 'dashed', borderRadius: radius.lg,
    alignItems: 'center', justifyContent: 'center', gap: sp(3), paddingVertical: sp(8),
  },
  qrText: { fontSize: font.small, color: D.sub },

  cta: {
    height: 52, borderRadius: 999, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaDisabled: { backgroundColor: 'rgba(232,68,46,0.35)' },
  ctaText: { fontFamily: inter.b, fontSize: 14, color: colors.onAccent },
  ctaTextDisabled: { color: 'rgba(255,255,255,0.55)' },

  footNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  footText: { fontFamily: inter.r, fontSize: 11, color: D.sub },
});
