import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import { Avatar, Eyebrow, Ico, IconName, Sheet, Stars, T } from './dark';

// Client quick-view (1h): who they are, their history with you, what's coming up.
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
const dh = (cents: number) => `${Math.round(cents / 100)} DH`;

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
    <Sheet visible onClose={onClose}>
      <View style={s.head}>
        {client.avatarUrl
          ? <Image source={{ uri: client.avatarUrl }} style={s.avatar} />
          : isWalkIn ? <Avatar size={56} icon="user" /> : <Avatar size={56} warm initials={initials} />}
        <View style={s.grow}>
          <T w="b" size={17}>{client.name}</T>
          {isWalkIn
            ? <T w="sb" size={11} c={D.sub} style={{ marginTop: 3 }}>Walk-in (no account)</T>
            : stars != null
              ? <View style={{ marginTop: 3 }} accessible
                  accessibilityLabel={`Reliability ${stars} of 5 stars`}><Stars n={stars} size={11} /></View>
              : <T w="sb" size={11} c={D.sub} style={{ marginTop: 3 }}>New client</T>}
          <T size={12} c={D.sub} style={{ marginTop: 3 }}>
            {visits} visit{visits === 1 ? '' : 's'}
            {noShows ? ` · ${noShows} no-show${noShows === 1 ? '' : 's'}` : ''}
            {spent ? ` · ${dh(spent)} spent` : ''}
          </T>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"
          style={({ pressed }) => [s.close, pressed && s.pressed]}>
          <Ico name="x" size={16} />
        </Pressable>
      </View>

      {!isWalkIn && (client.phone || (onChat && chatBooking)) && (
        <View style={s.actions}>
          {client.phone && (
            <ActionBtn icon="phone" label="Call" onPress={() => Linking.openURL(`tel:${client.phone}`)} />
          )}
          {onChat && chatBooking && (
            <ActionBtn icon="message-circle" label="Chat" onPress={() => onChat(chatBooking.id, client.name)} />
          )}
        </View>
      )}

      {rows === null && (
        <ActivityIndicator style={s.spinner} color={D.accent} accessibilityLabel="Loading client history" />
      )}

      {rows !== null && (
        <>
          <Eyebrow ls={1.4}>UPCOMING</Eyebrow>
          {upcoming.length === 0 && <T size={12} c={D.sub}>Nothing booked.</T>}
          {upcoming.map((r) => (
            <View key={r.id} style={s.row}>
              <View style={s.rowLeft}>
                <T w="b" size={12}>{prettyDate(r.starts_at)}</T>
                <T size={10} c={D.sub} style={s.tnum}>{hhmm(r.starts_at)}–{hhmm(r.ends_at)}</T>
              </View>
              <View style={s.grow}>
                <T w="sb" size={12}>{r.services?.name ?? 'Service'}</T>
                {r.status === 'pending' && <T w="b" size={9} c={D.amber} ls={0.5}>PENDING</T>}
              </View>
              <T w="b" size={12} style={s.tnum}>{dh(r.price_cents)}</T>
            </View>
          ))}

          <Eyebrow ls={1.4}>HISTORY</Eyebrow>
          {history.length === 0 && <T size={12} c={D.sub}>No past visits yet.</T>}
          {history.slice(0, 15).map((r) => (
            <View key={r.id} style={s.row}>
              <View style={s.rowLeft}>
                <T w="b" size={12}>{prettyDate(r.starts_at)}</T>
                <T size={10} c={D.sub} style={s.tnum}>{hhmm(r.starts_at)}</T>
              </View>
              <View style={s.grow}>
                <T w="sb" size={12} c={r.status === 'no_show' ? D.sub : D.text}
                  style={r.status === 'no_show' && s.struck}>
                  {r.services?.name ?? 'Service'}
                </T>
                {r.status === 'no_show' && <T w="b" size={9} c={D.red} ls={0.5}>NO-SHOW</T>}
              </View>
              <T w="b" size={12} c={r.status === 'no_show' ? D.sub : D.text}
                style={[s.tnum, r.status === 'no_show' && s.struck]}>
                {dh(r.price_cents)}
              </T>
            </View>
          ))}
          {history.length > 15 && (
            <T size={12} c={D.sub}>+ {history.length - 15} older visits</T>
          )}
        </>
      )}
    </Sheet>
  );
}

function ActionBtn({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.actionBtn, pressed && s.pressed]}>
      <Ico name={icon} size={15} />
      <T w="b" size={12}>{label}</T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  tnum: { fontVariant: ['tabular-nums'] },
  spinner: { marginVertical: 24 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: { width: 56, height: 56, borderRadius: 999 },
  close: {
    width: 32, height: 32, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  actions: { flexDirection: 'row', gap: 9 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 40,
    paddingHorizontal: 15, borderRadius: 999, backgroundColor: D.card2,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.card2, borderRadius: 16, padding: 12, paddingHorizontal: 14,
  },
  rowLeft: { width: 84 },
  struck: { textDecorationLine: 'line-through' },
});
