import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ico, Screen, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { dark as D } from '../theme';

// OSH-16 / OSH-17 of "Owner - Shop.dc.html" — the week, and which way it points.
//
// This is the SAME statement the ops console draws at FIN-16, off the same
// builder (`statement_json`). Neither surface assembles anything: if they ever
// disagree it is a rendering bug, because there is no second query to disagree
// through. That was the design's own test and it is worth keeping.
//
// §2.7 is the decision that shapes the file: **the owing direction is not a
// minus sign on the paid layout.** It is a different sentence, a different
// colour and a different action — nothing to receive and sign for, but an
// amount to have ready in the till before Friday evening. It also carries a
// sentence the paid screen does not need: *this is not a bill*. The money going
// back is our own float, which his barbers took over the counter as wallet
// top-ups. Getting that wrong turns a bookkeeping event into a fee he never
// agreed to.

const dh = (c: number) => Math.round(Math.abs(c) / 100).toLocaleString('en-US').replace(/,/g, ' ');

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// §7: times read `Fri 4 Sep 21:04`, and a coverage window reads
// `Fri 28 Aug 21:00 → Fri 4 Sep 21:00`.
const when = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const day = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

type Item = { label: string; ref: string; at: string; cents: number; kind?: string; source_week?: string };
type Stmt = {
  line: string; salon: string; week: string; ref: string;
  covers_from: string; covers_to: string; released_at: string | null;
  direction: 'collect' | 'pay_out' | 'nil';
  total_cents: number; hold_cents: number; earned_cents: number;
  carried_cents: number; subtotal_cents: number;
  visit: string; collected_cents: number | null; open_cents: number;
  settled_at: string | null; receipt_ref: string | null; agent: string | null;
  float_lines: Item[]; earned_lines: Item[]; carried_lines: Item[];
  oldest_at: string | null; age_days: number | null; hold_limit_days: number;
  last_week: { week: string; direction: string; total_cents: number } | null;
};
type Held = { reason: string; amount_cents: number | null; unlocks_on: string | null; told_by: string | null };
type Week = { week: string; covers_to: string; direction: string; total_cents: number };
type Payload = { salon: string | null; statement: Stmt | null; held: Held | null; weeks?: Week[] };

type Pending = {
  visit: string; direction: 'collect' | 'pay_out'; amount_cents: number;
  week: string; agent: string; window_from: string | null; window_to: string | null;
};
type Receipt = {
  ref: string; amount_cents: number; direction: 'collect' | 'pay_out';
  at: string; verified_by: string; agent: string; week: string;
};
type VisitStatus = { salon: string | null; pending: Pending | null; last_receipt: Receipt | null };

export default function StatementScreen({ onBack }: { onBack?: () => void }) {
  const [p, setP] = useState<Payload | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [vs, setVs] = useState<VisitStatus | null>(null);
  const [code, setCode] = useState<{ code: string; amount_cents: number } | null>(null);
  const [dispute, setDispute] = useState<any>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async (w: string | null) => {
    const { data, error } = await supabase.rpc('my_statement', { p_week: w });
    if (error) return Alert.alert('Could not load your statement', error.message);
    setP(data as Payload);
  }, []);
  useEffect(() => { load(week); }, [load, week]);

  // The agent's whole screen depends on this: he cannot record a collection
  // without four digits that only exist here. The status read is separate from
  // the mint so opening the statement does not rotate the code under his pen.
  useEffect(() => {
    let alive = true;
    supabase.rpc('my_disputed_receipt').then(({ data }) => { if (alive) setDispute(data ?? null); });
    supabase.rpc('my_visit_status').then(({ data }) => {
      if (!alive) return;
      const st = data as VisitStatus;
      setVs(st);
      if (st?.pending?.direction === 'collect') {
        supabase.rpc('my_visit_code').then(({ data: c }) => {
          if (alive && c?.code) setCode(c as { code: string; amount_cents: number });
        });
      }
    });
    return () => { alive = false; };
  }, [week, tick]);

  const s = p?.statement ?? null;

  // §2.3 — held is not kept. The amount and the date it unlocks sit on his own
  // statement while he waits; a held balance he cannot see is indistinguishable
  // from a confiscated one.
  const held = p?.held && p.held.reason === 'suspended' ? p.held : null;

  if (!p) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title="Your week" onBack={onBack} />
      </Screen>
    );
  }

  if (!s) {
    return (
      <Screen bottom={TAB_INSET}>
        <TopBar title="Your week" onBack={onBack} />
        {held && <HeldCard h={held} />}
        <View style={s2.empty}>
          <Ico name="file-text" size={26} color={D.sub} />
          <T size={12.5} c={D.sub} style={s2.centre}>
            No week has been closed yet. Statements are cut on Friday evening and
            cover the seven days before.
          </T>
        </View>
      </Screen>
    );
  }

  const pay = s.direction === 'pay_out';
  const nil = s.direction === 'nil';
  const accent = nil ? D.sub : pay ? D.green : D.accent;

  // OSH-18 — the carried line on its own, because "+ 52 DH from a week you were
  // already paid for" is the line an owner will phone about.
  if (open) return <CarriedScreen it={open} lw={s.last_week} onBack={() => setOpen(null)} />;

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={`Week ${s.week.slice(-2)}`} onBack={onBack} />
      <ScrollView contentContainerStyle={s2.pad} showsVerticalScrollIndicator={false}>

        {held && <HeldCard h={held} />}

        {dispute && <DisputeCard d={dispute} onAnswered={() => setTick((n) => n + 1)} />}

        {/* The four digits the agent needs. AGT-03: "His app shows it under this
            week's statement. It changes every visit, and it is what proves you
            were in the shop." Nothing else on either surface can prove that. */}
        {code && vs?.pending && (
          <View style={s2.codeCard}>
            <T w="b" size={10} c={D.accent} ls={1.5}>READ THESE OUT TO THE AGENT</T>
            <View style={s2.codeRow}>
              {code.code.split('').map((n, i) => (
                <View key={i} style={s2.codeBox}>
                  <T w="eb" size={26} style={s2.num}>{n}</T>
                </View>
              ))}
            </View>
            <T size={11.5} c={D.sub} style={s2.codeWhy}>
              {vs.pending.agent} is coming for {dh(vs.pending.amount_cents)} DH.
              Count it with him first, then give him these four digits — they are
              how we know he was really here. They change after every visit.
            </T>
          </View>
        )}

        {/* AGT-05's promise, kept: "his app shows it as received within a
            minute". If this is not here, the agent is telling him something
            untrue while standing in front of him. */}
        {vs?.last_receipt && (
          <View style={[s2.receipt,
            vs.last_receipt.direction === 'pay_out' && s2.receiptIn]}>
            <View style={s2.receiptTop}>
              <Ico name="check-circle" size={15}
                color={vs.last_receipt.direction === 'pay_out' ? D.green : D.textDim} />
              <T w="b" size={12.5} style={s2.grow}>
                {vs.last_receipt.direction === 'pay_out'
                  ? `Received ${dh(vs.last_receipt.amount_cents)} DH`
                  : `You handed over ${dh(vs.last_receipt.amount_cents)} DH`}
              </T>
              <T size={10.5} c={D.muted}>{vs.last_receipt.ref}</T>
            </View>
            <T size={11.5} c={D.sub} style={s2.receiptBody}>
              {vs.last_receipt.agent} · {when(vs.last_receipt.at)} · week{' '}
              {vs.last_receipt.week.slice(-2)} ·{' '}
              {vs.last_receipt.verified_by === 'signature'
                ? 'you signed for it'
                : 'confirmed with your code'}
            </T>
          </View>
        )}

        {/* the hero. §2.7: different sentence, different colour, different action */}
        <View style={[s2.hero, { borderColor: nil ? D.border : accent }]}>
          <View style={s2.heroTop}>
            <T w="b" size={10} c={accent} ls={1.5}>
              {nil ? `WEEK ${s.week.slice(-2)} · NOTHING MOVED`
                : pay ? `WEEK ${s.week.slice(-2)} · WE OWE YOU`
                  : `WEEK ${s.week.slice(-2)} · YOU ARE HOLDING OURS`}
            </T>
            <View style={s2.grow} />
            <View style={[s2.chip, { backgroundColor: accent + '22' }]}>
              <T w="b" size={9.5} c={accent} ls={1}>
                {s.settled_at ? (pay ? 'PAID' : 'COLLECTED') : nil ? 'CLOSED' : 'DUE FRIDAY'}
              </T>
            </View>
          </View>
          <T style={[s2.huge, { color: D.text }]}>{dh(s.total_cents)} DH</T>

          {s.settled_at ? (
            <T size={12} c={D.sub} style={s2.heroSub}>
              {s.agent ?? 'An agent'} {pay ? 'brought it' : 'counted it with you'} {when(s.settled_at)}
              {pay ? ', you counted it and signed' : ''}
              {s.receipt_ref ? ` · receipt ${s.receipt_ref}` : ''}
            </T>
          ) : nil ? (
            <T size={12} c={D.sub} style={s2.heroSub}>
              No cash moved either way this week. You still get the statement —
              a nil week is a fact, not a gap.
            </T>
          ) : (
            <T size={12} c={D.sub} style={s2.heroSub}>
              Have it ready in the till. An agent comes Friday between 17:00 and
              20:00, counts it with you and leaves a receipt.
            </T>
          )}
          <T size={11} c={D.muted} style={s2.window}>
            Covers {day(s.covers_from)} 21:00 → {day(s.covers_to)} 21:00
          </T>
        </View>

        {/* §2.7's sentence the paid screen does not need */}
        {!pay && !nil && (
          <View style={s2.notBill}>
            <T w="b" size={12.5} c={D.text}>This is not a bill</T>
            <T size={11.5} c={D.sub} style={s2.notBillBody}>
              The {dh(s.hold_cents)} DH your barbers took over the counter is
              customers&rsquo; wallet money — ours, sitting in your till. Sterncut
              charges you nothing and takes no fee from either side.
            </T>
          </View>
        )}

        <T w="b" size={10} c={D.sub} ls={1.5} style={s2.section}>HOW IT ADDS UP</T>

        <View style={s2.card}>
          {/* the earning line first and largest when we owe him; our float first
              when he owes us. Either way every row carries a reference and a time. */}
          {pay ? (
            <>
              <Group label="Deposits you earned" total={s.earned_cents} colour={D.green} />
              {s.earned_lines.map((x) => (
                <Row key={x.ref + x.at} it={x} sign={x.kind === 'refund' ? '−' : '+'} />
              ))}
              <Group label="Our cash your barbers took" total={-s.hold_cents} />
              {s.float_lines.map((x) => <Row key={x.ref} it={x} sign="−" />)}
            </>
          ) : (
            <>
              <Group label="Our cash in your till" total={s.hold_cents} />
              {s.float_lines.map((x) => <Row key={x.ref} it={x} sign="+" />)}
              <Group label="Deposits you earned" total={-s.earned_cents} colour={D.green} />
              {s.earned_lines.map((x) => (
                <Row key={x.ref + x.at} it={x} sign={x.kind === 'refund' ? '+' : '−'} />
              ))}
            </>
          )}

          {/* §2.4 — the subtotal is named, and it is only here because a carried
              line follows it. No carry, no subtotal. */}
          {s.carried_lines.length > 0 && (
            <>
              <View style={s2.rule} />
              <View style={s2.line}>
                <T w="sb" size={12.5} style={s2.grow}>This week</T>
                <T w="b" size={13} style={s2.num}>{dh(s.subtotal_cents)} DH</T>
              </View>
              {s.carried_lines.map((x) => (
                <Pressable key={x.ref} onPress={() => setOpen(x)} style={[s2.line, s2.carried]}>
                  <View style={s2.grow}>
                    <T size={12} c={D.amber}>From week {x.source_week?.slice(-2)} · a refund</T>
                    <T size={10.5} c={D.muted} style={s2.gap2}>
                      {x.ref} · refunded {when(x.at)}
                    </T>
                  </View>
                  <T w="b" size={12.5} c={D.amber} style={s2.num}>
                    {x.cents >= 0 ? '+' : '−'} {dh(x.cents)} DH
                  </T>
                  <Ico name="chevron-right" size={14} color={D.muted} />
                </Pressable>
              ))}
            </>
          )}

          <View style={s2.rule} />
          <View style={s2.line}>
            <T w="b" size={13} style={s2.grow}>
              {nil ? 'Nothing to move' : pay ? 'We hand you' : 'You put on the counter'}
            </T>
            <T w="eb" size={19} c={accent} style={s2.num}>{dh(s.total_cents)} DH</T>
          </View>
        </View>

        <T size={11} c={D.muted} style={s2.fine}>
          Sterncut takes no fee from either side. Every line above carries its
          reference and the minute it happened, so you can check any one of them
          against your own day.
        </T>
        {/* §6's footer, on every statement: it is what makes the phrase mean
            something on the statements that do carry it. */}
        <T size={11} c={D.muted} style={s2.fine}>
          A line only says <T size={11} c={D.sub}>confirmed with your code</T> when
          you typed those four digits and they matched.
        </T>

        {/* the weeks behind this one */}
        {(p.weeks ?? []).length > 1 && (
          <>
            <T w="b" size={10} c={D.sub} ls={1.5} style={s2.section}>EARLIER WEEKS</T>
            <View style={s2.card}>
              {(p.weeks ?? []).slice(0, 8).map((w) => (
                <Pressable key={w.covers_to} onPress={() => setWeek(w.covers_to)}
                  style={[s2.line, w.week === s.week && s2.lineOn]}>
                  <T size={12.5} c={w.week === s.week ? D.text : D.sub} style={s2.grow}>
                    Week {w.week.slice(-2)}
                  </T>
                  <T size={11} c={D.muted} style={s2.dirn}>
                    {w.direction === 'pay_out' ? 'paid to you' : w.direction === 'nil' ? 'nil' : 'you paid'}
                  </T>
                  <T w="b" size={12.5} style={s2.num}>{dh(w.total_cents)} DH</T>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Group({ label, total, colour }: { label: string; total: number; colour?: string }) {
  return (
    <View style={s2.group}>
      <T w="b" size={10} c={D.sub} ls={1.3} style={s2.grow}>{label.toUpperCase()}</T>
      <T w="b" size={12.5} c={colour ?? D.text} style={s2.num}>
        {total < 0 ? '− ' : ''}{dh(total)} DH
      </T>
    </View>
  );
}

function Row({ it, sign }: { it: Item; sign: string }) {
  return (
    <View style={s2.line}>
      <View style={s2.grow}>
        <T size={12} c={D.sub}>{it.label}</T>
        <T size={10.5} c={D.muted} style={s2.gap2}>{it.ref} · {when(it.at)}</T>
      </View>
      <T w="b" size={12.5} c={sign === '+' ? D.green : D.text} style={s2.num}>
        {sign} {dh(it.cents)} DH
      </T>
    </View>
  );
}


// ---------------------------------------------------------------------------
// AGT-19 — the direct question
// ---------------------------------------------------------------------------
// The agent's side of this (AGT-18) may not exist without it. §10: "a mismatch
// that only exists on the agent's side is worse than nothing" — his statement
// would then carry a number nobody had questioned.
//
// It is a question with his own money in it, it explains why his app was
// probably showing the wrong code, and it says plainly that nothing has
// changed. Both answers' consequences are on screen before he picks one.
function DisputeCard({ d, onAnswered }: {
  d: { receipt: string; ref: string; cents: number; agent: string; at: string;
       week: string; answered: boolean | null };
  onAnswered: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const answer = async (yes: boolean) => {
    setBusy(true);
    const { error } = await supabase.rpc('answer_disputed_receipt', {
      p_receipt: d.receipt, p_yes: yes,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not send that', error.message);
    onAnswered();
  };

  if (d.answered != null) {
    return (
      <View style={s2.answered}>
        <Ico name="check-circle" size={15} color={D.green} />
        <T size={11.5} c={D.sub} style={s2.grow}>
          Thank you — you told us {d.answered ? 'yes' : 'no'} about the{' '}
          {dh(d.cents)} DH on {d.ref}. Someone is looking at it.
        </T>
      </View>
    );
  }

  return (
    <View style={s2.dispute}>
      <T w="b" size={10} c={D.amber} ls={1.5}>WE NEED TO ASK YOU SOMETHING</T>
      <T w="b" size={16} style={s2.dq}>
        Did you hand {d.agent} {dh(d.cents)} DH on {when(d.at)}?
      </T>
      <T size={11.5} c={D.sub} style={s2.dBody}>
        The four digits he gave us are not the ones your app issued. That is
        almost always because your app had been closed a while and was showing
        an older number. <T w="sb" size={11.5} c={D.textDim}>Nothing on your
        account has changed</T> — the {dh(d.cents)} DH still reads exactly as it
        did on week {d.week.slice(-2)}.
      </T>

      <View style={s2.dChoices}>
        <Pressable disabled={busy} onPress={() => answer(true)} style={s2.dYes}>
          <T w="b" size={12.5} c="#0D0D0F">YES, I DID</T>
          <T size={10.5} c="rgba(13,13,15,0.7)" style={s2.gap2}>
            We close it and the line stands as it is.
          </T>
        </Pressable>
        <Pressable disabled={busy} onPress={() => answer(false)} style={s2.dNo}>
          <T w="b" size={12.5}>NO, I DIDN&rsquo;T</T>
          <T size={10.5} c={D.sub} style={s2.gap2}>
            A person rings you today. If we got it wrong the fix is a line on
            next week&rsquo;s statement — we never quietly change one you have.
          </T>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// OSH-18 — the 52 DH from a week already paid
// ---------------------------------------------------------------------------
// The whole screen exists to answer one question before he asks it: why is this
// on THIS week and not on the one it came from? Because week 35 is closed and
// the cash he counted was right when he counted it — changing it now would
// leave him holding a receipt that no longer matches.
function CarriedScreen({ it, lw, onBack }: {
  it: Item;
  lw: { week: string; direction: string; total_cents: number } | null;
  onBack: () => void;
}) {
  const [sent, setSent] = useState(false);

  // §5: there is no dispute state anywhere in the product. This opens a support
  // case and says so — a dispute flow that does not exist would be worse than
  // an honest "message us". The booking is not passed: `file_support_case`
  // checks the caller is the booking's customer or barber, and a shop owner is
  // usually neither, so the reference rides in the detail instead.
  const flag = async () => {
    const { error } = await supabase.rpc('file_support_case', {
      p_booking: null,
      p_reason: 'wrong_amount',
      p_detail: `Carried line on my statement: ${it.ref}, ${dh(it.cents)} DH, `
        + `from week ${it.source_week?.slice(-2)}. I don't think this is right.`,
    });
    if (error) return Alert.alert('Could not send that', error.message);
    setSent(true);
    Alert.alert('We have it',
      'Someone will look at this line and come back to you. If we got it wrong '
      + 'the fix is another line on another week — we never reopen a week you have already been paid for.');
  };

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="This line" onBack={onBack} />
      <ScrollView contentContainerStyle={s2.pad} showsVerticalScrollIndicator={false}>
        <View style={[s2.hero, { borderColor: D.amber }]}>
          <T w="b" size={10} c={D.amber} ls={1.5}>
            CARRIED FROM WEEK {it.source_week?.slice(-2)}
          </T>
          <T style={[s2.huge, { color: D.text }]}>
            {it.cents >= 0 ? '+' : '−'} {dh(it.cents)} DH
          </T>
          <T size={12} c={D.sub} style={s2.heroSub}>
            A customer was refunded for a cut you had already been paid for, so
            it comes back on this week rather than changing the last one.
          </T>
        </View>

        <T w="b" size={10} c={D.sub} ls={1.5} style={s2.section}>THE FACTS</T>
        <View style={s2.card}>
          {[
            ['Booking', it.ref],
            ['Refunded', when(it.at)],
            ['From', `Week ${it.source_week?.slice(-2)}`],
            ['Amount', `${dh(it.cents)} DH`],
          ].map(([k, v]) => (
            <View key={k} style={s2.line}>
              <T size={12} c={D.sub} style={s2.grow}>{k}</T>
              <T w="sb" size={12} style={s2.num}>{v}</T>
            </View>
          ))}
        </View>

        <T w="b" size={10} c={D.sub} ls={1.5} style={s2.section}>
          WHY IT IS ON THIS WEEK
        </T>
        <View style={s2.card}>
          <T size={12} c={D.sub} style={s2.why}>
            Week {it.source_week?.slice(-2)} is closed. The
            {lw ? ` ${dh(lw.total_cents)} DH ` : ' amount '}
            you counted was right when you counted it, and we do not change a
            week you have already been settled for — you would be holding a
            receipt that no longer matches anything.
          </T>
          {lw && (
            <View style={s2.closed}>
              <Ico name="lock" size={13} color={D.green} />
              <T size={11.5} c={D.sub} style={s2.grow}>
                Week {lw.week.slice(-2)} · {dh(lw.total_cents)} DH
              </T>
              <T w="b" size={10} c={D.green} ls={0.8}>UNCHANGED</T>
            </View>
          )}
        </View>

        <Pressable onPress={sent ? undefined : flag} style={[s2.flag, sent && s2.flagSent]}>
          <T w="b" size={12} c={sent ? D.sub : D.text}>
            {sent ? 'WE HAVE IT' : "THIS ISN'T RIGHT"}
          </T>
        </Pressable>
        <T size={11} c={D.muted} style={s2.centre}>
          This opens a support case. There is no way to dispute a line and freeze
          it — if we got it wrong, the fix is another line on another week.
        </T>
      </ScrollView>
    </Screen>
  );
}

// §2.3 — "held, not kept". The amount, the date it unlocks, and who told him.
function HeldCard({ h }: { h: Held }) {
  return (
    <View style={s2.held}>
      <View style={s2.heldTop}>
        <Ico name="lock" size={15} color={D.amber} />
        <T w="b" size={12.5} c={D.amber}>Your {dh(h.amount_cents ?? 0)} DH is held, not kept</T>
      </View>
      <T size={11.5} c={D.sub} style={s2.heldBody}>
        Your shop is suspended, so this week&rsquo;s visit did not happen. The money
        is still yours and it is waiting
        {h.unlocks_on ? ` — it releases when the suspension lifts, reviewed ${day(h.unlocks_on)}` : ''}.
        {h.told_by ? ` ${h.told_by} is your contact until then.` : ''}
      </T>
    </View>
  );
}

const s2 = StyleSheet.create({
  pad: { paddingHorizontal: 20, paddingBottom: 30 },
  grow: { flex: 1 },
  centre: { textAlign: 'center' },
  num: { fontVariant: ['tabular-nums'] },
  gap2: { marginTop: 2 },
  empty: { alignItems: 'center', gap: 10, paddingHorizontal: 40, paddingTop: 70 },

  hero: {
    borderWidth: 1, borderRadius: 22, backgroundColor: D.card,
    padding: 20, gap: 7, marginTop: 4,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  huge: { fontSize: 46, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 52 },
  heroSub: { lineHeight: 18 },
  window: { marginTop: 3 },

  notBill: {
    marginTop: 14, borderRadius: 18, padding: 16, gap: 6,
    backgroundColor: 'rgba(232,68,46,0.08)',
    borderWidth: 1, borderColor: 'rgba(232,68,46,0.28)',
  },
  notBillBody: { lineHeight: 18 },

  section: { marginTop: 22, marginBottom: 9 },
  card: { backgroundColor: D.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 4 },
  group: {
    flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 8,
  },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  lineOn: { opacity: 1 },
  carried: { borderTopWidth: 1, borderTopColor: D.border },
  dirn: { marginRight: 12 },
  rule: { height: 1, backgroundColor: D.border, marginVertical: 6 },
  fine: { marginTop: 12, lineHeight: 16 },

  held: {
    marginTop: 4, borderRadius: 18, padding: 16, gap: 7,
    backgroundColor: 'rgba(232,161,0,0.09)',
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.3)',
  },
  heldTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dispute: {
    marginTop: 4, borderRadius: 18, padding: 18, gap: 9,
    backgroundColor: 'rgba(232,161,0,0.09)',
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.36)',
  },
  dq: { lineHeight: 22 },
  dBody: { lineHeight: 18 },
  dChoices: { gap: 9, marginTop: 4 },
  dYes: { borderRadius: 14, padding: 14, backgroundColor: D.green },
  dNo: {
    borderRadius: 14, padding: 14, backgroundColor: D.card,
    borderWidth: 1, borderColor: D.border,
  },
  answered: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 4,
    borderRadius: 16, padding: 14, backgroundColor: D.card,
  },
  codeCard: {
    marginTop: 4, borderRadius: 18, padding: 17, gap: 11,
    backgroundColor: 'rgba(232,68,46,0.08)',
    borderWidth: 1, borderColor: 'rgba(232,68,46,0.34)',
  },
  codeRow: { flexDirection: 'row', gap: 9 },
  codeBox: {
    flex: 1, height: 58, borderRadius: 13, backgroundColor: D.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  codeWhy: { lineHeight: 18 },
  receipt: {
    marginTop: 12, borderRadius: 16, padding: 15, gap: 6, backgroundColor: D.card,
    borderWidth: 1, borderColor: D.border,
  },
  receiptIn: {
    backgroundColor: 'rgba(74,222,128,0.08)', borderColor: 'rgba(74,222,128,0.3)',
  },
  receiptTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  receiptBody: { lineHeight: 17 },
  why: { lineHeight: 19, paddingVertical: 12 },
  closed: { flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: 1,
    borderTopColor: D.border, paddingVertical: 12 },
  flag: { marginTop: 22, height: 50, borderRadius: 999, alignItems: 'center',
    justifyContent: 'center', borderWidth: 1, borderColor: D.border, backgroundColor: D.card2 },
  flagSent: { backgroundColor: 'transparent', borderColor: D.muted },
  heldBody: { lineHeight: 18 },
});
