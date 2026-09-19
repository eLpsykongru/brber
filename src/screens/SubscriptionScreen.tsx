import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Btn, Card, Eyebrow, GhostBtn, Ico, Note, Screen, Serif, T, TAB_INSET, TopBar } from '../components/dark';
import { comingSoon, dh, dhFine, forecast, friday, perBooking, planMath, type CensusRow } from '../lib/billing';
import { loc, tr, trn, trRich } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';
import { SUPPORT_PHONE } from './SupportScreens';

// "Owner - Subscription.dc.html" OSB-01 … OSB-05, over 0123/0124.
//
// Every number here is a field of my_subscription / my_invoice / my_unpaid, or one
// line of lib/billing.ts on two of them. The bill is itemised by chair — the ones
// that count AND the ones that don't, each with its reason — because that list is
// the audit trail that stops the "why am I paying for Omar" call.
//
// Deliberately absent (README §8): an invoice number and a Download button — a
// Moroccan invoice needs a sequence and an ICE and nobody has specified one; and
// any SMS price — 0,30 DH is not confirmed, so nothing is charged for SMS.

type Sub = {
  cycle: 'monthly' | 'yearly'; unit_price_cents: number; chair_cap: number;
  sms_included: number; sms_unit_price_cents: number | null;
  started_on: string; renews_on: string | null; term_seats: number | null; months_left: number | null;
};
type InvoiceRow = {
  id: string; kind: 'month' | 'year' | 'year_extra'; cycle: string; period_start: string; period_end: string;
  seats_billed: number; seats_counted: number; unit_price_cents: number; months: number;
  sms_used: number; sms_included: number; sms_charged_cents: number; credit_cents: number;
  total_cents: number; paid_cents: number; balance_cents: number;
  status: 'open' | 'settled' | 'void' | 'written_off'; closed_reason: string | null;
};
type Payload = {
  salon: string | null; today: string; month: string; next_count: string;
  subscription: Sub | null;
  list: { monthly_cents: number; yearly_cents: number; cap: number; sms_included: number };
  census: CensusRow[];
  sms: { month: string; used: number; included: number };
  collection: 'float_net' | 'agent_cash';
  credit_cents: number;
  friday: { cut_at: string; deposits_cents: number; float_cents: number; open_cents: number };
  invoices: InvoiceRow[];
};
type Unpaid = {
  invoice: string; kind: string; period_start: string; total_cents: number; balance_cents: number;
  days: number; short_fridays: number; hidden_on: string; closed_on: string;
  called: boolean; rung: 'open' | 'search_hidden' | 'bookings_closed'; cash_requested_at: string | null;
};
type Invoice = InvoiceRow & {
  salon: string; counted_at: string; sms_month: string | null; bookings: number; yearly_unit_cents: number;
  seats: { name: string; billable: boolean; reason: CensusRow['reason'] }[];
  payments: { method: 'netted' | 'cash'; cents: number; at: string; week: string | null;
    direction: 'collect' | 'pay_out' | 'nil' | null; line_cents: number | null; without_cents: number | null }[];
};

// dates stay in the shop's own words: "2 October", "October", "01–31 August".
// A bare date is read at noon so no time zone can move it a day; a timestamp is
// read as the instant it is, on the phone's clock.
const at = (iso: string) => new Date(iso.length > 10 ? iso : `${iso}T12:00:00`);
const dayMonth = (iso: string) => at(iso).toLocaleDateString(loc('en-GB'), { day: 'numeric', month: 'long' });
const monthName = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`)
  .toLocaleDateString(loc('en-GB'), { month: 'long', year: 'numeric' });
const monthOnly = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`)
  .toLocaleDateString(loc('en-GB'), { month: 'long' });
const dayOf = (iso: string) => Number(iso.slice(8, 10));

type View_ = 'home' | 'plan' | 'paid' | 'invoice' | 'unpaid';

export default function SubscriptionScreen({ onBack }: { onBack?: () => void }) {
  const [p, setP] = useState<Payload | null>(null);
  const [unpaid, setUnpaid] = useState<Unpaid | null>(null);
  const [view, setView] = useState<View_>('home');
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([supabase.rpc('my_subscription'), supabase.rpc('my_unpaid')]);
    if (a.error) return Alert.alert(tr('Could not load your subscription'), a.error.message);
    setP(a.data as Payload);
    setUnpaid((b.data as Unpaid | null) ?? null);
  }, []);
  useEffect(() => { load(); }, [load, tick]);

  if (!p) return <Screen bottom={TAB_INSET}><TopBar title={tr('Subscription')} onBack={onBack} plain /></Screen>;

  const home = () => setView('home');
  if (view === 'plan') return <PlanView p={p} onBack={home} onChanged={() => { setTick((n) => n + 1); home(); }} />;
  if (view === 'paid') return <PaidView p={p} onBack={home} onInvoice={(id) => { setInvoiceId(id); setView('invoice'); }} />;
  if (view === 'invoice' && invoiceId) return <InvoiceView id={invoiceId} onBack={() => setView('paid')} />;
  if (view === 'unpaid' && unpaid) return <UnpaidView u={unpaid} onBack={home} onAsked={() => setTick((n) => n + 1)} />;
  return <HomeView p={p} unpaid={unpaid} go={setView} onBack={onBack} />;
}

// ---- OSB-01 · what you pay on the 1st ----------------------------------------
function HomeView({ p, unpaid, go, onBack }: {
  p: Payload; unpaid: Unpaid | null; go: (v: View_) => void; onBack?: () => void;
}) {
  const sub = p.subscription;
  const cap = sub?.chair_cap ?? p.list.cap;
  const unit = sub?.unit_price_cents ?? p.list.monthly_cents;
  const yearly = sub?.cycle === 'yearly';
  const f = forecast(p.census, unit, cap);
  const billed = p.census.filter((c) => c.billable);
  const notCounted = p.census.filter((c) => !c.billable);
  const soon = comingSoon(p.census, cap);
  const math = planMath(sub ? (yearly ? p.list.monthly_cents : sub.unit_price_cents) : p.list.monthly_cents,
    p.list.yearly_cents, Math.max(f.billed, 1));
  // yearly: the term is paid for; the 1st only bills chairs added since
  const hero = !sub ? f.cents
    : yearly ? (sub.term_seats ?? 0) * sub.unit_price_cents * 12 : f.cents;

  return (
    <Screen bottom={TAB_INSET} gap={13}>
      <TopBar title={tr('Subscription')} onBack={onBack} plain />

      {unpaid && (
        <Card onPress={() => go('unpaid')} style={st.unpaidStrip}>
          <Ico name="alert-circle" size={15} color="#FF7A66" />
          <T w="b" size={12.5} style={st.grow}>
            {tr('Unpaid · {days} days · {amount}', { days: unpaid.days, amount: dh(unpaid.balance_cents) })}
          </T>
          <Ico name="chevron-right" size={15} color={D.sub} />
        </Card>
      )}

      <View>
        <Eyebrow ls={1.6}>
          {!sub ? tr('NOT BILLED YET · {n} CHAIRS', { n: f.billed })
            : yearly ? tr('THE YEAR · {n} CHAIRS', { n: sub.term_seats ?? 0 })
              : tr('DUE {date} · {n} CHAIRS', { date: dayMonth(p.next_count).toUpperCase(), n: f.billed })}
        </Eyebrow>
        <Serif size={44} ls={0} style={st.hero}>{dh(hero)}</Serif>
        <T size={12} c={D.sub} style={st.heroSub}>
          {!sub
            ? tr('Sterncut tells you before your first bill. This is what it would be as your shop stands today.')
            : yearly
              ? tr('Renews {date}. Only chairs you add before then are billed, for the months left.', { date: dayMonth(sub.renews_on!) })
              : tr('As your shop stands today. Counted again on {date}.', { date: dayMonth(p.next_count) })}
        </T>
      </View>

      <Card style={st.planRow} onPress={() => go('plan')}>
        <View style={st.grow}>
          <T w="b" size={13}>
            {yearly ? tr('Yearly · {price} per chair', { price: dh(sub!.unit_price_cents) })
              : tr('Monthly · {price} per chair', { price: dh(unit) })}
          </T>
          <T size={11.5} c={D.sub} style={st.mt3}>
            {yearly ? trn(math.monthsFree, '{n} month free against monthly.', '{n} months free against monthly.')
              : tr('Pay yearly and keep {amount} a year', { amount: dh(math.saving) })}
          </T>
        </View>
        <View style={st.chip}><T w="b" size={11.5}>{tr('Change')}</T></View>
      </Card>

      <Card style={st.listCard}>
        <Eyebrow ls={1.4}>{tr("WHAT YOU'RE PAYING FOR · {n} CHAIRS", { n: billed.length })}</Eyebrow>
        {billed.map((c) => (
          <View key={c.barber_id} style={st.seat}>
            <Initials name={c.name} />
            <View style={st.grow}>
              <T w="b" size={12.5}>{c.name}</T>
              <T size={10.5} c={D.sub} style={st.mt2}>
                {c.me ? tr('You — and you cut') : tr('On your page · taking bookings')}
              </T>
            </View>
            <T w="b" size={12} style={st.num}>{dh(yearly ? sub!.unit_price_cents : unit)}</T>
          </View>
        ))}
        {!billed.length && (
          <T size={11.5} c={D.sub}>{tr('Nobody on your page is taking bookings, so there is nothing to pay.')}</T>
        )}
        {!!notCounted.length && (
          <>
            <View style={st.rule} />
            <Eyebrow c={D.faint} ls={1.4}>{tr('NOT COUNTED · {n}', { n: notCounted.length })}</Eyebrow>
            {notCounted.map((c) => (
              <View key={c.barber_id} style={st.seat}>
                <View style={st.grow}>
                  <T w="sb" size={12} c={D.sub}>{c.name}</T>
                  <T size={10.5} c={D.faint} style={st.mt2}>{whyNot(c, cap)}</T>
                </View>
                <T w="b" size={11.5} c={D.green} style={st.num}>0 DH</T>
              </View>
            ))}
          </>
        )}
      </Card>

      {soon && (
        <View style={st.amber}>
          <Ico name="plus-circle" size={15} color={D.amber} />
          <T size={11.5} style={[st.grow, st.lh]}>
            {soon.free
              ? trRich("{name} is still finishing his setup — a chair counts once it's on your page. And you're already at the cap, so when he's live he costs you <b>nothing</b>.",
                  { b: (x, k) => <T key={k} w="b" size={11.5}>{x}</T> }, { name: soon.name })
              : tr("{name} is still finishing his setup — a chair counts once it's on your page, from the next 1st.", { name: soon.name })}
          </T>
        </View>
      )}

      <Pressable onPress={() => go('paid')} style={({ pressed }) => [st.payRow, pressed && st.pressed]}
        accessibilityRole="button">
        <T w="b" size={12.5} style={st.grow}>{tr('How it gets paid')}</T>
        <Ico name="chevron-right" size={16} color={D.sub} />
      </Pressable>
      <T size={10.5} c={D.faint} style={st.foot}>
        {tr("A chair counts if it's on your shop page and taking bookings — only the first {cap} are billed, ever. SMS this month: {used} of {included} included.",
          { cap, used: p.sms.used, included: p.sms.included })}
      </T>
    </Screen>
  );
}

function whyNot(c: CensusRow, cap: number) {
  if (c.reason === 'over_cap') return tr('Past the first {cap} chairs — free', { cap });
  if (c.reason === 'paused') return tr('Paused — not accepting bookings');
  if (c.setting_up) return tr('Invited, never finished setup — not on your page');
  return tr('Not on your shop page');
}

function Initials({ name }: { name: string }) {
  const i = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return <View style={st.initials}><T w="b" size={10.5} c={D.sub}>{i}</T></View>;
}

// ---- OSB-02 · monthly or yearly, the arithmetic in full ------------------------
function PlanView({ p, onBack, onChanged }: { p: Payload; onBack: () => void; onChanged: () => void }) {
  const sub = p.subscription;
  const cap = sub?.chair_cap ?? p.list.cap;
  const billed = p.census.filter((c) => c.billable).length;
  const chairs = Math.max(billed, 1);
  const m = planMath(p.list.monthly_cents, p.list.yearly_cents, chairs);
  const yearly = sub?.cycle === 'yearly';
  const [busy, setBusy] = useState(false);

  async function switchTo(cycle: 'monthly' | 'yearly') {
    setBusy(true);
    const { data, error } = await supabase.rpc('switch_subscription_cycle', { p_cycle: cycle });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not change your plan'), error.message);
    const credited = (data as { credited_cents?: number })?.credited_cents ?? 0;
    Alert.alert(cycle === 'yearly' ? tr('You are on the yearly plan') : tr('You are back on monthly'),
      cycle === 'yearly'
        ? tr('{amount} comes off your Friday deposits until it is paid.', { amount: dh(m.yearAtYearly) })
        : credited > 0
          ? tr('{amount} of unused months is kept as credit for your next bills.', { amount: dh(credited) })
          : tr('Your monthly bill starts again on the 1st.'));
    onChanged();
  }

  function confirm(cycle: 'monthly' | 'yearly') {
    Alert.alert(
      cycle === 'yearly' ? tr('Pay {amount} for the year?', { amount: dh(m.yearAtYearly) }) : tr('Go back to monthly?'),
      cycle === 'yearly'
        ? tr("It comes off your Friday deposits like the monthly bill. This month's bill is credited.")
        : tr('The unused whole months come back as credit, not cash.'),
      [{ text: tr('Cancel'), style: 'cancel' }, { text: tr('Confirm'), onPress: () => switchTo(cycle) }]);
  }

  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('Your plan')} onBack={onBack} plain />
      <T size={12.5} c={D.sub} style={st.lh}>
        {tr('Same product either way. The yearly is cheaper because you pay once and we stop chasing you.')}
      </T>

      <View style={[st.tier, !yearly && st.tierOn]}>
        <View style={st.tierTop}>
          <View style={[st.radio, !yearly && st.radioOn]}>{!yearly && <View style={st.radioDot} />}</View>
          <T w="b" size={14} style={st.grow}>{tr('Monthly')}</T>
          <Serif size={30} ls={0}>{Math.round(p.list.monthly_cents / 100)}</Serif>
          <T w="b" size={11} c={D.sub}>{tr('DH / chair')}</T>
        </View>
        <View style={st.ruleDim} />
        <T size={11.5} c={D.sub} style={st.lh}>
          {tr('Billed on the 1st for the chairs you have that morning — the first {cap} only. Close for a whole month, pay nothing for it.', { cap })}
        </T>
      </View>

      <View style={[st.tier, st.tierYear, yearly && st.tierOn]}>
        <View style={st.badge}>
          <T w="b" size={9.5} ls={1}>{trn(m.monthsFree, '{n} MONTH FREE', '{n} MONTHS FREE')}</T>
        </View>
        <View style={st.tierTop}>
          <View style={[st.radio, yearly && st.radioOn]}>{yearly && <View style={st.radioDot} />}</View>
          <T w="b" size={14} style={st.grow}>{tr('Yearly')}</T>
          <Serif size={30} ls={0} c="#FF7A66">{Math.round(p.list.yearly_cents / 100)}</Serif>
          <T w="b" size={11} c={D.sub}>{tr('DH / chair')}</T>
        </View>
        <View style={st.ruleDim} />
        <T size={11.5} c={D.sub} style={st.lh}>
          {tr('One payment for twelve months. A chair under the cap is pro-rated at {price} for the months left; a chair over it is free.',
            { price: Math.round(p.list.yearly_cents / 100) })}
        </T>
      </View>

      <Card style={st.sumCard}>
        <Eyebrow ls={1.4}>
          {billed ? tr('YOUR FIRST {n} CHAIRS, TWELVE MONTHS', { n: billed }) : tr('ONE CHAIR, TWELVE MONTHS')}
        </Eyebrow>
        <Line label={tr('Monthly')} value={dh(m.yearAtMonthly)} />
        <Line label={tr('Yearly')} value={dh(m.yearAtYearly)} color="#FF7A66" />
        <View style={st.ruleDim} />
        <Line label={tr('Every chair past the first {cap}', { cap })} value="0 DH" color={D.green} />
        <View style={st.lineRow}>
          <T w="b" size={12.5} style={st.grow}>{tr('You keep')}</T>
          <T w="b" size={11} c={D.green}>{`−${m.savingPct}%  `}</T>
          <Serif size={22} ls={0} c={D.green}>{dh(m.saving)}</Serif>
        </View>
      </Card>

      <Note bg="transparent">
        {tr("Switch to yearly mid-month and today's month is credited. Switch back and the unused months come back as credit, not cash.")}
      </Note>

      {!sub ? (
        <T size={11.5} c={D.faint} style={st.foot}>{tr('Your shop is not billed yet, so there is no plan to change.')}</T>
      ) : yearly ? (
        <GhostBtn title={tr('GO BACK TO MONTHLY')} onPress={busy ? undefined : () => confirm('monthly')} />
      ) : (
        <>
          <Btn title={tr('PAY {amount} FOR THE YEAR', { amount: dh(m.yearAtYearly) })}
            onPress={busy || !billed ? undefined : () => confirm('yearly')} />
          <Pressable onPress={onBack} style={st.textBtn}><T w="b" size={12.5} c={D.sub}>{tr('Stay monthly')}</T></Pressable>
        </>
      )}
    </Screen>
  );
}

function Line({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={st.lineRow}>
      <T size={12.5} c={D.sub} style={st.grow}>{label}</T>
      <T w="b" size={13.5} c={color ?? D.text} style={st.num}>{value}</T>
    </View>
  );
}

// ---- OSB-03 · how it gets paid: netted off Friday's deposits -------------------
function PaidView({ p, onBack, onInvoice }: { p: Payload; onBack: () => void; onInvoice: (id: string) => void }) {
  const fr = friday(p.friday.deposits_cents, p.friday.open_cents);
  const closed = p.invoices.filter((i) => i.status !== 'open');
  const open = p.invoices.filter((i) => i.status === 'open');
  return (
    <Screen bottom={TAB_INSET} gap={13}>
      <TopBar title={tr('How it gets paid')} onBack={onBack} plain />
      <T size={12.5} c={D.sub} style={st.lh}>
        {tr('Nothing new to set up. We already owe you the deposits your clients paid — the subscription comes off that on Friday.')}
      </T>

      <Card style={st.sumCard}>
        <Eyebrow ls={1.4}>{tr('FRIDAY {date} · SO FAR THIS WEEK', { date: dayMonth(p.friday.cut_at).toUpperCase() })}</Eyebrow>
        <Line label={tr('Deposits we hold for you')} value={dh(Math.max(p.friday.deposits_cents, 0))} />
        <View style={st.lineRow}>
          <T size={12.5} c={D.sub} style={st.grow}>{tr('Your subscription')}</T>
          <T w="b" size={13.5} c="#FF7A66" style={st.num}>{`− ${dh(fr.nets)}`}</T>
        </View>
        <View style={st.ruleDim} />
        <View style={st.lineRow}>
          <T w="b" size={13} style={st.grow}>{tr('Left of your deposits')}</T>
          <Serif size={26} ls={0} c={D.green}>{dh(fr.left)}</Serif>
        </View>
        {fr.carries > 0 && (
          <T size={11} c={D.amber} style={st.lh}>
            {tr('{amount} of the bill carries to the next Friday.', { amount: dh(fr.carries) })}
          </T>
        )}
        <T size={11} c={D.faint} style={st.lh}>
          {p.friday.float_cents > 0
            ? tr('Same settlement, same Friday, one line more. Your top-up cash is on the same statement, and your receipt shows every number.')
            : tr('Same settlement, same Friday, one line more. Your receipt shows both numbers.')}
        </T>
      </Card>

      <Card style={st.sumCard}>
        <Eyebrow ls={1.4}>{tr("IF FRIDAY ISN'T ENOUGH")}</Eyebrow>
        <Step n={1} text={tr('A quiet week leaves less than the bill — the rest carries to next Friday. No fee, no letter.')} />
        <Step n={2} text={tr('Four Fridays short and we call you before anything changes on your page.')} />
      </Card>

      <View style={[st.amber, p.collection !== 'agent_cash' && st.amberQuiet]}>
        <Ico name="alert-triangle" size={15} color={D.amber} />
        <T size={11.5} style={[st.grow, st.lh]}>
          {p.collection === 'agent_cash'
            ? tr('Your shop takes no deposits, so there is no Friday to net against. You pay in cash to the agent — the only path we have until a card rail exists.')
            : tr('A shop that takes no deposits has no Friday to net against. Those shops pay in cash to the agent — the only path we have until a card rail exists.')}
        </T>
      </View>

      <Eyebrow ls={1.4}>{tr('PAST INVOICES')}</Eyebrow>
      {!p.invoices.length && <T size={11.5} c={D.faint}>{tr('No invoice yet.')}</T>}
      {[...open, ...closed].map((i) => (
        <Card key={i.id} style={st.invRow} onPress={() => onInvoice(i.id)}>
          <View style={st.grow}>
            <T w="sb" size={12}>{invoiceTitle(i)}</T>
            <T size={10.5} c={D.faint} style={st.mt2}>{invoiceSub(i)}</T>
          </View>
          <T w="b" size={12} c={i.status === 'open' ? D.amber : i.status === 'settled' ? D.text : D.green} style={st.num}>
            {i.status === 'void' ? '0 DH' : dh(i.total_cents)}
          </T>
          <Ico name="chevron-right" size={14} color={D.muted} />
        </Card>
      ))}

      <T size={10.5} c={D.faint} style={st.foot}>
        {tr('No card. No RIB. No transfer fee. It is the same cash you already collect.')}
      </T>
    </Screen>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={st.step}>
      <View style={st.stepN}><T w="b" size={10} c={D.sub}>{n}</T></View>
      <T size={12} style={[st.grow, st.lh]}>{text}</T>
    </View>
  );
}

function invoiceTitle(i: InvoiceRow) {
  const month = monthName(i.period_start);
  if (i.kind === 'year') return tr('The year from {date}', { date: dayMonth(i.period_start) });
  if (i.kind === 'year_extra') return tr('{month} · chairs added', { month });
  return trn(i.seats_billed, '{month} · {n} chair', '{month} · {n} chairs', { month });
}

function invoiceSub(i: InvoiceRow) {
  if (i.status === 'void') {
    return i.closed_reason === 'no_bookings'
      ? tr('No chair took a booking all month')
      : tr('Credited when you switched to the yearly plan');
  }
  if (i.status === 'written_off') return tr('Written off');
  if (i.status === 'open') return tr('{amount} still open', { amount: dh(i.balance_cents) });
  return tr('Settled');
}

// ---- OSB-04 · a closed month -------------------------------------------------
function InvoiceView({ id, onBack }: { id: string; onBack: () => void }) {
  const [inv, setInv] = useState<Invoice | null>(null);
  useEffect(() => {
    supabase.rpc('my_invoice', { p_invoice: id }).then(({ data, error }) => {
      if (error) return Alert.alert(tr('Could not load the invoice'), error.message);
      setInv(data as Invoice);
    });
  }, [id]);
  if (!inv) return <Screen bottom={TAB_INSET}><TopBar title={tr('Invoice')} onBack={onBack} plain /></Screen>;

  const per = perBooking(inv.total_cents, inv.bookings);
  const perYearly = inv.kind === 'month' ? perBooking(inv.seats_billed * inv.yearly_unit_cents, inv.bookings) : null;
  const chip = inv.status === 'settled' ? [tr('SETTLED'), D.green, D.greenSoft]
    : inv.status === 'open' ? [tr('OPEN'), D.amber, D.amberSoft]
      : inv.status === 'void' ? [tr('NOT BILLED'), D.sub, D.card2] : [tr('WRITTEN OFF'), D.sub, D.card2];
  const range = inv.kind === 'month'
    ? `${String(dayOf(inv.period_start)).padStart(2, '0')}–${dayOf(inv.period_end)} ${monthOnly(inv.period_start)}`
    : `${dayMonth(inv.period_start)} – ${dayMonth(inv.period_end)}`;

  return (
    <Screen bottom={TAB_INSET} gap={13}>
      <TopBar title={inv.kind === 'month' ? monthOnly(inv.period_start) : tr('Invoice')} onBack={onBack} plain />
      <Card style={st.sumCard}>
        <View style={st.lineRow}>
          <View style={st.grow}>
            <Eyebrow ls={1.4}>{inv.salon.toUpperCase()}</Eyebrow>
            <Serif size={20} style={st.mt3}>{range}</Serif>
          </View>
          <View style={[st.statusChip, { backgroundColor: chip[2] }]}><T w="b" size={10.5} c={chip[1]}>{chip[0]}</T></View>
        </View>
        <View style={st.ruleDim} />
        <Line label={tr('Chairs billed on {date}', { date: dayMonth(inv.counted_at) })} value={String(inv.seats_billed)} />
        <Line label={inv.kind === 'month' ? tr('Per chair · monthly')
          : trn(inv.months, 'Per chair · {n} month at the yearly price', 'Per chair · {n} months at the yearly price')}
          value={inv.kind === 'month' ? dh(inv.unit_price_cents) : dh(inv.unit_price_cents * inv.months)} />
        {inv.sms_month && (
          <Line label={tr('SMS to clients with no app · {month}', { month: monthOnly(inv.sms_month) })}
            value={tr('{used} of {included} · {amount}', { used: inv.sms_used, included: inv.sms_included, amount: dh(inv.sms_charged_cents) })}
            color={inv.sms_charged_cents ? D.text : D.green} />
        )}
        {inv.credit_cents > 0 && <Line label={tr('Credit from earlier')} value={`− ${dh(inv.credit_cents)}`} color={D.green} />}
        <Line label={tr('Commission taken by Sterncut')} value={tr('None')} color={D.green} />
        <View style={st.ruleDim} />
        <View style={st.lineRow}>
          <T w="b" size={13} style={st.grow}>{tr('Invoice total')}</T>
          <Serif size={30} ls={0}>{dh(inv.total_cents)}</Serif>
        </View>
        {inv.payments.map((x, k) => (
          <View key={k} style={st.paidRow}>
            <Ico name="check" size={15} color={D.green} />
            <T size={11.5} style={[st.grow, st.lh]}>
              {x.method === 'cash'
                ? tr('Paid in cash to the agent on {date} — {amount}.', { date: dayMonth(x.at), amount: dh(x.cents) })
                : x.direction === 'pay_out'
                  ? tr('Netted off your week {week} settlement — you received {got} instead of {without}.',
                    { week: (x.week ?? '').slice(-2), got: dh(x.line_cents ?? 0), without: dh(x.without_cents ?? 0) })
                  : x.direction === 'collect'
                    ? tr('Netted off your week {week} settlement — you handed over {got} instead of {without}.',
                      { week: (x.week ?? '').slice(-2), got: dh(x.line_cents ?? 0), without: dh(x.without_cents ?? 0) })
                    : tr('Netted off your week {week} deposits — {amount}, and nothing else had to cross the counter.',
                      { week: (x.week ?? '').slice(-2), amount: dh(x.cents) })}
            </T>
          </View>
        ))}
        {inv.status === 'open' && (
          <T size={11} c={D.amber}>{tr('{amount} still open — it comes off your next Friday deposits.', { amount: dh(inv.balance_cents) })}</T>
        )}
      </Card>

      {per != null && (
        <Card style={st.sumCard}>
          <Eyebrow ls={1.4}>{tr('WHAT IT COST YOU PER CUT')}</Eyebrow>
          <View style={st.perRow}>
            <View>
              <Serif size={32} ls={0}>{dhFine(per)}</Serif>
              <T size={10.5} c={D.sub}>{tr('per booking')}</T>
            </View>
            <T size={11.5} c={D.sub} style={[st.grow, st.lh]}>
              {perYearly != null
                ? trn(inv.bookings, '{n} booking in {month}. On the yearly plan the same month would have cost {x} a booking.',
                  '{n} bookings in {month}. On the yearly plan the same month would have cost {x} a booking.',
                  { month: monthOnly(inv.period_start), x: dhFine(perYearly) })
                : trn(inv.bookings, '{n} booking in the period.', '{n} bookings in the period.')}
            </T>
          </View>
        </Card>
      )}

      <Card style={st.listCard}>
        <Eyebrow ls={1.4}>{tr('WHO WAS COUNTED')}</Eyebrow>
        {inv.seats.map((z, k) => (
          <View key={k} style={st.seat}>
            <T w={z.billable ? 'b' : 'sb'} size={12} c={z.billable ? D.text : D.sub} style={st.grow}>{z.name}</T>
            <T size={10.5} c={z.billable ? D.sub : D.faint}>
              {z.billable ? tr('Billed')
                : z.reason === 'over_cap' ? tr('Past the cap — free')
                  : z.reason === 'paused' ? tr('Paused') : z.reason === 'paid_this_term' ? tr('Already paid this year')
                    : tr('Not on your page')}
            </T>
          </View>
        ))}
      </Card>

      <Note bg="transparent">
        {tr('A downloadable invoice needs a legal invoice number and an ICE. Nobody has set those up yet, so there is no PDF.')}
      </Note>
    </Screen>
  );
}

// ---- OSB-05 · unpaid: what we will and won't do --------------------------------
function UnpaidView({ u, onBack, onAsked }: { u: Unpaid; onBack: () => void; onAsked: () => void }) {
  const [busy, setBusy] = useState(false);
  const period = u.kind === 'month' ? monthOnly(u.period_start) : monthName(u.period_start);
  async function ask() {
    setBusy(true);
    const { error } = await supabase.rpc('request_subscription_collection');
    setBusy(false);
    if (error) return Alert.alert(tr('Could not send that'), error.message);
    Alert.alert(tr('We will send the agent'),
      tr('Pay him {amount} in cash. He records it, and it shows here.', { amount: dh(u.balance_cents) }));
    onAsked();
  }
  const now = u.rung;
  return (
    <Screen bottom={TAB_INSET} gap={13}>
      <TopBar title={tr('Subscription')} onBack={onBack} plain />
      <View style={st.unpaidCard}>
        <Eyebrow c="#FF7A66" ls={1.6}>{tr('UNPAID · {days} DAYS', { days: u.days })}</Eyebrow>
        <View style={st.unpaidAmt}>
          <Serif size={38} ls={0}>{dh(u.balance_cents)}</Serif>
          <T size={12} c={D.sub}>{tr('for {period}', { period })}</T>
        </View>
        <T size={12} style={st.lh}>
          {now === 'open'
            ? trn(u.short_fridays, "One Friday, your deposits didn't cover it. Nothing has changed on your page yet.",
              "{n} Fridays running, your deposits didn't cover it. Nothing has changed on your page yet.")
            : now === 'search_hidden'
              ? tr("New clients can't find you in search right now. Your own clients, your link and your QR still work.")
              : tr('New appointments are closed. Every booking already in the book is still honoured.')}
        </T>
      </View>

      <Card style={st.sumCard}>
        <Eyebrow ls={1.4}>{tr('WHAT HAPPENS, AND WHEN')}</Eyebrow>
        <Rung dot={D.green} title={tr('Today — nothing')} sub={tr('Bookings, queue, wall display, all normal.')} dim={now !== 'open'} />
        <Rung dot={D.amber} title={tr('{date} — off search', { date: dayMonth(u.hidden_on) })}
          sub={tr('New clients stop finding you. Your own clients, your link and your QR keep working.')} dim={now === 'bookings_closed'} />
        <Rung dot={D.accent} title={tr('{date} — bookings close', { date: dayMonth(u.closed_on) })}
          sub={tr('No new appointments. Every booking already in the book is still honoured.')} />
        {!u.called && (
          <T size={11} c={D.faint} style={st.lh}>{tr('Neither step happens before we have called you.')}</T>
        )}
      </Card>

      <View style={st.never}>
        <Eyebrow ls={1.4}>{tr('WHAT WE NEVER DO')}</Eyebrow>
        {[tr("Cancel a client's appointment over your bill"),
          tr('Hold back deposits that are already yours'),
          tr('Delete your shop, your history or your ratings')].map((x) => (
          <View key={x} style={st.neverRow}>
            <Ico name="check" size={14} color={D.green} />
            <T size={11.5} style={[st.grow, st.lh]}>{x}</T>
          </View>
        ))}
      </View>

      <Card style={st.talk} onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)}>
        <View style={st.talkIcon}><Ico name="phone" size={15} /></View>
        <View style={st.grow}>
          <T w="b" size={12.5}>{tr('Talk to Sterncut')}</T>
          <T size={11} c={D.sub} style={st.mt2}>{tr('A bad month is a conversation, not a suspension')}</T>
        </View>
      </Card>

      {u.cash_requested_at
        ? <T size={11.5} c={D.sub} style={st.foot}>{tr('You asked for the agent on {date}. He is coming for {amount}.', { date: dayMonth(u.cash_requested_at), amount: dh(u.balance_cents) })}</T>
        : <Btn title={tr('PAY {amount} IN CASH TO THE AGENT', { amount: dh(u.balance_cents) })} onPress={busy ? undefined : ask} />}
      <T size={10.5} c={D.faint} style={st.foot}>{tr("Or leave it — next Friday's deposits clear it automatically.")}</T>
    </Screen>
  );
}

function Rung({ dot, title, sub, dim }: { dot: string; title: string; sub: string; dim?: boolean }) {
  return (
    <View style={[st.rung, dim && { opacity: 0.5 }]}>
      <View style={[st.rungDot, { backgroundColor: dot }]} />
      <View style={st.grow}>
        <T w="b" size={12.5}>{title}</T>
        <T size={11} c={D.sub} style={[st.mt2, st.lh]}>{sub}</T>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  mt3: { marginTop: 3 },
  lh: { lineHeight: 17 },
  num: { fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.7 },
  hero: { marginTop: 6, fontVariant: ['tabular-nums'] },
  heroSub: { marginTop: 7 },
  foot: { textAlign: 'center', lineHeight: 16 },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18 },
  chip: { height: 32, borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 13, justifyContent: 'center' },
  listCard: { padding: 15, gap: 9, borderRadius: 20 },
  seat: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  initials: { width: 30, height: 30, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  rule: { height: 1, backgroundColor: D.border, marginVertical: 2 },
  ruleDim: { height: 1, backgroundColor: D.border },
  amber: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(232,161,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.22)', borderRadius: 16, padding: 13 },
  amberQuiet: { opacity: 0.8 },
  payRow: { height: 50, borderRadius: 999, backgroundColor: D.card2, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  unpaidStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16,
    backgroundColor: 'rgba(232,68,46,0.1)', borderWidth: 1, borderColor: 'rgba(232,68,46,0.3)' },
  tier: { borderWidth: 1.5, borderColor: D.border, borderRadius: 20, padding: 16, gap: 11 },
  tierYear: { backgroundColor: '#101010' },
  tierOn: { borderColor: D.accent },
  tierTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  badge: { position: 'absolute', top: -10, right: 16, height: 21, borderRadius: 999, backgroundColor: D.accent,
    paddingHorizontal: 10, justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 999, borderWidth: 2, borderColor: D.muted, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: D.accent },
  radioDot: { width: 10, height: 10, borderRadius: 999, backgroundColor: D.accent },
  sumCard: { padding: 15, gap: 10, borderRadius: 20 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textBtn: { height: 46, alignItems: 'center', justifyContent: 'center' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stepN: { width: 20, height: 20, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  invRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 14 },
  statusChip: { height: 24, borderRadius: 999, paddingHorizontal: 11, justifyContent: 'center' },
  paidRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#101010', borderRadius: 14, padding: 12 },
  perRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  unpaidCard: { backgroundColor: 'rgba(232,68,46,0.1)', borderWidth: 1, borderColor: 'rgba(232,68,46,0.3)',
    borderRadius: 20, padding: 16, gap: 9 },
  unpaidAmt: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  rung: { flexDirection: 'row', gap: 11 },
  rungDot: { width: 9, height: 9, borderRadius: 999, marginTop: 4 },
  never: { backgroundColor: '#101010', borderWidth: 1, borderColor: D.border, borderRadius: 20, padding: 15, gap: 10 },
  neverRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  talk: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 18 },
  talkIcon: { width: 32, height: 32, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
});
