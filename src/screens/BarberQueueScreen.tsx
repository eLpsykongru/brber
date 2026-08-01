import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Eyebrow, Ico, Note, Screen, Serif, T, Toggle, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// 1l — Live queue, barber control. Per 0029 the queue is not a separate rail: it is
// today's confirmed book, run through the lifecycle the barber already has.
type Row = {
  id: string;
  starts_at: string;
  price_cents: number;
  walk_in_name: string | null;
  customer_id: string;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
};

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const minsFrom = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const minsTo = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));

// short label, same shape the customer queue gets server-side: "Mehdi K."
function shortName(r: Row, barberId: string) {
  if (r.walk_in_name) return r.walk_in_name;
  if (r.customer_id === barberId) return 'Walk-in';
  const parts = (r.customer?.full_name ?? 'Client').split(' ');
  return parts[1] ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

export default function BarberQueueScreen({ barberId, onBack }: {
  barberId: string; onBack: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(true);
  const [noShows, setNoShows] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const [book, barber, misses] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name), customer:profiles!customer_id(full_name)')
        .eq('barber_id', barberId).eq('status', 'confirmed')
        .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
        .order('starts_at'),
      supabase.from('barbers').select('accepting_bookings').eq('id', barberId).single(),
      supabase.from('bookings').select('customer_id').eq('barber_id', barberId).eq('status', 'no_show'),
    ]);
    if (book.error) return Alert.alert('Could not load the queue', book.error.message);
    setRows(book.data as unknown as Row[]);
    setOpen(barber.data?.accepting_bookings ?? true);
    const tally: Record<string, number> = {};
    for (const m of misses.data ?? []) tally[m.customer_id] = (tally[m.customer_id] ?? 0) + 1;
    setNoShows(tally);
  }, [barberId]);

  useEffect(() => { load(); }, [load]);

  async function setOpenState(next: boolean) {
    setOpen(next); // optimistic — the toggle is the whole point of the screen
    const { error } = await supabase.from('barbers')
      .update({ accepting_bookings: next }).eq('id', barberId);
    if (error) { setOpen(!next); Alert.alert('Could not update the queue', error.message); }
  }

  async function callNext(r: Row) {
    const { error } = await supabase.rpc('advance_booking', { p_booking: r.id, p_stage: 'check_in' });
    if (error) return Alert.alert('Could not call', error.message);
    if (r.customer_id !== barberId) {
      // ponytail: chat is the only push we have (BACKLOG: reminders increment)
      await supabase.from('messages').insert({ booking_id: r.id, body: "You're next — head over." });
    }
    load();
  }

  function drop(r: Row) {
    Alert.alert(`Drop ${shortName(r, barberId)}?`, 'Marks them a no-show and frees the slot.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Drop', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.rpc('mark_no_show', { p_booking: r.id });
          if (error) Alert.alert('Could not update', error.message);
          load();
        },
      },
    ]);
  }

  const all = rows ?? [];
  const active = all.filter((r) => !r.completed_at);
  const inChair = active.find((r) => r.started_at);
  const waiting = active.filter((r) => !r.started_at);
  const lastTicket = String(all.length).padStart(2, '0');

  return (
    <Screen gap={13}>
      <TopBar title="Live queue" onBack={onBack} right="grid"
        onRight={() => Alert.alert('Walk-in QR', 'The shop QR poster lives in Salon management.')} />

      <View style={s.control}>
        <View style={s.controlTop}>
          <View style={s.statusRow}>
            <View style={[s.statusDot, { backgroundColor: open ? D.green : D.muted }]} />
            <Eyebrow ls={1.6}>{open ? 'QUEUE OPEN' : 'QUEUE PAUSED'}</Eyebrow>
          </View>
          <Toggle on={open} onPress={() => setOpenState(!open)} />
        </View>
        <View style={s.numbers}>
          <View>
            <Eyebrow ls={1.4}>WAITING</Eyebrow>
            <Serif size={38} ls={0} style={{ marginTop: 4 }}>{String(waiting.length)}</Serif>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Eyebrow ls={1.4}>LAST TICKET</Eyebrow>
            <T w="eb" size={20} style={[s.tnum, { marginTop: 6 }]}>Nº {lastTicket}</T>
          </View>
        </View>
        <View style={s.controlBtns}>
          <Pressable onPress={() => setOpenState(!open)} accessibilityRole="button"
            style={({ pressed }) => [s.pauseBtn, pressed && s.pressed]}>
            <T w="b" size={12} c={D.sub} ls={0.6}>{open ? 'PAUSE QUEUE' : 'REOPEN QUEUE'}</T>
          </Pressable>
          <Pressable disabled={!waiting.length} accessibilityRole="button"
            onPress={() => waiting[0] && callNext(waiting[0])}
            style={({ pressed }) => [s.callBtn, !waiting.length && s.off, pressed && s.pressed]}>
            <T w="b" size={12} c="#fff" ls={0.6}>CALL NEXT</T>
          </Pressable>
        </View>
      </View>

      <Eyebrow ls={1.65}>IN THE LINE</Eyebrow>
      {rows !== null && active.length === 0 && (
        <T size={13} c={D.sub}>Nobody in the line right now.</T>
      )}
      <View style={{ gap: 9 }}>
        {inChair && (
          <View style={[s.row, { borderWidth: 2, borderColor: D.green }]}>
            <View style={[s.ticket, { backgroundColor: D.greenSoft }]}>
              <T w="b" size={12} c={D.green}>{String(all.indexOf(inChair) + 1).padStart(2, '0')}</T>
            </View>
            <View style={s.grow}>
              <T w="b" size={14}>{shortName(inChair, barberId)}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                {inChair.services?.name ?? 'Service'} · started {hhmm(inChair.started_at!)}
              </T>
            </View>
            <View style={s.chairChip}><T w="b" size={10} c={D.bg} ls={0.8}>IN CHAIR</T></View>
          </View>
        )}
        {waiting.map((r, i) => {
          const misses = r.customer_id === barberId ? 0 : noShows[r.customer_id] ?? 0;
          const first = i === 0;
          return (
            <View key={r.id} style={s.row}>
              <View style={[s.ticket, r.checked_in_at && { backgroundColor: D.accentSoft }]}>
                <T w="b" size={12} c={r.checked_in_at ? D.accent : D.sub}>
                  {String(all.indexOf(r) + 1).padStart(2, '0')}
                </T>
              </View>
              <View style={s.grow}>
                <T w="b" size={14}>{shortName(r, barberId)}</T>
                <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                  {r.services?.name ?? 'Service'} ·{' '}
                  {r.checked_in_at
                    ? `waiting ${minsFrom(r.checked_in_at)} min`
                    : `${hhmm(r.starts_at)} booking`}
                  {misses ? <T size={11} c={D.red}> · {misses} past no-show{misses > 1 ? 's' : ''}</T> : null}
                </T>
              </View>
              {first ? (
                <View style={s.rowBtns}>
                  <Pressable onPress={() => drop(r)} hitSlop={4} accessibilityRole="button"
                    accessibilityLabel={`Drop ${shortName(r, barberId)}`}
                    style={({ pressed }) => [s.rowPuck, pressed && s.pressed]}>
                    <Ico name="x" size={14} color={D.red} />
                  </Pressable>
                  <Pressable onPress={() => callNext(r)} hitSlop={4} accessibilityRole="button"
                    accessibilityLabel={`Call ${shortName(r, barberId)}`}
                    style={({ pressed }) => [s.rowPuck, pressed && s.pressed]}>
                    <Ico name="arrow-up" size={14} />
                  </Pressable>
                </View>
              ) : (
                <T size={11} c={D.sub}>~{minsTo(r.starts_at)} min</T>
              )}
            </View>
          );
        })}
      </View>

      <Note>Call next pings the client in chat. Pausing hides the shop's QR from new walk-ins.</Note>
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
  tnum: { fontVariant: ['tabular-nums'] },

  control: { backgroundColor: D.card, borderRadius: 22, padding: 18, gap: 14 },
  controlTop: { flexDirection: 'row', alignItems: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 999 },
  numbers: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  controlBtns: { flexDirection: 'row', gap: 9 },
  pauseBtn: {
    flex: 1, height: 44, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  callBtn: {
    flex: 1.2, height: 44, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, padding: 13, paddingHorizontal: 14,
  },
  ticket: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  chairChip: { backgroundColor: D.green, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9 },
  rowBtns: { flexDirection: 'row', gap: 7 },
  rowPuck: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
});
