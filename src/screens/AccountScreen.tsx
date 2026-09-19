import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Btn, Card, Eyebrow, Ico, type IconName, RadioRow, Screen, Serif, Sheet, SheetHead, T, TAB_INSET, TopBar } from '../components/dark';
import { awkwardNet, dh, netWay } from '../lib/billing';
import { loc, tr, trn } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// "Barber - Account.dc.html" BAC-01 … BAC-08 — read-only, over 0125.
//
// The one thing this screen is for: a barber can answer "what do I owe you, and
// what do you owe me", and walk both numbers back to the names of the men who sat
// in his chair. So every total here opens its rows, and every row is a booking.
//
// What is NOT here, on purpose:
//   · cash taken in the chair — it never left his pocket and is never counted.
//     BAC-07 prints it beside a deposit as what the chair was due, never in a sum.
//   · the payee's code (BAC-09) and the agent's payout queue (BAC-10) — who pays a
//     barber inside the shop is the cash-agent slice, built after this one.

type Account = {
  me: string; salon: string | null; till: boolean; since: string | null;
  last_visit: { agent: string; at: string } | null;
  ours: { cents: number; count: number };
  mine: { cents: number; wallet_cuts: Bucket; deposits: Bucket; no_shows: Bucket; refunds: Bucket };
  pending: Bucket;
  colleagues: { cents: number; barbers: number };
  bill_cents: number;
  net_cents: number;
  cap: { cap_cents: number; net_cents: number; room_cents: number } | null;
  agent: { name: string; is_me: boolean } | null;
};
type Bucket = { cents: number; count: number };
type Row = {
  booking: string; ref: string; kind: 'wallet_cut' | 'deposit' | 'no_show' | 'late_cancel' | 'refund' | 'pending';
  cents: number; at: string; cleared_at: string | null; starts_at: string; status: string;
  name: string; service: string | null; in_chair_cents: number; client_says: string | null; disputed: boolean;
};
type Topup = { ref: string; cents: number; at: string; name: string };
type Visit = { pending: { direction: 'collect' | 'pay_out'; amount_cents: number; week: string; agent: string } | null };

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(loc('en-GB'), { weekday: 'short', day: 'numeric', month: 'short' })} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString(loc('en-GB'), { day: 'numeric', month: 'short' });
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

type View_ = 'home' | 'his' | 'ours' | 'settle' | 'wallet' | 'deposits' | 'awkward' | 'pending';

export default function AccountScreen({ onBack, onStatement }: { onBack?: () => void; onStatement?: () => void }) {
  const [a, setA] = useState<Account | null>(null);
  const [view, setView] = useState<View_>('home');
  const [tick, setTick] = useState(0);
  const [dispute, setDispute] = useState<Row | null>(null);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_account');
    if (error) return Alert.alert(tr('Could not load your account'), error.message);
    setA(data as Account);
  }, []);
  useEffect(() => { load(); }, [load, tick]);

  if (!a) return <Screen bottom={TAB_INSET}><TopBar title={tr('You & Sterncut')} onBack={onBack} plain /></Screen>;
  if (!a.salon) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title={tr('You & Sterncut')} onBack={onBack} plain />
        <T size={12.5} c={D.sub} style={st.lh}>{tr('Your account starts once a shop has taken you on.')}</T>
      </Screen>
    );
  }

  const home = () => setView('home');
  const sheet = (
    <DisputeSheet row={dispute} picking={picking}
      onPick={(r) => { setPicking(false); setDispute(r); }}
      onClose={() => { setDispute(null); setPicking(false); }}
      onSent={() => { setDispute(null); setTick((n) => n + 1); }} />
  );

  let body;
  if (view === 'his') {
    body = <HisView a={a} onBack={home} go={setView} onWrong={() => setPicking(true)} />;
  } else if (view === 'ours' && a.till) {
    body = <OursView a={a} onBack={home} onSettle={() => setView('settle')} />;
  } else if (view === 'settle' && a.till) {
    body = <SettleView a={a} onBack={() => setView('ours')} onStatement={onStatement} />;
  } else if (view === 'wallet') {
    body = <WalletCutsView a={a} onBack={() => setView('his')} onWrong={setDispute} />;
  } else if (view === 'deposits') {
    body = <DepositsView a={a} onBack={() => setView('his')} onWrong={setDispute} />;
  } else if (view === 'awkward') {
    body = <AwkwardView a={a} onBack={() => setView('his')} onWrong={setDispute} />;
  } else if (view === 'pending') {
    body = <PendingView onBack={() => setView('his')} />;
  } else {
    body = <HomeView a={a} go={setView} onBack={onBack} />;
  }
  return <>{body}{sheet}</>;
}

// ---- BAC-01 · one number, both directions --------------------------------------
function HomeView({ a, go, onBack }: { a: Account; go: (v: View_) => void; onBack?: () => void }) {
  const way = netWay(a.net_cents);
  const owed = way === 'you_are_owed';
  const heldOfHis = a.mine.cents;
  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('You & Sterncut')} onBack={onBack} plain />
      <Eyebrow ls={1.8}>{`${a.me} · ${a.salon}`.toUpperCase()}</Eyebrow>

      <View style={[st.hero, owed ? st.heroOwed : way === 'square' ? st.heroSquare : null]}>
        <Eyebrow c={owed ? '#7FC79B' : D.sub} ls={1.5}>
          {way === 'square' ? tr('ALL SQUARE') : owed ? tr('AFTER WE NET IT OFF · OURS TO PAY') : tr('AFTER WE NET IT OFF')}
        </Eyebrow>
        <Serif size={42} ls={0} c={owed ? D.green : D.text} style={st.num}>{dh(a.net_cents)}</Serif>
        <T size={12.5} style={st.lh}>
          {way === 'hand_over' ? tr('You hand over this much at the next collection.')
            : way === 'square' ? tr('Nothing to hand over and nothing to collect.')
              : a.till ? tr('We hand this much over to the shop at the next settlement.')
                : tr('You took no cash top-ups, so there is nothing to hand over — only to collect.')}
        </T>
        <T size={11.5} c={D.sub} style={[st.lh, st.heroWhy, owed && st.heroWhyOwed]}>
          {a.till
            ? [tr('Because we hold {held} of yours against the {float} you hold of ours.', { held: dh(heldOfHis), float: dh(a.ours.cents) }),
              a.colleagues.cents > 0 ? tr('{amount} your colleagues earned comes out of the same drawer.', { amount: dh(a.colleagues.cents) }) : null,
              a.bill_cents > 0 ? tr("{amount} of the shop's subscription comes off the same Friday.", { amount: dh(a.bill_cents) }) : null,
              tr('One number, not two.')].filter(Boolean).join(' ')
            : tr('Sterncut settles with the shop on Friday. You settle with the shop, in the shop.')}
        </T>
      </View>

      <View style={st.tiles}>
        <View style={st.tile}>
          <Eyebrow ls={1.2}>{tr('YOU HOLD FOR US')}</Eyebrow>
          <T w="eb" size={21} style={st.num}>{dh(a.ours.cents)}</T>
          <T size={10.5} c={D.faint}>{trn(a.ours.count, '{n} cash top-up', '{n} cash top-ups')}</T>
        </View>
        <View style={st.tile}>
          <Eyebrow ls={1.2}>{tr('WE HOLD FOR YOU')}</Eyebrow>
          <T w="eb" size={21} c={D.green} style={st.num}>{dh(heldOfHis)}</T>
          <T size={10.5} c={D.faint}>
            {trn(a.mine.wallet_cuts.count + a.mine.deposits.count + a.mine.no_shows.count, '{n} cut or deposit', '{n} cuts & deposits')}
          </T>
        </View>
      </View>

      <Nav icon="arrow-up" tint={D.green} title={tr('What we hold for you')} sub={tr('Every cut and deposit, line by line')} onPress={() => go('his')} />
      {a.till && (
        <Nav icon="arrow-down" tint={D.accent} title={tr('What you hold for us')} sub={tr('The float — and how close to the cap')} onPress={() => go('ours')} />
      )}

      {!a.till && a.agent && (
        <Card style={st.who}>
          <Eyebrow ls={1.4}>{tr('WHO PAYS YOU')}</Eyebrow>
          <View style={st.row}>
            <View style={[st.avatar, st.avatarWarm]}><T w="b" size={11} c={D.accent}>{initials(a.agent.name)}</T></View>
            <View style={st.grow}>
              <T w="b" size={13}>{a.agent.name}</T>
              <T size={11} c={D.sub} style={st.mt2}>{tr("The shop's cash agent")}</T>
            </View>
          </View>
          <T size={11.5} c={D.sub} style={[st.lh, st.whyLine]}>
            {tr("He pays you out of the shop's cash — the deposits Sterncut settles with the shop on Friday. It isn't his money and it isn't a favour.")}
          </T>
        </Card>
      )}

      {a.pending.count > 0 && (
        <View style={st.amber}>
          <Ico name="clock" size={15} color={D.amber} />
          <T size={11.5} style={[st.grow, st.lh]}>
            {trn(a.pending.count,
              "{amount} more is waiting on {n} booking that hasn't happened yet. It's yours the moment you finish the cut.",
              "{amount} more is waiting on {n} bookings that haven't happened yet. It's yours the moment you finish the cut.",
              { amount: dh(a.pending.cents) })}
          </T>
        </View>
      )}

      <T size={10.5} c={D.faint} style={st.foot}>
        {tr('We take no commission on a cut. These two columns are the only money between us.')}
      </T>
    </Screen>
  );
}

function Nav({ icon, tint, title, sub, onPress }: { icon: IconName; tint: string; title: string; sub: string; onPress: () => void }) {
  return (
    <Card style={st.nav} onPress={onPress}>
      <View style={[st.navIcon, { backgroundColor: tint === D.green ? 'rgba(74,222,128,0.14)' : 'rgba(232,68,46,0.14)' }]}>
        <Ico name={icon} size={15} color={tint} />
      </View>
      <View style={st.grow}>
        <T w="b" size={12.5}>{title}</T>
        <T size={11} c={D.sub} style={st.mt2}>{sub}</T>
      </View>
      <Ico name="chevron-right" size={16} color={D.sub} />
    </Card>
  );
}

function since(a: Account) {
  if (a.last_visit) return tr("Since {agent}'s last visit · {date}", { agent: a.last_visit.agent.split(' ')[0], date: dayMonth(a.last_visit.at) });
  if (a.since) return tr('Since the last settlement · {date}', { date: dayMonth(a.since) });
  return tr('Since your first booking through Sterncut');
}

// ---- BAC-02 · what we hold for you, line by line --------------------------------
function HisView({ a, onBack, go, onWrong }: { a: Account; onBack: () => void; go: (v: View_) => void; onWrong: () => void }) {
  const m = a.mine;
  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('What we hold for you')} onBack={onBack} plain />
      <Card style={st.sum}>
        <Eyebrow ls={1.4}>{tr('YOURS, CLEARED')}</Eyebrow>
        <Serif size={34} ls={0} c={D.green} style={st.num}>{dh(m.cents)}</Serif>
        <T size={11.5} c={D.sub}>{since(a)}</T>
      </Card>

      <Cat icon="shopping-bag" tint={D.green} amount={dh(m.wallet_cuts.cents)} onPress={() => go('wallet')}
        title={trn(m.wallet_cuts.count, '{n} cut paid from wallet', '{n} cuts paid from wallet')}
        sub={tr('Client had credit · you did the cut')} />
      <Cat icon="calendar" tint={D.green} amount={dh(m.deposits.cents)} onPress={() => go('deposits')}
        title={trn(m.deposits.count, '{n} deposit on a finished cut', '{n} deposits on finished cuts')}
        sub={tr('Paid online when they booked')} />
      <Cat icon="frown" tint={D.amber} amount={dh(m.no_shows.cents)} onPress={() => go('awkward')}
        title={trn(m.no_shows.count, '{n} no-show — deposit kept', '{n} no-shows — deposit kept')}
        sub={tr('You waited · the chair stayed empty')} />
      {m.refunds.count > 0 && (
        <Cat icon="corner-up-left" tint={D.red} amount={`− ${dh(m.refunds.cents)}`} amountColor={D.red} onPress={() => go('awkward')}
          title={trn(m.refunds.count, '{n} deposit handed back', '{n} deposits handed back')}
          sub={tr('Returned to the client after it was yours')} />
      )}

      <View style={st.ruleDim} />
      <Eyebrow c={D.faint} ls={1.4}>{trn(a.pending.count, 'NOT YOURS YET · {n} BOOKING', 'NOT YOURS YET · {n} BOOKINGS')}</Eyebrow>
      <Pressable onPress={() => go('pending')} style={({ pressed }) => [st.pendingRow, pressed && st.pressed]} accessibilityRole="button">
        <View style={st.grow}>
          <T w="sb" size={12} c={D.sub}>{tr('Deposits on cuts still to come')}</T>
          <T size={10.5} c={D.faint} style={st.mt2}>{tr('Theirs until the chair is done — then yours')}</T>
        </View>
        <T w="b" size={12.5} c={D.sub} style={st.num}>{dh(a.pending.cents)}</T>
        <Ico name="chevron-right" size={15} color={D.muted} />
      </Pressable>

      <Card style={st.nav} onPress={onWrong}>
        <View style={[st.navIcon, { backgroundColor: D.card2 }]}><Ico name="alert-triangle" size={14} color={D.sub} /></View>
        <View style={st.grow}>
          <T w="b" size={12.5}>{tr('A line here is wrong')}</T>
          <T size={11} c={D.sub} style={st.mt2}>{tr('Tell us which one — we hold it, not you')}</T>
        </View>
        <Ico name="chevron-right" size={16} color={D.sub} />
      </Card>

      <T size={10.5} c={D.faint} style={st.foot}>
        {tr('Cash a client hands you in the chair never appears here. That money never left your pocket.')}
      </T>
    </Screen>
  );
}

function Cat({ icon, tint, title, sub, amount, amountColor, onPress }: {
  icon: IconName; tint: string; title: string; sub: string; amount: string; amountColor?: string; onPress: () => void;
}) {
  const soft = tint === D.green ? 'rgba(74,222,128,0.14)' : tint === D.amber ? 'rgba(232,161,0,0.14)' : 'rgba(248,113,113,0.14)';
  return (
    <Card style={st.cat} onPress={onPress}>
      <View style={[st.navIcon, { backgroundColor: soft }]}><Ico name={icon} size={15} color={tint} /></View>
      <View style={st.grow}>
        <T w="b" size={12.5}>{title}</T>
        <T size={10.5} c={D.sub} style={st.mt2}>{sub}</T>
      </View>
      <T w="b" size={13} c={amountColor ?? D.text} style={st.num}>{amount}</T>
      <Ico name="chevron-right" size={15} color={D.muted} />
    </Card>
  );
}

// ---- BAC-03 · what you hold for us — the float side -----------------------------
function OursView({ a, onBack, onSettle }: { a: Account; onBack: () => void; onSettle: () => void }) {
  const [rows, setRows] = useState<Topup[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    supabase.rpc('my_account_lines', { p_kind: 'topups' }).then(({ data }) => setRows((data as Topup[]) ?? []));
  }, []);
  const cap = a.cap;
  const fill = cap ? Math.min(Math.max(cap.net_cents, 0) / cap.cap_cents, 1) : 0;
  const shown = all ? rows ?? [] : (rows ?? []).slice(0, 3);
  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('What you hold for us')} onBack={onBack} plain />
      <Card style={st.sum}>
        <Eyebrow ls={1.4}>{tr("CASH IN YOUR DRAWER THAT ISN'T YOURS")}</Eyebrow>
        <Serif size={36} ls={0} style={st.num}>{dh(a.ours.cents)}</Serif>
        {cap && (
          <View style={st.capWrap}>
            <View style={st.capTrack}>
              <View style={[st.capFill, { width: `${Math.round(fill * 100)}%`, backgroundColor: fill >= 0.7 ? D.amber : D.green }]} />
            </View>
            <View style={st.row}>
              <T size={11} c={D.sub} style={st.grow}>{tr('Room for {amount} more', { amount: dh(cap.room_cents) })}</T>
              <T w="b" size={11} c={D.sub}>{tr('Cap {amount}', { amount: dh(cap.cap_cents) })}</T>
            </View>
          </View>
        )}
        <T size={11.5} c={D.sub} style={[st.lh, st.whyLine]}>
          {tr("Clients paid you cash and we credited their wallets on the spot. You're keeping it safe until the agent comes.")}
        </T>
      </Card>

      <Eyebrow ls={1.4}>{tr('LATEST TOP-UPS')}</Eyebrow>
      {rows && !rows.length && <T size={11.5} c={D.faint}>{tr('No top-ups since the last settlement.')}</T>}
      {shown.map((r, k) => (
        <View key={r.ref ?? k} style={st.line}>
          <View style={[st.avatar, k === 0 && st.avatarWarm]}><T w="b" size={10} c={k === 0 ? D.accent : D.sub}>{initials(r.name)}</T></View>
          <View style={st.grow}>
            <T w="b" size={12.5}>{r.name}</T>
            <T size={10.5} c={D.sub} style={st.mt2}>{`${when(r.at)} · ${r.ref ?? ''}`}</T>
          </View>
          <T w="b" size={13} c={D.accent} style={st.num}>{`+${dh(r.cents)}`}</T>
        </View>
      ))}
      {!all && rows && rows.length > 3 && (
        <Pressable onPress={() => setAll(true)} hitSlop={8}>
          <T size={11} c={D.faint}>{tr('{n} more since the last settlement', { n: rows.length - 3 })}</T>
        </Pressable>
      )}

      {a.net_cents >= 0 && a.net_cents < a.ours.cents && (
        <Card style={st.nav}>
          <View style={[st.navIcon, { backgroundColor: D.card2 }]}><Ico name="clock" size={15} color={D.sub} /></View>
          <T size={11.5} c={D.sub} style={st.grow}>
            {tr("You'll hand over {net}, not {float}", { net: dh(a.net_cents), float: dh(a.ours.cents) })}
          </T>
        </Card>
      )}
      <Btn title={tr('SETTLE UP NOW')} onPress={onSettle} />
    </Screen>
  );
}

// ---- BAC-04 · settled — the netting, proved --------------------------------------
function SettleView({ a, onBack, onStatement }: { a: Account; onBack: () => void; onStatement?: () => void }) {
  const [visit, setVisit] = useState<Visit['pending']>(null);
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.rpc('my_visit_status').then(({ data }) => {
      if (!alive) return;
      const p = (data as Visit | null)?.pending ?? null;
      setVisit(p);
      if (p?.direction === 'collect') {
        supabase.rpc('my_visit_code').then(({ data: c }) => { if (alive && c?.code) setCode(c.code as string); });
      }
    });
    return () => { alive = false; };
  }, []);
  const way = netWay(a.net_cents);
  const from = a.since ? dayMonth(a.since) : null;
  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('Settle up')} onBack={onBack} plain />
      <Card style={st.sum}>
        <Eyebrow ls={1.4}>
          {from ? tr('THE WHOLE ACCOUNT · {from} – TODAY', { from: from.toUpperCase() }) : tr('THE WHOLE ACCOUNT · SO FAR')}
        </Eyebrow>
        <Row2 label={tr('You hold for us')} value={dh(a.ours.cents)} />
        <Row2 label={tr('We hold for you')} value={`− ${dh(a.mine.cents)}`} color={D.green} />
        {a.colleagues.cents > 0 && (
          <Row2 label={trn(a.colleagues.barbers, 'Your colleague — you pay him from the drawer', 'Your {n} colleagues — you pay them from the drawer')}
            value={`− ${dh(a.colleagues.cents)}`} color={D.green} />
        )}
        {a.bill_cents > 0 && <Row2 label={tr("The shop's subscription")} value={`+ ${dh(a.bill_cents)}`} color="#FF7A66" />}
        <View style={st.ruleDim} />
        <View style={st.row}>
          <T w="b" size={13} style={st.grow}>{way === 'you_are_owed' ? tr('We owe you') : tr('You hand over')}</T>
          <Serif size={28} ls={0} style={st.num}>{dh(a.net_cents)}</Serif>
        </View>
        <T size={11} c={D.faint} style={st.lh}>
          {way === 'you_are_owed'
            ? tr('Keep it in the drawer. It comes back to you on the Friday statement.')
            : tr('Count out {amount} in cash. The rest of the float is settled by the work you already did.', { amount: dh(a.net_cents) })}
        </T>
      </Card>

      {visit && code ? (
        <View style={st.codeCard}>
          <Eyebrow ls={1.5}>{tr('SHOW {agent} THIS CODE', { agent: visit.agent.split(' ')[0].toUpperCase() })}</Eyebrow>
          <Serif size={36} ls={0.22}>{code.split('').join(' ')}</Serif>
          <T size={11} c={D.faint} style={[st.lh, st.center]}>
            {tr("{agent} is coming for {amount} — week {week}'s statement. The agent types it in to confirm the cash is there. Don't hand anything over without it.",
              { agent: visit.agent.split(' ')[0], amount: dh(visit.amount_cents), week: visit.week.slice(-2) })}
          </T>
        </View>
      ) : (
        <Card style={st.nav} onPress={onStatement}>
          <View style={[st.navIcon, { backgroundColor: D.card2 }]}><Ico name="file-text" size={14} color={D.sub} /></View>
          <T size={11.5} c={D.sub} style={[st.grow, st.lh]}>
            {visit
              ? tr('{agent} is bringing you {amount} — week {week}. Your weekly statement has the details.',
                { agent: visit.agent.split(' ')[0], amount: dh(visit.amount_cents), week: visit.week.slice(-2) })
              : tr('No collection is planned yet. It is planned after the Friday statement goes out — the code appears here and on your weekly statement.')}
          </T>
        </Card>
      )}

      <Card style={st.sum}>
        <Eyebrow ls={1.4}>{tr('AFTER THE AGENT CONFIRMS')}</Eyebrow>
        {[tr('Both columns go to zero and the account starts again'),
          tr('Your cap is free again — you can take top-ups'),
          tr('{amount} on unfinished cuts stays pending, untouched', { amount: dh(a.pending.cents) })].map((x) => (
          <View key={x} style={st.row}>
            <Ico name="check" size={14} color={D.green} />
            <T size={11.5} style={[st.grow, st.lh]}>{x}</T>
          </View>
        ))}
      </Card>
      <T size={11} c={D.faint} style={st.lh}>
        {tr('What happens after Friday 21:00 goes on the next statement, so the agent may come for a little less than the total above.')}
      </T>
      <T size={11} c={D.faint} style={st.lh}>
        {tr('If we hold more of yours than you hold of ours, this flips: the agent pays you, and the code works the same way.')}
      </T>
    </Screen>
  );
}

function Row2({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={st.row}>
      <T size={12.5} c={D.sub} style={st.grow}>{label}</T>
      <T w="b" size={13.5} c={color ?? D.text} style={st.num}>{value}</T>
    </View>
  );
}

// ---- BAC-06 · cuts paid from wallet — the whole price, nothing in the chair -----
// A client who took the deposit at "Full" paid the cut from credit he already had.
// Same row as any deposit; it is here because nothing was left for the chair.
function WalletCutsView({ a, onBack, onWrong }: { a: Account; onBack: () => void; onWrong: (r: Row) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    supabase.rpc('my_account_lines', { p_kind: 'wallet_cuts' }).then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);
  const n = a.mine.wallet_cuts.count;
  const avg = n ? Math.round(a.mine.wallet_cuts.cents / n) : 0;
  // grouped by the day the cut was done, newest first — BAC-06's TODAY / YESTERDAY
  const days: { label: string; rows: Row[] }[] = [];
  for (const r of rows ?? []) {
    const label = new Date(r.cleared_at ?? r.at).toLocaleDateString(loc('en-GB'), { weekday: 'long', day: 'numeric', month: 'short' });
    const last = days[days.length - 1];
    if (last && last.label === label) last.rows.push(r); else days.push({ label, rows: [r] });
  }
  return (
    <Screen bottom={TAB_INSET} gap={11}>
      <TopBar title={tr('Paid from wallet')} onBack={onBack} plain />
      <Card style={[st.sum, st.sumRow]}>
        <View style={st.grow}>
          <Eyebrow ls={1.4}>{trn(n, '{n} CUT · YOURS IN FULL', '{n} CUTS · YOURS IN FULL')}</Eyebrow>
          <Serif size={30} ls={0} c={D.green} style={st.num}>{dh(a.mine.wallet_cuts.cents)}</Serif>
        </View>
        {n > 0 && <T size={11} c={D.faint} style={st.right}>{tr('{amount} average', { amount: dh(avg) })}</T>}
      </Card>
      {rows && !rows.length && <T size={11.5} c={D.faint}>{tr('No cut was paid in full from a wallet since the last settlement.')}</T>}
      {days.map((d) => (
        <View key={d.label} style={st.dayBlock}>
          <Eyebrow ls={1.4}>{d.label.toUpperCase()}</Eyebrow>
          {d.rows.map((r) => (
            <Pressable key={r.booking} onLongPress={() => onWrong(r)} style={st.line}>
              <View style={st.avatar}><T w="b" size={10} c={D.sub}>{initials(r.name)}</T></View>
              <View style={st.grow}>
                <T w="b" size={12.5}>{r.name}</T>
                <T size={10.5} c={D.sub} style={st.mt2}>
                  {[r.service, new Date(r.starts_at).toLocaleTimeString(loc('en-GB'), { hour: '2-digit', minute: '2-digit' })].filter(Boolean).join(' · ')}
                </T>
              </View>
              <View style={st.right}>
                <T w="b" size={13} style={st.num}>{dh(r.cents)}</T>
                <T size={10} c={D.faint} style={st.mt2}>{tr('wallet')}</T>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
      <T size={10.5} c={D.faint} style={st.foot}>
        {tr('Each of these was spent from credit the client had already topped up — often with you, in cash.')}
      </T>
    </Screen>
  );
}

// ---- BAC-07 · deposits on finished cuts, and what they paid in the chair --------
function DepositsView({ a, onBack, onWrong }: { a: Account; onBack: () => void; onWrong: (r: Row) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    supabase.rpc('my_account_lines', { p_kind: 'deposits' }).then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);
  return (
    <Screen bottom={TAB_INSET} gap={11}>
      <TopBar title={tr('Deposits')} onBack={onBack} plain />
      <Card style={st.sum}>
        <Eyebrow ls={1.4}>{trn(a.mine.deposits.count, '{n} DEPOSIT WE HOLD FOR YOU', '{n} DEPOSITS WE HOLD FOR YOU')}</Eyebrow>
        <Serif size={30} ls={0} c={D.green} style={st.num}>{dh(a.mine.deposits.cents)}</Serif>
        <T size={11.5} c={D.sub} style={st.lh}>
          {tr('Paid online to hold the slot. The rest they paid you in the chair — that part never came near us.')}
        </T>
      </Card>
      {(rows ?? []).map((r) => (
        <Pressable key={r.booking} onLongPress={() => onWrong(r)} style={st.line}>
          <View style={st.avatar}><T w="b" size={10} c={D.sub}>{initials(r.name)}</T></View>
          <View style={st.grow}>
            <T w="b" size={12.5}>{r.name}</T>
            <T size={10.5} c={D.sub} style={st.mt2}>{[r.service, when(r.starts_at), tr('done')].filter(Boolean).join(' · ')}</T>
          </View>
          <View style={st.right}>
            <T w="b" size={13} style={st.num}>{dh(r.cents)}</T>
            <T size={10} c={D.faint} style={st.mt2}>{tr('+ {amount} cash', { amount: dh(r.in_chair_cents).replace(' DH', '') })}</T>
          </View>
        </Pressable>
      ))}
      <View style={st.info}>
        <Ico name="info" size={14} color={D.faint} />
        <T size={11} c={D.faint} style={[st.grow, st.lh]}>
          {tr('A deposit clears the moment you mark the chair done. Before that it sits in the pending block, and it is still the client’s.')}
        </T>
      </View>
      <T size={10.5} c={D.faint} style={st.foot}>
        {trn(a.mine.deposits.count, 'One slot held, one client who turned up.', '{n} slots held, {n} clients who turned up.')}
      </T>
    </Screen>
  );
}

// ---- BAC-08 · the awkward ones — no-shows kept, deposits handed back -----------
function AwkwardView({ a, onBack, onWrong }: { a: Account; onBack: () => void; onWrong: (r: Row) => void }) {
  const [kept, setKept] = useState<Row[] | null>(null);
  const [back, setBack] = useState<Row[] | null>(null);
  useEffect(() => {
    supabase.rpc('my_account_lines', { p_kind: 'no_shows' }).then(({ data }) => setKept((data as Row[]) ?? []));
    supabase.rpc('my_account_lines', { p_kind: 'refunds' }).then(({ data }) => setBack((data as Row[]) ?? []));
  }, []);
  const n = awkwardNet(a.mine.no_shows.cents, a.mine.refunds.cents);
  const total = a.mine.no_shows.count + a.mine.refunds.count;
  return (
    <Screen bottom={TAB_INSET} gap={11}>
      <TopBar title={tr('Nobody in the chair')} onBack={onBack} plain />
      <Eyebrow ls={1.4}>{tr("THEY DIDN'T COME · YOU KEEP IT")}</Eyebrow>
      {kept && !kept.length && <T size={11.5} c={D.faint}>{tr('Nobody missed a booking since the last settlement.')}</T>}
      {(kept ?? []).map((r) => (
        <Card key={r.booking} style={st.awk}>
          <View style={st.row}>
            <View style={[st.avatar, { backgroundColor: 'rgba(232,161,0,0.14)' }]}><T w="b" size={10} c={D.amber}>{initials(r.name)}</T></View>
            <View style={st.grow}>
              <T w="b" size={12.5}>{r.name}</T>
              <T size={10.5} c={D.sub} style={st.mt2}>
                {`${when(r.starts_at)} · ${r.kind === 'no_show' ? tr('no-show') : tr('cancelled too late')}`}
              </T>
            </View>
            <T w="b" size={13} style={st.num}>{dh(r.cents)}</T>
          </View>
          <Pressable onPress={() => onWrong(r)} style={st.disputeLink} accessibilityRole="button">
            <Ico name="alert-triangle" size={13} color={D.amber} />
            <T w="sb" size={11} c={D.amber} style={st.grow}>
              {r.disputed ? tr('You told us this one is wrong — we are on it')
                : r.client_says ? tr('He says he came — open dispute') : tr('This one is wrong')}
            </T>
            <Ico name="chevron-right" size={14} color={D.amber} />
          </Pressable>
        </Card>
      ))}

      {!!back?.length && (
        <>
          <Eyebrow ls={1.4}>{tr('HANDED BACK · THE CLIENT GETS IT')}</Eyebrow>
          {back.map((r) => (
            <Card key={`${r.booking}-${r.at}`} style={st.awk}>
              <View style={st.row}>
                <View style={[st.avatar, { backgroundColor: 'rgba(248,113,113,0.14)' }]}><T w="b" size={10} c={D.red}>{initials(r.name)}</T></View>
                <View style={st.grow}>
                  <T w="b" size={12.5}>{r.name}</T>
                  <T size={10.5} c={D.sub} style={st.mt2}>{`${when(r.at)} · ${r.ref}`}</T>
                </View>
                <T w="b" size={13} c={D.red} style={st.num}>{`− ${dh(r.cents)}`}</T>
              </View>
              <T size={11} c={D.sub} style={[st.lh, st.whyLine]}>
                {tr('It came off this column — not out of your pocket, and not out of the float.')}
              </T>
            </Card>
          ))}
        </>
      )}

      {total > 0 && (
        <View style={st.netBox}>
          <T w="b" size={11.5}>{tr('Net effect on your column')}</T>
          <T size={11} c={D.sub} style={st.lh}>
            {trn(total, '{kept} kept, {returned} returned — {net} across the booking nobody sat down for.',
              '{kept} kept, {returned} returned — {net} across the {n} bookings nobody sat down for.',
              { kept: dh(n.kept), returned: dh(n.returned), net: `${n.net < 0 ? '−' : '+'}${dh(n.net)}` })}
          </T>
        </View>
      )}
      <T size={10.5} c={D.faint} style={st.foot}>
        {tr("A deposit is only kept after the slot has passed and you haven't marked him done.")}
      </T>
    </Screen>
  );
}

// ---- the pending block, on its own ---------------------------------------------
function PendingView({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    supabase.rpc('my_account_lines', { p_kind: 'pending' }).then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);
  return (
    <Screen bottom={TAB_INSET} gap={11}>
      <TopBar title={tr('Not yours yet')} onBack={onBack} plain />
      <T size={12} c={D.sub} style={st.lh}>
        {tr("A deposit on a cut that hasn't happened is the client's money. It is in no total on this page until you mark the chair done.")}
      </T>
      {(rows ?? []).map((r) => (
        <View key={r.booking} style={[st.line, st.lineDim]}>
          <View style={st.grow}>
            <T w="sb" size={12.5} c={D.sub}>{r.name}</T>
            <T size={10.5} c={D.faint} style={st.mt2}>{[r.service, when(r.starts_at)].filter(Boolean).join(' · ')}</T>
          </View>
          <T w="b" size={12.5} c={D.sub} style={st.num}>{dh(r.cents)}</T>
        </View>
      ))}
    </Screen>
  );
}

// ---- BAC-05 · "that one's wrong" --------------------------------------------------
// There is no dispute state in the product: sending opens a support case with the
// barber's answer on it, and the screen says only what that does. The line stays in
// the column and the collection is not delayed.
function DisputeSheet({ row, picking, onPick, onClose, onSent }: {
  row: Row | null; picking: boolean; onPick: (r: Row) => void; onClose: () => void; onSent: () => void;
}) {
  const [answer, setAnswer] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Row[]>([]);
  useEffect(() => { setAnswer(0); }, [row?.booking]);
  useEffect(() => {
    if (!picking) return;
    Promise.all(['wallet_cuts', 'deposits', 'no_shows'].map((k) => supabase.rpc('my_account_lines', { p_kind: k })))
      .then((res) => setLines(res.flatMap((r) => (r.data as Row[]) ?? [])));
  }, [picking]);

  const noShow = row?.kind === 'no_show' || row?.kind === 'late_cancel';
  const answers = !row ? [] : noShow ? [
    [tr('He never came — keep the {amount}', { amount: dh(row.cents) }), tr("We'll tell him, and it stays yours")],
    [tr("He's right — give it back"), tr('Comes off your column, not your pocket')],
    [tr("I don't remember"), tr("We decide it — and we'll lean his way")],
  ] : [
    [tr('The cut happened — keep the {amount}', { amount: dh(row.cents) }), tr('Nothing changes')],
    [tr('It should go back to the client'), tr('Comes off your column, not your pocket')],
    [tr("I don't remember"), tr("We decide it — and we'll lean his way")],
  ];

  async function send() {
    if (!row) return;
    setBusy(true);
    const detail = `Barber says a line on his account is wrong: ${row.ref}, ${row.kind}, ${Math.round(row.cents / 100)} DH. `
      + `Answer: ${['keep it', 'give it back', 'does not remember'][answer]}.`;
    const { error } = await supabase.rpc('file_support_case', { p_booking: row.booking, p_reason: 'money', p_detail: detail });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not send that'), error.message);
    Alert.alert(tr('Sent'), tr('One of us reads it today. You’ll get an answer before the next collection.'));
    onSent();
  }

  return (
    <Sheet visible={!!row || picking} onClose={onClose} deep>
      <SheetHead title={row ? tr('This line is wrong') : tr('Which line?')} onClose={onClose} left />
      {!row && lines.map((r) => (
        <Card key={r.booking} style={st.line} onPress={() => onPick(r)}>
          <View style={st.grow}>
            <T w="b" size={12.5}>{r.name}</T>
            <T size={10.5} c={D.sub} style={st.mt2}>{`${when(r.starts_at)} · ${r.kind === 'wallet_cut' ? tr('paid from wallet') : r.kind === 'deposit' ? tr('deposit') : tr('no-show')}`}</T>
          </View>
          <T w="b" size={13} style={st.num}>{dh(r.cents)}</T>
        </Card>
      ))}
      {!row && !lines.length && <T size={11.5} c={D.faint}>{tr('Nothing on your column to question.')}</T>}
      {row && (
        <>
          <Card style={st.sum}>
            <View style={st.row}>
              <View style={[st.avatar, { backgroundColor: 'rgba(232,161,0,0.14)' }]}><Ico name="frown" size={16} color={D.amber} /></View>
              <View style={st.grow}>
                <T w="b" size={13}>{`${row.name} — ${noShow ? tr('no-show') : tr('deposit')}`}</T>
                <T size={11} c={D.sub} style={st.mt2}>{`${when(row.starts_at)} · ${noShow ? tr('deposit kept') : tr('done')}`}</T>
              </View>
              <T w="eb" size={14} style={st.num}>{dh(row.cents)}</T>
            </View>
            {row.client_says && (
              <T size={11.5} c={D.sub} style={[st.lh, st.whyLine]}>
                {tr('He wrote to us: "{text}". One of you is right — tell us which.', { text: row.client_says })}
              </T>
            )}
          </Card>
          <Eyebrow ls={1.4}>{tr('WHAT ACTUALLY HAPPENED')}</Eyebrow>
          {answers.map(([t1, t2], k) => (
            <RadioRow key={k} label={`${t1}\n${t2}`} on={answer === k} onPress={() => setAnswer(k)} />
          ))}
          <View style={st.safe}>
            <Ico name="shield" size={14} color={D.green} />
            <T size={11.5} c={D.sub} style={[st.grow, st.lh]}>
              {tr("Nothing moves while it's open, and a dispute never delays a collection. Settle up with the {amount} still in the column.", { amount: dh(row.cents) })}
            </T>
          </View>
          <Btn title={tr('SEND IT TO US')} onPress={busy ? undefined : send} />
          <T size={11} c={D.faint} style={st.foot}>{tr('This opens a case with our support team — that is all it does.')}</T>
        </>
      )}
    </Sheet>
  );
}

const st = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mt2: { marginTop: 2 },
  lh: { lineHeight: 17 },
  num: { fontVariant: ['tabular-nums'] },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  foot: { textAlign: 'center', lineHeight: 16 },
  hero: { backgroundColor: '#1D1416', borderWidth: 1, borderColor: '#332124', borderRadius: 22, padding: 18, gap: 11 },
  heroOwed: { backgroundColor: '#13201A', borderColor: '#1F3A2C' },
  heroSquare: { backgroundColor: D.card, borderColor: D.border },
  heroWhy: { borderTopWidth: 1, borderTopColor: '#332124', paddingTop: 12 },
  heroWhyOwed: { borderTopColor: '#1F3A2C' },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, minWidth: 0, backgroundColor: D.card, borderRadius: 18, padding: 14, gap: 6 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 18 },
  navIcon: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  who: { padding: 16, gap: 12, borderRadius: 20 },
  avatar: { width: 32, height: 32, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center' },
  avatarWarm: { backgroundColor: 'rgba(232,68,46,0.16)' },
  whyLine: { borderTopWidth: 1, borderTopColor: D.border, paddingTop: 11 },
  amber: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(232,161,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.22)', borderRadius: 16, padding: 12 },
  sum: { padding: 16, gap: 10, borderRadius: 20 },
  sumRow: { flexDirection: 'row', alignItems: 'flex-end' },
  dayBlock: { gap: 8 },
  cat: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 16 },
  ruleDim: { height: 1, backgroundColor: D.border },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#101010', borderWidth: 1,
    borderColor: D.border, borderRadius: 16, padding: 12 },
  capWrap: { gap: 7 },
  capTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  capFill: { height: '100%' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card, borderRadius: 16, padding: 12 },
  lineDim: { backgroundColor: '#101010', borderWidth: 1, borderColor: D.border },
  right: { alignItems: 'flex-end' },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#101010', borderWidth: 1,
    borderColor: D.border, borderRadius: 16, padding: 12 },
  codeCard: { backgroundColor: '#101010', borderWidth: 1, borderColor: D.border, borderRadius: 20, padding: 17,
    gap: 11, alignItems: 'center' },
  awk: { padding: 14, gap: 10, borderRadius: 18 },
  disputeLink: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: D.border, paddingTop: 10 },
  netBox: { backgroundColor: '#101010', borderWidth: 1, borderColor: D.border, borderRadius: 16, padding: 13, gap: 4 },
  safe: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: D.card2, borderRadius: 14, padding: 12 },
});
