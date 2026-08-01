import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Eyebrow, Screen, Segmented, Serif, Stat, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// 1i — Earnings. Booked value, not cash in hand: the money is still paid at the shop.
type Period = 'day' | 'week' | 'month';
type Row = {
  starts_at: string;
  price_cents: number;
  customer_id: string;
  walk_in_name: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
};

const dh0 = (cents: number) => `${Math.round(cents / 100)} DH`;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const grouped = (cents: number) =>
  (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

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
    return inPeriod.filter((r) => new Date(r.starts_at).toDateString() === key)
      .reduce((a, r) => a + r.price_cents, 0);
  });
  const barMax = Math.max(...buckets, 1);

  // by-service breakdown
  const svc = new Map<string, { count: number; sum: number }>();
  for (const r of inPeriod) {
    const name = r.services?.name ?? 'Service';
    const e = svc.get(name) ?? { count: 0, sum: 0 };
    e.count++; e.sum += r.price_cents; svc.set(name, e);
  }
  const byService = [...svc.entries()].sort((a, b) => b[1].sum - a[1].sum);

  const rangeLabel = period === 'day'
    ? `TODAY, ${shortDate(new Date())}`
    : `${shortDate(start)} – ${shortDate(new Date())}`;
  const dayRows = [...inPeriod].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const nameOf = (r: Row) =>
    r.walk_in_name ?? (r.customer_id === barberId ? 'Walk-in' : r.customer?.full_name ?? 'Client');

  return (
    <Screen gap={14} bottom={TAB_INSET}>
      <TopBar title="Earnings" onBack={onBack} backIcon="chevron-left" plain />

      <Segmented track={D.card} height={38} active={period}
        items={PERIODS.map((p) => ({ key: p.key, label: p.label }))}
        onChange={(k) => setPeriod(k as Period)} />

      <View>
        <Eyebrow ls={1.6}>{rangeLabel.toUpperCase()}</Eyebrow>
        <Serif size={42} ls={0} style={s.hero}>{grouped(total)} DH</Serif>
        <T size={12} c={D.sub} style={{ marginTop: 6 }}>
          booked value · {clients} client{clients === 1 ? '' : 's'}
          {period !== 'day' ? ` · ${dh0(avgPerDay)}/day avg` : ''}
        </T>
      </View>

      {period !== 'day' && (
        <View style={s.chartCard}>
          <View style={s.chart} accessible accessibilityLabel={`${meta.label} earnings by day`}>
            {buckets.map((v, i) => (
              <View key={i} style={[s.bar, {
                height: Math.max(3, Math.round((v / barMax) * 90)),
                backgroundColor: i === buckets.length - 1 ? D.accent : D.barMuted,
              }]} />
            ))}
          </View>
          <View style={s.axis}>
            <T size={10} c={D.sub}>{shortDate(start)}</T>
            <T size={10} c={D.sub}>Today</T>
          </View>
        </View>
      )}

      <View style={s.tileRow}>
        <Stat radius={18} label="CLIENTS" value={String(clients)} />
        <Stat radius={18} label="WALK-INS" value={String(walkIns)} />
        <Stat radius={18} label={period === 'day' ? 'AVG/CLIENT' : 'AVG/DAY'} unit="DH"
          value={String(period === 'day'
            ? (clients ? Math.round(total / clients / 100) : 0)
            : Math.round(avgPerDay / 100))} />
      </View>

      <T w="b" size={15} style={{ marginTop: 2 }}>{period === 'day' ? "Today's bookings" : 'By service'}</T>
      <View style={{ gap: 9 }}>
        {period === 'day' ? (
          <>
            {dayRows.length === 0 && <T size={12} c={D.sub}>Nothing booked today.</T>}
            {dayRows.map((r, i) => (
              <View key={i} style={s.listRow}>
                <T w="b" size={12} c={D.accent} style={[s.tnum, { width: 42 }]}>{hhmm(r.starts_at)}</T>
                <View style={s.grow}>
                  <T w="b" size={14}>{nameOf(r)}</T>
                  <T size={11} c={D.sub} style={{ marginTop: 2 }}>{r.services?.name ?? 'Service'}</T>
                </View>
                <T w="b" size={14} style={s.tnum}>{dh0(r.price_cents)}</T>
              </View>
            ))}
          </>
        ) : (
          <>
            {byService.length === 0 && <T size={12} c={D.sub}>No earnings in this period.</T>}
            {byService.map(([name, e]) => (
              <View key={name} style={s.listRow}>
                <View style={s.grow}>
                  <T w="b" size={14}>{name}</T>
                  <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                    {e.count} booking{e.count === 1 ? '' : 's'}
                  </T>
                </View>
                <T w="b" size={14} style={s.tnum}>{dh0(e.sum)}</T>
              </View>
            ))}
          </>
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  tnum: { fontVariant: ['tabular-nums'] },
  hero: { marginTop: 5, fontVariant: ['tabular-nums'] },

  chartCard: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 10 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 90 },
  bar: { flex: 1, borderRadius: 3, minWidth: 3 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },

  tileRow: { flexDirection: 'row', gap: 10 },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 16, padding: 14, paddingHorizontal: 15,
  },
});
