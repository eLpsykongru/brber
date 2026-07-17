import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import ClientSheet, { ClientRef } from '../components/ClientSheet';
import { Field, TAB_BAR_INSET } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';
import ChatScreen from './ChatScreen';

// Client book v1 (BACKLOG bet #3, partial): everyone who ever sat in the chair,
// aggregated from booking history. Preferences + debt ledger are still TODO.
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
    return <ChatScreen bookingId={chat.id} myId={barberId}
      title={chat.title} onBack={() => openChat(null)} />;
  }

  const q = query.trim().toLowerCase();
  const visible = clients.filter((c) => !q || c.name.toLowerCase().includes(q));

  return (
    <View style={s.screen}>
      <Text style={s.title}>CLIENTS</Text>
      <Field placeholder="Search clients" placeholderTextColor={D.sub} style={s.darkField}
        value={query} onChangeText={setQuery} />
      <FlatList
        data={visible}
        keyExtractor={(c) => c.key}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={s.empty}>No clients yet — they appear after their first visit.</Text>}
        renderItem={({ item }) => {
          const stars = item.visits + item.noShows > 0 ? Math.max(1, 5 - item.noShows) : null;
          return (
            <Pressable accessibilityLabel={item.name}
              onPress={() => setSheetClient({
                name: item.name, avatarUrl: item.avatar, phone: item.phone,
                customerId: item.isWalkIn ? barberId : item.key,
                walkInName: item.walkInName,
              })}
              style={({ pressed }) => [s.row, pressed && s.pressed]}>
              {item.avatar
                ? <Image source={{ uri: item.avatar }} style={s.avatar} />
                : <View style={[s.avatar, s.avatarFallback]}>
                    <Text style={s.avatarText}>
                      {item.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </Text>
                  </View>}
              <View style={s.grow}>
                <Text style={s.name}>{item.name}{item.isWalkIn ? '  ·  walk-in' : ''}</Text>
                <Text style={s.meta}>
                  {item.visits} visit{item.visits === 1 ? '' : 's'} · last {agoLabel(item.lastVisit)}
                  {item.noShows ? ` · ${item.noShows} no-show${item.noShows === 1 ? '' : 's'}` : ''}
                </Text>
              </View>
              {stars != null && (
                <View style={s.stars}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Ionicons key={i} name="star" size={11} color={i <= stars ? colors.star : D.border} />
                  ))}
                </View>
              )}
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

const s = StyleSheet.create({
  screen: { flex: 1, paddingTop: sp(14), paddingHorizontal: sp(5), gap: sp(3), backgroundColor: D.bg },
  title: { textAlign: 'center', fontSize: font.h2, fontWeight: '700', color: D.text, letterSpacing: 2 },
  list: { gap: sp(2), paddingBottom: TAB_BAR_INSET, paddingTop: sp(1) },
  pressed: { opacity: 0.7 },
  grow: { flex: 1 },
  darkField: { backgroundColor: D.card, color: D.text },
  empty: { textAlign: 'center', color: D.sub, fontSize: font.small, paddingVertical: sp(6) },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    borderRadius: radius.lg, padding: sp(3.5), backgroundColor: D.card,
  },
  avatar: { width: 44, height: 44, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  name: { fontSize: font.body, fontWeight: '700', color: D.text },
  meta: { fontSize: font.small, color: D.sub, marginTop: 1 },
  stars: { flexDirection: 'row', gap: 1 },
});
