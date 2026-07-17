import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, dark as D, font, radius, sp } from '../theme';

// Client quick-view: who they are, their history with you, what's coming up.
// Works for app clients (customerId) and walk-ins (grouped by walkInName).
export type ClientRef = {
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  customerId: string;        // equals barberId for walk-ins
  walkInName: string | null; // set for named walk-ins
};

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  completed_at: string | null;
  price_cents: number;
  services: { name: string } | null;
};

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const prettyDate = (iso: string) => {
  const ds = new Date(iso).toDateString(); // "Fri Jul 18 2026"
  return `${ds.slice(0, 3)}, ${ds.slice(4, 10)}`;
};

export default function ClientSheet({ client, barberId, onClose, onChat }: {
  client: ClientRef | null;
  barberId: string;
  onClose: () => void;
  onChat?: (bookingId: string, title: string) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);

  const isWalkIn = !!client && client.customerId === barberId;

  useEffect(() => {
    if (!client) return;
    setRows(null);
    let q = supabase.from('bookings')
      .select('id, starts_at, ends_at, status, completed_at, price_cents, services(name)')
      .eq('barber_id', barberId)
      .in('status', ['pending', 'confirmed', 'no_show'])
      .order('starts_at', { ascending: false })
      .limit(60);
    q = client.customerId === barberId
      ? (client.walkInName
        ? q.eq('customer_id', barberId).eq('walk_in_name', client.walkInName)
        : q.eq('customer_id', barberId).is('walk_in_name', null))
      : q.eq('customer_id', client.customerId);
    q.then(({ data }) => setRows((data as unknown as Row[]) ?? []));
  }, [client?.customerId, client?.walkInName]);

  if (!client) return null;

  const now = Date.now();
  const upcoming = (rows ?? [])
    .filter((r) => !r.completed_at && new Date(r.starts_at).getTime() > now && r.status !== 'no_show')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const history = (rows ?? [])
    .filter((r) => (!!r.completed_at || new Date(r.starts_at).getTime() <= now)
      && (r.status === 'confirmed' || r.status === 'no_show'));
  const visits = history.filter((r) => r.status === 'confirmed').length;
  const noShows = history.length - visits;
  const spent = history.filter((r) => r.status === 'confirmed').reduce((a, r) => a + r.price_cents, 0);
  const stars = history.length ? Math.max(1, 5 - noShows) : null;
  const chatBooking = (rows ?? [])[0]; // most recent booking anchors the chat

  const initials = client.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={s.backdrop} onPress={onClose} />
      <View style={s.sheet} onAccessibilityEscape={onClose}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.body}>
          {/* header */}
          <View style={s.head}>
            {client.avatarUrl
              ? <Image source={{ uri: client.avatarUrl }} style={s.avatar} />
              : <View style={[s.avatar, s.avatarFallback]}><Text style={s.avatarText}>{initials}</Text></View>}
            <View style={s.grow}>
              <Text style={s.name}>{client.name}</Text>
              {isWalkIn ? <Text style={s.tag}>Walk-in (no account)</Text>
                : stars != null ? (
                  <View style={s.starsRow} accessible accessibilityLabel={`Reliability ${stars} of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Ionicons key={i} name="star" size={12} color={i <= stars ? colors.star : D.border} />
                    ))}
                  </View>
                ) : <Text style={s.tag}>New client</Text>}
              <Text style={s.meta}>
                {visits} visit{visits === 1 ? '' : 's'}
                {noShows ? ` · ${noShows} no-show${noShows === 1 ? '' : 's'}` : ''}
                {spent ? ` · ${(spent / 100).toFixed(0)} DH spent` : ''}
              </Text>
            </View>
          </View>

          {/* actions */}
          <View style={s.actions}>
            {!isWalkIn && client.phone && (
              <ActionBtn icon="call-outline" label="Call"
                onPress={() => Linking.openURL(`tel:${client.phone}`)} />
            )}
            {!isWalkIn && onChat && chatBooking && (
              <ActionBtn icon="chatbubble-ellipses-outline" label="Chat"
                onPress={() => onChat(chatBooking.id, client.name)} />
            )}
          </View>

          {rows === null && <ActivityIndicator style={s.spinner} color={colors.accent} accessibilityLabel="Loading client history" />}

          {rows !== null && (
            <>
              {/* upcoming */}
              <Text style={s.section}>UPCOMING</Text>
              {upcoming.length === 0 && <Text style={s.empty}>Nothing booked.</Text>}
              {upcoming.map((r) => (
                <View key={r.id} style={s.row}>
                  <View style={s.rowLeft}>
                    <Text style={s.rowWhen}>{prettyDate(r.starts_at)}</Text>
                    <Text style={s.rowTime}>{hhmm(r.starts_at)}–{hhmm(r.ends_at)}</Text>
                  </View>
                  <View style={s.grow}>
                    <Text style={s.rowService}>{r.services?.name ?? 'Service'}</Text>
                    {r.status === 'pending' && <Text style={s.pendingTag}>PENDING</Text>}
                  </View>
                  <Text style={s.rowPrice}>{(r.price_cents / 100).toFixed(0)} DH</Text>
                </View>
              ))}

              {/* history */}
              <Text style={s.section}>HISTORY</Text>
              {history.length === 0 && <Text style={s.empty}>No past visits yet.</Text>}
              {history.slice(0, 15).map((r) => (
                <View key={r.id} style={s.row}>
                  <View style={s.rowLeft}>
                    <Text style={s.rowWhen}>{prettyDate(r.starts_at)}</Text>
                    <Text style={s.rowTime}>{hhmm(r.starts_at)}</Text>
                  </View>
                  <View style={s.grow}>
                    <Text style={[s.rowService, r.status === 'no_show' && s.struck]}>
                      {r.services?.name ?? 'Service'}
                    </Text>
                    {r.status === 'no_show' && <Text style={s.noShowTag}>NO-SHOW</Text>}
                  </View>
                  <Text style={[s.rowPrice, r.status === 'no_show' && s.struck]}>
                    {(r.price_cents / 100).toFixed(0)} DH
                  </Text>
                </View>
              ))}
              {history.length > 15 && (
                <Text style={s.empty}>+ {history.length - 15} older visits</Text>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function ActionBtn({ icon, label, onPress }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.actionBtn, pressed && s.pressed]}>
      <Ionicons name={icon} size={16} color={D.text} />
      <Text style={s.actionText}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: D.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    maxHeight: '80%',
  },
  body: { padding: sp(5), paddingBottom: sp(10), gap: sp(2.5) },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  spinner: { marginVertical: sp(6) },

  head: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  avatar: { width: 56, height: 56, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.body, fontWeight: '700', color: colors.accent },
  name: { fontSize: font.h2, fontWeight: '700', color: D.text },
  tag: { fontSize: font.tiny, fontWeight: '600', color: D.sub, marginTop: 2 },
  starsRow: { flexDirection: 'row', gap: 1, marginTop: 2 },
  meta: { fontSize: font.small, color: D.sub, marginTop: 3 },

  actions: { flexDirection: 'row', gap: sp(2.5) },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: sp(1.5), minHeight: 40,
    paddingHorizontal: sp(3.5), borderRadius: radius.pill, backgroundColor: D.card2,
  },
  actionText: { fontSize: font.small, fontWeight: '700', color: D.text },

  section: { fontSize: font.tiny, fontWeight: '700', color: D.sub, letterSpacing: 1, marginTop: sp(2) },
  empty: { fontSize: font.small, color: D.sub },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: D.card2, borderRadius: radius.md, padding: sp(3),
  },
  rowLeft: { width: 84 },
  rowWhen: { fontSize: font.small, fontWeight: '700', color: D.text },
  rowTime: { fontSize: font.tiny, color: D.sub, marginTop: 1, fontVariant: ['tabular-nums'] },
  rowService: { fontSize: font.small, fontWeight: '600', color: D.text },
  rowPrice: { fontSize: font.small, fontWeight: '700', color: D.text, fontVariant: ['tabular-nums'] },
  pendingTag: { fontSize: 9, fontWeight: '800', color: '#E8B84B', letterSpacing: 0.5, marginTop: 1 },
  noShowTag: { fontSize: 9, fontWeight: '800', color: colors.danger, letterSpacing: 0.5, marginTop: 1 },
  struck: { textDecorationLine: 'line-through', color: D.sub },
});
