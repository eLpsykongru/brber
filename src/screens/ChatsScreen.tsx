import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Empty } from '../components/ui';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import { groupThreads, Thread as ThreadOf } from '../lib/threads';
import ReportProblemScreen, { CaseListRow, CaseRow, SupportCaseScreen } from './SupportScreens';
import { colors, font, radius, serif, shadow, sp } from '../theme';
import ChatScreen from './ChatScreen';

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
  last?: { body: string | null; image_path: string | null; created_at: string } | null;
};

// what groupThreads needs, flattened off the nested join
type Row = Convo & { peer_id: string | null; last_at: string | null };
type Thread = ThreadOf<Row>;

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function Avatar({ url, name, size, online }: { url?: string | null; name: string; size: number; online?: boolean }) {
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
      {/* TODO(backlog): real presence — dot is decorative */}
      {online && <View style={st.onlineDot} />}
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

export default function ChatsScreen({ customerId, onChromeHidden }: {
  customerId: string; onChromeHidden: (hidden: boolean) => void;
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
        .select('booking_id, body, image_path, created_at')
        .in('booking_id', ids)
        .order('created_at', { ascending: false });
      const lastByBooking = new Map<string, Convo['last']>();
      for (const m of msgs ?? []) {
        if (!lastByBooking.has(m.booking_id)) {
          lastByBooking.set(m.booking_id, { body: m.body, image_path: m.image_path, created_at: m.created_at });
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

  useEffect(() => { load(); loadCases(); }, [load, loadCases]);

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
  }

  // Chats is a tab root; a thread, a case or the report form sit above it
  const closeHelp = () => {
    setCaseOpen(null); setReporting(false); onChromeHidden(false); loadCases();
  };
  useAndroidBack(open ? () => openChat(null) : (caseOpen || reporting) ? closeHelp : null);

  if (caseOpen) {
    return <SupportCaseScreen caseRow={caseOpen} myId={customerId} onBack={closeHelp} />;
  }
  if (reporting) {
    return <ReportProblemScreen onBack={closeHelp}
      onOpenCase={(c) => { setReporting(false); setCaseOpen(c); }} />;
  }

  if (open) {
    return <ChatScreen bookingId={writeTarget(open)} threadWith={open.head.barbers?.id} myId={customerId}
      title={open.head.barbers?.profiles?.full_name ?? 'Chat'}
      subtitle={open.head.barbers?.salon?.name ?? undefined}
      avatarUrl={open.head.barbers?.profiles?.avatar_url ?? undefined}
      onBack={() => openChat(null)} />;
  }

  const q = query.trim().toLowerCase();
  const filtered = threads.filter((t) =>
    !q || t.head.barbers?.profiles?.full_name?.toLowerCase().includes(q));
  // TODO(backlog): real unread — nothing marked unread yet
  const shown = tab === 'unread' ? [] : filtered;

  return (
    <View style={st.screen}>
      {/* dark header band */}
      <View style={st.header}>
        <View style={st.headerTop}>
          <View style={st.headerSide} />
          <Text style={st.headerTitle}>Chat</Text>
          <Pressable onPress={() => { setSearching((v) => !v); setQuery(''); }} hitSlop={8}
            accessibilityLabel="Search chats" style={st.headerSide}>
            <Ionicons name={searching ? 'close' : 'search'} size={20} color={colors.onAccent} />
          </Pressable>
        </View>
        {searching ? (
          <TextInput style={st.search} placeholder="Search by name…" placeholderTextColor={colors.tabInactiveText}
            value={query} onChangeText={setQuery} autoFocus />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.strip}>
            <View style={st.stripRow}>
              {threads.map((t) => (
                <Pressable key={t.head.barbers?.id ?? t.head.id} style={st.stripItem}
                  onPress={() => openChat(t)}>
                  <Avatar url={t.head.barbers?.profiles?.avatar_url}
                    name={t.head.barbers?.profiles?.full_name ?? 'B'} size={56} online />
                  <Text style={st.stripName} numberOfLines={1}>
                    {(t.head.barbers?.profiles?.full_name ?? 'Barber').split(' ')[0]}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      {/* tabs */}
      <View style={st.tabs}>
        <Pressable onPress={() => setTab('all')} style={st.tabBtn}>
          <Text style={[st.tabText, tab === 'all' && st.tabTextActive]}>All</Text>
          <View style={[st.tabCount, tab === 'all' && st.tabCountActive]}>
            <Text style={[st.tabCountText, tab === 'all' && st.tabCountTextActive]}>{filtered.length}</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => setTab('unread')} style={st.tabBtn}>
          <Text style={[st.tabText, tab === 'unread' && st.tabTextActive]}>Unread</Text>
        </Pressable>
      </View>

      <FlatList
        data={shown}
        keyExtractor={({ head }) => head.barbers?.id ?? head.id}
        contentContainerStyle={st.list}
        ListHeaderComponent={q || tab === 'unread' ? null : (
          <View style={st.helpBlock}>
            <Text style={st.section}>HELP</Text>
            <Pressable onPress={() => { setReporting(true); onChromeHidden(true); }}
              accessibilityRole="button"
              style={({ pressed }) => [st.helpCard, pressed && st.rowPressed]}>
              <View style={st.helpIcon}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.onAccent} />
              </View>
              <View style={st.rowBody}>
                <Text style={st.rowName}>Sterncut Support</Text>
                <Text style={st.rowPreview}>Reviewed within 24 hours</Text>
              </View>
              <Text style={st.start}>START</Text>
            </Pressable>

            {/* an ops case is not something the customer can open - it opens
                itself when money is queried - so these rows only ever appear */}
            {cases.map((c) => {
              const live = c.status === 'open';
              return (
                <Pressable key={c.id} onPress={() => { setCaseOpen(c); onChromeHidden(true); }}
                  accessibilityRole="button" accessibilityLabel={`Case ${c.case_no}`}
                  style={({ pressed }) => [st.helpCard, live && st.helpCardLive, pressed && st.rowPressed]}>
                  <View style={[st.helpIcon, live ? st.helpIconLive : st.helpIconDone]}>
                    <Ionicons name={live ? 'card-outline' : 'checkmark'} size={19}
                      color={live ? '#B0761E' : '#16A34A'} />
                  </View>
                  <View style={st.rowBody}>
                    <Text style={st.rowName} numberOfLines={1}>
                      {live ? 'Ops desk' : 'Ops desk · settled'} · {c.case_no}
                    </Text>
                    <Text style={st.rowPreview} numberOfLines={1}>
                      {c.detail || (c.salon ?? 'Under review')}
                    </Text>
                  </View>
                  {c.unread > 0
                    ? <View style={st.badge}><Text style={st.badgeText}>{c.unread}</Text></View>
                    : <Text style={st.rowTime}>{fmtTime(c.resolved_at ?? c.created_at)}</Text>}
                </Pressable>
              );
            })}

            {shown.length > 0 && <Text style={st.section}>BARBERS</Text>}
          </View>
        )}
        ListEmptyComponent={
          tab === 'unread'
            ? <Empty text="Unread tracking coming soon." />
            : <Empty icon="chatbubble-outline" title="No chats yet"
                text="Chats appear here once you have a booking with a barber." />
        }
        renderItem={({ item: thread }) => {
          const item = thread.head;
          const upcoming = thread.rows.filter((r) => LIVE.includes(r.status)).length;
          const name = item.barbers?.profiles?.full_name ?? 'Barber';
          const preview = item.last
            ? (item.last.image_path ? '📷 Photo' : item.last.body ?? '')
            : `Booking at ${item.barbers?.salon?.name ?? 'salon'}`;
          return (
            <Pressable onPress={() => openChat(thread)}
              style={({ pressed }) => [st.row, pressed && st.rowPressed]}>
              <Avatar url={item.barbers?.profiles?.avatar_url} name={name} size={52} online />
              <View style={st.rowBody}>
                <Text style={st.rowName} numberOfLines={1}>{name}</Text>
                <Text style={st.rowPreview} numberOfLines={1}>{preview}</Text>
                {upcoming > 1 && (
                  <Text style={st.rowMore}>{upcoming} bookings with him coming up · one thread</Text>
                )}
              </View>
              {!!item.last && <Text style={st.rowTime}>{fmtTime(item.last.created_at)}</Text>}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  header: {
    backgroundColor: colors.tabBg, paddingTop: sp(14), paddingBottom: sp(4), paddingHorizontal: sp(5),
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
  strip: { marginTop: sp(3) },
  stripRow: { flexDirection: 'row', gap: sp(4) },
  stripItem: { alignItems: 'center', gap: sp(1), width: 64 },
  stripName: { fontSize: font.tiny, color: colors.onAccent, fontWeight: '600' },

  avatar: {},
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700', color: colors.accent },
  onlineDot: {
    position: 'absolute', right: 2, bottom: 2, width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#4ADE80', borderWidth: 2, borderColor: colors.surface,
  },

  tabs: { flexDirection: 'row', gap: sp(5), paddingHorizontal: sp(5), paddingVertical: sp(3) },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  tabText: { fontSize: font.body, fontWeight: '600', color: colors.textTertiary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabCount: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#E9E6DE',
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
  rowPressed: { backgroundColor: '#ECE9E2' },
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
    width: 46, height: 46, borderRadius: 14, backgroundColor: colors.text,
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
  rowTime: { fontSize: font.tiny, color: colors.textTertiary },
});
