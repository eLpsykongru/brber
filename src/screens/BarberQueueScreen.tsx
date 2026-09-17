import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Eyebrow, GhostBtn, Ico, IconName, Note, Screen, Serif, T, Toggle, TopBar } from '../components/dark';
import GuestSheet from '../components/GuestSheet';
import ShareLinkSheet, { LinkSend } from '../components/ShareLinkSheet';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// 1l — Live queue, barber control. Per 0029 the queue is not a separate rail: it is
// today's confirmed book, run through the lifecycle the barber already has.
//
// Queue link step 5: the grid puck sends the line link (BTD-11) where it used to
// answer with an Alert; today's last link sits on top with whether a ticket came of
// it (BTD-12); a ticket taken on the web page opens as a guest (BTD-13). Delivered
// and opened are not shown — the app hands the text to WhatsApp or the SMS app and
// learns nothing after that (0114).
//
// ADDENDUM-app-first: a name put on from the web page is UNCONFIRMED until he taps
// the link in his text (0118). That row is greyed, CALL NEXT goes past it, and so
// does the you're-next text — the visible price of having no code.
type Row = {
  id: string;
  starts_at: string;
  price_cents: number;
  walk_in_name: string | null;
  customer_id: string;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  services: { name: string; duration_min: number | null } | null;
  customer: { full_name: string | null } | null;
};

/** 0114 — a ticket taken on the web page, behind a walk-in row */
type GuestRow = {
  booking_id: string; first_name: string; phone: string; source: 'code' | 'link';
  joined_at: string; confirmed: boolean;
  // 0116 — the chair hold QL-13 counts down, and what he said about it
  called_at: string | null; called_until: string | null;
  coming_at: string | null; extended_at: string | null;
};

// the numbers move while he works; the customer's own queue polls the same way
const POLL_MS = 20_000;

const CHANNEL: Record<LinkSend['channel'], { label: string; icon: IconName }> = {
  whatsapp: { label: 'WhatsApp', icon: 'message-circle' },
  sms: { label: 'SMS', icon: 'mail' },
  copy: { label: 'Copied', icon: 'copy' },
};

const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const minsFrom = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
const minsTo = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
const pad = (n: number) => String(n).padStart(2, '0');

// short label, same shape the customer queue gets server-side: "Mehdi K."
function shortName(r: Row, barberId: string) {
  if (r.walk_in_name) return r.walk_in_name;
  if (r.customer_id === barberId) return 'Walk-in';
  const parts = (r.customer?.full_name ?? 'Client').split(' ');
  return parts[1] ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

// What the row says under the name. A called guest is the one person here who
// cannot be told anything after the fact, so his chair's hold (0116) and whatever
// he tapped on it are on the row itself — he is also the only one the barber can
// give more time to.
function rowSub(r: Row, guest?: GuestRow) {
  if (guest && !guest.confirmed) return "hasn't tapped his text · call past him";
  if (!r.checked_in_at) return `${hhmm(r.starts_at)} booking`;
  if (!guest?.called_at || !guest.called_until) return `waiting ${minsFrom(r.checked_in_at)} min`;
  const asked = guest.coming_at ? ' · on the way' : guest.extended_at ? ' · asked for 5 min' : '';
  return `called ${hhmm(guest.called_at)} · holds till ${hhmm(guest.called_until)}${asked}`;
}

export default function BarberQueueScreen({ barberId, onBack }: {
  barberId: string; onBack: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState(true);
  const [noShows, setNoShows] = useState<Record<string, number>>({});
  const [guests, setGuests] = useState<Record<string, GuestRow>>({});
  const [sent, setSent] = useState<LinkSend | null>(null);
  const [share, setShare] = useState(false);
  const [guestOpen, setGuestOpen] = useState<string | null>(null);

  const load = useCallback(async (quiet = false) => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const [book, barber, misses, guestRows, link] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, price_cents, walk_in_name, customer_id, checked_in_at, started_at, completed_at, services(name, duration_min), customer:profiles!customer_id(full_name)')
        .eq('barber_id', barberId).eq('status', 'confirmed')
        .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
        .order('starts_at'),
      supabase.from('barbers').select('accepting_bookings').eq('id', barberId).single(),
      supabase.from('bookings').select('customer_id').eq('barber_id', barberId).eq('status', 'no_show'),
      supabase.rpc('barber_guests_today'),
      supabase.rpc('barber_link_today'),
    ]);
    if (book.error) {
      if (!quiet) Alert.alert('Could not load the queue', book.error.message);
      return;
    }
    setRows(book.data as unknown as Row[]);
    setOpen(barber.data?.accepting_bookings ?? true);
    const tally: Record<string, number> = {};
    for (const m of misses.data ?? []) tally[m.customer_id] = (tally[m.customer_id] ?? 0) + 1;
    setNoShows(tally);
    const byBooking: Record<string, GuestRow> = {};
    for (const g of (guestRows.data ?? []) as GuestRow[]) byBooking[g.booking_id] = g;
    setGuests(byBooking);
    setSent((link.data as LinkSend | null) ?? null);
  }, [barberId]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

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
  // an unconfirmed web name keeps its place and is simply never next
  const unconfirmed = (r: Row) => !!guests[r.id] && !guests[r.id].confirmed;
  const callable = waiting.filter((r) => !unconfirmed(r));
  const lastTicket = pad(all.length);
  const nextNo = pad(all.length + 1);
  const takenNo = sent?.taken ? all.findIndex((r) => r.id === sent.taken!.booking_id) + 1 : 0;

  const openRow = guestOpen ? active.find((r) => r.id === guestOpen) ?? null : null;
  const openGuest = openRow ? guests[openRow.id] ?? null : null;
  const before = openRow ? active[active.indexOf(openRow) - 1] ?? null : null;

  return (
    <Screen gap={13}>
      <TopBar title="Live queue" onBack={onBack} right="grid" onRight={() => setShare(true)} />

      {sent && (
        <View style={s.sent}>
          <View style={s.sentTop}>
            <View style={s.sentIco}><Ico name={CHANNEL[sent.channel].icon} size={16} color={D.green} /></View>
            <View style={s.grow}>
              <T w="b" size={13} c={D.green}>
                {sent.channel === 'copy' ? 'Link copied' : `Link sent${sent.to_name ? ` to ${sent.to_name}` : ''}`}
              </T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                {CHANNEL[sent.channel].label} · {hhmm(sent.sent_at)} · {sent.points_at === 'chair' ? 'your chair' : 'the whole shop'}
              </T>
            </View>
          </View>
          {sent.to_phone && (
            <View style={s.sentStatus}>
              {sent.taken ? (
                <>
                  <T w="b" size={12} c={D.green}>{takenNo ? `Took Nº ${pad(takenNo)}` : 'Took a ticket'}</T>
                  <T size={10} c={D.sub}>{hhmm(sent.taken.at)}</T>
                </>
              ) : (
                <>
                  <T w="b" size={12} c={D.amber}>No ticket yet</T>
                  <T size={10} c={D.sub}>{minsFrom(sent.sent_at)} min ago</T>
                </>
              )}
            </View>
          )}
        </View>
      )}
      {sent && !sent.taken && (
        <Note>
          Nothing is reserved for him. Nº {nextNo} is still open to the room — this line exists so
          you don't tell two people the same number.
        </Note>
      )}

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
          <Pressable disabled={!callable.length} accessibilityRole="button"
            onPress={() => callable[0] && callNext(callable[0])}
            style={({ pressed }) => [s.callBtn, !callable.length && s.off, pressed && s.pressed]}>
            <T w="b" size={12} c="#fff" ls={0.6}>CALL NEXT</T>
          </Pressable>
        </View>
      </View>

      <Eyebrow ls={1.65}>IN THE LINE</Eyebrow>
      {rows !== null && active.length === 0 && !sent && (
        <T size={13} c={D.sub}>Nobody in the line right now.</T>
      )}
      <View style={{ gap: 9 }}>
        {inChair && (
          <View style={[s.row, { borderWidth: 2, borderColor: D.green }]}>
            <View style={[s.ticket, { backgroundColor: D.greenSoft }]}>
              <T w="b" size={12} c={D.green}>{pad(all.indexOf(inChair) + 1)}</T>
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
        {waiting.map((r) => {
          const misses = r.customer_id === barberId ? 0 : noShows[r.customer_id] ?? 0;
          const first = r === callable[0];
          const guest = guests[r.id];
          const grey = unconfirmed(r);
          return (
            <Pressable key={r.id} disabled={!guest} onPress={() => setGuestOpen(r.id)}
              accessibilityRole={guest ? 'button' : undefined}
              style={({ pressed }) => [s.row, grey && s.grey, pressed && s.pressed]}>
              <View style={[s.ticket, r.checked_in_at && { backgroundColor: D.accentSoft }]}>
                <T w="b" size={12} c={r.checked_in_at ? D.accent : D.sub}>{pad(all.indexOf(r) + 1)}</T>
              </View>
              <View style={s.grow}>
                <T w="b" size={14}>
                  {shortName(r, barberId)}
                  {guest ? <T w="b" size={10} c={D.faint} ls={0.8}>  · NO ACCOUNT</T> : null}
                </T>
                <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                  {r.services?.name ?? 'Service'} · {rowSub(r, guest)}
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
            </Pressable>
          );
        })}
        {sent && !sent.taken && (
          <View style={[s.row, s.openRow]}>
            <View style={[s.ticket, s.openTicket]}><T w="b" size={11} c={D.faint}>{nextNo}</T></View>
            <View style={s.grow}>
              <T w="sb" size={13} c={D.sub}>Open · next to take it</T>
              <T size={11} c={D.faint} style={{ marginTop: 2 }}>
                {sent.to_name ? `${sent.to_name} has the link · so does the poster` : 'The link is out · so is the poster'}
              </T>
            </View>
          </View>
        )}
      </View>

      {sent && <GhostBtn title="SEND TO SOMEONE ELSE" height={48} onPress={() => setShare(true)} />}

      <Note>
        Call next pings an app client in chat. A guest from the web page is held eight minutes once
        called. A greyed name never tapped his text — you may call past it. Pausing stops anyone new
        taking a place.
      </Note>

      <ShareLinkSheet visible={share} barberId={barberId} onClose={() => setShare(false)}
        onSent={(link) => { setSent(link); load(true); }} />
      <GuestSheet visible={!!openGuest} onClose={() => setGuestOpen(null)}
        guest={openRow && openGuest ? {
          firstName: openGuest.first_name, phone: openGuest.phone, source: openGuest.source,
          joinedAt: openGuest.joined_at, confirmed: openGuest.confirmed,
          no: all.indexOf(openRow) + 1, service: openRow.services?.name ?? 'Service',
          durationMin: openRow.services?.duration_min ?? null, priceCents: openRow.price_cents,
          startsAt: openRow.starts_at, after: before ? shortName(before, barberId) : null,
        } : null}
        onCallUp={() => { const r = openRow; setGuestOpen(null); if (r) callNext(r); }}
        // the drop asks first, and an Alert over a closing sheet can vanish with it
        onTakeOff={() => { const r = openRow; setGuestOpen(null); if (r) setTimeout(() => drop(r), 350); }} />
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
  grey: { opacity: 0.5 },
  tnum: { fontVariant: ['tabular-nums'] },

  // BTD-12
  sent: {
    backgroundColor: D.greenSoft10, borderWidth: 1, borderColor: D.greenLine, borderRadius: 20,
    paddingVertical: 15, paddingHorizontal: 16, gap: 11,
  },
  sentTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sentIco: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  sentStatus: { borderTopWidth: 1, borderTopColor: D.greenLine, paddingTop: 11, gap: 2 },
  openRow: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed', borderColor: D.muted },
  openTicket: { backgroundColor: D.sheet, borderWidth: 1, borderStyle: 'dashed', borderColor: D.muted },

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
