import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ico, Screen, Sheet, SheetHead, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D, serif } from '../theme';

// 8c of "Barber App.dc.html" — the pattern behind the reasons. One cancellation
// is a shrug; eleven of them with the same sentence in the free-text box is
// something he can act on, and he can only see it across bookings.
//
// Reasons are shown as written and cannot be replied to or disputed from here.
// That is the whole bargain: the moment a shop can argue with a reason, it stops
// getting honest ones.

type Stats = {
  cancelled: number; total: number; lost_cents: number; refilled: number;
  deposits_kept_cents: number;
  reasons: { reason: string; n: number }[];
  written: { id: string; text: string; at: string; who: string }[];
};

const dh = (c: number) => (c / 100).toFixed(0);

export default function CancellationsScreen({ onBack }: { onBack?: () => void }) {
  const [st, setSt] = useState<Stats | null>(null);
  const [reading, setReading] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('cancellation_stats');
    if (error) return Alert.alert('Could not load cancellations', error.message);
    setSt(data as Stats);
  }, []);
  useEffect(() => { load(); }, [load]);

  const pct = st && st.total > 0 ? ((st.cancelled * 100) / st.total).toFixed(1) : '0.0';
  const lost = st ? Math.max(0, st.cancelled - st.refilled) : 0;
  const top = st?.reasons[0]?.n ?? 1;
  // 8c's amber card: the "Other" answers are where the actionable complaint hides
  const other = st?.reasons.find((r) => r.reason === 'Other')?.n ?? 0;

  return (
    <>
      <Screen bottom={TAB_INSET}>
        <TopBar title="Cancellations" onBack={onBack} plain />

        <View>
          <T w="b" size={10} c={D.sub} ls={1.6}>LAST 30 DAYS</T>
          <T style={s.big}>{st?.cancelled ?? 0}</T>
          <T size={12} c={D.sub} style={s.mt6}>
            of {st?.total ?? 0} bookings · {pct}% · {dh(st?.lost_cents ?? 0)} DH of chair time
          </T>
        </View>

        <View style={s.statRow}>
          <View style={s.stat}>
            <T w="b" size={10} c={D.sub} ls={0.8}>REFILLED</T>
            <T w="b" size={21} style={s.num}>{st?.refilled ?? 0}</T>
          </View>
          <View style={s.stat}>
            <T w="b" size={10} c={D.sub} ls={0.8}>LOST</T>
            <T w="b" size={21} c={D.red} style={s.num}>{lost}</T>
          </View>
          <View style={s.stat}>
            <T w="b" size={10} c={D.sub} ls={0.8}>DEPOSITS KEPT</T>
            <T w="b" size={21} style={s.num}>
              {dh(st?.deposits_kept_cents ?? 0)}<T size={11} c={D.sub}> DH</T>
            </T>
          </View>
        </View>

        <T w="b" size={11} c={D.sub} ls={1.65} style={s.mt2}>WHY THEY SAID</T>
        <View style={s.list9}>
          {(st?.reasons ?? []).map((r) => {
            const flag = r.reason === 'Other';
            return (
              <View key={r.reason} style={[s.reason, flag && s.reasonFlag]}>
                <T w="b" size={13} c={flag ? D.amber : D.text} style={s.count}>{r.n}</T>
                <View style={s.grow}>
                  <T w={flag ? 'b' : 'sb'} size={13}>{r.reason}</T>
                  <View style={s.bar}>
                    <View style={[s.barFill, flag && s.barFillFlag,
                      { width: `${Math.round((r.n * 100) / top)}%` }]} />
                  </View>
                </View>
              </View>
            );
          })}
          {(st?.reasons.length ?? 0) === 0 && (
            <T size={13} c={D.sub}>Nobody has cancelled on you in 30 days.</T>
          )}
        </View>

        {/* the pattern is only worth a card when there is one */}
        {other > 0 && (st?.written.length ?? 0) > 0 && (
          <View style={s.worth}>
            <View style={s.worthHead}>
              <Ico name="alert-triangle" size={15} color={D.amber} />
              <T w="b" size={11} c={D.amber} ls={1.5}>WORTH A LOOK</T>
            </View>
            <T size={13} c={D.textDim} style={s.worthBody}>
              {st!.written.length} of the {other} “Other” answer{other === 1 ? '' : 's'}
              {st!.written.length === 1 ? ' is' : ' are'} written in full. They're the only place a
              client tells you what actually went wrong.
            </T>
            <Pressable style={s.worthBtn} onPress={() => setReading(true)}>
              <T w="eb" size={12} c={D.bg} ls={0.6}>
                READ {st!.written.length === 1 ? 'IT' : `THE ${st!.written.length}`}
              </T>
            </Pressable>
          </View>
        )}

        <T size={11} c={D.sub} style={s.foot}>
          Reasons are optional and shown as written. You can't reply to one or dispute it.
        </T>
      </Screen>

      <Sheet visible={reading} onClose={() => setReading(false)} deep>
        <SheetHead title="What they wrote" onClose={() => setReading(false)} left />
        {(st?.written ?? []).map((w) => (
          <View key={w.id} style={s.wroteCard}>
            <View style={s.wroteHead}>
              <T w="b" size={12}>{w.who}</T>
              <T size={11} c={D.sub}>
                {new Date(w.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' · '}{new Date(w.at).toTimeString().slice(0, 5)}
              </T>
            </View>
            <T size={13} c={D.textDim} style={s.wroteText}>{w.text}</T>
          </View>
        ))}
        <T size={11} c={D.sub} style={s.foot}>
          Their words, unedited. Nothing you do here is shown to them.
        </T>
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  mt6: { marginTop: 6 },
  num: { fontVariant: ['tabular-nums'] },
  big: {
    fontFamily: serif, fontSize: 42, lineHeight: 44, color: D.text, marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 14, gap: 3 },
  list9: { gap: 9 },
  reason: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
    borderWidth: 2, borderColor: 'transparent',
  },
  reasonFlag: { borderColor: D.amber },
  count: { width: 26, fontVariant: ['tabular-nums'] },
  bar: { height: 4, borderRadius: 2, backgroundColor: D.card2, marginTop: 6, overflow: 'hidden' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: D.muted },
  barFillFlag: { backgroundColor: D.amber },
  worth: {
    backgroundColor: 'rgba(232,161,0,0.08)', borderWidth: 1, borderColor: D.amberLine,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 15, gap: 11,
  },
  worthHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  worthBody: { lineHeight: 20 },
  worthBtn: {
    height: 44, borderRadius: 999, backgroundColor: D.amber,
    alignItems: 'center', justifyContent: 'center',
  },
  foot: { lineHeight: 17 },
  wroteCard: { backgroundColor: D.card, borderRadius: 16, padding: 14, gap: 8 },
  wroteHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  wroteText: { lineHeight: 20 },
});
