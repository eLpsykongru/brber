import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { FreedSlot, OfferSlotSheet } from '../components/CancelledGap';
import { Avatar, Eyebrow, Ico, IconName, Note, Screen, T, TopBar } from '../components/dark';
import {
  Ask, Blk, Busy, Fit, Win, agoLabel, asksFor, fitAt, localDay, ordinal, spanLabel,
} from '../lib/inboxRules';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// G1 of "Notification Routing.dc.html" — BDY-14 and BDY-15 of "Barber - My Day".
//
// A customer could ask to move (BOOK-08) and be told yes or no, but nothing
// showed the barber the ask with its real cost. This is that screen, and the day
// after the yes: the slot the move emptied, handed to the waitlist while it is
// still worth something.
//
// Every line about the day is computed. Three of the mock's lines are not here
// because nothing backs them: the waitlist is asked per day (0050), so it says
// "asked for that day", never "asked for 16:00"; the ask carries no message
// (0034 has no column for one), so there is no quote; and nothing tells the other
// people who wanted the time that it is gone, so the screen does not say so.

type Req = {
  id: string; from_start: string; requested_start: string;
  status: 'pending' | 'accepted' | 'declined'; created_at: string; decided_at: string | null;
};

type Row = {
  id: string; starts_at: string; ends_at: string; status: string;
  price_cents: number; deposit_cents: number; customer_id: string;
  walk_in_name: string | null; completed_at: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null; avatar_url: string | null } | null;
};

type Ctx = {
  req: Req; booking: Row; visits: number; day: Row[];
  windows: Win[]; blocks: Blk[]; daysOff: string[]; gapMin: number; asks: Ask[];
};

type Tone = 'good' | 'warn' | 'bad' | 'info';

const ROW_COLS = 'id, starts_at, ends_at, status, price_cents, deposit_cents, customer_id, walk_in_name,'
  + ' completed_at, services(name), customer:profiles!customer_id(full_name, avatar_url)';

const hh = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const dh = (cents: number) => `${Math.round(cents / 100)} DH`;
const minuteOf = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** 'today', 'tomorrow', or 'Sat 12 Sep' — how a day reads inside a sentence */
function dayWord(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'today';
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const when = (iso: string) => `${cap(dayWord(iso))} ${hh(iso)}`;
function dayTitle(iso: string) {
  const word = dayWord(iso);
  const weekday = new Date(iso).toLocaleDateString('en-GB', { weekday: 'long' });
  return word === 'today' || word === 'tomorrow' ? `${cap(word)} · ${weekday}` : word;
}

function moneyLine(b: Row) {
  const paid = b.deposit_cents ?? 0;
  if (paid > 0 && paid >= b.price_cents) return `${dh(b.price_cents)}, already paid`;
  if (paid > 0) return `${dh(b.price_cents)} · ${dh(paid)} already paid`;
  return `${dh(b.price_cents)} at the shop`;
}

function fitLine(fit: Fit, at: string): { tone: Tone; text: string } {
  const t = hh(at);
  if (fit.ok) return { tone: 'good', text: `${t} is free — no cut, no buffer in the way` };
  switch (fit.why) {
    case 'booked':
      return { tone: 'bad', text: `${t} runs into ${fit.with.who}'s ${hh(fit.with.starts_at)} — a yes would not go through` };
    case 'buffer':
      return { tone: 'warn', text: `${t} eats into your buffer around ${fit.with.who}'s ${hh(fit.with.starts_at)}` };
    case 'break':
      return { tone: 'warn', text: `${t} falls inside a break you set` };
    case 'closed':
      return { tone: 'warn', text: `${t} is outside your working hours` };
    default:
      return { tone: 'bad', text: `You are off ${dayWord(at)}` };
  }
}

const TONE: Record<Tone, { icon: IconName; color: string }> = {
  good: { icon: 'check', color: D.green },
  warn: { icon: 'alert-triangle', color: D.amber },
  bad: { icon: 'x-circle', color: D.red },
  info: { icon: 'info', color: D.sub },
};

export default function RescheduleAskScreen({ barberId, bookingId, onBack }: {
  barberId: string; bookingId: string; onBack: () => void;
}) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<FreedSlot | null>(null);
  const [offered, setOffered] = useState(false);

  const load = useCallback(async () => {
    const [rq, bk] = await Promise.all([
      supabase.from('reschedule_requests')
        .select('id, from_start, requested_start, status, created_at, decided_at')
        .eq('booking_id', bookingId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('bookings').select(ROW_COLS).eq('id', bookingId).maybeSingle(),
    ]);
    const err = rq.error ?? bk.error;
    if (err) { Alert.alert('Could not load the ask', err.message); return; }
    if (!rq.data || !bk.data) { setGone(true); return; }
    const req = rq.data as Req;
    const booking = bk.data as unknown as Row;

    // the day the move leaves and the day it lands on — usually the same one
    const lo = new Date(Math.min(Date.parse(req.from_start), Date.parse(req.requested_start)));
    lo.setHours(0, 0, 0, 0);
    const hi = new Date(Math.max(Date.parse(req.from_start), Date.parse(req.requested_start)));
    hi.setHours(24, 0, 0, 0);

    const [visits, day, av, blk, off, buf, wl] = await Promise.all([
      supabase.from('bookings').select('id', { count: 'exact', head: true })
        .eq('barber_id', barberId).eq('customer_id', booking.customer_id)
        .not('completed_at', 'is', null),
      supabase.from('bookings').select(ROW_COLS).eq('barber_id', barberId)
        .in('status', ['pending', 'confirmed'])
        .gte('starts_at', lo.toISOString()).lt('starts_at', hi.toISOString()).order('starts_at'),
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
      supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', barberId),
      supabase.from('days_off').select('day').eq('barber_id', barberId).gte('day', localDay(lo)),
      supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', barberId).maybeSingle(),
      supabase.rpc('barber_waitlist'),
    ]);
    const b = buf.data as { buffer_before_min: number | null; buffer_after_min: number | null } | null;
    setCtx({
      req, booking,
      visits: visits.count ?? 0,
      day: (day.data ?? []) as unknown as Row[],
      windows: (av.data ?? []) as Win[],
      blocks: (blk.data ?? []) as Blk[],
      daysOff: ((off.data ?? []) as { day: string }[]).map((d) => d.day),
      gapMin: (b?.buffer_before_min ?? 0) + (b?.buffer_after_min ?? 0),
      asks: (wl.data as { asks?: Ask[] } | null)?.asks ?? [],
    });
  }, [barberId, bookingId]);

  useEffect(() => { load(); }, [load]);

  async function answer(accept: boolean) {
    if (!ctx) return;
    setBusy(true);
    const { error } = await supabase.rpc('respond_reschedule', { p_request: ctx.req.id, p_accept: accept });
    setBusy(false);
    if (error) { Alert.alert(accept ? 'Could not move the booking' : 'Could not answer', error.message); return; }
    load();
  }

  if (gone || !ctx) {
    return (
      <Screen gap={14}>
        <TopBar title="Reschedule ask" onBack={onBack} />
        {gone
          ? <Note>This ask is no longer here — the booking behind it was removed.</Note>
          : <ActivityIndicator color={D.accent} accessibilityLabel="Loading the ask" />}
      </Screen>
    );
  }

  const { req, booking } = ctx;
  const nameOf = (b: Row) =>
    b.walk_in_name ?? (b.customer_id === barberId ? 'Walk-in' : b.customer?.full_name ?? 'Client');
  const name = nameOf(booking);
  const first = name.split(' ')[0];
  const now = Date.now();
  const service = booking.services?.name ?? 'Service';
  const dur = Math.round((Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 60_000);
  const from = req.from_start;
  const fromDay = localDay(new Date(from));
  const askedHere = asksFor(ctx.asks, fromDay, minuteOf(from), booking.customer_id);

  const sheet = (
    <OfferSlotSheet booking={offer} onClose={() => setOffer(null)}
      onSent={() => { setOffer(null); setOffered(true); }} />
  );

  // ---- BDY-15 · moved, and the hole it left -----------------------------------
  if (req.status === 'accepted') {
    const sameDay = localDay(new Date(booking.starts_at)) === fromDay;
    const future = Date.parse(from) > now;
    const noticeGiven = Date.parse(from) - (req.decided_at ? Date.parse(req.decided_at) : now);
    const moved = (
      <View style={[s.slot, s.movedSlot]}>
        <View style={s.rowBase}>
          <T w="sb" size={13} style={s.grow}>{name}</T>
          <T w="b" size={10.5} c={D.green} ls={0.5}>MOVED</T>
        </View>
        <T size={11} c={D.sub} style={s.mt2}>{service} · {dh(booking.price_cents)} · was {hh(from)}</T>
      </View>
    );
    const gap = (
      <View style={s.gapCard}>
        <View style={s.rowBase}>
          <T w="b" size={13} c={D.accent} style={s.grow}>Open — {dur} minutes</T>
          <T w="b" size={10.5} c={D.faint} ls={0.8}>{spanLabel(noticeGiven).toUpperCase()} NOTICE</T>
        </View>
        <T size={11.5} c={D.sub} style={s.lh17}>
          {askedHere > 0
            ? `${askedHere} on the waitlist asked for ${dayWord(from)}.`
            : `Nobody on the waitlist asked for ${dayWord(from)} — your regulars can still be offered it.`}
        </T>
        {future && !offered && (
          <Pressable onPress={() => setOffer({ starts_at: from, service, duration_min: dur })}
            accessibilityRole="button" style={({ pressed }) => [s.redCta, pressed && s.pressed]}>
            <T w="eb" size={11.5} c="#fff" ls={0.5}>OFFER IT TO THE WAITLIST</T>
          </Pressable>
        )}
        {offered && <T w="sb" size={11.5} c={D.green}>Offered — the first to tap it gets it.</T>}
      </View>
    );
    const items: { at: string; key: string; tint: string; node: ReactNode }[] = [
      ...ctx.day
        .filter((b) => b.id !== booking.id && localDay(new Date(b.starts_at)) === fromDay)
        .map((b) => ({ at: b.starts_at, key: b.id, tint: D.faint, node: <Plain b={b} name={nameOf(b)} /> })),
      { at: from, key: 'gap', tint: D.accent, node: gap },
      ...(sameDay ? [{ at: booking.starts_at, key: 'moved', tint: D.text, node: moved }] : []),
    ].sort((a, b) => a.at.localeCompare(b.at));

    return (
      <>
        <Screen gap={11}>
          <TopBar title={dayTitle(from)} onBack={onBack} />
          <View style={s.greenStrip}>
            <Ico name="check" size={15} color={D.green} />
            <T size={12} c={D.textDim} style={[s.grow, s.lh17]}>
              {name} is on <T w="b" size={12}>{sameDay ? hh(booking.starts_at) : when(booking.starts_at)}</T> and
              has been told.
            </T>
          </View>
          <View style={s.timeline}>
            {items.map((it) => <Line key={it.key} at={it.at} tint={it.tint}>{it.node}</Line>)}
          </View>
          {!sameDay && (
            <>
              <Eyebrow ls={1.65} style={s.mt2}>{dayWord(booking.starts_at).toUpperCase()}</Eyebrow>
              <View style={s.timeline}><Line at={booking.starts_at} tint={D.text}>{moved}</Line></View>
            </>
          )}
          <Note>A move you accept does not touch {first}&apos;s record.</Note>
        </Screen>
        {sheet}
      </>
    );
  }

  // ---- BDY-14 · the ask, and what it costs ---------------------------------------
  const to = new Date(req.requested_start);
  const others: Busy[] = ctx.day
    .filter((b) => b.id !== booking.id)
    .map((b) => ({ id: b.id, starts_at: b.starts_at, ends_at: b.ends_at, who: nameOf(b) }));
  const fit = fitAt(to, dur, ctx.windows, others, ctx.daysOff, ctx.blocks, ctx.gapMin);
  const fl = fitLine(fit, req.requested_start);
  const blocked = !fit.ok && fit.why === 'booked';
  const askedThere = asksFor(ctx.asks, localDay(to), minuteOf(req.requested_start), booking.customer_id);
  const notice = Date.parse(from) - now;
  const active = booking.status === 'pending' || booking.status === 'confirmed';
  const passed = to.getTime() <= now;
  const open = req.status === 'pending' && active;
  const paid = booking.deposit_cents ?? 0;

  const pill = req.status === 'declined' ? { label: 'KEPT', color: D.sub, bg: D.card2 }
    : !active ? { label: 'CLOSED', color: D.sub, bg: D.card2 }
      : passed ? { label: 'TIME PASSED', color: D.sub, bg: D.card2 }
        : { label: 'WAITING', color: D.amber, bg: D.amberSoft };

  return (
    <>
      <Screen gap={11}>
        <TopBar title="Reschedule ask" onBack={onBack} />

        <View style={s.card}>
          <View style={s.row12}>
            <Face url={booking.customer?.avatar_url ?? null} name={name} />
            <View style={s.grow}>
              <T w="b" size={14}>{name}</T>
              <T size={11} c={D.sub} style={s.mt2}>
                {ordinal(ctx.visits + 1)} visit · asked {agoLabel(now - Date.parse(req.created_at))}
              </T>
            </View>
            <View style={[s.pill, { backgroundColor: pill.bg }]}>
              <T w="b" size={10.5} c={pill.color} ls={0.8}>{pill.label}</T>
            </View>
          </View>

          <View style={s.strip}>
            <View style={s.grow}>
              <Eyebrow c={D.faint} ls={1.2}>BOOKED</Eyebrow>
              <T w="b" size={15} style={s.stripTime}>{when(from)}</T>
            </View>
            <Ico name="arrow-right" size={16} color={D.muted} />
            <View style={s.grow}>
              <Eyebrow c={D.faint} ls={1.2}>ASKS FOR</Eyebrow>
              <T w="b" size={15} c={D.accent} style={s.stripTime}>{when(req.requested_start)}</T>
            </View>
          </View>

          <T size={12} c={D.sub}>
            {service} · {dur}′ · <T w="b" size={12}>{moneyLine(booking)}</T>
          </T>
        </View>

        {open && !passed && (
          <>
            <Eyebrow ls={1.65} style={s.mt2}>WHAT IT DOES TO YOUR DAY</Eyebrow>
            <View style={s.list}>
              <Impact tone={fl.tone}>{fl.text}</Impact>
              {askedThere > 0 && (
                <Impact tone="warn">
                  <T w="b" size={12}>{askedThere} on your waitlist asked for {dayWord(req.requested_start)}</T>
                  {` — giving ${first} ${hh(req.requested_start)} is one less slot to offer them`}
                </Impact>
              )}
              <Impact tone={notice <= 0 ? 'bad' : notice < 24 * 3_600_000 ? 'warn' : 'info'} last>
                {notice > 0
                  ? <>{hh(from)} goes empty with <T w="b" size={12}>{spanLabel(notice)} notice</T></>
                  : <>{hh(from)} has already started</>}
                {askedHere > 0
                  ? ` — the waitlist has ${askedHere} ${askedHere === 1 ? 'name' : 'names'} for ${dayWord(from)}`
                  : ` — nobody on the waitlist asked for ${dayWord(from)}`}
              </Impact>
            </View>

            <View style={s.actions}>
              <Pressable onPress={() => answer(true)} disabled={busy || blocked} accessibilityRole="button"
                accessibilityLabel={`Give ${name} ${hh(req.requested_start)}`}
                style={({ pressed }) => [s.primary, (busy || blocked) && s.dim, pressed && s.pressed]}>
                <T w="eb" size={12.5} c="#111" ls={0.5}>GIVE {first.toUpperCase()} {hh(req.requested_start)}</T>
                <T w="sb" size={10.5} c="#5C5C58">
                  {paid > 0
                    ? `The ${dh(paid)} moves with the booking — nothing to refund`
                    : 'Same booking, new time — nothing to refund'}
                </T>
              </Pressable>
              <Pressable onPress={() => answer(false)} disabled={busy} accessibilityRole="button"
                style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
                <T w="b" size={12.5} c={D.textDim}>Keep {hh(from)} · say no</T>
              </Pressable>
              <T size={10.5} c={D.faint} style={s.foot}>
                Saying no keeps the booking exactly as it is. It is not a cancellation, and it does not
                touch the money.
              </T>
            </View>
          </>
        )}

        {open && passed && (
          <>
            <Note>
              {hh(req.requested_start)} has already gone, so it can no longer be given. The booking stays
              at {when(from)} either way — saying no just lets {first} know.
            </Note>
            <Pressable onPress={() => answer(false)} disabled={busy} accessibilityRole="button"
              style={({ pressed }) => [s.secondary, pressed && s.pressed]}>
              <T w="b" size={12.5} c={D.textDim}>Keep {hh(from)} · say no</T>
            </Pressable>
          </>
        )}

        {req.status === 'declined' && (
          <Note>You kept {when(from)}. {first} has been told the original time still stands.</Note>
        )}
        {req.status === 'pending' && !active && (
          <Note>This booking is no longer active, so there is nothing left to move.</Note>
        )}
      </Screen>
      {sheet}
    </>
  );
}

function Face({ url, name, size = 42 }: { url: string | null; name: string; size?: number }) {
  if (url) return <Image source={{ uri: url }} style={{ width: size, height: size, borderRadius: 999 }} />;
  return <Avatar size={size} initials={initials(name)} />;
}

function Impact({ tone, children, last }: { tone: Tone; children: ReactNode; last?: boolean }) {
  return (
    <View style={[s.impact, !last && s.impactLine]}>
      <View style={s.impactIcon}><Ico name={TONE[tone].icon} size={14} color={TONE[tone].color} /></View>
      <T size={12} c={D.textDim} style={s.impactText}>{children}</T>
    </View>
  );
}

function Line({ at, tint, children }: { at: string; tint: string; children: ReactNode }) {
  return (
    <View style={s.line}>
      <T w="b" size={11.5} c={tint} style={s.lineTime}>{hh(at)}</T>
      <View style={s.grow}>{children}</View>
    </View>
  );
}

function Plain({ b, name }: { b: Row; name: string }) {
  return (
    <View style={s.slot}>
      <T w="sb" size={13}>{name}</T>
      <T size={11} c={D.sub} style={s.mt2}>
        {b.services?.name ?? 'Service'} · {b.completed_at ? 'done' : b.status === 'pending' ? 'request' : dh(b.price_cents)}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  lh17: { lineHeight: 17 },
  pressed: { opacity: 0.75 },
  dim: { opacity: 0.45 },
  row12: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBase: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },

  card: { backgroundColor: D.card, borderRadius: 20, paddingVertical: 15, paddingHorizontal: 16, gap: 12 },
  pill: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9 },
  strip: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
  },
  stripTime: { marginTop: 2, fontVariant: ['tabular-nums'] },

  list: {
    backgroundColor: D.recessed, borderWidth: 1, borderColor: D.seam, borderRadius: 18,
    paddingHorizontal: 16, paddingVertical: 6,
  },
  impact: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingVertical: 11 },
  impactLine: { borderBottomWidth: 1, borderBottomColor: D.seam },
  impactIcon: { marginTop: 2 },
  impactText: { flex: 1, lineHeight: 17 },

  actions: { gap: 8, marginTop: 3 },
  primary: {
    height: 50, borderRadius: 16, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', gap: 1,
  },
  secondary: {
    height: 46, borderRadius: 16, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },
  foot: { textAlign: 'center', lineHeight: 15, paddingHorizontal: 8 },

  greenStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: D.greenSoft10,
    borderWidth: 1, borderColor: D.greenLine, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 14,
  },
  timeline: { gap: 8, marginTop: 2 },
  line: { flexDirection: 'row', gap: 11 },
  lineTime: { width: 46, paddingTop: 13, fontVariant: ['tabular-nums'] },
  slot: { backgroundColor: D.card, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 },
  movedSlot: { borderLeftWidth: 3, borderLeftColor: D.green },
  gapCard: {
    backgroundColor: D.recessed, borderWidth: 1, borderStyle: 'dashed', borderColor: D.muted,
    borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, gap: 9,
  },
  redCta: {
    height: 38, borderRadius: 12, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
});
