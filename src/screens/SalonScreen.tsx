import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, PanResponder, Platform, Pressable,
  ScrollView, Share, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { Eyebrow, Ico, IconName, Serif, T } from '../components/dark';
import { ShopPauseSheet } from '../components/ShopPause';
import { TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useAndroidBack } from '../lib/back';
import { colors, dark as D, font, inter, isDark, radius, serif, sp, TOP_INSET } from '../theme';
import LinesScreen from './LinesScreen';
import { AllChairsScreen, type Member, OwnerBarberScreen, OwnerDashboard } from './OwnerScreens';
import { paidPeriodName, periodStart, rentPeriodName } from '../lib/rent';
import { ReviewsInboxScreen, ShopListingScreen, ShopReportScreen, WalkInPosterScreen, WallDisplayScreen } from './ShopScreens';
import DepositScreen from './DepositScreen';
import { loc, tr, trn } from '../lib/i18n';

// Owner-only Salon screen — TEAM / SERVICES / SETTINGS. Real backend (0025):
// salon_team()/salon_stats() RPCs (owner-only, privacy rule baked in — a rent
// barber's revenue never arrives), + owner mutation RPCs. Services reuse the real
// per-barber table (via Profile → My Services for add/edit).
// STILL MOCK (blocked — see BACKLOG): Packages, invite-by-phone/share link,
// Payouts/Reports/Permissions. Presence is derived from today's bookings.

const dh = (c: number) => `${Math.round(c / 100).toLocaleString('en-US')} DH`;

type PayModel = 'commission' | 'rent';
type SalonMeta = {
  id: string; name: string; address: string | null; bio: string | null;
  lat: number | null; lng: number | null;
  default_commission: number; accepting_bookings: boolean; cash_agent_id: string | null;
  open_min: number; close_min: number;
  short_code: string | null;   // 0110 — the poster and the wall display print it
};

// the turn-2 screens that sit behind this hub
type OwnerView =
  | 'hub' | 'dashboard' | 'allChairs' | 'report' | 'reviews' | 'listing' | 'poster' | 'wall'
  | 'deposit'    // OSH-11/12/13
  | 'lines';     // OSH-19

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
type Stats = { onFloor: number; chairs: number; bookings: number; revenue: number; shopCut: number };
type Svc = { id: string; name: string; price_cents: number; duration_min: number; is_active: boolean };
type Availability = 'empty' | 'open' | 'busy' | 'off';
type Chair = {
  id: string; label: string; barberId: string | null; barberName: string | null;
  avatar: string | null; availability: Availability;
  // 0142 — what an empty chair asks, and whether barbers can see it
  rentCents: number | null; rentPeriod: 'week' | 'month'; note: string | null;
  listedAt: string | null; vacantSince: string | null;
  asks: number;   // 0144 — barbers waiting on an answer
};
type Ask = {
  ask_id: string; full_name: string; phone: string | null; rating: number | null; reviews_count: number;
  cuts: number; shop_name: string | null;
};

// the floor's "open" is a brighter green than the kit's
const OPEN = isDark ? '#3BD07A' : D.green;

const AVAIL: Record<Availability, { c: string; t: string }> = {
  open: { c: OPEN, t: tr('Open') },
  busy: { c: colors.accent, t: tr('In service') },
  off: { c: colors.star, t: tr('Off') },
  empty: { c: D.sub, t: tr('Empty') },
};

const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const statusColor = (m: Member) =>
  m.status === 'pending' ? colors.star : m.inService ? colors.accent : OPEN;
const statusLabel = (m: Member) =>
  m.status === 'pending' ? tr('PENDING') : m.inService ? tr('IN SERVICE') : tr('FREE');

export default function SalonScreen({ barberId, onBack, onManageServices, onEditSalon }: {
  barberId: string; onBack?: () => void;
  onManageServices?: () => void; onEditSalon?: () => void;
}) {
  const [seg, setSeg] = useState<'team' | 'chairs' | 'services' | 'settings'>('team');
  const [view, setView] = useState<OwnerView>('hub');
  // OSH-11's value on the menu row. Null while loading — never guess 40 on screen.
  const [depositPct, setDepositPct] = useState<number | null>(null);
  const [tabs, setTabs] = useState(false); // the old TEAM/CHAIRS/SERVICES/SETTINGS detail sheet
  const [salon, setSalon] = useState<SalonMeta | null>(null);
  const [team, setTeam] = useState<Member[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Svc[] | null>(null);
  const [chairs, setChairs] = useState<Chair[] | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [editTerms, setEditTerms] = useState(false);
  const [chairEdit, setChairEdit] = useState<Chair | 'new' | null>(null);
  const [payoutsFor, setPayoutsFor] = useState<Member | null>(null);
  const [invite, setInvite] = useState(false);
  const [defCommOpen, setDefCommOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);   // 11a

  const load = useCallback(async () => {
    const [{ data: s }, { data: t }, { data: st }, { data: sv }, { data: ch }] = await Promise.all([
      supabase.from('salons')
        .select('id, name, address, bio, lat, lng, default_commission, accepting_bookings, cash_agent_id, open_min, close_min, short_code')
        .eq('owner_id', barberId).maybeSingle(),
      supabase.rpc('salon_team'),
      supabase.rpc('salon_stats'),
      supabase.from('services').select('id, name, price_cents, duration_min, is_active')
        .eq('barber_id', barberId).order('created_at'),
      supabase.rpc('salon_chairs'),
    ]);
    setSalon(s as SalonMeta | null);
    setChairs(((ch as any[]) ?? []).map((r) => ({
      id: r.chair_id, label: r.label, barberId: r.barber_id, barberName: r.barber_name,
      avatar: r.avatar_url, availability: r.availability,
      rentCents: r.rent_cents, rentPeriod: r.rent_period ?? 'month', note: r.note,
      listedAt: r.listed_at, vacantSince: r.vacant_since, asks: r.asks ?? 0,
    })));
    setTeam(((t as any[]) ?? []).map((r) => ({
      id: r.barber_id, name: r.full_name, avatar: r.avatar_url, role: r.salon_role,
      chair: r.chair_label, status: r.salon_status, pay: r.pay_model, split: r.commission_pct,
      rent: r.rent_cents, period: r.rent_period ?? 'month', rating: Number(r.rating), reviews: r.reviews_count,
      todayBookings: r.today_bookings, todayRevenue: r.today_revenue_cents,
      inService: r.in_service, isCashAgent: r.is_cash_agent,
    })));
    const row = Array.isArray(st) ? st[0] : st;
    setStats(row ? {
      onFloor: row.on_floor, chairs: row.chairs, bookings: row.bookings,
      revenue: row.revenue_cents, shopCut: row.shop_cut_cents,
    } : null);
    setServices((sv as Svc[]) ?? []);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!salon?.id) return;
    supabase.rpc('shop_deposit_pct', { p_salon: salon.id })
      .then(({ data }) => setDepositPct(typeof data === 'number' ? data : null));
  }, [salon?.id, view]);

  // 11a (0064) — the power button used to write `accepting_bookings` directly,
  // and nothing in the booking path read it. Closing now goes through a sheet
  // that says what it covers, and reopening is an RPC because "only you can
  // reopen it" has to be enforced somewhere the barbers can't reach.
  async function reopenShop() {
    if (!salon) return;
    const { error } = await supabase.rpc('reopen_shop');
    if (error) { Alert.alert(tr('Could not reopen'), error.message); return; }
    setSalon({ ...salon, accepting_bookings: true });
  }

  async function toggleService(svc: Svc) {
    setServices((cur) => cur?.map((x) => x.id === svc.id ? { ...x, is_active: !x.is_active } : x) ?? null);
    const { error } = await supabase.from('services').update({ is_active: !svc.is_active }).eq('id', svc.id);
    if (error) { load(); Alert.alert(tr('Could not update'), error.message); }
  }

  // the same order the early returns below run in: the two member screens sit
  // over the hub, every other sub-view returns to it, and the hub itself hands
  // back to Profile.
  useAndroidBack(
    payoutsFor ? () => setPayoutsFor(null)
      : selected ? () => setSelected(null)
        : view !== 'hub' ? () => setView('hub')
          : onBack,
  );

  if (!salon || !team || !stats || !services || !chairs) {
    return <View style={s.center}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (payoutsFor) return <BarberEarnings member={payoutsFor} onBack={() => setPayoutsFor(null)} />;

  // 2c — an approved barber opens the owner's full view of them
  if (selected && selected.status === 'approved') {
    const fresh = team.find((x) => x.id === selected.id) ?? selected;   // load() refreshes team, not selected
    return (
      <>
        <OwnerBarberScreen member={fresh} salon={salon} onBack={() => setSelected(null)}
          onSchedule={() => { setPayoutsFor(fresh); setSelected(null); }}
          onTerms={fresh.role === 'owner' ? undefined : () => setEditTerms(true)}
          onChanged={load} />
        {editTerms && <MemberSheet m={fresh} onClose={() => setEditTerms(false)}
          onChanged={() => { setEditTerms(false); load(); }} />}
      </>
    );
  }

  // ---- turn 2 · the shop screens behind this hub

  if (view === 'dashboard') {
    return <OwnerDashboard salon={salon} team={team} onBack={() => setView('hub')}
      onAllChairs={() => setView('allChairs')} onLines={() => setView('lines')} onReports={() => setView('report')}
      onReviews={() => setView('reviews')} onTeam={() => setView('hub')}
      onBarber={(m) => { setView('hub'); setSelected(m); }} />;
  }
  if (view === 'allChairs') {
    return <AllChairsScreen salon={salon} team={team} onBack={() => setView('hub')}
      onAdd={() => Alert.alert(tr('Add a booking'), tr('Use the + on your own day, or the chair’s own schedule.'))} />;
  }
  if (view === 'lines') return <LinesScreen onBack={() => setView('hub')} />;
  if (view === 'report') return <ShopReportScreen onBack={() => setView('hub')} />;
  if (view === 'reviews') {
    return <ReviewsInboxScreen salon={salon} team={team} onBack={() => setView('hub')} />;
  }
  if (view === 'listing') {
    return <ShopListingScreen salon={salon} onBack={() => setView('hub')}
      onMovePin={() => { setView('hub'); onEditSalon?.(); }}
      onSaved={() => { setView('hub'); load(); }} />;
  }
  if (view === 'poster') return <WalkInPosterScreen salon={salon} onBack={() => setView('hub')} />;
  if (view === 'deposit') return <DepositScreen onBack={() => { setView('hub'); load(); }} />;
  if (view === 'wall') {
    return <WallDisplayScreen salon={salon} team={team} onBack={() => setView('hub')} />;
  }

  const roster = team.filter((m) => m.status === 'approved');
  const pending = team.filter((m) => m.status === 'pending');
  const rated = team.filter((m) => m.reviews > 0);
  const rating = rated.length
    ? rated.reduce((a, m) => a + m.rating * m.reviews, 0) / rated.reduce((a, m) => a + m.reviews, 0)
    : null;

  const shopRows: { icon: IconName; label: string; value?: string; accent?: boolean; onPress: () => void }[] = [
    { icon: 'clock', label: tr('Opening hours'), value: `${hhmm(salon.open_min)} – ${hhmm(salon.close_min)}`, onPress: () => setHoursOpen(true) },
    // OSH-11 — the shop's own deposit (0076). Sits with the shop's other terms,
    // not under Settings, because it is the number customers meet at checkout.
    { icon: 'lock', label: tr('Deposit'), value: depositPct == null ? '—' : depositPct === 0 ? tr('None') : `${depositPct}%`, onPress: () => setView('deposit') },
    { icon: 'map-pin', label: tr('Address & map pin'), value: salon.address ?? tr('Not set'), onPress: () => setView('listing') },
    { icon: 'eye', label: tr('Shop listing'), onPress: () => setView('listing') },
    { icon: 'grid', label: tr('Walk-in QR poster'), value: tr('Print'), accent: true, onPress: () => setView('poster') },
    { icon: 'monitor', label: tr('Wall display'), onPress: () => setView('wall') },
    { icon: 'calendar', label: tr('All chairs'), onPress: () => setView('allChairs') },
    { icon: 'list', label: tr('The lines, live'), onPress: () => setView('lines') },
    { icon: 'star', label: tr('Reviews'), onPress: () => setView('reviews') },
    { icon: 'trending-up', label: tr('Reports & payouts'), onPress: () => setView('report') },
    { icon: 'percent', label: tr('Default commission'), value: `${100 - salon.default_commission}%`, onPress: () => setDefCommOpen(true) },
    { icon: 'sliders', label: tr('Chairs, services & settings'), onPress: () => setTabs(true) },
  ];

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* 1p header */}
        <View style={s.hubHead}>
          {onBack
            ? <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Go back')}
                style={({ pressed }) => [s.puck38, pressed && s.pressed]}>
                <Ico name="arrow-left" size={16} />
              </Pressable>
            : <View style={s.puck38Ghost} />}
          <T w="b" size={17} style={s.hubTitle} numberOfLines={1}>{salon.name}</T>
          <Pressable onPress={() => setView('listing')} hitSlop={8} accessibilityRole="button"
            accessibilityLabel={tr('Edit the shop listing')}
            style={({ pressed }) => [s.puck38, pressed && s.pressed]}>
            <Ico name="edit-2" size={16} />
          </Pressable>
        </View>

        {/* today, at a glance — tap through to the owner dashboard */}
        <Pressable onPress={() => setView('dashboard')} accessibilityRole="button"
          accessibilityLabel={tr('Owner dashboard')} style={({ pressed }) => [s.hubTiles, pressed && s.pressed]}>
          <HubTile label={tr('BOOKINGS')} value={String(stats.bookings)} />
          <HubTile label={tr('REVENUE')} value={String(Math.round(stats.revenue / 100))} unit={tr('DH')} />
          <HubTile label={tr('RATING')} value={rating ? rating.toFixed(1) : '—'} unit={rating ? '★' : undefined} />
        </Pressable>

        <Eyebrow ls={1.65}>{tr('THE TEAM · TODAY')}</Eyebrow>
        <View style={{ gap: 9 }}>
          {roster.map((m) => (
            <Pressable key={m.id} onPress={() => setSelected(m)} accessibilityRole="button"
              accessibilityLabel={m.name}
              style={({ pressed }) => [s.teamRow, pressed && s.pressed]}>
              <View style={s.teamAvatar}>
                <Text style={s.avatarText}>{initials(m.name)}</Text>
                <View style={[s.presence, { backgroundColor: m.inService ? D.green : m.todayBookings ? D.green : D.muted }]} />
              </View>
              <View style={s.grow}>
                <View style={s.rowCenter}>
                  <T w="b" size={14}>{m.name}</T>
                  {m.role === 'owner' && (
                    <View style={s.ownerChip}><T w="b" size={9} c={colors.accent} ls={0.7}>{tr('OWNER')}</T></View>
                  )}
                </View>
                <T size={11} c={D.sub} style={{ marginTop: 3 }}>
                  {m.todayBookings
                    ? tr('In the shop · {todayBookings} today{x}', { todayBookings: m.todayBookings, x: m.todayRevenue != null ? ` · ${dh(m.todayRevenue)}` : '' })
                    : m.pay === 'rent' ? tr('Rent chair') : tr('Nothing booked today')}
                </T>
              </View>
              <Ico name="chevron-right" size={14} color={D.muted} />
            </Pressable>
          ))}
          {pending.map((m) => (
            <Pressable key={m.id} onPress={() => setSelected(m)} accessibilityRole="button"
              accessibilityLabel={tr('{name}, join request', { name: m.name })}
              style={({ pressed }) => [s.teamRow, s.teamRowPending, pressed && s.pressed]}>
              <View style={s.teamAvatar}><Text style={s.avatarText}>{initials(m.name)}</Text></View>
              <View style={s.grow}>
                <T w="b" size={14}>{m.name}</T>
                <T size={11} c={colors.star} style={{ marginTop: 3 }}>{tr('Wants to join — tap to review')}</T>
              </View>
              <Ico name="chevron-right" size={14} color={D.muted} />
            </Pressable>
          ))}
          <Pressable onPress={() => setInvite(true)} accessibilityRole="button"
            accessibilityLabel={tr('Invite a barber to the shop')}
            style={({ pressed }) => [s.inviteRow, pressed && s.pressed]}>
            <View style={s.invitePuck}><Ico name="plus" size={16} color={D.sub} /></View>
            <T w="sb" size={13} c={D.sub} style={s.grow}>{tr('Invite a barber to the shop')}</T>
          </Pressable>
        </View>

        <Eyebrow ls={1.65}>{tr('SHOP')}</Eyebrow>
        <View style={s.shopList}>
          {shopRows.map((r, i) => (
            <Pressable key={r.label} onPress={r.onPress} accessibilityRole="button"
              accessibilityLabel={r.label}
              style={({ pressed }) => [s.shopRow, i < shopRows.length - 1 && s.shopRowLine, pressed && s.pressed]}>
              <View style={s.shopIcon}><Ico name={r.icon} size={15} /></View>
              <T w="sb" size={13} style={s.grow}>{r.label}</T>
              {r.value ? (
                <T w={r.accent ? 'sb' : 'r'} size={12} c={r.accent ? colors.accent : D.sub}>{r.value}</T>
              ) : null}
              <Ico name="chevron-right" size={14} color={D.muted} />
            </Pressable>
          ))}
        </View>

        <View style={s.hubNote}>
          <Ico name="info" size={14} color={D.sub} />
          <T size={12} c={D.sub} style={s.hubNoteText}>
            {tr('Money is paid at the shop today. Settlements are recorded here, not moved.')}
          </T>
        </View>
      </ScrollView>

      {/* the original tabbed detail, kept behind one row */}
      <Modal visible={tabs} animationType="slide" onRequestClose={() => setTabs(false)}>
        <View style={s.screen}>
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            <View style={s.topRow}>
              <Pressable onPress={() => setTabs(false)} hitSlop={8} accessibilityRole="button"
                accessibilityLabel={tr('Close')} style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                <Ionicons name="arrow-back" size={18} color={D.text} />
              </Pressable>
              <View style={s.grow}>
                <Text style={s.overline}>{tr('SALON')}</Text>
                <Text style={s.title} numberOfLines={1}>{salon.name}</Text>
              </View>
            </View>

            <View style={s.segment}>
              {(['team', 'chairs', 'services', 'settings'] as const).map((k) => (
                <Pressable key={k} onPress={() => setSeg(k)} accessibilityState={{ selected: seg === k }}
                  style={[s.segItem, seg === k && s.segItemOn]}>
                  <Text style={[s.segText, seg === k && s.segTextOn]}>{k.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>

            <ShopHeader salon={salon} stats={stats}
              onPower={() => (salon.accepting_bookings ? setPauseOpen(true) : reopenShop())} />

            {seg === 'team' && <TeamTab team={team} onOpen={setSelected} onInvite={() => setInvite(true)} />}
            {seg === 'chairs' && (
              <ChairsTab chairs={chairs} onOpen={setChairEdit} onAdd={() => setChairEdit('new')} />
            )}
            {seg === 'services' && (
              <ServicesTab services={services} onToggle={toggleService} onManage={onManageServices} />
            )}
            {seg === 'settings' && (
              <SettingsTab salon={salon}
                onEditSalon={onEditSalon} onSalonHours={() => setHoursOpen(true)}
                onDefaultCommission={() => setDefCommOpen(true)} />
            )}
          </ScrollView>
        </View>
      </Modal>

      {selected && selected.status === 'pending' && (
        <MemberSheet m={selected} onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); load(); }} />
      )}
      {chairEdit && (
        <ChairSheet chair={chairEdit === 'new' ? null : chairEdit} team={team}
          onClose={() => setChairEdit(null)} onChanged={() => { setChairEdit(null); load(); }} />
      )}
      {invite && (
        <InviteSheet salon={salon} pending={pending} onClose={() => setInvite(false)} onChanged={load} />
      )}
      {defCommOpen && (
        <DefaultCommissionSheet salon={salon} onClose={() => setDefCommOpen(false)}
          onSaved={() => { setDefCommOpen(false); load(); }} />
      )}
      {hoursOpen && (
        <SalonHoursSheet salon={salon} onClose={() => setHoursOpen(false)}
          onSaved={() => { setHoursOpen(false); load(); }} />
      )}
      {/* 11a — what closing actually covers, counted rather than promised */}
      <ShopPauseSheet visible={pauseOpen} onClose={() => setPauseOpen(false)}
        onClosed={() => { setSalon({ ...salon, accepting_bookings: false }); load(); }} />
    </View>
  );
}

function HubTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={s.hubTile}>
      <Eyebrow ls={0.8}>{label}</Eyebrow>
      <T w="b" size={20} style={s.tnum}>
        {value}{unit ? <T w="r" size={11} c={D.sub}>{` ${unit}`}</T> : null}
      </T>
    </View>
  );
}

function ShopHeader({ salon, stats, onPower }: {
  salon: SalonMeta; stats: Stats; onPower: () => void;
}) {
  const open = salon.accepting_bookings;
  return (
    <View style={s.shopCard}>
      <View style={s.rowCenter}>
        <View style={[s.dot, { backgroundColor: open ? OPEN : D.sub }]} />
        <Text style={s.shopStatus}>{open ? tr('SHOP OPEN') : tr('SHOP CLOSED')}</Text>
        <View style={s.grow} />
        {/* 11a — closing opens the sheet that spells out what it covers; there
            is nothing to confirm on the way back in, so reopening is one tap. */}
        <Pressable onPress={onPower}
          accessibilityLabel={open ? tr('Close shop') : tr('Open shop')}
          style={({ pressed }) => [s.powerBtn, !open && s.powerBtnOff, pressed && s.pressed]}>
          <Ionicons name="power" size={18} color={open ? colors.onAccent : D.text} />
        </Pressable>
      </View>
      {!!salon.address && (
        <View style={s.rowCenter}>
          <Ionicons name="location-outline" size={13} color={D.sub} />
          <Text style={s.shopAddr}>{salon.address}</Text>
        </View>
      )}
      <View style={s.statRow}>
        <Stat label={tr('ON FLOOR')} value={`${stats.onFloor}/${stats.chairs}`} />
        <Stat label={tr('BOOKINGS')} value={String(stats.bookings)} />
        <Stat label={tr('REVENUE')} value={dh(stats.revenue)} accent />
        <Stat label={tr('SHOP CUT')} value={dh(stats.shopCut)} />
      </View>
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[s.statTile, accent && s.statTileAccent]}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function TeamTab({ team, onOpen, onInvite }: {
  team: Member[]; onOpen: (m: Member) => void; onInvite: () => void;
}) {
  const pending = team.filter((m) => m.status === 'pending').length;
  return (
    <>
      <SectionHead label={trn(team.length, 'TEAM · {n} CHAIR', 'TEAM · {n} CHAIRS')}
        action={tr('Invite')} onAction={onInvite} />
      {pending > 0 && (
        <Text style={s.pendingHint}>{trn(pending, '{n} join request — tap to review', '{n} join requests — tap to review')}</Text>
      )}
      {team.map((m) => (
        <Pressable key={m.id} onPress={() => onOpen(m)} accessibilityLabel={m.name}
          style={({ pressed }) => [s.memberRow, pressed && s.pressed]}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials(m.name)}</Text>
            <View style={[s.presence, { backgroundColor: statusColor(m) }]} />
          </View>
          <View style={s.grow}>
            <View style={s.rowCenter}>
              <Text style={s.memberName}>{m.name}</Text>
              {m.isCashAgent && <Text style={s.crown}>👑</Text>}
            </View>
            <Text style={s.memberMeta}>
              {cap(m.role)}{m.chair ? ` · ${m.chair}` : ''}
            </Text>
          </View>
          <View style={s.memberRight}>
            <Text style={[s.statusPill, { color: statusColor(m) }]}>● {statusLabel(m)}</Text>
            <Text style={s.memberSplit}>{m.pay === 'rent' ? tr('Rent') : tr('{split}% split', { split: m.split })}</Text>
          </View>
        </Pressable>
      ))}
    </>
  );
}

function ChairsTab({ chairs, onOpen, onAdd }: {
  chairs: Chair[]; onOpen: (c: Chair) => void; onAdd: () => void;
}) {
  const count = (a: Availability) => chairs.filter((c) => c.availability === a).length;
  return (
    <>
      <SectionHead label={tr('CHAIRS · {count}', { count: chairs.length })} action={tr('Add')} onAction={onAdd} />
      {chairs.length > 0 && (
        <View style={s.chairSummary}>
          {(['open', 'busy', 'off', 'empty'] as const).filter((a) => count(a) > 0).map((a) => (
            <View key={a} style={s.rowCenterTight}>
              <View style={[s.dot, { backgroundColor: AVAIL[a].c }]} />
              <Text style={s.summaryText}>{count(a)} {AVAIL[a].t.toLowerCase()}</Text>
            </View>
          ))}
        </View>
      )}
      {chairs.length === 0 && <Text style={s.emptyHint}>{tr('No chairs yet — tap Add to set up your floor.')}</Text>}
      <View style={s.chairGrid}>
        {chairs.map((c) => (
          <Pressable key={c.id} onPress={() => onOpen(c)} accessibilityLabel={`${c.label}, ${AVAIL[c.availability].t}`}
            style={({ pressed }) => [s.chairCard, pressed && s.pressed]}>
            <View style={s.rowCenter}>
              <Ionicons name="cut-outline" size={15} color={D.sub} />
              <Text style={s.chairLabel}>{c.label}</Text>
              <View style={s.grow} />
              <View style={[s.dot, { backgroundColor: AVAIL[c.availability].c }]} />
            </View>
            {c.barberId ? (
              <View style={s.rowCenter}>
                <View style={s.chairAvatar}><Text style={s.chairAvatarText}>{initials(c.barberName ?? '?')}</Text></View>
                <Text style={s.chairOccupant} numberOfLines={1}>{c.barberName}</Text>
              </View>
            ) : (
              c.asks > 0
                ? <Text style={[s.chairEmpty, { color: colors.accent }]}>{trn(c.asks, '{n} barber asked — tap to answer', '{n} barbers asked — tap to answer')}</Text>
                : c.listedAt
                  ? <Text style={[s.chairEmpty, { color: colors.accent }]}>{tr('Looking for a barber')}</Text>
                  : <Text style={s.chairEmpty}>{tr('Empty — tap to assign')}</Text>
            )}
            <Text style={[s.chairAvail, { color: AVAIL[c.availability].c }]}>{AVAIL[c.availability].t}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function ChairSheet({ chair, team, onClose, onChanged }: {
  chair: Chair | null; team: Member[]; onClose: () => void; onChanged: () => void;
}) {
  const [label, setLabel] = useState(chair?.label ?? '');
  const [busy, setBusy] = useState(false);
  // 0142 — what the empty chair asks, and whether other barbers see it
  const [rent, setRent] = useState(chair?.rentCents != null ? String(Math.round(chair.rentCents / 100)) : '');
  const [period, setPeriod] = useState<'week' | 'month'>(chair?.rentPeriod ?? 'month');
  const [note, setNote] = useState(chair?.note ?? '');
  const [listed, setListed] = useState(!!chair?.listedAt);
  const [asks, setAsks] = useState<Ask[]>([]);
  useEffect(() => {
    if (!chair || chair.barberId || !chair.asks) return;
    supabase.rpc('salon_chair_asks', { p_chair: chair.id }).then(({ data }) => setAsks((data as Ask[] | null) ?? []));
  }, [chair?.id]);
  // RVW-12 — the barber in it came through Chairs for rent: when, and who heard (0146)
  const [taken, setTaken] = useState<{ answered_at: string; told: number | null } | null>(null);
  useEffect(() => {
    if (!chair?.barberId) return;
    supabase.from('chair_asks').select('answered_at, told')
      .eq('chair_id', chair.id).eq('barber_id', chair.barberId).eq('answer', 'taken')
      .order('answered_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setTaken(data as { answered_at: string; told: number | null } | null));
  }, [chair?.id, chair?.barberId]);
  const members = team.filter((m) => m.status === 'approved');
  const ask = rent ? Number(rent) * 100 : null;
  const askDirty = !!chair && (ask !== chair.rentCents || period !== chair.rentPeriod
    || note.trim() !== (chair.note ?? '') || listed !== !!chair.listedAt);

  async function call(fn: string, args: object) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return Alert.alert(tr('Could not update'), error.message);
    onChanged();
  }

  // create mode
  if (!chair) {
    return (
      <Sheet onClose={onClose}>
        <Text style={s.sheetTitle}>{tr('Add chair')}</Text>
        <Text style={s.fieldLabel}>{tr('LABEL')}</Text>
        <TextInput value={label} onChangeText={setLabel} placeholder={tr('Chair 01')}
          placeholderTextColor={D.sub} style={s.input} autoFocus />
        <Pressable disabled={busy} onPress={() => label.trim() && call('salon_add_chair', { p_label: label.trim() })}
          style={({ pressed }) => [s.cta, pressed && s.pressed]}>
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.ctaText}>{tr('Add chair')}</Text>}
        </Pressable>
      </Sheet>
    );
  }

  // edit mode: rename, assign, delete
  return (
    <Sheet onClose={onClose}>
      <View style={s.rowCenter}>
        <TextInput value={label} onChangeText={setLabel} style={s.chairNameInput} />
        <Pressable disabled={busy || label.trim() === chair.label} accessibilityLabel={tr('Rename chair')}
          onPress={() => call('salon_rename_chair', { p_chair: chair.id, p_label: label.trim() })}
          style={({ pressed }) => [s.iconBtn, (label.trim() === chair.label) && s.dimBtn, pressed && s.pressed]}>
          <Ionicons name="checkmark" size={18} color={colors.accent} />
        </Pressable>
        <Pressable disabled={busy} accessibilityLabel={tr('Delete chair')}
          onPress={() => Alert.alert(tr('Delete chair?'), tr('{label} will be removed.', { label: chair.label }),
            [{ text: tr('Cancel'), style: 'cancel' },
             { text: tr('Delete'), style: 'destructive', onPress: () => call('salon_delete_chair', { p_chair: chair.id }) }])}
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
        </Pressable>
      </View>

      {taken && (
        <Text style={s.pendingBody}>
          {taken.told
            ? trn(taken.told, 'Taken on {date} from Chairs for rent · {n} of his customers was told where he went, once',
                'Taken on {date} from Chairs for rent · {n} of his customers were told where he went, once', { date: dayMonth(taken.answered_at) })
            : tr('Taken on {date} from Chairs for rent', { date: dayMonth(taken.answered_at) })}
        </Text>
      )}
      {/* BRB-30 — an empty chair can be offered to barbers looking for one */}
      {!chair.barberId && (
        <>
          {chair.vacantSince && (
            <Text style={s.pendingBody}>{tr('Empty since {date}', { date: dayMonth(chair.vacantSince) })}</Text>
          )}
          {/* 0144 — barbers who asked for it in the app */}
          {asks.length > 0 && <Text style={s.fieldLabel}>{tr('ASKED FOR IT · {n}', { n: asks.length })}</Text>}
          {asks.map((a) => (
            <View key={a.ask_id} style={s.listRow}>
              <View style={s.grow}>
                <Text style={s.assignName}>{a.full_name}</Text>
                <Text style={s.setSub}>{[
                  a.reviews_count ? `★ ${Number(a.rating).toFixed(1)} (${a.reviews_count})` : null,
                  trn(a.cuts, '{n} cut on Sterncut', '{n} cuts on Sterncut'),
                  a.shop_name ? tr('at {shop}', { shop: a.shop_name }) : tr('no shop now'),
                ].filter(Boolean).join(' · ')}</Text>
              </View>
              {!!a.phone && (
                <Pressable onPress={() => Linking.openURL(`tel:${a.phone}`)} accessibilityLabel={tr('Call {name}', { name: a.full_name })}
                  style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                  <Ionicons name="call-outline" size={17} color={D.text} />
                </Pressable>
              )}
              <Pressable disabled={busy} accessibilityLabel={tr('Take {name} on', { name: a.full_name })}
                onPress={() => Alert.alert(tr('Take {name} on for {chair}?', { name: a.full_name, chair: chair.label }),
                  a.shop_name
                    ? tr('He leaves {shop} and sits in {chair} from today, on the rent this chair asks. His terms can be changed after.', { shop: a.shop_name, chair: chair.label })
                    : tr('He sits in {chair} from today, on the rent this chair asks. His terms can be changed after.', { chair: chair.label }),
                  [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Take on'), onPress: () => call('take_chair_ask', { p_ask: a.ask_id }) }])}
                style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                <Ionicons name="checkmark" size={18} color={colors.accent} />
              </Pressable>
              <Pressable disabled={busy} accessibilityLabel={tr('Say no to {name}', { name: a.full_name })}
                onPress={() => Alert.alert(tr('Say no to {name}?', { name: a.full_name }), tr('He is told, and can still ask for your other chairs.'),
                  [{ text: tr('Cancel'), style: 'cancel' },
                   { text: tr('Say no'), style: 'destructive', onPress: () => call('decline_chair_ask', { p_ask: a.ask_id }) }])}
                style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                <Ionicons name="close" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
          <Text style={s.fieldLabel}>{tr('CHAIR RENT (DH)')}</Text>
          <TextInput value={rent} onChangeText={(v) => setRent(v.replace(/\D/g, ''))}
            keyboardType="number-pad" maxLength={6} placeholder={tr('Not said')} placeholderTextColor={D.sub}
            accessibilityLabel={tr('Chair rent in dirhams')} style={s.input} />
          <PeriodPick value={period} onChange={setPeriod} />
          <Text style={s.fieldLabel}>{tr('WHAT COMES WITH IT')}</Text>
          <TextInput value={note} onChangeText={setNote} multiline maxLength={280}
            placeholder={tr('Products, days off, the hours you open…')} placeholderTextColor={D.sub}
            accessibilityLabel={tr('What comes with the chair')} style={[s.input, s.noteInput]} />
          <View style={s.listRow}>
            <View style={s.grow}>
              <Text style={s.setTitle}>{tr('Look for a barber')}</Text>
              <Text style={s.setSub}>{tr('Barbers on Sterncut see this chair, your shop and your phone number, to call you about it.')}</Text>
            </View>
            <Switch value={listed} onValueChange={setListed} accessibilityLabel={tr('Look for a barber')}
              trackColor={{ true: colors.accent, false: D.card2 }} thumbColor="#fff" />
          </View>
          {askDirty && (
            <Pressable disabled={busy} onPress={() => call('salon_set_chair', {
              p_chair: chair.id, p_rent_cents: ask, p_rent_period: period, p_note: note, p_listed: listed,
            })} style={({ pressed }) => [s.cta, pressed && s.pressed]}>
              {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.ctaText}>{tr('Save chair')}</Text>}
            </Pressable>
          )}
        </>
      )}

      <Text style={s.fieldLabel}>{tr('ASSIGN A BARBER')}</Text>
      <Pressable disabled={busy} onPress={() => call('salon_assign_chair', { p_chair: chair.id, p_barber: null })}
        style={({ pressed }) => [s.assignRow, !chair.barberId && s.assignRowOn, pressed && s.pressed]}>
        <View style={[s.chairAvatar, s.emptySlot]}><Ionicons name="remove" size={16} color={D.sub} /></View>
        <Text style={s.assignName}>{tr('Leave empty')}</Text>
        {!chair.barberId && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
      </Pressable>
      {members.map((m) => {
        const on = m.id === chair.barberId;
        return (
          <Pressable key={m.id} disabled={busy}
            onPress={() => call('salon_assign_chair', { p_chair: chair.id, p_barber: m.id })}
            style={({ pressed }) => [s.assignRow, on && s.assignRowOn, pressed && s.pressed]}>
            <View style={s.chairAvatar}><Text style={s.chairAvatarText}>{initials(m.name)}</Text></View>
            <Text style={s.assignName}>{m.name}</Text>
            {on && <Ionicons name="checkmark-circle" size={20} color={colors.accent} />}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

function ServicesTab({ services, onToggle, onManage }: {
  services: Svc[]; onToggle: (s: Svc) => void; onManage?: () => void;
}) {
  const live = services.filter((x) => x.is_active).length;
  return (
    <>
      <SectionHead label={tr('MENU · {live} LIVE', { live })} action={tr('Manage')} onAction={onManage} />
      {services.length === 0 && <Text style={s.emptyHint}>{tr('No services yet — tap Manage to add your first.')}</Text>}
      {services.map((x) => (
        <View key={x.id} style={s.menuRow}>
          <View style={s.menuIcon}><Ionicons name="cut" size={18} color={colors.accent} /></View>
          <View style={s.grow}>
            <Text style={[s.menuName, !x.is_active && s.dim]}>{x.name}</Text>
            <Text style={s.menuMeta}>{x.duration_min}m · {dh(x.price_cents)}</Text>
          </View>
          <Switch value={x.is_active} onValueChange={() => onToggle(x)}
            trackColor={{ true: colors.accent, false: D.card2 }} thumbColor="#fff" />
        </View>
      ))}
      {/* bundles are real (0047) and live in Profile → My Bundles; the mock that sat here went */}
    </>
  );
}

const SET_ROWS = (salon: SalonMeta) => ([
  { icon: 'business-outline', title: tr('Salon profile'), sub: tr('Name, address, photos'), key: 'profile' },
  { icon: 'time-outline', title: tr('Opening hours'),
    sub: salon.open_min === 0 && salon.close_min === 1440
      ? tr('All day — tap to set a window')
      : tr('{open_min} – {close_min} · barbers set theirs within', { open_min: hhmm(salon.open_min), close_min: hhmm(salon.close_min) }), key: 'hours' },
  { icon: 'pricetag-outline', title: tr('Default commission'), sub: tr('{default_commission}% to barber', { default_commission: salon.default_commission }), key: 'commission' },
  // Roles & permissions, Payouts & taxes and Reports opened a "coming soon" — no
  // rows until the owner pages build them (BACKLOG, Owner: salon management)
] as { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; key: string }[]);

function SettingsTab({ salon, onEditSalon, onSalonHours, onDefaultCommission }: {
  salon: SalonMeta;
  onEditSalon?: () => void; onSalonHours: () => void; onDefaultCommission: () => void;
}) {
  const press = (key: string) => key === 'profile' ? onEditSalon?.()
    : key === 'hours' ? onSalonHours() : onDefaultCommission();
  return (
    <View style={s.settingsCard}>
      {SET_ROWS(salon).map((r, i) => (
        <Pressable key={r.title} onPress={() => press(r.key)} accessibilityLabel={r.title}
          style={({ pressed }) => [s.setRow, i > 0 && s.setRowBorder, pressed && s.pressed]}>
          <View style={s.setIcon}><Ionicons name={r.icon} size={18} color={colors.accent} /></View>
          <View style={s.grow}>
            <Text style={s.setTitle}>{r.title}</Text>
            <Text style={s.setSub}>{r.sub}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={D.sub} />
        </Pressable>
      ))}
    </View>
  );
}

function SectionHead({ label, action, onAction }: { label: string; action: string; onAction?: () => void }) {
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionLabel}>{label}</Text>
      <View style={s.grow} />
      {onAction && (
        <Pressable onPress={onAction} accessibilityLabel={action}
          style={({ pressed }) => [s.addBtn, pressed && s.pressed]}>
          <Ionicons name="add" size={16} color={colors.onAccent} />
          <Text style={s.addText}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

const cap = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

// ── Member detail sheet ───────────────────────────────────────────────────────
// pending → approve / decline; approved → pay terms, opened from 2c's rate row
function MemberSheet({ m, onClose, onChanged }: {
  m: Member; onClose: () => void; onChanged: () => void;
}) {
  const [pay, setPay] = useState<PayModel>(m.pay);
  const [split, setSplit] = useState(m.split);
  const [rent, setRent] = useState(m.rent ? String(Math.round(m.rent / 100)) : '');   // whole DH
  const [period, setPeriod] = useState(m.period);
  const [busy, setBusy] = useState(false);
  const rentCents = Number(rent || 0) * 100;
  const dirty = pay !== m.pay
    || (pay === 'commission' ? split !== m.split : rentCents !== m.rent || period !== m.period);

  async function call(fn: string, args: object, ok?: string) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return Alert.alert(tr('Could not update'), error.message);
    if (ok) Alert.alert(tr('Done'), ok);
    onChanged();
  }

  const saveTerms = () => call('salon_set_terms', {
    p_barber: m.id, p_salon_role: m.role, p_pay_model: pay,
    p_commission_pct: split, p_rent_cents: pay === 'rent' ? rentCents : m.rent, p_chair: m.chair ?? '',
    p_rent_period: pay === 'rent' ? period : null,   // null keeps it (0142)
  });

  return (
    <Sheet onClose={onClose}>
      <View style={s.sheetHead}>
        <View style={s.sheetAvatar}>
          <Text style={s.sheetAvatarText}>{initials(m.name)}</Text>
          <View style={[s.presence, { backgroundColor: statusColor(m) }]} />
        </View>
        <View style={s.grow}>
          <View style={s.rowCenter}>
            <Text style={s.sheetName}>{m.name}</Text>
            {m.isCashAgent && <Text style={s.crown}>👑</Text>}
          </View>
          <Text style={s.memberMeta}>{cap(m.role)}{m.chair ? ` · ${m.chair}` : ''}</Text>
        </View>
        <Text style={[s.statusPill, { color: statusColor(m) }]}>● {statusLabel(m)}</Text>
      </View>

      {m.status === 'pending' ? (
        <>
          <Text style={s.pendingBody}>{tr('This barber asked to join your salon. Approve to add them to the floor and your public page, or decline to remove the request.')}</Text>
          <View style={s.actionGrid}>
            <Pressable disabled={busy} onPress={() => call('salon_approve_member', { p_barber: m.id }, `${m.name} added to the team.`)}
              style={({ pressed }) => [s.approveBtn, pressed && s.pressed]}>
              <Ionicons name="checkmark" size={16} color={colors.onAccent} />
              <Text style={s.approveText}>{tr('Approve')}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => call('salon_remove_member', { p_barber: m.id })}
              style={({ pressed }) => [s.declineBtn, pressed && s.pressed]}>
              <Ionicons name="close" size={16} color={colors.danger} />
              <Text style={s.declineText}>{tr('Decline')}</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={s.fieldLabel}>{tr('PAY MODEL')}</Text>
          <Segmented options={[tr('Commission'), tr('Rent')]}
            value={pay === 'commission' ? tr('Commission') : tr('Rent')}
            onChange={(v) => setPay(v === tr('Commission') ? 'commission' : 'rent')} />

          {pay === 'commission' ? (
            <>
              <View style={s.rowCenter}>
                <Text style={s.fieldLabel}>{tr('COMMISSION SPLIT')}</Text>
                <View style={s.grow} />
                <Text style={s.splitValue}>{split}% <Text style={s.splitMuted}>{tr('/ {x}% shop', { x: 100 - split })}</Text></Text>
              </View>
              <Split value={split} onChange={setSplit} editable />
            </>
          ) : (
            <>
              <Text style={s.fieldLabel}>{tr('CHAIR RENT (DH)')}</Text>
              <TextInput value={rent} onChangeText={(v) => setRent(v.replace(/\D/g, ''))}
                keyboardType="number-pad" maxLength={6} placeholder="0" placeholderTextColor={D.sub}
                accessibilityLabel={tr('Chair rent in dirhams')} style={s.input} />
              <PeriodPick value={period} onChange={setPeriod} />
              <View style={s.rentRow}>
                <Ionicons name="home-outline" size={16} color={D.sub} />
                <Text style={s.rentText}>{tr('Rents the chair — keeps 100%, revenue stays private.')}</Text>
              </View>
            </>
          )}

          {dirty && (
            <Pressable disabled={busy} onPress={saveTerms}
              style={({ pressed }) => [s.cta, pressed && s.pressed]}>
              {busy ? <ActivityIndicator color={colors.onAccent} />
                : <Text style={s.ctaText}>{tr('Save pay terms')}</Text>}
            </Pressable>
          )}
        </>
      )}
    </Sheet>
  );
}

function DefaultCommissionSheet({ salon, onClose, onSaved }: {
  salon: SalonMeta; onClose: () => void; onSaved: () => void;
}) {
  const [pct, setPct] = useState(salon.default_commission);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const { error } = await supabase.from('salons').update({ default_commission: pct }).eq('id', salon.id);
    setBusy(false);
    if (error) return Alert.alert(tr('Could not save'), error.message);
    onSaved();
  }
  return (
    <Sheet onClose={onClose}>
      <Text style={s.sheetTitle}>{tr('Default commission')}</Text>
      <Text style={s.memberMeta}>{tr('Applied to new commission barbers as their starting split.')}</Text>
      <View style={s.rowCenter}>
        <Text style={s.fieldLabel}>{tr('TO BARBER')}</Text>
        <View style={s.grow} />
        <Text style={s.splitValue}>{pct}% <Text style={s.splitMuted}>{tr('/ {x}% shop', { x: 100 - pct })}</Text></Text>
      </View>
      <Split value={pct} onChange={setPct} editable />
      <Pressable disabled={busy} onPress={save} style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.ctaText}>{tr('Save')}</Text>}
      </Pressable>
    </Sheet>
  );
}

// Salon opening-hours envelope (0028). Barbers set their own hours within this.
function SalonHoursSheet({ salon, onClose, onSaved }: {
  salon: SalonMeta; onClose: () => void; onSaved: () => void;
}) {
  const [open, setOpen] = useState(salon.open_min);
  const [close, setClose] = useState(salon.close_min);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (close <= open) return Alert.alert(tr('Invalid hours'), tr('Closing must be after opening.'));
    setBusy(true);
    const { error } = await supabase.from('salons')
      .update({ open_min: open, close_min: close }).eq('id', salon.id);
    setBusy(false);
    if (error) return Alert.alert(tr('Could not save'), error.message);
    onSaved();
  }
  return (
    <Sheet onClose={onClose}>
      <Text style={s.sheetTitle}>{tr('Opening hours')}</Text>
      <Text style={s.memberMeta}>{tr('Barbers can only set their own hours inside this window.')}</Text>
      <HourStepper label={tr('Opens')} value={open} min={0} max={close - 30} onChange={setOpen} />
      <HourStepper label={tr('Closes')} value={close} min={open + 30} max={1440} onChange={setClose} />
      {open === 0 && close === 1440 && (
        <Text style={s.emptyHint}>{tr('Currently all-day — no limit on barber hours until you narrow it.')}</Text>
      )}
      <Pressable disabled={busy} onPress={save} style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.ctaText}>{tr('Save hours')}</Text>}
      </Pressable>
    </Sheet>
  );
}

function HourStepper({ label, value, min, max, onChange }: {
  label: string; value: number; min: number; max: number; onChange: (v: number) => void;
}) {
  const step = (d: number) => { const n = value + d; if (n >= min && n <= max) onChange(n); };
  return (
    <View style={s.hoursRow}>
      <Text style={s.hoursLabel}>{label}</Text>
      <View style={s.grow} />
      <Pressable onPress={() => step(-30)} hitSlop={6} accessibilityLabel={tr('{label} earlier', { label })}
        style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}>
        <Ionicons name="remove" size={16} color={D.text} />
      </Pressable>
      <Text style={s.hoursValue}>{hhmm(value)}</Text>
      <Pressable onPress={() => step(30)} hitSlop={6} accessibilityLabel={tr('{label} later', { label })}
        style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}>
        <Ionicons name="add" size={16} color={D.text} />
      </Pressable>
    </View>
  );
}

// ── Invite sheet — MOCK. Real membership = barber self-joins at onboarding → lands
// pending → owner approves in Team. Invite-by-phone/share link need the brber.ma
// web surface (adoption bet #1); pay terms are set post-approval in the member sheet.
// 2d — Invite a barber. The shop code is derived from the salon id so it is
// stable and shareable today; onboarding still works by picking the salon, so
// SEND INVITE says what actually happens rather than pretending.
function shopCode(salon: SalonMeta) {
  const word = salon.name.replace(/[^a-z]/gi, '').slice(0, 4).toUpperCase() || tr('SHOP');
  const n = salon.id.replace(/\D/g, '').slice(-2) || '01';
  return `${word}·${n}`;
}

function InviteSheet({ salon, pending, onClose, onChanged }: {
  salon: SalonMeta; pending: Member[]; onClose: () => void; onChanged: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [pct, setPct] = useState(100 - salon.default_commission);
  const [busy, setBusy] = useState(false);
  const code = shopCode(salon);

  async function saveDefault(next: number) {
    setPct(next);
    setBusy(true);
    // the chips set the shop's starting split, which is real (0025)
    const { error } = await supabase.from('salons')
      .update({ default_commission: 100 - next }).eq('id', salon.id);
    setBusy(false);
    if (error) Alert.alert(tr('Could not save'), error.message);
    else onChanged();
  }

  return (
    <Sheet onClose={onClose}>
      <View style={s.rowCenter}>
        <Text style={[s.sheetTitle, s.grow]}>{tr('Invite a barber')}</Text>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={tr('Close')}
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
          <Ionicons name="close" size={18} color={D.text} />
        </Pressable>
      </View>

      <T size={13} c={D.sub} style={{ lineHeight: 20 }}>
        {tr('He installs Sterncut, picks {name} with this code, and his chair appears here as a request to approve. You keep control of hours and commission.', { name: salon.name })}
      </T>

      <View style={s.codeCard}>
        <Eyebrow ls={1.8}>{tr('SHOP CODE')}</Eyebrow>
        <Text style={s.codeValue}>{code}</Text>
        <View style={s.codeBtns}>
          <Pressable onPress={() => Alert.alert(tr('Shop code'), code)} accessibilityRole="button"
            accessibilityLabel={tr('Show the shop code')}
            style={({ pressed }) => [s.codeBtn, pressed && s.pressed]}>
            <Ico name="copy" size={14} />
            <T w="b" size={12}>{tr('Copy')}</T>
          </Pressable>
          <Pressable onPress={() => Share.share({
            message: tr('Join {salon} on Sterncut — shop code {code}', { salon: salon.name, code }),
          })} accessibilityRole="button" accessibilityLabel={tr('Share the shop code')}
            style={({ pressed }) => [s.codeBtn, pressed && s.pressed]}>
            <Ico name="send" size={14} />
            <T w="b" size={12}>{tr('Share')}</T>
          </Pressable>
        </View>
      </View>

      <View style={s.orRow}>
        <View style={s.orLine} />
        <T w="b" size={11} c={D.sub} ls={1.4}>{tr('OR BY PHONE')}</T>
        <View style={s.orLine} />
      </View>

      <View style={s.phoneField}>
        <Ico name="phone" size={16} color={D.sub} />
        <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad"
          placeholder="+212 6•• ••• •••" placeholderTextColor={D.sub}
          accessibilityLabel={tr('Barber\'s phone number')} style={s.phoneInput} />
      </View>

      <View style={{ gap: 9 }}>
        <Eyebrow ls={1.4}>{tr('STARTING COMMISSION')}</Eyebrow>
        <View style={s.commRow}>
          {[15, 20, 25].map((v) => (
            <Pressable key={v} onPress={() => saveDefault(v)} accessibilityRole="button"
              accessibilityState={{ selected: pct === v }} disabled={busy}
              style={({ pressed }) => [s.commBtn, pct === v && s.commBtnOn, pressed && s.pressed]}>
              <T w={pct === v ? 'b' : 'sb'} size={13} c={pct === v ? '#fff' : D.sub}>{v}%</T>
            </Pressable>
          ))}
          <Pressable onPress={() => Alert.alert(tr('Custom split'),
            tr('Set it per barber once they join — open them from the team list.'))}
            accessibilityRole="button" accessibilityLabel={tr('Custom commission')}
            style={({ pressed }) => [s.commBtn, pressed && s.pressed]}>
            <T w="sb" size={13} c={D.sub}>{tr('Custom')}</T>
          </Pressable>
        </View>
      </View>

      <Pressable onPress={() => {
        const msg = tr('Join {salon} on Sterncut — shop code {code}', { salon: salon.name, code });
        if (phone.trim()) {
          const sep = Platform.OS === 'ios' ? '&' : '?';
          Linking.openURL(`sms:${phone.trim()}${sep}body=${encodeURIComponent(msg)}`)
            .catch(() => Share.share({ message: msg }));
        } else {
          Share.share({ message: msg });
        }
      }} accessibilityRole="button" accessibilityLabel={tr('Send invite')}
        style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        <Ionicons name="paper-plane" size={16} color={colors.onAccent} />
        <Text style={s.ctaText}>{tr('Send invite')}</Text>
      </Pressable>

      {pending.map((m) => (
        <View key={m.id} style={s.pendingRow}>
          <View style={s.pendingPuck}><T w="b" size={11} c={D.sub}>{initials(m.name)}</T></View>
          <View style={s.grow}>
            <T w="b" size={13}>{m.name}</T>
            <T size={11} c={colors.star} style={{ marginTop: 2 }}>{tr('Waiting for you to approve')}</T>
          </View>
          <T w="b" size={11} c={D.sub}>{tr('Review')}</T>
        </View>
      ))}
    </Sheet>
  );
}

// Per-barber commission statement + payout state. DERIVED from bookings (0027) —
// accrual, not settlement: nothing is "paid" until the Phase 2 payout rail exists,
// so the whole accrual reads as outstanding. Settlements/invoices = honest empty state.
type Period = { start: string; bookings: number; gross: number; barber: number; shop: number };

function weekLabel(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const thisWeek = new Date(now); thisWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  // local days: through UTC, a Casablanca midnight is the previous date and
  // "This week" only ever showed between 00:00 and 01:00
  const same = d.toDateString() === thisWeek.toDateString();
  const date = d.toLocaleDateString(loc('en-US'), { month: 'short', day: 'numeric' });
  return same ? tr('This week · {date}', { date }) : tr('Week of {date}', { date });
}

function BarberEarnings({ member, onBack }: { member: Member; onBack: () => void }) {
  const [rows, setRows] = useState<Period[] | null>(null);

  useEffect(() => {
    if (member.pay !== 'commission') { setRows([]); return; }
    supabase.rpc('salon_barber_earnings', { p_barber: member.id }).then(({ data, error }) => {
      if (error) { Alert.alert(tr('Could not load payouts'), error.message); onBack(); return; }
      setRows((data as any[]).map((r) => ({
        start: r.period_start, bookings: r.bookings, gross: r.gross_cents,
        barber: r.barber_cents, shop: r.shop_cents,
      })));
    });
  }, [member.id]);

  const outstanding = (rows ?? []).reduce((a, r) => a + r.barber, 0);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.topRow}>
          <Pressable onPress={onBack} hitSlop={8} accessibilityLabel={tr('Go back')}
            style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
            <Ionicons name="arrow-back" size={18} color={D.text} />
          </Pressable>
          <View style={s.grow}>
            <Text style={s.overline}>{tr('EARNINGS')}</Text>
            <Text style={s.title} numberOfLines={1}>{member.name}</Text>
          </View>
          <View style={s.spacer} />
        </View>

        {rows === null && <ActivityIndicator color={colors.accent} style={{ marginTop: sp(8) }} />}

        {member.pay === 'rent' && rows !== null && <RentLedger member={member} />}

        {member.pay === 'commission' && rows !== null && (
          <>
            <View style={s.payoutHero}>
              <Text style={s.heroLabel}>{tr('OUTSTANDING · UNSETTLED')}</Text>
              <Text style={s.heroValue}>{dh(outstanding)}</Text>
              <Text style={s.heroNote}>{tr('Owed to {name} at {split}% — accrued from bookings. Nothing is settled in-app yet (pay at shop).', { name: member.name.split(' ')[0], split: member.split })}</Text>
            </View>

            <Text style={s.sectionLabel}>{tr('BY WEEK')}</Text>
            {rows.length === 0 && <Text style={s.emptyHint}>{tr('No bookings in the last 8 weeks.')}</Text>}
            {rows.map((r) => (
              <View key={r.start} style={s.weekRow}>
                <View style={s.grow}>
                  <Text style={s.weekLabel}>{weekLabel(r.start)}</Text>
                  <Text style={s.weekMeta}>{trn(r.bookings, '{n} booking · {gross} gross · {shop} shop', '{n} bookings · {gross} gross · {shop} shop', { gross: dh(r.gross), shop: dh(r.shop) })}</Text>
                </View>
                <Text style={s.weekAmt}>{dh(r.barber)}</Text>
              </View>
            ))}

            <Text style={s.sectionLabel}>{tr('SETTLEMENTS & INVOICES')}</Text>
            <View style={s.blockedCard}>
              <Ionicons name="time-outline" size={18} color={D.sub} />
              <Text style={s.blockedText}>{tr('Money is paid at the shop today. In-app settlements, invoices and marking a payout "paid" arrive with the Phase 2 payout rail — see BACKLOG.')}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

type RentRow = { id: string; covers_from: string; covers_to: string; amount_cents: number };

// 0142 — the rent taken at the shop, one period at a time. Written down, not moved:
// the cash is already in the owner's hand when he taps, as with 0031's settlements.
function RentLedger({ member }: { member: Member }) {
  const [rows, setRows] = useState<RentRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    supabase.from('rent_payments').select('id, covers_from, covers_to, amount_cents')
      .eq('barber_id', member.id).order('covers_to', { ascending: false }).limit(12)
      .then(({ data, error }) => {
        if (error) Alert.alert(tr('Could not load the rent'), error.message);
        setRows((data as RentRow[] | null) ?? []);
      });
  }, [member.id]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: 'salon_rent_received' | 'salon_rent_undo', restart = false) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, restart ? { p_barber: member.id, p_restart: true } : { p_barber: member.id });
    setBusy(false);
    if (error) Alert.alert(tr('Could not update'), error.message);
    load();
  }

  if (!rows) return <ActivityIndicator color={colors.accent} style={{ marginTop: sp(8) }} />;
  const week = member.period === 'week';
  const upTo = rows[0]?.covers_to;
  // the server writes the period after the last one, else the one we are in — this only names it
  const next = rentPeriodName(upTo ?? periodStart(week), week);
  // more than a period behind: maybe owed, maybe he wasn't on rent then (0144)
  const now = rentPeriodName(periodStart(week), week);
  const behind = !!upTo && Date.parse(upTo) < Date.parse(periodStart(week));

  return (
    <>
      <View style={s.payoutHero}>
        <Text style={s.heroLabel}>{tr('CHAIR RENT')}</Text>
        <Text style={s.heroValue}>{dh(member.rent)}<Text style={s.heroPer}>{' '}{tr(week ? '/ wk' : '/ mo')}</Text></Text>
        <Text style={s.heroNote}>{tr('Rent barber — keeps 100% of takings, so revenue stays private.')}</Text>
      </View>
      <Text style={[s.emptyHint, upTo && Date.parse(upTo) <= Date.now() && { color: colors.danger }]}>
        {!upTo ? tr('Nothing written down yet.')
          : Date.parse(upTo) > Date.now() ? tr('Paid up to {date}', { date: dayMonth(upTo) })
            : tr('Due since {date}', { date: dayMonth(upTo) })}
      </Text>
      {member.rent > 0 ? (
        <>
          <Pressable disabled={busy} accessibilityRole="button"
            onPress={() => Alert.alert(tr('{amount} for {period}?', { amount: dh(member.rent), period: next }),
              tr('Only once the cash is in your hand. The latest one can be taken back.'),
              [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Mark paid'), onPress: () => run('salon_rent_received') }])}
            style={({ pressed }) => [s.cta, pressed && s.pressed]}>
            {busy ? <ActivityIndicator color={colors.onAccent} />
              : <Text style={s.ctaText}>{tr('Mark {period} paid in cash', { period: next })}</Text>}
          </Pressable>
          {behind && (
            <Pressable disabled={busy} hitSlop={8} accessibilityRole="button"
              onPress={() => Alert.alert(tr('Start again from {period}?', { period: now }),
                tr('The periods in between stay off the record. Use it when he wasn’t on rent then — not to clear what he owes.'),
                [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Start again'), onPress: () => run('salon_rent_received', true) }])}>
              <Text style={s.undoText}>{tr('Start again from {period}', { period: now })}</Text>
            </Pressable>
          )}
        </>
      ) : (
        <Text style={s.emptyHint}>{tr('Set the rent on the barber’s page first.')}</Text>
      )}

      {rows.length > 0 && <Text style={s.sectionLabel}>{tr('WRITTEN DOWN')}</Text>}
      {rows.map((r, i) => {
        const name = paidPeriodName(r.covers_from, r.covers_to);
        return (
          <View key={r.id} style={s.weekRow}>
            <View style={s.grow}>
              <Text style={s.weekLabel}>{name}</Text>
              {i === 0 && (
                <Pressable disabled={busy} hitSlop={8} accessibilityRole="button"
                  onPress={() => Alert.alert(tr('Take back {period}?', { period: name }), tr('It goes back to unpaid.'),
                    [{ text: tr('Cancel'), style: 'cancel' },
                     { text: tr('Take back'), style: 'destructive', onPress: () => run('salon_rent_undo') }])}>
                  <Text style={s.undoText}>{tr('Take back')}</Text>
                </Pressable>
              )}
            </View>
            <Text style={s.weekAmt}>{dh(r.amount_cents)}</Text>
          </View>
        );
      })}
    </>
  );
}

const dayMonth = (iso: string) => new Date(iso).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });

// by the month or by the week — the agreed rent (MemberSheet) and the asked one (ChairSheet)
function PeriodPick({ value, onChange }: { value: 'week' | 'month'; onChange: (p: 'week' | 'month') => void }) {
  return (
    <Segmented options={[tr('By the month'), tr('By the week')]}
      value={value === 'week' ? tr('By the week') : tr('By the month')}
      onChange={(v) => onChange(v === tr('By the week') ? 'week' : 'month')} />
  );
}

function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={s.pillGroup}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} accessibilityState={{ selected: value === o }}
          style={[s.pillOpt, value === o && s.pillOptOn]}>
          <Text style={[s.pillOptText, value === o && s.pillOptTextOn]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ponytail: PanResponder slider, no dep. Local value; persisted via the RPC on save.
function Split({ value, onChange, editable }: { value: number; onChange?: (v: number) => void; editable?: boolean }) {
  const w = useRef(0);
  const set = (x: number) => {
    if (!w.current) return;
    onChange?.(Math.max(0, Math.min(100, Math.round((x / w.current) * 100))));
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !!editable,
    onMoveShouldSetPanResponder: () => !!editable,
    onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
    onPanResponderMove: (e) => set(e.nativeEvent.locationX),
    onPanResponderTerminationRequest: () => false,   // the sheet scrolls now; a drag stays the slider's
  })).current;
  return (
    <View style={s.sliderHit} onLayout={(e) => { w.current = e.nativeEvent.layout.width; }} {...pan.panHandlers}>
      <View style={s.sliderTrack}><View style={[s.sliderFill, { width: `${value}%` }]} /></View>
      <View style={[s.sliderKnob, { left: `${value}%` }]} />
    </View>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <KeyboardAvoidingView style={s.backdropWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel={tr('Close')} />
        <View style={s.sheet}>
          <View style={s.handle} />
          {/* the dark kit's sheet: bounded, and scrolls when a chair's ask makes it long */}
          <ScrollView bounces={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.sheetBody}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  // --- 1p hub
  tnum: { fontVariant: ['tabular-nums'] },
  hubHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hubTitle: { flex: 1, textAlign: 'center' },
  puck38: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  puck38Ghost: { width: 38, height: 38 },
  hubTiles: { flexDirection: 'row', gap: 10 },
  hubTile: { flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 14, gap: 3 },
  teamRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card, borderRadius: 18, padding: 13, paddingHorizontal: 14,
  },
  teamRowPending: { borderWidth: 1, borderColor: 'rgba(232,161,0,0.35)' },
  teamAvatar: {
    width: 42, height: 42, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  ownerChip: { backgroundColor: colors.accentSoft, borderRadius: 5, paddingVertical: 3, paddingHorizontal: 6 },
  inviteRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18, padding: 14,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: D.muted,
  },
  invitePuck: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  shopList: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  shopRowLine: { borderBottomWidth: 1, borderBottomColor: D.border },
  shopIcon: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  hubNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: D.card, borderRadius: 16, padding: 13, paddingHorizontal: 15,
  },
  hubNoteText: { flex: 1, lineHeight: 18 },

  // --- 2d invite
  codeCard: { backgroundColor: D.card, borderRadius: 20, padding: 22, alignItems: 'center', gap: 12 },
  codeValue: { fontFamily: serif, fontSize: 38, letterSpacing: 8, color: D.text },
  codeBtns: { flexDirection: 'row', gap: 9, marginTop: 2 },
  codeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 38, paddingHorizontal: 15,
    borderRadius: 999, backgroundColor: D.card2,
  },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  orLine: { flex: 1, height: 1, backgroundColor: D.border },
  phoneField: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card2,
    borderRadius: 16, height: 48, paddingHorizontal: 16,
  },
  phoneInput: { flex: 1, fontFamily: inter.r, fontSize: 14, color: D.text, padding: 0 },
  commRow: { flexDirection: 'row', gap: 8 },
  commBtn: {
    flex: 1, height: 44, borderRadius: 14, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  commBtnOn: { backgroundColor: colors.accent },
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: D.card, borderRadius: 16, padding: 13, paddingHorizontal: 15,
  },
  pendingPuck: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  screen: { flex: 1, backgroundColor: D.bg },
  center: { flex: 1, backgroundColor: D.bg, alignItems: 'center', justifyContent: 'center' },
  content: { padding: sp(5), paddingTop: TOP_INSET, gap: sp(3), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  dim: { color: D.sub },
  dimBtn: { opacity: 0.4 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  rowCenterTight: { flexDirection: 'row', alignItems: 'center', gap: 5 },

  topRow: { flexDirection: 'row', alignItems: 'center' },
  overline: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1.5, textAlign: 'center' },
  title: { fontSize: font.h2, fontWeight: '700', color: D.text, textAlign: 'center' },
  iconBtn: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  spacer: { width: 36, height: 36 },

  segment: { flexDirection: 'row', backgroundColor: D.card2, borderRadius: radius.pill, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segItemOn: { backgroundColor: colors.accent },
  segText: { fontSize: font.small, fontWeight: '700', color: D.sub, letterSpacing: 0.5 },
  segTextOn: { color: colors.onAccent },

  shopCard: { backgroundColor: D.card, borderRadius: radius.lg, padding: sp(4), gap: sp(3) },
  dot: { width: 8, height: 8, borderRadius: 4 },
  shopStatus: { fontSize: font.small, fontWeight: '700', color: D.text, letterSpacing: 0.5 },
  powerBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  powerBtnOff: { backgroundColor: D.card2 },
  shopAddr: { fontSize: font.small, color: D.sub },
  statRow: { flexDirection: 'row', gap: sp(2) },
  statTile: { flex: 1, backgroundColor: D.card2, borderRadius: radius.md, padding: sp(3), gap: 4 },
  statTileAccent: { backgroundColor: 'rgba(232,71,79,0.12)', borderWidth: 1, borderColor: 'rgba(232,71,79,0.35)' },
  statLabel: { fontSize: 9, fontWeight: '700', color: D.sub, letterSpacing: 0.5 },
  statValue: { fontSize: font.body, fontWeight: '700', color: D.text },

  sectionHead: { flexDirection: 'row', alignItems: 'center', marginTop: sp(2) },
  sectionLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: sp(3), paddingVertical: sp(1.5),
    borderRadius: radius.pill, backgroundColor: colors.accent,
  },
  addText: { fontSize: font.small, fontWeight: '700', color: colors.onAccent },
  pendingHint: { fontSize: font.small, color: colors.star, fontWeight: '600' },
  emptyHint: { fontSize: font.small, color: D.sub, paddingVertical: sp(1) },

  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card, borderRadius: radius.md, padding: sp(3.5),
  },
  avatar: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: font.small, fontWeight: '700', color: D.text },
  presence: {
    position: 'absolute', right: -1, bottom: -1, width: 12, height: 12,
    borderRadius: 6, borderWidth: 2, borderColor: D.card,
  },
  memberName: { fontSize: font.body, fontWeight: '700', color: D.text },
  crown: { fontSize: 12 },
  memberMeta: { fontSize: font.small, color: D.sub, marginTop: 1 },
  memberRight: { alignItems: 'flex-end', gap: 3 },
  statusPill: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  memberSplit: { fontSize: font.tiny, color: D.sub },

  chairSummary: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(3), paddingVertical: sp(1) },
  summaryText: { fontSize: font.small, color: D.sub, fontWeight: '600' },
  chairGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  chairCard: {
    width: '48.5%', backgroundColor: D.card, borderRadius: radius.md, padding: sp(3.5), gap: sp(2),
  },
  chairLabel: { fontSize: font.body, fontWeight: '700', color: D.text },
  chairAvatar: {
    width: 26, height: 26, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  chairAvatarText: { fontSize: 10, fontWeight: '700', color: D.text },
  chairOccupant: { flex: 1, fontSize: font.small, color: D.text, fontWeight: '600' },
  chairEmpty: { fontSize: font.small, color: D.sub },
  chairAvail: { fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.5 },
  chairNameInput: {
    flex: 1, backgroundColor: D.card2, borderRadius: radius.md, paddingHorizontal: sp(3.5),
    height: 48, fontSize: font.h2, fontWeight: '700', color: D.text,
  },
  emptySlot: { borderWidth: 1, borderColor: D.border, borderStyle: 'dashed', backgroundColor: 'transparent' },
  assignRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3), backgroundColor: D.card2,
    borderRadius: radius.md, padding: sp(3), borderWidth: 1, borderColor: 'transparent',
  },
  assignRowOn: { borderColor: colors.accent, backgroundColor: 'rgba(232,71,79,0.1)' },
  assignName: { flex: 1, fontSize: font.body, fontWeight: '600', color: D.text },

  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card, borderRadius: radius.md, padding: sp(3.5),
  },
  menuIcon: {
    width: 40, height: 40, borderRadius: radius.sm, backgroundColor: 'rgba(232,71,79,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  menuName: { fontSize: font.body, fontWeight: '700', color: D.text },
  menuMeta: { fontSize: font.small, color: D.sub, marginTop: 1 },

  settingsCard: { backgroundColor: D.card, borderRadius: radius.lg, overflow: 'hidden' },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: sp(3), padding: sp(3.5) },
  setRowBorder: { borderTopWidth: 1, borderTopColor: D.border },
  setIcon: {
    width: 40, height: 40, borderRadius: radius.sm, backgroundColor: 'rgba(232,71,79,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  setTitle: { fontSize: font.body, fontWeight: '700', color: D.text },
  setSub: { fontSize: font.small, color: D.sub, marginTop: 1 },

  backdropWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.sheet, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: sp(5), paddingBottom: sp(9), gap: sp(3), maxHeight: '92%',
  },
  sheetBody: { gap: sp(3) },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: D.hairline },
  sheetTitle: { fontSize: font.h2, fontWeight: '700', color: D.text },

  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  sheetAvatar: {
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetAvatarText: { fontSize: font.body, fontWeight: '700', color: D.text },
  sheetName: { fontSize: font.h2, fontWeight: '700', color: D.text },
  pendingBody: { fontSize: font.small, color: D.sub, lineHeight: 19 },

  fieldLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  splitValue: { fontSize: font.body, fontWeight: '700', color: D.text },
  splitMuted: { color: D.sub, fontWeight: '600' },

  rentRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: D.card2,
    borderRadius: radius.md, padding: sp(3.5),
  },
  rentText: { flex: 1, fontSize: font.small, color: D.sub },
  noteInput: { height: 88, paddingTop: sp(3), textAlignVertical: 'top' },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3), backgroundColor: D.card2,
    borderRadius: radius.md, padding: sp(3.5),
  },
  undoText: { fontSize: font.small, fontWeight: '700', color: colors.accent, marginTop: 2 },

  hoursRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: D.card2,
    borderRadius: radius.md, paddingHorizontal: sp(3.5), height: 56,
  },
  hoursLabel: { fontSize: font.body, fontWeight: '700', color: D.text },
  hoursValue: {
    fontSize: font.body, fontWeight: '700', color: D.text, width: 56, textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  stepBtn: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },

  payoutHero: {
    backgroundColor: D.redCard, borderWidth: 1, borderColor: D.redSeam,
    borderRadius: radius.lg, padding: sp(4), gap: sp(1),
  },
  heroLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1.5 },
  heroValue: { fontSize: 34, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  heroPer: { fontSize: font.body, fontWeight: '600', color: D.sub },
  heroNote: { fontSize: font.small, color: D.sub, lineHeight: 18, marginTop: sp(1) },
  weekRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card, borderRadius: radius.md, padding: sp(3.5),
  },
  weekLabel: { fontSize: font.body, fontWeight: '700', color: D.text },
  weekMeta: { fontSize: font.small, color: D.sub, marginTop: 1 },
  weekAmt: { fontSize: font.body, fontWeight: '700', color: colors.accent, fontVariant: ['tabular-nums'] },
  blockedCard: {
    flexDirection: 'row', gap: sp(3), backgroundColor: D.card, borderRadius: radius.md, padding: sp(3.5),
    borderWidth: 1, borderColor: D.border, borderStyle: 'dashed',
  },
  blockedText: { flex: 1, fontSize: font.small, color: D.sub, lineHeight: 18 },

  actionGrid: { flexDirection: 'row', gap: sp(2) },
  approveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 50, borderRadius: radius.md, backgroundColor: colors.accent,
  },
  approveText: { fontSize: font.body, fontWeight: '700', color: colors.onAccent },
  declineBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(210,59,59,0.4)', backgroundColor: 'rgba(210,59,59,0.1)',
  },
  declineText: { fontSize: font.body, fontWeight: '700', color: colors.danger },

  inviteIcon: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: 'rgba(232,71,79,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  input: {
    backgroundColor: D.card2, borderRadius: radius.md, paddingHorizontal: sp(3.5),
    height: 52, fontSize: font.body, color: D.text,
  },
  pillGroup: { flexDirection: 'row', gap: sp(2) },
  pillOpt: {
    flex: 1, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: D.border, backgroundColor: D.card2,
  },
  pillOptOn: { backgroundColor: 'rgba(232,71,79,0.16)', borderColor: colors.accent },
  pillOptText: { fontSize: font.small, fontWeight: '700', color: D.sub },
  pillOptTextOn: { color: colors.accent },

  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: D.card2,
    borderRadius: radius.md, paddingLeft: sp(3.5), paddingRight: 4, height: 48,
  },
  linkText: { flex: 1, fontSize: font.small, color: D.sub },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: sp(3), height: 36,
    borderRadius: radius.sm, backgroundColor: D.border,
  },
  copyText: { fontSize: font.small, fontWeight: '700', color: D.text },

  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52,
    borderRadius: radius.pill, backgroundColor: colors.accent, marginTop: sp(1),
  },
  ctaText: { fontSize: font.body, fontWeight: '700', color: colors.onAccent },

  sliderHit: { height: 28, justifyContent: 'center' },
  sliderTrack: { height: 6, borderRadius: 3, backgroundColor: D.muted, overflow: 'hidden' },
  sliderFill: { height: 6, backgroundColor: colors.accent },
  sliderKnob: {
    position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
    marginLeft: -10, top: 4,
  },
});
