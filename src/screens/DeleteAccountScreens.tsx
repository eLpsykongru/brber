import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { dh } from '../lib/billing';
import { DeletionCheck, deleteAccount, DepositBooking, loadDeletionCheck, typedDelete } from '../lib/deletion';
import { loc, ltr, tr, trn } from '../lib/i18n';
import { colors, inter, serif, shadow, TOP_INSET } from '../theme';

// DEL-04…06 of design_handoff_sterncut_launch/2_customer_store_readiness — the
// customer's way out, as pushed screens (PRO-09's sheet is gone). The rule is the
// server's (0131): refused only while a deposit booking is live, and a wallet
// balance is lost on the record once the tick says so.

const AMBER = '#E8A33D';

export default function DeleteAccountScreen({ userId, onBack, onOpenBooking, onExplore }: {
  userId: string; onBack: () => void;
  onOpenBooking: (id: string) => void; onExplore?: () => void;
}) {
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [typed, setTyped] = useState('');
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setCheck(await loadDeletionCheck()); }
    catch (e: any) { Alert.alert(tr('Could not load'), e.message); }
    setTicked(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!check) {
    return <View style={[s.screen, s.center]}><ActivityIndicator color={colors.text} /></View>;
  }
  if (check.deposit_bookings.length) {
    return <Blocked bookings={check.deposit_bookings} onBack={onBack} onOpenBooking={onOpenBooking} />;
  }

  const wallet = check.wallet_cents;
  const armed = typedDelete(typed) && (wallet <= 0 || ticked) && !busy;

  async function destroy() {
    setBusy(true);
    const refused = await deleteAccount(userId, typed, wallet > 0 && ticked, 'customer');
    if (!refused) return;           // signed out: App draws DEL-06
    setBusy(false);
    Alert.alert(tr('Something changed. Check again.'));
    load();
  }

  const amount = ltr(dh(wallet));
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <Header onBack={onBack} />
        <View style={s.lead}>
          <Text style={s.title24}>{tr('WHAT GOES, WHAT STAYS')}</Text>
          <Text style={s.sub13}>{tr('Your name comes off everything. The records stay, without it.')}</Text>
        </View>

        <View style={s.card}>
          <Text style={[s.label, { color: colors.accent }]}>{tr('WHAT GOES')}</Text>
          {[tr('Name, phone and email'), tr('Photo and date of birth'), tr('Chat messages and photos'),
            ...(check.coupons > 0 ? [trn(check.coupons, '{n} coupon', '{n} coupons')] : [])].map((t) => (
            <View key={t} style={s.line}>
              <Ionicons name="close" size={12} color={colors.accent} />
              <Text style={s.lineText}>{t}</Text>
            </View>
          ))}
          <View style={s.hr} />
          <Text style={s.label}>{tr('WHAT STAYS, WITHOUT A NAME')}</Text>
          {check.bookings > 0 && (
            <Stay strong={trn(check.bookings, '{n} booking', '{n} bookings')} rest={tr(' — barbers’ books need them')} />
          )}
          {check.reviews > 0 && (
            <Stay strong={trn(check.reviews, '{n} review', '{n} reviews')} rest={tr(' — shown as “Former customer”')} />
          )}
          <Stay strong={tr('Money records')} rest={tr(' — kept 10 years by law')} />
        </View>

        {wallet > 0 && (
          <View style={s.walletCard}>
            <Text style={s.walletTitle}>{tr('{amount} in your wallet will be lost', { amount })}</Text>
            <Text style={s.walletBody}>
              {tr('Wallet money can’t be paid out in cash. Spend it on a booking deposit first.')}{' '}
              {onExplore && <Text style={s.walletLink} onPress={onExplore}>{tr('Find a barber')}</Text>}
            </Text>
            <Pressable onPress={() => setTicked((v) => !v)} accessibilityRole="checkbox"
              accessibilityState={{ checked: ticked }} style={s.tickRow}>
              <View style={[s.tick, ticked && s.tickOn]}>
                {ticked && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={s.tickText}>{tr('I understand {amount} will be lost', { amount })}</Text>
            </Pressable>
          </View>
        )}

        <View style={{ gap: 7 }}>
          <Text style={[s.label, { paddingLeft: 4 }]}>{tr('TYPE DELETE TO CONFIRM')}</Text>
          {/* the word is Latin in every language, so the field stays LTR */}
          <TextInput value={typed} onChangeText={setTyped} placeholder="DELETE"
            placeholderTextColor={colors.textTertiary} autoCapitalize="characters" autoCorrect={false}
            style={[s.field, typedDelete(typed) && s.fieldOn]} textAlign="left" />
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable onPress={destroy} disabled={!armed} accessibilityRole="button"
          style={({ pressed }) => [s.danger, !armed && { opacity: 0.45 }, pressed && s.pressed]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>{tr('DELETE MY ACCOUNT')}</Text>}
        </Pressable>
        <Pressable onPress={onBack} accessibilityRole="button"
          style={({ pressed }) => [s.keep, pressed && s.pressed]}>
          <Text style={[s.btnText, { color: colors.text, letterSpacing: 0.8 }]}>{tr('KEEP MY ACCOUNT')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---- DEL-04 ------------------------------------------------------------------
function Blocked({ bookings, onBack, onOpenBooking }: {
  bookings: DepositBooking[]; onBack: () => void; onOpenBooking: (id: string) => void;
}) {
  const one = bookings.length === 1;
  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={[s.body, { gap: 16, paddingHorizontal: 24 }]}>
        <Header onBack={onBack} />
        <View style={{ marginTop: 10 }}>
          <Text style={s.title32}>
            {one ? tr('One thing first.') : trn(bookings.length, '{n} booking first.', '{n} bookings first.')}
          </Text>
          <Text style={[s.sub13, { fontSize: 14, marginTop: 10 }]}>{tr('Nothing has been deleted yet.')}</Text>
        </View>
        {bookings.map((b) => {
          const at = new Date(b.starts_at);
          const card = (
            <>
              <View style={s.chip}>
                <Text style={s.chipText}>{tr('DEPOSIT PAID · {amount}', { amount: ltr(dh(b.deposit_cents)) })}</Text>
              </View>
              <View style={s.who}>
                <View style={s.initials}><Text style={s.initialsText}>{initials(b.barber)}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.service}>{b.service ?? ''}</Text>
                  <Text style={s.meta}>{[b.barber ?? tr('Former barber'), b.shop].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
              <View style={s.when}>
                <Text style={s.meta}>{tr('When')}</Text>
                <Text style={s.whenText}>{ltr(`${at.toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'short' })} · ${at.toTimeString().slice(0, 5)}`)}</Text>
              </View>
            </>
          );
          // with two or more, each card opens its own booking
          return one
            ? <View key={b.id} style={[s.card, { gap: 14 }]}>{card}</View>
            : (
              <Pressable key={b.id} onPress={() => onOpenBooking(b.id)}
                style={({ pressed }) => [s.card, { gap: 14 }, pressed && s.pressed]}>{card}</Pressable>
            );
        })}
        <View style={s.warn}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.accent} style={{ marginTop: 1 }} />
          <Text style={s.warnText}>
            {tr('Cancel it or let it complete first — deposits aren’t refunded on account deletion.')}
          </Text>
        </View>
      </ScrollView>
      {one && (
        <View style={[s.footer, { paddingHorizontal: 24, paddingBottom: 40 }]}>
          <Pressable onPress={() => onOpenBooking(bookings[0].id)} accessibilityRole="button"
            style={({ pressed }) => [s.ink, pressed && s.pressed]}>
            <Text style={s.btnText}>{tr('OPEN THE BOOKING')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ---- DEL-06 ------------------------------------------------------------------
/** Drawn from local state after the server confirmed; the session is already gone. */
export function AccountDeletedScreen({ onDone }: { onDone: () => void }) {
  return (
    <View style={s.screen}>
      <View style={s.doneBody}>
        <View style={s.doneMark}><Ionicons name="checkmark" size={28} color="#fff" /></View>
        <Text style={[s.label, { fontSize: 11, marginTop: 10 }]}>{tr('SIGNED OUT')}</Text>
        <Text style={[s.title32, { textAlign: 'center' }]}>{tr('ACCOUNT DELETED')}</Text>
        <Text style={s.doneText}>
          {tr('Bookings, reviews and money records stay without your name — barbers’ books need the bookings, and the law has us keep money records for 10 years.')}
        </Text>
      </View>
      <View style={[s.footer, { paddingHorizontal: 24, paddingBottom: 40 }]}>
        <Pressable onPress={onDone} accessibilityRole="button" style={({ pressed }) => [s.ink, pressed && s.pressed]}>
          <Text style={s.btnText}>{tr('DONE')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={4} accessibilityLabel={tr('Go back')}
        style={({ pressed }) => [s.back, pressed && s.pressed]}>
        <Ionicons name="arrow-back" size={16} color={colors.text} />
      </Pressable>
      <Text style={s.headerText}>{tr('DELETE ACCOUNT')}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

function Stay({ strong, rest }: { strong: string; rest: string }) {
  return (
    <View style={s.line}>
      <View style={s.dot} />
      <Text style={s.lineText}><Text style={{ fontFamily: inter.sb }}>{strong}</Text>
        <Text style={{ color: colors.textSecondary }}>{rest}</Text></Text>
    </View>
  );
}

const initials = (name: string | null) =>
  (name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { paddingTop: TOP_INSET - 12, paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 44, height: 44, borderRadius: 999, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow },
  headerText: { flex: 1, textAlign: 'center', fontFamily: inter.b, fontSize: 11, letterSpacing: 1.76, color: colors.textSecondary },
  lead: { paddingTop: 2, paddingHorizontal: 4 },
  title24: { fontFamily: serif, fontSize: 24, lineHeight: 28, letterSpacing: 0.48, color: colors.text },
  title32: { fontFamily: serif, fontSize: 32, lineHeight: 35, letterSpacing: 0.64, color: colors.text },
  sub13: { fontFamily: inter.r, fontSize: 13, color: colors.textSecondary, marginTop: 6 },
  card: { backgroundColor: '#fff', borderRadius: 20, paddingVertical: 14, paddingHorizontal: 16, gap: 8, ...shadow, shadowOpacity: 0.05 },
  label: { fontFamily: inter.b, fontSize: 10, letterSpacing: 1.4, color: colors.textSecondary },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineText: { flex: 1, fontFamily: inter.r, fontSize: 13, color: colors.text },
  dot: { width: 5, height: 5, borderRadius: 999, backgroundColor: colors.textSecondary, marginHorizontal: 3 },
  hr: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  walletCard: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1.5, borderColor: AMBER, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 6, gap: 6 },
  walletTitle: { fontFamily: inter.b, fontSize: 15, color: colors.text, fontVariant: ['tabular-nums'] },
  walletBody: { fontFamily: inter.r, fontSize: 12.5, lineHeight: 19, color: '#5C5C58' },
  walletLink: { fontFamily: inter.b, color: colors.text, textDecorationLine: 'underline' },
  tickRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 44, borderTopWidth: 1, borderTopColor: '#F0EDE6', marginTop: 4 },
  tick: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  tickText: { flex: 1, fontFamily: inter.sb, fontSize: 13.5, color: colors.text },
  field: {
    height: 50, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border,
    paddingHorizontal: 18, fontFamily: inter.b, fontSize: 14, letterSpacing: 1.4, color: colors.text, writingDirection: 'ltr',
  },
  fieldOn: { borderColor: colors.text },
  footer: { paddingTop: 12, paddingHorizontal: 20, paddingBottom: 30, gap: 10 },
  danger: { height: 54, borderRadius: 999, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  keep: { height: 52, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  ink: { height: 54, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: inter.b, fontSize: 13, letterSpacing: 1.3, color: '#fff' },
  chip: { alignSelf: 'flex-start', height: 26, borderRadius: 999, backgroundColor: 'rgba(232,163,61,.16)', paddingHorizontal: 11, justifyContent: 'center' },
  chipText: { fontFamily: inter.b, fontSize: 10.5, letterSpacing: 1.05, color: '#8F5E14' },
  who: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  initials: { width: 48, height: 48, borderRadius: 999, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  initialsText: { fontFamily: inter.b, fontSize: 13, color: colors.accent },
  service: { fontFamily: inter.b, fontSize: 15, color: colors.text },
  meta: { fontFamily: inter.r, fontSize: 12.5, color: colors.textSecondary, marginTop: 3 },
  when: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  whenText: { fontFamily: inter.b, fontSize: 13, color: colors.text, fontVariant: ['tabular-nums'] },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 4 },
  warnText: { flex: 1, fontFamily: inter.r, fontSize: 13.5, lineHeight: 21, color: '#5C5C58' },
  doneBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 40, paddingHorizontal: 34 },
  doneMark: { width: 72, height: 72, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontFamily: inter.r, fontSize: 14, lineHeight: 22, color: '#5C5C58', maxWidth: 318, textAlign: 'center', marginTop: 2 },
  pressed: { opacity: 0.75 },
});
