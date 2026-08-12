import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { OfferSlotSheet, type FreedSlot } from '../components/CancelledGap';
import { Ico, Screen, Sheet, T, TAB_INSET, TopBar } from '../components/dark';
import { useAndroidBack } from '../lib/back';
import { supabase } from '../lib/supabase';
import {
  daySlots, makeRoomOptions, Block, Range, RoomOption, Window,
} from '../lib/slots';
import { dark as D, serif } from '../theme';
import ChatScreen from './ChatScreen';

// 8h / 8i / 8j / 8k of "Barber App.dc.html" — the list itself, and what to do
// when there is nothing to give the people on it.
//
// The framing that matters: **nobody is holding a slot.** An ask is evidence of
// wanting the day, not a queue position, and he picks who gets offered. 8i says
// so out loud, because an empty waiting list is usually not a bug — it means he
// has no full days, and asks only happen on days with nothing left.
//
// 8j names the rule the other offer screens assumed: an offer anchors to a real
// gap. A full day has none, so the only honest move is to make one — which is
// 8k, and the three places a slot can come from.

type Ask = {
  id: string; day: string; customer_id: string; name: string; asked_at: string;
  earliest_min: number | null; mine_only: boolean; service: string | null;
  visits: number; no_shows: number; last_booking: string | null;
};
type Payload = { asks: Ask[]; free_today: number; today: string };
type Cal = {
  windows: Window[]; daysOff: string[]; blocks: Block[]; buffer: number;
  booked: Range[]; slotMin: number; svcName: string; svcCents: number;
};
/** one day of the list, with everything he could do about it already worked out */
type DayInfo = {
  day: string; asks: Ask[]; free: Date | null;
  open: number | null; close: number | null; options: RoomOption[];
};

const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const first = (n: string) => n.split(' ')[0];
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);
const hhmmOf = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const askedAt = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const minLabel = (m: number | null) => (m == null ? 'any time' : `after ${hhmmOf(m)}`);
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (iso: string) => new Date(`${iso}T00:00:00`);

function dayLabel(iso: string, today: string) {
  if (iso === today) return 'TODAY';
  return dateOf(iso).toLocaleDateString('en-US', { weekday: 'short', day: '2-digit' }).toUpperCase();
}
const weekday = (iso: string) => dateOf(iso).toLocaleDateString('en-US', { weekday: 'long' });

export default function WaitingListScreen({ barberId, onBack, slot }: {
  barberId: string; onBack?: () => void;
  /** arrived from 8b holding a specific cancelled slot — that one, not the day's first free one */
  slot?: FreedSlot | null;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [cal, setCal] = useState<Cal | null>(null);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [roomFor, setRoomFor] = useState<DayInfo | null>(null);
  const [offer, setOffer] = useState<
    { slot: FreedSlot; preselect?: string; madeNote?: string } | null>(null);
  const [chat, setChat] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async () => {
    const { data: j, error } = await supabase.rpc('barber_waitlist');
    if (error) return Alert.alert('Could not load the list', error.message);
    const p = j as Payload;
    setData(p);

    // the book has to reach the last day anybody asked about, or those days
    // cannot be told apart from days with room left
    const last = p.asks.reduce((m, a) => (a.day > m ? a.day : m), p.today);
    const from = new Date();
    const to = dateOf(last);
    to.setDate(to.getDate() + 1);
    const [av, off, blk, buf, bk, svc] = await Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', barberId),
      supabase.from('days_off').select('day').eq('barber_id', barberId),
      supabase.from('time_blocks').select('day, start_min, end_min, kind, label').eq('barber_id', barberId),
      supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', barberId).single(),
      supabase.rpc('booked_ranges',
        { p_barber: barberId, p_from: from.toISOString(), p_to: to.toISOString() }),
      // the shortest thing he sells is what a made gap is sized to, and what
      // 8k's WORTH reads. create_open_offer picks the same row server-side.
      supabase.from('services').select('name, price_cents, duration_min')
        .eq('barber_id', barberId).eq('is_active', true)
        .order('duration_min').order('price_cents').limit(1).maybeSingle(),
    ]);
    setCal({
      windows: (av.data ?? []) as Window[],
      daysOff: (off.data ?? []).map((d: any) => d.day),
      blocks: (blk.data ?? []) as Block[],
      buffer: buf.data ? buf.data.buffer_before_min + buf.data.buffer_after_min : 0,
      booked: (bk.data ?? []) as Range[],
      slotMin: svc.data?.duration_min ?? 30,
      svcName: svc.data?.name ?? 'Service',
      svcCents: svc.data?.price_cents ?? 0,
    });
  }, [barberId]);
  useEffect(() => { load(); }, [load]);

  const today = data?.today ?? '';
  const days: DayInfo[] = useMemo(() => {
    const m = new Map<string, Ask[]>();
    for (const a of data?.asks ?? []) (m.get(a.day) ?? m.set(a.day, []).get(a.day)!).push(a);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, asks]) => {
      if (!cal) return { day, asks, free: null, open: null, close: null, options: [] };
      const d = dateOf(day);
      const wins = cal.windows.filter((w) => w.weekday === d.getDay());
      const held = slot && isoOf(new Date(slot.starts_at)) === day ? new Date(slot.starts_at) : null;
      const free = held ?? daySlots(d, cal.slotMin, cal.windows, cal.booked, cal.daysOff,
        cal.blocks, cal.buffer).find((sl) => sl.status === 'free')?.time ?? null;
      return {
        day, asks, free,
        open: wins.length ? Math.min(...wins.map((w) => w.start_min)) : null,
        close: wins.length ? Math.max(...wins.map((w) => w.end_min)) : null,
        options: makeRoomOptions(d, cal.slotMin, cal.windows, cal.booked, cal.daysOff,
          cal.blocks, cal.buffer),
      };
    });
  }, [data, cal, slot]);

  const shown = pickedDay ? days.filter((d) => d.day === pickedDay) : days;
  const todayCount = days.find((d) => d.day === today)?.asks.length ?? 0;
  const total = data?.asks.length ?? 0;
  // 8j is the whole screen's state, not one day's: he has people waiting and
  // not one slot anywhere to give them
  const anyFree = days.some((d) => d.free);

  function offerTo(d: DayInfo, a?: Ask) {
    if (!d.free) return;
    setOffer({
      slot: {
        id: slot && isoOf(new Date(slot.starts_at)) === d.day ? slot.id : undefined,
        starts_at: d.free.toISOString(),
        service: cal?.svcName ?? 'Service',
        duration_min: cal?.slotMin ?? 30,
      },
      preselect: a?.customer_id,
    });
  }

  // chat over the list, then the list hands back to whoever opened it
  useAndroidBack(chat ? () => setChat(null) : onBack);

  if (chat) {
    return <ChatScreen dark bookingId={chat.id} myId={barberId}
      title={chat.title} onBack={() => setChat(null)} />;
  }

  // ---- 8i · nobody waiting ----
  if (data && data.asks.length === 0) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title="Waiting list" onBack={onBack} />
        <View style={s.empty}>
          <View style={s.emptyCircle}><Ico name="users" size={30} color={D.muted} /></View>
          <View>
            <T style={s.emptyTitle}>Nobody waiting</T>
            <T size={13} c={D.sub} style={s.emptyBody}>
              When a client finds a day of yours full, they can ask to be told if it opens.
              Those asks land here.
            </T>
          </View>
        </View>
        <View style={s.whyCard}>
          <T w="b" size={10} c={D.sub} ls={1.4}>
            {data.free_today > 0 ? 'YOU HAVE ROOM TODAY' : 'NO ASKS YET'}
          </T>
          <T size={12.5} c={D.sub} style={s.whyBody}>
            Asks only happen on days with nothing left.
            {data.free_today > 0
              ? ` You have ${data.free_today} booking${data.free_today === 1 ? '' : 's'} today, so there is still room.`
              : ' Once a day fills up, the people who wanted it show up here.'}
          </T>
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="Waiting list" onBack={onBack} />

      {/* day chips — the only unit he can act on is a whole day. 8j drops them:
          with nothing free anywhere, filtering to one day changes nothing. */}
      {anyFree && (
        <View style={s.chipRow}>
          <Pressable onPress={() => setPickedDay(null)} style={[s.chip, !pickedDay && s.chipOn]}>
            <T w="b" size={11} c={!pickedDay ? '#fff' : D.sub}>All {total}</T>
          </Pressable>
          {days.map((d) => (
            <Pressable key={d.day} onPress={() => setPickedDay(d.day === pickedDay ? null : d.day)}
              style={[s.chip, pickedDay === d.day && s.chipOn]}>
              <T w={pickedDay === d.day ? 'b' : 'sb'} size={11} c={pickedDay === d.day ? '#fff' : D.sub}>
                {d.day === today ? 'Today' : dayLabel(d.day, today)} {d.asks.length}
              </T>
            </Pressable>
          ))}
        </View>
      )}

      <View style={s.headline}>
        <View>
          <T w="b" size={10} c={D.sub} ls={1.4}>
            {anyFree ? 'ASKING FOR TODAY' : `ASKING · ${days.length} DAY${days.length === 1 ? '' : 'S'}`}
          </T>
          <T style={s.big}>{anyFree ? todayCount : total}</T>
        </View>
        <View style={s.right}>
          <T w="b" size={10} c={D.sub} ls={1.4}>
            {slot ? 'JUST OPENED' : anyFree ? 'FREE RIGHT NOW' : 'FREE TO OFFER'}
          </T>
          {anyFree
            ? (
              <T w="b" size={19} c={D.accent} style={s.num}>
                {hhmm(days.find((d) => d.free)!.free!)}
              </T>
            )
            : <T w="b" size={19} c={D.sub} style={s.mt6}>Nothing</T>}
        </View>
      </View>

      {/* ---- 8h · at least one slot exists, so the list is a shortlist ---- */}
      {anyFree && shown.map((d) => (
        <View key={d.day} style={s.daySection}>
          <T w="b" size={11} c={D.sub} ls={1.65}>
            {d.day === today
              ? `TODAY · ${dateOf(d.day).toLocaleDateString('en-US', { weekday: 'short', day: '2-digit' }).toUpperCase()}`
              : `${dayLabel(d.day, today)} · ${d.asks.length} ASKING${d.free ? '' : ' · FULLY BOOKED'}`}
          </T>
          <View style={s.list9}>
            {d.asks.map((a) => {
              const blocked = a.no_shows >= 2;
              const canOffer = !!d.free && !blocked
                && (a.earliest_min == null
                  || a.earliest_min <= d.free.getHours() * 60 + d.free.getMinutes());
              return (
                <View key={a.id} style={[s.ask, canOffer && s.askOn, blocked && s.dim55]}>
                  <View style={[s.avatar, !blocked && s.avatarWarm]}>
                    <T w="b" size={11} c={blocked ? D.sub : D.accent}>{initials(a.name)}</T>
                  </View>
                  <View style={s.grow}>
                    <T w={blocked ? 'sb' : 'b'} size={13.5} c={blocked ? D.sub : D.text}>{a.name}</T>
                    <T size={11} c={blocked ? D.red : D.sub} style={s.mt2}>
                      {blocked
                        ? `${a.no_shows} no-shows · won't be offered`
                        : `Asked ${askedAt(a.asked_at)} · ${minLabel(a.earliest_min)} · ${a.mine_only ? 'you only' : 'any barber'}`
                          + (a.service ? ` · ${a.service}` : '')}
                    </T>
                  </View>
                  {canOffer && (
                    <Pressable onPress={() => offerTo(d, a)} style={s.offerBtn}>
                      <T w="b" size={11} c="#fff" ls={0.44}>OFFER {hhmm(d.free!)}</T>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {/* ---- 8j · nothing free to offer, on any of them ---- */}
      {!anyFree && days.map((d) => {
        const head = d.asks.slice(0, 2);
        const rest = d.asks.slice(2);
        const reachable = d.asks.find((a) => a.no_shows < 2 && a.last_booking);
        return (
          <View key={d.day} style={s.fullCard}>
            <View style={s.fullHead}>
              <T w="b" size={11} c={D.sub} ls={1.2} style={s.grow}>
                {d.day === today
                  ? `TODAY · ${dateOf(d.day).toLocaleDateString('en-US', { weekday: 'short', day: '2-digit' }).toUpperCase()}`
                  : `${dayLabel(d.day, today)} · ${d.asks.length} ASKING`}
              </T>
              <View style={s.fullChip}>
                <T w="b" size={10} c={D.sub} ls={0.6}>
                  {d.close == null ? 'CLOSED'
                    : d.day === today ? `FULL · CLOSES ${hhmmOf(d.close)}`
                      : `FULL ${hhmmOf(d.open!)}–${hhmmOf(d.close)}`}
                </T>
              </View>
            </View>

            {head.map((a) => (
              <View key={a.id} style={s.fullRow}>
                <View style={[s.avatar34, a.no_shows < 2 && s.avatarWarm]}>
                  <T w="b" size={11} c={a.no_shows < 2 ? D.accent : D.sub}>{initials(a.name)}</T>
                </View>
                <View style={s.grow}>
                  <T w="b" size={13.5}>{a.name}</T>
                  <T size={11} c={D.sub} style={s.mt2}>
                    {a.day === today
                      ? `Asked ${askedAt(a.asked_at)} · ${minLabel(a.earliest_min)}`
                      : `${minLabel(a.earliest_min)} · ${a.mine_only ? 'you only' : 'any barber'} · ${a.visits} visit${a.visits === 1 ? '' : 's'}`}
                  </T>
                </View>
              </View>
            ))}

            {/* the rest as one line — their names matter, their details don't
                until there is something to offer them */}
            {rest.length > 0 && (
              <View style={s.fullRest}>
                <T size={11.5} c={D.sub} style={s.grow}>
                  {rest.map((a) => `${first(a.name)} ${a.no_shows >= 2 ? 'not offered' : minLabel(a.earliest_min)}`)
                    .join(' · ')}
                </T>
              </View>
            )}

            {d.options.length > 0 ? (
              <View style={s.fullFoot}>
                <Pressable style={s.makeBtn} onPress={() => setRoomFor(d)}>
                  <Ico name="plus" size={14} color="#fff" />
                  <T w="b" size={12} c="#fff" ls={0.6}>
                    MAKE ROOM ON {d.day === today ? 'TODAY' : weekday(d.day).toUpperCase()}
                  </T>
                </Pressable>
              </View>
            ) : (
              <View style={s.fullRest}>
                <T size={11.5} c={D.sub} style={s.grow}>
                  {d.day === today
                    ? 'Too late to open anything today'
                    : 'Nothing left to open on that day'}
                </T>
                {!!reachable?.last_booking && (
                  <Pressable style={s.msgBtn}
                    onPress={() => setChat({ id: reachable.last_booking!, title: reachable.name })}>
                    <Ico name="message-square" size={13} color={D.text} />
                    <T w="b" size={11}>MESSAGE {first(reachable.name).toUpperCase()}</T>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        );
      })}

      <View style={s.note}>
        <Ico name="info" size={15} color={D.sub} />
        <T size={12} c={D.sub} style={s.noteText}>
          {anyFree
            ? 'Asks expire when that day is over. Nobody is holding a slot — you choose who gets offered.'
            : 'Offers anchor to a real gap in your day. On a full day, making room is the only way to make one.'}
        </T>
      </View>

      <MakeRoomSheet barberId={barberId} day={roomFor} cal={cal} onClose={() => setRoomFor(null)}
        onMade={(made, note, offerIt) => {
          setRoomFor(null);
          load();
          if (offerIt) setOffer({ slot: made, madeNote: note });
        }} />

      <OfferSlotSheet booking={offer?.slot ?? null} preselect={offer?.preselect}
        madeNote={offer?.madeNote} onClose={() => setOffer(null)}
        onSent={() => { setOffer(null); load(); }} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// 8k — Make room · where the slot comes from
// ---------------------------------------------------------------------------
// Three sources, and each one costs him something he can see before he picks:
// a later finish, a shorter break, or the cleaning time between two clients.
function MakeRoomSheet({ barberId, day, cal, onClose, onMade }: {
  barberId: string; day: DayInfo | null; cal: Cal | null;
  onClose: () => void;
  onMade: (slot: FreedSlot, note: string, offerIt: boolean) => void;
}) {
  const [pick, setPick] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPick(0); }, [day]);

  if (!day || !cal) return null;

  const opts = day.options;
  const chosen = opts[pick] ?? opts[0];
  // who each source would actually reach: an ask only counts if the slot it
  // creates is one that person said they could come to
  const takers = (o: RoomOption) => day.asks.filter((a) =>
    a.no_shows < 2 && (a.earliest_min == null || a.earliest_min <= o.startMin)).length;

  const noteFor = (o: RoomOption) => {
    if (o.source === 'later') return `${weekday(day.day)} now closes at ${hhmmOf(o.endMin)}`;
    if (o.source === 'break') return `${weekday(day.day)}'s break is ${o.sub.toLowerCase()}`;
    return o.sub;
  };

  async function create(offerIt: boolean) {
    if (!chosen || !day || !cal) return;
    setBusy(true);
    // an opening is just a row — no RPC, because there is nothing to decide that
    // the barber has not already decided by picking a source
    const { error } = await supabase.from('time_blocks').insert({
      barber_id: barberId, day: day.day,
      start_min: chosen.startMin, end_min: chosen.endMin,
      kind: 'open', label: 'Made room',
    });
    setBusy(false);
    if (error) return Alert.alert('Could not open that time', error.message);
    onMade({
      starts_at: chosen.at.toISOString(), service: cal.svcName, duration_min: cal.slotMin,
    }, noteFor(chosen), offerIt);
  }

  return (
    <Sheet visible={!!day} onClose={onClose} deep gap={12}>
      <View style={s.sheetHead}>
        <View style={s.grow}>
          <T w="b" size={17}>Make room</T>
          <T size={11} c={D.sub} style={s.mt2}>
            {dateOf(day.day).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
            {' · '}{takers(chosen)} {takers(chosen) === 1 ? 'person' : 'people'} could take it
          </T>
        </View>
        <Pressable onPress={onClose} hitSlop={8} style={s.puck32}><Ico name="x" size={15} /></Pressable>
      </View>

      <T w="b" size={10} c={D.sub} ls={1.4}>WHERE THE SLOT COMES FROM</T>
      <View style={s.list8}>
        {opts.map((o, i) => (
          <Pressable key={o.source} onPress={() => setPick(i)}
            style={[s.srcRow, i === pick && s.srcRowOn]}>
            <View style={[s.radio, i === pick && s.radioOn]}>
              {i === pick && <Ico name="check" size={11} color="#fff" />}
            </View>
            <View style={s.grow}>
              <T w={i === pick ? 'b' : 'sb'} size={13}>{o.title}</T>
              <T size={11} c={o.warn ? D.amber : D.sub} style={s.mt2}>{o.sub}</T>
            </View>
            <View style={s.right}>
              <T w="eb" size={14} c={i === pick ? D.text : D.sub} style={s.num}>{hhmm(o.at)}</T>
              <T size={10} c={i === pick ? D.green : D.sub} style={s.mt2}>
                {takers(o)} can take it
              </T>
            </View>
          </Pressable>
        ))}
      </View>

      {!!chosen && (
        <View style={s.wouldCard}>
          <T w="b" size={10} c={D.sub} ls={1.5}>YOU'D CREATE</T>
          <View style={s.wouldRow}>
            <View>
              <T style={s.wouldBig}>
                {dateOf(day.day).toLocaleDateString('en-US', { weekday: 'short' })} {hhmm(chosen.at)}
              </T>
              <T size={11} c={D.sub} style={s.mt5}>{cal.slotMin} min · one client</T>
            </View>
            <View style={s.right}>
              <T w="b" size={10} c={D.sub} ls={1.2}>WORTH</T>
              <T w="b" size={17} style={s.mt5}>{Math.round(cal.svcCents / 100)} DH</T>
            </View>
          </View>
          <View style={s.wouldFoot}>
            <Ico name="calendar" size={13} color={D.sub} />
            <T size={11} c={D.sub}>
              This {weekday(day.day)} only · your usual hours don't change
            </T>
          </View>
        </View>
      )}

      <Pressable disabled={busy || !chosen} onPress={() => create(true)}
        style={[s.sendBtn, (busy || !chosen) && s.dim55]}>
        <T w="b" size={13} c="#fff" ls={0.78}>
          {busy ? 'OPENING…' : `CREATE ${chosen ? hhmm(chosen.at) : ''} & OFFER IT`}
        </T>
      </Pressable>
      <Pressable disabled={busy || !chosen} onPress={() => create(false)} style={s.centerBtn}>
        <T w="sb" size={12} c={D.sub}>Just create it, don't offer</T>
      </Pressable>
    </Sheet>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  mt2: { marginTop: 2 },
  mt5: { marginTop: 5 },
  mt6: { marginTop: 6 },
  num: { fontVariant: ['tabular-nums'] },
  dim55: { opacity: 0.55 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    height: 34, borderRadius: 999, backgroundColor: D.card2,
    justifyContent: 'center', paddingHorizontal: 14,
  },
  chipOn: { backgroundColor: D.accent },
  headline: {
    backgroundColor: D.card, borderRadius: 20, padding: 16,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  big: { fontFamily: serif, fontWeight: '700', fontSize: 34, lineHeight: 34, color: D.text, marginTop: 5 },

  // 8h
  daySection: { gap: 9 },
  list9: { gap: 9 },
  ask: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 2, borderColor: 'transparent',
  },
  askOn: { borderColor: D.accent },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarWarm: { backgroundColor: D.accentSoft },
  offerBtn: {
    height: 32, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13,
  },

  // 8j — a full day is one card, because it is one decision
  fullCard: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16 },
  fullHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: D.border,
  },
  fullChip: { backgroundColor: D.card2, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  fullRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: D.border,
  },
  avatar34: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  fullRest: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  fullFoot: { paddingVertical: 12 },
  makeBtn: {
    height: 44, borderRadius: 999, backgroundColor: D.accent, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  msgBtn: {
    height: 34, borderRadius: 999, backgroundColor: D.card2, flexDirection: 'row',
    alignItems: 'center', gap: 6, paddingHorizontal: 13,
  },

  // 8k
  sheetHead: { flexDirection: 'row', alignItems: 'center' },
  puck32: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  list8: { gap: 8 },
  srcRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
    borderWidth: 2, borderColor: 'transparent',
  },
  srcRowOn: { borderColor: D.accent },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: D.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: D.accent, borderColor: D.accent },
  wouldCard: { backgroundColor: '#101010', borderRadius: 20, padding: 17, gap: 12 },
  wouldRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  wouldBig: {
    fontFamily: serif, fontWeight: '700', fontSize: 30, lineHeight: 32, color: D.text,
    fontVariant: ['tabular-nums'],
  },
  wouldFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 12,
  },
  sendBtn: {
    height: 54, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  centerBtn: { alignItems: 'center', paddingVertical: 2 },

  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
  },
  noteText: { flex: 1, lineHeight: 18 },

  // 8i
  empty: { alignItems: 'center', gap: 18, paddingTop: 40, paddingHorizontal: 10 },
  emptyCircle: {
    width: 78, height: 78, borderRadius: 39, backgroundColor: D.card,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontFamily: serif, fontWeight: '700', fontSize: 21, color: D.text, textAlign: 'center' },
  emptyBody: { textAlign: 'center', lineHeight: 20, marginTop: 8 },
  whyCard: { backgroundColor: D.card, borderRadius: 18, padding: 16, gap: 7 },
  whyBody: { lineHeight: 19 },
});
