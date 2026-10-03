import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Note, Serif, TAB_INSET } from '../components/dark';
import { CapHitSheet, FloatCapMeter, askCollection, isCapError, useFloatStatus } from '../components/FloatCap';
import { TopUpAttempt, TopUpFailedSheet } from '../components/Trouble';
import { OPS_PHONE } from './BarberSupportScreens';
import ExportSheet from '../components/ExportSheet';
import { fileRange, walletActivityHtml } from '../lib/exportPdf';
import { supabase } from '../lib/supabase';
import { colors, dark as D, inter, isDark, radius, sp, TOP_INSET } from '../theme';
import { loc, tr, lang, trn, ltr } from '../lib/i18n';

// REAL since 0022: float + activity read wallet_transactions; Top-up calls the
// agent_cash_topup RPC (owner-only, phone lookup, no commission — decided 2026-07-19).
// 11c/11d (0064) put the float cap on screen: the meter warns from 70% up, and a
// refused top-up opens the cap sheet instead of the generic failure sheet.
// TODO(backlog): the card rail and paying bookings from the wallet are still open.

type Tx = { id: string; name: string; phone: string | null; amount_cents: number; created_at: string };

const dh = (n: number) => `${n.toLocaleString('en-US')} DH`;
const mask = (p: string | null) => {
  if (!p) return tr('No phone');
  const t = p.trim();
  return t.length > 6 ? `${t.slice(0, t.length - 6)}••• ${t.slice(-3)}` : t;
};
const when = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(loc('en-US'), { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(loc('en-US'), { month: 'short', day: 'numeric' });
};

// Opens the OS print dialog (also offers Save-as-PDF → share to WhatsApp).
async function printReceipt(t: Tx) {
  const d = new Date(t.created_at);
  const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body dir="${lang() === 'ar' ? 'rtl' : 'ltr'}" style="font-family:-apple-system,Roboto,sans-serif;color:#17181C;padding:24px">
      <div style="max-width:360px;margin:0 auto">
        <div style="text-align:center;border-bottom:2px solid #E8474F;padding-bottom:12px">
          <div style="font-size:26px;font-weight:800;color:#E8474F;letter-spacing:1px">brber</div>
          <div style="font-size:13px;color:#6E7076;margin-top:2px">${tr('Cash Top-up Receipt')}</div>
        </div>
        <table style="width:100%;font-size:14px;margin-top:16px;border-collapse:collapse">
          <tr><td style="color:#6E7076;padding:4px 0">${tr('Reference')}</td><td style="text-align:right;font-weight:600">${t.id.slice(0, 8).toUpperCase()}</td></tr>
          <tr><td style="color:#6E7076;padding:4px 0">${tr('Date')}</td><td style="text-align:right">${d.toLocaleDateString(loc('en-GB'))} · ${d.toLocaleTimeString(loc('en-US'), { hour: 'numeric', minute: '2-digit' })}</td></tr>
          <tr><td style="color:#6E7076;padding:4px 0">${tr('Customer')}</td><td style="text-align:right">${t.name}</td></tr>
          ${t.phone ? `<tr><td style="color:#6E7076;padding:4px 0">${tr('Contact')}</td><td style="text-align:right">${mask(t.phone)}</td></tr>` : ''}
          <tr><td style="color:#6E7076;padding:4px 0">${tr('Method')}</td><td style="text-align:right">${tr('Cash')}</td></tr>
        </table>
        <div style="background:#FDE7E8;border-radius:12px;text-align:center;padding:16px;margin-top:16px">
          <div style="font-size:12px;color:#6E7076;letter-spacing:1px">${tr('AMOUNT TOPPED UP')}</div>
          <div style="font-size:30px;font-weight:800">${t.amount_cents / 100} DH</div>
        </div>
        <div style="text-align:center;font-size:12px;color:#A0A2A8;margin-top:16px">
          ${tr('Funds are available immediately in your brber wallet.')}<br/>${tr('Thank you.')}
        </div>
      </div>
    </body></html>`;
  try {
    await Print.printAsync({ html });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (!/didn'?t complete|cancel/i.test(msg)) Alert.alert(tr('Could not print receipt'), msg);
  }
}

export default function AgentWalletScreen({ barberId }: { barberId: string }) {
  const [hidden, setHidden] = useState(false);
  const [txs, setTxs] = useState<Tx[] | null>(null);
  const [sheet, setSheet] = useState(false);
  const [exporting, setExporting] = useState(false);   // EXP-01
  // 10c — the last attempt, kept only long enough to tell him nothing moved
  const [failed, setFailed] = useState<TopUpAttempt | null>(null);
  // §6.1 — the key is minted once per attempt and reused by every retry of it,
  // so 10c's "try again" over a request that actually landed credits once.
  const [lastTry, setLastTry] = useState<{ phone: string; dh: number; key: string } | null>(null);
  const [salon, setSalon] = useState<string | null>(null);
  // 11d — the top-up the cap refused. Different sheet from 10c's: nothing broke,
  // the answer is "give it back", and there is somewhere else he can send them.
  const [capHit, setCapHit] = useState<{ phone: string; cents: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [float$] = useFloatStatus(tick);

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
    if (error) { Alert.alert(tr('Could not load wallet'), error.message); return; }
    setTxs((data as any[]).map((r) => ({
      id: r.id, amount_cents: r.amount_cents, created_at: r.created_at,
      name: r.user?.full_name ?? tr('Client'), phone: r.user?.phone ?? null,
    })));
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  // the server's float is the one the cap is measured against; the client sum is
  // every top-up this agent ever took, which stops being the same number the
  // first time ops collects. Prefer the server's and keep the sum as a fallback.
  const float_ = (float$?.float_cents ?? (txs ?? []).reduce((a, t) => a + t.amount_cents, 0)) / 100;

  async function topup(phone: string, amountDh: number, retryKey?: string) {
    const key = retryKey ?? `topup:${barberId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    setLastTry({ phone, dh: amountDh, key });
    const { data, error } = await supabase.rpc('agent_cash_topup', {
      customer_phone: phone, topup_cents: amountDh * 100, p_idem: key,
    });
    // 10c — he is holding this person's cash right now. An alert that says
    // "failed" and nothing else leaves him guessing whether it went half through,
    // so the sheet spells out that neither the wallet nor the float moved.
    if (error) {
      // 11d — the cap is not a failure, it is a rule, and it has its own answer.
      if (isCapError(error.message)) {
        setSheet(false);
        setCapHit({ phone, cents: amountDh * 100 });
        setTick((n) => n + 1);
        return;
      }
      setFailed({
        customer: { id: '', name: tr('That client'), phone },
        cents: amountDh * 100, balance_cents: null,
        float_cents: Math.round(float_ * 100), salon: salon ?? '',
      });
      return;
    }
    setSheet(false);
    setTick((n) => n + 1);
    await load();
    const row = Array.isArray(data) ? data[0] : data;
    const tx: Tx = {
      id: row?.tx_id ?? '', name: row?.customer_name ?? tr('Client'), phone,
      amount_cents: amountDh * 100, created_at: new Date().toISOString(),
    };
    Alert.alert(tr('Top-up confirmed'), tr('{amountDh} DH credited to {name}.', { amountDh, name: tx.name }), [
      { text: tr('Print receipt'), onPress: () => printReceipt(tx) },
      { text: tr('OK') },
    ]);
  }

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.headText}>
          <Text style={s.overline}>{tr('AGENT · {salon}', { salon: (salon ?? tr('SALON')).toUpperCase() })}</Text>
          <Text style={s.headTitle}>{tr('Wallet')}</Text>
        </View>

        {/* float balance */}
        <View style={s.floatCard}>
          <View style={s.rowCenter}>
            <View style={s.redChip}><Ionicons name="wallet" size={18} color={colors.accent} /></View>
            <Text style={s.floatLabel}>{tr('FLOAT BALANCE')}</Text>
            <View style={s.grow} />
            <Pressable onPress={() => setHidden(!hidden)} hitSlop={8}
              accessibilityLabel={hidden ? tr('Show balance') : tr('Hide balance')}
              style={({ pressed }) => [s.eyeBtn, pressed && s.pressed]}>
              <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={D.sub} />
            </Pressable>
          </View>
          <Serif size={40} ls={0} style={s.floatValue}>{hidden ? '••  •••' : dh(float_)}</Serif>
          {/* 11c — the limit, while there is still room to act on it */}
          <FloatCapMeter st={float$} onAsk={askCollection} />
          {(float$?.pct ?? 0) < 70 && (
            <Text style={s.floatSub}>{tr('Cash collected for customer top-ups')}</Text>
          )}
          <Pressable onPress={() => setSheet(true)} accessibilityLabel={tr('Top-up')}
            style={({ pressed }) => [s.topupBtn, pressed && s.pressed]}>
            <Ionicons name="arrow-down" size={18} color={colors.onAccent} />
            <Text style={s.topupText}>{tr('Top-up')}</Text>
          </Pressable>
        </View>

        {/* activity */}
        <View style={s.rowCenter}>
          <Text style={s.section}>{tr('Activity')}</Text>
          <View style={s.grow} />
          {!!txs?.length && (
            <Pressable onPress={() => setExporting(true)} accessibilityRole="button" accessibilityLabel={tr('Export')}
              hitSlop={10} style={({ pressed }) => [s.rowCenter, pressed && s.pressed]}>
              <Ionicons name="share-outline" size={14} color={D.sub} />
              <Text style={s.exportText}>{tr('Export')}</Text>
            </Pressable>
          )}
        </View>
        {txs === null && <ActivityIndicator style={s.spinner} />}
        {txs?.length === 0 && <Text style={s.empty}>{tr('No top-ups yet — take the first one.')}</Text>}
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
              accessibilityLabel={tr('Print receipt for {name}', { name: t.name })}
              style={({ pressed }) => [s.receiptBtn, pressed && s.pressed]}>
              <Ionicons name="print-outline" size={16} color={D.sub} />
            </Pressable>
          </View>
        ))}
        <Note>{tr('The float only grows until settlement — no commission is taken on top-ups.')}</Note>
      </ScrollView>

      {sheet && <TopupSheet onClose={() => setSheet(false)} onConfirm={topup} />}
      {/* EXP-02: the same rows as the Activity list, for the period picked */}
      <ExportSheet visible={exporting} onClose={() => setExporting(false)} kind="wallet"
        build={async (from, to) => {
          const rows = (txs ?? []).filter((t) => { const d = new Date(t.created_at); return d >= from && d < to; })
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          return {
            html: walletActivityHtml({ shop: salon ?? '', from, to, rows, mask }),
            entries: rows.length,
            fileName: `sterncut-wallet-${fileRange(from, to)}.pdf`,
          };
        }} />

      {/* 10c — the top-up that didn't land, and the two things he can do while
          holding somebody's cash */}
      <TopUpFailedSheet attempt={failed}
        onClose={() => setFailed(null)}
        onRetry={() => { setFailed(null); if (lastTry) topup(lastTry.phone, lastTry.dh, lastTry.key); }}
        onCallOps={() => { setFailed(null); Linking.openURL(`tel:${OPS_PHONE}`); }} />

      {/* 11d — the cap refused it. Nothing was written, so the only thing left
          to do is hand the cash back and point them somewhere that can take it. */}
      <CapHitSheet attempt={capHit} st={float$} opsPhone={OPS_PHONE}
        onClose={() => setCapHit(null)}
        onGaveBack={() => setTick((n) => n + 1)} />
    </View>
  );
}

function TopupSheet({ onClose, onConfirm }: {
  onClose: () => void; onConfirm: (phone: string, amountDh: number) => Promise<void>;
}) {
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  // BCF-02b — the customer the number belongs to, before the cash is taken (0131)
  const [match, setMatch] = useState<{ name: string; wallet_cents: number; visits: number } | null>(null);
  useEffect(() => {
    let live = true;
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) { setMatch(null); return; }
    supabase.rpc('agent_find_customer', { p_phone: phone })
      .then(({ data }) => { if (live) setMatch((data as typeof match) ?? null); });
    return () => { live = false; };
  }, [phone]);
  const n = parseInt(amount, 10) || 0;
  const valid = n > 0 && phone.trim().length >= 6;
  const first = match?.name.split(' ')[0] ?? '';

  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    try { await onConfirm(phone.trim(), n); } finally { setBusy(false); }
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdropWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={tr('Close')} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.rowCenter}>
            <Text style={s.sheetTitle}>{tr('Cash top-up')}</Text>
            <View style={s.grow} />
            <Pressable onPress={onClose} accessibilityLabel={tr('Close')}
              style={({ pressed }) => [s.closeBtn, s.close44, pressed && s.pressed]}>
              <Ionicons name="close" size={18} color={D.text} />
            </Pressable>
          </View>

          {/* by phone only: the Scan QR tab was a mock — no customer QR exists yet
              (BACKLOG, Agent wallet) */}
          <Text style={s.fieldLabel}>{tr('CUSTOMER PHONE')}</Text>
          <View style={s.inputRow}>
            <Ionicons name="search" size={16} color={D.sub} />
            <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad"
              placeholder="+212 6•• ••• •••" placeholderTextColor={D.sub}
              style={s.input} accessibilityLabel={tr('Customer phone')} />
          </View>
          {match && (
            <View style={s.matchCard}>
              <View style={s.matchInitials}>
                <Text style={s.matchInitialsText}>
                  {match.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                </Text>
              </View>
              <View style={s.grow}>
                <Text style={s.matchName}>{match.name}</Text>
                <Text style={s.matchSub}>
                  {trn(match.visits, 'Wallet {amount} · {n} visit with you', 'Wallet {amount} · {n} visits with you',
                    { amount: ltr(dh(Math.round(match.wallet_cents / 100))) })}
                </Text>
              </View>
              <Ionicons name="checkmark" size={16} color={D.green} />
            </View>
          )}

          <Text style={s.fieldLabel}>{tr('AMOUNT (DH)')}</Text>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="number-pad"
            placeholder="0" placeholderTextColor={D.sub} style={s.amountInput}
            accessibilityLabel={tr('Amount in dirhams')} />
          <View style={s.quickRow}>
            {[50, 100, 200, 500].map((q) => (
              <Pressable key={q} onPress={() => setAmount(String(n + q))} accessibilityLabel={tr('Add {q} dirhams', { q })}
                style={({ pressed }) => [s.quickChip, s.chip44, pressed && s.pressed]}>
                <Text style={s.quickText}>+{q}</Text>
              </Pressable>
            ))}
          </View>

          {/* the three BCF-02b fixes: 44px close, 44px chips, and the balance named */}
          <View style={s.afterRow}>
            <Text style={s.afterLabel}>
              {match ? tr('{name}\'s wallet after', { name: first }) : tr('Amount to credit')}
            </Text>
            <Text style={s.afterValue}>{ltr(dh((match ? Math.round(match.wallet_cents / 100) : 0) + n))}</Text>
          </View>

          <Pressable disabled={busy || !valid} onPress={confirm}
            accessibilityLabel={tr('Confirm cash received')}
            style={({ pressed }) => [s.cta, (busy || !valid) && s.ctaDisabled, pressed && s.pressed]}>
            {busy ? <ActivityIndicator color={colors.onAccent} />
              : <Text style={[s.ctaText, !valid && s.ctaTextDisabled]}>{tr('Confirm cash received')}</Text>}
          </Pressable>
          <View style={s.footNote}>
            <Ionicons name="information-circle-outline" size={13} color={D.sub} />
            <Text style={s.footText}>{tr('Credited to the customer\'s wallet instantly')}</Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  exportText: { fontFamily: inter.r, fontSize: 12, color: D.sub, marginStart: 4 },
  close44: { width: 44, height: 44 },
  chip44: { height: 44, justifyContent: 'center' },
  matchCard: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14, marginTop: 2 },
  matchInitials: { width: 36, height: 36, borderRadius: 999, backgroundColor: D.accentSoft, alignItems: 'center', justifyContent: 'center' },
  matchInitialsText: { fontFamily: inter.b, fontSize: 11, color: D.accent },
  matchName: { fontFamily: inter.b, fontSize: 13, color: D.text },
  matchSub: { fontFamily: inter.r, fontSize: 11, color: D.sub, marginTop: 2 },
  screen: { flex: 1, backgroundColor: D.bg },
  content: { paddingTop: TOP_INSET, paddingHorizontal: 20, gap: 14, paddingBottom: TAB_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accentText: { color: colors.accent },

  headText: { gap: 3 },
  overline: { fontFamily: inter.b, fontSize: 10, color: D.sub, letterSpacing: 1.8 },
  headTitle: { fontFamily: inter.b, fontSize: 17, color: D.text },

  floatCard: {
    backgroundColor: D.redCard, borderWidth: 1, borderColor: D.redSeam,
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
    width: 32, height: 32, borderRadius: radius.pill, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)',
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
