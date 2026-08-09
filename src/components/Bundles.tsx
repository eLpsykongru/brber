import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import {
  Block, daySlots, fitCount, Range, sameDay, slotNote, SLOT_STEP_MIN, Window,
} from '../lib/slots';
import { colors, font, radius, serif, shadow, shadowLg, sp } from '../theme';

// Turn 34 of "Customer App 3.dc.html" — the one-visit bundle. Turn 33 drew the
// prepaid pass; the call was option (a), so a bundle is n services with one
// barber in one sitting, and the whole turn is about what that costs you:
// 70 minutes doesn't fit a 30-minute grid (34c), a booking now holds 1–n
// services (34e, MyBookingsScreen), and a client can walk out halfway (34f).
//
// Backend is 0047: `bundles` / `bundle_services` / `booking_services`, and
// `book_bundle` / `book_custom` — "Build your own" is an ad-hoc bundle with no
// discount, so there is exactly one booking path to get wrong.

export type BundleSvc = { id: string; name: string; price_cents: number; duration_min: number };
export type Bundle = {
  id: string; barber_id: string; barber: string; name: string;
  price_cents: number; list_cents: number; duration_min: number; services: BundleSvc[];
};
export type BundleBarber = { id: string; name: string; services: BundleSvc[] };

const dh = (cents: number) => (cents / 100).toFixed(0);
const MIN_PCT = 40; // mirrors 0047's floor; the server re-checks and 0046 can raise it to 100

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** How many 30-minute cells a sitting eats — 34b's "three slots in a row". */
const cellsFor = (min: number) => Math.ceil(min / SLOT_STEP_MIN);

// ---------------------------------------------------------------------------
// 34a — the Bundles tab on the salon page
// ---------------------------------------------------------------------------
export function BundlesTab({ bundles, allServices, onBook, onBuild }: {
  bundles: Bundle[];
  allServices: BundleSvc[];
  onBook: (b: Bundle) => void;
  onBuild: () => void;
}) {
  const [top, ...rest] = bundles;

  return (
    <>
      <Text style={s.section}>Bundles <Text style={s.count}>({bundles.length})</Text></Text>

      {top && (
        <Pressable onPress={() => onBook(top)} style={({ pressed }) => [s.hero, pressed && s.pressed]}>
          <View style={s.heroTop}>
            <View style={s.grow}>
              <Text style={s.heroEyebrow}>MOST BOOKED</Text>
              <Text style={s.heroName}>{top.name}</Text>
            </View>
            <View style={s.right}>
              <Text style={s.heroPrice}>{dh(top.price_cents)} DH</Text>
              {top.list_cents > top.price_cents && (
                <Text style={s.heroWas}>{dh(top.list_cents)} DH</Text>
              )}
            </View>
          </View>

          <View style={s.heroList}>
            {top.services.map((sv) => (
              <View key={sv.id} style={s.heroRow}>
                <View style={s.dot} />
                <Text style={s.heroSvc} numberOfLines={1}>{sv.name}</Text>
                <Text style={s.heroMin}>{sv.duration_min} min</Text>
              </View>
            ))}
          </View>

          <View style={s.heroFoot}>
            <View style={s.heroFootLeft}>
              <Ionicons name="time-outline" size={15} color="#FFFFFF" />
              <Text style={s.heroFootText}>{top.duration_min} min in one sitting</Text>
            </View>
            {top.list_cents > top.price_cents && (
              <Text style={s.savePill}>SAVE {dh(top.list_cents - top.price_cents)} DH</Text>
            )}
          </View>
        </Pressable>
      )}

      {rest.map((b) => {
        // 34a's note: a barber can have both a "Haircut + Beard" service and a
        // bundle that is the same thing at the same price. Say so rather than
        // letting someone think they found a deal.
        const twin = allServices.find((sv) => sv.price_cents === b.price_cents
          && b.services.length > 1 && sv.duration_min >= b.duration_min);
        return (
          <Pressable key={b.id} onPress={() => onBook(b)}
            style={({ pressed }) => [s.card, pressed && s.pressed]}>
            <View style={s.cardTop}>
              <View style={s.grow}>
                <Text style={s.cardName}>{b.name}</Text>
                <Text style={s.cardSub} numberOfLines={2}>
                  {b.services.map((sv) => sv.name).join(' + ')} · {b.duration_min} min
                </Text>
              </View>
              <View style={s.right}>
                <Text style={s.cardPrice}>{dh(b.price_cents)} DH</Text>
                {b.list_cents > b.price_cents && (
                  <Text style={s.cardWas}>{dh(b.list_cents)} DH</Text>
                )}
              </View>
            </View>
            {twin && (
              <View style={s.note}>
                <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                <Text style={s.noteText}>
                  Same as the {dh(twin.price_cents)} DH “{twin.name}” under Services — bundles
                  overlap the service list.
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}

      <Pressable onPress={onBuild} style={({ pressed }) => [s.buildRow, pressed && s.pressed]}>
        <View style={s.buildIcon}><Ionicons name="add" size={19} color={colors.text} /></View>
        <View style={s.grow}>
          <Text style={s.cardName}>Build your own</Text>
          <Text style={s.cardSub}>Any services, one sitting · no discount</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>

      {bundles.length === 0 && (
        <Text style={s.emptyHint}>No bundles yet — build your own from this shop's services.</Text>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 34b / 34c / 34d — the three-step sheet
// ---------------------------------------------------------------------------
export function BundleSheet({ visible, bundle, bundles, barbers, onClose, onBooked, onSplit }: {
  visible: boolean;
  /** a named bundle skips step 1; null = "Build your own" */
  bundle: Bundle | null;
  /** every real bundle at this shop — a hand-picked set that matches one gets its price */
  bundles: Bundle[];
  barbers: BundleBarber[];
  onClose: () => void;
  onBooked: (bookingId: string) => void;
  onSplit: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [barberId, setBarberId] = useState<string>('');
  const [picked, setPicked] = useState<string[]>([]);
  const [time, setTime] = useState<Date | null>(null);
  const [depositOn, setDepositOn] = useState(true);
  const [depositPct, setDepositPct] = useState(MIN_PCT);
  const [walletCents, setWalletCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // slot inputs — same four reads SlotPicker does, one barber at a time
  const [windows, setWindows] = useState<Window[]>([]);
  const [daysOff, setDaysOff] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [bufferMin, setBufferMin] = useState(0);
  const [booked, setBooked] = useState<Range[]>([]);
  const [day, setDay] = useState<Date>(() => new Date());

  const barber = barbers.find((b) => b.id === barberId) ?? barbers[0];

  useEffect(() => {
    if (!visible) return;
    const b = bundle?.barber_id ?? barbers[0]?.id ?? '';
    setBarberId(b);
    setPicked(bundle ? bundle.services.map((sv) => sv.id) : []);
    setStep(bundle ? 2 : 1);
    setTime(null); setDepositOn(true); setDepositPct(MIN_PCT); setDay(new Date());
    supabase.from('wallet_transactions').select('amount_cents')
      .then(({ data }) => setWalletCents((data ?? []).reduce((a, r: any) => a + r.amount_cents, 0)));
  }, [visible, bundle]);

  const loadSlots = useCallback(async (id: string) => {
    if (!id) return;
    const from = new Date();
    const to = new Date(Date.now() + 14 * 86_400_000);
    const [av, off, blk, buf, bk] = await Promise.all([
      supabase.from('availability').select('weekday, start_min, end_min').eq('barber_id', id),
      supabase.from('days_off').select('day').eq('barber_id', id),
      supabase.from('time_blocks').select('day, start_min, end_min, kind').eq('barber_id', id),
      supabase.from('barbers').select('buffer_before_min, buffer_after_min').eq('id', id).single(),
      supabase.rpc('booked_ranges', { p_barber: id, p_from: from.toISOString(), p_to: to.toISOString() }),
    ]);
    setWindows(av.data ?? []);
    setDaysOff((off.data ?? []).map((d: any) => d.day));
    setBlocks(blk.data ?? []);
    setBufferMin(buf.data ? buf.data.buffer_before_min + buf.data.buffer_after_min : 0);
    setBooked(bk.data ?? []);
  }, []);

  useEffect(() => { if (visible && barberId) loadSlots(barberId); }, [visible, barberId, loadSlots]);

  const menu = barber?.services ?? [];
  const chosen = useMemo(
    () => (bundle ? bundle.services : menu.filter((sv) => picked.includes(sv.id))),
    [bundle, menu, picked],
  );
  const totalMin = chosen.reduce((a, sv) => a + sv.duration_min, 0);
  const listCents = chosen.reduce((a, sv) => a + sv.price_cents, 0);
  // 34b — a hand-picked set that happens to BE one of this barber's bundles is
  // charged as that bundle. Without this the barber's published bundle is
  // invisible to anyone who ticks the same three services themselves.
  const matched = useMemo(() => bundle ?? bundles.find((b) =>
    b.barber_id === barber?.id && sameSet(b.services.map((sv) => sv.id), picked)) ?? null,
  [bundle, bundles, barber, picked]);
  const price = matched ? matched.price_cents : listCents;
  const saving = Math.max(0, listCents - price);

  const days = useMemo(
    () => Array.from({ length: 5 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0); return d;
    }), [],
  );

  const grid = useMemo(() => {
    if (!totalMin) return [];
    const fitting = new Set(
      daySlots(day, totalMin, windows, booked, daysOff, blocks, bufferMin)
        .filter((sl) => sl.status === 'free').map((sl) => sl.time.getTime()),
    );
    return daySlots(day, SLOT_STEP_MIN, windows, booked, daysOff, blocks, bufferMin)
      .map((sl) => ({ ...sl, fits: fitting.has(sl.time.getTime()) }));
  }, [day, totalMin, windows, booked, daysOff, blocks, bufferMin]);

  const counts = useMemo(
    () => (totalMin ? fitCount(day, totalMin, windows, booked, daysOff, blocks, bufferMin) : { fits: 0, all: 0 }),
    [day, totalMin, windows, booked, daysOff, blocks, bufferMin],
  );

  const floor = Math.ceil((price * MIN_PCT) / 100);
  const canDeposit = walletCents != null && walletCents >= floor && price > 0;
  const deposit = canDeposit && depositOn
    ? Math.min(Math.max(Math.round((price * depositPct) / 100), floor), price) : 0;

  async function confirm() {
    if (!time || !barber) return;
    setBusy(true);
    const { data, error } = matched
      ? await supabase.rpc('book_bundle',
        { p_bundle: matched.id, p_starts_at: time.toISOString(), p_deposit_cents: deposit })
      : await supabase.rpc('book_custom',
        { p_barber: barber.id, p_services: picked, p_starts_at: time.toISOString(), p_deposit_cents: deposit });
    setBusy(false);
    if (error) return Alert.alert('Could not book that', error.message);
    onBooked(data as string);
  }

  const title = step === 1 ? 'One sitting' : step === 2 ? 'Pick a time' : 'Overview';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.scrim}>
        <View style={s.sheet}>
          <View style={s.grabber} />
          <View style={s.sheetHead}>
            <Pressable hitSlop={8} onPress={() => (step === 1 || (bundle && step === 2))
              ? onClose() : setStep((step - 1) as 1 | 2)}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </Pressable>
            <Text style={s.sheetTitle}>{title}</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <View style={s.dashes}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[s.dash, n <= step && s.dashOn]} />
            ))}
          </View>

          <ScrollView style={s.body} contentContainerStyle={s.bodyPad} showsVerticalScrollIndicator={false}>
            {/* ---- 34b · tick what you want ---- */}
            {step === 1 && (
              <>
                {barbers.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
                    {barbers.map((b) => (
                      <Pressable key={b.id} onPress={() => { setBarberId(b.id); setPicked([]); }}
                        style={[s.chip, b.id === barberId && s.chipOn]}>
                        <Text style={[s.chipText, b.id === barberId && s.chipTextOn]}>{b.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                <Text style={s.eyebrow}>TICK WHAT YOU WANT</Text>
                {menu.map((sv) => {
                  const on = picked.includes(sv.id);
                  return (
                    <Pressable key={sv.id} style={[s.pick, on && s.pickOn]}
                      onPress={() => setPicked((xs) => on ? xs.filter((x) => x !== sv.id) : [...xs, sv.id])}>
                      <View style={s.grow}>
                        <Text style={[s.pickName, on && s.pickNameOn]}>{sv.name}</Text>
                        <Text style={s.pickMin}>{sv.duration_min} min</Text>
                      </View>
                      <Text style={[s.pickPrice, !on && s.pickPriceOff]}>{dh(sv.price_cents)} DH</Text>
                      <View style={[s.box, on && s.boxOn]}>
                        {on && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
                      </View>
                    </Pressable>
                  );
                })}
                {menu.length === 0 && <Text style={s.emptyHint}>This barber has no services yet.</Text>}

                {cellsFor(totalMin) >= 2 && (
                  <View style={s.warn}>
                    <Ionicons name="alert-circle-outline" size={17} color="#9A6B00" />
                    <Text style={s.warnText}>
                      {totalMin} min needs <Text style={s.warnBold}>{cellsFor(totalMin)} slots in a row</Text>
                      {' '}— that's rare later in the day.
                    </Text>
                  </View>
                )}
              </>
            )}

            {/* ---- 34c · finding 70 minutes ---- */}
            {step === 2 && (
              <>
                <Text style={s.sheetSub}>
                  {bundle ? `${bundle.name} · ` : ''}{chosen.length} service{chosen.length === 1 ? '' : 's'} · {totalMin} min
                </Text>

                <View style={s.dayRow}>
                  {days.map((d) => {
                    const c = fitCount(d, totalMin, windows, booked, daysOff, blocks, bufferMin);
                    const closed = c.all === 0;
                    const sel = sameDay(d, day);
                    return (
                      <Pressable key={d.toISOString()} disabled={closed} style={[s.dayCol, closed && s.dayClosed]}
                        onPress={() => { setDay(d); setTime(null); }}>
                        <Text style={s.dayDow}>{d.toLocaleDateString('en-US', { weekday: 'short' })}</Text>
                        <View style={[s.dayNum, sel && s.dayNumOn]}>
                          <Text style={[s.dayNumText, sel && s.dayNumTextOn]}>
                            {String(d.getDate()).padStart(2, '0')}
                          </Text>
                        </View>
                        <Text style={[s.dayFit, sel && s.dayFitOn]}>
                          {closed ? 'closed' : `${c.fits} fit`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={s.info}>
                  <Ionicons name="information-circle-outline" size={17} color={colors.textSecondary} />
                  <Text style={s.infoText}>
                    <Text style={s.infoBold}>{counts.fits} of {counts.all} times</Text> that day can hold
                    {' '}{totalMin} min. Single services fit anywhere.
                  </Text>
                </View>

                <View style={s.grid}>
                  {grid.map((sl) => {
                    if (!sl.fits) {
                      return (
                        <View key={sl.time.getTime()} style={s.slotDead}>
                          <Text style={s.slotDeadText}>{sl.time.toTimeString().slice(0, 5)}</Text>
                        </View>
                      );
                    }
                    const sel = time?.getTime() === sl.time.getTime();
                    const end = new Date(sl.time.getTime() + totalMin * 60_000);
                    return (
                      <Pressable key={sl.time.getTime()} onPress={() => setTime(sl.time)}
                        style={[s.slotFit, sel && s.slotFitOn]}>
                        <View style={s.grow}>
                          <Text style={[s.slotFitTime, sel && s.slotFitTimeOn]}>
                            {sl.time.toTimeString().slice(0, 5)} – {end.toTimeString().slice(0, 5)}
                          </Text>
                          <Text style={[s.slotFitNote, sel && s.slotFitNoteOn]}>
                            {slotNote(sl.time, totalMin, windows, booked, blocks)}
                          </Text>
                        </View>
                        <View style={[s.tick, sel && s.tickOn]}>
                          {sel && <Ionicons name="checkmark" size={13} color={colors.onAccent} />}
                        </View>
                      </Pressable>
                    );
                  })}
                  {grid.length === 0 && <Text style={s.emptyHint}>Not working that day.</Text>}
                </View>

                <Pressable onPress={onSplit}><Text style={s.splitLink}>Or split it across two visits</Text></Pressable>
              </>
            )}

            {/* ---- 34d · overview + deposit ---- */}
            {step === 3 && time && (
              <>
                <View style={s.summary}>
                  <View style={s.sumHead}>
                    <Text style={s.sumEyebrow}>{(matched?.name ?? 'One sitting').toUpperCase()}</Text>
                    <Text style={s.sumWhen}>
                      {time.toTimeString().slice(0, 5)} – {new Date(time.getTime() + totalMin * 60_000).toTimeString().slice(0, 5)} · {totalMin} min
                    </Text>
                  </View>
                  {chosen.map((sv) => (
                    <View key={sv.id} style={s.sumRow}>
                      <Text style={s.sumSvc}>{sv.name}</Text>
                      <Text style={s.sumPrice}>{dh(sv.price_cents)} DH</Text>
                    </View>
                  ))}
                  <View style={s.hr} />
                  {saving > 0 && (
                    <View style={s.sumRow}>
                      <Text style={s.sumMuted}>Bundle saving</Text>
                      <Text style={s.sumSaving}>− {dh(saving)} DH</Text>
                    </View>
                  )}
                  <View style={s.sumRow}>
                    <Text style={s.sumTotalK}>Total</Text>
                    <Text style={s.sumTotalV}>{dh(price)} DH</Text>
                  </View>
                  <Text style={s.sumWho}>
                    {barber?.name} · {time.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </Text>
                </View>

                {canDeposit && (
                  <View style={s.dep}>
                    <View style={s.depHead}>
                      <View style={s.depIcon}><Ionicons name="wallet-outline" size={17} color="#FFFFFF" /></View>
                      <View style={s.grow}>
                        <Text style={s.depTitle}>Deposit from wallet</Text>
                        <Text style={s.depSub}>Balance {dh(walletCents!)} DH · covers it</Text>
                      </View>
                      <Pressable onPress={() => setDepositOn((v) => !v)} hitSlop={6}
                        accessibilityRole="switch" accessibilityState={{ checked: depositOn }}
                        style={[s.toggle, depositOn && s.toggleOn]}>
                        <View style={s.knob} />
                      </Pressable>
                    </View>

                    {depositOn && (
                      <View style={s.depBody}>
                        <View style={s.depNums}>
                          <View>
                            <Text style={s.depEyebrow}>DEPOSIT NOW</Text>
                            <Text style={s.depBig}>{dh(deposit)} DH</Text>
                          </View>
                          <View style={s.right}>
                            <Text style={s.depEyebrow}>AT THE SHOP</Text>
                            <Text style={s.depRest}>{dh(price - deposit)} DH</Text>
                          </View>
                        </View>
                        <View style={s.track}>
                          <View style={[s.trackFill, { width: `${(deposit / price) * 100}%` }]} />
                        </View>
                        {/* ponytail: preset steps, not a draggable slider — same shape
                            BookingSheet already ships. Extract that block and share it
                            the next time either side of the deposit changes. */}
                        <View style={s.pctRow}>
                          {[40, 60, 80, 100].map((p) => (
                            <Pressable key={p} onPress={() => setDepositPct(p)}
                              style={[s.pct, depositPct === p && s.pctOn]}>
                              <Text style={[s.pctText, depositPct === p && s.pctTextOn]}>{p}%</Text>
                            </Pressable>
                          ))}
                        </View>
                        <View style={s.depFoot}>
                          <View style={s.depFootLeft}>
                            <Ionicons name="lock-closed" size={11} color="rgba(255,255,255,0.45)" />
                            <Text style={s.depMin}>MIN {MIN_PCT}%</Text>
                          </View>
                          <Text style={s.depOf}>{Math.round((deposit / price) * 100)}% of {dh(price)} DH</Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {saving > 0 && (
                  <View style={s.note}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                    <Text style={s.noteText}>
                      Skip a service on the day and you're charged the {chosen.length} prices
                      separately — the {dh(saving)} DH saving goes.
                    </Text>
                  </View>
                )}
              </>
            )}
          </ScrollView>

          {/* pinned CTA */}
          <Pressable
            disabled={busy
              || (step === 1 && picked.length === 0)
              || (step === 2 && !time)}
            onPress={() => (step === 3 ? confirm() : setStep((step + 1) as 2 | 3))}
            style={({ pressed }) => [s.cta,
              (busy || (step === 1 && picked.length === 0) || (step === 2 && !time)) && s.ctaOff,
              pressed && s.pressed]}>
            {busy ? <ActivityIndicator color={colors.onAccent} /> : (
              <Text style={s.ctaText}>
                {step === 1 ? `FIND A ${totalMin}-MIN SLOT`
                  : step === 2 ? 'REVIEW'
                    : deposit > 0 ? `PAY ${dh(deposit)} DH & CONFIRM` : 'CONFIRM BOOKING'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  right: { alignItems: 'flex-end' },
  pressed: { opacity: 0.85 },

  // 34a
  section: { fontSize: 17, fontWeight: '700', color: colors.text },
  count: { color: colors.textTertiary, fontWeight: '400' },
  hero: { backgroundColor: colors.ink, borderRadius: 22, padding: 18, gap: 13 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: sp(3) },
  heroEyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  heroName: {
    fontFamily: serif, fontSize: 26, lineHeight: 29, color: '#FFFFFF',
    marginTop: 5, letterSpacing: 0.5, textTransform: 'uppercase',
  },
  heroPrice: { fontFamily: serif, fontSize: 27, color: '#FFFFFF' },
  heroWas: { fontSize: font.small, color: 'rgba(255,255,255,0.45)', textDecorationLine: 'line-through', marginTop: 3 },
  heroList: { gap: 9, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 13 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  heroSvc: { flex: 1, fontSize: font.small, color: 'rgba(255,255,255,0.85)' },
  heroMin: { fontSize: font.small, color: 'rgba(255,255,255,0.45)' },
  heroFoot: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 13,
  },
  heroFootLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroFootText: { fontSize: font.small, fontWeight: '600', color: '#FFFFFF' },
  savePill: {
    fontSize: 10, letterSpacing: 1, fontWeight: '700', color: '#FFFFFF',
    backgroundColor: 'rgba(232,68,46,0.9)', borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden',
  },

  card: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 16, gap: 11, ...shadow },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: sp(3) },
  cardName: { fontSize: 14, fontWeight: '600', color: colors.text },
  cardSub: { fontSize: font.small, color: colors.textSecondary, marginTop: 2 },
  cardPrice: { fontSize: 14, fontWeight: '700', color: colors.text },
  cardWas: { fontSize: font.small, color: colors.textSecondary, textDecorationLine: 'line-through' },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
  },
  noteText: { flex: 1, fontSize: font.small, lineHeight: 19, color: colors.textSecondary },

  buildRow: {
    flexDirection: 'row', alignItems: 'center', gap: sp(3),
    backgroundColor: colors.bg, borderRadius: radius.md, padding: 16, ...shadow,
  },
  buildIcon: {
    width: 34, height: 34, borderRadius: radius.pill, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyHint: { fontSize: font.small, color: colors.textTertiary, paddingVertical: sp(3) },

  // sheet chrome
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingTop: 12, paddingHorizontal: 22, paddingBottom: 30, maxHeight: '92%', ...shadowLg,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#D8D4CA' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  sheetTitle: {
    flex: 1, textAlign: 'center', fontFamily: serif, fontSize: font.h2,
    letterSpacing: 0.6, textTransform: 'uppercase', color: colors.text,
  },
  dashes: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 12 },
  dash: { width: 28, height: 4, borderRadius: 2, backgroundColor: '#DDD9CF' },
  dashOn: { backgroundColor: colors.accent },
  body: { marginTop: 12 },
  bodyPad: { gap: 12, paddingBottom: sp(3) },
  sheetSub: { textAlign: 'center', fontSize: font.small, color: colors.textSecondary },
  eyebrow: { fontSize: 10, letterSpacing: 1.4, fontWeight: '700', color: colors.textSecondary },

  chipRow: { flexGrow: 0 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.bg, marginRight: 8,
  },
  chipOn: { backgroundColor: colors.ink },
  chipText: { fontSize: font.small, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.onAccent },

  // 34b picks
  pick: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.bg,
    borderRadius: radius.md, paddingHorizontal: 15, paddingVertical: 13,
    borderWidth: 2, borderColor: 'transparent', ...shadow,
  },
  pickOn: { borderColor: colors.ink },
  pickName: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  pickNameOn: { fontWeight: '700' },
  pickMin: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  pickPrice: { fontSize: 14, fontWeight: '800', color: colors.text },
  pickPriceOff: { fontWeight: '700', color: colors.textSecondary },
  box: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: '#D8D4CA',
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.ink, borderColor: colors.ink },

  warn: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    backgroundColor: 'rgba(232,161,0,0.12)', borderWidth: 1, borderColor: 'rgba(232,161,0,0.35)',
    borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11,
  },
  warnText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: '#7A5400' },
  warnBold: { fontWeight: '700' },

  // 34c
  dayRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  dayCol: { flex: 1, alignItems: 'center', gap: 6 },
  dayClosed: { opacity: 0.4 },
  dayDow: { fontSize: 10, color: colors.textSecondary },
  dayNum: { width: 34, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dayNumOn: { backgroundColor: colors.ink },
  dayNumText: { fontSize: font.small, fontWeight: '700', color: colors.text },
  dayNumTextOn: { color: colors.onAccent },
  dayFit: { fontSize: 9, fontWeight: '700', color: colors.textSecondary },
  dayFitOn: { color: colors.accent },

  info: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: colors.bg,
    borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, ...shadow,
  },
  infoText: { flex: 1, fontSize: 11.5, lineHeight: 17, color: '#5C5C58' },
  infoBold: { fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotDead: {
    width: '31.5%', height: 44, borderRadius: 14, backgroundColor: '#E9E6DE',
    alignItems: 'center', justifyContent: 'center',
  },
  slotDeadText: { fontSize: font.small, fontWeight: '600', color: colors.textTertiary },
  slotFit: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.md, backgroundColor: colors.bg, paddingHorizontal: 16, paddingVertical: 12, ...shadow,
  },
  slotFitOn: { backgroundColor: colors.ink },
  slotFitTime: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  slotFitTimeOn: { color: colors.onAccent, fontSize: 14 },
  slotFitNote: { fontSize: font.tiny, color: colors.textSecondary, marginTop: 2 },
  slotFitNoteOn: { color: 'rgba(255,255,255,0.55)' },
  tick: { width: 20, height: 20, borderRadius: radius.pill, borderWidth: 1.5, borderColor: '#D8D4CA' },
  tickOn: {
    backgroundColor: colors.accent, borderColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  splitLink: { textAlign: 'center', fontSize: font.tiny + 1, fontWeight: '600', color: colors.accent },

  // 34d
  summary: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: 16, gap: 10, ...shadow },
  sumHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: sp(2) },
  sumEyebrow: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: colors.textSecondary },
  sumWhen: { fontSize: font.tiny, color: colors.textSecondary },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  sumSvc: { fontSize: font.small, color: '#5C5C58' },
  sumPrice: { fontSize: font.small, fontWeight: '600', color: colors.text },
  hr: { height: 1, backgroundColor: '#EFECE4' },
  sumMuted: { fontSize: font.small, color: colors.textSecondary },
  sumSaving: { fontSize: font.small, fontWeight: '700', color: colors.accent },
  sumTotalK: { fontSize: 14, fontWeight: '700', color: colors.text },
  sumTotalV: { fontSize: 20, fontWeight: '800', color: colors.text },
  sumWho: { fontSize: font.tiny, color: colors.textSecondary },

  dep: { backgroundColor: colors.ink, borderRadius: 22, padding: 17, gap: 13 },
  depHead: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  depIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  depTitle: { fontSize: font.small, fontWeight: '700', color: '#FFFFFF' },
  depSub: { fontSize: font.tiny, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  toggle: {
    width: 42, height: 26, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.2)',
    padding: 3, justifyContent: 'center',
  },
  toggleOn: { backgroundColor: colors.accent, alignItems: 'flex-end' },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  depBody: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 13, gap: 10 },
  depNums: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  depEyebrow: { fontSize: 10, letterSpacing: 1.5, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  depBig: { fontFamily: serif, fontSize: 30, color: '#FFFFFF', marginTop: 4 },
  depRest: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginTop: 6 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  pctRow: { flexDirection: 'row', gap: 8 },
  pct: {
    flex: 1, height: 34, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  pctOn: { backgroundColor: '#FFFFFF' },
  pctText: { fontSize: font.tiny, fontWeight: '700', color: '#FFFFFF' },
  pctTextOn: { color: colors.ink },
  depFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  depFootLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  depMin: { fontSize: 10, letterSpacing: 0.6, fontWeight: '700', color: 'rgba(255,255,255,0.45)' },
  depOf: { fontSize: font.tiny, fontWeight: '700', color: '#FFFFFF' },

  cta: {
    height: 54, borderRadius: radius.pill, backgroundColor: colors.ink,
    alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { fontSize: font.small, fontWeight: '700', letterSpacing: 1, color: colors.onAccent },
});
