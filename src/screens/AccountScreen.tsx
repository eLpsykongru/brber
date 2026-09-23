import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Btn, Card, Eyebrow, Ico, type IconName, RadioRow, Screen, Serif, Sheet, SheetHead, T, TAB_INSET, TopBar } from '../components/dark';
import { awkwardNet, dh, netWay } from '../lib/billing';
import { loc, tr, trn } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// "Barber - Account.dc.html" BAC-01 … BAC-10, over 0125 and 0127.
//
// The one thing this screen is for: a barber can answer "what do I owe you, and
// what do you owe me", and walk both numbers back to the names of the men who sat
// in his chair. So every total here opens its rows, and every row is a booking.
//
// BAC-09 is the flip — the shop owes him, and the shop's cash agent pays him out
// of the drawer. He reads out four digits once the cash is in his hand, and that
// is the only thing that records a payout. BAC-10 is the other hat: the agent's
// own screen, where each colleague is a name, a chair and a figure and nothing
// else, and where his own share is a row he taps like any other.
//
// What is NOT here, on purpose:
//   · cash taken in the chair — it never left his pocket and is never counted.
//     BAC-07 prints it beside a deposit as what the chair was due, never in a sum.
//   · anything about the shop's subscription for a barber who is not the owner.

type Account = {
  me: string; salon: string | null; till: boolean; is_owner: boolean; since: string | null;
  last_visit: { agent: string; at: string } | null;
  ours: { cents: number; count: number };
  mine: { cents: number; wallet_cuts: Bucket; deposits: Bucket; no_shows: Bucket; refunds: Bucket };
  pending: Bucket;
  colleagues: { cents: number; barbers: number };
  bill_cents: number;
  net_cents: number;
  due: { cents: number; paid_cents: number; bill_cents: number; carried_cents: number };
  cap: { cap_cents: number; net_cents: number; room_cents: number } | null;
  agent: { name: string; is_me: boolean } | null;
  handover: Handover | null;
  old_shops?: OldShop[];
  shortfalls?: Shortfall[];
};
// BAC-11: a shop he has left that still owes him — keyed on (him, that shop), forever
type OldShop = {
  salon_id: string; salon: string; cents: number; wallet_cuts: number; deposits: number;
  left_at: string | null; agent: { name: string; phone: string | null; area: string | null; is_me: boolean };
};
// §10: a handover that came up short while he held the drawer — owed to Sterncut, not the shop
type Shortfall = { id: string; salon: string; cents: number; at: string; ref: string; handover_at: string; agent: string };
type Handover = {
  id: string; ref: string; state: 'pending' | 'mismatch'; role: 'incoming' | 'outgoing';
  from_name: string; to_name: string; drawer_cents: number;
  declared_cents: number | null; counted_cents: number | null;
  dues: { name: string; cents: number; is_me: boolean }[]; at: string;
};
type Drawer = {
  salon: string | null; me: string; drawer_cents: number; sterncut_cents: number; to_pay_cents: number;
  my_due_cents: number; chairs: Chair[]; transfer: { ref: string; state: string; to_name: string } | null;
  shortfalls?: OwedBack[];
};
type Chair = {
  barber: string; name: string; chair: string | null; due_cents: number;
  last_paid: { cents: number; at: string } | null;
  left_at?: string | null; wallet_cuts?: number; deposits?: number;
};
type OwedBack = { id: string; name: string; cents: number; at: string; ref: string };
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

type View_ = 'home' | 'his' | 'ours' | 'settle' | 'wallet' | 'deposits' | 'awkward' | 'pending'
  | 'drawer' | 'takeover' | 'old';

export default function AccountScreen({ onBack, onStatement }: { onBack?: () => void; onStatement?: () => void }) {
  const [a, setA] = useState<Account | null>(null);
  const [view, setView] = useState<View_>('home');
  const [tick, setTick] = useState(0);
  const [dispute, setDispute] = useState<Row | null>(null);
  const [picking, setPicking] = useState(false);
  const [oldShop, setOldShop] = useState<OldShop | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_account');
    if (error) return Alert.alert(tr('Could not load your account'), error.message);
    setA(data as Account);
  }, []);
  useEffect(() => { load(); }, [load, tick]);

  if (!a) return <Screen bottom={TAB_INSET}><TopBar title={tr('You & Sterncut')} onBack={onBack} plain /></Screen>;
  if (!a.salon) {
    // BAC-11: no shop, still owed — leaving ended his membership, never his balance
    if (a.old_shops?.length || a.shortfalls?.length) {
      return <LeaverView a={a} onBack={onBack} onChanged={() => setTick((n) => n + 1)} />;
    }
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
  } else if (view === 'drawer' && a.till) {
    body = <DrawerView onBack={home} onPaid={() => setTick((n) => n + 1)} />;
  } else if (view === 'old' && oldShop) {
    body = (
      <Screen bottom={TAB_INSET} gap={12}>
        <TopBar title={oldShop.salon} onBack={home} plain />
        <OwedByShop shop={oldShop} onReported={() => setTick((n) => n + 1)} />
      </Screen>
    );
  } else if (view === 'takeover' && a.handover?.role === 'incoming' && a.handover.state === 'pending') {
    body = <TakeoverView h={a.handover} onBack={home} onDone={() => { setView('home'); setTick((n) => n + 1); }} />;
  } else {
    body = <HomeView a={a} go={setView} onBack={onBack} onOldShop={(o) => { setOldShop(o); setView('old'); }} />;
  }
  return <>{body}{sheet}</>;
}

// ---- BAC-01 · one number, both directions --------------------------------------
function HomeView({ a, go, onBack, onOldShop }: {
  a: Account; go: (v: View_) => void; onBack?: () => void; onOldShop: (o: OldShop) => void;
}) {
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

      {a.handover && <HandoverCard h={a.handover} go={go} />}

      <Nav icon="arrow-up" tint={D.green} title={tr('What we hold for you')} sub={tr('Every cut and deposit, line by line')} onPress={() => go('his')} />
      {a.till && (
        <>
          <Nav icon="arrow-down" tint={D.accent} title={tr('What you hold for us')} sub={tr('The float — and how close to the cap')} onPress={() => go('ours')} />
          <Nav icon="users" tint={D.accent} title={tr("The shop's cash")} sub={tr('The drawer, and what each chair is owed')} onPress={() => go('drawer')} />
        </>
      )}

      {!a.till && a.agent && <PayeeCard a={a} />}

      {(a.shortfalls ?? []).map((sf) => <ShortfallCard key={sf.id} sf={sf} />)}

      {/* "If he later joins another shop … this card moves into it as a separate row. It never merges." */}
      {(a.old_shops ?? []).map((o) => (
        <Card key={o.salon_id} style={st.nav} onPress={() => onOldShop(o)}>
          <View style={[st.navIcon, { backgroundColor: 'rgba(74,222,128,0.14)' }]}><Ico name="clock" size={15} color={D.green} /></View>
          <View style={st.grow}>
            <T w="b" size={12.5}>{tr('{salon} still owes you', { salon: o.salon })}</T>
            <T size={11} c={D.sub} style={st.mt2}>{tr('A shop you left · this does not expire')}</T>
          </View>
          <T w="b" size={13} c={D.green} style={st.num}>{dh(o.cents)}</T>
          <Ico name="chevron-right" size={16} color={D.sub} />
        </Card>
      ))}

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

// ---- BAC-09 · who pays him, and the four digits that prove he was paid -----------
function PayeeCard({ a }: { a: Account }) {
  const [code, setCode] = useState<string | null>(null);
  const due = a.due.cents;
  useEffect(() => {
    if (due <= 0) return;
    supabase.rpc('my_payout_code').then(({ data }) => setCode((data as { code: string | null } | null)?.code ?? null));
  }, [due]);
  const agent = a.agent;
  if (!agent) return null;
  const parts = [
    a.mine.cents !== 0 ? [since(a), a.mine.cents] as const : null,
    a.due.carried_cents !== 0 ? [tr('From earlier weeks, still unpaid'), a.due.carried_cents] as const : null,
    a.due.paid_cents !== 0 ? [tr('Paid to you in the shop'), -a.due.paid_cents] as const : null,
    a.is_owner && a.due.bill_cents !== 0 ? [tr("The shop's subscription, netted on Friday"), -a.due.bill_cents] as const : null,
  ].filter(Boolean) as (readonly [string, number])[];

  return (
    <Card style={st.who}>
      <Eyebrow ls={1.4}>{tr('WHO PAYS YOU')}</Eyebrow>
      <View style={st.row}>
        <View style={[st.avatar, st.avatarWarm]}><T w="b" size={11} c={D.accent}>{initials(agent.name)}</T></View>
        <View style={st.grow}>
          <T w="b" size={13}>{agent.name}</T>
          <T size={11} c={D.sub} style={st.mt2}>{tr("The shop's cash agent")}</T>
        </View>
      </View>
      <T size={11.5} c={D.sub} style={[st.lh, st.whyLine]}>
        {tr("He pays you out of the shop's cash — the deposits Sterncut settles with the shop on Friday. It isn't his money and it isn't a favour.")}
      </T>

      {parts.length > 1 && (
        <View style={st.whyLine}>
          {parts.map(([label, cents]) => (
            <Row2 key={label} label={label} value={`${cents < 0 ? '− ' : ''}${dh(cents)}`} color={cents < 0 ? D.red : undefined} />
          ))}
        </View>
      )}

      {due > 0 && !!code && (
        <View style={st.codeInner}>
          <Eyebrow ls={1.5}>{tr('GIVE HIM THIS CODE')}</Eyebrow>
          <Serif size={34} ls={0.22}>{code.split('').join(' ')}</Serif>
          <T size={11} c={D.faint} style={[st.lh, st.center]}>
            {tr('Only say it once he has counted {amount} into your hand. The code is what proves he paid.', { amount: dh(due) })}
          </T>
        </View>
      )}
      {due > 0 && (
        <T size={11} c={D.faint} style={st.lh}>
          {tr("If the drawer is short today he can pay part of it. The rest stays on your column — it doesn't disappear and nobody renegotiates it.")}
        </T>
      )}
      {due < 0 && (
        <T size={11.5} c={D.amber} style={st.lh}>
          {tr('You owe the drawer {amount}. Hand it to {agent} and he records it.', { amount: dh(due), agent: agent.name.split(' ')[0] })}
        </T>
      )}
    </Card>
  );
}

// ---- OBR-08/09 from the two men's side ---------------------------------------------
function HandoverCard({ h, go }: { h: Handover; go: (v: View_) => void }) {
  const incoming = h.role === 'incoming';
  if (h.state === 'mismatch') {
    return (
      <View style={st.amber}>
        <Ico name="alert-triangle" size={15} color={D.amber} />
        <View style={st.grow}>
          <T w="b" size={12.5}>{tr('The two counts did not match')}</T>
          <T size={11.5} c={D.sub} style={[st.lh, st.mt2]}>
            {tr('{from} handed over {declared} by our books; {to} counted {counted}. Sterncut will call you both. Until then {from} still holds the drawer and still pays the chairs — nobody\'s pay waits on this.',
              { from: h.from_name.split(' ')[0], to: h.to_name.split(' ')[0],
                declared: dh(h.declared_cents ?? 0), counted: dh(h.counted_cents ?? 0) })}
          </T>
        </View>
      </View>
    );
  }
  if (!incoming) {
    return (
      <View style={st.amber}>
        <Ico name="package" size={15} color={D.amber} />
        <View style={st.grow}>
          <T w="b" size={12.5}>{tr('You are handing the drawer to {name}', { name: h.to_name.split(' ')[0] })}</T>
          <T size={11.5} c={D.sub} style={[st.lh, st.mt2]}>
            {tr('Count {amount} into his hands. He confirms it on his own phone — until he does, you still hold it and you still pay the chairs.',
              { amount: dh(h.drawer_cents) })}
          </T>
        </View>
      </View>
    );
  }
  return (
    <Card style={st.who} onPress={() => go('takeover')}>
      <View style={st.row}>
        <View style={[st.avatar, st.avatarWarm]}><Ico name="package" size={15} color={D.accent} /></View>
        <View style={st.grow}>
          <T w="b" size={13}>{tr('You are taking the drawer')}</T>
          <T size={11} c={D.sub} style={st.mt2}>
            {tr('{name} says he is counting {amount} into your hands', { name: h.from_name.split(' ')[0], amount: dh(h.drawer_cents) })}
          </T>
        </View>
        <Ico name="chevron-right" size={16} color={D.sub} />
      </View>
    </Card>
  );
}

// ---- BAC-10 · the agent's other hat ---------------------------------------------------
function DrawerView({ onBack, onPaid }: { onBack: () => void; onPaid: () => void }) {
  const [d, setD] = useState<Drawer | null>(null);
  const [pay, setPay] = useState<Chair | null>(null);
  const load = useCallback(() => {
    supabase.rpc('my_drawer').then(({ data }) => setD(data as Drawer));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <Screen bottom={TAB_INSET}><TopBar title={tr("The shop's cash")} onBack={onBack} plain /></Screen>;
  const owed = d.chairs.filter((c) => c.due_cents > 0);
  // he hands the shortfall back into the drawer; the man holding it records it
  const takeBack = (sf: OwedBack) => Alert.alert(
    tr('Take {amount} from {name}?', { amount: dh(sf.cents), name: sf.name.split(' ')[0] }),
    tr("Only once the cash is in your hand. It goes into the drawer and on to Sterncut with Friday's collection, and he is told he is square."),
    [{ text: tr('Not now'), style: 'cancel' },
      { text: tr('I have taken it'), onPress: async () => {
        const { error } = await supabase.rpc('agent_take_shortfall', { p_shortfall: sf.id });
        if (error) return Alert.alert(tr('Could not record it'), error.message);
        load(); onPaid();
      } }]);
  const owing = d.chairs.filter((c) => c.due_cents < 0);
  const paid = d.chairs.filter((c) => c.due_cents === 0 && c.last_paid);
  return (
    <>
      <Screen bottom={TAB_INSET} gap={12}>
        <TopBar title={tr("The shop's cash")} onBack={onBack} plain />
        <T size={12} c={D.sub} style={st.lh}>{tr('You hold it · you are the agent')}</T>

        <View style={st.tiles}>
          <View style={st.tile}>
            <Eyebrow ls={1.2}>{tr('IN THE DRAWER')}</Eyebrow>
            <T w="eb" size={21} style={st.num}>{dh(d.drawer_cents)}</T>
            <T size={10.5} c={D.faint}>
              {d.sterncut_cents >= 0
                ? tr('{amount} of it goes to Sterncut on Friday', { amount: dh(d.sterncut_cents) })
                : tr('Sterncut brings the shop {amount} on Friday', { amount: dh(d.sterncut_cents) })}
            </T>
          </View>
          <View style={st.tile}>
            <Eyebrow ls={1.2}>{tr('TO PAY OUT')}</Eyebrow>
            <T w="eb" size={21} c={D.green} style={st.num}>{dh(d.to_pay_cents)}</T>
            <T size={10.5} c={D.faint}>{trn(owed.length, 'to one chair', 'to {n} chairs')}</T>
          </View>
        </View>

        {!!owed.length && <Eyebrow ls={1.4}>{tr('WHO YOU OWE, IN THE SHOP')}</Eyebrow>}
        {owed.map((c) => (
          <Card key={c.barber} style={st.line} onPress={() => setPay(c)}>
            <View style={st.avatar}><T w="b" size={10} c={D.sub}>{initials(c.name)}</T></View>
            <View style={st.grow}>
              <T w="b" size={12.5}>{c.name}</T>
              <ChairLine c={c} />
            </View>
            <T w="b" size={13} c={D.green} style={st.num}>{dh(c.due_cents)}</T>
            <Ico name="chevron-right" size={15} color={D.muted} />
          </Card>
        ))}

        {owing.map((c) => (
          <Card key={c.barber} style={st.line} onPress={() => setPay(c)}>
            <View style={[st.avatar, { backgroundColor: 'rgba(232,161,0,0.14)' }]}><T w="b" size={10} c={D.amber}>{initials(c.name)}</T></View>
            <View style={st.grow}>
              <T w="b" size={12.5}>{c.name}</T>
              <T size={10.5} c={D.amber} style={st.mt2}>{tr('owes the drawer')}</T>
            </View>
            <T w="b" size={13} c={D.amber} style={st.num}>{dh(c.due_cents)}</T>
            <Ico name="chevron-right" size={15} color={D.muted} />
          </Card>
        ))}

        {!!d.shortfalls?.length && <Eyebrow ls={1.4}>{tr('OWED BACK TO THE DRAWER')}</Eyebrow>}
        {(d.shortfalls ?? []).map((sf) => (
          <Card key={sf.id} style={st.line} onPress={() => takeBack(sf)}>
            <View style={[st.avatar, { backgroundColor: 'rgba(232,161,0,0.14)' }]}><T w="b" size={10} c={D.amber}>{initials(sf.name)}</T></View>
            <View style={st.grow}>
              <T w="b" size={12.5}>{sf.name}</T>
              <T size={10.5} c={D.amber} style={st.mt2}>{tr('Handover {ref} came up short · owed to Sterncut', { ref: sf.ref })}</T>
            </View>
            <T w="b" size={13} c={D.amber} style={st.num}>{dh(sf.cents)}</T>
            <Ico name="chevron-right" size={15} color={D.muted} />
          </Card>
        ))}

        {paid.map((c) => (
          <View key={c.barber} style={[st.line, st.lineDim]}>
            <View style={st.grow}>
              <T w="sb" size={12.5} c={D.sub}>{c.name}</T>
              <T size={10.5} c={D.faint} style={st.mt2}>
                {tr('Paid {amount} · {when}', { amount: dh(c.last_paid?.cents ?? 0), when: when(c.last_paid?.at ?? '') })}
              </T>
            </View>
            <Ico name="check" size={14} color={D.green} />
          </View>
        ))}

        <View style={st.ruleDim} />
        <Card style={st.line} onPress={d.my_due_cents > 0 ? () => setPay({ barber: d.me, name: tr('My own account'), chair: null, due_cents: d.my_due_cents, last_paid: null }) : undefined}>
          <View style={[st.avatar, st.avatarWarm]}><Ico name="user" size={14} color={D.accent} /></View>
          <View style={st.grow}>
            <T w="b" size={12.5}>{tr('My own account')}</T>
            <T size={10.5} c={D.sub} style={st.mt2}>
              {d.my_due_cents > 0 ? tr('Kept separate — take it out of the drawer') : tr('Kept separate — nothing owed to you today')}
            </T>
          </View>
          <T w="b" size={13} c={d.my_due_cents > 0 ? D.green : D.sub} style={st.num}>{dh(d.my_due_cents)}</T>
        </Card>

        <T size={10.5} c={D.faint} style={st.foot}>
          {tr('You see what each man is owed. You never see his clients, his prices or his takings.')}
        </T>
      </Screen>
      <PaySheet chair={pay} self={pay?.barber === d.me} onClose={() => setPay(null)}
        onDone={() => { setPay(null); load(); onPaid(); }} me={d.me} />
    </>
  );
}

// the payout itself: his figure, his code, and no way to edit either
function PaySheet({ chair, self, me, onClose, onDone }: {
  chair: Chair | null; self: boolean; me: string; onClose: () => void; onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const idem = useRef(`pay-${Date.now()}`);
  const owing = (chair?.due_cents ?? 0) < 0;
  useEffect(() => {
    if (!chair) return;
    setAmount(String(Math.round(Math.abs(chair.due_cents) / 100)));
    setCode('');
    setErr(null);
    idem.current = `pay-${chair.barber}-${Date.now()}`;
  }, [chair?.barber]);
  if (!chair) return null;
  const cents = Math.round(Number(amount.replace(',', '.')) * 100) || 0;
  const ready = cents > 0 && cents <= Math.abs(chair.due_cents) && (owing || self || code.length === 4);

  async function send() {
    setBusy(true);
    setErr(null);
    const { data, error } = owing
      ? await supabase.rpc('agent_receive', { p_barber: chair!.barber, p_cents: cents })
      : await supabase.rpc('agent_pay', {
        p_barber: self ? me : chair!.barber, p_cents: cents,
        p_code: self ? null : code, p_idem: idem.current,
      });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as { ok: boolean; reason?: string; left?: number };
    if (!r?.ok) {
      return setErr(r?.reason === 'code'
        ? trn(r.left ?? 0, 'Those four digits are wrong. One more try before the code stops working.',
          'Those four digits are wrong. {n} tries left before the code stops working.')
        : r?.reason === 'spent' ? tr('That code has been typed wrong too many times. Ask him to open his account for a new one.')
          : tr('He has no live code. Ask him to open "You & Sterncut" on his phone.'));
    }
    onDone();
  }

  return (
    <Sheet visible={!!chair} onClose={onClose} deep>
      <SheetHead title={owing ? tr('He puts cash in') : self ? tr('Take your own share') : tr('Pay {name}', { name: chair.name.split(' ')[0] })} onClose={onClose} left />
      <Card style={st.sum}>
        <Eyebrow ls={1.4}>{owing ? tr('HE OWES THE DRAWER') : tr('THE SHOP OWES HIM')}</Eyebrow>
        <Serif size={30} ls={0} c={owing ? D.amber : D.green} style={st.num}>{dh(chair.due_cents)}</Serif>
        <T size={11.5} c={D.sub} style={st.lh}>
          {owing ? tr('Count it into the drawer and record it here. He is told what you recorded.')
            : self ? tr('Your own money out of the drawer. The figure is not yours to change either.')
              : tr("You can't change the figure. If you're short, pay part and it stays on his column.")}
        </T>
      </Card>

      <Eyebrow ls={1.4}>{tr('HOW MUCH, IN DIRHAMS')}</Eyebrow>
      <TextInput value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.,]/g, ''))}
        keyboardType="number-pad" style={st.input} placeholderTextColor={D.muted} />

      {!owing && !self && (
        <>
          <Eyebrow ls={1.4}>{tr('HIS CODE')}</Eyebrow>
          <CodeBoxes code={code} onChange={setCode} />
          <T size={11} c={D.faint} style={st.lh}>
            {chair.left_at
              ? tr("He comes in to collect. Same code, same drawer. His row stays until it's paid.")
              : tr('He reads it out once the cash is in his hand. You cannot record a payment without it.')}
          </T>
        </>
      )}

      {!!err && <T size={11.5} c={D.red} style={st.lh}>{err}</T>}
      <Btn title={owing ? tr('I HAVE TAKEN {amount}', { amount: dh(cents) })
        : tr("I'VE PAID HIM {amount}", { amount: dh(cents) })}
        onPress={ready && !busy ? send : undefined} bg={ready && !busy ? D.accent : D.card2} />
    </Sheet>
  );
}

// BAC-10b: a man who has left keeps his row — the chair is replaced by the day he left
function ChairLine({ c }: { c: Chair }) {
  const counts = [
    c.wallet_cuts ? trn(c.wallet_cuts, '{n} wallet cut', '{n} wallet cuts') : null,
    c.deposits ? trn(c.deposits, '{n} deposit', '{n} deposits') : null,
  ].filter(Boolean).join(', ');
  if (c.left_at) {
    return (
      <View style={[st.row, st.mt2, { gap: 6 }]}>
        <View style={st.leftPill}><T w="b" size={9.5} c={D.amber} ls={0.6}>{tr('LEFT · {date}', { date: dayMonth(c.left_at) }).toUpperCase()}</T></View>
        {!!counts && <T size={10.5} c={D.sub}>{counts}</T>}
      </View>
    );
  }
  const line = [c.chair, counts].filter(Boolean).join(' · ');
  return line ? <T size={10.5} c={D.sub} style={st.mt2}>{line}</T> : null;
}

function CodeBoxes({ code, onChange }: { code: string; onChange: (v: string) => void }) {
  const input = useRef<TextInput>(null);
  return (
    <Pressable style={st.boxRow} onPress={() => input.current?.focus()}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[st.box, i === code.length && st.boxOn]}>
          <Serif size={22}>{code[i] ?? ''}</Serif>
        </View>
      ))}
      <TextInput ref={input} value={code} style={st.hidden} keyboardType="number-pad" maxLength={4}
        onChangeText={(v) => onChange(v.replace(/\D/g, ''))} />
    </Pressable>
  );
}

// ---- OBR-09 · counting it in, on his own phone ---------------------------------------
function TakeoverView({ h, onBack, onDone }: { h: Handover; onBack: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cents = Math.round(Number(amount.replace(',', '.')) * 100) || 0;

  async function confirm() {
    setBusy(true);
    setErr(null);
    const { data, error } = await supabase.rpc('confirm_drawer_transfer', {
      p_transfer: h.id, p_counted: cents, p_expected: h.drawer_cents,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const r = data as { state: string; declared_cents?: number };
    if (r.state === 'mismatch') {
      Alert.alert(tr('That is not the same number'),
        tr('You counted {counted}; the books say {declared}. Neither of you takes the drawer until Sterncut has spoken to you both. Nobody\'s pay waits on it.',
          { counted: dh(cents), declared: dh(r.declared_cents ?? h.drawer_cents) }));
    }
    onDone();
  }

  async function notNow() {
    const { error } = await supabase.rpc('cancel_drawer_transfer');
    if (error) return Alert.alert(tr('Could not do that'), error.message);
    onDone();
  }

  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr("You're taking the drawer")} onBack={onBack} plain />
      <T size={12.5} c={D.sub} style={st.lh}>
        {tr('{name} says he is counting {amount} into your hands. Count it yourself before you confirm.',
          { name: h.from_name, amount: dh(h.drawer_cents) })}
      </T>

      <Card style={st.sum}>
        <Row2 label={tr('Cash you are taking on')} value={dh(h.drawer_cents)} />
        {h.dues.map((d) => (
          <Row2 key={d.name} color={D.green}
            label={d.is_me ? tr('Owed to you — pay yourself') : tr('Owed to {name} — now yours to pay', { name: d.name.split(' ')[0] })}
            value={dh(d.cents)} />
        ))}
        <T size={11} c={D.faint} style={[st.lh, st.whyLine]}>
          {tr("From the moment you confirm, this is on you until the collection agent comes. Don't confirm a number you haven't counted.")}
        </T>
      </Card>

      <Eyebrow ls={1.4}>{tr('TYPE WHAT YOU COUNTED')}</Eyebrow>
      <TextInput value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.,]/g, ''))}
        keyboardType="number-pad" placeholder="0" placeholderTextColor={D.muted} style={st.input} />
      {!!err && <T size={11.5} c={D.red} style={st.lh}>{err}</T>}
      <Btn title={tr("I'VE COUNTED IT · I'M THE AGENT NOW")} bg={amount && !busy ? D.accent : D.card2}
        onPress={amount && !busy ? confirm : undefined} />
      <Pressable onPress={notNow} hitSlop={8}><T size={11.5} c={D.sub} style={st.center}>{tr('Not now')}</T></Pressable>
      <T size={10.5} c={D.faint} style={st.foot}>
        {tr('A different number tells Sterncut instead, and neither of you is the agent until it is sorted out.')}
      </T>
    </Screen>
  );
}

// ---- BAC-11 · no shop, still owed ----------------------------------------------------
function LeaverView({ a, onBack, onChanged }: { a: Account; onBack?: () => void; onChanged: () => void }) {
  return (
    <Screen bottom={TAB_INSET} gap={12}>
      <TopBar title={tr('You & Sterncut')} onBack={onBack} plain />
      <Eyebrow ls={1.8}>{tr('{name} · NO SHOP', { name: a.me.split(' ')[0] }).toUpperCase()}</Eyebrow>
      {(a.shortfalls ?? []).map((sf) => <ShortfallCard key={sf.id} sf={sf} />)}
      {(a.old_shops ?? []).map((o) => <OwedByShop key={o.salon_id} shop={o} onReported={onChanged} />)}
    </Screen>
  );
}

function OwedByShop({ shop, onReported }: { shop: OldShop; onReported: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.rpc('my_payout_code', { p_salon: shop.salon_id })
      .then(({ data }) => setCode((data as { code: string | null } | null)?.code ?? null));
  }, [shop.salon_id, shop.cents]);
  const left = shop.left_at ? dayMonth(shop.left_at) : null;
  const why = shop.deposits > 0
    ? (left
      ? trn(shop.wallet_cuts + shop.deposits, 'One cut or deposit before you left on {date}. You earned it; leaving doesn\'t change that.',
        '{n} cuts and deposits before you left on {date}. You earned it; leaving doesn\'t change that.', { date: left })
      : trn(shop.wallet_cuts + shop.deposits, 'One cut or deposit. You earned it; leaving doesn\'t change that.',
        '{n} cuts and deposits. You earned it; leaving doesn\'t change that.'))
    : (left
      ? trn(shop.wallet_cuts, 'One cut paid from wallet before you left on {date}. You earned it; leaving doesn\'t change that.',
        '{n} cuts paid from wallet before you left on {date}. You earned it; leaving doesn\'t change that.', { date: left })
      : trn(shop.wallet_cuts, 'One cut paid from wallet. You earned it; leaving doesn\'t change that.',
        '{n} cuts paid from wallet. You earned it; leaving doesn\'t change that.'));

  async function tell() {
    setBusy(true);
    const { data, error } = await supabase.rpc('report_unpaid_leaver', { p_salon: shop.salon_id });
    setBusy(false);
    if (error) return Alert.alert(tr('Could not send that'), error.message);
    const r = data as { case_no: string; existing: boolean };
    Alert.alert(r.existing ? tr('Already with us') : tr('Sent'),
      r.existing
        ? tr('Case {ref} is open about this. One of us is on it — you will hear from us there.', { ref: r.case_no })
        : tr('Case {ref}. We will take it up with {salon}. Sterncut still does not pay you directly — the shop does.',
          { ref: r.case_no, salon: shop.salon }));
    onReported();
  }

  return (
    <>
      <View style={[st.hero, st.heroOwed]}>
        <Eyebrow c="#7FC79B" ls={1.5}>{tr('STILL OWED TO YOU')}</Eyebrow>
        <T w="b" size={15} style={st.lh}>{tr('{salon} still owes you', { salon: shop.salon })}</T>
        <Serif size={42} ls={0} c={D.green} style={st.num}>{dh(shop.cents)}</Serif>
        <T size={11.5} c={D.sub} style={[st.lh, st.heroWhy, st.heroWhyOwed]}>{why}</T>
      </View>

      <Card style={st.who}>
        <Eyebrow ls={1.4}>{tr('WHO TO ASK')}</Eyebrow>
        <View style={st.row}>
          <View style={st.avatar}><T w="b" size={11} c={D.sub}>{initials(shop.agent.name)}</T></View>
          <View style={st.grow}>
            <T w="b" size={13}>{shop.agent.name}</T>
            <T size={11} c={D.sub} style={st.mt2}>
              {[tr("Holds {salon}'s cash", { salon: shop.salon }), shop.agent.area].filter(Boolean).join(' · ')}
            </T>
          </View>
          {!!shop.agent.phone && (
            <Pressable onPress={() => Linking.openURL(`tel:${shop.agent.phone}`)} style={st.callBtn} accessibilityRole="button">
              <T w="b" size={11}>{tr('Call')}</T>
            </Pressable>
          )}
        </View>
        <T size={11.5} c={D.sub} style={[st.lh, st.whyLine]}>
          {tr('Go to the shop. He pays you from the drawer, in cash, like before.')}
        </T>
      </Card>

      {!!code && (
        <View style={st.codeCard}>
          <Eyebrow ls={1.5}>{tr('YOUR CODE')}</Eyebrow>
          <Serif size={36} ls={0.22}>{code.split('').join(' ')}</Serif>
          <T size={11} c={D.faint} style={[st.lh, st.center]}>
            {tr("Only say it once he's counted {amount} into your hand.", { amount: dh(shop.cents) })}
          </T>
        </View>
      )}

      <View style={st.row}>
        <Ico name="clock" size={15} color={D.green} />
        <T size={11.5} style={[st.grow, st.lh]}>
          {tr("This doesn't expire. It stays owed until you're paid — even if you join another shop.")}
        </T>
      </View>

      <Pressable onPress={busy ? undefined : tell} style={st.outlinePill} accessibilityRole="button">
        <T w="b" size={12} c={D.sub}>{tr("They won't pay — tell us")}</T>
      </Pressable>
    </>
  );
}

// §10: a shortfall is on the man who handed over — shown as an open line until
// he pays it back into the drawer or Sterncut writes it off
function ShortfallCard({ sf }: { sf: Shortfall }) {
  return (
    <View style={st.amber}>
      <Ico name="alert-circle" size={15} color={D.amber} />
      <View style={st.grow}>
        <T w="b" size={12.5}>
          {tr('You owe Sterncut {amount} from the drawer handover on {date}', { amount: dh(sf.cents), date: dayMonth(sf.handover_at) })}
        </T>
        <T size={11.5} c={D.sub} style={[st.lh, st.mt2]}>
          {tr('{ref} · {salon}. Hand it to {agent}, who holds the drawer — he records it. It stays here until then, or until Sterncut writes it off. Nobody takes it from your pay.',
            { ref: sf.ref, salon: sf.salon, agent: sf.agent })}
        </T>
      </View>
    </View>
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
  codeInner: { alignItems: 'center', gap: 8, backgroundColor: '#101010', borderWidth: 1, borderColor: D.border,
    borderRadius: 16, padding: 14 },
  input: { height: 52, borderRadius: 14, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    paddingHorizontal: 15, color: D.text, fontSize: 17, fontVariant: ['tabular-nums'] },
  boxRow: { flexDirection: 'row', gap: 9 },
  box: { flex: 1, height: 58, borderRadius: 14, backgroundColor: D.card, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center' },
  boxOn: { borderColor: D.accent },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  callBtn: { height: 30, borderRadius: 999, backgroundColor: D.card2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  outlinePill: { height: 48, borderRadius: 999, borderWidth: 1, borderColor: D.border, alignItems: 'center', justifyContent: 'center' },
  leftPill: { backgroundColor: 'rgba(232,161,0,0.14)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
});
