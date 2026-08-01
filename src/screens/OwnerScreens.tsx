import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Avatar, Btn, Eyebrow, GhostBtn, Ico, IconName, Screen, Serif, Stars, Stat, T, Toggle, TopBar,
} from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// Turn 2 of "Barber App.dc.html" — the shop above the chair. 2a dashboard,
// 2b all chairs, 2c barber detail. Commission, chairs and per-barber earnings
// are all real (0025-0027); 0031 adds the report window and the settlement ledger.

const CHAIR_TINTS = ['#E8442E', '#5B8DEF', '#4ADE80', '#E8A100', '#A78BFA'];

export type Member = {
  id: string; name: string; avatar: string | null; role: string; chair: string | null;
  status: 'pending' | 'approved' | 'rejected'; pay: 'commission' | 'rent';
  split: number; rent: number; rating: number; reviews: number;
  todayBookings: number; todayRevenue: number | null; inService: boolean; isCashAgent: boolean;
};

type LiveBooking = {
  id: string; barber_id: string; starts_at: string; ends_at: string; status: string;
  price_cents: number; walk_in_name: string | null; customer_id: string;
  checked_in_at: string | null; started_at: string | null; completed_at: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
};

type BlockRow = { id: string; barber_id: string; label: string | null; day: string | null; start_min: number; end_min: number };

const dh = (c: number) => `${Math.round(c / 100).toLocaleString('en-US').replace(/,/g, ' ')} DH`;
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const minToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const first = (n: string) => n.split(' ')[0];
const clientOf = (b: LiveBooking) =>
  b.walk_in_name ?? (b.customer?.full_name ? `${first(b.customer.full_name)} ${(b.customer.full_name.split(' ')[1] ?? '')[0] ?? ''}.`.trim() : 'Walk-in');

export type ShopMeta = {
  id: string; name: string; address: string | null;
  open_min: number; close_min: number; default_commission: number;
};

// ---- 2a · owner dashboard --------------------------------------------------
export function OwnerDashboard({ salon, team, onBack, onAllChairs, onReports, onReviews, onTeam, onBarber }: {
  salon: ShopMeta; team: Member[]; onBack: () => void;
  onAllChairs: () => void; onReports: () => void; onReviews: () => void; onTeam: () => void;
  onBarber: (m: Member) => void;
}) {
  const [rows, setRows] = useState<LiveBooking[] | null>(null);
  const [due, setDue] = useState<{ total: number; barbers: number } | null>(null);

  const ids = team.map((m) => m.id);

  useEffect(() => {
    if (!ids.length) return;
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    supabase.from('bookings')
      .select('id, barber_id, starts_at, ends_at, status, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name)')
      .in('barber_id', ids)
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
      .then(({ data }) => setRows((data as unknown as LiveBooking[]) ?? []));

    // settlement banner: commission accrued since each barber was last squared up
    (async () => {
      const [{ data: last }, ] = await Promise.all([supabase.rpc('salon_last_settled')]);
      const lastBy: Record<string, string> = {};
      for (const r of (last ?? []) as any[]) lastBy[r.barber_id] = r.covers_to;
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
      const froms = team.filter((m) => m.pay === 'commission')
        .map((m) => ({ m, from: lastBy[m.id] ? new Date(lastBy[m.id]) : weekAgo }));
      if (!froms.length) return setDue({ total: 0, barbers: 0 });
      const oldest = froms.reduce((a, b) => (b.from < a.from ? b : a)).from;
      const { data } = await supabase.rpc('salon_report', {
        p_from: oldest.toISOString(), p_to: new Date().toISOString(),
      });
      const byId: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) byId[r.barber_id] = r.commission_cents ?? 0;
      const owing = froms.filter(({ m }) => (byId[m.id] ?? 0) > 0);
      setDue({ total: owing.reduce((a, { m }) => a + (byId[m.id] ?? 0), 0), barbers: owing.length });
    })();
  }, [ids.join(',')]);

  const live = rows ?? [];
  const confirmed = live.filter((b) => b.status === 'confirmed');
  const bookings = confirmed.length;
  const revenue = confirmed.reduce((a, b) => a + b.price_cents, 0);
  const noShows = live.filter((b) => b.status === 'no_show').length;
  const waiting = confirmed.filter((b) => b.checked_in_at && !b.started_at && !b.completed_at).length;
  const shopCut = team.filter((m) => m.pay === 'commission').reduce((a, m) => {
    const rev = confirmed.filter((b) => b.barber_id === m.id).reduce((x, b) => x + b.price_cents, 0);
    return a + Math.round(rev * (100 - m.split) / 100);
  }, 0);

  // occupancy = booked minutes / (open minutes × barbers on the floor today)
  const onFloor = team.filter((m) => m.status === 'approved').length;
  const openMin = Math.max(1, salon.close_min - salon.open_min) * Math.max(1, onFloor);
  const bookedMin = confirmed.reduce(
    (a, b) => a + (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000, 0);
  const occupancy = Math.min(100, Math.round((bookedMin / openMin) * 100));

  const today = new Date();
  const dateLabel = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase();

  return (
    <Screen gap={14}>
      <View style={s.headRow}>
        <View style={s.grow}>
          <Eyebrow ls={1.8}>OWNER · {dateLabel}</Eyebrow>
          <Serif size={24} ls={0.03} style={{ marginTop: 5 }}>{salon.name}</Serif>
        </View>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to my chair"
          style={({ pressed }) => [s.myChair, pressed && s.pressed]}>
          <Ico name="scissors" size={13} />
          <T w="b" size={11}>My chair</T>
        </Pressable>
      </View>

      <View>
        <Eyebrow ls={1.6}>SHOP TAKE TODAY</Eyebrow>
        <Serif size={44} ls={0} style={s.hero}>{dh(revenue)}</Serif>
        <T size={12} c={D.sub} style={{ marginTop: 6 }}>
          {bookings} booking{bookings === 1 ? '' : 's'} across {onFloor} chair{onFloor === 1 ? '' : 's'} · {dh(shopCut)} commission
        </T>
      </View>

      <View style={s.tiles}>
        <Stat label="OCCUPANCY" value={String(occupancy)} unit="%" />
        <Stat label="WAITING" value={String(waiting)} />
        <Stat label="NO-SHOWS" value={String(noShows)} valueColor={noShows ? D.red : undefined} />
      </View>

      <Eyebrow ls={1.65}>THE CHAIRS · RIGHT NOW</Eyebrow>
      {rows === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading the shop" />}
      <View style={{ gap: 9 }}>
        {team.filter((m) => m.status === 'approved').map((m) => {
          const mine = confirmed.filter((b) => b.barber_id === m.id);
          const inChair = mine.find((b) => b.started_at && !b.completed_at);
          const off = !mine.length && !m.inService;
          const freeAt = inChair ? hhmm(inChair.ends_at) : null;
          const rev = mine.reduce((a, b) => a + b.price_cents, 0);
          return (
            <Pressable key={m.id} onPress={() => onBarber(m)} accessibilityRole="button"
              accessibilityLabel={`${m.name}, ${inChair ? 'cutting' : off ? 'off' : 'free'}`}
              style={({ pressed }) => [s.chairRow, inChair && s.chairRowLive, pressed && s.pressed]}>
              <Avatar size={42} warm={m.role === 'owner'} initials={initials(m.name)}
                dot={inChair ? D.green : off ? D.muted : D.green} />
              <View style={s.grow}>
                <View style={s.nameRow}>
                  <T w="b" size={14}>{first(m.name)}</T>
                  {m.role === 'owner' && (
                    <View style={s.youChip}><T w="b" size={9} c={D.accent} ls={0.7}>YOU</T></View>
                  )}
                </View>
                <T size={11} c={D.sub} style={{ marginTop: 3 }}>
                  {inChair ? `Cutting ${clientOf(inChair)} · free ${freeAt}`
                    : off ? 'Nothing booked today'
                    : `${mine.length} today · next ${mine[0] ? hhmm(mine[0].starts_at) : '—'}`}
                </T>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T w="b" size={14} c={off ? D.muted : D.text} style={s.tnum}>{dh(rev)}</T>
                <T size={10} c={D.sub} style={{ marginTop: 2 }}>{mine.length} today</T>
              </View>
            </Pressable>
          );
        })}
      </View>

      {!!due?.total && (
        <Pressable onPress={onReports} accessibilityRole="button" accessibilityLabel="Weekly settlement due"
          style={({ pressed }) => [s.settleCard, pressed && s.pressed]}>
          <View style={s.settleIcon}><Ico name="alert-triangle" size={16} color={D.accent} /></View>
          <View style={s.grow}>
            <T w="b" size={13}>Weekly settlement due</T>
            <T size={11} c={D.sub} style={{ marginTop: 2 }}>
              {dh(due.total)} commission across {due.barbers} barber{due.barbers === 1 ? '' : 's'}
            </T>
          </View>
          <Ico name="chevron-right" size={15} color={D.accent} />
        </Pressable>
      )}

      <View style={s.quickRow}>
        <Quick icon="calendar" label="All chairs" onPress={onAllChairs} />
        <Quick icon="trending-up" label="Reports" onPress={onReports} />
        <Quick icon="star" label="Reviews" onPress={onReviews} />
        <Quick icon="users" label="Team" onPress={onTeam} />
      </View>
    </Screen>
  );
}

function Quick({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.quick, pressed && s.pressed]}>
      <Ico name={icon} size={19} />
      <T w="sb" size={11} c={D.sub}>{label}</T>
    </Pressable>
  );
}

// ---- 2b · all chairs, day view --------------------------------------------
const LANE_H = 392;      // the mock's column height
const LANE_HOURS = 7;    // 09:30 → 15:30 in the mock, one row per hour
const PX_PER_MIN = LANE_H / (LANE_HOURS * 60);

export function AllChairsScreen({ salon, team, onBack, onAdd }: {
  salon: ShopMeta; team: Member[]; onBack: () => void; onAdd: () => void;
}) {
  const [day, setDay] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const [rows, setRows] = useState<LiveBooking[] | null>(null);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [daysOff, setDaysOff] = useState<{ barber_id: string; day: string }[]>([]);

  const roster = team.filter((m) => m.status === 'approved');
  const ids = roster.map((m) => m.id);

  const load = useCallback(async () => {
    if (!ids.length) return;
    setRows(null);
    const to = new Date(day); to.setDate(to.getDate() + 1);
    const [bk, blk, off] = await Promise.all([
      supabase.from('bookings')
        .select('id, barber_id, starts_at, ends_at, status, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name)')
        .in('barber_id', ids)
        .gte('starts_at', day.toISOString()).lt('starts_at', to.toISOString()),
      supabase.from('time_blocks').select('id, barber_id, label, day, start_min, end_min').in('barber_id', ids),
      supabase.from('days_off').select('barber_id, day').in('barber_id', ids).eq('day', isoDay(day)),
    ]);
    setRows((bk.data as unknown as LiveBooking[]) ?? []);
    setBlocks((blk.data ?? []) as BlockRow[]);
    setDaysOff((off.data ?? []) as { barber_id: string; day: string }[]);
  }, [ids.join(','), day.getTime()]);

  useEffect(() => { load(); }, [load]);

  const startMin = salon.open_min;
  const hours = Array.from({ length: LANE_HOURS }, (_, i) => startMin + i * 60);
  const live = (rows ?? []).filter((b) => b.status !== 'cancelled');
  const booked = live.filter((b) => b.status === 'confirmed');
  const occupancy = (() => {
    const openMin = Math.max(1, salon.close_min - salon.open_min) * Math.max(1, roster.length);
    const min = booked.reduce(
      (a, b) => a + (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000, 0);
    return Math.min(100, Math.round((min / openMin) * 100));
  })();

  const topOf = (iso: string) =>
    (((new Date(iso).getHours() * 60 + new Date(iso).getMinutes()) - startMin)) * PX_PER_MIN;

  return (
    <Screen gap={12}>
      <TopBar title="All chairs" onBack={onBack} plain right="plus" onRight={onAdd} />

      <View style={s.dayNav}>
        <Pressable onPress={() => setDay(new Date(day.getTime() - 86_400_000))} hitSlop={8}
          accessibilityRole="button" accessibilityLabel="Previous day">
          <Ico name="chevron-left" size={14} />
        </Pressable>
        <T w="b" size={13} style={s.dayNavLabel}>
          {day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'long' })}
        </T>
        <Pressable onPress={() => setDay(new Date(day.getTime() + 86_400_000))} hitSlop={8}
          accessibilityRole="button" accessibilityLabel="Next day">
          <Ico name="chevron-right" size={14} />
        </Pressable>
      </View>

      <View style={s.laneHeads}>
        {roster.map((m, i) => {
          const off = daysOff.some((o) => o.barber_id === m.id);
          return (
            <View key={m.id} style={[s.laneHead, off && s.laneOff]}>
              <View style={[s.laneDot, { backgroundColor: off ? D.muted : CHAIR_TINTS[i % CHAIR_TINTS.length] }]} />
              <T w="b" size={11}>{first(m.name)}</T>
            </View>
          );
        })}
      </View>

      {rows === null && <ActivityIndicator color={D.accent} accessibilityLabel="Loading the day" />}

      <View style={s.laneRow}>
        <View style={s.gutter}>
          {hours.map((m) => (
            <T key={m} size={10} c={D.sub} style={s.gutterLabel}>{minToHHMM(m)}</T>
          ))}
        </View>
        {roster.map((m, i) => {
          const tint = CHAIR_TINTS[i % CHAIR_TINTS.length];
          const off = daysOff.some((o) => o.barber_id === m.id);
          if (off) {
            return (
              <View key={m.id} style={s.lane}>
                <View style={s.laneOffBody}><T w="b" size={10} c={D.muted} ls={1}>DAY OFF</T></View>
              </View>
            );
          }
          const mine = live.filter((b) => b.barber_id === m.id);
          const myBlocks = blocks.filter((b) => b.barber_id === m.id
            && (b.day === null || b.day === isoDay(day)));
          return (
            <View key={m.id} style={s.lane}>
              {myBlocks.map((b) => (
                <View key={b.id} style={[s.slot, {
                  top: (b.start_min - startMin) * PX_PER_MIN,
                  height: Math.max(18, (b.end_min - b.start_min) * PX_PER_MIN),
                  backgroundColor: 'rgba(232,161,0,0.5)',
                }]}>
                  <T w="b" size={9} c={D.bg}>{b.label ?? 'Break'}</T>
                </View>
              ))}
              {mine.map((b) => {
                const dur = (new Date(b.ends_at).getTime() - new Date(b.starts_at).getTime()) / 60_000;
                const h = Math.max(20, dur * PX_PER_MIN);
                const noShow = b.status === 'no_show';
                const inChair = !!b.started_at && !b.completed_at;
                return (
                  <View key={b.id} style={[s.slot, {
                    top: topOf(b.starts_at), height: h,
                    backgroundColor: noShow ? 'rgba(248,113,113,0.28)'
                      : inChair ? 'rgba(74,222,128,0.9)' : tint,
                    ...(noShow ? { borderWidth: 1, borderStyle: 'dashed' as const, borderColor: 'rgba(248,113,113,0.7)' } : null),
                  }]}>
                    <T w="b" size={10} c={noShow ? D.red : inChair ? D.bg : '#fff'}>
                      {noShow ? 'No-show' : clientOf(b)}
                    </T>
                    {h >= 38 && (
                      <T size={9} c={inChair ? 'rgba(13,13,15,0.7)' : 'rgba(255,255,255,0.75)'}
                        style={{ marginTop: 2 }}>
                        {inChair ? 'In chair' : b.services?.name ?? 'Service'}
                      </T>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      <View style={s.legendRow}>
        <LegendDot color={D.green} label="In chair" />
        <LegendDot color="rgba(232,161,0,0.5)" label="Break" />
        <LegendDot color="rgba(248,113,113,0.5)" label="No-show" />
        <View style={s.grow} />
        <T w="b" size={11} c={D.sub}>{occupancy}% full</T>
      </View>
    </Screen>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={s.legendItem}>
      <View style={[s.legendSwatch, { backgroundColor: color }]} />
      <T size={10} c={D.sub}>{label}</T>
    </View>
  );
}

// ---- 2c · barber detail, owner view ---------------------------------------
type Period = { label: string; bookings: number; booked: number; commission: number; noShows: number };

export function OwnerBarberScreen({ member, salon, onBack, onChat, onSchedule, onChanged }: {
  member: Member; salon: ShopMeta; onBack: () => void;
  onChat?: () => void; onSchedule?: () => void; onChanged: () => void;
}) {
  const [week, setWeek] = useState<Period | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [phone, setPhone] = useState<string | null>(null);
  const [cashAgent, setCashAgent] = useState(member.isCashAgent);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
    const to = new Date(); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
    supabase.rpc('salon_report', { p_from: from.toISOString(), p_to: to.toISOString() })
      .then(({ data }) => {
        const r = ((data ?? []) as any[]).find((x) => x.barber_id === member.id);
        if (r) {
          setWeek({
            label: 'This week', bookings: r.bookings, booked: r.booked_cents ?? 0,
            commission: r.commission_cents ?? 0, noShows: r.no_shows,
          });
        }
      });
    supabase.from('bookings').select('starts_at, price_cents')
      .eq('barber_id', member.id).eq('status', 'confirmed')
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
      .then(({ data }) => {
        const buckets = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i));
          return (data ?? []).filter((b: any) => new Date(b.starts_at).toDateString() === d.toDateString())
            .reduce((a: number, b: any) => a + b.price_cents, 0);
        });
        setDays(buckets);
      });
    supabase.from('profiles').select('phone').eq('id', member.id).maybeSingle()
      .then(({ data }) => setPhone(data?.phone ?? null));
  }, [member.id]);

  async function setAgent(next: boolean) {
    setCashAgent(next);
    setBusy(true);
    const { error } = await supabase.rpc('salon_set_cash_agent', { p_barber: next ? member.id : null });
    setBusy(false);
    if (error) { setCashAgent(!next); Alert.alert('Could not update', error.message); }
    else onChanged();
  }

  function remove() {
    Alert.alert('Remove from shop?', `${member.name} keeps their own clients and bookings, but leaves ${salon.name}.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('salon_remove_member', { p_barber: member.id });
          if (error) Alert.alert('Could not remove', error.message);
          else { onChanged(); onBack(); }
        },
      },
    ]);
  }

  const max = Math.max(...days, 1);
  const avgTicket = week && week.bookings ? Math.round(week.booked / week.bookings) : 0;
  const openMin = Math.max(1, salon.close_min - salon.open_min) * 7;
  const occupancy = week ? Math.min(100, Math.round((week.bookings * 30 / openMin) * 100)) : 0;
  const stars = Math.round(member.rating || 0);

  return (
    <Screen gap={14}>
      <TopBar title="" onBack={onBack} plain right="more-vertical"
        onRight={() => Alert.alert(member.name, undefined, [
          { text: 'Remove from shop', style: 'destructive', onPress: remove },
          { text: 'Cancel', style: 'cancel' },
        ])} />

      <View style={s.profileRow}>
        <Avatar size={64} initials={initials(member.name)}
          dot={member.inService ? D.green : D.muted} />
        <View style={s.grow}>
          <T w="b" size={17}>{member.name}</T>
          {member.reviews > 0 && <View style={{ marginTop: 3 }}><Stars n={stars} size={11} /></View>}
          <T size={12} c={D.sub} style={{ marginTop: 3 }}>
            {member.role === 'owner' ? 'Owner' : member.chair ? `Barber · ${member.chair}` : 'Barber'}
            {member.reviews > 0 ? ` · ${member.rating.toFixed(1)} (${member.reviews})` : ' · no reviews yet'}
          </T>
        </View>
      </View>

      <View style={s.actionRow}>
        {phone && <Pill icon="phone" label="Call" onPress={() => Linking.openURL(`tel:${phone}`)} />}
        {onChat && <Pill icon="message-circle" label="Chat" onPress={onChat} />}
        {onSchedule && <Pill icon="calendar" label="Schedule" onPress={onSchedule} />}
      </View>

      <Eyebrow ls={1.65}>THIS WEEK</Eyebrow>
      <View style={s.weekCard}>
        <View style={s.weekTop}>
          <View>
            <Eyebrow ls={1.2}>BOOKED VALUE</Eyebrow>
            <Serif size={28} ls={0} style={s.weekValue}>{dh(week?.booked ?? 0)}</Serif>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Eyebrow ls={1.2}>
              {member.pay === 'rent' ? 'RENT' : `SHOP CUT · ${100 - member.split}%`}
            </Eyebrow>
            <T w="b" size={18} c={D.accent} style={[s.tnum, { marginTop: 6 }]}>
              {dh(member.pay === 'rent' ? member.rent : week?.commission ?? 0)}
            </T>
          </View>
        </View>
        <View style={s.bars}>
          {days.map((v, i) => (
            <View key={i} style={[s.bar, {
              height: `${Math.max(6, (v / max) * 100)}%`,
              backgroundColor: i === days.length - 1 ? '#5B8DEF' : 'rgba(91,141,239,0.3)',
            }]} />
          ))}
        </View>
        <View style={s.weekStats}>
          <MiniStat value={String(week?.bookings ?? 0)} label="CLIENTS" />
          <MiniStat value={`${occupancy}%`} label="OCCUPANCY" />
          <MiniStat value={String(week?.noShows ?? 0)} label="NO-SHOWS" />
          <MiniStat value={dh(avgTicket)} label="AVG TICKET" />
        </View>
      </View>

      <Eyebrow ls={1.65}>ACCESS</Eyebrow>
      <View style={s.accessCard}>
        <View style={[s.accessRow, s.accessLine]}>
          <View style={s.grow}>
            <T w="sb" size={13}>Take cash top-ups</T>
            <T size={11} c={D.sub} style={{ marginTop: 2 }}>Acts as an agent for the shop float</T>
          </View>
          <Toggle small on={cashAgent} color={D.accent}
            onPress={busy ? undefined : () => setAgent(!cashAgent)} />
        </View>
        <View style={s.accessRow}>
          <T w="sb" size={13} style={s.grow}>
            {member.pay === 'rent' ? 'Chair rent' : 'Commission rate'}
          </T>
          <View style={s.ratePill}>
            <T w="b" size={12}>
              {member.pay === 'rent' ? dh(member.rent) : `${100 - member.split}%`}
            </T>
          </View>
        </View>
      </View>

      <GhostBtn title="REMOVE FROM SHOP" height={48} color={D.red} border={D.redLine} onPress={remove} />
    </Screen>
  );
}

function Pill({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.pill, pressed && s.pressed]}>
      <Ico name={icon} size={14} />
      <T w="b" size={12}>{label}</T>
    </Pressable>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ gap: 2 }}>
      <T w="b" size={15} style={s.tnum}>{value}</T>
      <T size={10} c={D.sub} ls={0.8}>{label}</T>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  tnum: { fontVariant: ['tabular-nums'] },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  myChair: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12,
    borderRadius: 999, backgroundColor: D.card2,
  },
  hero: { marginTop: 4, fontVariant: ['tabular-nums'] },
  tiles: { flexDirection: 'row', gap: 10 },

  chairRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, padding: 13, paddingHorizontal: 14,
  },
  chairRowLive: { borderWidth: 2, borderColor: D.green },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  youChip: { backgroundColor: D.accentSoft, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 6 },

  settleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: 'rgba(232,68,46,0.10)', borderWidth: 1, borderColor: 'rgba(232,68,46,0.28)',
    borderRadius: 18, padding: 14, paddingHorizontal: 15,
  },
  settleIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: 'rgba(232,68,46,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },

  quickRow: { flexDirection: 'row', gap: 10 },
  quick: {
    flex: 1, alignItems: 'center', gap: 7, backgroundColor: D.card,
    borderRadius: 18, paddingVertical: 14,
  },

  // 2b
  dayNav: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card,
    borderRadius: 14, paddingVertical: 11, paddingHorizontal: 14,
  },
  dayNavLabel: { flex: 1, textAlign: 'center' },
  laneHeads: { flexDirection: 'row', gap: 7, paddingLeft: 38 },
  laneHead: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: D.card, borderRadius: 11, paddingVertical: 8,
  },
  laneOff: { opacity: 0.5 },
  laneDot: { width: 7, height: 7, borderRadius: 999 },
  laneRow: { flexDirection: 'row', gap: 7 },
  gutter: { width: 38 },
  gutterLabel: { height: 56, fontVariant: ['tabular-nums'] },
  lane: { flex: 1, height: LANE_H, backgroundColor: '#141416', borderRadius: 12, overflow: 'hidden' },
  laneOffBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  slot: {
    position: 'absolute', left: 4, right: 4, borderRadius: 9,
    paddingVertical: 6, paddingHorizontal: 8, overflow: 'hidden',
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 9, height: 9, borderRadius: 3 },

  // 2c
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  actionRow: { flexDirection: 'row', gap: 9 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 38,
    paddingHorizontal: 15, borderRadius: 999, backgroundColor: D.card2,
  },
  weekCard: { backgroundColor: D.card, borderRadius: 20, padding: 16, gap: 12 },
  weekTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  weekValue: { marginTop: 4, fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 52 },
  bar: { flex: 1, borderRadius: 3 },
  weekStats: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: D.border, paddingTop: 12,
  },
  accessCard: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  accessRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  accessLine: { borderBottomWidth: 1, borderBottomColor: D.border },
  ratePill: {
    height: 30, borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 13,
    alignItems: 'center', justifyContent: 'center',
  },
});
