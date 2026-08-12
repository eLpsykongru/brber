import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, ScreenHeader, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, inter, radius, sp } from '../theme';

// 39b of "Customer App 3.dc.html" — your standing.
//
// 0046 built the late-arrival mark and made it cost 100% deposit instead of 40%,
// and then never showed it to anyone. The only way to find out you were marked
// was to open a booking sheet and be refused — which is precisely the ambush
// turn 38 spent eight panels arguing against. BACKLOG named this gap
// ("Nothing surfaces the mark before it bites"); this is it closed.
//
// The screen also carries the rule 39b introduces and 0065 implements: three
// visits on time in a row clears the mark. Before this, a marked customer's
// only option was to wait ninety days.

type Mark = {
  id: string; kind: string; minutes: number | null; at: string;
  salon: string; cleared: boolean; disputable: boolean;
};
type Visit = { at: string; salon: string; on_time: boolean };
type Standing = { pays_full: boolean; streak: number; needed: number; marks: Mark[]; history: Visit[] };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const short = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function StandingScreen({ onBack, onDispute }: {
  onBack: () => void; onDispute?: (markId: string) => void;
}) {
  const [st, setSt] = useState<Standing | null>(null);

  const load = useCallback(() => {
    supabase.rpc('my_customer_standing').then(({ data, error }) => {
      if (error) { Alert.alert('Could not load', error.message); return; }
      setSt(data as Standing);
    });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!st) return <View style={s.screen}><ActivityIndicator style={s.spin} /></View>;

  const live = st.marks.filter((m) => !m.cleared);

  return (
    <View style={s.screen}>
      <ScreenHeader title="Your standing" onBack={onBack} />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {st.pays_full ? (
          <View style={s.warnCard}>
            <View style={s.warnTop}>
              <View style={s.warnChip}>
                <Ionicons name="time-outline" size={17} color="#8a6508" />
              </View>
              <View style={s.grow}>
                <Text style={s.warnTitle}>Barbers ask you to pay up front</Text>
                <Text style={s.warnSub}>
                  Because of {live.length} missed {live.length === 1 ? 'visit' : 'visits'}
                </Text>
              </View>
            </View>
            <Text style={s.warnBody}>
              You can still book anywhere. You just can't split the payment 40/60 — the full
              price comes from your wallet.
            </Text>
          </View>
        ) : (
          <View style={s.okCard}>
            <View style={s.warnTop}>
              <View style={s.okChip}>
                <Ionicons name="checkmark" size={17} color={colors.success} />
              </View>
              <View style={s.grow}>
                <Text style={s.okTitle}>You're in good standing</Text>
                <Text style={s.warnSub}>Deposits are the usual 40%</Text>
              </View>
            </View>
          </View>
        )}

        {/* the way out, which 0046 never gave anybody */}
        {st.pays_full && (
          <Card>
            <View style={s.rowCenter}>
              <Text style={s.eyebrow}>TURN UP TO THREE IN A ROW</Text>
              <View style={s.grow} />
              <Text style={s.count}>{st.streak} of {st.needed}</Text>
            </View>
            <View style={s.bars}>
              {Array.from({ length: st.needed }, (_, i) => (
                <View key={i} style={[s.bar, i < st.streak && s.barOn]} />
              ))}
            </View>
            <View style={s.ladder}>
              {st.history.filter((v) => v.on_time).slice(0, st.streak).map((v, i) => (
                <View key={i} style={s.step}>
                  <View style={s.stepDone}>
                    <Ionicons name="checkmark" size={11} color={colors.success} />
                  </View>
                  <Text style={s.stepText}>{day(v.at)} · on time</Text>
                </View>
              ))}
              {Array.from({ length: Math.max(0, st.needed - st.streak) }, (_, i) => (
                <View key={`t${i}`} style={s.step}>
                  <View style={s.stepTodo} />
                  <Text style={s.stepTodoText}>
                    {i === 0 ? 'Your next visit' : 'And the one after'}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        )}

        {st.marks.length > 0 && (
          <>
            <Text style={s.section}>WHAT HAPPENED</Text>
            <View style={s.list}>
              {st.marks.map((m, i) => (
                <View key={m.id} style={[s.markRow, i < st.marks.length - 1 && s.markDivider]}>
                  <View style={s.grow}>
                    <Text style={s.markTitle}>
                      {m.kind === 'late' && m.minutes != null ? `Arrived ${m.minutes} min late` : "Didn't turn up"}
                    </Text>
                    <Text style={s.markMeta}>{m.salon} · {short(m.at)}</Text>
                  </View>
                  {m.cleared ? (
                    <Text style={s.cleared}>Cleared</Text>
                  ) : m.disputable ? (
                    <Pressable onPress={() => onDispute?.(m.id)} hitSlop={8}
                      accessibilityLabel={`Dispute the mark from ${short(m.at)}`}
                      style={({ pressed }) => pressed && s.pressed}>
                      <Text style={s.dispute}>Dispute</Text>
                    </Pressable>
                  ) : (
                    <Text style={s.tooOld}>Too old to dispute</Text>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {/* the asymmetry, said plainly — 0030's client_flags are the barber's
            private notes and stay that way; only the platform mark is shown */}
        <View style={s.privacy}>
          <View style={s.lockChip}>
            <Ionicons name="lock-closed-outline" size={13} color={colors.textSecondary} />
          </View>
          <Text style={s.privacyText}>
            Barbers see that you're asked to pay up front. They don't see anything they
            wrote about you.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { padding: sp(5), gap: 14, paddingBottom: TAB_BAR_INSET },
  spin: { marginTop: sp(20) },
  grow: { flex: 1 },
  pressed: { opacity: 0.6 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  warnCard: {
    backgroundColor: 'rgba(232,161,0,0.12)', borderWidth: 1, borderColor: 'rgba(232,161,0,0.34)',
    borderRadius: 22, padding: 18, gap: 13,
  },
  warnTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  warnChip: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(232,161,0,0.24)',
    alignItems: 'center', justifyContent: 'center',
  },
  warnTitle: { fontFamily: inter.b, fontSize: 13.5, color: '#8a6508' },
  warnSub: { fontFamily: inter.r, fontSize: 11.5, color: '#5c5c58', marginTop: 3 },
  warnBody: {
    fontFamily: inter.r, fontSize: 12.5, lineHeight: 19, color: '#3d3d3a',
    borderTopWidth: 1, borderTopColor: 'rgba(232,161,0,0.24)', paddingTop: 13,
  },

  okCard: { backgroundColor: colors.bg, borderRadius: 22, padding: 18 },
  okChip: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: 'rgba(30,142,79,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  okTitle: { fontFamily: inter.b, fontSize: 13.5, color: colors.text },

  eyebrow: { fontFamily: inter.b, fontSize: 10, letterSpacing: 1.5, color: colors.textSecondary },
  count: { fontFamily: inter.b, fontSize: 11.5, color: colors.text },
  bars: { flexDirection: 'row', gap: 8, marginTop: 14 },
  bar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border },
  barOn: { backgroundColor: '#16A34A' },
  ladder: {
    gap: 11, marginTop: 14, borderTopWidth: 1, borderTopColor: '#EFECE4', paddingTop: 13,
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepDone: {
    width: 20, height: 20, borderRadius: radius.pill, backgroundColor: 'rgba(74,222,128,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepTodo: {
    width: 20, height: 20, borderRadius: radius.pill,
    borderWidth: 1.5, borderColor: '#D8D4CA', borderStyle: 'dashed',
  },
  stepText: { flex: 1, fontFamily: inter.r, fontSize: 12.5, color: '#3d3d3a' },
  stepTodoText: { flex: 1, fontFamily: inter.r, fontSize: 12.5, color: colors.textTertiary },

  section: {
    fontFamily: inter.b, fontSize: 11, letterSpacing: 1.65,
    color: colors.textSecondary, marginTop: 2,
  },
  list: { backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: 18 },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  markDivider: { borderBottomWidth: 1, borderBottomColor: '#EFECE4' },
  markTitle: { fontFamily: inter.sb, fontSize: 12.5, color: colors.text },
  markMeta: { fontFamily: inter.r, fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  dispute: { fontFamily: inter.sb, fontSize: 11.5, color: colors.accent },
  tooOld: { fontFamily: inter.r, fontSize: 11.5, color: colors.textTertiary },
  cleared: { fontFamily: inter.sb, fontSize: 11.5, color: colors.success },

  privacy: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: colors.bg, borderRadius: 18, padding: 13, paddingHorizontal: 15,
  },
  lockChip: {
    width: 26, height: 26, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  privacyText: {
    flex: 1, fontFamily: inter.r, fontSize: 11.5, lineHeight: 17, color: '#5c5c58',
  },
});
