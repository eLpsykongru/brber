import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { TAB_BAR_INSET } from '../components/ui';
import { colors, dark as D, font, radius, sp } from '../theme';

// Owner-only "Salon" tab — TEAM / SERVICES / SETTINGS. MOCK screen (like the
// dashboard/earnings mockups): faithful UI, mock data, wired later. Real backend
// items live in BACKLOG "Owner: salon management": staff approve/remove needs RLS,
// per-barber pay_model (rent|commission) + salon-level packages need schema.
// TODO(backlog): load the real salon + barbers; the arrays below are placeholders.

const dh = (n: number) => `${n.toLocaleString('en-US')} DH`;

type PayModel = 'commission' | 'rent';
type Status = 'in_service' | 'free' | 'break';
type Member = {
  id: string; name: string; role: string; chair: string; owner?: boolean;
  status: Status; nextName?: string; nextAt?: string;
  bookings: number; revenue: number; rating: number;
  pay: PayModel; split: number; rent?: number; // split = % to barber; rent in DH/mo
};

const SALON = { name: 'Atlas Barbershop', address: '12 Bd Pasteur · Tanger' };
const STATS = { onFloor: '4/4', bookings: 21, revenue: 1288, shopCut: 365 };

const TEAM: Member[] = [
  { id: 'me', name: 'You · Andre Cole', role: 'Owner', chair: 'Chair 01', owner: true,
    status: 'in_service', nextName: 'Julian R.', nextAt: '11:15', bookings: 7, revenue: 486, rating: 4.9, pay: 'commission', split: 100 },
  { id: 'b2', name: 'Youssef Alami', role: 'Senior barber', chair: 'Chair 02',
    status: 'free', bookings: 5, revenue: 312, rating: 4.8, pay: 'commission', split: 60 },
  { id: 'b3', name: 'Mehdi Tazi', role: 'Barber', chair: 'Chair 03',
    status: 'in_service', nextName: 'Ethan V.', nextAt: '11:30', bookings: 6, revenue: 358, rating: 4.7, pay: 'commission', split: 55 },
  { id: 'b4', name: 'Karim Bennani', role: 'Apprentice', chair: 'Chair 04',
    status: 'break', bookings: 3, revenue: 132, rating: 4.5, pay: 'rent', split: 100, rent: 1500 },
];

type Svc = { id: string; name: string; min: number; price: number; live: boolean };
const SERVICES: Svc[] = [
  { id: 's1', name: 'Skin Fade', min: 45, price: 42, live: true },
  { id: 's2', name: 'Skin Fade + Beard Sculpt', min: 60, price: 68, live: true },
  { id: 's3', name: 'Classic Taper', min: 30, price: 35, live: true },
  { id: 's4', name: 'Hot Towel Shave', min: 40, price: 48, live: true },
  { id: 's5', name: 'Kids Cut', min: 25, price: 25, live: false },
];

type Pkg = { id: string; name: string; items: string; price: number; saved: number; live: boolean };
const PACKAGES: Pkg[] = [
  { id: 'p1', name: 'The Full Service', items: 'Skin Fade + Beard + Hot Towel', price: 140, saved: 18, live: true },
  { id: 'p2', name: 'Groom & Go', items: 'Classic Taper + Beard Sculpt', price: 85, saved: 10, live: true },
];

const STATUS: Record<Status, { label: string; color: string }> = {
  in_service: { label: 'IN SERVICE', color: colors.accent },
  free: { label: 'FREE', color: '#3BD07A' },
  break: { label: 'BREAK', color: colors.star },
};

const initials = (n: string) => n.replace(/^You · /, '').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const soon = () => Alert.alert('Coming soon', 'See BACKLOG.md — Owner: salon management.');

export default function SalonScreen({ onBack }: { barberId: string; onBack?: () => void }) {
  const [seg, setSeg] = useState<'team' | 'services' | 'settings'>('services');
  const [member, setMember] = useState<Member | null>(null);
  const [invite, setInvite] = useState(false);

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
            <Text style={s.title}>{SALON.name}</Text>
          </View>
          <Pressable onPress={() => setSeg('settings')} hitSlop={8} accessibilityLabel="Settings"
            style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
            <Ionicons name="settings-outline" size={18} color={D.text} />
          </Pressable>
        </View>

        <View style={s.segment}>
          {(['team', 'services', 'settings'] as const).map((k) => (
            <Pressable key={k} onPress={() => setSeg(k)} accessibilityState={{ selected: seg === k }}
              style={[s.segItem, seg === k && s.segItemOn]}>
              <Text style={[s.segText, seg === k && s.segTextOn]}>{k.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <ShopHeader />

        {seg === 'team' && <TeamTab onOpen={setMember} onInvite={() => setInvite(true)} />}
        {seg === 'services' && <ServicesTab />}
        {seg === 'settings' && <SettingsTab />}
      </ScrollView>

      {member && <MemberSheet m={member} onClose={() => setMember(null)} />}
      {invite && <InviteSheet onClose={() => setInvite(false)} />}
    </View>
  );
}

function ShopHeader() {
  return (
    <View style={s.shopCard}>
      <View style={s.rowCenter}>
        <View style={[s.dot, { backgroundColor: '#3BD07A' }]} />
        <Text style={s.shopStatus}>SHOP OPEN</Text>
        <View style={s.grow} />
        <Pressable onPress={() => Alert.alert('Close shop?', 'Stops new bookings for all chairs today.', [
          { text: 'Cancel', style: 'cancel' }, { text: 'Close shop', style: 'destructive' }])}
          accessibilityLabel="Close shop"
          style={({ pressed }) => [s.powerBtn, pressed && s.pressed]}>
          <Ionicons name="power" size={18} color={colors.onAccent} />
        </Pressable>
      </View>
      <View style={s.rowCenter}>
        <Ionicons name="location-outline" size={13} color={D.sub} />
        <Text style={s.shopAddr}>{SALON.address}</Text>
      </View>
      <View style={s.statRow}>
        <Stat label="ON FLOOR" value={STATS.onFloor} />
        <Stat label="BOOKINGS" value={String(STATS.bookings)} />
        <Stat label="REVENUE" value={dh(STATS.revenue)} accent />
        <Stat label="SHOP CUT" value={dh(STATS.shopCut)} />
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

function TeamTab({ onOpen, onInvite }: { onOpen: (m: Member) => void; onInvite: () => void }) {
  return (
    <>
      <SectionHead label={`TEAM · ${TEAM.length} CHAIRS`} action="Invite" onAction={onInvite} />
      {TEAM.map((m) => {
        const st = STATUS[m.status];
        return (
          <Pressable key={m.id} onPress={() => onOpen(m)} accessibilityLabel={m.name}
            style={({ pressed }) => [s.memberRow, pressed && s.pressed]}>
            <View style={s.avatar}>
              <Text style={s.avatarText}>{initials(m.name)}</Text>
              <View style={[s.presence, { backgroundColor: st.color }]} />
            </View>
            <View style={s.grow}>
              <View style={s.rowCenter}>
                <Text style={s.memberName}>{m.name}</Text>
                {m.owner && <Text style={s.crown}>👑</Text>}
              </View>
              <Text style={s.memberMeta}>{m.role} · {m.chair}</Text>
            </View>
            <View style={s.memberRight}>
              <Text style={[s.statusPill, { color: st.color }]}>● {st.label}</Text>
              <Text style={s.memberSplit}>{m.pay === 'rent' ? 'Rent' : `${m.split}% split`}</Text>
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

function ServicesTab() {
  return (
    <>
      <SectionHead label={`MENU · ${SERVICES.filter((x) => x.live).length} LIVE`} action="Add" onAction={soon} />
      {SERVICES.map((x) => (
        <MenuRow key={x.id} icon="cut" title={x.name} meta={`${x.min}m · ${dh(x.price)}`} live={x.live} />
      ))}
      <SectionHead label={`PACKAGES · ${PACKAGES.filter((x) => x.live).length} LIVE`} action="Add" onAction={soon} />
      {PACKAGES.map((x) => (
        <MenuRow key={x.id} icon="pricetags" title={x.name} meta={`${x.items} · save ${dh(x.saved)}`}
          price={dh(x.price)} live={x.live} />
      ))}
    </>
  );
}

function MenuRow({ icon, title, meta, price, live }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; meta: string; price?: string; live: boolean;
}) {
  const [on, setOn] = useState(live);
  return (
    <View style={s.menuRow}>
      <View style={s.menuIcon}><Ionicons name={icon} size={18} color={colors.accent} /></View>
      <View style={s.grow}>
        <Text style={[s.menuName, !on && s.dim]}>{title}</Text>
        <Text style={s.menuMeta} numberOfLines={1}>{price ? `${price} · ${meta}` : meta}</Text>
      </View>
      <Switch value={on} onValueChange={setOn} trackColor={{ true: colors.accent, false: D.card2 }}
        thumbColor="#fff" />
    </View>
  );
}

const SETTINGS_ROWS: { icon: keyof typeof Ionicons.glyphMap; title: string; sub: string; done: boolean }[] = [
  { icon: 'business-outline', title: 'Salon profile', sub: 'Name, address, photos', done: true },   // Profile → Your profile
  { icon: 'time-outline', title: 'Opening hours', sub: 'Mon–Sun · 09:00–20:00', done: true },        // Profile → Schedule settings
  { icon: 'pricetag-outline', title: 'Default commission', sub: '55% to barber', done: false },
  { icon: 'shield-outline', title: 'Roles & permissions', sub: `${TEAM.length} members`, done: false },
  { icon: 'cash-outline', title: 'Payouts & taxes', sub: 'Weekly · Fridays', done: false },
  { icon: 'bar-chart-outline', title: 'Reports', sub: 'Revenue, retention', done: false },
];

function SettingsTab() {
  return (
    <View style={s.settingsCard}>
      {SETTINGS_ROWS.map((r, i) => (
        <Pressable key={r.title}
          onPress={() => r.done
            ? Alert.alert(r.title, 'Already built — lives in Profile. Deep-link from here is a follow-up.')
            : soon()}
          accessibilityLabel={r.title}
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

// ── Member detail sheet ───────────────────────────────────────────────────────
function MemberSheet({ m, onClose }: { m: Member; onClose: () => void }) {
  const [split, setSplit] = useState(m.split);
  const st = STATUS[m.status];
  const showMoney = m.pay === 'commission'; // rent barber keeps 100% → his book is private
  return (
    <Sheet onClose={onClose}>
      <View style={s.sheetHead}>
        <View style={s.sheetAvatar}>
          <Text style={s.sheetAvatarText}>{initials(m.name)}</Text>
          <View style={[s.presence, { backgroundColor: st.color }]} />
        </View>
        <View style={s.grow}>
          <View style={s.rowCenter}>
            <Text style={s.sheetName}>{m.name}</Text>
            {m.owner && <Text style={s.crown}>👑</Text>}
          </View>
          <Text style={s.memberMeta}>{m.role} · {m.chair}</Text>
        </View>
        <Text style={[s.statusPill, { color: st.color }]}>● {st.label}</Text>
      </View>

      <View style={s.sheetStats}>
        <Stat label="BOOKINGS" value={String(m.bookings)} />
        {showMoney && <Stat label="REVENUE" value={dh(m.revenue)} />}
        <View style={[s.statTile, s.statTileAccent]}>
          <Text style={s.statLabel}>RATING</Text>
          <View style={s.rowCenterTight}>
            <Ionicons name="star" size={13} color={colors.star} />
            <Text style={s.statValue}> {m.rating.toFixed(1)}</Text>
          </View>
        </View>
      </View>

      {m.status === 'in_service' && m.nextName && (
        <View style={s.inServiceCard}>
          <View style={s.grow}>
            <Text style={s.inServiceLabel}>IN SERVICE</Text>
            <Text style={s.inServiceName}>{m.nextName}</Text>
          </View>
          <Text style={s.inServiceNext}>next {m.nextAt}</Text>
        </View>
      )}

      {m.pay === 'commission' ? (
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
          <Text style={s.rentText}>Chair rental · {dh(m.rent ?? 0)}/mo — keeps 100%, revenue private</Text>
        </View>
      )}

      <View style={s.actionGrid}>
        <ActionBtn icon="chatbubble-outline" label="Message" onPress={soon} />
        <ActionBtn icon="call-outline" label="Call" onPress={soon} />
        <ActionBtn icon="calendar-outline" label="Schedule" onPress={soon} />
        <ActionBtn icon="shield-outline" label="Permissions" onPress={soon} />
      </View>

      {!m.owner && (
        <Pressable onPress={() => Alert.alert('Remove from salon?',
          `${m.name} loses this chair and falls back to a solo profile.`,
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: onClose }])}
          accessibilityLabel="Remove from salon"
          style={({ pressed }) => [s.removeBtn, pressed && s.pressed]}>
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text style={s.removeText}>Remove from salon</Text>
        </Pressable>
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

// ── Invite sheet — role + pay model (rent | commission) ───────────────────────
function InviteSheet({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('Barber');
  const [pay, setPay] = useState<PayModel>('commission');
  const [split, setSplit] = useState(55); // default commission (see Settings → Default commission)
  const [rent, setRent] = useState('');
  const link = 'brber.ma/join/CX8-42K';

  function send() {
    if (phone.trim().length < 6) return Alert.alert('Add a phone', "Enter the barber's number to send the invite.");
    const terms = pay === 'commission' ? `${split}% commission` : `${dh(parseInt(rent, 10) || 0)}/mo rent`;
    Alert.alert('Invite sent', `${role} · ${terms}. They join ${SALON.name} with their own chair once they accept.`);
    onClose();
  }

  return (
    <Sheet onClose={onClose}>
      <View style={s.rowCenter}>
        <View style={s.inviteIcon}><Ionicons name="person-add-outline" size={18} color={colors.accent} /></View>
        <View style={s.grow}>
          <Text style={s.sheetTitle}>Invite a barber</Text>
          <Text style={s.memberMeta}>They join {SALON.name} with their own chair</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close"
          style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
          <Ionicons name="close" size={18} color={D.text} />
        </Pressable>
      </View>

      <Text style={s.fieldLabel}>PHONE NUMBER</Text>
      <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad"
        placeholder="+212 6•• ••• •••" placeholderTextColor={D.sub} style={s.input}
        accessibilityLabel="Phone number" />

      <Text style={s.fieldLabel}>ROLE</Text>
      <Segmented options={['Senior', 'Barber', 'Apprentice']} value={role} onChange={setRole} />

      <Text style={s.fieldLabel}>PAY MODEL</Text>
      <Segmented options={['Commission', 'Rent']}
        value={pay === 'commission' ? 'Commission' : 'Rent'}
        onChange={(v) => setPay(v === 'Commission' ? 'commission' : 'rent')} />

      {pay === 'commission' ? (
        <>
          <View style={s.rowCenter}>
            <Text style={s.fieldLabel}>STARTING SPLIT</Text>
            <View style={s.grow} />
            <Text style={s.splitValue}>{split}% <Text style={s.splitMuted}>/ {100 - split}% shop</Text></Text>
          </View>
          <Split value={split} onChange={setSplit} editable />
          <Text style={s.payHint}>Shop takes a cut of each cut — the barber's revenue shows in your reports.</Text>
        </>
      ) : (
        <>
          <Text style={s.fieldLabel}>MONTHLY RENT (DH)</Text>
          <TextInput value={rent} onChangeText={setRent} keyboardType="number-pad"
            placeholder="1500" placeholderTextColor={D.sub} style={s.input}
            accessibilityLabel="Monthly rent in dirhams" />
          <Text style={s.payHint}>Barber keeps 100% and rents the chair — their revenue stays private.</Text>
        </>
      )}

      <View style={s.linkRow}>
        <Text style={s.linkText} numberOfLines={1}>{link}</Text>
        <Pressable onPress={() => Alert.alert('Invite link', link)} accessibilityLabel="Copy link"
          style={({ pressed }) => [s.copyBtn, pressed && s.pressed]}>
          <Ionicons name="copy-outline" size={14} color={D.text} />
          <Text style={s.copyText}>Copy</Text>
        </Pressable>
      </View>

      <Pressable onPress={send} accessibilityLabel="Send invite"
        style={({ pressed }) => [s.cta, pressed && s.pressed]}>
        <Ionicons name="paper-plane" size={16} color={colors.onAccent} />
        <Text style={s.ctaText}>Send invite</Text>
      </Pressable>
    </Sheet>
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

// ponytail: PanResponder slider, no dep — @react-native-community/slider only if a
// designer needs its finer affordances. Mock: local value, not persisted anywhere.
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
      <View style={s.sliderTrack}>
        <View style={[s.sliderFill, { width: `${value}%` }]} />
      </View>
      <View style={[s.sliderKnob, { left: `${value}%` }]} />
    </View>
  );
}

// ── shared bottom sheet ───────────────────────────────────────────────────────
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
  content: { padding: sp(5), paddingTop: sp(14), gap: sp(3), paddingBottom: TAB_BAR_INSET },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  dim: { color: D.sub },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: sp(2) },
  rowCenterTight: { flexDirection: 'row', alignItems: 'center' },

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

  // sheets
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

  inServiceCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: D.card2,
    borderRadius: radius.md, padding: sp(3.5),
  },
  inServiceLabel: { fontSize: 9, fontWeight: '700', color: D.sub, letterSpacing: 0.5 },
  inServiceName: { fontSize: font.body, fontWeight: '700', color: D.text, marginTop: 2 },
  inServiceNext: { fontSize: font.small, color: D.sub },

  fieldLabel: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1 },
  splitValue: { fontSize: font.body, fontWeight: '700', color: D.text },
  splitMuted: { color: D.sub, fontWeight: '600' },

  rentRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(2), backgroundColor: D.card2,
    borderRadius: radius.md, padding: sp(3.5),
  },
  rentText: { flex: 1, fontSize: font.small, color: D.sub },

  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: sp(2) },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: '48%', height: 48, borderRadius: radius.md, backgroundColor: D.card2,
  },
  actionText: { fontSize: font.small, fontWeight: '700', color: D.text },
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
  payHint: { fontSize: font.tiny, color: D.sub, lineHeight: 15 },

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
