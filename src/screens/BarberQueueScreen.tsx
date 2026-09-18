import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Eyebrow, GhostBtn, Ico, IconName, Note, Screen, Serif, T, Toggle, TopBar } from '../components/dark';
import GuestSheet from '../components/GuestSheet';
import { CalledSheet, FrontSheet } from '../components/LineSheets';
import ShareLinkSheet, { LinkSend } from '../components/ShareLinkSheet';
import { useAndroidBack } from '../lib/back';
import { calledNotHere, callOrder, heldUntil, lapsedCall, nextToCall, smsSends } from '../lib/line';
import { checkIn } from '../lib/lineCalls';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import OfferDayScreen, { OfferFor } from './OfferDayScreen';
import { tr, trn } from '../lib/i18n';

// 1l — Live queue, barber control. Per 0029 the queue is not a separate rail: it is
// today's confirmed book, run through the lifecycle the barber already has.
//
// Queue link step 5: the grid puck sends the line link (BTD-11) where it used to
// answer with an Alert; today's last link sits on top with whether a ticket came of
// it (BTD-12); a ticket taken on the web page opens as a guest (BTD-13). Delivered
// and opened are not shown — the app hands the text to WhatsApp or the SMS app and
// learns nothing after that (0114).
//
// ADDENDUM-app-first, turn B10 (BTD-14): a place in the line has no date and
// nothing to accept, so there is no inbox here. A name put on from the web is
// UNCONFIRMED until he taps his text — greyed, never "next" for the text (0118),
// and put to the barber once, when he reaches the front (BTD-17). A called man who
// never sat down is a question too (BTD-15), asked when his eight minutes are up:
// no timer removes anybody from this line behind the barber's back.

type Row = {
  id: string;
  starts_at: string;
  created_at: string;
  price_cents: number;
  walk_in_name: string | null;
  walk_in_phone: string | null;   // BTD-02 (0118)
  customer_id: string;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  dropped_at: string | null;      // BTD-15 (0119)
  joined_line: boolean;           // held his own place in the app (0119)
  services: { name: string; duration_min: number | null } | null;
  customer: { full_name: string | null } | null;
};

/** 0114 — a ticket taken on the web page, behind a walk-in row */
type GuestRow = {
  booking_id: string; first_name: string; phone: string; source: 'code' | 'link';
  joined_at: string; confirmed: boolean;
  called_at: string | null; called_until: string | null;
  coming_at: string | null; extended_at: string | null;
};

// the numbers move while he works; the customer's own queue polls the same way
const POLL_MS = 20_000;
// BTD-15 opens by itself once a hold runs out; this is how soon after it notices
const TICK_MS = 15_000;

// BTD-15 opens by itself once per call. Closing it is not an answer, but it is not
// asked again for the same call either — CALL NEXT still brings it back.
const askedCalls = new Set<string>();

const CHANNEL: Record<LinkSend['channel'], { label: string; icon: IconName }> = {
  whatsapp: { label: tr('WhatsApp'), icon: 'message-circle' },
  sms: { label: tr('SMS'), icon: 'mail' },
  copy: { label: tr('Copied'), icon: 'copy' },
};

const hhmm = (iso: string | number) => new Date(iso).toTimeString().slice(0, 5);
const minsFrom = (iso: string, now = Date.now()) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
const minsTo = (iso: string) => Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
const pad = (n: number) => String(n).padStart(2, '0');

// short label, same shape the customer queue gets server-side: "Mehdi K."
function shortName(r: Row, barberId: string, guest?: GuestRow) {
  if (guest) return guest.first_name;
  if (r.walk_in_name) return r.walk_in_name;
  if (r.customer_id === barberId) return tr('Walk-in');
  const parts = (r.customer?.full_name ?? tr('Client')).split(' ');
  return parts[1] ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

// What the row says under the name — BTD-14's wording: where the place came from,
// or what is happening to it now.
function rowSub(r: Row, barberId: string, now: number, guest?: GuestRow) {
  const service = r.services?.name ?? tr('Service');
  if (guest && !guest.confirmed) {
    return r.checked_in_at
      ? tr("Called {at} anyway · hasn't tapped", { at: hhmm(r.checked_in_at) })
      : tr("Texted {m} min ago · hasn't tapped", { m: minsFrom(guest.joined_at, now) });
  }
  if (r.checked_in_at) {
    const until = heldUntil(r.checked_in_at);
    return until > now
      ? tr('{service} · called {at} · holds till {until}', { service, at: hhmm(r.checked_in_at), until: hhmm(until) })
      : tr("{service} · called {at} · he isn't here", { service, at: hhmm(r.checked_in_at) });
  }
  if (r.dropped_at) return tr("{service} · didn't come · at the end since {at}", { service, at: hhmm(r.dropped_at) });
  if (guest) return guest.source === 'link' ? tr('{service} · took your link', { service }) : tr('{service} · put his name in from the web', { service });
  if (r.customer_id === barberId) return tr('{service} · you wrote him down', { service });
  if (r.joined_line) return tr('Held his own place in the app');
  return tr('{at} booking · {service}', { at: hhmm(r.starts_at), service });
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
  const [sheetFor, setSheetFor] = useState<string | null>(null);   // BTD-13
  const [calledAsk, setCalledAsk] = useState<string | null>(null); // BTD-15
  const [frontAsk, setFrontAsk] = useState<string | null>(null);   // BTD-17
  const [offerFor, setOfferFor] = useState<OfferFor | null>(null); // BTD-16
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (quiet = false) => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const [book, barber, misses, guestRows, link] = await Promise.all([
      supabase.from('bookings')
        .select('id, starts_at, created_at, price_cents, walk_in_name, walk_in_phone, customer_id, checked_in_at, started_at, completed_at, dropped_at, joined_line, services(name, duration_min), customer:profiles!customer_id(full_name)')
        .eq('barber_id', barberId).eq('status', 'confirmed')
        .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
        .order('starts_at'),
      supabase.from('barbers').select('accepting_bookings').eq('id', barberId).single(),
      supabase.from('bookings').select('customer_id').eq('barber_id', barberId).eq('status', 'no_show'),
      supabase.rpc('barber_guests_today'),
      supabase.rpc('barber_link_today'),
    ]);
    if (book.error) {
      if (!quiet) Alert.alert(tr('Could not load the queue'), book.error.message);
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
    setNow(Date.now());
  }, [barberId]);

  useEffect(() => {
    load();
    const poll = setInterval(() => load(true), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  useAndroidBack(offerFor ? () => setOfferFor(null) : null);

  const all = rows ?? [];
  const active = all.filter((r) => !r.completed_at);
  const inChair = active.find((r) => r.started_at);
  const order = callOrder(active);
  const noOf = (r: Row) => all.indexOf(r) + 1;
  const unconfirmed = (r: Row) => !!guests[r.id] && !guests[r.id].confirmed;
  const notConfirmed = order.filter(unconfirmed);
  const lastTicket = pad(all.length);
  const nextNo = pad(all.length + 1);
  const takenNo = sent?.taken ? all.findIndex((r) => r.id === sent.taken!.booking_id) + 1 : 0;
  const nothingOpen = !share && !sheetFor && !calledAsk && !frontAsk && !offerFor;

  // BTD-15 by itself: once his eight minutes are up, and once per call
  useEffect(() => {
    if (!rows || !nothingOpen) return;
    const lapsed = lapsedCall(callOrder(rows.filter((r) => !r.completed_at)), now);
    if (!lapsed) return;
    const key = `${lapsed.id}:${lapsed.checked_in_at}`;
    if (askedCalls.has(key)) return;
    askedCalls.add(key);
    setCalledAsk(lapsed.id);
  }, [rows, now, nothingOpen]);

  async function setOpenState(next: boolean) {
    setOpen(next); // optimistic — the toggle is the whole point of the screen
    const { error } = await supabase.from('barbers')
      .update({ accepting_bookings: next }).eq('id', barberId);
    if (error) { setOpen(!next); Alert.alert(tr('Could not update the queue'), error.message); }
  }

  async function callRow(r: Row) {
    const error = await checkIn(r.id, r.customer_id !== barberId);
    if (error) return Alert.alert(tr('Could not call'), error);
    load();
  }

  // CALL NEXT: a man already called is decided on first (BTD-15); an unconfirmed
  // name at the front is asked about once (BTD-17); anybody else is simply called.
  function callNext() {
    const called = calledNotHere(active);
    if (called) return setCalledAsk(called.id);
    const next = nextToCall(active);
    if (!next) return;
    if (unconfirmed(next)) return setFrontAsk(next.id);
    callRow(next);
  }

  async function callPast(r: Row) {
    setCalledAsk(null);
    const next = nextToCall(active, r.id);
    const { error } = await supabase.rpc('queue_drop_to_end', { p_booking: r.id });
    if (error) return Alert.alert(tr('Could not move him to the end'), error.message);
    if (next && unconfirmed(next)) {
      await load();
      // a sheet opening as another closes can be swallowed with it
      setTimeout(() => setFrontAsk(next.id), 350);
      return;
    }
    if (next) return callRow(next);
    load();
  }

  async function sitDown(r: Row) {
    setCalledAsk(null);
    const { error } = await supabase.rpc('advance_booking', { p_booking: r.id, p_stage: 'start' });
    if (error) Alert.alert(tr('Could not start'), error.message);
    load();
  }

  async function takeOff(r: Row) {
    setCalledAsk(null); setFrontAsk(null);
    const { error } = await supabase.rpc('queue_take_off', { p_booking: r.id });
    if (error) Alert.alert(tr('Could not take him off'), error.message);
    load();
  }

  function confirmTakeOff(r: Row) {
    const walkIn = r.customer_id === barberId;
    Alert.alert(tr('Take {r} off the line?', { r: shortName(r, barberId, guests[r.id]) }),
      walkIn ? tr('He leaves today\'s line. Nothing is recorded against a walk-in.') : tr('Marks him a no-show and frees the slot.'), [
        { text: tr('Keep'), style: 'cancel' },
        { text: tr('Take off'), style: 'destructive', onPress: () => takeOff(r) },
      ]);
  }

  if (offerFor) {
    return (
      <OfferDayScreen barberId={barberId} row={offerFor} onBack={() => setOfferFor(null)}
        onSent={() => { setOfferFor(null); load(); }} />
    );
  }

  const sheetRow = sheetFor ? active.find((r) => r.id === sheetFor) ?? null : null;
  const sheetGuest = sheetRow ? guests[sheetRow.id] : undefined;
  const before = sheetRow ? order[order.indexOf(sheetRow) - 1] ?? inChair ?? null : null;
  const sheetPhone = sheetGuest?.phone ?? sheetRow?.walk_in_phone ?? null;

  const calledRow = calledAsk ? active.find((r) => r.id === calledAsk) ?? null : null;
  const calledNext = calledRow ? nextToCall(active, calledRow.id) : null;
  const frontRow = frontAsk ? active.find((r) => r.id === frontAsk) ?? null : null;
  const asked = (r: Row | null) => r && {
    no: noOf(r), name: shortName(r, barberId, guests[r.id]), service: r.services?.name ?? tr('Service'),
    phone: guests[r.id]?.phone ?? r.walk_in_phone,
  };

  return (
    <Screen gap={13}>
      <TopBar title={tr('Live queue')} onBack={onBack} right="grid" onRight={() => setShare(true)} />

      {sent && (
        <View style={s.sent}>
          <View style={s.sentTop}>
            <View style={s.sentIco}><Ico name={CHANNEL[sent.channel].icon} size={16} color={D.green} /></View>
            <View style={s.grow}>
              <T w="b" size={13} c={D.green}>
                {sent.channel === 'copy' ? tr('Link copied') : (sent.to_name ? tr('Link sent to {name}', { name: sent.to_name }) : tr('Link sent'))}
              </T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                {CHANNEL[sent.channel].label} · {hhmm(sent.sent_at)} · {sent.points_at === 'chair' ? tr('your chair') : tr('the whole shop')}
              </T>
            </View>
          </View>
          {sent.to_phone && (
            <View style={s.sentStatus}>
              {sent.taken ? (
                <>
                  <T w="b" size={12} c={D.green}>{takenNo ? tr('Took Nº {takenNo}', { takenNo: pad(takenNo) }) : tr('Took a ticket')}</T>
                  <T size={10} c={D.sub}>{hhmm(sent.taken.at)}</T>
                </>
              ) : (
                <>
                  <T w="b" size={12} c={D.amber}>{tr('No ticket yet')}</T>
                  <T size={10} c={D.sub}>{tr('{sent_at} min ago', { sent_at: minsFrom(sent.sent_at, now) })}</T>
                </>
              )}
            </View>
          )}
        </View>
      )}
      {sent && !sent.taken && (
        <Note>
          {tr('Nothing is reserved for him. Nº {nextNo} is still open to the room — this line exists so you don\'t tell two people the same number.', { nextNo })}
        </Note>
      )}

      <View style={s.control}>
        <View style={s.controlTop}>
          <View style={s.statusRow}>
            <View style={[s.statusDot, { backgroundColor: open ? D.green : D.muted }]} />
            <Eyebrow ls={1.6}>{open ? tr('QUEUE OPEN') : tr('QUEUE PAUSED')}</Eyebrow>
          </View>
          <Toggle on={open} onPress={() => setOpenState(!open)} />
        </View>
        <View style={s.numbers}>
          <View>
            <Eyebrow ls={1.4}>{tr('WAITING')}</Eyebrow>
            <Serif size={38} ls={0} style={{ marginTop: 4 }}>{String(order.length)}</Serif>
            {notConfirmed.length > 0 && (
              <T size={10.5} c={D.faint} style={{ marginTop: 3 }}>{tr('{count} not confirmed', { count: notConfirmed.length })}</T>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Eyebrow ls={1.4}>{tr('LAST TICKET')}</Eyebrow>
            <T w="eb" size={20} style={[s.tnum, { marginTop: 6 }]}>Nº {lastTicket}</T>
          </View>
        </View>
        <View style={s.controlBtns}>
          <Pressable onPress={() => setOpenState(!open)} accessibilityRole="button"
            style={({ pressed }) => [s.pauseBtn, pressed && s.pressed]}>
            <T w="b" size={12} c={D.sub} ls={0.6}>{open ? tr('PAUSE QUEUE') : tr('REOPEN QUEUE')}</T>
          </Pressable>
          <Pressable disabled={!order.length} accessibilityRole="button" onPress={callNext}
            style={({ pressed }) => [s.callBtn, !order.length && s.off, pressed && s.pressed]}>
            <T w="b" size={12} c="#fff" ls={0.6}>{tr('CALL NEXT')}</T>
          </Pressable>
        </View>
      </View>

      <Eyebrow ls={1.65}>{tr('IN THE LINE')}</Eyebrow>
      {rows !== null && active.length === 0 && !sent && (
        <T size={13} c={D.sub}>{tr('Nobody in the line right now.')}</T>
      )}
      <View style={{ gap: 8 }}>
        {inChair && (
          <View style={[s.row, { borderWidth: 2, borderColor: D.green }]}>
            <View style={[s.ticket, { backgroundColor: D.greenSoft }]}>
              <T w="b" size={12} c={D.green}>{pad(noOf(inChair))}</T>
            </View>
            <View style={s.grow}>
              <T w="b" size={14}>{shortName(inChair, barberId, guests[inChair.id])}</T>
              <T size={11} c={D.sub} style={{ marginTop: 2 }}>
                {tr('{name} · started {hhmm}', { name: inChair.services?.name ?? tr('Service'), hhmm: hhmm(inChair.started_at!) })}
              </T>
            </View>
            <View style={s.chairChip}><T w="b" size={10} c={D.bg} ls={0.8}>{tr('IN CHAIR')}</T></View>
          </View>
        )}
        {order.map((r, i) => {
          const guest = guests[r.id];
          const grey = unconfirmed(r);
          const walkIn = r.customer_id === barberId;
          const misses = walkIn ? 0 : noShows[r.customer_id] ?? 0;
          const front = i === 0 && !r.checked_in_at && !grey;
          const name = shortName(r, barberId, guest);
          return (
            <Pressable key={r.id} disabled={!walkIn} onPress={() => setSheetFor(r.id)}
              accessibilityRole={walkIn ? 'button' : undefined}
              style={({ pressed }) => [s.row, grey && s.unconfirmedRow, r.dropped_at && s.droppedRow, pressed && s.pressed]}>
              <View style={[s.ticket,
                grey ? { backgroundColor: D.amberSoft12 } : r.checked_in_at ? { backgroundColor: D.accentSoft } : null]}>
                <T w="b" size={12} c={grey ? D.amber : r.checked_in_at ? D.accent : D.sub}>{pad(noOf(r))}</T>
              </View>
              <View style={s.grow}>
                <T w="b" size={14} c={grey || r.dropped_at ? D.sub : D.text}>{name}</T>
                <T size={11} c={grey ? D.amber : D.sub} style={{ marginTop: 2 }}>
                  {rowSub(r, barberId, now, guest)}
                  {misses ? <T size={11} c={D.red}>{' '}{trn(misses, '· {n} past no-show', '· {n} past no-shows')}</T> : null}
                </T>
              </View>
              {grey ? (
                <View style={s.amberChip}><T w="b" size={10} c={D.amber} ls={0.6}>{tr('UNCONFIRMED')}</T></View>
              ) : front ? (
                <View style={s.rowBtns}>
                  <Pressable onPress={() => confirmTakeOff(r)} hitSlop={4} accessibilityRole="button"
                    accessibilityLabel={tr('Take {name} off the line', { name })}
                    style={({ pressed }) => [s.rowPuck, pressed && s.pressed]}>
                    <Ico name="x" size={14} color={D.red} />
                  </Pressable>
                  <Pressable onPress={callNext} hitSlop={4} accessibilityRole="button"
                    accessibilityLabel={tr('Call {name}', { name })}
                    style={({ pressed }) => [s.rowPuck, pressed && s.pressed]}>
                    <Ico name="arrow-up" size={14} />
                  </Pressable>
                </View>
              ) : r.checked_in_at ? (
                <View style={s.calledChip}><T w="b" size={10} c={D.accent} ls={0.6}>{tr('CALLED')}</T></View>
              ) : r.dropped_at ? null : (
                <T size={11} c={D.sub}>{tr('~{starts_at} min', { starts_at: minsTo(r.starts_at) })}</T>
              )}
            </Pressable>
          );
        })}
        {sent && !sent.taken && (
          <View style={[s.row, s.openRow]}>
            <View style={[s.ticket, s.openTicket]}><T w="b" size={11} c={D.faint}>{nextNo}</T></View>
            <View style={s.grow}>
              <T w="sb" size={13} c={D.sub}>{tr('Open · next to take it')}</T>
              <T size={11} c={D.faint} style={{ marginTop: 2 }}>
                {sent.to_name ? tr('{to_name} has the link · so does the poster', { to_name: sent.to_name }) : tr('The link is out · so is the poster')}
              </T>
            </View>
          </View>
        )}
      </View>

      {sent && <GhostBtn title={tr('SEND TO SOMEONE ELSE')} height={48} onPress={() => setShare(true)} />}

      {notConfirmed.length > 0 && (
        <View style={s.amberNote}>
          <Ico name="info" size={14} color={D.amber} />
          <T size={11.5} c={D.sub} style={[s.grow, { lineHeight: 17 }]}>
            {notConfirmed.length > 1
              ? tr('Nº {no} and {more} more put their names in from the web and never tapped the text. Call past freely — we\'ll ask you once when each reaches the front.', { no: pad(noOf(notConfirmed[0])), more: notConfirmed.length - 1 })
              : tr('Nº {no} put his name in from the web and never tapped the text. Call past freely — we\'ll ask you once when he reaches the front.', { no: pad(noOf(notConfirmed[0])) })}
          </T>
        </View>
      )}
      <Note>
        {tr('Call next pings an app client in chat. A called chair is held eight minutes, then you decide what happens. Pausing stops anyone new taking a place.')}
      </Note>

      <ShareLinkSheet visible={share} barberId={barberId} onClose={() => setShare(false)}
        onSent={(link) => { setSent(link); load(true); }} />
      <GuestSheet visible={!!sheetRow} onClose={() => setSheetFor(null)}
        guest={sheetRow ? {
          firstName: shortName(sheetRow, barberId, sheetGuest), phone: sheetPhone,
          source: sheetGuest ? sheetGuest.source : 'hand',
          joinedAt: sheetGuest?.joined_at ?? sheetRow.created_at, confirmed: sheetGuest ? sheetGuest.confirmed : true,
          no: noOf(sheetRow), service: sheetRow.services?.name ?? tr('Service'),
          durationMin: sheetRow.services?.duration_min ?? null, priceCents: sheetRow.price_cents,
          startsAt: sheetRow.starts_at, after: before ? shortName(before, barberId, guests[before.id]) : null,
        } : null}
        onCallUp={() => { const r = sheetRow; setSheetFor(null); if (r) callRow(r); }}
        // the take-off asks first, and an Alert over a closing sheet can vanish with it
        onTakeOff={() => { const r = sheetRow; setSheetFor(null); if (r) setTimeout(() => confirmTakeOff(r), 350); }}
        anotherDay={!sheetPhone ? tr("Needs his number — you'll only have his name")
          : !smsSends() ? tr('Waits until Sterncut can send texts')
            : () => {
              const r = sheetRow!;
              setSheetFor(null);
              setOfferFor({
                bookingId: r.id, no: noOf(r), name: shortName(r, barberId, sheetGuest),
                service: r.services?.name ?? tr('Service'), durationMin: r.services?.duration_min ?? 30,
                startsAt: r.starts_at, waitingSince: sheetGuest?.joined_at ?? r.created_at,
              });
            }} />
      <CalledSheet visible={!!calledRow} row={asked(calledRow)} calledAt={calledRow?.checked_in_at ?? null}
        nextNo={calledNext ? noOf(calledNext) : null}
        onClose={() => setCalledAsk(null)}
        onNext={() => calledRow && callPast(calledRow)}
        onHere={() => calledRow && sitDown(calledRow)}
        onTakeOff={() => calledRow && takeOff(calledRow)} />
      <FrontSheet visible={!!frontRow} row={asked(frontRow)} textedAt={frontRow ? guests[frontRow.id]?.joined_at ?? null : null}
        onClose={() => setFrontAsk(null)}
        onCall={() => { const r = frontRow; setFrontAsk(null); if (r) callRow(r); }}
        onDrop={() => frontRow && takeOff(frontRow)} />
    </Screen>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
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

  control: { backgroundColor: D.card, borderRadius: 22, padding: 17, gap: 13 },
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
    borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14,
  },
  // BTD-14's unconfirmed row: recessed, dashed amber, never hidden
  unconfirmedRow: {
    backgroundColor: D.recessed, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(232,161,0,0.45)',
  },
  droppedRow: { backgroundColor: D.recessed },
  ticket: {
    width: 38, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  chairChip: { backgroundColor: D.green, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9 },
  amberChip: { backgroundColor: D.amberSoft12, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8 },
  calledChip: { backgroundColor: D.accentSoft, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8 },
  rowBtns: { flexDirection: 'row', gap: 7 },
  rowPuck: {
    width: 34, height: 34, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  amberNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card,
    borderRadius: 16, paddingVertical: 12, paddingHorizontal: 15,
  },
});
