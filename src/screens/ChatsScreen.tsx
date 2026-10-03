import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  FlatList, Image, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Empty } from '../components/ui';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { groupThreads, Thread as ThreadOf } from '../lib/threads';
import ReportProblemScreen, { CaseListRow, CaseRow, SupportCaseScreen } from './SupportScreens';
import { colors, font, radius, serif, shadow, sp, TOP_INSET } from '../theme';
import { Pushed } from '../components/motion';
import ChatScreen from './ChatScreen';
import { loc, tr } from '../lib/i18n';
import { loadUnread } from '../lib/unread';
import MyBookingScreen from './MyBookingScreen';

const LIVE = ['pending', 'confirmed'];

type Convo = {
  id: string;
  starts_at: string;
  status: string;
  services: { name: string } | null;
  barbers: {
    id: string;
    profiles: { full_name: string | null; avatar_url: string | null } | null;
    salon: { name: string } | null;
  } | null;
  last?: { body: string | null; image_path: string | null; created_at: string; sender_id: string } | null;
};

// what groupThreads needs, flattened off the nested join
type Row = Convo & { peer_id: string | null; last_at: string | null };
type Thread = ThreadOf<Row>;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(loc('en-US'), { hour: '2-digit', minute: '2-digit' });
}

// MSG-04: today's time, YESTERDAY, or the day
function fmtWhen(iso: string) {
  const d = new Date(iso);
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === new Date().toDateString()) return fmtTime(iso);
  if (d.toDateString() === y.toDateString()) return tr('YESTERDAY');
  return d.toLocaleDateString(loc('en-US'), { month: 'short', day: 'numeric' }).toUpperCase();
}

function Avatar({ url, name, size }: { url?: string | null; name: string; size: number }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View>
      {url
        ? <Image source={{ uri: url }} style={[st.avatar, { width: size, height: size, borderRadius: size / 2 }]} />
        : (
          <View style={[st.avatar, st.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={[st.avatarText, { fontSize: size * 0.36 }]}>{initials}</Text>
          </View>
        )}
      {/* no presence dot: nothing knows who is online (MSG) */}
    </View>
  );
}

// `head` is whoever spoke last, which is what the list should preview and sort
// by. It is the wrong place to WRITE once history is in scope: the newest
// message could be on a visit from last year. Send on the booking you still
// have - soonest upcoming, and only failing that the one you last spoke on.
function writeTarget(t: Thread) {
  const upcoming = t.rows.filter((r) => LIVE.includes(r.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return upcoming[0]?.id ?? t.head.id;
}

export default function ChatsScreen({ customerId, onChromeHidden, openBookingId }: {
  customerId: string; onChromeHidden: (hidden: boolean) => void;
  /** a message banner: open the thread that booking belongs to */
  openBookingId?: string;
}) {
  // CHT-04 - help is a second class of thread, kept above the barbers so a
  // payment problem is never buried under a haircut. Support you can start
  // any time; an ops case you cannot - it opens itself when money is queried.
  const [cases, setCases] = useState<CaseListRow[]>([]);
  // the thread only needs the case itself; the list rows carry the extras
  const [caseOpen, setCaseOpen] = useState<CaseRow | null>(null);
  const [reporting, setReporting] = useState(false);
  const [convos, setConvos] = useState<Convo[]>([]);
  // a thread is a person, not a booking - see writeTarget for which of his
  // bookings a new message actually lands on
  const [open, setOpen] = useState<Thread | null>(null);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  // MSG-08's two rows: the booking itself, or a report with the thread attached
  const [bookingOpen, setBookingOpen] = useState<string | null>(null);
  const [reportOn, setReportOn] = useState<string | undefined>();
  const refreshUnread = useCallback(() => {
    loadUnread().then((u) => setUnread(u.byPeer)).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    // every booking, not just the live ones - a chat tab that forgets a barber
    // the moment the haircut is done is not a chat tab. Capped, because this is
    // a list of conversations rather than an archive.
    const { data } = await supabase.from('bookings')
      .select('id, starts_at, status, services(name), barbers(id, profiles!barbers_id_fkey(full_name, avatar_url), salon:salons!salon_id(name))')
      .eq('customer_id', customerId)
      .order('starts_at', { ascending: false })
      .limit(100);
    const list = (data as unknown as Convo[]) ?? [];
    // one query for last message across all conversations, deduped client-side
    if (list.length) {
      const ids = list.map((c) => c.id);
      const { data: msgs } = await supabase.from('messages')
        .select('booking_id, body, image_path, created_at, sender_id')
        .in('booking_id', ids)
        .order('created_at', { ascending: false });
      const lastByBooking = new Map<string, Convo['last']>();
      for (const m of msgs ?? []) {
        if (!lastByBooking.has(m.booking_id)) {
          lastByBooking.set(m.booking_id, { body: m.body, image_path: m.image_path, created_at: m.created_at, sender_id: m.sender_id });
        }
      }
      for (const c of list) c.last = lastByBooking.get(c.id) ?? null;
    }
    setConvos(list);
  }, [customerId]);

  const loadCases = useCallback(() => {
    supabase.rpc('my_support_cases')
      .then(({ data }) => setCases((data ?? []) as CaseListRow[]));
  }, []);

  useEffect(() => { load(); loadCases(); refreshUnread(); }, [load, loadCases, refreshUnread]);

  // one row per barber, newest activity first. The row still says how many
  // upcoming bookings it stands for, rather than pretending the extra ones
  // were never there.
  const threads = useMemo(
    () => groupThreads(convos.map((c) => ({
      ...c, peer_id: c.barbers?.id ?? null, last_at: c.last?.created_at ?? null,
    })))
      // a past booking nobody ever messaged on is not a conversation, and a
      // chat list full of people you have never spoken to is worse than a
      // short one
      .filter((t) => t.rows.some((r) => LIVE.includes(r.status) || r.last_at)),
    [convos]);

  function openChat(t: Thread | null) {
    setOpen(t);
    onChromeHidden(!!t);
    // leaving a thread marks it read (ChatScreen); the list follows
    if (!t) { refreshUnread(); load(); }
  }

  const opened = useRef(false);
  useEffect(() => {
    if (!openBookingId || opened.current) return;
    const t = threads.find((x) => x.rows.some((r) => r.id === openBookingId));
    if (t) { opened.current = true; openChat(t); }
  }, [openBookingId, threads]);

  // Chats is a tab root; a thread, a case or the report form sit above it
  const closeHelp = () => {
    setCaseOpen(null); setReporting(false); onChromeHidden(false); loadCases();
  };
  useAndroidBack(open ? () => openChat(null) : (caseOpen || reporting) ? closeHelp : null);

  const q = query.trim().toLowerCase();
  const filtered = threads.filter((t) =>
    !q || t.head.barbers?.profiles?.full_name?.toLowerCase().includes(q));
  // MSG-05 — the Unread filter lists real threads, barbers and ops
  const unreadOf = (t: Thread) => (t.head.barbers?.id ? unread.get(t.head.barbers.id) ?? 0 : 0);
  const shown = tab === 'unread' ? filtered.filter((t) => unreadOf(t) > 0) : filtered;
  const unreadCases = cases.filter((c) => c.unread > 0);
  let unreadTotal = unreadCases.reduce((n, c) => n + c.unread, 0);
  threads.forEach((t) => { unreadTotal += unreadOf(t); });

  // built before the pushed screens below, so each can hand it over as
  // `behind` - the list then stays on stage and trails as you swipe back
  const list = (
    <View style={st.screen}>
      {/* dark header band */}
      <View style={st.header}>
        <View style={st.headerTop}>
          <View style={st.headerSide} />
          <Text style={st.headerTitle}>{tr('Chat')}</Text>
          <Pressable onPress={() => { setSearching((v) => !v); setQuery(''); }} hitSlop={8}
            accessibilityLabel={tr('Search chats')} style={st.headerSide}>
            <Ionicons name={searching ? 'close' : 'search'} size={20} color={colors.onAccent} />
          </Pressable>
        </View>
        {searching ? (
          <TextInput style={st.search} placeholder={tr('Search by name…')} placeholderTextColor={colors.tabInactiveText}
            value={query} onChangeText={setQuery} autoFocus />
        ) : null}
      </View>

      {/* tabs */}
      <View style={st.tabs}>
        <Pressable onPress={() => setTab('all')} style={st.tabBtn}>
          <Text style={[st.tabText, tab === 'all' && st.tabTextActive]}>{tr('All')}</Text>
          <View style={[st.tabCount, tab === 'all' && st.tabCountActive]}>
            <Text style={[st.tabCountText, tab === 'all' && st.tabCountTextActive]}>{filtered.length}</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setTab('unread')} style={st.tabBtn}>
          <Text style={[st.tabText, tab === 'unread' && st.tabTextActive]}>{tr('Unread')}</Text>
          {unreadTotal > 0 && (
            <View style={[st.tabCount, st.tabCountActive]}>
              <Text style={[st.tabCountText, st.tabCountTextActive]}>{unreadTotal > 99 ? '99+' : unreadTotal}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <FlatList
        data={shown}
        keyExtractor={({ head }) => head.barbers?.id ?? head.id}
        contentContainerStyle={st.list}
        ListHeaderComponent={q || (tab === 'unread' && !unreadCases.length) ? null : (
          <View style={st.helpBlock}>
            <Text style={st.section}>{tr('HELP')}</Text>
            {tab === 'all' && <Pressable onPress={() => { setReporting(true); onChromeHidden(true); }}
              accessibilityRole="button"
              style={({ pressed }) => [st.helpCard, pressed && st.rowPressed]}>
              <View style={st.helpIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.onAccent} />
              </View>
              <View style={st.rowBody}>
                <Text style={st.rowName}>{tr('Sterncut Support')}</Text>
                <Text style={st.rowPreview}>{tr('Message the Sterncut team')}</Text>
              </View>
              <Text style={st.start}>{tr('START')}</Text>
            </Pressable>}

            {/* an ops case is not something the customer can open - it opens
                itself when money is queried - so these rows only ever appear */}
            {(tab === 'unread' ? unreadCases : cases).map((c) => {
              const live = c.status === 'open';
              return (
                <Pressable key={c.id} onPress={() => { setCaseOpen(c); onChromeHidden(true); }}
                  accessibilityRole="button" accessibilityLabel={tr('Case {case_no}', { case_no: c.case_no })}
                  style={({ pressed }) => [st.helpCard, live && st.helpCardLive, pressed && st.rowPressed]}>
                  <View style={[st.helpIcon, live ? st.helpIconLive : st.helpIconDone]}>
                    <Ionicons name={live ? 'card-outline' : 'checkmark'} size={19}
                      color={live ? '#B0761E' : '#16A34A'} />
                  </View>
                  <View style={st.rowBody}>
                    <Text style={st.rowName} numberOfLines={1}>
                      {live ? tr('Ops desk') : tr('Ops desk · settled')} · {c.case_no}
                    </Text>
                    <Text style={st.rowPreview} numberOfLines={1}>
                      {c.detail || (c.salon ?? tr('Under review'))}
                    </Text>
                  </View>
                  {c.unread > 0
                    ? <View style={st.badge}><Text style={st.badgeText}>{c.unread}</Text></View>
                    : <Text style={st.rowTime}>{fmtTime(c.resolved_at ?? c.created_at)}</Text>}
                </Pressable>
              );
            })}

            {shown.length > 0 && <Text style={st.section}>{tr('BARBERS')}</Text>}
          </View>
        )}
        ListEmptyComponent={
          tab === 'unread' && threads.length + cases.length > 0 && !unreadCases.length
            ? (
              <View style={st.caught}>
                <Text style={st.caughtTitle}>{tr('ALL CAUGHT UP')}</Text>
                <Text style={st.caughtBody}>{tr('Messages you haven’t opened show up here.')}</Text>
                <Pressable onPress={() => setTab('all')} accessibilityRole="button"
                  style={({ pressed }) => [st.caughtBtn, pressed && st.rowPressed]}>
                  <Text style={st.caughtBtnText}>{tr('SEE ALL CHATS')}</Text>
                </Pressable>
              </View>
            )
            : tab === 'unread' ? null : <Empty icon="chatbubble-outline" title={tr('No chats yet')}
                text={tr('Chats appear here once you have a booking with a barber.')} />
        }
        renderItem={({ item: thread }) => {
          const item = thread.head;
          const upcoming = thread.rows.filter((r) => LIVE.includes(r.status)).length;
          const name = item.barbers?.profiles?.full_name ?? tr('Barber');
          const n = unreadOf(thread);
          const said = item.last?.image_path && !item.last.body ? tr('Photo') : item.last?.body ?? '';
          const preview = item.last
            ? (item.last.sender_id === customerId ? tr('You: {text}', { text: said }) : said)
            : tr('Booking at {salon}', { salon: item.barbers?.salon?.name ?? tr('salon') });
          return (
            <Pressable onPress={() => openChat(thread)}
              style={({ pressed }) => [st.row, pressed && st.rowPressed]}>
              <Avatar url={item.barbers?.profiles?.avatar_url} name={name} size={50} />
              <View style={st.rowBody}>
                <Text style={st.rowName} numberOfLines={1}>{name}</Text>
                <Text style={[st.rowPreview, n > 0 && st.rowPreviewNew]} numberOfLines={1}>{preview}</Text>
                {upcoming > 1 && (
                  <Text style={st.rowMore}>{tr('{upcoming} bookings with him coming up · one thread', { upcoming })}</Text>
                )}
              </View>
              {!!item.last && (
                <View style={st.rowSide}>
                  <Text style={[st.rowTime, n > 0 && st.rowTimeNew]}>{fmtWhen(item.last.created_at)}</Text>
                  {n > 0 && <View style={st.badge}><Text style={st.badgeText}>{n}</Text></View>}
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );

  if (caseOpen) {
    return (
      <Pushed onBack={closeHelp} behind={list}>
        <SupportCaseScreen caseRow={caseOpen} myId={customerId} onBack={closeHelp} />
      </Pushed>
    );
  }
  if (reporting) {
    return (
      <Pushed onBack={closeHelp} behind={list}>
        <ReportProblemScreen onBack={() => { setReportOn(undefined); closeHelp(); }} bookingId={reportOn}
          onOpenCase={(c) => { setReporting(false); setCaseOpen(c); }} />
      </Pushed>
    );
  }

  if (open && bookingOpen) {
    return <MyBookingScreen bookingId={bookingOpen} myId={customerId} onBack={() => setBookingOpen(null)}
      onReport={(id) => { setBookingOpen(null); setReportOn(id); openChat(null); setReporting(true); onChromeHidden(true); }} />;
  }
  if (open) {
    const target = open.rows.find((r) => r.id === writeTarget(open)) ?? open.head;
    const at = new Date(target.starts_at);
    return (
      <Pushed onBack={() => openChat(null)} behind={list}>
        <ChatScreen bookingId={target.id} threadWith={open.head.barbers?.id} myId={customerId}
          title={open.head.barbers?.profiles?.full_name ?? tr('Former barber')}
          subtitle={open.head.barbers?.salon?.name
            ? tr('{shop} · Booking chat', { shop: open.head.barbers.salon.name }) : undefined}
          avatarUrl={open.head.barbers?.profiles?.avatar_url ?? undefined}
          onOpenBooking={() => setBookingOpen(target.id)}
          bookingLine={[at.toLocaleDateString(loc('en-GB'), { weekday: 'short', day: 'numeric', month: 'short' }),
            at.toTimeString().slice(0, 5), target.services?.name].filter(Boolean).join(' · ')}
          onReport={() => { setReportOn(target.id); openChat(null); setReporting(true); onChromeHidden(true); }}
          onBack={() => openChat(null)} />
      </Pushed>
    );
  }

  return list;
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.tabBg, paddingTop: TOP_INSET, paddingBottom: sp(4), paddingHorizontal: sp(5),
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSide: { width: 40, alignItems: 'center' },
  headerTitle: {
    flex: 1, textAlign: 'center', fontFamily: serif, fontSize: font.h2,
    letterSpacing: 0.7, textTransform: 'uppercase', color: colors.onAccent,
  },
  search: {
    marginTop: sp(3), backgroundColor: colors.tabActive, borderRadius: radius.pill,
    paddingHorizontal: sp(4), minHeight: 44, color: colors.onAccent, fontSize: font.body,
  },

  avatar: {},
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: colors.accent },

  tabs: { flexDirection: 'row', gap: sp(5), paddingHorizontal: sp(5), paddingVertical: sp(3) },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  tabText: { fontSize: font.body, fontWeight: '600', color: colors.textTertiary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabCount: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.fill,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  tabCountActive: { backgroundColor: colors.accent },
  tabCountText: { fontSize: font.tiny, fontWeight: '700', color: colors.textSecondary },
  tabCountTextActive: { color: colors.onAccent },

  list: { paddingHorizontal: sp(5), gap: sp(2), paddingBottom: sp(28) },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3), paddingVertical: sp(2.5),
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.fill },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  rowMore: { fontSize: 11, color: colors.textTertiary, marginTop: 2 },
  helpBlock: { gap: 10, marginBottom: 4 },
  section: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.8, color: colors.textTertiary,
    marginTop: 4,
  },
  helpCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 18, padding: 14, ...shadow,
  },
  helpCardLive: { borderWidth: 1.5, borderColor: '#E8A33D' },
  helpIcon: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  helpIconLive: { backgroundColor: 'rgba(232,163,61,0.16)' },
  helpIconDone: { backgroundColor: 'rgba(74,222,128,0.16)' },
  start: { fontSize: 11, fontWeight: '700', color: colors.accent, letterSpacing: 0.4 },
  badge: {
    minWidth: 18, height: 18, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.onAccent },
  rowPreview: { fontSize: font.small, color: colors.textSecondary },
  rowTime: { fontSize: 10.5, color: colors.textSecondary },
  rowTimeNew: { color: colors.accent, fontWeight: '700' },
  rowPreviewNew: { color: colors.text, fontWeight: '600' },
  rowSide: { alignItems: 'flex-end', gap: 5 },
  caught: { alignItems: 'center', gap: 10, paddingTop: sp(12), paddingHorizontal: sp(6) },
  caughtTitle: { fontFamily: serif, fontSize: 22, letterSpacing: 0.4, color: colors.text, textAlign: 'center' },
  caughtBody: { fontSize: 13.5, lineHeight: 20, color: colors.textDim, textAlign: 'center' },
  caughtBtn: { marginTop: 8, height: 52, paddingHorizontal: 26, borderRadius: 999, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  caughtBtnText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1.3 },
});
