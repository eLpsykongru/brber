import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, TextInput, View } from 'react-native';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import { Avatar, Eyebrow, Ico, Serif, Stars, T, TAB_INSET } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D, inter } from '../theme';
import ChatScreen from './ChatScreen';

// Client book v1 (BACKLOG bet #3, partial): everyone who ever sat in the chair,
// aggregated from booking history. Preferences + debt ledger are still TODO.
// Layout is 1g in "Barber App.dc.html".
type Row = {
  id: string;
  starts_at: string;
  status: string;
  customer_id: string;
  walk_in_name: string | null;
  customer: { full_name: string | null; avatar_url: string | null; phone: string | null } | null;
};

type Client = {
  key: string;
  name: string;
  avatar: string | null;
  phone: string | null;
  isWalkIn: boolean;
  walkInName: string | null; // raw grouping key for walk-ins
  visits: number;
  noShows: number;
  lastVisit: string;      // ISO of most recent booking
  lastBookingId: string;  // chat entry point
};

const REGULAR_VISITS = 3; // ponytail: 3+ cuts is a regular until someone says otherwise

function agoLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const m = Math.floor(days / 30);
  return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`;
}

export default function ClientsScreen({ barberId, onChromeHidden }: {
  barberId: string; onChromeHidden?: (hidden: boolean) => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [query, setQuery] = useState('');
  const [sheetClient, setSheetClient] = useState<ClientRef | null>(null);
  const [chat, setChat] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('bookings')
      .select('id, starts_at, status, customer_id, walk_in_name, customer:profiles!customer_id(full_name, avatar_url, phone)')
      .eq('barber_id', barberId)
      .in('status', ['confirmed', 'no_show'])
      .lt('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: false });
    if (error) return Alert.alert('Could not load clients', error.message);

    const map = new Map<string, Client>();
    for (const r of (data as unknown as Row[])) {
      const isWalkIn = r.customer_id === barberId;
      const key = isWalkIn ? `w:${(r.walk_in_name ?? 'Walk-in').trim().toLowerCase()}` : r.customer_id;
      const c = map.get(key) ?? {
        key,
        name: isWalkIn ? (r.walk_in_name ?? 'Walk-in') : (r.customer?.full_name ?? 'Client'),
        avatar: isWalkIn ? null : r.customer?.avatar_url ?? null,
        phone: isWalkIn ? null : r.customer?.phone ?? null,
        isWalkIn,
        walkInName: isWalkIn ? r.walk_in_name : null,
        visits: 0, noShows: 0,
        lastVisit: r.starts_at, lastBookingId: r.id, // rows arrive newest-first
      };
      if (r.status === 'no_show') c.noShows++; else c.visits++;
      map.set(key, c);
    }
    setClients([...map.values()]); // newest-first insertion order = most recent client first
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  function openChat(req: { id: string; title: string } | null) {
    setSheetClient(null);
    setChat(req);
    onChromeHidden?.(!!req);
  }

  if (chat) {
    return <ChatScreen dark bookingId={chat.id} myId={barberId}
      title={chat.title} onBack={() => openChat(null)} />;
  }

  const q = query.trim().toLowerCase();
  const visible = clients.filter((c) => !q || c.name.toLowerCase().includes(q));
  const regulars = clients.filter((c) => c.visits >= REGULAR_VISITS).length;
  const noShows = clients.reduce((a, c) => a + c.noShows, 0);

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <Serif size={17} ls={0.18} style={s.title}>Clients</Serif>
        <View style={s.search}>
          <Ico name="search" size={16} color={D.sub} />
          <TextInput value={query} onChangeText={setQuery}
            placeholder="Search clients" placeholderTextColor={D.sub}
            accessibilityLabel="Search clients" style={s.searchInput} />
        </View>
        <View style={s.tiles}>
          <Tile label="TOTAL" value={String(clients.length)} />
          <Tile label="REGULARS" value={String(regulars)} />
          <Tile label="NO-SHOWS" value={String(noShows)} color={noShows ? D.red : undefined} />
        </View>
      </View>

      <FlatList
        data={visible}
        keyExtractor={(c) => c.key}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <T size={13} c={D.sub} style={s.empty}>No clients yet — they appear after their first visit.</T>}
        renderItem={({ item }) => {
          const stars = item.visits + item.noShows > 0 ? Math.max(1, 5 - item.noShows) : null;
          const warm = item.visits >= REGULAR_VISITS && !item.noShows;
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={item.name}
              onPress={() => setSheetClient({
                name: item.name, avatarUrl: item.avatar, phone: item.phone,
                customerId: item.isWalkIn ? barberId : item.key,
                walkInName: item.walkInName,
              })}
              style={({ pressed }) => [s.row, pressed && s.pressed]}>
              {item.avatar
                ? <Image source={{ uri: item.avatar }} style={s.avatarImg} />
                : item.isWalkIn
                  ? <Avatar size={44} icon="user" />
                  : <Avatar size={44} warm={warm}
                      initials={item.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()} />}
              <View style={s.grow}>
                <T w="b" size={14}>
                  {item.name}
                  {item.isWalkIn ? <T w="m" size={11} c={D.sub}> · walk-in</T> : null}
                </T>
                <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                  {item.visits} visit{item.visits === 1 ? '' : 's'} · last {agoLabel(item.lastVisit)}
                  {item.noShows ? ` · ${item.noShows} no-show${item.noShows === 1 ? '' : 's'}` : ''}
                  {item.isWalkIn ? ' · no account' : ''}
                </T>
              </View>
              {stars != null && !item.isWalkIn && <Stars n={stars} />}
            </Pressable>
          );
        }}
      />
      <ClientSheet client={sheetClient} barberId={barberId}
        onClose={() => setSheetClient(null)}
        onChat={(id, title) => openChat({ id, title })} />
    </View>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.tile}>
      <Eyebrow ls={0.8}>{label}</Eyebrow>
      <T w="b" size={20} c={color ?? D.text} style={s.tnum}>{value}</T>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: D.bg },
  head: { paddingTop: 62, paddingHorizontal: 20, gap: 13 },
  title: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  tnum: { fontVariant: ['tabular-nums'] },

  search: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.card,
    borderRadius: 14, height: 46, paddingHorizontal: 16,
  },
  searchInput: { flex: 1, fontFamily: inter.r, fontSize: 14, color: D.text, padding: 0 },

  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 14, gap: 3 },

  list: { gap: 9, paddingTop: 15, paddingHorizontal: 20, paddingBottom: TAB_INSET },
  empty: { textAlign: 'center', paddingVertical: 24 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 18, padding: 13, paddingHorizontal: 14, backgroundColor: D.card,
  },
  avatarImg: { width: 44, height: 44, borderRadius: 999 },
});
