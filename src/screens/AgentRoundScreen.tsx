import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, PanResponder, Pressable, ScrollView, StyleSheet, View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Btn, Ico, Screen, Sheet, T, TAB_INSET, TopBar } from '../components/dark';
import { supabase } from '../lib/supabase';
import { enqueue, useConnection } from '../lib/sync';
import { dark as D } from '../theme';

// AGT-01 … AGT-05 of "Ops Agent - Collection.dc.html".
//
// This is NOT `BCF-04`. That screen takes a float off a barber: one person, one
// amount, nobody who could disagree. A settlement has a shop rather than a
// person, a number that points either way, an amount that can be partial, a
// receipt, sometimes a signature, and no undo. Generalising the float screen
// would have produced a partial that feels like an error, which is the one
// thing this design exists to prevent.
//
// The two proofs are SPLIT BY DIRECTION and are not one abstraction:
//   collect   -> the owner's 4-digit code, read out of his own app. It proves
//                the agent was standing in the shop, which is the fraud in this
//                direction. A signature cannot: a signature drawn on the
//                agent's phone is drawn by whoever is holding the phone.
//   hand over -> the owner's signature. His presence was never in question;
//                the money reaching him is. No code is asked for.

const dh = (c: number) =>
  Math.round(Math.abs(c ?? 0) / 100).toLocaleString('en-US').replace(/,/g, ' ');
const hhmm = (iso?: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type Bag = {
  collected_cents: number; handed_cents: number; in_bag_cents: number; cap_cents: number;
};
type Visit = {
  id: string; direction: 'collect' | 'pay_out'; state: string;
  address: string | null; window_from: string | null; window_to: string | null;
  salon: string; salon_id: string; owner: string; week: string;
  amount_cents: number; already_cents: number;
  age_days: number | null; waiting_days: number | null; limit_days: number;
};
type Round = { bag: Bag; visits: Visit[] };
type Paused = {
  receipt: string; ref: string; cents: number; code: string;
  salon: string; at: string; owner: string;
};
type Queue = {
  n: number; cents: number; max_n: number; max_cents: number;
  oldest_h: number | null; failed: number; at_ceiling: boolean;
};
type Done = {
  receipt: string; salon: string; taken_cents?: number; handed_cents?: number;
  open_cents?: number; code?: string; bag: Bag; direction: 'collect' | 'pay_out';
  visit: Visit;
  // §5: recorded, not wrong. The receipt is provisional until the digits
  // he typed are compared against the ones the owner's app issued.
  verification?: 'verified' | 'queued' | 'failed';
};

// ---------------------------------------------------------------------------
// AGT-01 — his round
// ---------------------------------------------------------------------------
export default function AgentRoundScreen({ onBack }: { onBack?: () => void }) {
  const [r, setR] = useState<Round | null>(null);
  const [open, setOpen] = useState<Visit | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [dropping, setDropping] = useState(false);
  const [q, setQ] = useState<Queue | null>(null);
  const [paused, setPaused] = useState<Paused | null>(null);
  const { online } = useConnection();

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('agent_visits');
    if (error) return Alert.alert('Could not load your round', error.message);
    setR(data as Round);
    const { data: qd } = await supabase.rpc('agent_queue', {});
    if (qd) setQ(qd as Queue);
    // §6: a failed code pauses his round until he has said what he saw, because
    // the owner's question cannot be sent until then.
    const { data: pd } = await supabase.rpc('agent_paused', {});
    setPaused((pd ?? null) as Paused | null);
  }, []);
  useEffect(() => { load(); }, [load]);

  const finish = (d: Done) => { setOpen(null); setDone(d); load(); };

  // The whole amount, or part of it if he split the trip. `agent_drop` refuses
  // more than he is carrying, so the number cannot go negative here.
  const drop = async (cents: number) => {
    const { error } = await supabase.rpc('agent_drop', { p_cents: cents });
    if (error) return Alert.alert('Not recorded', error.message);
    setDropping(false);
    load();
  };

  const bag = r?.bag;
  const visits = r?.visits ?? [];
  const pct = bag && bag.cap_cents ? Math.min(100, Math.round(bag.in_bag_cents * 100 / bag.cap_cents)) : 0;

  // §2.4's warning, and it is about the ROUND rather than the next tap: the
  // collections still ahead of the next hand-over, taken together. A version
  // that only checked `bag + next visit` would stay quiet until he was over.
  //
  // This sits ABOVE the early returns below and must stay there: a hook after a
  // conditional return runs on some renders and not others, which is exactly
  // the "rendered fewer hooks than expected" crash.
  const overCap = useMemo(() => {
    if (!bag) return false;
    let running = bag.in_bag_cents;
    for (const v of visits) {
      if (v.direction === 'pay_out') break;
      running += v.amount_cents;
      if (running > bag.cap_cents) return true;
    }
    return false;
  }, [bag, visits]);

  // AGT-18. It is not a modal over the round: until he answers, the round is
  // stopped, and a dismissible sheet would let him keep driving.
  if (paused) return <MismatchScreen p={paused} onDone={load} />;
  if (done) return <ReceiptScreen d={done} onNext={() => setDone(null)} />;
  if (open) {
    return open.direction === 'collect'
      ? <CollectScreen v={open} bag={r!.bag} q={q} online={online}
          onBack={() => setOpen(null)} onDone={finish} />
      : <HandOverScreen v={open} bag={r!.bag} onBack={() => setOpen(null)} onDone={finish} />;
  }

  const today = visits.filter((v) => !isLater(v));
  const later = visits.filter(isLater);

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="Your round" onBack={onBack} />
      <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
        <T size={12} c={D.sub} style={s.sub}>
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          {visits.length ? ` · ${visits.length} visit${visits.length === 1 ? '' : 's'} left` : ''}
        </T>

        {q && (q.n > 0 || q.failed > 0) && (
          <View style={s.queueStrip}>
            <Ico name={q.failed ? 'alert-triangle' : 'clock'} size={14}
              color={q.failed ? '#F87171' : D.amber} />
            <View style={s.grow}>
              <T w="sb" size={12} c={q.failed ? '#F87171' : D.amber}>
                {q.failed
                  ? `${q.failed} code didn’t match`
                  : `${q.n} of ${q.max_n} · ${dh(q.cents)} DH waiting to be checked`}
              </T>
              <T size={10.5} c={D.sub} style={s.gap2}>
                {q.failed
                  ? 'Ops is ringing the owner. Your round is paused until that is sent.'
                  : q.at_ceiling
                    ? 'You cannot open another collection until these clear. Hand-overs still work.'
                    : 'They go through on their own when you have signal.'}
              </T>
            </View>
          </View>
        )}

        {/* the bag. §2.4: it is his personal risk, not a nicety */}
        {bag && (
          <View style={s.bag}>
            <View style={s.bagTop}>
              <T w="b" size={10} c={D.sub} ls={1.5}>IN YOUR BAG NOW</T>
              <View style={s.grow} />
              <T size={11} c={D.sub} style={s.num}>Cap {dh(bag.cap_cents)} DH</T>
            </View>
            <T style={s.bagBig}>{dh(bag.in_bag_cents)} DH</T>
            <View style={s.track}>
              <View style={[s.fill, { width: `${pct}%`, backgroundColor: overCap ? D.amber : D.amber }]} />
            </View>
            <View style={s.tiles}>
              <View style={s.tile}>
                <T size={10} c={D.faint} ls={1.2}>COLLECTED TODAY</T>
                <T w="b" size={14} style={s.num}>{dh(bag.collected_cents)} DH</T>
              </View>
              <View style={s.tile}>
                <T size={10} c={D.faint} ls={1.2}>STILL TO HAND OVER</T>
                <T w="b" size={14} style={s.num}>{dh(bag.handed_cents)} DH</T>
              </View>
            </View>
            {overCap && (
              <View style={s.warn}>
                <Ico name="alert-triangle" size={13} color={D.amber} />
                <T size={11.5} c={D.amber} style={s.grow}>
                  The collections left on your round put you over the cap. Drop at
                  the office first.
                </T>
              </View>
            )}
            {/* §2.4 — the cap is what sends him to the office, so getting
                there has to be something he can record. Without this the bag
                only ever grows and the warning never clears. */}
            {bag.in_bag_cents > 0 && (
              <Pressable onPress={() => setDropping(true)} style={s.dropRow}>
                <Ico name="briefcase" size={14} color={D.sub} />
                <T size={12} c={D.textDim} style={s.grow}>Dropped at the office</T>
                <Ico name="chevron-right" size={14} color={D.muted} />
              </Pressable>
            )}
          </View>
        )}

        <View style={s.head}>
          <T w="b" size={10} c={D.sub} ls={1.5}>NEXT VISITS</T>
          <View style={s.grow} />
          <T size={10.5} c={D.faint}>Oldest money first</T>
        </View>

        {!visits.length && (
          <View style={s.empty}>
            <Ico name="check-circle" size={24} color={D.green} />
            <T size={12.5} c={D.sub} style={s.centre}>Nothing left on your round.</T>
          </View>
        )}

        {today.map((v) => (
          <VisitCard key={v.id} v={v}
            blocked={!!q?.at_ceiling && v.direction === 'collect'}
            onPress={() => {
              if (q?.at_ceiling && v.direction === 'collect') {
                return Alert.alert('Too much unchecked cash',
                  `You have ${q.n} collections worth ${dh(q.cents)} DH that we have not `
                  + 'been able to check yet. Find signal and let them go through, or call ops. '
                  + 'You can still hand over.');
              }
              setOpen(v);
            }} />
        ))}
        {later.map((v) => <VisitCard key={v.id} v={v} later onPress={() => setOpen(v)} />)}
      </ScrollView>

      {bag && (
        <DropSheet visible={dropping} bag={bag}
          onClose={() => setDropping(false)} onDrop={drop} />
      )}
    </Screen>
  );
}

// §2.4 - the drop is what resets the bag, so it is a real amount he types
// rather than an all-or-nothing button: he may leave part of it and keep
// enough for the hand-overs still on his round.
function DropSheet({ visible, bag, onClose, onDrop }: {
  visible: boolean; bag: Bag; onClose: () => void; onDrop: (cents: number) => void;
}) {
  const [typed, setTyped] = useState('');
  const cents = Number(typed || 0) * 100;
  const over = cents > bag.in_bag_cents;

  return (
    <Sheet visible={visible} onClose={onClose}>
      <T w="b" size={17}>Dropped at the office</T>
      <T size={12} c={D.sub}>
        You are carrying {dh(bag.in_bag_cents)} DH. Leave all of it, or keep back
        what the hand-overs still on your round need.
      </T>

      <View style={[s.amount, over && { borderColor: '#F87171' }]}>
        <T style={s.amountText}>
          {typed ? Number(typed).toLocaleString('en-US').replace(/,/g, ' ') : '0'}
        </T>
        <View style={s.grow} />
        <T size={14} c={D.sub}>DH</T>
      </View>

      <View style={s.chips}>
        <Pressable onPress={() => setTyped(String(Math.round(bag.in_bag_cents / 100)))}
          style={s.pill}>
          <T size={11.5} c={D.textDim}>All of it · {dh(bag.in_bag_cents)} DH</T>
        </Pressable>
        <Pressable onPress={() => setTyped('')} style={s.pill}>
          <T size={11.5} c={D.sub}>Clear</T>
        </Pressable>
      </View>

      <View style={s.pad3}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '<'].map((k) => (
          <Pressable key={k} style={s.keyB}
            onPress={() => setTyped((x) => (k === '<' ? x.slice(0, -1) : (x === '0' ? k : x + k).slice(0, 7)))}>
            {k === '<'
              ? <Ico name="delete" size={18} color={D.sub} />
              : <T w="sb" size={20} style={s.num}>{k}</T>}
          </Pressable>
        ))}
      </View>

      <Btn title={cents > 0 ? `RECORD ${dh(cents)} DH DROPPED` : 'HOW MUCH DID YOU LEAVE?'}
        bg={cents > 0 && !over ? D.green : D.card2}
        fg={cents > 0 && !over ? '#0D0D0F' : D.faint}
        height={54} ls={0.7}
        onPress={() => { if (cents > 0 && !over) onDrop(cents); }} />
    </Sheet>
  );
}

const isLater = (v: Visit) =>
  !!v.window_from && new Date(v.window_from).toDateString() !== new Date().toDateString();

function VisitCard({ v, later, blocked, onPress }: {
  v: Visit; later?: boolean; blocked?: boolean; onPress: () => void;
}) {
  const collect = v.direction === 'collect';
  // §2.3 — the age is only real in one direction, and the other says so
  const late = collect && v.age_days != null && v.age_days >= v.limit_days - 5;
  const border = later ? D.border : late ? '#F87171' : collect ? D.border : 'rgba(74,222,128,0.4)';
  const pct = collect && v.age_days != null
    ? Math.min(100, Math.round(v.age_days * 100 / v.limit_days)) : 0;

  return (
    <Pressable onPress={onPress}
      style={[s.card, { borderColor: border }, (later || blocked) && s.cardLater]}>
      <View style={s.cardTop}>
        <View style={s.grow}>
          <T w="sb" size={14} c={later ? D.sub : D.text}>{v.salon}</T>
          <T size={11} c={D.faint} style={s.gap2}>
            {later && v.window_from
              ? `${new Date(v.window_from).toLocaleDateString('en-GB', { weekday: 'long' })} ${hhmm(v.window_from)}`
              : v.address ?? ''}
            {!later && v.window_from ? ` · window ${hhmm(v.window_from)}–${hhmm(v.window_to)}` : ''}
          </T>
        </View>
        <View style={s.right}>
          {/* §2.1 — direction is a WORD. Colour only reinforces it. */}
          <T w="eb" size={10} c={collect ? D.accent : D.green} ls={1.3}>
            {collect ? 'COLLECT' : 'HAND OVER'}
          </T>
          <T w="b" size={19} style={s.num}>{dh(v.amount_cents)} DH</T>
        </View>
      </View>

      {!later && collect && v.age_days != null && (
        <View style={s.track2}>
          <View style={[s.fill, { width: `${pct}%`, backgroundColor: late ? '#F87171' : D.amber }]} />
        </View>
      )}

      <View style={s.cardFoot}>
        {collect ? (
          <>
            <T size={11} c={late ? '#F87171' : D.sub}>
              {v.age_days == null ? 'No money of ours yet' : `Day ${v.age_days} of ${v.limit_days}`}
            </T>
            <View style={s.grow} />
            <T size={11} c={late ? '#F87171' : D.faint}>
              {late ? 'Do this one first' : v.owner}
            </T>
          </>
        ) : (
          <>
            {/* §2.3: no age, and it is shown rather than faked */}
            <T size={11} c={D.sub}>No age — they hold nothing of ours</T>
            <View style={s.grow} />
            <T size={11} c={D.faint}>
              {v.waiting_days == null ? '' : `Waiting ${v.waiting_days} day${v.waiting_days === 1 ? '' : 's'}`}
            </T>
          </>
        )}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// AGT-02 — counting it with him, and AGT-03 as the sheet over it
// ---------------------------------------------------------------------------
// The partial path is the one that was built first. A short payment is the
// normal case: no red, no blocked button, no extra dialog. One amber panel and
// a changed sentence. The full amount is the special case where that panel
// happens not to appear.
function CollectScreen({ v, bag, q, online, onBack, onDone }: {
  v: Visit; bag: Bag; q: Queue | null; online: boolean;
  onBack: () => void; onDone: (d: Done) => void;
}) {
  const [typed, setTyped] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [ladder, setLadder] = useState(false);
  // §3's fourth brake: once he has counted the money with the owner, walking
  // away is not an option the screen offers. Typing an amount is the moment
  // that becomes true.
  const counted = Number(typed || 0) > 0;

  const cents = Number(typed || 0) * 100;
  const short = Math.max(0, v.amount_cents - cents);
  const over = cents > v.amount_cents;

  const key = (k: string) => {
    if (k === '<') return setTyped((t) => t.slice(0, -1));
    setTyped((t) => (t === '0' ? k : t + k).slice(0, 7));
  };

  if (ladder) {
    return <LadderScreen v={v} holding={counted}
      onBack={() => setLadder(false)} onDone={onBack} />;
  }

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={v.salon} onBack={onBack} />
      <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
        <View style={s.row}>
          <T size={12} c={D.sub} style={s.grow}>{v.owner}</T>
          <View style={[s.chip, { backgroundColor: 'rgba(232,68,46,0.16)' }]}>
            <T w="eb" size={9.5} c={D.accent} ls={1.2}>COLLECT</T>
          </View>
        </View>

        <View style={s.owes}>
          <View style={s.grow}>
            <T w="b" size={10} c={D.sub} ls={1.5}>HE OWES THIS WEEK</T>
            <T style={s.owesBig}>{dh(v.amount_cents)} DH</T>
          </View>
          <View style={s.rightTop}>
            <T size={11} c={D.faint}>Week {v.week.slice(-2)}</T>
            {v.age_days != null && (
              <T size={11} c={D.amber} style={s.gap2}>Day {v.age_days} of {v.limit_days}</T>
            )}
          </View>
        </View>

        <T w="b" size={10} c={D.sub} ls={1.4} style={s.label}>
          COUNT IT WITH HIM, THEN TYPE WHAT YOU HAVE
        </T>
        <View style={[s.amount, over && { borderColor: '#F87171' }]}>
          <T style={s.amountText}>{typed ? Number(typed).toLocaleString('en-US').replace(/,/g, ' ') : '0'}</T>
          <T style={s.caret}>|</T>
          <View style={s.grow} />
          <T size={14} c={D.sub}>DH</T>
        </View>

        <View style={s.chips}>
          <Pressable onPress={() => setTyped(String(Math.round(v.amount_cents / 100)))}
            style={s.pill}>
            <T size={11.5} c={D.textDim}>Full amount · {dh(v.amount_cents)} DH</T>
          </Pressable>
          <Pressable onPress={() => setTyped('')} style={s.pill}>
            <T size={11.5} c={D.sub}>Clear</T>
          </Pressable>
        </View>

        <View style={s.pad3}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '<'].map((k) => (
            <Pressable key={k} onPress={() => key(k)} style={s.keyB}>
              {k === '<'
                ? <Ico name="delete" size={18} color={D.sub} />
                : <T w="sb" size={20} style={s.num}>{k}</T>}
            </Pressable>
          ))}
        </View>

        {/* THE POINT OF THE SCREEN. Not an error state: amber, not red; the
            button stays live; no dialog. Copy is verbatim so he can read it out. */}
        {short > 0 && cents > 0 && (
          <View style={s.shortPanel}>
            <T w="b" size={12.5} c={D.amber}>{dh(short)} DH short — that is fine</T>
            <T size={11.5} c={D.sub} style={s.shortBody}>
              The {dh(short)} DH stays on this week&rsquo;s line and comes back on next
              Friday&rsquo;s statement. Nothing is added for being short, and nobody
              will call him about it.
            </T>
          </View>
        )}
        {over && (
          <View style={s.overPanel}>
            <T size={11.5} c="#F87171">
              He only owes {dh(v.amount_cents)} DH this week. Take that, not more.
            </T>
          </View>
        )}

        <T w="sb" size={12} c={D.sub} style={s.leaveLink} onPress={() => setLadder(true)}>
          He can&rsquo;t give me the code
        </T>
      </ScrollView>

      <View style={s.foot}>
        <Btn title={cents > 0 ? `TAKE ${dh(cents)} DH` : 'TYPE WHAT YOU HAVE'}
          bg={cents > 0 && !over ? D.accent : D.card2}
          fg={cents > 0 && !over ? '#fff' : D.faint}
          height={54} ls={0.7}
          onPress={() => { if (cents > 0 && !over) setConfirm(true); }} />
      </View>

      <ConfirmSheet visible={confirm} v={v} bag={bag} cents={cents} short={short}
        online={online} onClose={() => setConfirm(false)} onDone={onDone} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// AGT-03 — the immutable moment
// ---------------------------------------------------------------------------
// The friction lives HERE and nowhere else. No long-press, no second dialog, no
// typed confirmation — the code is the friction, and it does real work.
function ConfirmSheet({ visible, v, bag, cents, short, online, onClose, onDone }: {
  visible: boolean; v: Visit; bag: Bag; cents: number; short: number;
  online: boolean; onClose: () => void; onDone: (d: Done) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const record = async () => {
    setBusy(true);
    const capturedAt = new Date().toISOString();

    // §5, offline: the receipt exists on tap. He cannot be made to wait for a
    // network he does not have, and the digits ride the queue with the money.
    // The device names the receipt so a replay can never write it twice - the
    // one part of offline immutability that is a real barrier.
    if (!online) {
      const clientRef = `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await enqueue({
        at: capturedAt,
        label: `${v.salon} · ${dh(cents)} DH collected`,
        icon: 'check',
        cents,
        call: {
          rpc: 'agent_collect',
          args: {
            p_visit: v.id, p_cents: cents, p_code: code,
            p_captured_at: capturedAt, p_client_ref: clientRef,
          },
        },
      });
      setBusy(false);
      setCode('');
      return onDone({
        receipt: 'not yet issued', salon: v.salon, taken_cents: cents,
        open_cents: Math.max(0, v.amount_cents - cents), code,
        bag: { ...bag, in_bag_cents: bag.in_bag_cents + cents,
               collected_cents: bag.collected_cents + cents },
        direction: 'collect', visit: v, verification: 'queued',
      });
    }

    const { data, error } = await supabase.rpc('agent_collect', {
      p_visit: v.id, p_cents: cents, p_code: code,
    });
    setBusy(false);
    if (error) return Alert.alert('Not recorded', error.message);
    const d = data as Done;
    setCode('');
    onDone({ ...d, direction: 'collect', visit: v });
  };

  return (
    <Sheet visible={visible} onClose={onClose} deep>
      <T w="b" size={19} style={s.sheetTitle}>
        You are recording cash you have already counted.
      </T>

      <View style={s.summary}>
        {[
          [`${dh(cents)} DH`, v.salon],
          ['Direction', 'Collect'],
          ...(short > 0 ? [['Stays on the line for next week', `${dh(short)} DH`]] : []),
          ['Into your bag', `${dh(bag.in_bag_cents + cents)} DH`],
        ].map(([a, b]) => (
          <View key={a + b} style={s.sumRow}>
            <T size={12} c={D.sub} style={s.grow}>{a}</T>
            <T w="sb" size={12.5} style={s.num}>{b}</T>
          </View>
        ))}
      </View>

      <T w="b" size={12.5} style={s.codeAsk}>Ask {v.owner.split(' ')[0]} for the 4 digits on his phone</T>
      <View style={s.codeRow}>
        {[0, 1, 2, 3].map((i) => (
          <Pressable key={i} onPress={() => setCode('')} style={s.codeBox}>
            <T w="b" size={24} style={s.num}>{code[i] ?? ''}</T>
            {code.length === i && <T style={s.codeCaret}>|</T>}
          </Pressable>
        ))}
      </View>
      <View style={s.pad3}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '<'].map((k, i) => (
          <Pressable key={i} disabled={!k}
            onPress={() => setCode((c) => (k === '<' ? c.slice(0, -1) : (c + k).slice(0, 4)))}
            style={[s.keyB, !k && s.keyGhost]}>
            {k === '<'
              ? <Ico name="delete" size={18} color={D.sub} />
              : <T w="sb" size={20} style={s.num}>{k}</T>}
          </Pressable>
        ))}
      </View>
      <T size={11} c={D.faint} style={s.codeWhy}>
        His app shows it under this week&rsquo;s statement. It changes every visit,
        and it is what proves you were in the shop.
      </T>

      <View style={s.noUndo}>
        <Ico name="lock" size={15} color={D.accent} />
        <T size={11.5} c={D.textDim} style={s.grow}>
          There is no undo. The moment you tap, this is on his statement and in
          our books. A wrong number can only be fixed by a new line next week —
          so count it twice, not once.
        </T>
      </View>

      {/* §5: two separate promises on one screen. The first is not softened by
          the second and they are never merged into one gentler sentence. */}
      {!online && (
        <View style={s.offlinePanel}>
          <Ico name="wifi-off" size={15} color={D.amber} />
          <T size={11.5} c={D.textDim} style={s.grow}>
            And I can&rsquo;t check {code || 'his code'} until we have signal. The
            money is recorded now; the proof waits.
          </T>
        </View>
      )}

      <Btn title={busy ? 'RECORDING…'
          : online ? `RECORD ${dh(cents)} DH COLLECTED`
          : `RECORD ${dh(cents)} DH · CHECK LATER`}
        bg={code.length === 4 && !busy ? D.accent : D.card2}
        fg={code.length === 4 && !busy ? '#fff' : D.faint}
        height={54} ls={0.7}
        onPress={() => { if (code.length === 4 && !busy) record(); }} />
      <T w="sb" size={12} c={D.sub} style={s.centre} onPress={onClose}>
        Go back and count again
      </T>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// AGT-04 — the receipt
// ---------------------------------------------------------------------------
function ReceiptScreen({ d, onNext }: { d: Done; onNext: () => void }) {
  const collect = d.direction === 'collect';
  const queued = d.verification === 'queued';
  const amount = collect ? (d.taken_cents ?? 0) : (d.handed_cents ?? 0);
  const open = d.open_cents ?? 0;

  return (
    <Screen bottom={TAB_INSET}>
      <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
        <View style={s.tick}>
          <Ico name="check" size={26} color={queued ? D.amber : collect ? D.accent : D.green} />
        </View>
        <T style={s.rBig}>{dh(amount)} DH</T>
        <T size={12} c={D.sub} style={s.centre}>
          {collect ? 'Collected from' : 'Handed to'} {d.salon} · {hhmm()}
        </T>

        {/* §5: RECORDED · HIS CODE NOT CHECKED YET. Amber and dashed, never red
            — red is for failure and he has not failed. */}
        {queued && (
          <View style={s.provisional}>
            <T w="eb" size={9.5} c={D.amber} ls={1.3}>RECORDED · HIS CODE NOT CHECKED YET</T>
            <View style={s.provRow}>
              <T size={11.5} c={D.sub} style={s.grow}>The money</T>
              <T size={11.5} c={D.green}>in your bag, counted, done</T>
            </View>
            <View style={s.provRow}>
              <T size={11.5} c={D.sub} style={s.grow}>His code {d.code}</T>
              <T size={11.5} c={D.amber}>waiting to be checked</T>
            </View>
          </View>
        )}

        <View style={s.facts}>
          {[
            ['Receipt', d.receipt],
            // the method is on the receipt because that is what makes it evidence
            ['Confirmed by', !collect ? "the owner's signature"
              : queued ? `his code ${d.code} — not checked yet`
              : `the owner's code · ${d.code}`],
            ['Week', `${d.visit.week.slice(-2)}`],
          ].map(([k, val]) => (
            <View key={k} style={s.factRow}>
              <T size={12} c={D.sub} style={s.grow}>{k}</T>
              <T w="sb" size={12} style={s.num}>{val}</T>
            </View>
          ))}
        </View>

        {collect && open > 0 && (
          <View style={s.shortPanel}>
            <T w="b" size={12.5} c={D.amber}>{dh(open)} DH still with the shop</T>
            <T size={11.5} c={D.sub} style={s.shortBody}>
              It stays on week {d.visit.week.slice(-2)}&rsquo;s line and moves onto next
              Friday&rsquo;s statement as its own line at day {d.visit.limit_days}. You do
              not need to come back for it — the run will put it on someone&rsquo;s round.
            </T>
          </View>
        )}

        <View style={s.note}>
          <T size={11.5} c={D.sub}>
            He already has the receipt in his app and the line now reads {dh(amount)} DH
            paid, so you do not need to send him anything.
          </T>
        </View>
        <View style={s.dashed}>
          <T size={11.5} c={D.faint}>
            A wrong number cannot be changed here. Tell ops — they add a
            correcting line to next week&rsquo;s statement, and it will say your name.
          </T>
        </View>
      </ScrollView>
      <View style={s.foot}>
        <Btn title="NEXT VISIT" height={54} ls={0.8} onPress={onNext} />
      </View>
    </Screen>
  );
}


// ---------------------------------------------------------------------------
// AGT-18 — the code didn't match
// ---------------------------------------------------------------------------
// He is 30 km away with the cash already in his bag. §6: this must not read as
// an accusation — the likeliest cause is a stale code on the owner's screen,
// and `I mistyped it` is the commonest answer, so it is offered plainly and
// first among equals rather than buried as a confession.
//
// He does not phone and does not drive back. Ops rings the owner.
function MismatchScreen({ p, onDone }: { p: Paused; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  const say = async (saw: 'owner_read' | 'barber_read' | 'mistyped') => {
    setBusy(true);
    const { error } = await supabase.rpc('agent_explain_mismatch', {
      p_receipt: p.receipt, p_saw: saw,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not send that', error.message);
    onDone();
  };

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="One code didn't match" plain />
      <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
        <View style={s.mmHero}>
          <T w="b" size={10} c={D.amber} ls={1.5}>THE CODE DIDN&rsquo;T MATCH</T>
          <T style={s.owesBig}>{dh(p.cents)} DH</T>
          <T size={12} c={D.sub} style={s.mmBody}>
            {p.salon} · you typed {p.code}. That is not the number {p.owner}&rsquo;s app
            issued — usually because his app had been closed a while and was
            showing an old one.
          </T>
        </View>

        <View style={s.mmFacts}>
          <View style={s.provRow}>
            <T size={11.5} c={D.sub} style={s.grow}>The money</T>
            <T size={11.5} c={D.green}>stays as recorded — nothing reversed</T>
          </View>
          <View style={s.provRow}>
            <T size={11.5} c={D.sub} style={s.grow}>His statement</T>
            <T size={11.5} c={D.textDim}>unchanged</T>
          </View>
          <View style={s.provRow}>
            <T size={11.5} c={D.sub} style={s.grow}>Who calls him</T>
            <T size={11.5} c={D.textDim}>we do, not you</T>
          </View>
        </View>

        <T w="b" size={10} c={D.sub} ls={1.5} style={s.section}>WHAT DID YOU SEE?</T>
        <T size={11.5} c={D.sub} style={s.mmAsk}>
          This is the one thing only you know. Any of these is a normal answer.
        </T>

        {([
          ['mistyped', 'I mistyped it', 'Four digits, one hand, in a hurry. It happens most weeks.'],
          ['owner_read', `${p.owner} read it off his own phone`, 'Then his app was probably showing a stale number.'],
          ['barber_read', 'A barber read it out, not the owner', 'The owner may not have been there at all.'],
        ] as const).map(([k, title, why]) => (
          <Pressable key={k} disabled={busy} onPress={() => say(k)} style={s.mmOpt}>
            <View style={s.grow}>
              <T w="sb" size={12.5}>{title}</T>
              <T size={11} c={D.faint} style={s.gap2}>{why}</T>
            </View>
            <Ico name="chevron-right" size={15} color={D.muted} />
          </Pressable>
        ))}

        <T size={11} c={D.muted} style={s.mmFoot}>
          Your round starts again as soon as you answer. You do not need to go
          back to the shop, and you do not need to ring anyone.
        </T>
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// AGT-06 / AGT-07 — no code, and leaving without closing
// ---------------------------------------------------------------------------
// §2: three rungs he works alone, in cost order, then the call. The third rung
// REFUSES a code read down the phone — a code spoken over a phone proves the
// owner agreed, not that the agent is in the shop, and accepting it once would
// make every code in the system assert only the weaker of the two facts.
//
// §2's friction is a number about himself, not a delay. No timer: a timer just
// teaches agents to wait it out.
function LadderScreen({ v, holding, onBack, onDone }: {
  v: Visit; holding: boolean; onBack: () => void; onDone: () => void;
}) {
  const [rates, setRates] = useState<{ calls: number; team_calls: number;
    abandons: number; team_abandons: number } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc('agent_rates', {}).then(({ data }) => data && setRates(data));
  }, []);

  const call = async (reason: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('agent_request_ops_call', {
      p_visit: v.id, p_reason: reason,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not send that', error.message);
    Alert.alert('The desk is ringing him',
      'Stay in the shop and do not say the amount yet. They will ring the owner '
      + 'on the number we have, ask him the amount first, then ask you.');
    onDone();
  };

  const leave = async (reason: string) => {
    setBusy(true);
    const { error } = await supabase.rpc('agent_abandon_visit', {
      p_visit: v.id, p_reason: reason,
    });
    setBusy(false);
    if (error) return Alert.alert('Could not record that', error.message);
    onDone();
  };

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title="He can't give me the code" onBack={onBack} />
      <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
        <T size={12} c={D.sub} style={s.sub}>
          {v.salon} · {dh(v.amount_cents)} DH. Three things to try before we ring anyone.
        </T>

        {[
          ['1', 'He is on the wrong screen',
           'The four digits are top right of This week’s statement — not in the receipts list.'],
          ['2', 'Any other phone',
           'shop.sterncut.ma, and he types his own number. Log him out afterwards.'],
          ['3', 'Ring him if he isn’t here',
           'A barber cannot stand in for him. And if he answers, do not take the digits down the phone — that proves he agreed, not that you are here. Tap below and the desk takes it from there.'],
        ].map(([n, title, why]) => (
          <View key={n} style={s.rung}>
            <View style={s.rungNo}><T w="b" size={12} c={D.sub}>{n}</T></View>
            <View style={s.grow}>
              <T w="sb" size={13}>{title}</T>
              <T size={11.5} c={D.sub} style={s.rungWhy}>{why}</T>
            </View>
          </View>
        ))}

        {/* §2: the number sits on the screen BEFORE he taps */}
        {rates && (
          <View style={s.rateStrip}>
            <T size={11.5} c={D.sub} style={s.grow}>
              You have asked for the desk{' '}
              <T w="sb" size={11.5} c={D.textDim}>{rates.calls} times in 30 days</T>
              {' '}· the team averages {rates.team_calls}.
            </T>
          </View>
        )}

        <T w="b" size={10} c={D.sub} ls={1.5} style={s.section}>ASK THE DESK TO RING HIM</T>
        {([
          ['owner_unreachable', 'He isn’t here and isn’t answering'],
          ['app_no_code', 'His app isn’t showing a code'],
          ['code_rejected_3x', 'The code keeps being rejected'],
        ] as const).map(([k, label]) => (
          <Pressable key={k} disabled={busy} onPress={() => call(k)} style={s.mmOpt}>
            <T w="sb" size={12.5} style={s.grow}>{label}</T>
            <Ico name="phone" size={15} color={D.accent} />
          </Pressable>
        ))}

        {/* §3's fourth brake. Holding counted cash removes the option — this is
            the one place the product refuses him an exit. */}
        {holding ? (
          <View style={s.noExit}>
            <Ico name="lock" size={15} color={D.amber} />
            <T size={11.5} c={D.textDim} style={s.grow}>
              You have counted his money, so you cannot leave this open. The desk
              is the only way out of a visit where cash has already moved.
            </T>
          </View>
        ) : !leaving ? (
          <T w="sb" size={12} c={D.sub} style={s.leaveLink} onPress={() => setLeaving(true)}>
            Leave without closing
          </T>
        ) : (
          <View style={s.leaveBox}>
            <T w="b" size={12.5}>Leaving is recorded, not blank</T>
            <T size={11.5} c={D.sub} style={s.leaveWhy}>
              Your name, the time and where you are. {v.owner} sees a line saying
              you came and could not close. The money does not go away — day{' '}
              {v.age_days ?? '—'} of {v.limit_days} keeps counting and this shop
              comes back tomorrow, at the top of your round.
              {rates ? ` You have left ${rates.abandons} in 30 days; the team averages ${rates.team_abandons}.` : ''}
            </T>
            {([
              ['shop_closed', 'The shop is closed'],
              ['owner_absent', 'He isn’t here at all'],
              ['other', 'Something else'],
            ] as const).map(([k, label]) => (
              <Pressable key={k} disabled={busy} onPress={() => leave(k)} style={s.leaveOpt}>
                <T size={12.5} style={s.grow}>{label}</T>
                <Ico name="chevron-right" size={14} color={D.muted} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// AGT-05 — handing over
// ---------------------------------------------------------------------------
// No keypad: §2.5 says a hand-over is all of it or nothing, so there is no
// amount to type. And no code: a code proves he was present, which was never
// the question in this direction.
function HandOverScreen({ v, bag, onBack, onDone }: {
  v: Visit; bag: Bag; onBack: () => void; onDone: (d: Done) => void;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const cur = useRef('');
  const [counted, setCounted] = useState(false);
  const [busy, setBusy] = useState(false);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        cur.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
      },
      onPanResponderMove: (e) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        cur.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
      },
      onPanResponderRelease: () => {
        if (cur.current.includes('L')) setPaths((p) => [...p, cur.current]);
        cur.current = '';
      },
    }),
  ).current;

  const signed = paths.length > 0;

  const record = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('agent_hand_over', {
      p_visit: v.id, p_signature: JSON.stringify(paths),
    });
    setBusy(false);
    if (error) return Alert.alert('Not recorded', error.message);
    onDone({ ...(data as Done), direction: 'pay_out', visit: v });
  };

  return (
    <Screen bottom={TAB_INSET}>
      <TopBar title={v.salon} onBack={onBack} />
      <ScrollView contentContainerStyle={s.pad} showsVerticalScrollIndicator={false}>
        <View style={s.row}>
          <T size={12} c={D.sub} style={s.grow}>{v.owner}</T>
          <View style={[s.chip, { backgroundColor: 'rgba(74,222,128,0.16)' }]}>
            <T w="eb" size={9.5} c={D.green} ls={1.2}>HAND OVER</T>
          </View>
        </View>

        <View style={s.give}>
          <T w="b" size={10} c={D.green} ls={1.4}>COUNT OUT OF YOUR BAG AND GIVE HIM</T>
          <T style={s.owesBig}>{dh(v.amount_cents)} DH</T>
          <T size={11.5} c={D.sub} style={s.giveBody}>
            All of it, or nothing. A hand-over is not partial — if you are short,
            close the visit and ops puts it on another round.
          </T>
          <View style={s.tiles}>
            <View style={s.tile}>
              <T size={10} c={D.faint} ls={1.2}>IN YOUR BAG</T>
              <T w="b" size={14} style={s.num}>{dh(bag.in_bag_cents)} DH</T>
            </View>
            <View style={s.tile}>
              <T size={10} c={D.faint} ls={1.2}>AFTER THIS</T>
              <T w="b" size={14} style={s.num}>{dh(bag.in_bag_cents - v.amount_cents)} DH</T>
            </View>
          </View>
        </View>

        <Pressable onPress={() => setCounted(true)} style={[s.step, counted && s.stepOn]}>
          <View style={[s.stepDot, counted && s.stepDotOn]}>
            {counted && <Ico name="check" size={11} color="#0D0D0F" />}
          </View>
          <T size={12.5} c={counted ? D.green : D.textDim} style={s.grow}>
            {counted ? `He counted it himself · ${hhmm()}` : 'He counted it himself'}
          </T>
        </Pressable>

        <View style={[s.step, !counted && s.stepOff]}>
          <View style={[s.stepDot, signed && s.stepDotOn]}>
            {signed && <Ico name="check" size={11} color="#0D0D0F" />}
          </View>
          <T size={12.5} c={counted ? D.textDim : D.faint} style={s.grow}>
            Hand him the phone to sign
          </T>
          {signed && (
            <T size={11} c={D.sub} onPress={() => setPaths([])}>Clear</T>
          )}
        </View>

        <View style={s.padWrap} {...(counted ? pan.panHandlers : {})}>
          <Svg width="100%" height={132}>
            {paths.map((p, i) => (
              <Path key={i} d={p} stroke={D.text} strokeWidth={2.2} fill="none"
                strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </Svg>
          <View style={s.baseline} />
          {!counted && (
            <View style={s.padLock}>
              <T size={11.5} c={D.faint}>Let him count it first</T>
            </View>
          )}
        </View>
        <T size={11} c={D.faint} style={s.signWhy}>
          {v.owner} · on this phone · {hhmm()}. The signature is saved with the
          time and this device. No code is asked for here — a code proves he was
          present, and that was never the question.
        </T>

        <View style={s.noUndo}>
          <Ico name="lock" size={15} color={D.green} />
          <T size={11.5} c={D.textDim} style={s.grow}>
            Tapping says the cash left your hand. His app shows it as received
            within a minute. If it does not, do not tap again — call ops.
          </T>
        </View>
      </ScrollView>

      <View style={s.foot}>
        <Btn title={busy ? 'RECORDING…' : `RECORD ${dh(v.amount_cents)} DH HANDED OVER`}
          bg={signed && !busy ? D.green : D.card2}
          fg={signed && !busy ? '#0D0D0F' : D.faint}
          height={54} ls={0.7}
          onPress={() => { if (signed && !busy) record(); }} />
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  pad: { paddingHorizontal: 18, paddingBottom: 30 },
  grow: { flex: 1 },
  centre: { textAlign: 'center' },
  num: { fontVariant: ['tabular-nums'] },
  gap2: { marginTop: 2 },
  sub: { marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  right: { alignItems: 'flex-end', gap: 3 },
  rightTop: { alignItems: 'flex-end' },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },

  bag: { backgroundColor: D.card, borderRadius: 18, padding: 17, gap: 9 },
  bagTop: { flexDirection: 'row', alignItems: 'center' },
  bagBig: { fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'], color: D.text },
  track: { height: 6, borderRadius: 3, backgroundColor: D.card2, overflow: 'hidden' },
  track2: { height: 5, borderRadius: 3, backgroundColor: D.card2, overflow: 'hidden', marginTop: 11 },
  fill: { height: '100%', borderRadius: 3 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, backgroundColor: D.bg, borderRadius: 12, padding: 11, gap: 3 },
  warn: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 2,
    backgroundColor: 'rgba(232,161,0,0.09)', borderRadius: 12, padding: 11,
  },

  dropRow: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2,
    borderTopWidth: 1, borderTopColor: D.hairline, paddingTop: 12,
  },
  head: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 10 },
  empty: { alignItems: 'center', gap: 9, paddingVertical: 40 },
  card: {
    backgroundColor: D.card, borderRadius: 16, borderWidth: 1, padding: 15, marginBottom: 11,
  },
  cardLater: { backgroundColor: D.bg, opacity: 0.62 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardFoot: {
    flexDirection: 'row', alignItems: 'center', marginTop: 11, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: D.hairline,
  },

  owes: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  owesBig: { fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'], color: D.text, marginTop: 3 },
  label: { marginTop: 20, marginBottom: 9 },
  amount: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: D.accent,
    borderRadius: 14, paddingHorizontal: 16, height: 62,
  },
  amountText: { fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'], color: D.text },
  caret: { fontSize: 24, color: D.accent, marginLeft: 1 },
  chips: { flexDirection: 'row', gap: 9, marginTop: 11 },
  pill: {
    borderRadius: 999, backgroundColor: D.card2, paddingHorizontal: 13, height: 34,
    alignItems: 'center', justifyContent: 'center',
  },
  pad3: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, marginHorizontal: -4 },
  keyB: {
    width: '33.33%', height: 46, alignItems: 'center', justifyContent: 'center',
  },
  keyGhost: { opacity: 0 },

  shortPanel: {
    marginTop: 16, borderRadius: 14, padding: 15, gap: 6,
    backgroundColor: 'rgba(232,161,0,0.09)',
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.3)',
  },
  shortBody: { lineHeight: 18 },
  overPanel: {
    marginTop: 16, borderRadius: 14, padding: 15,
    backgroundColor: 'rgba(248,113,113,0.09)',
  },
  foot: { paddingHorizontal: 18, paddingBottom: 10 },

  sheetTitle: { marginBottom: 4 },
  summary: { backgroundColor: D.bg, borderRadius: 14, paddingHorizontal: 14 },
  sumRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
  },
  codeAsk: { marginTop: 4 },
  codeRow: { flexDirection: 'row', gap: 10 },
  codeBox: {
    flex: 1, height: 56, borderRadius: 13, backgroundColor: D.bg,
    borderWidth: 1, borderColor: D.border, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row',
  },
  codeCaret: { fontSize: 22, color: D.accent },
  codeWhy: { lineHeight: 16, marginTop: 4 },
  noUndo: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6,
    backgroundColor: 'rgba(232,68,46,0.09)', borderRadius: 14, padding: 14,
  },

  tick: { alignSelf: 'center', marginTop: 26, marginBottom: 10 },
  rBig: {
    fontSize: 30, fontWeight: '800', fontVariant: ['tabular-nums'], color: D.text,
    textAlign: 'center',
  },
  facts: { backgroundColor: D.card, borderRadius: 16, paddingHorizontal: 15, marginTop: 20 },
  factRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  note: { marginTop: 14, backgroundColor: D.card, borderRadius: 14, padding: 14 },
  dashed: {
    marginTop: 11, borderRadius: 14, padding: 14,
    borderWidth: 1, borderStyle: 'dashed', borderColor: D.muted,
  },

  section: { marginTop: 22, marginBottom: 9 },
  rung: {
    flexDirection: 'row', gap: 12, marginBottom: 10,
    backgroundColor: D.card, borderRadius: 16, padding: 15,
  },
  rungNo: {
    width: 24, height: 24, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  rungWhy: { lineHeight: 17, marginTop: 3 },
  rateStrip: {
    flexDirection: 'row', marginTop: 4, borderRadius: 14, padding: 13,
    backgroundColor: D.bg, borderWidth: 1, borderColor: D.border,
  },
  noExit: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 20,
    backgroundColor: 'rgba(232,161,0,0.09)', borderRadius: 14, padding: 14,
  },
  leaveLink: { marginTop: 22, textAlign: 'center' },
  leaveBox: { marginTop: 20, backgroundColor: D.card, borderRadius: 16, padding: 15, gap: 4 },
  leaveWhy: { lineHeight: 18, marginBottom: 6 },
  leaveOpt: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: D.hairline,
  },
  mmHero: {
    marginTop: 4, borderRadius: 18, padding: 18, gap: 6,
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.4)', backgroundColor: D.card,
  },
  mmBody: { lineHeight: 18 },
  mmFacts: { marginTop: 14, backgroundColor: D.card, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 4 },
  mmAsk: { marginBottom: 10, lineHeight: 17 },
  mmOpt: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10,
    backgroundColor: D.card, borderRadius: 16, padding: 15,
  },
  mmFoot: { marginTop: 6, lineHeight: 16, textAlign: 'center' },
  offlinePanel: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 2,
    backgroundColor: 'rgba(232,161,0,0.09)', borderRadius: 14, padding: 14,
  },
  provisional: {
    marginTop: 20, borderRadius: 14, padding: 15, gap: 9,
    borderWidth: 1, borderStyle: 'dashed', borderColor: D.amber,
    backgroundColor: 'rgba(232,161,0,0.06)',
  },
  provRow: { flexDirection: 'row', alignItems: 'center' },
  queueStrip: {
    flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12,
    borderRadius: 14, padding: 13,
    backgroundColor: 'rgba(232,161,0,0.09)',
    borderWidth: 1, borderColor: 'rgba(232,161,0,0.3)',
  },
  give: {
    marginTop: 4, borderRadius: 18, padding: 17, gap: 9,
    borderWidth: 1, borderColor: 'rgba(74,222,128,0.4)', backgroundColor: D.card,
  },
  giveBody: { lineHeight: 18 },
  step: {
    flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 12,
    backgroundColor: D.card, borderRadius: 14, padding: 14,
  },
  stepOn: { backgroundColor: 'rgba(74,222,128,0.08)' },
  stepOff: { opacity: 0.5 },
  stepDot: {
    width: 20, height: 20, borderRadius: 999, borderWidth: 1.5, borderColor: D.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotOn: { backgroundColor: D.green, borderColor: D.green },
  padWrap: {
    marginTop: 12, height: 132, borderRadius: 14, backgroundColor: D.bg,
    borderWidth: 1, borderColor: D.border, overflow: 'hidden', justifyContent: 'center',
  },
  baseline: {
    position: 'absolute', left: 20, right: 20, bottom: 30, height: 1,
    backgroundColor: D.hairline,
  },
  padLock: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
  },
  signWhy: { lineHeight: 16, marginTop: 8 },
});
