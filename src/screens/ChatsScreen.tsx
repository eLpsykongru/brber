import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Empty } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, font, radius, sp } from '../theme';
import ChatScreen from './ChatScreen';

type Convo = {
  id: string;
  starts_at: string;
  services: { name: string } | null;
  barbers: {
    profiles: { full_name: string | null; avatar_url: string | null } | null;
    salon: { name: string } | null;
  } | null;
  last?: { body: string | null; image_path: string | null; created_at: string } | null;
};

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

export default function ChatsScreen({ customerId, onChromeHidden }: {
  customerId: string; onChromeHidden: (hidden: boolean) => void;
}) {
  const [convos, setConvos] = useState<Convo[]>([]);
  const [open, setOpen] = useState<Convo | null>(null);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const { data } = await supabase.from('bookings')
      .select('id, starts_at, services(name), barbers(profiles(full_name, avatar_url), salon:salons!salon_id(name))')
      .eq('customer_id', customerId)
      .in('status', ['pending', 'confirmed'])
      .order('starts_at');
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

  useEffect(() => { load(); }, [load]);

  function openChat(c: Convo | null) {
    setOpen(c);
    onChromeHidden(!!c);
  }

  if (open) {
    return <ChatScreen bookingId={open.id} myId={customerId}
      title={open.barbers?.profiles?.full_name ?? 'Chat'}
      subtitle={open.barbers?.salon?.name ?? undefined}
      avatarUrl={open.barbers?.profiles?.avatar_url ?? undefined}
      onBack={() => openChat(null)} />;
  }

  const q = query.trim().toLowerCase();
  const filtered = convos.filter((c) =>
    !q || c.barbers?.profiles?.full_name?.toLowerCase().includes(q));
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
              {convos.map((c) => (
                <Pressable key={c.id} style={st.stripItem} onPress={() => openChat(c)}>
                  <Avatar url={c.barbers?.profiles?.avatar_url} name={c.barbers?.profiles?.full_name ?? 'B'}
                    size={56} online />
                  <Text style={st.stripName} numberOfLines={1}>
                    {(c.barbers?.profiles?.full_name ?? 'Barber').split(' ')[0]}
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
        keyExtractor={(c) => c.id}
        contentContainerStyle={st.list}
        ListEmptyComponent={
          <Empty text={tab === 'unread' ? 'Unread tracking coming soon.' : 'Chats appear here once you have a booking.'} />
        }
        renderItem={({ item }) => {
          const name = item.barbers?.profiles?.full_name ?? 'Barber';
          const preview = item.last
            ? (item.last.image_path ? '📷 Photo' : item.last.body ?? '')
            : `Booking at ${item.barbers?.salon?.name ?? 'salon'}`;
          return (
            <Pressable onPress={() => openChat(item)}
              style={({ pressed }) => [st.row, pressed && st.rowPressed]}>
              <Avatar url={item.barbers?.profiles?.avatar_url} name={name} size={52} online />
              <View style={st.rowBody}>
                <Text style={st.rowName} numberOfLines={1}>{name}</Text>
                <Text style={st.rowPreview} numberOfLines={1}>{preview}</Text>
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
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.tabBg, paddingTop: sp(14), paddingBottom: sp(4), paddingHorizontal: sp(5),
    borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg,
  },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSide: { width: 40, alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: colors.onAccent },
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
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.bg,
  },

  tabs: { flexDirection: 'row', gap: sp(5), paddingHorizontal: sp(5), paddingVertical: sp(3) },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: sp(1.5) },
  tabText: { fontSize: font.body, fontWeight: '600', color: colors.textTertiary },
  tabTextActive: { color: colors.text, fontWeight: '700' },
  tabCount: {
    minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.surface,
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
  rowPressed: { backgroundColor: colors.surface },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  rowPreview: { fontSize: font.small, color: colors.textSecondary },
  rowTime: { fontSize: font.tiny, color: colors.textTertiary },
});
