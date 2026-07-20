import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';

// Owner-only Salon screen — TEAM / SERVICES / SETTINGS. Real backend (0025):
// salon_team()/salon_stats() RPCs (owner-only, privacy rule baked in — a rent
// barber's revenue never arrives), + owner mutation RPCs. Services reuse the real
// per-barber table (via Profile → My Services for add/edit).
// STILL MOCK (blocked — see BACKLOG): Packages, invite-by-phone/share link,
// Payouts/Reports/Permissions. Presence is derived from today's bookings.

const dh = (c: number) => `${Math.round(c / 100).toLocaleString('en-US')} DH`;
const soon = () => Alert.alert('Coming soon', 'See BACKLOG.md — Owner: salon management.');

type PayModel = 'commission' | 'rent';
type SalonMeta = {
  id: string; name: string; address: string | null;
  default_commission: number; accepting_bookings: boolean; cash_agent_id: string | null;
  open_min: number; close_min: number;
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
type Member = {
  id: string; name: string; avatar: string | null; role: string; chair: string | null;
  status: 'pending' | 'approved' | 'rejected'; pay: PayModel; split: number; rent: number;
  rating: number; reviews: number; todayBookings: number; todayRevenue: number | null;
  inService: boolean; isCashAgent: boolean;
};
type Stats = { onFloor: number; chairs: number; bookings: number; revenue: number; shopCut: number };
type Svc = { id: string; name: string; price_cents: number; duration_min: number; is_active: boolean };
type Availability = 'empty' | 'open' | 'busy' | 'off';
type Chair = {
  id: string; label: string; barberId: string | null; barberName: string | null;
  avatar: string | null; availability: Availability;
};

const AVAIL: Record<Availability, { c: string; t: string }> = {
  open: { c: '#3BD07A', t: 'Open' },
  busy: { c: colors.accent, t: 'In service' },
  off: { c: colors.star, t: 'Off' },
  empty: { c: D.sub, t: 'Empty' },
};

const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const statusColor = (m: Member) =>
  m.status === 'pending' ? colors.star : m.inService ? colors.accent : '#3BD07A';
const statusLabel = (m: Member) =>
  m.status === 'pending' ? 'PENDING' : m.inService ? 'IN SERVICE' : 'FREE';

export default function SalonScreen({ barberId, onBack, onManageServices, onEditSalon }: {
  barberId: string; onBack?: () => void;
  onManageServices?: () => void; onEditSalon?: () => void;
}) {
  const [seg, setSeg] = useState<'team' | 'chairs' | 'services' | 'settings'>('team');
  const [salon, setSalon] = useState<SalonMeta | null>(null);
  const [team, setTeam] = useState<Member[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [services, setServices] = useState<Svc[] | null>(null);
  const [chairs, setChairs] = useState<Chair[] | null>(null);
  const [selected, setSelected] = useState<Member | null>(null);
  const [chairEdit, setChairEdit] = useState<Chair | 'new' | null>(null);
  const [payoutsFor, setPayoutsFor] = useState<Member | null>(null);
  const [invite, setInvite] = useState(false);
  const [defCommOpen, setDefCommOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);

  const load = useCallback(async () => {
    const [{ data: s }, { data: t }, { data: st }, { data: sv }, { data: ch }] = await Promise.all([
      supabase.from('salons')
        .select('id, name, address, default_commission, accepting_bookings, cash_agent_id, open_min, close_min')
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
    })));
    setTeam(((t as any[]) ?? []).map((r) => ({
      id: r.barber_id, name: r.full_name, avatar: r.avatar_url, role: r.salon_role,
      chair: r.chair_label, status: r.salon_status, pay: r.pay_model, split: r.commission_pct,
      rent: r.rent_cents, rating: Number(r.rating), reviews: r.reviews_count,
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

  async function toggleShop() {
    if (!salon) return;
    const next = !salon.accepting_bookings;
    setSalon({ ...salon, accepting_bookings: next });
    const { error } = await supabase.from('salons').update({ accepting_bookings: next }).eq('id', salon.id);
    if (error) { setSalon({ ...salon, accepting_bookings: !next }); Alert.alert('Could not update', error.message); }
  }

  async function toggleService(svc: Svc) {
    setServices((cur) => cur?.map((x) => x.id === svc.id ? { ...x, is_active: !x.is_active } : x) ?? null);
    const { error } = await supabase.from('services').update({ is_active: !svc.is_active }).eq('id', svc.id);
    if (error) { load(); Alert.alert('Could not update', error.message); }
  }

  if (!salon || !team || !stats || !services || !chairs) {
    return <View style={s.center}><ActivityIndicator color={colors.accent} /></View>;
  }

  if (payoutsFor) return <BarberEarnings member={payoutsFor} onBack={() => setPayoutsFor(null)} />;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.topRow}>
          {onBack
            ? <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Go back"
                style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
                <Ionicons name="arrow-back" size={18} color={D.text} />
              </Pressable>
            : <View style={s.spacer} />}
          <View style={s.grow}>
            <Text style={s.overline}>SALON</Text>
            <Text style={s.title} numberOfLines={1}>{salon.name}</Text>
          </View>
          <Pressable onPress={() => setSeg('settings')} hitSlop={8} accessibilityLabel="Settings"
            style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
            <Ionicons name="settings-outline" size={18} color={D.text} />
          </Pressable>
        </View>

        <View style={s.segment}>
          {(['team', 'chairs', 'services', 'settings'] as const).map((k) => (
            <Pressable key={k} onPress={() => setSeg(k)} accessibilityState={{ selected: seg === k }}
              style={[s.segItem, seg === k && s.segItemOn]}>
              <Text style={[s.segText, seg === k && s.segTextOn]}>{k.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <ShopHeader salon={salon} stats={stats} onToggleOpen={toggleShop} />

        {seg === 'team' && <TeamTab team={team} onOpen={setSelected} onInvite={() => setInvite(true)} />}
        {seg === 'chairs' && (
          <ChairsTab chairs={chairs} onOpen={setChairEdit} onAdd={() => setChairEdit('new')} />
        )}
        {seg === 'services' && (
          <ServicesTab services={services} onToggle={toggleService} onManage={onManageServices} />
        )}
        {seg === 'settings' && (
          <SettingsTab salon={salon} members={team.length}
            onEditSalon={onEditSalon} onSalonHours={() => setHoursOpen(true)}
            onDefaultCommission={() => setDefCommOpen(true)} />
        )}
      </ScrollView>

      {selected && (
        <MemberSheet m={selected} onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); load(); }}
          onEarnings={() => { setPayoutsFor(selected); setSelected(null); }} />
      )}
      {chairEdit && (
        <ChairSheet chair={chairEdit === 'new' ? null : chairEdit} team={team}
          onClose={() => setChairEdit(null)} onChanged={() => { setChairEdit(null); load(); }} />
      )}
      {invite && <InviteSheet salon={salon} onClose={() => setInvite(false)} />}
      {defCommOpen && (
        <DefaultCommissionSheet salon={salon} onClose={() => setDefCommOpen(false)}
          onSaved={() => { setDefCommOpen(false); load(); }} />
      )}
      {hoursOpen && (
        <SalonHoursSheet salon={salon} onClose={() => setHoursOpen(false)}
          onSaved={() => { setHoursOpen(false); load(); }} />
      )}
    </View>
  );
}

function ShopHeader({ salon, stats, onToggleOpen }: {
  salon: SalonMeta; stats: Stats; onToggleOpen: () => void;
}) {
  const open = salon.accepting_bookings;
  return (
    <View style={s.shopCard}>
      <View style={s.rowCenter}>
        <View style={[s.dot, { backgroundColor: open ? '#3BD07A' : D.sub }]} />
        <Text style={s.shopStatus}>{open ? 'SHOP OPEN' : 'SHOP CLOSED'}</Text>
        <View style={s.grow} />
        <Pressable onPress={() => Alert.alert(open ? 'Close shop?' : 'Open shop?',
          open ? 'Stops new bookings for the whole salon.' : 'Salon starts taking bookings again.',
          [{ text: 'Cancel', style: 'cancel' }, { text: open ? 'Close' : 'Open', onPress: onToggleOpen }])}
          accessibilityLabel={open ? 'Close shop' : 'Open shop'}
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
        <Stat label="ON FLOOR" value={`${stats.onFloor}/${stats.chairs}`} />
        <Stat label="BOOKINGS" value={String(stats.bookings)} />
        <Stat label="REVENUE" value={dh(stats.revenue)} accent />
        <Stat label="SHOP CUT" value={dh(stats.shopCut)} />
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
      <SectionHead label={`TEAM · ${team.length} ${team.length === 1 ? 'CHAIR' : 'CHAIRS'}`}
        action="Invite" onAction={onInvite} />
      {pending > 0 && (
        <Text style={s.pendingHint}>{pending} join request{pending > 1 ? 's' : ''} — tap to review</Text>
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
            <Text style={s.memberSplit}>{m.pay === 'rent' ? 'Rent' : `${m.split}% split`}</Text>
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
      <SectionHead label={`CHAIRS · ${chairs.length}`} action="Add" onAction={onAdd} />
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
      {chairs.length === 0 && <Text style={s.emptyHint}>No chairs yet — tap Add to set up your floor.</Text>}
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
              <Text style={s.chairEmpty}>Empty — tap to assign</Text>
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
  const members = team.filter((m) => m.status === 'approved');

  async function call(fn: string, args: object) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return Alert.alert('Could not update', error.message);
    onChanged();
  }

  // create mode
  if (!chair) {
    return (
      <Sheet onClose={onClose}>
        <Text style={s.sheetTitle}>Add chair</Text>
        <Text style={s.fieldLabel}>LABEL</Text>
        <TextInput value={label} onChangeText={setLabel} placeholder="Chair 01"
          placeholderTextColor={D.sub} style={s.input} autoFocus />
        <Pressable disabled={busy} onPress={() => label.trim() && call('salon_add_chair', { p_label: label.trim() })}
          style={({ pressed }) => [s.cta, pressed && s.pressed]}>
          {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.ctaText}>Add chair</Text>}
        </Pressable>
      </Sheet>
    );
  }

  // edit mode: rename, assign, delete
  return (
    <Sheet onClose={onClose}>
      <View style={s.rowCenter}>
        <TextInput value={label} onChangeText={setLabel} style={s.chairNameInput} />
        <Pressable disabled={busy || label.trim() === chair.label} accessibilityLabel="Rename chair"
          onPress={() => call('salon_rename_chair', { p_chair: chair.id, p_label: label.trim() })}
          style={({ pressed }) => [s.iconBtn, (label.trim() === chair.label) && s.dimBtn, pressed && s.pressed]}>
          <Ionicons name="checkmark" size={18} color={colors.accent} />
        </Pressable>
        <Pressable disabled={busy} accessibilityLabel="Delete chair"
          onPress={() => Alert.alert('Delete chair?', `${chair.label} will be removed.`,
            [{ text: 'Cancel', style: 'cancel' },
             { text: 'Delete', style: 'destructive', onPress: () => call('salon_delete_chair', { p_chair: chair.id }) }])}
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
        </Pressable>
      </View>

      <Text style={s.fieldLabel}>ASSIGN A BARBER</Text>
      <Pressable disabled={busy} onPress={() => call('salon_assign_chair', { p_chair: chair.id, p_barber: null })}
        style={({ pressed }) => [s.assignRow, !chair.barberId && s.assignRowOn, pressed && s.pressed]}>
        <View style={[s.chairAvatar, s.emptySlot]}><Ionicons name="remove" size={16} color={D.sub} /></View>
        <Text style={s.assignName}>Leave empty</Text>
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
      <SectionHead label={`MENU · ${live} LIVE`} action="Manage" onAction={onManage ?? soon} />
      {services.length === 0 && <Text style={s.emptyHint}>No services yet — tap Manage to add your first.</Text>}
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
      {/* MOCK — packages need the packages/package_items tables + booking mapping (BACKLOG) */}
      <SectionHead label="PACKAGES · MOCK" action="Add" onAction={soon} />
      <Text style={s.emptyHint}>Bundles land once the booking-mapping decision is made — see BACKLOG.</Text>
    </>
  );
}

const SET_ROWS = (salon: SalonMeta, members: number) => ([
  { icon: 'business-outline', title: 'Salon profile', sub: 'Name, address, photos', key: 'profile' },
  { icon: 'time-outline', title: 'Opening hours',
    sub: salon.open_min === 0 && salon.close_min === 1440
      ? 'All day — tap to set a window'
      : `${hhmm(salon.open_min)} – ${hhmm(salon.close_min)} · barbers set theirs within`, key: 'hours' },
  { icon: 'pricetag-outline', title: 'Default commission', sub: `${salon.default_commission}% to barber`, key: 'commission' },
  { icon: 'shield-outline', title: 'Roles & permissions', sub: `${members} members`, key: 'soon' },
  { icon: 'cash-outline', title: 'Payouts & taxes', sub: 'Needs the wallet rail', key: 'soon' },
  { icon: 'bar-chart-outline', title: 'Reports', sub: 'Revenue, retention', key: 'soon' },
] as { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; key: string }[]);

function SettingsTab({ salon, members, onEditSalon, onSalonHours, onDefaultCommission }: {
  salon: SalonMeta; members: number;
  onEditSalon?: () => void; onSalonHours: () => void; onDefaultCommission: () => void;
}) {
  const press = (key: string) => key === 'profile' ? (onEditSalon ?? soon)()
    : key === 'hours' ? onSalonHours()
    : key === 'commission' ? onDefaultCommission() : soon();
  return (
    <View style={s.settingsCard}>
      {SET_ROWS(salon, members).map((r, i) => (
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

function SectionHead({ label, action, onAction }: { label: string; action: string; onAction: () => void }) {
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionLabel}>{label}</Text>
      <View style={s.grow} />
      <Pressable onPress={onAction} accessibilityLabel={action}
        style={({ pressed }) => [s.addBtn, pressed && s.pressed]}>
        <Ionicons name="add" size={16} color={colors.onAccent} />
        <Text style={s.addText}>{action}</Text>
      </Pressable>
    </View>
  );
}

const cap = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

// ── Member detail sheet ───────────────────────────────────────────────────────
function MemberSheet({ m, onClose, onChanged, onEarnings }: {
  m: Member; onClose: () => void; onChanged: () => void; onEarnings: () => void;
}) {
  const [pay, setPay] = useState<PayModel>(m.pay);
  const [split, setSplit] = useState(m.split);
  const [busy, setBusy] = useState(false);
  const dirty = pay !== m.pay || (pay === 'commission' && split !== m.split);
  const showMoney = m.pay === 'commission'; // rent barber's book stays private

  async function call(fn: string, args: object, ok?: string) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) return Alert.alert('Could not update', error.message);
    if (ok) Alert.alert('Done', ok);
    onChanged();
  }

  const saveTerms = () => call('salon_set_terms', {
    p_barber: m.id, p_salon_role: m.role, p_pay_model: pay,
    p_commission_pct: split, p_rent_cents: m.rent, p_chair: m.chair ?? '',
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
          <Text style={s.pendingBody}>This barber asked to join your salon. Approve to add them to the
            floor and your public page, or decline to remove the request.</Text>
          <View style={s.actionGrid}>
            <Pressable disabled={busy} onPress={() => call('salon_approve_member', { p_barber: m.id }, `${m.name} added to the team.`)}
              style={({ pressed }) => [s.approveBtn, pressed && s.pressed]}>
              <Ionicons name="checkmark" size={16} color={colors.onAccent} />
              <Text style={s.approveText}>Approve</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => call('salon_remove_member', { p_barber: m.id })}
              style={({ pressed }) => [s.declineBtn, pressed && s.pressed]}>
              <Ionicons name="close" size={16} color={colors.danger} />
              <Text style={s.declineText}>Decline</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={s.sheetStats}>
            <Stat label="BOOKINGS" value={String(m.todayBookings)} />
            {showMoney && <Stat label="REVENUE" value={dh(m.todayRevenue ?? 0)} />}
            <View style={[s.statTile, s.statTileAccent]}>
              <Text style={s.statLabel}>RATING</Text>
              <Text style={s.statValue}>{m.rating > 0 ? `★ ${m.rating.toFixed(1)}` : 'New'}</Text>
            </View>
          </View>

          <Text style={s.fieldLabel}>PAY MODEL</Text>
          <Segmented options={['Commission', 'Rent']}
            value={pay === 'commission' ? 'Commission' : 'Rent'}
            onChange={(v) => setPay(v === 'Commission' ? 'commission' : 'rent')} />

          {pay === 'commission' ? (
            <>
              <View style={s.rowCenter}>
                <Text style={s.fieldLabel}>COMMISSION SPLIT</Text>
                <View style={s.grow} />
                <Text style={s.splitValue}>{split}% <Text style={s.splitMuted}>/ {100 - split}% shop</Text></Text>
              </View>
              <Split value={split} onChange={setSplit} editable />
            </>
          ) : (
            <View style={s.rentRow}>
              <Ionicons name="home-outline" size={16} color={D.sub} />
              <Text style={s.rentText}>Rents the chair — keeps 100%, revenue stays private.</Text>
            </View>
          )}

          {dirty && (
            <Pressable disabled={busy} onPress={saveTerms}
              style={({ pressed }) => [s.cta, pressed && s.pressed]}>
              {busy ? <ActivityIndicator color={colors.onAccent} />
                : <Text style={s.ctaText}>Save pay terms</Text>}
            </Pressable>
          )}

          {!m.isCashAgent && (
            <Pressable disabled={busy} onPress={() => call('salon_set_cash_agent', { p_barber: m.id }, `${m.name} is now the cash agent.`)}
              style={({ pressed }) => [s.agentBtn, pressed && s.pressed]}>
              <Text style={s.crown}>👑</Text>
              <Text style={s.agentText}>Make cash agent</Text>
            </Pressable>
          )}

          <Pressable onPress={onEarnings} accessibilityLabel="Earnings and payouts"
            style={({ pressed }) => [s.earningsRow, pressed && s.pressed]}>
            <View style={s.setIcon}><Ionicons name="cash-outline" size={18} color={colors.accent} /></View>
            <View style={s.grow}>
              <Text style={s.setTitle}>Earnings & payouts</Text>
              <Text style={s.setSub}>{m.pay === 'commission' ? 'Weekly commission statement' : 'Chair rent'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={D.sub} />
          </Pressable>

          <View style={s.actionGrid}>
            <ActionBtn icon="chatbubble-outline" label="Message" onPress={soon} />
            <ActionBtn icon="calendar-outline" label="Schedule" onPress={soon} />
          </View>

          {m.role !== 'owner' && (
            <Pressable disabled={busy} onPress={() => Alert.alert('Remove from salon?',
              `${m.name} loses this chair and is unlinked from the salon.`,
              [{ text: 'Cancel', style: 'cancel' },
               { text: 'Remove', style: 'destructive', onPress: () => call('salon_remove_member', { p_barber: m.id }) }])}
              style={({ pressed }) => [s.removeBtn, pressed && s.pressed]}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={s.removeText}>Remove from salon</Text>
            </Pressable>
          )}
        </>
      )}
    </Sheet>
  );
}

function ActionBtn({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label}
      style={({ pressed }) => [s.actionBtn, pressed && s.pressed]}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
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
    if (error) return Alert.alert('Could not save', error.message);
    onSaved();
  }
  return (
    <Sheet onClose={onClose}>
      <Text style={s.sheetTitle}>Default commission</Text>
      <Text style={s.memberMeta}>Applied to new commission barbers as their starting split.</Text>
      <View style={s.rowCenter}>
        <Text style={s.fieldLabel}>TO BARBER</Text>
        <View style={s.grow} />
        <Text style={s.splitValue}>{pct}% <Text style={s.splitMuted}>/ {100 - pct}% shop</Text></Text>
      </View>
      <Split value={pct} onChange={setPct} editable />
      <Pressable disabled={busy} onPress={save} style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.ctaText}>Save</Text>}
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
    if (close <= open) return Alert.alert('Invalid hours', 'Closing must be after opening.');
    setBusy(true);
    const { error } = await supabase.from('salons')
      .update({ open_min: open, close_min: close }).eq('id', salon.id);
    setBusy(false);
    if (error) return Alert.alert('Could not save', error.message);
    onSaved();
  }
  return (
    <Sheet onClose={onClose}>
      <Text style={s.sheetTitle}>Opening hours</Text>
      <Text style={s.memberMeta}>Barbers can only set their own hours inside this window.</Text>
      <HourStepper label="Opens" value={open} min={0} max={close - 30} onChange={setOpen} />
      <HourStepper label="Closes" value={close} min={open + 30} max={1440} onChange={setClose} />
      {open === 0 && close === 1440 && (
        <Text style={s.emptyHint}>Currently all-day — no limit on barber hours until you narrow it.</Text>
      )}
      <Pressable disabled={busy} onPress={save} style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={s.ctaText}>Save hours</Text>}
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
      <Pressable onPress={() => step(-30)} hitSlop={6} accessibilityLabel={`${label} earlier`}
        style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}>
        <Ionicons name="remove" size={16} color={D.text} />
      </Pressable>
      <Text style={s.hoursValue}>{hhmm(value)}</Text>
      <Pressable onPress={() => step(30)} hitSlop={6} accessibilityLabel={`${label} later`}
        style={({ pressed }) => [s.stepBtn, pressed && s.pressed]}>
        <Ionicons name="add" size={16} color={D.text} />
      </Pressable>
    </View>
  );
}

// ── Invite sheet — MOCK. Real membership = barber self-joins at onboarding → lands
// pending → owner approves in Team. Invite-by-phone/share link need the brber.ma
// web surface (adoption bet #1); pay terms are set post-approval in the member sheet.
function InviteSheet({ salon, onClose }: { salon: SalonMeta; onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('Barber');
  const link = 'brber.ma/join/CX8-42K';
  return (
    <Sheet onClose={onClose}>
      <View style={s.rowCenter}>
        <View style={s.inviteIcon}><Ionicons name="person-add-outline" size={18} color={colors.accent} /></View>
        <View style={s.grow}>
          <Text style={s.sheetTitle}>Invite a barber</Text>
          <Text style={s.memberMeta}>They join {salon.name} with their own chair</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close"
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
          <Ionicons name="close" size={18} color={D.text} />
        </Pressable>
      </View>

      <Text style={s.fieldLabel}>PHONE NUMBER</Text>
      <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad"
        placeholder="+212 6•• ••• •••" placeholderTextColor={D.sub} style={s.input} />
      <Text style={s.fieldLabel}>ROLE</Text>
      <Segmented options={['Senior', 'Barber', 'Apprentice']} value={role} onChange={setRole} />

      <View style={s.linkRow}>
        <Text style={s.linkText} numberOfLines={1}>{link}</Text>
        <Pressable onPress={() => Alert.alert('Invite link', link)} accessibilityLabel="Copy link"
          style={({ pressed }) => [s.copyBtn, pressed && s.pressed]}>
          <Ionicons name="copy-outline" size={14} color={D.text} />
          <Text style={s.copyText}>Copy</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => Alert.alert('Not wired yet',
        'For now the barber signs up and picks your salon at onboarding — they then appear here as a pending request to approve. Phone invites + share links need the web surface (BACKLOG adoption bet #1).')}
        style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        <Ionicons name="paper-plane" size={16} color={colors.onAccent} />
        <Text style={s.ctaText}>Send invite</Text>
      </Pressable>
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
  const same = d.toISOString().slice(0, 10) === thisWeek.toISOString().slice(0, 10);
  return (same ? 'This week · ' : 'Week of ') + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function BarberEarnings({ member, onBack }: { member: Member; onBack: () => void }) {
  const [rows, setRows] = useState<Period[] | null>(null);

  useEffect(() => {
    if (member.pay !== 'commission') { setRows([]); return; }
    supabase.rpc('salon_barber_earnings', { p_barber: member.id }).then(({ data, error }) => {
      if (error) { Alert.alert('Could not load payouts', error.message); onBack(); return; }
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
          <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Go back"
            style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
            <Ionicons name="arrow-back" size={18} color={D.text} />
          </Pressable>
          <View style={s.grow}>
            <Text style={s.overline}>EARNINGS</Text>
            <Text style={s.title} numberOfLines={1}>{member.name}</Text>
          </View>
          <View style={s.spacer} />
        </View>

        {rows === null && <ActivityIndicator color={colors.accent} style={{ marginTop: sp(8) }} />}

        {member.pay === 'rent' && rows !== null && (
          <>
            <View style={s.payoutHero}>
              <Text style={s.heroLabel}>CHAIR RENT DUE</Text>
              <Text style={s.heroValue}>{dh(member.rent)}<Text style={s.heroPer}> / mo</Text></Text>
              <Text style={s.heroNote}>Rent barber — keeps 100% of takings, so revenue stays private.</Text>
            </View>
            <Text style={s.emptyHint}>Rent collection + receipts arrive with the payout rail (BACKLOG).</Text>
          </>
        )}

        {member.pay === 'commission' && rows !== null && (
          <>
            <View style={s.payoutHero}>
              <Text style={s.heroLabel}>OUTSTANDING · UNSETTLED</Text>
              <Text style={s.heroValue}>{dh(outstanding)}</Text>
              <Text style={s.heroNote}>Owed to {member.name.split(' ')[0]} at {member.split}% — accrued from bookings.
                Nothing is settled in-app yet (pay at shop).</Text>
            </View>

            <Text style={s.sectionLabel}>BY WEEK</Text>
            {rows.length === 0 && <Text style={s.emptyHint}>No bookings in the last 8 weeks.</Text>}
            {rows.map((r) => (
              <View key={r.start} style={s.weekRow}>
                <View style={s.grow}>
                  <Text style={s.weekLabel}>{weekLabel(r.start)}</Text>
                  <Text style={s.weekMeta}>{r.bookings} booking{r.bookings === 1 ? '' : 's'} · {dh(r.gross)} gross · {dh(r.shop)} shop</Text>
                </View>
                <Text style={s.weekAmt}>{dh(r.barber)}</Text>
              </View>
            ))}

            <Text style={s.sectionLabel}>SETTLEMENTS & INVOICES</Text>
            <View style={s.blockedCard}>
              <Ionicons name="time-outline" size={18} color={D.sub} />
              <Text style={s.blockedText}>Money is paid at the shop today. In-app settlements, invoices and
                marking a payout "paid" arrive with the Phase 2 payout rail — see BACKLOG.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
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
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.handle} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  center: { flex: 1, backgroundColor: D.bg, alignItems: 'center', justifyContent: 'center' },
  content: { padding: sp(5), paddingTop: sp(14), gap: sp(3), paddingBottom: TAB_BAR_INSET },
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
    backgroundColor: '#151517', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: sp(5), paddingBottom: sp(9), gap: sp(3),
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.pill, backgroundColor: '#333' },
  sheetTitle: { fontSize: font.h2, fontWeight: '700', color: D.text },

  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  sheetAvatar: {
    width: 52, height: 52, borderRadius: radius.pill, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetAvatarText: { fontSize: font.body, fontWeight: '700', color: D.text },
  sheetName: { fontSize: font.h2, fontWeight: '700', color: D.text },
  sheetStats: { flexDirection: 'row', gap: sp(2) },
  pendingBody: { fontSize: font.small, color: D.sub, lineHeight: 19 },

  fieldLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  splitValue: { fontSize: font.body, fontWeight: '700', color: D.text },
  splitMuted: { color: D.sub, fontWeight: '600' },

  rentRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: D.card2,
    borderRadius: radius.md, padding: sp(3.5),
  },
  rentText: { flex: 1, fontSize: font.small, color: D.sub },

  agentBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48,
    borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(232,71,79,0.4)', backgroundColor: 'rgba(232,71,79,0.1)',
  },
  agentText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
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
  earningsRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3), backgroundColor: D.card2,
    borderRadius: radius.md, padding: sp(3),
  },

  payoutHero: {
    backgroundColor: '#1D1416', borderWidth: 1, borderColor: '#332124',
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
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 48, borderRadius: radius.md, backgroundColor: D.card2,
  },
  actionText: { fontSize: font.small, fontWeight: '700', color: D.text },
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
  removeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48,
    borderRadius: radius.md, borderWidth: 1, borderColor: 'rgba(210,59,59,0.4)', backgroundColor: 'rgba(210,59,59,0.1)',
  },
  removeText: { fontSize: font.small, fontWeight: '700', color: colors.danger },

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
  sliderTrack: { height: 6, borderRadius: 3, backgroundColor: '#3A3A40', overflow: 'hidden' },
  sliderFill: { height: 6, backgroundColor: colors.accent },
  sliderKnob: {
    position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
    marginLeft: -10, top: 4,
  },
});
