import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ico, Sheet, T, Toggle } from './dark';
import { sameDay } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// Turn 8 of "Barber App.dc.html" — a customer cancels and Youssef is left with a
// hole. 8b is the hole and what to do about it; 8f is the same block once
// somebody took the slot; 8d is the sheet in between.
//
// The reason is rendered as the customer's own words, unedited, with nothing to
// tap on it — no rating, no reply, no dispute. A shop that argues with
// cancellation reasons stops getting honest ones (turn 8's note).

type Cancelled = {
  id: string; starts_at: string; price_cents: number; deposit_cents: number;
  cancel_reason: string | null; cancelled_at: string | null;
  customer_id: string; service: string; duration_min: number;
  who: string; visits: number;
  offer: {
    id: string; claimed_at: string | null; claimed_booking: string | null;
    taker: string | null; sent: number; expires_at: string; public_too: boolean;
  } | null;
};

const dh = (c: number) => (c / 100).toFixed(0);
const hhmm = (iso: string | Date) =>
  (typeof iso === 'string' ? new Date(iso) : iso).toTimeString().slice(0, 5);
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function ago(iso: string | null) {
  if (!iso) return 'just now';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/** the offerable bits of a slot. `id` is the cancelled booking it came from —
 *  absent for an ordinary free time or for room the barber made (8k). */
export type FreedSlot = { id?: string; starts_at: string; service: string; duration_min: number };

export default function CancelledGap({
  barberId, day, bookedTodayCents, onChat, onBreak, onWaitingList, onReload,
}: {
  barberId: string;
  /** the day the timeline is showing — the gap only matters for the day you're looking at */
  day: Date;
  bookedTodayCents: number;
  onChat: (bookingId: string, title: string) => void;
  onBreak: (at: Date, minutes: number) => void;
  /** 8h — the whole list, not just this slot's shortlist */
  onWaitingList: (slot: FreedSlot) => void;
  onReload: () => void;
}) {
  const [rows, setRows] = useState<Cancelled[]>([]);
  const [offering, setOffering] = useState<Cancelled | null>(null);
  const [waiting, setWaiting] = useState(0);

  const load = useCallback(async () => {
    const from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const to = new Date(from.getTime() + 86_400_000);
    const { data } = await supabase.from('bookings')
      .select('id, starts_at, price_cents, deposit_cents, cancel_reason, cancelled_by, customer_id,'
        + ' services(name, duration_min), customer:profiles!customer_id(full_name)')
      .eq('barber_id', barberId).eq('status', 'cancelled')
      .gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
      .order('starts_at');

    // only the ones the CUSTOMER walked away from — his own cancellations are
    // not a hole somebody left him, they're a decision he already made
    const mine = (data ?? []).filter((r: any) => r.cancelled_by && r.cancelled_by !== barberId);
    if (mine.length === 0) { setRows([]); return; }

    const [offers, visits] = await Promise.all([
      supabase.from('slot_offers')
        .select('id, from_booking, claimed_at, claimed_booking, expires_at, public_too,'
          + ' taker:profiles!claimed_by(full_name), slot_offer_targets(customer_id)')
        .in('from_booking', mine.map((r: any) => r.id)),
      supabase.from('bookings').select('customer_id')
        .eq('barber_id', barberId).eq('status', 'completed'),
    ]);
    const visitCount = new Map<string, number>();
    for (const v of (visits.data ?? []) as any[]) {
      visitCount.set(v.customer_id, (visitCount.get(v.customer_id) ?? 0) + 1);
    }
    const offerOf = new Map<string, any>();
    for (const o of (offers.data ?? []) as any[]) offerOf.set(o.from_booking, o);

    setRows(mine.map((r: any) => {
      const o = offerOf.get(r.id);
      return {
        id: r.id, starts_at: r.starts_at, price_cents: r.price_cents,
        deposit_cents: r.deposit_cents, cancel_reason: r.cancel_reason,
        cancelled_at: null, customer_id: r.customer_id,
        service: r.services?.name ?? 'Service', duration_min: r.services?.duration_min ?? 30,
        who: r.customer?.full_name ?? 'A client',
        visits: (visitCount.get(r.customer_id) ?? 0) + 1,
        offer: o ? {
          id: o.id, claimed_at: o.claimed_at, claimed_booking: o.claimed_booking,
          taker: o.taker?.full_name ?? null, sent: (o.slot_offer_targets ?? []).length,
          expires_at: o.expires_at, public_too: o.public_too,
        } : null,
      };
    }));
  }, [barberId, day]);

  useEffect(() => { load(); }, [load]);

  // 0050 made an ask able to name the shop instead of a chair, and gave it a
  // status — so a direct count on (barber_id, day) both misses and over-counts.
  // The RPC is the one place that knows which asks are his.
  useEffect(() => {
    const d = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    supabase.rpc('barber_waitlist').then(({ data }) =>
      setWaiting(((data as any)?.asks ?? []).filter((a: any) => a.day === d).length));
  }, [barberId, day]);

  if (rows.length === 0) return null;

  return (
    <>
      {rows.map((r) => {
        const taken = !!r.offer?.claimed_at;
        const at = hhmm(r.starts_at);
        const past = new Date(r.starts_at).getTime() < Date.now();

        // ---- 8f · somebody took it ----
        if (taken) {
          return (
            <View key={r.id} style={s.gap12}>
              <View style={s.tookCard}>
                <View style={s.tookIcon}><Ico name="check" size={17} color={D.green} /></View>
                <View style={s.grow}>
                  <T w="b" size={13} c={D.green}>
                    {(r.offer!.taker ?? 'Someone').split(' ')[0]} took {at}
                  </T>
                  <T size={11} c={D.sub} style={s.mt2}>
                    {ago(r.offer!.claimed_at)} · {dh(r.deposit_cents)} DH deposit paid
                  </T>
                </View>
                {!!r.offer!.claimed_booking && (
                  <Pressable hitSlop={8}
                    onPress={() => onChat(r.offer!.claimed_booking!, r.offer!.taker ?? 'Client')}>
                    <T w="b" size={11} c={D.green}>Chat</T>
                  </Pressable>
                )}
              </View>

              <View style={s.statRow}>
                <View style={s.stat}>
                  <T w="b" size={10} c={D.sub} ls={0.8}>BOOKED TODAY</T>
                  <T w="b" size={20} style={s.num}>
                    {dh(bookedTodayCents)}<T size={11} c={D.sub}> DH</T>
                  </T>
                  <T size={10} c={D.green} style={s.mt2}>back where it was</T>
                </View>
                <View style={s.stat}>
                  <T w="b" size={10} c={D.sub} ls={0.8}>KEPT DEPOSIT</T>
                  <T w="b" size={20} c={D.green} style={s.num}>
                    +{dh(r.deposit_cents)}<T size={11} c={D.sub}> DH</T>
                  </T>
                  <T size={10} c={D.sub} style={s.mt2}>from {r.who.split(' ')[0]}</T>
                </View>
              </View>
            </View>
          );
        }

        // ---- 8g · the offer ran out and the slot is still his problem ----
        const expired = !!r.offer && !taken && new Date(r.offer.expires_at).getTime() <= Date.now();
        if (expired && !past) {
          return (
            <View key={r.id} style={s.gap12}>
              <View style={s.expiredCard}>
                <View style={s.expiredIcon}><Ico name="clock" size={16} color={D.sub} /></View>
                <View style={s.grow}>
                  <T w="b" size={13}>Offer expired · {at} still free</T>
                  <T size={11} c={D.sub} style={s.mt2}>
                    Sent to {r.offer!.sent} · nobody took it
                  </T>
                </View>
              </View>

              <T w="b" size={11} c={D.sub} ls={1.65} style={s.eyebrow}>WHAT NOW</T>
              <View style={s.list9}>
                {/* the one that costs him nothing and reaches furthest */}
                <Pressable style={[s.whatRow, !r.offer!.public_too && s.whatRowOn]}
                  disabled={r.offer!.public_too}
                  onPress={async () => {
                    const { error } = await supabase.from('slot_offers')
                      .update({ public_too: true, expires_at: r.starts_at }).eq('id', r.offer!.id);
                    if (error) return Alert.alert('Could not open it', error.message);
                    load();
                  }}>
                  <View style={[s.whatIcon, !r.offer!.public_too && s.whatIconOn]}>
                    <Ico name="globe" size={16} color={r.offer!.public_too ? D.sub : D.accent} />
                  </View>
                  <View style={s.grow}>
                    <T w={r.offer!.public_too ? 'sb' : 'b'} size={13}>
                      {r.offer!.public_too ? 'Open to everyone already' : 'Open it to everyone'}
                    </T>
                    <T size={11} c={D.sub} style={s.mt2}>
                      Shows as a free {at} on your page
                    </T>
                  </View>
                  {!r.offer!.public_too && <Ico name="chevron-right" size={16} color={D.sub} />}
                </Pressable>

                <Pressable style={s.whatRow} onPress={() => setOffering(r)}>
                  <View style={s.whatIcon}><Ico name="user-plus" size={16} color={D.sub} /></View>
                  <View style={s.grow}>
                    <T w="sb" size={13}>Ask someone else</T>
                    <T size={11} c={D.sub} style={s.mt2}>Pick from your clients again</T>
                  </View>
                  <Ico name="chevron-right" size={16} color={D.sub} />
                </Pressable>

                <Pressable style={s.whatRow}
                  onPress={() => onBreak(new Date(r.starts_at), r.duration_min)}>
                  <View style={[s.whatIcon, s.whatIconAmber]}>
                    <Ico name="coffee" size={16} color={D.amber} />
                  </View>
                  <View style={s.grow}>
                    <T w="sb" size={13}>Make it a break</T>
                    <T size={11} c={D.sub} style={s.mt2}>
                      Back at {hhmm(new Date(new Date(r.starts_at).getTime() + r.duration_min * 60_000))}
                    </T>
                  </View>
                  <Ico name="chevron-right" size={16} color={D.sub} />
                </Pressable>
              </View>
            </View>
          );
        }

        // ---- 8b · the hole ----
        return (
          <View key={r.id} style={s.gap12}>
            <View style={s.card}>
              <View style={s.row11}>
                <View style={s.avatar}><T w="b" size={11} c={D.sub}>{initials(r.who)}</T></View>
                <View style={s.grow}>
                  <T w="b" size={13}>{r.who.split(' ')[0]} cancelled · {ago(r.cancelled_at)}</T>
                  <T size={11} c={D.sub} style={s.mt2}>
                    {r.service} · was {at} · {r.visits}
                    {r.visits === 1 ? 'st' : r.visits === 2 ? 'nd' : r.visits === 3 ? 'rd' : 'th'} visit
                  </T>
                </View>
              </View>

              {/* his words, as written — nothing here rates or answers them */}
              {!!r.cancel_reason && (
                <View style={s.quote}>
                  <Ico name="message-square" size={15} color={D.sub} />
                  <T size={13} c={D.textDim} style={s.quoteText}>{r.cancel_reason}</T>
                </View>
              )}

              {r.deposit_cents > 0 && (
                <View style={s.depRow}>
                  <T size={11} c={D.sub} style={s.grow}>
                    His {dh(r.deposit_cents)} DH deposit stays with you
                  </T>
                  <T w="eb" size={13} c={D.green} style={s.num}>+{dh(r.deposit_cents)} DH</T>
                </View>
              )}
            </View>

            {!past && (
              <>
                <T w="b" size={11} c={D.sub} ls={1.65} style={s.eyebrow}>
                  {r.duration_min} MIN FREE FROM {at}
                </T>

                <View style={s.tlRow}>
                  <T w="b" size={11} c={D.accent} style={s.tlTime}>{at}</T>
                  <View style={s.tlRail} />
                  <View style={s.openCard}>
                    <View>
                      <T w="b" size={13} c={D.accent}>Just opened up</T>
                      <T size={11} c={D.sub} style={s.mt2}>
                        {r.duration_min} min · fill it before someone walks in
                      </T>
                    </View>
                    <View style={s.btnRow}>
                      <Pressable onPress={() => setOffering(r)} style={s.offerBtn}>
                        <T w="b" size={11} c="#fff" ls={0.44}>OFFER IT</T>
                      </Pressable>
                      <Pressable style={s.breakBtn}
                        onPress={() => onBreak(new Date(r.starts_at), r.duration_min)}>
                        <T w="b" size={11} c={D.sub} ls={0.44}>TAKE A BREAK</T>
                      </Pressable>
                    </View>
                  </View>
                </View>

                {waiting > 0 && (
                  <Pressable style={s.waitCard} onPress={() => onWaitingList(r)}>
                    <View style={s.waitIcon}><Ico name="users" size={15} color={D.sub} /></View>
                    <View style={s.grow}>
                      <T w="b" size={13}>Tell your waiting list</T>
                      <T size={11} c={D.sub} style={s.mt2}>
                        {waiting} client{waiting === 1 ? '' : 's'} asked about today
                      </T>
                    </View>
                    <Ico name="chevron-right" size={16} color={D.sub} />
                  </Pressable>
                )}
              </>
            )}
          </View>
        );
      })}

      <OfferSlotSheet booking={offering} onClose={() => setOffering(null)}
        onSent={() => { setOffering(null); load(); onReload(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------
// 8d — Offer it · who gets asked
// ---------------------------------------------------------------------------
type Candidate = {
  id: string; name: string; kind: 'asked' | 'move' | 'in_chair' | 'regular';
  why: string; no_shows: number;
};

export function OfferSlotSheet({ booking, preselect, madeNote, onClose, onSent }: {
  booking: FreedSlot | null;
  /** arrived from 8h with one person already in mind */
  preselect?: string;
  /** 8l — what he gave up to create this slot. Its presence is what makes this
   *  the made-slot variant: no break to fall back on, and the public toggle
   *  starts off, because room made by hand is aimed at someone. */
  madeNote?: string;
  onClose: () => void; onSent: () => void;
}) {
  const [cands, setCands] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [publicToo, setPublicToo] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (booking) setPublicToo(!madeNote); }, [booking, madeNote]);

  useEffect(() => {
    if (!booking) { setCands([]); setPicked([]); return; }
    (async () => {
      const me = (await supabase.auth.getUser()).data.user?.id;
      const { data, error } = await supabase.rpc('offer_candidates',
        { p_barber: me, p_starts_at: booking.starts_at });
      if (error) return Alert.alert('Could not load your clients', error.message);
      const list = (data as Candidate[]) ?? [];
      setCands(list);
      // 8d opens with the people who actually asked already ticked
      const asked = list.filter((c) => c.kind === 'asked' && c.no_shows === 0).map((c) => c.id);
      setPicked(preselect && !asked.includes(preselect) ? [preselect, ...asked] : asked);
    })();
  }, [booking, preselect]);

  async function send() {
    if (!booking || picked.length === 0) return;
    setBusy(true);
    // a cancellation anchors the offer to the booking that left the hole; a slot
    // he made or that was simply free has no such row behind it
    const { error } = booking.id
      ? await supabase.rpc('create_slot_offer', {
        p_from_booking: booking.id, p_customers: picked, p_public: publicToo, p_minutes: 30,
      })
      : await supabase.rpc('create_open_offer', {
        p_starts_at: booking.starts_at, p_customers: picked, p_public: publicToo, p_minutes: 30,
      });
    setBusy(false);
    if (error) return Alert.alert('Could not send the offer', error.message);
    onSent();
  }

  const at = booking ? hhmm(booking.starts_at) : '';
  const when = booking && !sameDay(new Date(booking.starts_at), new Date())
    ? new Date(booking.starts_at).toLocaleDateString('en-US', { weekday: 'short' })
    : null;

  return (
    <Sheet visible={!!booking} onClose={onClose} deep gap={12}>
      <View style={s.offerHead}>
        <View style={s.grow}>
          <T w="b" size={17}>Offer {when ? `${when} ` : ''}{at}</T>
          <T size={11} c={D.sub} style={s.mt2}>
            {madeNote
              ? `${booking?.duration_min ?? 30} min · you just opened it`
              : `${when ?? 'Today'} · ${booking?.duration_min ?? 30} min · ${booking?.service ?? 'Service'}`}
          </T>
        </View>
        <Pressable onPress={onClose} hitSlop={8} style={s.puck32}><Ico name="x" size={15} /></Pressable>
      </View>

      {/* 8l — the day changed shape to make this slot, and he should see it said
          back before he sends it to anyone */}
      {!!madeNote && (
        <View style={s.madeRow}>
          <Ico name="check" size={15} color={D.green} />
          <T w="sb" size={12} c={D.green} style={s.grow}>{madeNote}</T>
        </View>
      )}

      <View style={s.note}>
        <Ico name="info" size={15} color={D.sub} />
        <T size={12} c={D.sub} style={s.noteText}>
          First to tap it gets it. Nobody else is charged or held.
        </T>
      </View>

      <T w="b" size={10} c={D.sub} ls={1.4}>ASK · {picked.length} PICKED</T>
      <View style={s.list8}>
        {cands.map((c) => {
          const blocked = c.no_shows >= 2;
          const on = picked.includes(c.id);
          return (
            <Pressable key={c.id} disabled={blocked}
              onPress={() => setPicked((xs) => on ? xs.filter((x) => x !== c.id) : [...xs, c.id])}
              style={[s.cand, on && s.candOn, blocked && s.dim55]}>
              <View style={[s.box, on && s.boxOn]}>
                {on && <Ico name="check" size={12} color="#fff" />}
              </View>
              <View style={[s.candAvatar, on && s.candAvatarOn]}>
                <T w="b" size={11} c={on ? D.accent : D.sub}>{initials(c.name)}</T>
              </View>
              <View style={s.grow}>
                <T w={on ? 'b' : 'sb'} size={13} c={blocked ? D.sub : D.text}>{c.name}</T>
                <T size={11} c={blocked ? D.red : D.sub} style={s.mt2}>
                  {blocked ? `${c.no_shows} no-shows · not offered` : c.why}
                </T>
              </View>
              {c.kind === 'asked' && !blocked && (
                <View style={s.askedChip}><T w="b" size={10} c={D.green} ls={0.6}>ASKED</T></View>
              )}
              {c.kind === 'move' && !blocked && (
                <View style={s.moveChip}><T w="b" size={10} c={D.sub} ls={0.6}>MOVE</T></View>
              )}
            </Pressable>
          );
        })}
        {cands.length === 0 && (
          <T size={13} c={D.sub}>Nobody to ask yet — clients appear here once they've booked with you.</T>
        )}
      </View>

      <View style={s.pubRow}>
        <View style={s.grow}>
          <T w="b" size={13}>Put it on your public page too</T>
          <T size={11} c={D.sub} style={s.mt2}>Anyone browsing the shop sees a free {at}</T>
        </View>
        <Toggle on={publicToo} onPress={() => setPublicToo((v) => !v)} />
      </View>

      <Pressable disabled={busy || picked.length === 0} onPress={send}
        style={[s.sendBtn, (busy || picked.length === 0) && s.dim55]}>
        <T w="b" size={13} c="#fff" ls={0.78}>
          {busy ? 'SENDING…' : `SEND TO ${picked.length} CLIENT${picked.length === 1 ? '' : 'S'}`}
        </T>
      </Pressable>
      {/* only a cancelled slot has a break to fall back on — the alternative to
          offering room he just made is not a break, it's nothing */}
      {!madeNote && (
        <Pressable onPress={onClose} style={s.centerBtn}>
          <T w="sb" size={12} c={D.sub}>Take the break instead</T>
        </Pressable>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  num: { fontVariant: ['tabular-nums'] },
  dim55: { opacity: 0.55 },
  gap12: { gap: 12 },

  // 8b
  card: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 15, gap: 12 },
  row11: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  quote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: D.card2,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  quoteText: { flex: 1, lineHeight: 19 },
  depRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderTopWidth: 1, borderTopColor: D.border, paddingTop: 12,
  },
  eyebrow: { marginTop: 2 },
  tlRow: { flexDirection: 'row', gap: 11, alignItems: 'stretch' },
  tlTime: { width: 44, paddingTop: 16, fontVariant: ['tabular-nums'] },
  tlRail: { width: 3, borderRadius: 2, backgroundColor: D.accent },
  openCard: {
    flex: 1, borderWidth: 1.5, borderColor: D.accent, borderStyle: 'dashed',
    borderRadius: 16, padding: 14, gap: 11,
  },
  btnRow: { flexDirection: 'row', gap: 8 },
  offerBtn: {
    flex: 1, height: 38, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  breakBtn: {
    flex: 1, height: 38, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  waitCard: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14,
  },
  waitIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  // 8g
  list9: { gap: 9 },
  expiredCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderWidth: 1, borderColor: D.border, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 15,
  },
  expiredIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  whatRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: D.card,
    borderRadius: 18, paddingHorizontal: 14, paddingVertical: 13,
    borderWidth: 2, borderColor: 'transparent',
  },
  whatRowOn: { borderColor: D.accent },
  whatIcon: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  whatIconOn: { backgroundColor: D.accentSoft },
  whatIconAmber: { backgroundColor: 'rgba(232,161,0,0.14)' },

  // 8f
  tookCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.greenSoft10, borderWidth: 1, borderColor: D.greenLine,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 15,
  },
  tookIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(74,222,128,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 14, gap: 3 },

  // 8d
  offerHead: { flexDirection: 'row', alignItems: 'center' },
  puck32: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  noteText: { flex: 1, lineHeight: 18 },
  madeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.greenSoft10,
    borderWidth: 1, borderColor: D.greenLine, borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  list8: { gap: 8 },
  cand: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 2, borderColor: 'transparent',
  },
  candOn: { borderColor: D.accent },
  box: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: D.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: D.accent, borderColor: D.accent },
  candAvatar: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  candAvatarOn: { backgroundColor: D.accentSoft },
  askedChip: {
    backgroundColor: D.greenSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4,
  },
  moveChip: { backgroundColor: D.card2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 4 },
  pubRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
  },
  sendBtn: {
    height: 54, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  centerBtn: { alignItems: 'center', paddingVertical: 2 },
});
