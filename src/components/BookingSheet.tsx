import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { LowWalletBlock } from './Failures';
import { Block, daySlots, nextFree, Range, Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, sp } from '../theme';
import type { Specialist } from '../types';
import { AskBlock, AskedSheet, type AskRecord } from './AskSheet';
import BookingNoteSheet from './BookingNote';
import { PillButton, Stars } from './ui';
import SlotPicker from './SlotPicker';
import { loc, tr, trn } from '../lib/i18n';

type SalonLike = { id: string; name: string; address: string | null; barbers: Specialist[] };
type Step = 'service' | 'barber' | 'time' | 'summary';
const SCREEN_H = Dimensions.get('window').height;

// 8a/8b — the deposit floor, mirrored from fill_booking. Both sides enforce it;
// this copy only exists so the UI can grey out what the server would reject.
//
// OSH-11 (0076) moved the percentage to the shop, so it is no longer a constant:
// the sheet asks `booking_deposit_pct` for the resolved number — the greater of
// the shop's policy and this customer's late-arrival floor, or 0 at a shop that
// asks for no deposit at all. 40 is only the value before the answer arrives,
// which is what every shop without a policy still resolves to.
const floorAt = (priceCents: number, pct: number) => Math.ceil((priceCents * pct) / 100);
const dh = (cents: number) => (cents / 100).toFixed(0);
const hhmm = (d: Date) => d.toTimeString().slice(0, 5);

/** BOOK-21's green line. Names the day only when it isn't today or tomorrow. */
function freeLabel(t: Date): string {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((midnight(t) - midnight(new Date())) / 86_400_000);
  const at = hhmm(t);
  return days === 0 ? tr('Free at {at} today', { at })
    : days === 1 ? tr('Free at {at} tomorrow', { at })
      : tr('Free at {at} {day}', { at, day: t.toLocaleDateString(loc('en-US'), { weekday: 'short' }) });
}

// distinct active service names across the salon, with price range
function serviceMenu(salon: SalonLike) {
  const byName = new Map<string, { name: string; min: number; max: number; category: string }>();
  for (const b of salon.barbers) {
    for (const sv of b.services) {
      if (!sv.is_active) continue;
      const e = byName.get(sv.name);
      if (e) { e.min = Math.min(e.min, sv.price_cents); e.max = Math.max(e.max, sv.price_cents); }
      else byName.set(sv.name, { name: sv.name, min: sv.price_cents, max: sv.price_cents, category: sv.category ?? 'Hair Services' });
    }
  }
  return [...byName.values()];
}

export default function BookingSheet({ visible, salon, onClose, onBooked, onFinished }: {
  visible: boolean; salon: SalonLike; onClose: () => void; onBooked: () => void;
  // fired only when the sheet closes AFTER a booking - dragging it away or
  // tapping X without booking must leave him exactly where he was
  onFinished?: () => void;
}) {
  const [step, setStep] = useState<Step>('service');
  // multi-select: the cut is n services in one sitting, not one. Names rather
  // than ids because a name is what the salon menu groups by — the ids only
  // exist once a barber is chosen.
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [barber, setBarber] = useState<Specialist | null>(null);
  // BOOK-21 — "Anyone free" is the default. It is not a booking against nobody:
  // the grid shows every chair's free times at once and picking one *resolves*
  // `barber` to whoever actually had it, so confirm, deposit and price all run
  // against a real specialist with no second code path.
  const [anyBarber, setAnyBarber] = useState(true);
  // BOOK-21 — first bookable start per chair, for the green line under each row
  const [nextFreeBy, setNextFreeBy] = useState<Record<string, Date | null>>({});
  const [time, setTime] = useState<Date | null>(null);
  const [me, setMe] = useState<{ name: string | null; phone: string | null; email: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  // 3e — this barber has flagged you, so the whole price is due up front
  const [upFront, setUpFront] = useState(false);
  const [walletCents, setWalletCents] = useState<number | null>(null);
  // 8a — wallet deposit. `on` is the toggle; `cents` is what the slider settled on.
  const [depositOn, setDepositOn] = useState(true);
  // resolved by 0076 once the sheet opens; 40 until then
  const [minPct, setMinPct] = useState(40);
  const [depositCents, setDepositCents] = useState(0);
  const [adjustOpen, setAdjustOpen] = useState(false);
  // 37b — the coupon he chose for this booking, priced against the whole sitting
  const [coupon, setCoupon] = useState<UsableCoupon | null>(null);
  // 8c — the receipt, once the row exists
  const [done, setDone] = useState<{ id: string; deposit: number } | null>(null);
  // 39d — kept so a retry after a failed insert doesn't lose what he wrote
  const [noteOpen, setNoteOpen] = useState(false);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [asked, setAsked] = useState<AskRecord | null>(null);   // 36b
  const [failed, setFailed] = useState<'slot' | 'deposit' | null>(null); // 26a / 26b
  const [altCal, setAltCal] = useState<{
    windows: Window[]; booked: Range[]; daysOff: string[]; blocks: Block[]; buffer: number;
  }>({ windows: [], booked: [], daysOff: [], blocks: [], buffer: 0 });

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (visible) {
      // reset the wizard each open
      setStep('service'); setServiceNames([]); setBarber(null); setTime(null);
      setAnyBarber(true);
      setDone(null); setAdjustOpen(false); setDepositOn(true);
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
      supabase.auth.getUser().then(async ({ data }) => {
        const uid = data.user?.id;
        const email = data.user?.email ?? null;
        if (!uid) return;
        const { data: p } = await supabase.from('profiles').select('full_name, phone').eq('id', uid).single();
        setMe({ name: p?.full_name ?? null, phone: p?.phone ?? null, email });
      });
    } else {
      translateY.setValue(SCREEN_H);
    }
  }, [visible]);

  // the barber's terms for *me* — a boolean and nothing else leaves their shop (0030)
  useEffect(() => {
    if (!barber) return setUpFront(false);
    supabase.rpc('barber_terms_for_me', { p_barber: barber.id })
      .then(({ data }) => setUpFront(!!data?.[0]?.require_full_payment));
    supabase.rpc('wallet_balance').then(({ data }) => setWalletCents(data ?? 0));
    // kept loaded so 26a can offer alternatives the instant a booking fails
    const id = barber.id;
    Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', id),
      supabase.from('days_off').select('day').eq('barber_id', id),
      supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', id),
      supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', id).single(),
      supabase.rpc('booked_ranges', {
        p_barber: id,
        p_from: new Date().toISOString(),
        p_to: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      }),
    ]).then(([av, off, blk, buf, bk]) => setAltCal({
      windows: (av.data ?? []) as Window[],
      booked: (bk.data ?? []) as Range[],
      daysOff: (off.data ?? []).map((d) => d.day),
      blocks: (blk.data ?? []) as Block[],
      buffer: buf.data ? buf.data.buffer_before_min + buf.data.buffer_after_min : 0,
    }));
  }, [barber?.id]);

  // a new service resets the deposit to the floor — the mock's default position
  const pickedPrice = (barber?.services ?? [])
    .filter((sv) => sv.is_active && serviceNames.includes(sv.name))
    .reduce((n, sv) => n + sv.price_cents, 0);
  useEffect(() => {
    if (pickedPrice) setDepositCents(upFront ? pickedPrice : floorAt(pickedPrice, minPct));
  }, [pickedPrice, upFront, minPct]);

  // the shop's own floor for THIS customer (0076). Asked once the sheet opens,
  // because the answer decides whether a deposit block is offered at all.
  useEffect(() => {
    const sid = (salon as any).id;
    if (!visible || !sid) return;
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      supabase.rpc('booking_deposit_pct', { p_customer: data.user.id, p_salon: sid })
        .then(({ data: p }) => {
          if (!alive || typeof p !== 'number') return;
          setMinPct(p);
          setDepositOn(p > 0);   // OSH-13: a shop at 0 holds nothing
        });
    });
    return () => { alive = false; };
  }, [visible, (salon as any).id]);

  function close() {
    const booked = !!done;
    Animated.timing(translateY, { toValue: SCREEN_H, duration: 180, useNativeDriver: true })
      .start(() => { onClose(); if (booked) onFinished?.(); });
  }

  // drag the handle down to dismiss
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => g.dy > 6,
    onPanResponderMove: (_, g) => { if (g.dy > 0) translateY.setValue(g.dy); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 120) close();
      else Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    },
  })).current;

  const menu = serviceMenu(salon);
  // a barber has to be able to do the WHOLE sitting — offering two of the three
  // picked services is not a shortlist candidate, it is a different booking.
  const offeringBarbers = serviceNames.length
    ? salon.barbers.filter((b) =>
      serviceNames.every((n) => b.services.some((sv) => sv.is_active && sv.name === n)))
    : [];
  // On "Anyone free" nobody is chosen yet, so the first offering chair stands in
  // for display — the service ids, the duration line, the anchor. The moment a
  // slot is tapped `barber` is set and this becomes that same barber.
  const refBarber = barber ?? (anyBarber ? offeringBarbers[0] ?? null : null);
  const svcs = (refBarber?.services ?? [])
    .filter((sv) => sv.is_active && serviceNames.includes(sv.name))
    .sort((a, b) => serviceNames.indexOf(a.name) - serviceNames.indexOf(b.name));
  // the anchor — 0047 keeps `bookings.service_id` NOT NULL and pointed at the
  // first service, so every existing consumer (queue, calendar, earnings)
  // keeps working without knowing a sitting can hold more than one.
  const svc = svcs[0] ?? null;
  const total = svcs.reduce((n, sv) => n + sv.price_cents, 0);
  const mins = svcs.reduce((n, sv) => n + sv.duration_min, 0);
  const serviceLabel = svcs.length > 1
    ? svcs.map((sv) => sv.name).join(' + ')
    : serviceNames[0] ?? '';

  /** what the whole sitting costs and takes at one chair */
  const sittingAt = (b: Specialist) => b.services
    .filter((sv) => sv.is_active && serviceNames.includes(sv.name))
    .reduce((n, sv) => ({ price: n.price + sv.price_cents, mins: n.mins + sv.duration_min }),
      { price: 0, mins: 0 });
  // BOOK-21's "from 40 DH" — the cheapest chair that can do the whole sitting
  const fromPrice = offeringBarbers.length
    ? Math.min(...offeringBarbers.map((b) => sittingAt(b).price)) : 0;
  // ponytail: on "Anyone free" the grid is computed at the LONGEST chair's
  // duration, so a slot offered always fits whoever ends up taking it. It can
  // hide a slot only a faster barber could have done — trade a missed slot for
  // never offering one that doesn't fit. Per-chair durations if it bites.
  const pickMins = barber ? mins
    : Math.max(0, ...offeringBarbers.map((b) => sittingAt(b).mins));

  // BOOK-21's "Free at 15:30 today" — the one number that makes the rows
  // comparable. Loaded only on the barber step, and only for chairs that can do
  // the whole sitting, so a shop's other calendars are never fetched.
  // ponytail: N chairs × 5 small queries. Same shape SlotPicker already runs;
  // fold both into one RPC if a shop is ever big enough for it to show.
  const offeringKey = offeringBarbers.map((b) => b.id).join(',');
  useEffect(() => {
    if (step !== 'barber' || !offeringBarbers.length) return;
    let alive = true;
    const from = new Date();
    const to = new Date(Date.now() + 7 * 86_400_000);
    Promise.all(offeringBarbers.map(async (b) => {
      const need = sittingAt(b).mins;
      const [av, off, blk, buf, bk] = await Promise.all([
        supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', b.id),
        supabase.from('days_off').select('day').eq('barber_id', b.id),
        supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', b.id),
        supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', b.id).single(),
        supabase.rpc('booked_ranges',
          { p_barber: b.id, p_from: from.toISOString(), p_to: to.toISOString() }),
      ]);
      return [b.id, nextFree(from, 7, need, av.data ?? [], bk.data ?? [],
        (off.data ?? []).map((d) => d.day), blk.data ?? [],
        buf.data ? buf.data.buffer_before_min + buf.data.buffer_after_min : 0)] as const;
    })).then((rows) => { if (alive) setNextFreeBy(Object.fromEntries(rows)); });
    return () => { alive = false; };
  }, [step, offeringKey, serviceNames.join(',')]);

  // 37b — the coupon comes off what HE pays. `price_cents` is the barber's money
  // and never moves; Sterncut absorbs the difference. Every number below the
  // service line is therefore computed from `payable`, not from the price, or a
  // coupon would quietly raise his deposit share.
  const discount = svc && coupon ? (coupon.worth_cents ?? 0) : 0;
  const payable = svc ? total - discount : 0;

  // wallet deposit is offered only when the balance actually covers the floor
  const floor = svc ? floorAt(payable, minPct) : 0;
  // a shop asking for nothing offers no deposit block at all — OSH-13
  const canDeposit = !!svc && minPct > 0 && walletCents != null && walletCents >= floor;
  const deposit = canDeposit && depositOn
    ? Math.min(Math.max(depositCents, floor), payable)
    : 0;

  // 39d — the note travels with the insert, so a booking never exists without
  // the thing the customer wanted said about it. `note` is undefined on the
  // paths that skip the sheet (a retry, the no-deposit request).
  async function confirm(note?: string | null) {
    if (!barber || !svc || !time) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const notes = note ?? lastNote ?? null;

    // Several services in one sitting is 0047's ad-hoc bundle, not a second
    // booking rail: `book_custom` writes one booking, one barber, one slot, with
    // a `booking_services` row each. A single service keeps the plain insert —
    // it would otherwise mint a one-item bundle for every booking in the app.
    const { data: row, error } = svcs.length > 1
      ? await supabase.rpc('book_custom', {
        p_barber: barber.id,
        p_services: svcs.map((sv) => sv.id),
        p_starts_at: time.toISOString(),
        p_deposit_cents: deposit,
        p_note: notes,
        p_coupon: coupon?.id ?? null,
      }).then((r) => ({
        // book_custom returns the id; the deposit is what we asked for
        data: r.data ? { id: r.data as string, deposit_cents: deposit } : null,
        error: r.error,
      }))
      : await supabase.from('bookings').insert({
        customer_id: auth.user!.id, barber_id: barber.id, service_id: svc.id,
        starts_at: time.toISOString(), deposit_cents: deposit,
        coupon_id: coupon?.id ?? null,
        notes,
      }).select('id, deposit_cents').single();
    setBusy(false);
    // 26 — the insert is atomic, so a failure means nothing moved. Two shapes:
    // the slot went while you were deciding, or the wallet could not cover it.
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes('wallet') || m.includes('deposit')) return setFailed('deposit');
      if (m.includes('another booking') || m.includes('outside working')
        || m.includes('unavailable') || m.includes('future')) return setFailed('slot');
      return Alert.alert(tr('Could not book'), error.message);
    }
    setDone({ id: row!.id, deposit: row!.deposit_cents }); // 8c
    onBooked();
  }

  // 26a's "closest openings" — the same free-slot maths the picker already runs
  const alternatives = svc && barber && time
    ? daySlots(time, mins, altCal.windows, altCal.booked, altCal.daysOff,
      altCal.blocks, altCal.buffer)
      .filter((sl) => sl.status === 'free' && sl.time.getTime() > time.getTime())
      .slice(0, 2)
    : [];

  const STEP_TITLE: Record<Step, string> = {
    service: tr('Choose a service'), barber: tr('Who cuts'), time: tr('Pick a time'), summary: tr('Overview'),
  };
  const stepIndex = ['service', 'barber', 'time', 'summary'].indexOf(step);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <Pressable style={s.backdrop} onPress={close} />
      <Animated.View style={[s.sheet, { transform: [{ translateY }] }]}>
        <View {...pan.panHandlers} style={s.handleZone}>
          <View style={s.handle} />
          <View style={s.headRow}>
            {step !== 'service'
              ? <Pressable onPress={() => {
                  const prev = ['service', 'barber', 'time', 'summary'][stepIndex - 1] as Step;
                  // stepping back onto BOOK-21 un-resolves an "Anyone free" pick,
                  // or the radio would show a person the customer never chose
                  if (prev === 'barber' && anyBarber) { setBarber(null); setTime(null); }
                  setStep(prev);
                }}
                  hitSlop={8} style={s.headBtn}><Ionicons name="chevron-back" size={20} color={colors.text} /></Pressable>
              : <View style={s.headBtn} />}
            <Text style={s.headTitle}>{STEP_TITLE[step]}</Text>
            <Pressable onPress={close} hitSlop={8} style={s.headBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <View style={s.progress}>
            {[0, 1, 2, 3].map((i) => <View key={i} style={[s.dot, i <= stepIndex && s.dotActive]} />)}
          </View>
        </View>

        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {/* STEP 1 — the sitting: one service, or several */}
          {step === 'service' && (
            <>
              {/* The Services/Packages chips are gone. "Packages are coming
                  soon" had been false since 0047 shipped bundles on the salon
                  page, and ticking several services here is the ad-hoc bundle
                  that chip was promising — a toggle between one live mode and
                  one lie is not a choice. Priced bundles stay on the salon
                  page's Bundles tab, where a real saving can be shown. */}
              <Text style={s.pickHint}>{tr('Pick one, or several for a single sitting.')}</Text>
              {menu.length === 0 ? (
                <Text style={s.note}>{tr('No services listed yet.')}</Text>
              ) : menu.map((m) => {
                const on = serviceNames.includes(m.name);
                // ticking is the whole interaction now — no row navigates on its
                // own, because the second tap has to be able to add rather than
                // replace. The footer CTA is what moves you on.
                const toggle = () => {
                  setServiceNames((cur) =>
                    cur.includes(m.name) ? cur.filter((n) => n !== m.name) : [...cur, m.name]);
                  setBarber(null); setTime(null);
                };
                return (
                  <Pressable key={m.name} onPress={toggle}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                    accessibilityLabel={m.name}
                    style={({ pressed }) => [s.optRow, on && s.optRowOn, pressed && s.pressed]}>
                    <View style={[s.tick, on && s.tickOn]}>
                      {on && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
                    </View>
                    <View style={s.grow}>
                      <Text style={s.optName}>{m.name}</Text>
                      <Text style={s.optMeta}>{m.category}</Text>
                    </View>
                    <Text style={s.optPrice}>
                      {tr('{x} DH', { x: m.min === m.max ? `${(m.min / 100).toFixed(0)}` : `${(m.min / 100).toFixed(0)}–${(m.max / 100).toFixed(0)}` })}
                    </Text>
                  </Pressable>
                );
              })}
              {/* the honest warning: services exist per barber, so a combination
                  can be one nobody in the shop does in a single sitting */}
              {serviceNames.length > 1 && offeringBarbers.length === 0 && (
                <Text style={s.note}>
                  {tr('Nobody here does all {count} in one sitting. Untick one, or book them separately.', { count: serviceNames.length })}
                </Text>
              )}
            </>
          )}

          {/* STEP 2 — BOOK-21. "Anyone free" sits above the list and is ticked
              by default: it is the option with the most times in it, and making
              the customer choose a person first is what empties a shop's day. */}
          {step === 'barber' && (
            <>
              <Pressable onPress={() => { setAnyBarber(true); setBarber(null); setTime(null); }}
                accessibilityRole="radio" accessibilityState={{ selected: anyBarber && !barber }}
                style={({ pressed }) => [s.anyCard, pressed && s.pressed]}>
                <View style={s.anyIcon}>
                  <Ionicons name="people-outline" size={19} color={colors.onAccent} />
                </View>
                <View style={s.grow}>
                  <Text style={s.anyName}>{tr('Anyone free')}</Text>
                  <Text style={s.anyMeta}>
                    {tr('More times to choose from{x}', { x: fromPrice > 0 ? tr(' · from {fromPrice} DH', { fromPrice: dh(fromPrice) }) : '' })}
                  </Text>
                </View>
                {anyBarber && !barber
                  ? <View style={s.anyTick}><Ionicons name="checkmark" size={12} color={colors.onAccent} /></View>
                  : <View style={s.radio} />}
              </Pressable>

              <Text style={s.pickEyebrow}>{tr('Or pick someone')}</Text>
              {offeringBarbers.map((b) => {
                const a = b.reviews.length ? b.reviews.reduce((n, r) => n + r.rating, 0) / b.reviews.length : null;
                const { price } = sittingAt(b);
                const on = barber?.id === b.id;
                return (
                  <Pressable key={b.id}
                    onPress={() => { setBarber(b); setAnyBarber(false); setTime(null); }}
                    accessibilityRole="radio" accessibilityState={{ selected: on }}
                    style={({ pressed }) => [s.optRow, on && s.optRowOn, pressed && s.pressed]}>
                    <View style={[s.avatar, s.avatarFallback]}>
                      <Text style={s.avatarText}>
                        {(b.profiles?.full_name ?? 'B').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                      </Text>
                    </View>
                    <View style={s.grow}>
                      <Text style={s.optName}>{b.profiles?.full_name ?? tr('Barber')}</Text>
                      <Text style={s.optMeta}>
                        {[a != null ? `${a.toFixed(1)} ★` : tr('New'), b.specialty,
                          price > 0 ? `${dh(price)} DH` : null].filter(Boolean).join(' · ')}
                      </Text>
                      {/* undefined = still loading, null = nothing in 7 days.
                          Neither prints a time we don't have. */}
                      {nextFreeBy[b.id] && <Text style={s.freeAt}>{freeLabel(nextFreeBy[b.id]!)}</Text>}
                      {nextFreeBy[b.id] === null && <Text style={s.freeNone}>{tr('Nothing free this week')}</Text>}
                    </View>
                    {on
                      ? <View style={s.radioOn}><Ionicons name="checkmark" size={12} color={colors.onAccent} /></View>
                      : <View style={s.radio} />}
                  </Pressable>
                );
              })}
            </>
          )}

          {/* STEP 3 — time. 36a takes over when the chosen day is full: that is
              exactly the moment someone wants the day and can't have it. */}
          {step === 'time' && refBarber && svc && (
            <SlotPicker
              barberId={barber ? barber.id : offeringBarbers.map((b) => b.id)}
              durationMin={pickMins}
              selected={time}
              // the grid answers *who* was free at that time, so choosing a slot
              // is what turns "anyone" into a person — no guess, no second pass
              onSelect={(t, bid) => {
                setTime(t);
                if (!barber) setBarber(offeringBarbers.find((b) => b.id === bid) ?? null);
              }}
              renderFull={(day) => (
                <AskBlock
                  salonId={(salon as any).id ?? null}
                  barberId={refBarber.id}
                  barberName={refBarber.profiles?.full_name ?? tr('your barber')}
                  salonName={salon.name}
                  serviceId={svc.id}
                  serviceName={serviceLabel}
                  priceCents={total}
                  day={day}
                  coBarbers={salon.barbers
                    .filter((b) => b.id !== refBarber.id)
                    .map((b) => (b.profiles?.full_name ?? tr('A barber')).split(' ')[0])}
                  closesMin={(salon as any).close_min ?? null}
                  onAsked={setAsked} />
              )} />
          )}

          {/* STEP 4 — summary */}
          {step === 'summary' && (
            <>
              <SummaryCard label={tr('Salon')}>
                <Text style={s.sumTitle}>{salon.name}</Text>
                <Text style={s.optMeta}>{salon.address}</Text>
              </SummaryCard>
              <SummaryCard label={tr('Service')} onEdit={() => setStep('service')}>
                <View style={s.sumLine}>
                  <Text style={s.sumText}>{serviceLabel}</Text>
                  <Text style={s.sumText}>{svc ? tr('{x} DH', { x: (total / 100).toFixed(0) }) : ''}</Text>
                </View>
                <Text style={s.optMeta}>{tr('{duration_min} min · paid at the shop', { duration_min: svc?.duration_min })}</Text>
              </SummaryCard>
              <SummaryCard label={tr('Specialist')} onEdit={() => setStep('barber')}>
                <Text style={s.sumText}>{barber?.profiles?.full_name}</Text>
                <Text style={s.optMeta}>{barber?.specialty ?? tr('Barber')}</Text>
              </SummaryCard>
              <SummaryCard label={tr('When')} onEdit={() => setStep('time')}>
                <Text style={s.sumText}>
                  {time?.toDateString()} · {time?.toTimeString().slice(0, 5)}
                </Text>
              </SummaryCard>
              <SummaryCard label={tr('Your details')}>
                <Text style={s.sumText}>{me?.name ?? '—'}</Text>
                <Text style={s.optMeta}>{me?.phone ?? ''}{me?.email ? `  ·  ${me.email}` : ''}</Text>
              </SummaryCard>

              {upFront && svc && (
                <>
                  <View style={s.payCard}>
                    <View style={s.payTop}>
                      <View style={s.payIcon}>
                        <Ionicons name="wallet-outline" size={16} color="#fff" />
                      </View>
                      <View style={s.grow}>
                        <Text style={s.payTitle}>{tr('Pay in full at the shop')}</Text>
                        <Text style={s.paySub}>
                          {walletCents != null
                            ? tr('Wallet {x} DH · not spendable yet', { x: (walletCents / 100).toFixed(0) })
                            : tr('Wallet balance unavailable')}
                        </Text>
                      </View>
                      {/* locked: 100% is the barber's condition, not a choice */}
                      <View style={s.payToggle}><View style={s.payKnob} /></View>
                    </View>
                    <View style={s.paySplit}>
                      <View style={s.paySplitRow}>
                        <View>
                          <Text style={s.payLabel}>{tr('DUE UP FRONT')}</Text>
                          <Text style={s.payBig}>{tr('{x} DH', { x: (total / 100).toFixed(0) })}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.payLabel}>{tr('SPLIT LATER')}</Text>
                          <Text style={s.paySmall}>{tr('0 DH')}</Text>
                        </View>
                      </View>
                      <View style={s.payTrack}>
                        <View style={s.payFill} />
                        <View style={s.payHandle} />
                      </View>
                      <View style={s.payFoot}>
                        <View style={s.payLockRow}>
                          <Ionicons name="lock-closed" size={10} color="rgba(255,255,255,0.45)" />
                          <Text style={s.payLock}>{tr('LOCKED AT 100%')}</Text>
                        </View>
                        <Text style={s.payOf}>
                          {tr('{x} DH of {x} DH', { x: (total / 100).toFixed(0) })}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={s.warnCard}>
                    <View style={s.warnIcon}>
                      <Ionicons name="information-circle-outline" size={14} color={colors.accent} />
                    </View>
                    <View style={s.grow}>
                      <Text style={s.warnTitle}>{tr('This barber asks you to pay up front')}</Text>
                      <Text style={s.warnBody}>
                        {tr('Missed visits are why. Turn up to your next three and part-payment comes back.')}
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {/* 37b — the coupon, above the money block it changes. Picking one
                  is a tap, removing it is a tap, and the line item is spelled out
                  in the total below so the discount is never a mystery. */}
              {!upFront && svc && (
                <CouponRow salonId={salon.id} priceCents={total}
                  coupon={coupon} onPick={setCoupon} />
              )}

              {/* 38d — a short wallet is not a wall. The deposit is the barber's
                  condition and one of his own options is to be asked without one,
                  so this offers the booking rather than an apology. */}
              {!upFront && svc && !canDeposit && walletCents != null && floor > 0 && (
                <LowWalletBlock balanceCents={walletCents} floorCents={floor}
                  onRequest={() => { setDepositOn(false); confirm(); }} />
              )}

              {/* 8a — the wallet deposit block. Only when the balance clears the floor;
                  a short wallet just books the ordinary pay-at-the-shop way. */}
              {!upFront && svc && canDeposit && (
                <>
                  <Text style={s.payEyebrow}>{tr('PAYMENT')}</Text>
                  <View style={s.depCard}>
                    <View style={s.payTop}>
                      <View style={s.payIcon}>
                        <Ionicons name="card-outline" size={16} color="#fff" />
                      </View>
                      <View style={s.grow}>
                        <Text style={s.payTitle}>{tr('Pay part now from wallet')}</Text>
                        <Text style={s.paySub}>
                          {tr('Balance {dh} DH · enough to cover it', { dh: dh(walletCents!) })}
                        </Text>
                      </View>
                      <Pressable onPress={() => setDepositOn((v) => !v)} hitSlop={6}
                        accessibilityRole="switch" accessibilityState={{ checked: depositOn }}
                        style={[s.depToggle, depositOn && s.depToggleOn]}>
                        <View style={s.payKnob} />
                      </Pressable>
                    </View>

                    {depositOn && (
                      <Pressable onPress={() => setAdjustOpen(true)} style={s.depSplit}
                        accessibilityLabel={tr('Adjust the deposit')}>
                        {/* 37b's breakdown. The coupon is a line, not a smaller
                            headline number — he should see what came off. */}
                        {discount > 0 && (
                          <View style={s.breakdown}>
                            <View style={s.cpnRow}>
                              <Text style={s.cpnLabel}>{serviceLabel}</Text>
                              <Text style={s.cpnValue}>{tr('{total} DH', { total: dh(total) })}</Text>
                            </View>
                            <View style={s.cpnRow}>
                              <Text style={s.cpnLabel}>{tr('Coupon')}</Text>
                              <Text style={s.cpnOff}>{tr('− {discount} DH', { discount: dh(discount) })}</Text>
                            </View>
                            <View style={s.cpnRule} />
                          </View>
                        )}
                        <View style={s.paySplitRow}>
                          <View>
                            <Text style={s.payLabel}>{tr('DEPOSIT NOW')}</Text>
                            <Text style={s.payBig}>{tr('{deposit} DH', { deposit: dh(deposit) })}</Text>
                          </View>
                          <View style={s.rightAlign}>
                            <Text style={s.payLabel}>{tr('AT THE SHOP')}</Text>
                            <Text style={s.depDue}>{tr('{dh} DH', { dh: dh(payable - deposit) })}</Text>
                          </View>
                        </View>
                        <View style={s.depTrack}>
                          <View style={[s.depFill, { width: `${(deposit / payable) * 100}%` }]} />
                          <View style={[s.depKnob, { left: `${(deposit / payable) * 100}%` }]} />
                        </View>
                        <View style={s.payFoot}>
                          <View style={s.payLockRow}>
                            <Ionicons name="lock-closed" size={10} color="rgba(255,255,255,0.45)" />
                            <Text style={s.payLock}>{tr('MIN {minPct}%', { minPct })}</Text>
                          </View>
                          <Text style={s.payOf}>
                            {tr('{round}% of {payable} DH', { round: Math.round((deposit / payable) * 100), payable: dh(payable) })}
                          </Text>
                          <Text style={s.payLock}>100%</Text>
                        </View>
                        <View style={s.quickRow}>
                          {[minPct, 50, 75, 100].map((p) => {
                            const cents = Math.max(floor, Math.round((payable * p) / 100));
                            const on = cents === deposit;
                            return (
                              <Pressable key={p} onPress={() => setDepositCents(cents)}
                                style={[s.quick, on && s.quickOn]}>
                                <Text style={[s.quickText, on && s.quickTextOn]}>
                                  {p === 100 ? tr('Full') : `${p}%`}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </Pressable>
                    )}
                  </View>

                  {/* the sentence the whole feature turns on. A barber who thinks
                      the app is cutting his price is the fastest way to lose a shop. */}
                  {discount > 0 && (
                    <View style={s.fullPriceCard}>
                      <View style={s.fullPriceTick}>
                        <Ionicons name="checkmark" size={13} color="#16A34A" />
                      </View>
                      <Text style={s.fullPriceText}>
                        {tr('{name} is still paid {total} DH. Sterncut covers the {discount}.', { name: barber?.profiles?.full_name?.split(' ')[0] ?? tr('Your barber'), total: dh(total), discount: dh(discount) })}
                      </Text>
                    </View>
                  )}

                  <View style={s.breakCard}>
                    <BreakRow k={tr('Wallet deposit')} v={tr('{deposit} DH', { deposit: dh(deposit) })} />
                    <BreakRow k={tr('Cash at the shop')} v={tr('{dh} DH', { dh: dh(total - deposit) })} />
                    <View style={s.breakHr} />
                    <BreakRow k={tr('Wallet after booking')} v={tr('{dh} DH', { dh: dh(walletCents! - deposit) })} />
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>

        {/* footer CTA */}
        {step === 'service' && (
          <View style={s.footer}>
            <PillButton
              disabled={serviceNames.length === 0 || offeringBarbers.length === 0}
              onPress={() => setStep('barber')}
              title={serviceNames.length === 0
                ? tr('Pick a service')
                : serviceNames.length === 1
                  ? tr('Continue')
                  : tr('Continue · {count} services', { count: serviceNames.length })} />
          </View>
        )}
        {step === 'barber' && (
          <View style={s.footer}>
            <PillButton
              disabled={!barber && !anyBarber}
              onPress={() => { setTime(null); setStep('time'); }}
              title={barber
                ? tr('Continue with {name}', { name: (barber.profiles?.full_name ?? tr('them')).split(' ')[0] })
                : tr('Continue · anyone free')} />
          </View>
        )}
        {step === 'time' && (
          <View style={s.footer}>
            {/* BOOK-02's CTA carries the time, so the button says what it books */}
            <PillButton title={time ? tr('Review booking · {time}', { time: hhmm(time) }) : tr('Select a time')}
              disabled={!time} onPress={() => setStep('summary')} />
          </View>
        )}
        {step === 'summary' && (
          <View style={s.footer}>
            {/* 39d — one stop between deciding and booking, and it is skippable */}
            <PillButton loading={busy} onPress={() => setNoteOpen(true)}
              title={deposit > 0
                ? tr('Pay {deposit} DH & confirm', { deposit: dh(deposit) })
                : upFront && svc
                  ? tr('Request · {total} DH up front', { total: dh(total) })
                  : tr('Confirm booking')} />
          </View>
        )}

        {/* 8c — the receipt. Replaces the sheet body once the row exists. */}
        {done && svc && (
          <View style={s.doneWrap}>
            <View style={s.doneIcon}>
              <Ionicons name="checkmark" size={30} color={colors.accent} />
            </View>
            <View>
              <Text style={s.doneTitle}>{done.deposit > 0 ? tr('Slot held') : tr('Request sent')}</Text>
              <Text style={s.doneSub}>
                {done.deposit > 0
                  ? tr('Your {deposit} DH deposit is paid from your wallet. Pay the remaining {rest} DH in cash at the shop.', { deposit: dh(done.deposit), rest: dh(total - done.deposit) })
                  : tr('The barber will confirm your booking shortly. Pay at the shop.')}
              </Text>
            </View>
            {done.deposit > 0 && (
              <View style={s.doneSplit}>
                <View>
                  <Text style={s.payLabel}>{tr('PAID FROM WALLET')}</Text>
                  <Text style={s.payBig}>{tr('{deposit} DH', { deposit: dh(done.deposit) })}</Text>
                </View>
                <View style={s.rightAlign}>
                  <Text style={s.payLabel}>{tr('DUE AT THE SHOP')}</Text>
                  <Text style={s.doneDue}>{tr('{dh} DH', { dh: dh(total - done.deposit) })}</Text>
                </View>
              </View>
            )}
            <View style={s.doneCard}>
              <BreakRow k={tr('Booking ID')} v={`#${done.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`} light />
              <BreakRow k={tr('Salon')} v={salon.name} light />
              <BreakRow k={tr('Specialist')} v={barber?.profiles?.full_name ?? '—'} light />
              <BreakRow k={tr('Service')} v={tr('{serviceLabel} · {mins} min', { serviceLabel, mins })} light />
              <BreakRow k={tr('When')} v={`${time?.toDateString()} · ${time?.toTimeString().slice(0, 5)}`} light />
              {done.deposit > 0 && (
                <>
                  <View style={s.breakHr} />
                  <BreakRow k={tr('Deposit ({round}%)', { round: Math.round((done.deposit / total) * 100) })}
                    v={tr('{deposit} DH paid', { deposit: dh(done.deposit) })} />
                  <BreakRow k={tr('Wallet balance')} v={tr('{dh} DH', { dh: dh((walletCents ?? 0) - done.deposit) })} />
                </>
              )}
            </View>
            <Pressable onPress={close} style={({ pressed }) => [s.doneBtn, pressed && s.pressed]}>
              <Text style={s.doneBtnText}>{tr('DONE')}</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>

      {/* 26a — the slot went while you were deciding */}
      {failed === 'slot' && svc && (
        <View style={s.failWrap}>
          <View style={s.failIcon}>
            <Ionicons name="warning-outline" size={30} color={colors.accent} />
          </View>
          <View>
            <Text style={s.failTitle}>{tr('That slot just\nwent')}</Text>
            <Text style={s.failSub}>
              {tr('Someone booked {time} {time2} with {name} a moment before you. Nothing was charged.', { time: time?.toDateString().slice(0, 10), time2: time?.toTimeString().slice(0, 5), name: barber?.profiles?.full_name?.split(' ')[0] })}
            </Text>
          </View>
          <View style={s.failOk}>
            <View style={s.failTick}><Ionicons name="checkmark" size={11} color="#16A34A" /></View>
            <Text style={s.failOkText}>{tr('Your wallet is untouched')}</Text>
            <Text style={s.failOkAmount}>{tr('{dh} DH', { dh: dh(walletCents ?? 0) })}</Text>
          </View>

          {alternatives.length > 0 && (
            <>
              <Text style={s.failEyebrow}>{tr('CLOSEST OPENINGS')}</Text>
              <View style={s.failList}>
                {alternatives.map((sl) => (
                  <View key={sl.time.getTime()} style={s.failRow}>
                    <View style={s.grow}>
                      <Text style={s.failWhen}>
                        {sl.time.toLocaleDateString(loc('en-US'), { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}{sl.time.toTimeString().slice(0, 5)}
                      </Text>
                      <Text style={s.optMeta}>
                        {tr('{name} · {round} min later', { name: barber?.profiles?.full_name?.split(' ')[0], round: Math.round((sl.time.getTime() - (time?.getTime() ?? 0)) / 60000) })}
                      </Text>
                    </View>
                    <Pressable onPress={() => { setTime(sl.time); setFailed(null); }}
                      style={({ pressed }) => [s.failBook, pressed && s.pressed]}>
                      <Text style={s.failBookText}>{tr('BOOK')}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </>
          )}
          <Text style={s.failLink}
            onPress={() => { setFailed(null); setStep('time'); }}>{tr('Pick another time')}</Text>
        </View>
      )}

      {/* 26b — the wallet could not cover the deposit */}
      {failed === 'deposit' && svc && (
        <>
          <Pressable style={s.adjustScrim} onPress={() => setFailed(null)} />
          <View style={s.adjustSheet}>
            <View style={s.handle} />
            <View style={s.failHead}>
              <View style={s.failIconSm}>
                <Ionicons name="close-circle-outline" size={26} color={colors.accent} />
              </View>
              <Text style={s.failTitleSm}>{tr('Booking not confirmed')}</Text>
              <Text style={s.failSubSm}>
                {tr('We couldn\'t take the deposit, so the slot wasn\'t held. Nothing left your wallet.')}
              </Text>
            </View>
            <View style={s.breakCard}>
              <BreakRow k={tr('Service')} v={tr('{serviceLabel} · {total} DH', { serviceLabel, total: dh(total) })} light />
              <BreakRow k={tr('Slot')} v={`${time?.toDateString().slice(0, 10)} · ${time?.toTimeString().slice(0, 5)}`} light />
              <BreakRow k={tr('Deposit attempted')} v={tr('{deposit} DH', { deposit: dh(deposit) })} light />
              <View style={s.breakHr} />
              <BreakRow k={tr('Wallet balance')} v={tr('{dh} DH · unchanged', { dh: dh(walletCents ?? 0) })} />
            </View>
            <View style={s.adjustNote}>
              <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
              <Text style={s.adjustNoteText}>
                {tr('The slot is still free — try again now, or book with cash only and pay it all at the shop.')}
              </Text>
            </View>
            <Pressable onPress={() => { setFailed(null); confirm(); }}
              style={({ pressed }) => [s.doneBtn, pressed && s.pressed]}>
              <Text style={s.doneBtnText}>{tr('TRY AGAIN · {deposit} DH', { deposit: dh(deposit) })}</Text>
            </Pressable>
            <Pressable onPress={() => { setFailed(null); setDepositOn(false); }}
              style={({ pressed }) => [s.keepBtn, pressed && s.pressed]}>
              <Text style={s.keepText}>{tr('BOOK WITHOUT DEPOSIT')}</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* 8b — adjust the deposit */}
      {svc && (
        <AdjustSheet visible={adjustOpen} price={total} floor={floor} value={deposit}
          minPct={minPct}
          onClose={() => setAdjustOpen(false)}
          onPick={(c) => { setDepositCents(c); setAdjustOpen(false); }} />
      )}

      {/* 36b — what the ask actually recorded, said back plainly */}
      <AskedSheet rec={asked} onDone={() => { setAsked(null); onClose(); }}
        onBookOther={() => setAsked(null)} />

      {/* 39d — "anything he should know?", the last step before the insert */}
      {barber && svc && time && (
        <BookingNoteSheet visible={noteOpen} onClose={() => setNoteOpen(false)}
          who={barber.profiles?.full_name ?? tr('Your barber')}
          when={time.toLocaleString(loc('en-US'), {
            weekday: 'short', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false,
          })}
          service={tr('{service} · {mins} min', { service: svc.name, mins })}
          onSend={(note) => { setLastNote(note); confirm(note); }} />
      )}
    </Modal>
  );
}

function BreakRow({ k, v, light }: { k: string; v: string; light?: boolean }) {
  return (
    <View style={s.breakRow}>
      <Text style={s.breakKey}>{k}</Text>
      <Text style={[s.breakVal, light && s.breakValLight]}>{v}</Text>
    </View>
  );
}

// 8b · the 40% floor drawn as a locked stretch of track you cannot drag into.
function AdjustSheet({ visible, price, floor, value, minPct, onClose, onPick }: {
  visible: boolean; price: number; floor: number; value: number;
  /** the shop's resolved floor (0076) — BOOK-06's track is locked below it */
  minPct: number;
  onClose: () => void; onPick: (cents: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const width = useRef(1);
  const bounds = useRef({ price, floor });
  bounds.current = { price, floor };

  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);

  // ponytail: PanResponder over a plain View — a slider dependency for one
  // control isn't worth it. Round to 1 DH so the readout never shows centimes.
  const set = (x: number) => {
    const { price: p, floor: f } = bounds.current;
    const raw = (Math.min(Math.max(x, 0), width.current) / width.current) * p;
    setDraft(Math.min(p, Math.max(f, Math.round(raw / 100) * 100)));
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
    onPanResponderMove: (e) => set(e.nativeEvent.locationX),
  })).current;

  const pct = Math.round((draft / price) * 100);
  const floorPct = (floor / price) * 100;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.adjustScrim} onPress={onClose} />
      <View style={s.adjustSheet}>
        <View style={s.handle} />
        <View style={s.headRow}>
          <View style={s.headBtn} />
          <Text style={s.headTitle}>{tr('Deposit amount')}</Text>
          <Pressable onPress={onClose} hitSlop={8} style={s.headBtn}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.adjustHead}>
          <Text style={s.adjustBig}>{dh(draft)}<Text style={s.adjustUnit}>{' '}{tr('DH')}</Text></Text>
          <Text style={s.adjustSub}>
            {tr('{pct}% of {price} DH · {dh} DH cash at the shop', { pct, price: dh(price), dh: dh(price - draft) })}
          </Text>
        </View>

        <View style={s.adjustTrackZone} {...pan.panHandlers}
          onLayout={(e) => { width.current = e.nativeEvent.layout.width || 1; }}>
          <View style={s.adjustTrack}>
            <View style={[s.adjustLocked, { width: `${floorPct}%` }]} />
            <View style={[s.adjustFill,
              { left: `${floorPct}%`, width: `${Math.max(0, pct - floorPct)}%` }]} />
            <View style={[s.adjustTick, { left: `${floorPct}%` }]} />
            <View style={[s.adjustKnob, { left: `${pct}%` }]} />
          </View>
        </View>
        <View style={s.adjustFoot}>
          <View style={s.payLockRow}>
            <Ionicons name="lock-closed" size={11} color={colors.textTertiary} />
            <Text style={s.adjustFootText}>{tr('{minPct}% minimum', { minPct })}</Text>
          </View>
          <Text style={s.adjustFootText}>{tr('100% · {price} DH', { price: dh(price) })}</Text>
        </View>

        <View style={s.adjustChips}>
          {[minPct, 50, 75, 100].map((p) => {
            const cents = Math.max(floor, Math.round((price * p) / 100));
            const on = cents === draft;
            return (
              <Pressable key={p} onPress={() => setDraft(cents)}
                style={[s.adjustChip, on && s.adjustChipOn]}>
                <Text style={[s.adjustChipText, on && s.adjustChipTextOn]}>
                  {p === 100 ? tr('Full') : `${p}%`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.adjustNote}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={s.adjustNoteText}>
            {tr('A deposit of at least {minPct}% holds your slot. Refunded to your wallet if the barber cancels.', { minPct })}
          </Text>
        </View>

        <Pressable onPress={() => onPick(draft)}
          style={({ pressed }) => [s.doneBtn, pressed && s.pressed]}>
          <Text style={s.doneBtnText}>{tr('USE {draft} DH DEPOSIT', { draft: dh(draft) })}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function SummaryCard({ label, onEdit, children }: { label: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <View style={s.sumCard}>
      <View style={s.sumHead}>
        <Text style={s.sumLabel}>{label}</Text>
        {onEdit && <Pressable onPress={onEdit} hitSlop={6}><Text style={s.sumEdit}>{tr('Edit')}</Text></Pressable>}
      </View>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 37b — the coupon row at checkout
// ---------------------------------------------------------------------------
export type UsableCoupon = {
  id: string; code: string; title: string; blocked: string | null;
  worth_cents: number | null; min_spend_cents: number | null;
};

function CouponRow({ salonId, priceCents, coupon, onPick }: {
  salonId: string; priceCents: number;
  coupon: UsableCoupon | null; onPick: (c: UsableCoupon | null) => void;
}) {
  const [all, setAll] = useState<UsableCoupon[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // priced against THIS service at THIS shop, so "worth" and "blocked" are
    // answers about the booking in front of him, not about the coupon in general
    supabase.rpc('my_coupons', { p_salon: salonId, p_price_cents: priceCents })
      .then(({ data }) => setAll((data as UsableCoupon[]) ?? []));
  }, [salonId, priceCents]);

  const usable = (all ?? []).filter((c) => !c.blocked && (c.worth_cents ?? 0) > 0);
  if (all === null || (usable.length === 0 && !coupon)) return null;

  if (coupon) {
    return (
      <View style={s.couponOn}>
        <View style={s.couponIcon}>
          <Ionicons name="pricetag-outline" size={16} color={colors.accent} />
        </View>
        <View style={s.grow}>
          <Text style={s.couponTitle}>{tr('{code} applied', { code: coupon.code })}</Text>
          <Text style={s.couponSub}>
            {tr('{dh} DH off{x}', { dh: dh(coupon.worth_cents ?? 0), x: coupon.min_spend_cents ? tr(' · min spend met') : '' })}
          </Text>
        </View>
        <Pressable onPress={() => onPick(null)} hitSlop={8}>
          <Text style={s.couponRemove}>{tr('Remove')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Pressable onPress={() => setOpen((v) => !v)} style={s.couponOff}>
        <View style={s.couponIconIdle}>
          <Ionicons name="pricetag-outline" size={16} color={colors.textSecondary} />
        </View>
        <View style={s.grow}>
          <Text style={s.couponTitle}>
            {trn(usable.length, '{n} coupon you can use here', '{n} coupons you can use here')}
          </Text>
          <Text style={s.couponSub}>{tr('Comes off what you pay, not off the barber')}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16}
          color={colors.textTertiary} />
      </Pressable>
      {open && usable.map((c) => (
        <Pressable key={c.id} onPress={() => { onPick(c); setOpen(false); }} style={s.couponPick}>
          <Text style={s.couponCode}>{c.code}</Text>
          <View style={s.grow} />
          <Text style={s.couponWorth}>{tr('− {dh} DH', { dh: dh(c.worth_cents ?? 0) })}</Text>
        </Pressable>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: SCREEN_H * 0.88,
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
  },
  handleZone: { paddingTop: sp(2.5), paddingHorizontal: sp(5) },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA', marginBottom: sp(2) },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headTitle: {
    flex: 1, textAlign: 'center', fontFamily: serif, fontSize: font.h2,
    letterSpacing: 0.5, textTransform: 'uppercase', color: colors.text,
  },
  progress: { flexDirection: 'row', gap: sp(1.5), justifyContent: 'center', paddingVertical: sp(3) },
  dot: { width: 28, height: 4, borderRadius: 2, backgroundColor: '#DDD9CF' },
  dotActive: { backgroundColor: colors.accent },

  body: { padding: sp(5), gap: sp(2.5), paddingBottom: sp(10) },
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },
  pickHint: { fontSize: font.small, color: colors.textSecondary, marginBottom: sp(1) },

  // BOOK-21 — the default sits on the dark surface, the alternatives on white
  anyCard: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: colors.ink, borderRadius: radius.lg, padding: sp(4),
  },
  anyIcon: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  anyName: { fontSize: 14.5, fontWeight: '700', color: colors.onAccent },
  anyMeta: { fontSize: 11.5, color: '#9A9A95', marginTop: 3 },
  anyTick: {
    width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, borderColor: '#D8D4CA' },
  radioOn: {
    width: 22, height: 22, borderRadius: radius.pill, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  freeAt: { fontSize: 10.5, fontWeight: '700', color: colors.success, marginTop: 2 },
  freeNone: { fontSize: 10.5, fontWeight: '700', color: colors.textTertiary, marginTop: 2 },
  pickEyebrow: {
    fontSize: font.tiny, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 1.65, textTransform: 'uppercase', marginTop: sp(2),
  },
  note: { textAlign: 'center', color: colors.textTertiary, marginVertical: sp(6), fontSize: font.body },

  optRowOn: { borderColor: colors.accent, borderWidth: 1.5 },
  tick: {
    width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  optRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    borderRadius: radius.lg, padding: sp(4), backgroundColor: colors.bg, ...shadow,
  },
  optName: { fontSize: font.body, fontWeight: '700', color: colors.text },
  optMeta: { fontSize: font.small, color: colors.textSecondary },
  optPrice: { fontSize: font.body, fontWeight: '700', color: colors.text },
  barberRight: { alignItems: 'flex-end', gap: 2 },
  avatar: { width: 46, height: 46, borderRadius: radius.pill },
  avatarFallback: { backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: font.body, fontWeight: '700', color: colors.accent },

  sumCard: {
    borderRadius: radius.lg, padding: sp(4), gap: 2, backgroundColor: colors.bg, ...shadow,
  },
  sumHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: sp(1) },
  sumLabel: {
    fontSize: 10, fontWeight: '700', color: colors.textSecondary,
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  sumEdit: { fontSize: font.small, fontWeight: '600', color: colors.accent },
  sumTitle: { fontSize: font.body, fontWeight: '700', color: colors.text },
  sumLine: { flexDirection: 'row', justifyContent: 'space-between' },
  sumText: { fontSize: font.body, fontWeight: '600', color: colors.text },

  footer: { padding: sp(5), paddingBottom: sp(8) },

  // 3e — the up-front panel. Ink card so the money reads as its own object.
  payCard: { backgroundColor: colors.ink, borderRadius: 22, padding: 18, gap: 13 },
  payTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  payIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  payTitle: { fontSize: 13, fontWeight: '700', color: '#fff' },
  paySub: { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  payToggle: {
    width: 42, height: 26, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row', justifyContent: 'flex-end', padding: 3, opacity: 0.55,
  },
  payKnob: { width: 20, height: 20, borderRadius: 999, backgroundColor: '#fff' },
  paySplit: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 13, gap: 10,
  },
  paySplitRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  payLabel: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  payBig: { fontFamily: serif, fontSize: 30, color: '#fff', marginTop: 4 },
  paySmall: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.4)', marginTop: 6 },
  payTrack: {
    height: 24, justifyContent: 'center', opacity: 0.5,
  },
  payFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  payHandle: {
    position: 'absolute', right: 0, width: 24, height: 24, borderRadius: 999,
    backgroundColor: '#fff', borderWidth: 3, borderColor: colors.ink,
  },
  payFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payLockRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  payLock: { fontSize: 10, letterSpacing: 0.6, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  payOf: { fontSize: 11, fontWeight: '700', color: '#fff' },

  warnCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: colors.bg, borderRadius: 18, padding: 14, paddingHorizontal: 16, ...shadow,
  },
  warnIcon: {
    width: 28, height: 28, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  warnTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  warnBody: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginTop: 4 },

  // 8a — wallet deposit
  rightAlign: { alignItems: 'flex-end' },
  payEyebrow: {
    fontSize: 11, letterSpacing: 1.65, fontWeight: '700', color: colors.textSecondary, marginTop: 2,
  },
  depCard: { backgroundColor: colors.ink, borderRadius: 22, padding: 18, gap: 14 },
  depToggle: {
    width: 42, height: 26, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)',
    flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center', padding: 3,
  },
  depToggleOn: { backgroundColor: colors.accent, justifyContent: 'flex-end' },
  // 37b
  couponOn: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.bg,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 2, borderColor: colors.ink, ...shadow,
  },
  couponOff: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.bg,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14, ...shadow,
  },
  couponIcon: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(232,68,46,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  couponIconIdle: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  couponTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  couponSub: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  couponRemove: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  couponPick: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13, ...shadow,
  },
  couponCode: { fontSize: 13, fontWeight: '700', color: colors.text, letterSpacing: 0.6 },
  couponWorth: { fontSize: 13, fontWeight: '700', color: colors.accent },
  breakdown: { gap: 10, marginBottom: 12 },
  cpnRow: { flexDirection: 'row', alignItems: 'center' },
  cpnLabel: { flex: 1, fontSize: 12.5, color: 'rgba(255,255,255,0.6)' },
  cpnValue: { fontSize: 12.5, fontWeight: '600', color: '#fff' },
  cpnOff: { fontSize: 12.5, fontWeight: '700', color: '#4ADE80' },
  cpnRule: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  fullPriceCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.bg,
    borderRadius: 18, paddingHorizontal: 15, paddingVertical: 13, ...shadow,
  },
  fullPriceTick: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(74,222,128,0.18)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  fullPriceText: { flex: 1, fontSize: 11.5, lineHeight: 18, color: '#5c5c58' },

  depSplit: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 14, gap: 10,
  },
  depDue: { fontSize: 18, fontWeight: '700', color: '#fff', marginTop: 6, fontVariant: ['tabular-nums'] },
  depTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)' },
  depFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3, backgroundColor: colors.accent },
  depKnob: {
    position: 'absolute', top: -6, width: 18, height: 18, borderRadius: 999,
    backgroundColor: '#fff', marginLeft: -9,
  },
  quickRow: { flexDirection: 'row', gap: 7 },
  quick: {
    flex: 1, height: 34, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  quickOn: { backgroundColor: '#fff', borderColor: '#fff' },
  quickText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  quickTextOn: { fontWeight: '700', color: colors.text },

  breakCard: {
    backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 15, paddingHorizontal: 16,
    gap: 8, ...shadow,
  },
  breakRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  breakKey: { fontSize: font.small, color: colors.textSecondary },
  breakVal: { fontSize: font.small, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  breakValLight: { fontWeight: '600' },
  breakHr: { height: 1, backgroundColor: colors.border },

  // 8b — adjust sheet
  adjustScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  adjustSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 34, gap: 16,
  },
  adjustHead: { alignItems: 'center', paddingVertical: 2 },
  adjustBig: { fontFamily: serif, fontSize: 52, lineHeight: 55, fontVariant: ['tabular-nums'], color: colors.text },
  adjustUnit: { fontSize: 22, letterSpacing: 0.88 },
  adjustSub: { fontSize: font.small, color: colors.textSecondary, marginTop: 6 },
  adjustTrackZone: { paddingVertical: 10, marginTop: -4 },
  adjustTrack: { height: 8, borderRadius: 4, backgroundColor: '#E3E0D8' },
  adjustLocked: {
    position: 'absolute', left: 0, top: 0, bottom: 0,
    borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: '#D8D4CA',
  },
  adjustFill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.accent },
  adjustTick: { position: 'absolute', top: -4, bottom: -4, width: 2, backgroundColor: '#B9B6AD' },
  adjustKnob: {
    position: 'absolute', top: -8, width: 24, height: 24, borderRadius: 999,
    backgroundColor: colors.ink, marginLeft: -12, borderWidth: 3, borderColor: '#fff',
  },
  adjustFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6 },
  adjustFootText: { fontSize: 11, fontWeight: '700', color: colors.textTertiary },
  adjustChips: { flexDirection: 'row', gap: 8 },
  adjustChip: {
    flex: 1, height: 44, borderRadius: 14, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  adjustChipOn: { backgroundColor: colors.ink },
  adjustChipText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  adjustChipTextOn: { fontWeight: '700', color: '#fff' },
  adjustNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15, ...shadow,
  },
  adjustNoteText: { flex: 1, fontSize: 12, lineHeight: 18, color: '#5C5C58' },

  // 8c — booked
  doneWrap: {
    ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface, borderTopLeftRadius: 28,
    borderTopRightRadius: 28, paddingTop: 60, paddingHorizontal: 26, gap: 18, alignItems: 'center',
  },
  doneIcon: {
    width: 68, height: 68, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  doneTitle: {
    fontFamily: serif, fontSize: 28, letterSpacing: 0.56, textTransform: 'uppercase',
    color: colors.text, textAlign: 'center',
  },
  doneSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20,
    maxWidth: 290, textAlign: 'center',
  },
  doneSplit: {
    width: '100%', backgroundColor: colors.ink, borderRadius: 24, padding: 20,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  doneDue: { fontSize: 20, fontWeight: '800', color: '#fff', marginTop: 8, fontVariant: ['tabular-nums'] },
  doneCard: {
    width: '100%', backgroundColor: colors.bg, borderRadius: 24, padding: 20, gap: 11, ...shadow,
  },
  doneBtn: {
    width: '100%', height: 54, borderRadius: 999, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center',
  },
  doneBtnText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1.3, color: '#fff' },

  // 26a / 26b
  failWrap: {
    ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface, borderTopLeftRadius: 28,
    borderTopRightRadius: 28, paddingTop: 74, paddingHorizontal: 24, gap: 16, alignItems: 'center',
  },
  failIcon: {
    width: 68, height: 68, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  failIconSm: {
    width: 60, height: 60, borderRadius: 999, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  failTitle: {
    fontFamily: serif, fontSize: 27, lineHeight: 30, letterSpacing: 0.54, color: colors.text,
    textTransform: 'uppercase', textAlign: 'center',
  },
  failSub: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 9, lineHeight: 20,
    maxWidth: 290, textAlign: 'center',
  },
  failOk: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 11,
    backgroundColor: colors.bg, borderRadius: 20, paddingVertical: 15, paddingHorizontal: 16,
    ...shadow,
  },
  failTick: {
    width: 20, height: 20, borderRadius: 999, backgroundColor: 'rgba(74,222,128,0.20)',
    alignItems: 'center', justifyContent: 'center',
  },
  failOkText: { flex: 1, fontSize: 12, color: '#5C5C58' },
  failOkAmount: {
    fontSize: font.small, fontWeight: '800', color: '#16A34A', fontVariant: ['tabular-nums'],
  },
  failEyebrow: {
    alignSelf: 'flex-start', fontSize: 11, letterSpacing: 1.65, fontWeight: '700',
    color: colors.textSecondary, marginTop: 2,
  },
  failList: { width: '100%', gap: 9 },
  failRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, ...shadow,
  },
  failWhen: { fontSize: 14, fontWeight: '700', color: colors.text },
  failBook: {
    height: 34, borderRadius: 999, backgroundColor: colors.ink,
    justifyContent: 'center', paddingHorizontal: 16,
  },
  failBookText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.66, color: '#fff' },
  failLink: { fontSize: font.small, fontWeight: '600', color: colors.accent, marginTop: 2 },
  failHead: { alignItems: 'center', paddingTop: 4 },
  failTitleSm: {
    fontFamily: serif, fontSize: 23, letterSpacing: 0.46, color: colors.text,
    textTransform: 'uppercase', marginTop: 14, textAlign: 'center',
  },
  failSubSm: {
    fontSize: font.small, color: colors.textSecondary, marginTop: 8, lineHeight: 20,
    textAlign: 'center',
  },
  keepBtn: {
    height: 52, borderRadius: radius.pill, backgroundColor: colors.bg,
    borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  keepText: { fontSize: font.small, fontWeight: '700', letterSpacing: 0.78, color: colors.text },
});
