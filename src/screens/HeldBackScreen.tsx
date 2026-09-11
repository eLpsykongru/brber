import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { FreedSlot, OfferSlotSheet } from '../components/CancelledGap';
import { Eyebrow, Ico, Screen, T, Toggle, TopBar } from '../components/dark';
import {
  Action, InboxNotif, LiveBooking, SilenceRule, agoLabel, countWord, heldDuringCut, laneOf,
  sortWorth, spanLabel,
} from '../lib/inboxRules';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// G3 of "Notification Routing.dc.html" — BNT-05 of "Barber - Notifications".
//
// BNT-03 lets the barber silence everything from the start of a cut to mark-done,
// which is right — but a cancellation held for forty minutes is a slot that could
// have been resold. This hands the held ones over once the cut is done, ordered
// by what is still worth doing, and offers the single exception instead of asking
// for the rule to be turned off.
//
// There is no hold queue on the server: 0104 logs only the pushes it tried, so the
// held ones are read back off the cut itself (heldDuringCut). And a request dies
// at its start time here, as 0015 has it — not "in two hours" as the mock says.

type BookingRow = LiveBooking & {
  ends_at: string; price_cents: number; customer_id: string; walk_in_name: string | null;
  services: { name: string } | null;
  customer: { full_name: string | null } | null;
};

export type HeldItem = { notif: InboxNotif; booking: BookingRow | undefined; worth: boolean; action: Action };

export type Held = {
  cut: { id: string; started_at: string; completed_at: string; who: string | null };
  items: HeldItem[];
  gotThrough: number;
  cancellationsBreak: boolean;
};

const hh = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const dh = (cents: number) => `${Math.round(cents / 100)} DH`;

type Named = { walk_in_name: string | null; customer_id: string; customer: { full_name: string | null } | null };
const whoOf = (b: Named, barberId: string) =>
  b.walk_in_name ?? (b.customer_id === barberId ? null : b.customer?.full_name ?? null);

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return `today ${hh(iso)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${hh(iso)}`;
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${hh(iso)}`;
}

/**
 * The last cut finished today, and what arrived during it that never buzzed. Null
 * when there is nothing to hand over: no cut today, the rule is off, or nothing
 * came in while it ran.
 */
export async function loadHeld(barberId: string): Promise<Held | null> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [cutQ, prefsQ] = await Promise.all([
    supabase.from('bookings')
      .select('id, started_at, completed_at, customer_id, walk_in_name, customer:profiles!customer_id(full_name)')
      .eq('barber_id', barberId).not('started_at', 'is', null).not('completed_at', 'is', null)
      .gte('completed_at', dayStart.toISOString())
      .order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('notification_prefs').select('*').eq('user_id', barberId).maybeSingle(),
  ]);
  const cut = cutQ.data as unknown as (Named & { id: string; started_at: string; completed_at: string }) | null;
  if (!cut) return null;

  // no row yet is 0032's defaults: silent while cutting, urgent always, cancellations on
  const p = prefsQ.data as Record<string, unknown> | null;
  const rule: SilenceRule = {
    silent: p ? p.silent_while_cutting !== false : true,
    urgentAlways: p ? p.urgent_always !== false : true,
    pushCancellation: p ? p.push_cancellation !== false : true,
    cancellationsBreak: p?.cancel_breaks_silence === true,
  };
  if (!rule.silent) return null;

  const { data } = await supabase.from('notifications')
    .select('id, kind, title, body, booking_id, read_at, created_at')
    .eq('user_id', barberId).gte('created_at', cut.started_at).lt('created_at', cut.completed_at)
    .order('created_at');
  const arrived = (data ?? []) as InboxNotif[];
  if (!arrived.length) return null;

  const ids = [...new Set(arrived.map((n) => n.booking_id).filter((x): x is string => !!x))];
  let bookings: BookingRow[] = [];
  let openAsks = new Set<string>();
  if (ids.length) {
    const [bk, asks] = await Promise.all([
      supabase.from('bookings')
        .select('id, status, starts_at, ends_at, price_cents, customer_id, walk_in_name, services(name),'
          + ' customer:profiles!customer_id(full_name)')
        .in('id', ids),
      supabase.from('reschedule_requests').select('booking_id').eq('status', 'pending').in('booking_id', ids),
    ]);
    bookings = (bk.data ?? []) as unknown as BookingRow[];
    openAsks = new Set(((asks.data ?? []) as { booking_id: string }[]).map((r) => r.booking_id));
  }
  const byId: Record<string, BookingRow> = Object.fromEntries(bookings.map((b) => [b.id, b]));

  const { held, gotThrough } = heldDuringCut(arrived, cut, rule, byId);
  if (!held.length) return null;
  const now = Date.now();
  return {
    cut: { id: cut.id, started_at: cut.started_at, completed_at: cut.completed_at, who: whoOf(cut, barberId) },
    items: held.map((n) => {
      const b = n.booking_id ? byId[n.booking_id] : undefined;
      return { notif: n, booking: b, ...laneOf(n, b, !!n.booking_id && openAsks.has(n.booking_id), now) };
    }),
    gotThrough,
    cancellationsBreak: rule.cancellationsBreak,
  };
}

const readNote = (i: HeldItem) =>
  i.action === 'open_review' ? 'nothing to answer'
    : i.notif.kind === 'booking_request' || i.notif.kind === 'reschedule' ? 'no longer open'
      : i.notif.kind === 'cancellation' ? 'nothing left to refill'
        : i.notif.body ?? 'nothing to answer';

export default function HeldBackScreen({ barberId, held, onBack, onOpenAsk, onOpenReview, onChanged }: {
  barberId: string; held: Held; onBack: () => void;
  onOpenAsk: (bookingId: string) => void; onOpenReview: (bookingId: string) => void;
  /** something here changed the day, so the dashboard reloads */
  onChanged: () => void;
}) {
  const [breakOn, setBreakOn] = useState(held.cancellationsBreak);
  const [offer, setOffer] = useState<{ slot: FreedSlot; notifId: string } | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function answer(i: HeldItem, accept: boolean) {
    if (!i.booking) return;
    setBusy(i.notif.id);
    const { error } = accept
      ? await supabase.rpc('accept_booking', { p_booking: i.booking.id })
      : await supabase.rpc('cancel_booking', { p_booking: i.booking.id, p_reason: 'Declined' });
    setBusy(null);
    if (error) { Alert.alert(accept ? 'Could not accept' : 'Could not decline', error.message); return; }
    setDone((d) => ({ ...d, [i.notif.id]: accept ? 'Accepted' : 'Declined' }));
    onChanged();
  }

  async function toggleBreak(on: boolean) {
    setBreakOn(on);
    const { error } = await supabase.from('notification_prefs').upsert(
      { user_id: barberId, cancel_breaks_silence: on, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' });
    if (error) { setBreakOn(!on); Alert.alert('Could not save', error.message); }
  }

  const now = Date.now();
  const worth = sortWorth(held.items.filter((i) => i.worth));
  const read = held.items.filter((i) => !i.worth);
  const inChair = held.cut.who ?? 'a walk-in';
  const span = `from ${hh(held.cut.started_at)} to ${hh(held.cut.completed_at)}`;

  return (
    <>
      <Screen gap={11}>
        <TopBar title="Held back" onBack={onBack} />

        <View style={s.amberCard}>
          <View style={s.row10}>
            <Ico name="scissors" size={16} color={D.amber} />
            <T w="b" size={14} c={D.amber} style={s.grow}>
              {countWord(held.items.length)} waited for you to finish
            </T>
          </View>
          <T size={11.5} c={D.textDim} style={s.lh17}>
            {held.gotThrough === 0
              ? `Silent while cutting did its job — nothing buzzed ${span}, while ${inChair} was in the chair. Nothing was lost.`
              : `Silent while cutting held everything else ${span}, while ${inChair} was in the chair — `
                + `${countWord(held.gotThrough).toLowerCase()} cancellation${held.gotThrough === 1 ? '' : 's'} `
                + 'still got through, as your settings say. Nothing was lost.'}
          </T>
        </View>

        {worth.length > 0 && <Eyebrow ls={1.65} style={s.mt2}>STILL WORTH DOING</Eyebrow>}
        {worth.map((i) => {
          const b = i.booking!;
          const outcome = done[i.notif.id];
          const name = whoOf(b, barberId) ?? 'A walk-in';
          const service = b.services?.name ?? 'Service';
          const arrived = <T w="b" size={10.5} c={D.faint} style={s.tnum}>{hh(i.notif.created_at)}</T>;

          if (i.action === 'offer') {
            return (
              <View key={i.notif.id} style={[s.card, s.cardHot]}>
                <View style={s.rowBase}>
                  <T w="b" size={13.5} style={s.grow}>{hh(b.starts_at)} cancelled — slot is empty</T>
                  {arrived}
                </View>
                <T size={11.5} c={D.sub} style={s.lh17}>
                  {name}&apos;s {hh(b.starts_at)} went {agoLabel(now - Date.parse(i.notif.created_at))}. Still{' '}
                  {spanLabel(Date.parse(b.starts_at) - now)} of notice.
                </T>
                {outcome
                  ? <T w="sb" size={11.5} c={D.green}>{outcome}</T>
                  : (
                    <Pressable accessibilityRole="button"
                      onPress={() => setOffer({
                        notifId: i.notif.id,
                        slot: {
                          id: b.id, starts_at: b.starts_at, service,
                          duration_min: Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60_000),
                        },
                      })}
                      style={({ pressed }) => [s.redCta, pressed && s.pressed]}>
                      <T w="eb" size={11.5} c="#fff" ls={0.5}>OFFER {hh(b.starts_at)} TO THE WAITLIST</T>
                    </Pressable>
                  )}
              </View>
            );
          }

          if (i.action === 'answer_request') {
            return (
              <View key={i.notif.id} style={s.card}>
                <View style={s.rowBase}>
                  <T w="b" size={13.5} style={s.grow}>New request · {dh(b.price_cents)}</T>
                  {arrived}
                </View>
                <T size={11.5} c={D.sub} style={s.lh17}>
                  {name} wants {when(b.starts_at)}, {service}. A request stays open until its start time —{' '}
                  <T w="b" size={11.5} c={D.amber}>this one has {spanLabel(Date.parse(b.starts_at) - now)} left</T>.
                </T>
                {outcome
                  ? <T w="sb" size={11.5} c={outcome === 'Accepted' ? D.green : D.sub}>{outcome}</T>
                  : (
                    <View style={s.row8}>
                      <Pressable onPress={() => answer(i, true)} disabled={busy === i.notif.id}
                        accessibilityRole="button" style={({ pressed }) => [s.whiteCta, s.grow, pressed && s.pressed]}>
                        <T w="eb" size={11.5} c="#111" ls={0.5}>ACCEPT</T>
                      </Pressable>
                      <Pressable onPress={() => answer(i, false)} disabled={busy === i.notif.id}
                        accessibilityRole="button" style={({ pressed }) => [s.greyCta, pressed && s.pressed]}>
                        <T w="b" size={11.5} c={D.textDim}>Decline</T>
                      </Pressable>
                    </View>
                  )}
              </View>
            );
          }

          return (
            <View key={i.notif.id} style={s.card}>
              <View style={s.rowBase}>
                <T w="b" size={13.5} style={s.grow}>Reschedule ask</T>
                {arrived}
              </View>
              <T size={11.5} c={D.sub} style={s.lh17}>
                {i.notif.body ?? `${name} asked to move ${when(b.starts_at)}.`}
              </T>
              <Pressable onPress={() => onOpenAsk(b.id)} accessibilityRole="button"
                style={({ pressed }) => [s.whiteCta, pressed && s.pressed]}>
                <T w="eb" size={11.5} c="#111" ls={0.5}>ANSWER IT</T>
              </Pressable>
            </View>
          );
        })}

        {read.length > 0 && (
          <>
            <Eyebrow ls={1.65} style={s.mt2}>READ IT WHEN YOU CAN</Eyebrow>
            <View style={s.readList}>
              {read.map((i, idx) => (
                <View key={i.notif.id} style={[s.readRow, idx < read.length - 1 && s.readLine]}>
                  <View style={s.grow}>
                    <T w="sb" size={12.5}>{i.notif.title}</T>
                    <T size={11} c={D.sub} style={s.mt2} numberOfLines={2}>
                      Arrived {hh(i.notif.created_at)} · {readNote(i)}
                    </T>
                  </View>
                  {i.action === 'open_review' && !!i.notif.booking_id && (
                    <Pressable onPress={() => onOpenReview(i.notif.booking_id!)} hitSlop={8}
                      accessibilityRole="button" style={({ pressed }) => pressed && s.pressed}>
                      <T w="sb" size={11.5} c={D.accent}>Open</T>
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        <View style={s.exceptCard}>
          <T size={12} c={D.textDim} style={s.lh17}>
            Cancellations are the only ones where waiting costs you money. Let them through anyway?
          </T>
          <View style={s.row12}>
            <T w="b" size={12.5} style={s.grow}>Cancellations break the silence</T>
            <Toggle on={breakOn} color={D.accent} onPress={() => toggleBreak(!breakOn)} />
          </View>
          <T size={10.5} c={D.faint} style={s.exceptFoot}>
            One buzz for a cancellation. Everything else keeps waiting for you to finish.
          </T>
        </View>
      </Screen>

      <OfferSlotSheet booking={offer?.slot ?? null} onClose={() => setOffer(null)}
        onSent={() => {
          const id = offer?.notifId;
          if (id) setDone((d) => ({ ...d, [id]: 'Offered — the first to tap it gets it' }));
          setOffer(null);
          onChanged();
        }} />
    </>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  lh17: { lineHeight: 17 },
  tnum: { fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.75 },
  row8: { flexDirection: 'row', gap: 8 },
  row10: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row12: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBase: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },

  amberCard: {
    backgroundColor: 'rgba(232,161,0,0.10)', borderWidth: 1, borderColor: D.amberLine, borderRadius: 20,
    paddingVertical: 15, paddingHorizontal: 16, gap: 6,
  },
  card: { backgroundColor: D.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 15, gap: 9 },
  cardHot: { borderLeftWidth: 3, borderLeftColor: D.accent },
  redCta: { height: 38, borderRadius: 12, backgroundColor: D.accent, alignItems: 'center', justifyContent: 'center' },
  whiteCta: { height: 38, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  greyCta: {
    width: 104, height: 38, borderRadius: 12, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  readList: {
    backgroundColor: D.recessed, borderWidth: 1, borderColor: D.seam, borderRadius: 18,
    paddingHorizontal: 15, paddingVertical: 6,
  },
  readRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12 },
  readLine: { borderBottomWidth: 1, borderBottomColor: D.seam },

  exceptCard: { backgroundColor: D.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 15, gap: 11, marginTop: 2 },
  exceptFoot: { lineHeight: 15, borderTopWidth: 1, borderTopColor: D.border, paddingTop: 10 },
});
