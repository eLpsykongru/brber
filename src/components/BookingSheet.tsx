import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { Block, daySlots, Range, Window } from '../lib/slots';
import { supabase } from '../lib/supabase';
import { colors, font, radius, serif, shadow, sp } from '../theme';
import type { Specialist } from '../types';
import { Chip, PillButton, Stars } from './ui';
import SlotPicker from './SlotPicker';

type SalonLike = { id: string; name: string; address: string | null; barbers: Specialist[] };
type Step = 'service' | 'barber' | 'time' | 'summary';
const SCREEN_H = Dimensions.get('window').height;

// 8a/8b — the deposit floor, mirrored from 0035's fill_booking. Both sides
// enforce it; this copy only exists so the UI can grey out what the server
// would reject anyway.
const MIN_PCT = 40;
const floorOf = (priceCents: number) => Math.ceil((priceCents * MIN_PCT) / 100);
const dh = (cents: number) => (cents / 100).toFixed(0);

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

export default function BookingSheet({ visible, salon, onClose, onBooked }: {
  visible: boolean; salon: SalonLike; onClose: () => void; onBooked: () => void;
}) {
  const [step, setStep] = useState<Step>('service');
  const [mode, setMode] = useState<'service' | 'package'>('service');
  const [serviceName, setServiceName] = useState<string | null>(null);
  const [barber, setBarber] = useState<Specialist | null>(null);
  const [time, setTime] = useState<Date | null>(null);
  const [me, setMe] = useState<{ name: string | null; phone: string | null; email: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  // 3e — this barber has flagged you, so the whole price is due up front
  const [upFront, setUpFront] = useState(false);
  const [walletCents, setWalletCents] = useState<number | null>(null);
  // 8a — wallet deposit. `on` is the toggle; `cents` is what the slider settled on.
  const [depositOn, setDepositOn] = useState(true);
  const [depositCents, setDepositCents] = useState(0);
  const [adjustOpen, setAdjustOpen] = useState(false);
  // 8c — the receipt, once the row exists
  const [done, setDone] = useState<{ id: string; deposit: number } | null>(null);
  const [failed, setFailed] = useState<'slot' | 'deposit' | null>(null); // 26a / 26b
  const [altCal, setAltCal] = useState<{
    windows: Window[]; booked: Range[]; daysOff: string[]; blocks: Block[]; buffer: number;
  }>({ windows: [], booked: [], daysOff: [], blocks: [], buffer: 0 });

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;

  useEffect(() => {
    if (visible) {
      // reset the wizard each open
      setStep('service'); setMode('service'); setServiceName(null); setBarber(null); setTime(null);
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
      supabase.from('time_blocks').select('day, start_min, end_min').eq('barber_id', id),
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
  const pickedPrice = barber?.services
    .find((sv) => sv.is_active && sv.name === serviceName)?.price_cents ?? 0;
  useEffect(() => {
    if (pickedPrice) setDepositCents(upFront ? pickedPrice : floorOf(pickedPrice));
  }, [pickedPrice, upFront]);

  function close() {
    Animated.timing(translateY, { toValue: SCREEN_H, duration: 180, useNativeDriver: true }).start(onClose);
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
  const offeringBarbers = serviceName
    ? salon.barbers.filter((b) => b.services.some((sv) => sv.is_active && sv.name === serviceName))
    : [];
  const svc = barber?.services.find((sv) => sv.is_active && sv.name === serviceName) ?? null;

  // wallet deposit is offered only when the balance actually covers the floor
  const floor = svc ? floorOf(svc.price_cents) : 0;
  const canDeposit = !!svc && walletCents != null && walletCents >= floor;
  const deposit = canDeposit && depositOn
    ? Math.min(Math.max(depositCents, floor), svc!.price_cents)
    : 0;

  async function confirm() {
    if (!barber || !svc || !time) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getUser();
    const { data: row, error } = await supabase.from('bookings').insert({
      customer_id: auth.user!.id, barber_id: barber.id, service_id: svc.id,
      starts_at: time.toISOString(), deposit_cents: deposit,
    }).select('id, deposit_cents').single();
    setBusy(false);
    // 26 — the insert is atomic, so a failure means nothing moved. Two shapes:
    // the slot went while you were deciding, or the wallet could not cover it.
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes('wallet') || m.includes('deposit')) return setFailed('deposit');
      if (m.includes('another booking') || m.includes('outside working')
        || m.includes('unavailable') || m.includes('future')) return setFailed('slot');
      return Alert.alert('Could not book', error.message);
    }
    setDone({ id: row.id, deposit: row.deposit_cents }); // 8c
    onBooked();
  }

  // 26a's "closest openings" — the same free-slot maths the picker already runs
  const alternatives = svc && barber && time
    ? daySlots(time, svc.duration_min, altCal.windows, altCal.booked, altCal.daysOff,
      altCal.blocks, altCal.buffer)
      .filter((sl) => sl.status === 'free' && sl.time.getTime() > time.getTime())
      .slice(0, 2)
    : [];

  const STEP_TITLE: Record<Step, string> = {
    service: 'Choose a service', barber: 'Choose a specialist', time: 'Pick a time', summary: 'Appointment overview',
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
              ? <Pressable onPress={() => setStep(['service', 'barber', 'time', 'summary'][stepIndex - 1] as Step)}
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
          {/* STEP 1 — service or package */}
          {step === 'service' && (
            <>
              <View style={s.modeRow}>
                <Chip label="Services" active={mode === 'service'} onPress={() => setMode('service')} />
                <Chip label="Packages" active={mode === 'package'} onPress={() => setMode('package')} />
              </View>
              {mode === 'package' ? (
                // TODO(backlog): packages need their own table + booking mapping
                <Text style={s.note}>Packages are coming soon.</Text>
              ) : menu.length === 0 ? (
                <Text style={s.note}>No services listed yet.</Text>
              ) : menu.map((m) => (
                <Pressable key={m.name} onPress={() => { setServiceName(m.name); setBarber(null); setTime(null); setStep('barber'); }}
                  style={({ pressed }) => [s.optRow, pressed && s.pressed]}>
                  <View style={s.grow}>
                    <Text style={s.optName}>{m.name}</Text>
                    <Text style={s.optMeta}>{m.category}</Text>
                  </View>
                  <Text style={s.optPrice}>
                    {m.min === m.max ? `${(m.min / 100).toFixed(0)}` : `${(m.min / 100).toFixed(0)}–${(m.max / 100).toFixed(0)}`} DH
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                </Pressable>
              ))}
            </>
          )}

          {/* STEP 2 — barber */}
          {step === 'barber' && (
            offeringBarbers.map((b) => {
              const a = b.reviews.length ? b.reviews.reduce((n, r) => n + r.rating, 0) / b.reviews.length : null;
              const price = b.services.find((sv) => sv.name === serviceName)?.price_cents;
              return (
                <Pressable key={b.id} onPress={() => { setBarber(b); setTime(null); setStep('time'); }}
                  style={({ pressed }) => [s.optRow, pressed && s.pressed]}>
                  <View style={[s.avatar, s.avatarFallback]}>
                    <Text style={s.avatarText}>
                      {(b.profiles?.full_name ?? 'B').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={s.grow}>
                    <Text style={s.optName}>{b.profiles?.full_name ?? 'Barber'}</Text>
                    <Text style={s.optMeta}>{b.specialty ?? 'Barber'}</Text>
                  </View>
                  <View style={s.barberRight}>
                    {a != null ? <Stars rating={a} /> : <Text style={s.optMeta}>New</Text>}
                    {price != null && <Text style={s.optPrice}>{(price / 100).toFixed(0)} DH</Text>}
                  </View>
                </Pressable>
              );
            })
          )}

          {/* STEP 3 — time */}
          {step === 'time' && barber && svc && (
            <SlotPicker barberId={barber.id} durationMin={svc.duration_min} selected={time} onSelect={setTime} />
          )}

          {/* STEP 4 — summary */}
          {step === 'summary' && (
            <>
              <SummaryCard label="Salon">
                <Text style={s.sumTitle}>{salon.name}</Text>
                <Text style={s.optMeta}>{salon.address}</Text>
              </SummaryCard>
              <SummaryCard label="Service" onEdit={() => setStep('service')}>
                <View style={s.sumLine}>
                  <Text style={s.sumText}>{serviceName}</Text>
                  <Text style={s.sumText}>{svc ? `${(svc.price_cents / 100).toFixed(0)} DH` : ''}</Text>
                </View>
                <Text style={s.optMeta}>{svc?.duration_min} min · paid at the shop</Text>
              </SummaryCard>
              <SummaryCard label="Specialist" onEdit={() => setStep('barber')}>
                <Text style={s.sumText}>{barber?.profiles?.full_name}</Text>
                <Text style={s.optMeta}>{barber?.specialty ?? 'Barber'}</Text>
              </SummaryCard>
              <SummaryCard label="When" onEdit={() => setStep('time')}>
                <Text style={s.sumText}>
                  {time?.toDateString()} · {time?.toTimeString().slice(0, 5)}
                </Text>
              </SummaryCard>
              <SummaryCard label="Your details">
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
                        <Text style={s.payTitle}>Pay in full at the shop</Text>
                        <Text style={s.paySub}>
                          {walletCents != null
                            ? `Wallet ${(walletCents / 100).toFixed(0)} DH · not spendable yet`
                            : 'Wallet balance unavailable'}
                        </Text>
                      </View>
                      {/* locked: 100% is the barber's condition, not a choice */}
                      <View style={s.payToggle}><View style={s.payKnob} /></View>
                    </View>
                    <View style={s.paySplit}>
                      <View style={s.paySplitRow}>
                        <View>
                          <Text style={s.payLabel}>DUE UP FRONT</Text>
                          <Text style={s.payBig}>{(svc.price_cents / 100).toFixed(0)} DH</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.payLabel}>SPLIT LATER</Text>
                          <Text style={s.paySmall}>0 DH</Text>
                        </View>
                      </View>
                      <View style={s.payTrack}>
                        <View style={s.payFill} />
                        <View style={s.payHandle} />
                      </View>
                      <View style={s.payFoot}>
                        <View style={s.payLockRow}>
                          <Ionicons name="lock-closed" size={10} color="rgba(255,255,255,0.45)" />
                          <Text style={s.payLock}>LOCKED AT 100%</Text>
                        </View>
                        <Text style={s.payOf}>
                          {(svc.price_cents / 100).toFixed(0)} DH of {(svc.price_cents / 100).toFixed(0)} DH
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={s.warnCard}>
                    <View style={s.warnIcon}>
                      <Ionicons name="information-circle-outline" size={14} color={colors.accent} />
                    </View>
                    <View style={s.grow}>
                      <Text style={s.warnTitle}>This barber asks you to pay up front</Text>
                      <Text style={s.warnBody}>
                        Missed visits are why. Turn up to your next three and part-payment comes back.
                      </Text>
                    </View>
                  </View>
                </>
              )}

              {/* 8a — the wallet deposit block. Only when the balance clears the floor;
                  a short wallet just books the ordinary pay-at-the-shop way. */}
              {!upFront && svc && canDeposit && (
                <>
                  <Text style={s.payEyebrow}>PAYMENT</Text>
                  <View style={s.depCard}>
                    <View style={s.payTop}>
                      <View style={s.payIcon}>
                        <Ionicons name="card-outline" size={16} color="#fff" />
                      </View>
                      <View style={s.grow}>
                        <Text style={s.payTitle}>Pay part now from wallet</Text>
                        <Text style={s.paySub}>
                          Balance {dh(walletCents!)} DH · enough to cover it
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
                        accessibilityLabel="Adjust the deposit">
                        <View style={s.paySplitRow}>
                          <View>
                            <Text style={s.payLabel}>DEPOSIT NOW</Text>
                            <Text style={s.payBig}>{dh(deposit)} DH</Text>
                          </View>
                          <View style={s.rightAlign}>
                            <Text style={s.payLabel}>AT THE SHOP</Text>
                            <Text style={s.depDue}>{dh(svc.price_cents - deposit)} DH</Text>
                          </View>
                        </View>
                        <View style={s.depTrack}>
                          <View style={[s.depFill, { width: `${(deposit / svc.price_cents) * 100}%` }]} />
                          <View style={[s.depKnob, { left: `${(deposit / svc.price_cents) * 100}%` }]} />
                        </View>
                        <View style={s.payFoot}>
                          <View style={s.payLockRow}>
                            <Ionicons name="lock-closed" size={10} color="rgba(255,255,255,0.45)" />
                            <Text style={s.payLock}>MIN {MIN_PCT}%</Text>
                          </View>
                          <Text style={s.payOf}>
                            {Math.round((deposit / svc.price_cents) * 100)}% of {dh(svc.price_cents)} DH
                          </Text>
                          <Text style={s.payLock}>100%</Text>
                        </View>
                        <View style={s.quickRow}>
                          {[MIN_PCT, 50, 75, 100].map((p) => {
                            const cents = Math.max(floor, Math.round((svc.price_cents * p) / 100));
                            const on = cents === deposit;
                            return (
                              <Pressable key={p} onPress={() => setDepositCents(cents)}
                                style={[s.quick, on && s.quickOn]}>
                                <Text style={[s.quickText, on && s.quickTextOn]}>
                                  {p === 100 ? 'Full' : `${p}%`}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </Pressable>
                    )}
                  </View>

                  <View style={s.breakCard}>
                    <BreakRow k="Wallet deposit" v={`${dh(deposit)} DH`} />
                    <BreakRow k="Cash at the shop" v={`${dh(svc.price_cents - deposit)} DH`} />
                    <View style={s.breakHr} />
                    <BreakRow k="Wallet after booking" v={`${dh(walletCents! - deposit)} DH`} />
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>

        {/* footer CTA */}
        {step === 'time' && (
          <View style={s.footer}>
            <PillButton title={time ? 'Review booking' : 'Select a time'}
              disabled={!time} onPress={() => setStep('summary')} />
          </View>
        )}
        {step === 'summary' && (
          <View style={s.footer}>
            <PillButton loading={busy} onPress={confirm}
              title={deposit > 0
                ? `Pay ${dh(deposit)} DH & confirm`
                : upFront && svc
                  ? `Request · ${dh(svc.price_cents)} DH up front`
                  : 'Confirm booking'} />
          </View>
        )}

        {/* 8c — the receipt. Replaces the sheet body once the row exists. */}
        {done && svc && (
          <View style={s.doneWrap}>
            <View style={s.doneIcon}>
              <Ionicons name="checkmark" size={30} color={colors.accent} />
            </View>
            <View>
              <Text style={s.doneTitle}>{done.deposit > 0 ? 'Slot held' : 'Request sent'}</Text>
              <Text style={s.doneSub}>
                {done.deposit > 0
                  ? `Your ${dh(done.deposit)} DH deposit is paid from your wallet. Pay the remaining `
                    + `${dh(svc.price_cents - done.deposit)} DH in cash at the shop.`
                  : 'The barber will confirm your booking shortly. Pay at the shop.'}
              </Text>
            </View>
            {done.deposit > 0 && (
              <View style={s.doneSplit}>
                <View>
                  <Text style={s.payLabel}>PAID FROM WALLET</Text>
                  <Text style={s.payBig}>{dh(done.deposit)} DH</Text>
                </View>
                <View style={s.rightAlign}>
                  <Text style={s.payLabel}>DUE AT THE SHOP</Text>
                  <Text style={s.doneDue}>{dh(svc.price_cents - done.deposit)} DH</Text>
                </View>
              </View>
            )}
            <View style={s.doneCard}>
              <BreakRow k="Booking ID" v={`#${done.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`} light />
              <BreakRow k="Salon" v={salon.name} light />
              <BreakRow k="Specialist" v={barber?.profiles?.full_name ?? '—'} light />
              <BreakRow k="Service" v={`${serviceName} · ${svc.duration_min} min`} light />
              <BreakRow k="When" v={`${time?.toDateString()} · ${time?.toTimeString().slice(0, 5)}`} light />
              {done.deposit > 0 && (
                <>
                  <View style={s.breakHr} />
                  <BreakRow k={`Deposit (${Math.round((done.deposit / svc.price_cents) * 100)}%)`}
                    v={`${dh(done.deposit)} DH paid`} />
                  <BreakRow k="Wallet balance" v={`${dh((walletCents ?? 0) - done.deposit)} DH`} />
                </>
              )}
            </View>
            <Pressable onPress={close} style={({ pressed }) => [s.doneBtn, pressed && s.pressed]}>
              <Text style={s.doneBtnText}>DONE</Text>
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
            <Text style={s.failTitle}>That slot just{'\n'}went</Text>
            <Text style={s.failSub}>
              Someone booked {time?.toDateString().slice(0, 10)}{' '}
              {time?.toTimeString().slice(0, 5)} with {barber?.profiles?.full_name?.split(' ')[0]}
              {' '}a moment before you. Nothing was charged.
            </Text>
          </View>
          <View style={s.failOk}>
            <View style={s.failTick}><Ionicons name="checkmark" size={11} color="#16A34A" /></View>
            <Text style={s.failOkText}>Your wallet is untouched</Text>
            <Text style={s.failOkAmount}>{dh(walletCents ?? 0)} DH</Text>
          </View>

          {alternatives.length > 0 && (
            <>
              <Text style={s.failEyebrow}>CLOSEST OPENINGS</Text>
              <View style={s.failList}>
                {alternatives.map((sl) => (
                  <View key={sl.time.getTime()} style={s.failRow}>
                    <View style={s.grow}>
                      <Text style={s.failWhen}>
                        {sl.time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' · '}{sl.time.toTimeString().slice(0, 5)}
                      </Text>
                      <Text style={s.optMeta}>
                        {barber?.profiles?.full_name?.split(' ')[0]} ·{' '}
                        {Math.round((sl.time.getTime() - (time?.getTime() ?? 0)) / 60000)} min later
                      </Text>
                    </View>
                    <Pressable onPress={() => { setTime(sl.time); setFailed(null); }}
                      style={({ pressed }) => [s.failBook, pressed && s.pressed]}>
                      <Text style={s.failBookText}>BOOK</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </>
          )}
          <Text style={s.failLink}
            onPress={() => { setFailed(null); setStep('time'); }}>Pick another time</Text>
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
              <Text style={s.failTitleSm}>Booking not confirmed</Text>
              <Text style={s.failSubSm}>
                We couldn't take the deposit, so the slot wasn't held. Nothing left your wallet.
              </Text>
            </View>
            <View style={s.breakCard}>
              <BreakRow k="Service" v={`${serviceName} · ${dh(svc.price_cents)} DH`} light />
              <BreakRow k="Slot" v={`${time?.toDateString().slice(0, 10)} · ${time?.toTimeString().slice(0, 5)}`} light />
              <BreakRow k="Deposit attempted" v={`${dh(deposit)} DH`} light />
              <View style={s.breakHr} />
              <BreakRow k="Wallet balance" v={`${dh(walletCents ?? 0)} DH · unchanged`} />
            </View>
            <View style={s.adjustNote}>
              <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
              <Text style={s.adjustNoteText}>
                The slot is still free — try again now, or book with cash only and pay it all at
                the shop.
              </Text>
            </View>
            <Pressable onPress={() => { setFailed(null); confirm(); }}
              style={({ pressed }) => [s.doneBtn, pressed && s.pressed]}>
              <Text style={s.doneBtnText}>TRY AGAIN · {dh(deposit)} DH</Text>
            </Pressable>
            <Pressable onPress={() => { setFailed(null); setDepositOn(false); }}
              style={({ pressed }) => [s.keepBtn, pressed && s.pressed]}>
              <Text style={s.keepText}>BOOK WITHOUT DEPOSIT</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* 8b — adjust the deposit */}
      {svc && (
        <AdjustSheet visible={adjustOpen} price={svc.price_cents} floor={floor} value={deposit}
          onClose={() => setAdjustOpen(false)}
          onPick={(c) => { setDepositCents(c); setAdjustOpen(false); }} />
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
function AdjustSheet({ visible, price, floor, value, onClose, onPick }: {
  visible: boolean; price: number; floor: number; value: number;
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
          <Text style={s.headTitle}>Deposit amount</Text>
          <Pressable onPress={onClose} hitSlop={8} style={s.headBtn}>
            <Ionicons name="close" size={16} color={colors.text} />
          </Pressable>
        </View>

        <View style={s.adjustHead}>
          <Text style={s.adjustBig}>{dh(draft)}<Text style={s.adjustUnit}> DH</Text></Text>
          <Text style={s.adjustSub}>
            {pct}% of {dh(price)} DH · {dh(price - draft)} DH cash at the shop
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
            <Text style={s.adjustFootText}>{MIN_PCT}% minimum</Text>
          </View>
          <Text style={s.adjustFootText}>100% · {dh(price)} DH</Text>
        </View>

        <View style={s.adjustChips}>
          {[MIN_PCT, 50, 75, 100].map((p) => {
            const cents = Math.max(floor, Math.round((price * p) / 100));
            const on = cents === draft;
            return (
              <Pressable key={p} onPress={() => setDraft(cents)}
                style={[s.adjustChip, on && s.adjustChipOn]}>
                <Text style={[s.adjustChipText, on && s.adjustChipTextOn]}>
                  {p === 100 ? 'Full' : `${p}%`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.adjustNote}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={s.adjustNoteText}>
            A deposit of at least {MIN_PCT}% holds your slot. Refunded to your wallet if the barber
            cancels.
          </Text>
        </View>

        <Pressable onPress={() => onPick(draft)}
          style={({ pressed }) => [s.doneBtn, pressed && s.pressed]}>
          <Text style={s.doneBtnText}>USE {dh(draft)} DH DEPOSIT</Text>
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
        {onEdit && <Pressable onPress={onEdit} hitSlop={6}><Text style={s.sumEdit}>Edit</Text></Pressable>}
      </View>
      {children}
    </View>
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
  modeRow: { flexDirection: 'row', gap: sp(2), marginBottom: sp(2) },
  note: { textAlign: 'center', color: colors.textTertiary, marginVertical: sp(6), fontSize: font.body },

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
