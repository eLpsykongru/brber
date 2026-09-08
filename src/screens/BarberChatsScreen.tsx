import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar, Eyebrow, Serif, T, TAB_INSET } from '../components/dark';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { groupThreads, Thread as ThreadOf } from '../lib/threads';
import { dark as d, radius, sp } from '../theme';
import { BarberCaseScreen, CaseRow } from './BarberSupportScreens';
import { Pushed } from '../components/motion';
import ChatScreen from './ChatScreen';

// BMS-03 / BMS-04 — the barber had threads (BMS-01, BMS-02) and nowhere they
// lived. Clients and Ops share one inbox because he checks his phone once
// between cuts, but they stay separate tabs: a client message costs him a
// reply, an ops message can cost him money.
//
// Ops threads can't be started here — they arrive. Filing one goes through
// Report a problem in Help Center, which is what the footer note says.

const LIVE = ['pending', 'confirmed'];

type Convo = {
  id: string;
  starts_at: string;
  status: string;
  walk_in_name: string | null;
  customer_id: string;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
  last?: { body: string | null; image_path: string | null; created_at: string } | null;
};

type Row = Convo & { peer_id: string | null; last_at: string | null };
type Thread = ThreadOf<Row>;

const initials = (n: string) =>
  n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function stamp(iso: string) {
  const d0 = new Date(iso);
  if (isToday(iso)) return hhmm(iso);
  return d0.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

// a new message belongs on the booking he still has, not on the visit they
// last spoke about — which with history in scope can be a year old
function writeTarget(t: Thread) {
  const upcoming = t.rows.filter((r) => LIVE.includes(r.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return upcoming[0]?.id ?? t.head.id;
}

export default function BarberChatsScreen({ barberId, onChromeHidden, onHelp }: {
  barberId: string;
  onChromeHidden?: (hidden: boolean) => void;
  /** Help Center — the only door to a NEW ops thread (BMS-04's footer note) */
  onHelp?: () => void;
}) {
  const [tab, setTab] = useState<'clients' | 'ops'>('clients');
  const [convos, setConvos] = useState<Convo[] | null>(null);
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [open, setOpen] = useState<Thread | null>(null);
  const [openCase, setOpenCase] = useState<CaseRow | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('bookings')
      .select('id, starts_at, status, walk_in_name, customer_id, services(name),'
        + ' customer:profiles!customer_id(full_name)')
      .eq('barber_id', barberId)
      // a walk-in has no account and therefore no thread; without this every
      // walk-in he has ever taken would pool into one conversation
      .neq('customer_id', barberId)
      .order('starts_at', { ascending: false })
      .limit(100);
    const list = (data as unknown as Convo[]) ?? [];
    if (list.length) {
      const { data: msgs } = await supabase.from('messages')
        .select('booking_id, body, image_path, created_at')
        .in('booking_id', list.map((c) => c.id))
        .order('created_at', { ascending: false });
      const lastOf = new Map<string, Convo['last']>();
      for (const m of msgs ?? []) {
        if (!lastOf.has(m.booking_id)) {
          lastOf.set(m.booking_id, { body: m.body, image_path: m.image_path, created_at: m.created_at });
        }
      }
      for (const c of list) c.last = lastOf.get(c.id) ?? null;
    }
    setConvos(list);

    const { data: cs, error } = await supabase.rpc('my_support_cases');
    if (error) Alert.alert('Could not load cases', error.message);
    setCases((cs ?? []) as CaseRow[]);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  const threads = useMemo(
    () => groupThreads((convos ?? []).map((c) => ({
      ...c, peer_id: c.customer_id, last_at: c.last?.created_at ?? null,
    })))
      // a past booking nobody messaged on is not a conversation
      .filter((t) => t.rows.some((r) => LIVE.includes(r.status) || r.last_at)),
    [convos]);

  // in the chair today gets its own card; everyone else is a plain row
  const today = threads.filter((t) => t.rows.some((r) => isToday(r.starts_at) && LIVE.includes(r.status)));
  const earlier = threads.filter((t) => !today.includes(t));
  const opsUnread = (cases ?? []).reduce((n, c) => n + (c.unread || 0), 0);
  const opsOpen = (cases ?? []).filter((c) => c.status === 'open');
  const opsDone = (cases ?? []).filter((c) => c.status !== 'open');

  function openThread(t: Thread | null) {
    setOpen(t);
    onChromeHidden?.(!!t);
  }
  function showCase(c: CaseRow | null) {
    setOpenCase(c);
    onChromeHidden?.(!!c);
  }

  useAndroidBack(open ? () => openThread(null) : openCase ? () => showCase(null) : null);

  // built before the pushed screens below, so each can hand it over as
  // `behind` - the inbox then stays on stage and trails as you swipe back
  const inbox = (
    <View style={s.screen}>
      <View style={s.head}>
        <Serif size={20} ls={0.8}>MESSAGES</Serif>
        <View style={s.tabs}>
          <Tab label="Clients" count={threads.length} on={tab === 'clients'}
            onPress={() => setTab('clients')} />
          <Tab label="Ops" count={opsOpen.length} on={tab === 'ops'} warn={opsUnread > 0}
            onPress={() => setTab('ops')} />
        </View>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {(convos === null || cases === null) && <ActivityIndicator color={d.accent} style={s.spin} />}

        {tab === 'clients' && convos !== null && (threads.length === 0 ? (
          <Empty icon="chatbubble-outline" title="No client messages"
            text="A thread opens itself once somebody books you." />
        ) : (
          <>
            {today.length > 0 && <Eyebrow>IN THE CHAIR TODAY</Eyebrow>}
            {today.map((t) => <ClientRow key={t.head.customer_id} t={t} live onPress={() => openThread(t)} />)}
            {earlier.length > 0 && <Eyebrow style={s.gap}>EARLIER</Eyebrow>}
            {earlier.map((t) => <ClientRow key={t.head.customer_id} t={t} onPress={() => openThread(t)} />)}
          </>
        ))}

        {tab === 'ops' && cases !== null && (
          <>
            {opsOpen.length > 0 && <Eyebrow>NEEDS YOU</Eyebrow>}
            {opsOpen.map((c) => <CaseCard key={c.id} c={c} onPress={() => showCase(c)} />)}
            {opsDone.length > 0 && <Eyebrow style={opsOpen.length ? s.gap : undefined}>SETTLED</Eyebrow>}
            {opsDone.map((c) => <CaseCard key={c.id} c={c} onPress={() => showCase(c)} />)}
            {cases.length === 0 && (
              <Empty icon="shield-checkmark-outline" title="Nothing from ops"
                text="If money or a rating is ever queried, the thread appears here." />
            )}
            {/* BMS-04 — he cannot start one of these, and being told so beats
                hunting for a compose button that was never going to exist */}
            <View style={s.note}>
              <Ionicons name="information-circle-outline" size={15} color={d.sub} />
              <T size={11} c={d.sub} style={s.noteText}>
                Ops opens these threads. Need something else?{' '}
                <T size={11} c={d.accent} w="b" onPress={onHelp}>Report a problem</T>
              </T>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );

  if (open) {
    const name = open.head.customer?.full_name ?? open.head.walk_in_name ?? 'Client';
    return (
      <Pushed onBack={() => { openThread(null); load(); }} behind={inbox}>
        <ChatScreen dark bookingId={writeTarget(open)} threadWith={open.head.customer_id}
      myId={barberId} title={name}
      subtitle={`${isToday(open.head.starts_at) ? 'Today' : stamp(open.head.starts_at)} `
        + `${hhmm(open.head.starts_at)} · ${open.head.services?.name ?? 'Service'}`}
          onBack={() => { openThread(null); load(); }} />
      </Pushed>
    );
  }
  if (openCase) {
    return (
      <Pushed onBack={() => { showCase(null); load(); }} behind={inbox}>
        <BarberCaseScreen caseRow={openCase} myId={barberId}
          onBack={() => { showCase(null); load(); }} />
      </Pushed>
    );
  }

  return inbox;
}

function Tab({ label, count, on, warn, onPress }: {
  label: string; count: number; on: boolean; warn?: boolean; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }}
      style={[s.tab, on && s.tabOn]}>
      <T size={13.5} w={on ? 'b' : 'sb'} c={on ? d.text : d.sub}>{label}</T>
      {count > 0 && (
        <View style={[s.pill, on && s.pillOn, warn && !on && s.pillWarn]}>
          <T size={10.5} w="b" c={on || warn ? '#fff' : d.sub}>{count}</T>
        </View>
      )}
    </Pressable>
  );
}

function ClientRow({ t, live, onPress }: { t: Thread; live?: boolean; onPress: () => void }) {
  const b = t.head;
  const name = b.customer?.full_name ?? b.walk_in_name ?? 'Client';
  // ponytail: no unread badge — `messages` has no read tracking on either
  // side (the customer's Unread tab says so too). Add when it exists.
  const preview = b.last
    ? (b.last.image_path ? '📷 Photo' : b.last.body ?? '')
    : `${b.services?.name ?? 'Booking'} · nothing said yet`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={name}
      style={({ pressed }) => [live ? s.liveCard : s.row, pressed && s.pressed]}>
      <Avatar initials={initials(name)} size={live ? 46 : 44} warm={live}
        dot={live ? d.green : undefined} />
      <View style={s.grow}>
        <T size={13.5} w="b" numberOfLines={1}>{name}</T>
        <T size={11.5} c={d.sub} numberOfLines={1} style={s.preview}>{preview}</T>
        {live && (
          <View style={s.slotChip}>
            <T size={10} w="b" c={d.accent}>{hhmm(b.starts_at)}</T>
            <T size={10} c={d.sub}>{b.services?.name ?? 'Service'}</T>
          </View>
        )}
      </View>
      <T size={10} c={d.sub}>{b.last ? stamp(b.last.created_at) : stamp(b.starts_at)}</T>
    </Pressable>
  );
}

const REASON_LABEL: Record<string, string> = {
  no_show: 'No-show', wrong_amount: 'Wrong amount', wrong_service: 'Wrong service',
  hygiene: 'Hygiene', payout: 'Payout', client: 'A client', booking: 'A booking',
  other: 'Something else',
};

function CaseCard({ c, onPress }: { c: CaseRow; onPress: () => void }) {
  const open = c.status === 'open';
  return (
    <Pressable onPress={onPress} accessibilityRole="button"
      style={({ pressed }) => [s.caseCard, open && s.caseOpen, pressed && s.pressed]}>
      <View style={[s.caseIcon, open && s.caseIconOpen]}>
        <Ionicons name={open ? 'alert-circle-outline' : 'checkmark-circle-outline'}
          size={18} color={open ? d.amber : d.sub} />
      </View>
      <View style={s.grow}>
        <T size={13.5} w="b" numberOfLines={1}>
          {c.case_no} · {REASON_LABEL[c.reason] ?? c.reason}
        </T>
        <T size={11.5} c={d.sub} numberOfLines={1} style={s.preview}>
          {c.detail || (c.other ?? c.salon ?? 'Opened by ops')}
        </T>
      </View>
      <View style={s.caseEnd}>
        <T size={10} c={d.sub}>{stamp(c.resolved_at ?? c.created_at)}</T>
        {c.unread > 0
          ? <View style={s.unread}><T size={10} w="b" c="#fff">{c.unread}</T></View>
          : !open && <View style={s.closed}><T size={9.5} w="b" c={d.green}>CLOSED</T></View>}
      </View>
    </Pressable>
  );
}

function Empty({ icon, title, text }: {
  icon: keyof typeof Ionicons.glyphMap; title: string; text: string;
}) {
  return (
    <View style={s.empty}>
      <View style={s.emptyRing}><Ionicons name={icon} size={30} color={d.sub} /></View>
      <Serif size={18}>{title.toUpperCase()}</Serif>
      <T size={12.5} c={d.sub} style={s.emptyText}>{text}</T>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: d.bg },
  head: {
    backgroundColor: d.card, borderBottomWidth: 1, borderBottomColor: d.border,
    paddingTop: sp(14), paddingHorizontal: sp(4),
  },
  tabs: { flexDirection: 'row', gap: sp(5.5), marginTop: sp(4) },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingBottom: 11,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabOn: { borderBottomColor: d.accent },
  pill: {
    minWidth: 19, height: 19, borderRadius: radius.pill, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  pillOn: { backgroundColor: d.accent },
  pillWarn: { backgroundColor: d.amber },

  body: { padding: sp(4), gap: sp(2.5), paddingBottom: TAB_INSET },
  spin: { marginTop: sp(10) },
  gap: { marginTop: sp(3) },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  preview: { marginTop: 2 },

  liveCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: d.card,
    borderRadius: 16, padding: 13, borderWidth: 1, borderColor: 'rgba(232,68,46,0.35)',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: d.border,
  },
  slotChip: {
    flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 5, marginTop: 6,
    backgroundColor: d.card2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },

  caseCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: d.card,
    borderRadius: 16, padding: 14,
  },
  caseOpen: { borderWidth: 1, borderColor: d.amberLine },
  caseIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: d.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  caseIconOpen: { backgroundColor: d.amberSoft16 },
  caseEnd: { alignItems: 'flex-end', gap: 6 },
  unread: {
    minWidth: 18, height: 18, borderRadius: radius.pill, backgroundColor: d.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  closed: {
    backgroundColor: d.greenSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 3,
  },

  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: sp(2),
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 14, padding: 12,
  },
  noteText: { flex: 1, lineHeight: 17 },

  empty: { alignItems: 'center', gap: 12, paddingTop: sp(20) },
  emptyRing: {
    width: 84, height: 84, borderRadius: radius.pill, borderWidth: 1.5,
    borderColor: d.muted, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { textAlign: 'center', maxWidth: 250, lineHeight: 18 },
});
