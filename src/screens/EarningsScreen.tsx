import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';

type Period = 'day' | 'week' | 'month';
type Row = {
  starts_at: string;
  price_cents: number;
  customer_id: string;
  walk_in_name: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
};

const dh0 = (cents: number) => `${(cents / 100).toFixed(0)} DH`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ampm = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const PERIODS: { key: Period; label: string; days: number }[] = [
  { key: 'day', label: 'Day', days: 1 },
  { key: 'week', label: 'Week', days: 7 },
  { key: 'month', label: 'Month', days: 30 },
];

export default function EarningsScreen({ barberId, onBack }: { barberId: string; onBack: () => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [period, setPeriod] = useState<Period>('week');

  const load = useCallback(async () => {
    const from = startOfDay(new Date()); from.setDate(from.getDate() - 29);
    const to = startOfDay(new Date()); to.setDate(to.getDate() + 1); // include all of today
    const { data, error } = await supabase.from('bookings')
      .select('starts_at, price_cents, customer_id, walk_in_name, services(name), customer:profiles!customer_id(full_name)')
      .eq('barber_id', barberId).eq('status', 'confirmed')
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
      .order('starts_at');
    if (error) Alert.alert('Could not load earnings', error.message);
    else setRows(data as unknown as Row[]);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  const meta = PERIODS.find((p) => p.key === period)!;
  const start = startOfDay(new Date()); start.setDate(start.getDate() - (meta.days - 1));
  const inPeriod = rows.filter((r) => new Date(r.starts_at) >= start);

  const total = inPeriod.reduce((a, r) => a + r.price_cents, 0);
  const clients = inPeriod.length;
  const walkIns = inPeriod.filter((r) => r.customer_id === barberId).length;
  const avgPerDay = Math.round(total / meta.days);

  // per-day buckets for the bar chart (week = 7, month = 30; day handled as a list)
  const buckets = Array.from({ length: meta.days }, (_, i) => {
    const d = startOfDay(new Date()); d.setDate(d.getDate() - (meta.days - 1 - i));
    const key = d.toDateString();
    return { d, value: inPeriod.filter((r) => new Date(r.starts_at).toDateString() === key).reduce((a, r) => a + r.price_cents, 0) };
  });
  const barMax = Math.max(...buckets.map((b) => b.value), 1);

  // by-service breakdown
  const svc = new Map<string, { count: number; sum: number }>();
  for (const r of inPeriod) {
    const name = r.services?.name ?? 'Service';
    const e = svc.get(name) ?? { count: 0, sum: 0 };
    e.count++; e.sum += r.price_cents; svc.set(name, e);
  }
  const byService = [...svc.entries()].sort((a, b) => b[1].sum - a[1].sum);

  const rangeLabel = period === 'day' ? `Today, ${shortDate(new Date())}`
    : `${shortDate(start)} – ${shortDate(new Date())}`;
  const dayRows = [...inPeriod].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nameOf = (r: Row) => r.walk_in_name ?? (r.customer_id === barberId ? 'Walk-in' : r.customer?.full_name ?? 'Client');

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.head}>
          <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Back"
            style={({ pressed }) => [s.circleBtn, pressed && s.pressed]}>
            <Ionicons name="chevron-back" size={20} color={D.text} />
          </Pressable>
          <Text style={s.headTitle}>Earnings</Text>
          <View style={s.circleBtn} />
        </View>

        {/* period selector */}
        <View style={s.segment}>
          {PERIODS.map((p) => (
            <Pressable key={p.key} onPress={() => setPeriod(p.key)}
              accessibilityLabel={p.label} accessibilityState={{ selected: period === p.key }}
              style={[s.segItem, period === p.key && s.segItemOn]}>
              <Text style={[s.segText, period === p.key && s.segTextOn]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* hero total */}
        <View style={s.hero}>
          <Text style={s.heroLabel}>{rangeLabel.toUpperCase()}</Text>
          <Text style={s.heroValue}>{(total / 100).toFixed(2)} DH</Text>
          <Text style={s.heroSub}>
            booked value · {clients} client{clients === 1 ? '' : 's'}
            {period !== 'day' ? ` · ${dh0(avgPerDay)}/day avg` : ''}
          </Text>
        </View>

        {/* chart (week/month) */}
        {period !== 'day' && (
          <View style={s.card}>
            <View style={s.chart} accessibilityLabel={`${meta.label} earnings by day`}>
              {buckets.map((b, i) => (
                <View key={i} style={[s.bar, {
                  height: Math.max(6, Math.round((b.value / barMax) * 90)),
                  backgroundColor: i === buckets.length - 1 ? colors.accent : D.barMuted,
                }]} />
              ))}
            </View>
            <View style={s.axis}>
              <Text style={s.axisText}>{shortDate(start)}</Text>
              <Text style={s.axisText}>Today</Text>
            </View>
          </View>
        )}

        {/* stat tiles */}
        <View style={s.tileRow}>
          <View style={s.tile}>
            <Text style={s.tileLabel}>CLIENTS</Text>
            <Text style={s.tileValue}>{clients}</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>WALK-INS</Text>
            <Text style={s.tileValue}>{walkIns}</Text>
          </View>
          <View style={s.tile}>
            <Text style={s.tileLabel}>{period === 'day' ? 'AVG/CLIENT' : 'AVG/DAY'}</Text>
            <Text style={s.tileValue}>{period === 'day'
              ? (clients ? Math.round(total / clients / 100) : 0)
              : Math.round(avgPerDay / 100)} <Text style={s.tileUnit}>DH</Text></Text>
          </View>
        </View>

        {/* day: booking list; week/month: by-service breakdown */}
        {period === 'day' ? (
          <>
            <Text style={s.section}>Today's bookings</Text>
            {dayRows.length === 0 && <Text style={s.empty}>Nothing booked today.</Text>}
            {dayRows.map((r, i) => (
              <View key={i} style={s.listRow}>
                <Text style={s.listTime}>{ampm(r.starts_at)}</Text>
                <View style={s.grow}>
                  <Text style={s.listName}>{nameOf(r)}</Text>
                  <Text style={s.listMeta}>{r.services?.name ?? 'Service'}</Text>
                </View>
                <Text style={s.listAmt}>{dh0(r.price_cents)}</Text>
              </View>
            ))}
          </>
        ) : (
          <>
            <Text style={s.section}>By service</Text>
            {byService.length === 0 && <Text style={s.empty}>No earnings in this period.</Text>}
            {byService.map(([name, e]) => (
              <View key={name} style={s.listRow}>
                <View style={s.grow}>
                  <Text style={s.listName}>{name}</Text>
                  <Text style={s.listMeta}>{e.count} booking{e.count === 1 ? '' : 's'}</Text>
                </View>
                <Text style={s.listAmt}>{dh0(e.sum)}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  content: { padding: sp(5), paddingTop: sp(14), gap: sp(3), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },

  head: { flexDirection: 'row', alignItems: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: D.text },
  circleBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  segment: { flexDirection: 'row', backgroundColor: D.card, borderRadius: radius.pill, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segItemOn: { backgroundColor: colors.accent },
  segText: { fontSize: font.small, fontWeight: '700', color: D.sub },
  segTextOn: { color: colors.onAccent },

  hero: { gap: 4 },
  heroLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  heroValue: { fontSize: 40, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  heroSub: { fontSize: font.small, color: D.sub },

  card: { backgroundColor: D.card, borderRadius: radius.lg, padding: sp(4), gap: sp(2) },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 90 },
  bar: { flex: 1, borderRadius: 3, minWidth: 3 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: font.tiny, color: D.sub },

  tileRow: { flexDirection: 'row', gap: sp(2.5) },
  tile: { flex: 1, backgroundColor: D.card, borderRadius: radius.lg, padding: sp(3.5), gap: 3 },
  tileLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 0.5 },
  tileValue: { fontSize: 22, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  tileUnit: { fontSize: font.small, fontWeight: '400', color: D.sub },

  section: { fontSize: font.body, fontWeight: '700', color: D.text, marginTop: sp(2) },
  empty: { fontSize: font.small, color: D.sub, paddingVertical: sp(2) },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card, borderRadius: radius.md, padding: sp(3.5),
  },
  listTime: { fontSize: font.small, fontWeight: '700', color: colors.accent, width: 64, fontVariant: ['tabular-nums'] },
  listName: { fontSize: font.body, fontWeight: '700', color: D.text },
  listMeta: { fontSize: font.small, color: D.sub, marginTop: 1 },
  listAmt: { fontSize: font.body, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
});
