import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Display } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow } from '../theme';

// 16a (active) and 17c (used & expired). A coupon is a code you show at the
// shop — nothing here touches a booking's price. Redemption is recorded by
// whoever rings it up, which is why "used" carries a saved amount but the
// booking total does not.
//
// ponytail: no issuing UI. Templates (user_id null) are inserted server-side;
// "Have a code?" claims one. Build an admin surface when someone runs a promo.

type Coupon = {
  id: string; code: string; title: string; note: string | null;
  percent_off: number | null; amount_off_cents: number | null;
  min_spend_cents: number | null;
  expires_on: string | null; used_at: string | null;
  saved_cents: number | null; used_for: string | null;
  salon_id: string | null;
  // 37a, from my_coupons(): the NEW badge and the greyed-out row's own words
  is_new: boolean; expired: boolean; blocked: string | null;
};

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function CouponsScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [referral, setReferral] = useState<string | null>(null);

  const load = useCallback(async () => {
    // 37a — one read, because "can I use this" is a question the RPC answers and
    // a raw select can't: it needs the shop, the min spend and today's date.
    const [list, ref] = await Promise.all([
      supabase.rpc('my_coupons'),
      supabase.rpc('my_referral_code'),
    ]);
    if (list.error) Alert.alert('Could not load coupons', list.error.message);
    else setRows((list.data as Coupon[]) ?? []);
    if (!ref.error) setReferral(ref.data as string);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function claim() {
    setBusy(true);
    const { error } = await supabase.rpc('claim_coupon', { p_code: code.trim() });
    setBusy(false);
    if (error) return Alert.alert('Could not add that code', error.message);
    setCode(''); setCodeOpen(false); load();
  }

  const active = rows.filter((c) => !c.used_at && !c.expired);
  const past = rows.filter((c) => c.used_at || c.expired);
  const shown = tab === 'active' ? active : past;
  // 37a's hero is the newest usable one — the thing the push was about
  const hero = tab === 'active' ? active.find((c) => !c.blocked) ?? null : null;

  const usedCount = rows.filter((c) => c.used_at).length;
  const totalSaved = rows.reduce((a, c) => a + (c.saved_cents ?? 0), 0) / 100;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <Pressable onPress={onBack} hitSlop={8}
            style={({ pressed }) => [s.puck, pressed && s.pressed]} accessibilityLabel="Go back">
            <Ionicons name="arrow-back" size={16} color={colors.text} />
          </Pressable>
          <Display size={18} style={s.headerTitle}>My coupons</Display>
          <View style={s.puckGhost} />
        </View>

        <View style={s.tabs}>
          <Pressable onPress={() => setTab('active')} style={s.tab}
            accessibilityRole="tab" accessibilityState={{ selected: tab === 'active' }}>
            <Text style={[s.tabText, tab === 'active' && s.tabTextOn]}>
              Active <Text style={s.tabCount}>{active.length}</Text>
            </Text>
            {tab === 'active' && <View style={s.tabBar} />}
          </Pressable>
          <Pressable onPress={() => setTab('past')} style={s.tab}
            accessibilityRole="tab" accessibilityState={{ selected: tab === 'past' }}>
            <Text style={[s.tabText, tab === 'past' && s.tabTextOn]}>Used &amp; expired</Text>
            {tab === 'past' && <View style={s.tabBar} />}
          </Pressable>
        </View>

        {shown.length === 0 && (
          <Text style={s.empty}>
            {tab === 'active'
              ? 'No active coupons. Add a code below when a salon gives you one.'
              : 'Nothing used or expired yet.'}
          </Text>
        )}

        {/* 37a — the coupon a campaign just sent, drawn as the thing it is: a
            ticket with a value, a code and one button. Everything else on this
            screen is a list; this is the one card that came looking for him. */}
        {!!hero && <HeroTicket c={hero} />}

        {shown.filter((c) => c.id !== hero?.id).map((c) => {
          const spent = !!c.used_at;
          const dead = c.expired;
          return (
            <View key={c.id} style={[s.ticket, (spent || dead || !!c.blocked) && s.ticketOff]}>
              <View style={s.stub}>
                <Text style={[s.stubValue, (spent || dead) && s.stubValueOff]}>
                  {c.percent_off != null ? c.percent_off : (c.amount_off_cents ?? 0) / 100}
                  <Text style={s.stubUnit}>{c.percent_off != null ? '%' : ' DH'}</Text>
                </Text>
                <Text style={s.stubOff}>OFF</Text>
              </View>
              <View style={s.perf} />
              <View style={s.ticketBody}>
                <Text style={[s.ticketTitle, (spent || dead) && s.struck]} numberOfLines={1}>
                  {c.title}
                </Text>
                <Text style={s.ticketNote} numberOfLines={1}>
                  {spent
                    ? `Used ${dayOf(c.used_at!)}${c.saved_cents ? ` · saved ${(c.saved_cents / 100).toFixed(2)} DH` : ''}`
                    : dead
                      ? `Expired ${dayOf(c.expires_on!)} · never used`
                      // 37a's greyed row says why in the shop's own words
                      : c.blocked ?? `${c.note ? `${c.note} · ` : ''}${c.expires_on ? `expires ${dayOf(c.expires_on)}` : ''}`}
                </Text>
                {!spent && !dead && !c.blocked && (
                  <View style={s.codeRow}>
                    <View style={s.codePill}>
                      <Text style={s.codeText}>{c.code}</Text>
                    </View>
                    <Text style={s.showAt}>Pick it at checkout</Text>
                  </View>
                )}
              </View>
              {(spent || dead) && (
                <View style={[s.stateChip, dead && s.stateChipDead]}>
                  <Text style={[s.stateText, dead && s.stateTextDead]}>{dead ? 'EXPIRED' : 'USED'}</Text>
                </View>
              )}
            </View>
          );
        })}

        {/* 37a's second card — the one coupon he can hand to somebody else */}
        {tab === 'active' && !!referral && (
          <View style={s.referCard}>
            <View style={s.referTop}>
              <View style={s.referIcon}>
                <Ionicons name="people-outline" size={17} color={colors.accent} />
              </View>
              <View style={s.grow}>
                <Text style={s.referTitle}>20 DH for you and a friend</Text>
                <Text style={s.referSub}>When they finish their first cut</Text>
              </View>
            </View>
            <View style={s.referCodeRow}>
              <Text style={s.referCode}>{referral}</Text>
              <Pressable hitSlop={8} onPress={() => Share.share({
                message: `Use my code ${referral} on Sterncut and we both get 20 DH.`,
              })}>
                <Text style={s.referShare}>Share</Text>
              </Pressable>
            </View>
          </View>
        )}

        {tab === 'active' && (
          <Text style={s.stackNote}>One coupon per booking. They can't be stacked.</Text>
        )}

        {tab === 'active' && (
          <Pressable onPress={() => setCodeOpen(true)}
            style={({ pressed }) => [s.addRow, pressed && s.pressed]}>
            <View style={s.addIcon}>
              <Ionicons name="add" size={17} color={colors.text} />
            </View>
            <View style={s.grow}>
              <Text style={s.addTitle}>Have a code?</Text>
              <Text style={s.addSub}>Add it to your coupons</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
          </Pressable>
        )}

        {tab === 'past' && rows.length > 0 && (
          <View style={s.totals}>
            <View>
              <Text style={s.totalLabel}>COUPONS USED</Text>
              <Text style={s.totalValue}>{usedCount}</Text>
            </View>
            <View style={s.right}>
              <Text style={s.totalLabel}>TOTAL SAVED</Text>
              <Text style={[s.totalValue, s.totalSaved]}>{totalSaved.toFixed(0)} DH</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <Modal visible={codeOpen} transparent animationType="slide" onRequestClose={() => setCodeOpen(false)}>
        <Pressable style={s.scrim} onPress={() => setCodeOpen(false)} />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Display size={18} style={s.sheetTitle}>Add a code</Display>
          <TextInput style={s.input} value={code} onChangeText={setCode} autoCapitalize="characters"
            placeholder="e.g. FADE10" placeholderTextColor={colors.textTertiary} />
          <Pressable onPress={claim} disabled={busy || !code.trim()}
            style={({ pressed }) => [s.saveBtn, (pressed || busy || !code.trim()) && s.pressed]}>
            <Text style={s.saveText}>ADD COUPON</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// 37a — the coupon a campaign just sent
// ---------------------------------------------------------------------------
// Two things it must say that a list row can't: the value, big enough to be the
// point, and **whose money it comes out of**. The second one is not decoration —
// a customer who thinks his barber is discounting will haggle at the chair.
function HeroTicket({ c }: { c: Coupon }) {
  const value = c.percent_off != null
    ? `${c.percent_off}% off`
    : `${Math.round((c.amount_off_cents ?? 0) / 100)} DH off`;
  return (
    <View style={s.hero}>
      {/* the notches that make it a ticket rather than a card */}
      <View style={s.notchL} />
      <View style={s.notchR} />

      <View style={s.heroTop}>
        {c.is_new && <View style={s.newChip}><Text style={s.newText}>NEW</Text></View>}
        <View style={s.grow} />
        {!!c.expires_on && (
          <Text style={s.heroEnds}>Ends {dayOf(c.expires_on)}</Text>
        )}
      </View>

      <View>
        <Text style={s.heroValue}>{value}</Text>
        <Text style={s.heroSub}>
          {c.title}
          {c.min_spend_cents ? ` · on ${Math.round(c.min_spend_cents / 100)} DH or more` : ''}
        </Text>
      </View>

      <View style={s.heroCodeRow}>
        <View style={s.grow}>
          <Text style={s.heroCodeLabel}>CODE</Text>
          <Text style={s.heroCode}>{c.code}</Text>
        </View>
        <View style={s.heroUse}>
          <Text style={s.heroUseText}>USE IT</Text>
        </View>
      </View>

      <View style={s.heroNote}>
        <Ionicons name="information-circle-outline" size={13} color="rgba(255,255,255,0.5)" />
        <Text style={s.heroNoteText}>
          Comes off what you pay from your wallet. Your barber still gets the full price.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  // 37a hero
  hero: {
    position: 'relative', backgroundColor: '#101010', borderRadius: 22, padding: 18,
    gap: 14, overflow: 'hidden',
  },
  notchL: {
    position: 'absolute', left: -13, top: 104, width: 26, height: 26,
    borderRadius: 13, backgroundColor: colors.bg,
  },
  notchR: {
    position: 'absolute', right: -13, top: 104, width: 26, height: 26,
    borderRadius: 13, backgroundColor: colors.bg,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  newChip: { backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  newText: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1.3, color: '#0D0D0F' },
  heroEnds: { fontSize: 11, color: 'rgba(255,255,255,0.55)' },
  heroValue: { fontFamily: serif, fontWeight: '700', fontSize: 34, lineHeight: 36, color: '#fff' },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 7 },
  heroCodeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)',
    borderStyle: 'dashed', paddingTop: 14,
  },
  heroCodeLabel: {
    fontSize: 9.5, fontWeight: '700', letterSpacing: 1.3, color: 'rgba(255,255,255,0.45)',
  },
  heroCode: { fontSize: 17, fontWeight: '700', letterSpacing: 1.4, color: '#fff', marginTop: 4 },
  heroUse: {
    height: 38, borderRadius: radius.pill, backgroundColor: colors.accent,
    justifyContent: 'center', paddingHorizontal: 18,
  },
  heroUseText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: '#fff' },
  heroNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 11,
  },
  heroNoteText: {
    flex: 1, fontSize: 11.5, lineHeight: 18, color: 'rgba(255,255,255,0.6)',
  },

  // 37a referral card
  referCard: { backgroundColor: colors.bg, borderRadius: 20, padding: 16, gap: 12, ...shadow },
  referTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  referIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(232,68,46,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  referTitle: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  referSub: { fontSize: 11.5, color: colors.textSecondary, marginTop: 3 },
  referCodeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 12,
  },
  referCode: { flex: 1, fontSize: 14, fontWeight: '700', letterSpacing: 0.9, color: colors.text },
  referShare: { fontSize: 12, fontWeight: '700', color: colors.accent },
  stackNote: { fontSize: 11.5, color: colors.textTertiary, lineHeight: 18 },

  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingTop: 66, paddingHorizontal: 20, paddingBottom: 40, gap: 14 },
  grow: { flex: 1 },
  right: { alignItems: 'flex-end' },
  pressed: { opacity: 0.75 },
  struck: { textDecorationLine: 'line-through' },

  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  puck: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  puckGhost: { width: 40 },
  headerTitle: { flex: 1, textAlign: 'center', letterSpacing: 0.72 },

  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabText: { fontSize: font.small, fontWeight: '600', color: colors.textSecondary },
  tabTextOn: { color: colors.text, fontWeight: '700' },
  tabCount: { color: colors.textTertiary, fontWeight: '600' },
  tabBar: {
    position: 'absolute', bottom: -1, height: 3, width: '40%',
    backgroundColor: colors.accent, borderRadius: 2,
  },
  empty: { fontSize: 12, color: colors.textSecondary, paddingVertical: 8 },

  ticket: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg,
    borderRadius: 20, overflow: 'hidden', ...shadow,
  },
  ticketHero: { backgroundColor: colors.ink },
  ticketOff: { opacity: 0.62 },
  stub: { paddingVertical: 18, paddingLeft: 18, paddingRight: 16, alignItems: 'center', gap: 1 },
  stubValue: { fontFamily: serif, fontSize: 28, lineHeight: 30, color: colors.accent },
  stubValueHero: { color: '#fff', fontSize: 30, lineHeight: 32 },
  stubValueOff: { color: colors.textSecondary },
  stubUnit: { fontSize: 14 },
  stubOff: { fontSize: 9, letterSpacing: 1.26, fontWeight: '700', color: colors.textTertiary },
  stubOffHero: { color: 'rgba(255,255,255,0.5)' },
  // ponytail: a solid hairline where the mock has a dashed perforation — RN has
  // no repeating-gradient, and a 10-View dash ladder is not worth the nodes
  perf: { width: 1, alignSelf: 'stretch', backgroundColor: '#DDD9CF' },
  perfHero: { backgroundColor: 'rgba(255,255,255,0.3)' },
  ticketBody: { flex: 1, paddingVertical: 15, paddingHorizontal: 16 },
  ticketTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  ticketTitleHero: { color: '#fff' },
  ticketNote: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 3 },
  ticketNoteHero: { color: 'rgba(255,255,255,0.55)' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  codePill: {
    backgroundColor: colors.surface, borderRadius: 7, paddingVertical: 5, paddingHorizontal: 9,
  },
  codePillHero: { backgroundColor: 'rgba(255,255,255,0.12)' },
  codeText: {
    fontSize: font.tiny, fontWeight: '700', letterSpacing: 1.54, color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  codeTextHero: { color: '#fff' },
  showAt: { fontSize: font.tiny, fontWeight: '600', color: colors.accent },
  stateChip: {
    backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9,
    marginRight: 16,
  },
  stateChipDead: { backgroundColor: 'rgba(232,68,46,0.10)' },
  stateText: { fontSize: 10, letterSpacing: 1, fontWeight: '700', color: '#5C5C58' },
  stateTextDead: { color: '#B4351F' },

  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C9C5BB', borderRadius: 20,
    paddingVertical: 15, paddingHorizontal: 16, marginTop: 2,
  },
  addIcon: {
    width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  addTitle: { fontSize: font.small, fontWeight: '700', color: colors.text },
  addSub: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },

  totals: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.bg,
    borderRadius: 20, paddingVertical: 16, paddingHorizontal: 18, marginTop: 2, ...shadow,
  },
  totalLabel: { fontSize: 10, letterSpacing: 1, fontWeight: '600', color: colors.textTertiary },
  totalValue: {
    fontSize: 17, fontWeight: '800', color: colors.text, marginTop: 3, fontVariant: ['tabular-nums'],
  },
  totalSaved: { color: '#16A34A' },

  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  sheetTitle: { textAlign: 'center' },
  input: {
    backgroundColor: colors.bg, borderRadius: 18, height: 52, paddingHorizontal: 16,
    fontSize: font.body, fontWeight: '700', letterSpacing: 1.5, color: colors.text, ...shadow,
  },
  saveBtn: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  saveText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },
});
