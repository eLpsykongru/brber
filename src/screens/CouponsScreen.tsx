import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
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
  expires_on: string | null; used_at: string | null;
  saved_cents: number | null; used_for: string | null;
  salon: { name: string } | null;
};

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function isExpired(c: Coupon) {
  return !c.used_at && !!c.expires_on && new Date(c.expires_on) < new Date();
}

export default function CouponsScreen({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<Coupon[]>([]);
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('coupons')
      .select('id, code, title, note, percent_off, amount_off_cents, expires_on,'
        + ' used_at, saved_cents, used_for, salon:salons!salon_id(name)')
      .not('user_id', 'is', null)
      .order('created_at', { ascending: false });
    if (error) Alert.alert('Could not load coupons', error.message);
    else setRows(data as unknown as Coupon[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function claim() {
    setBusy(true);
    const { error } = await supabase.rpc('claim_coupon', { p_code: code.trim() });
    setBusy(false);
    if (error) return Alert.alert('Could not add that code', error.message);
    setCode(''); setCodeOpen(false); load();
  }

  const active = rows.filter((c) => !c.used_at && !isExpired(c));
  const past = rows.filter((c) => c.used_at || isExpired(c));
  const shown = tab === 'active' ? active : past;

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

        {shown.map((c, i) => {
          const spent = !!c.used_at;
          const dead = isExpired(c);
          // the first active coupon is the ink one in 16a — the hero of the stack
          const hero = tab === 'active' && i === 0;
          return (
            <View key={c.id} style={[s.ticket, hero && s.ticketHero, (spent || dead) && s.ticketOff]}>
              <View style={s.stub}>
                <Text style={[s.stubValue, hero && s.stubValueHero, (spent || dead) && s.stubValueOff]}>
                  {c.percent_off != null ? c.percent_off : (c.amount_off_cents ?? 0) / 100}
                  <Text style={s.stubUnit}>{c.percent_off != null ? '%' : ' DH'}</Text>
                </Text>
                <Text style={[s.stubOff, hero && s.stubOffHero]}>OFF</Text>
              </View>
              <View style={[s.perf, hero && s.perfHero]} />
              <View style={s.ticketBody}>
                <Text style={[s.ticketTitle, hero && s.ticketTitleHero, (spent || dead) && s.struck]}
                  numberOfLines={1}>
                  {c.title}{c.salon ? ` · ${c.salon.name}` : ''}
                </Text>
                <Text style={[s.ticketNote, hero && s.ticketNoteHero]} numberOfLines={1}>
                  {spent
                    ? `Used ${dayOf(c.used_at!)}${c.saved_cents ? ` · saved ${(c.saved_cents / 100).toFixed(2)} DH` : ''}`
                    : dead
                      ? `Expired ${dayOf(c.expires_on!)} · never used`
                      : `${c.note ? `${c.note} · ` : ''}${c.expires_on ? `expires ${dayOf(c.expires_on)}` : ''}`}
                </Text>
                {!spent && !dead && (
                  <View style={s.codeRow}>
                    <View style={[s.codePill, hero && s.codePillHero]}>
                      <Text style={[s.codeText, hero && s.codeTextHero]}>{c.code}</Text>
                    </View>
                    <Text style={s.showAt}>Show at the shop</Text>
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

const s = StyleSheet.create({
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
