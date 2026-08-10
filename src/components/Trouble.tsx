import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ico, Sheet, T } from './dark';
import { Job, summarise } from '../lib/outbox';
import { dark as D } from '../theme';

// Turn 10 of "Barber App.dc.html" — when it breaks in the shop.
//
// The rule the whole turn hangs on: **an error must never stop the queue
// moving.** He is mid-cut, one-handed, with someone in the chair. So none of
// these is a modal that blocks the day — the bar is a bar, the two sheets are
// about money and can be dismissed, and every one of them says what is still
// working before it says what isn't.

const dh = (c: number) => Math.round(c / 100).toLocaleString('en-US').replace(/,/g, ' ');
const clock = (d: Date) => d.toTimeString().slice(0, 5);
const initials = (n: string) => n.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

// ---------------------------------------------------------------------------
// 10a — Offline · the day still runs
// ---------------------------------------------------------------------------
export function OfflineBar({ since, jobs, onOpen }: {
  since: Date | null; jobs: Job[]; onOpen?: () => void;
}) {
  const sum = summarise(jobs);
  return (
    <>
      <Pressable onPress={onOpen} style={s.offBar}>
        <View style={s.offIcon}><Ico name="wifi-off" size={16} color={D.amber} /></View>
        <View style={s.grow}>
          <T w="b" size={13} c={D.amber}>
            No signal{since ? ` since ${clock(since)}` : ''}
          </T>
          <T size={11} c={D.sub} style={s.mt2}>
            Carry on — everything saves and sends itself later
          </T>
        </View>
      </Pressable>

      {sum.count > 0 && (
        <View style={s.statRow}>
          <Pressable onPress={onOpen} style={s.stat}>
            <T w="b" size={10} c={D.sub} ls={0.8}>DONE OFFLINE</T>
            <T w="b" size={20} style={s.num}>{sum.count}</T>
            <T size={10} c={D.amber} style={s.mt2}>waiting to send</T>
          </Pressable>
          <View style={s.stat}>
            <T w="b" size={10} c={D.sub} ls={0.8}>CASH TAKEN</T>
            <T w="b" size={20} style={s.num}>
              {dh(sum.cents)}<T size={11} c={D.sub}> DH</T>
            </T>
            <T size={10} c={D.sub} style={s.mt2}>counted here</T>
          </View>
        </View>
      )}
    </>
  );
}

/** 10a's honest footer: the two things that genuinely need the network. */
export function OfflineLimits() {
  return (
    <View style={s.limits}>
      <T w="b" size={10} c={D.sub} ls={1.4}>WHAT YOU CAN'T DO UNTIL IT'S BACK</T>
      {['Take a cash top-up for someone\'s wallet', 'See new bookings coming in'].map((t) => (
        <View key={t} style={s.limitRow}>
          <View style={s.limitDot}><Ico name="x" size={10} color={D.muted} /></View>
          <T size={12} c={D.sub} style={s.grow}>{t}</T>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 10b — Two people, one slot
// ---------------------------------------------------------------------------
// What the exclusion constraint feels like from the chair. He added a walk-in
// offline; somebody booked the same time online and got there first. The default
// is not "whoever I added" — it is **whoever paid**, said out loud at the bottom.
export type Clash = {
  job: Job;
  at: Date;
  /** the booking that won the slot while he was offline */
  theirs: { name: string; bookedAt: string; deposit_cents: number; visits: number } | null;
  /** what he did locally */
  mine: { name: string; addedAt: string };
  /** the next free time we can move somebody to */
  freeAt: Date | null;
};

export function ConflictSheet({ clash, onClose, onResolve }: {
  clash: Clash | null;
  onClose: () => void;
  onResolve: (choice: 'move-mine' | 'move-theirs' | 'both') => void;
}) {
  const [pick, setPick] = useState<'move-mine' | 'move-theirs' | 'both'>('move-mine');
  useEffect(() => { setPick('move-mine'); }, [clash]);
  if (!clash) return null;

  const at = clock(clash.at);
  const free = clash.freeAt ? clock(clash.freeAt) : null;
  const mineFirst = clash.mine.name.split(' ')[0];

  return (
    <Sheet visible={!!clash} onClose={onClose} deep gap={13}>
      <View style={s.center}>
        <View style={s.warnCircle}><Ico name="alert-triangle" size={25} color={D.amber} /></View>
        <T w="b" size={19} style={s.mt12}>Two people at {at}</T>
        <T size={12.5} c={D.sub} style={s.centerBody}>
          {clash.theirs?.name.split(' ')[0] ?? 'Someone'} booked while you were offline.
          You'd already put {mineFirst} in the same slot.
        </T>
      </View>

      {!!clash.theirs && (
        <View style={[s.who, s.whoOn]}>
          <View style={[s.whoAvatar, s.whoAvatarWarm]}>
            <T w="b" size={11} c={D.accent}>{initials(clash.theirs.name)}</T>
          </View>
          <View style={s.grow}>
            <T w="b" size={13}>{clash.theirs.name}</T>
            <T size={11} c={D.sub} style={s.mt2}>
              Booked {clash.theirs.bookedAt}
              {clash.theirs.deposit_cents > 0 ? ` · ${dh(clash.theirs.deposit_cents)} DH paid` : ''}
              {' · '}{clash.theirs.visits} visit{clash.theirs.visits === 1 ? '' : 's'}
            </T>
          </View>
          {clash.theirs.deposit_cents > 0 && (
            <View style={s.paidChip}><T w="b" size={9.5} c={D.accent} ls={0.6}>PAID</T></View>
          )}
        </View>
      )}
      <View style={s.who}>
        <View style={s.whoAvatar}><T w="b" size={11} c={D.sub}>{initials(clash.mine.name)}</T></View>
        <View style={s.grow}>
          <T w="sb" size={13}>{clash.mine.name}</T>
          <T size={11} c={D.sub} style={s.mt2}>
            You added {clash.mine.addedAt} · walk-in · no deposit
          </T>
        </View>
      </View>

      <T w="b" size={10} c={D.sub} ls={1.4}>SORT IT</T>
      <Choice on={pick === 'move-mine'} onPress={() => setPick('move-mine')}
        title={`Move ${mineFirst} to ${free ?? 'later'}`}
        sub={free ? "It's free · he's a walk-in with nothing paid" : 'Nothing free today — he keeps his place in line'} />
      <Choice on={pick === 'move-theirs'} onPress={() => setPick('move-theirs')}
        title={`Move ${clash.theirs?.name.split(' ')[0] ?? 'the booking'} to ${free ?? 'later'}`}
        sub="They get a push and can refuse" disabled={!free || !clash.theirs} />
      <Choice on={pick === 'both'} onPress={() => setPick('both')}
        title="Take both, 20 min each" sub="Tight for a cut and a beard" />

      <Pressable onPress={() => onResolve(pick)} style={s.primary}>
        <T w="b" size={12.5} c="#fff" ls={0.78}>
          {pick === 'both' ? 'TAKE BOTH'
            : pick === 'move-mine' ? `MOVE ${mineFirst.toUpperCase()} & TELL HIM`
              : 'MOVE THE BOOKING & TELL THEM'}
        </T>
      </Pressable>
      <T size={11} c={D.muted} style={s.footNote}>
        Whoever paid keeps the slot unless you say otherwise.
      </T>
    </Sheet>
  );
}

function Choice({ title, sub, on, disabled, onPress }: {
  title: string; sub: string; on: boolean; disabled?: boolean; onPress: () => void;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress}
      style={[s.choice, on && s.choiceOn, disabled && s.dim55]}>
      <View style={[s.radio, on && s.radioOn]}>
        {on && <Ico name="check" size={11} color="#fff" />}
      </View>
      <View style={s.grow}>
        <T w={on ? 'b' : 'sb'} size={12.5}>{title}</T>
        <T size={11} c={D.sub} style={s.mt2}>{sub}</T>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// 10c — Top-up didn't go through
// ---------------------------------------------------------------------------
// The one screen in turn 10 about money that moved in the room but not in the
// books. Its entire job is to say **nothing was taken twice** and to leave him
// two ways out, because he is holding somebody's 200 DH right now.
export type TopUpAttempt = {
  customer: { id: string; name: string; phone: string | null };
  /** balance is null when the call failed before we learned it — better a
   *  missing row than a confident 0 DH next to the word "unchanged" */
  cents: number; balance_cents: number | null; float_cents: number; salon: string;
};

export function TopUpFailedSheet({ attempt, onClose, onRetry, onCallOps }: {
  attempt: TopUpAttempt | null;
  onClose: () => void;
  onRetry: () => void;
  onCallOps: () => void;
}) {
  if (!attempt) return null;
  const first = attempt.customer.name.split(' ')[0];

  // There is nothing to record. The top-up never landed, so no row exists to
  // reverse and his float is untouched — writing a "gave it back" note would be
  // inventing a transaction to describe the absence of one.
  function gaveItBack() {
    Alert.alert('Nothing to undo',
      `${first}'s wallet was never credited and your float never moved. Hand the cash back.`);
    onClose();
  }

  return (
    <Sheet visible={!!attempt} onClose={onClose} deep gap={13}>
      <View style={s.center}>
        <View style={s.failCircle}><Ico name="x" size={25} color={D.red} /></View>
        <T w="b" size={19} style={s.mt12}>Didn't go through</T>
        <T size={12.5} c={D.sub} style={s.centerBody}>
          {first}'s wallet was <T w="b" size={12.5}>not</T> credited. If you've taken his{' '}
          {dh(attempt.cents)} DH, give it back or try again now.
        </T>
      </View>

      <View style={s.moneyCard}>
        <View style={s.row11}>
          <View style={[s.whoAvatar, s.whoAvatarWarm]}>
            <T w="b" size={11} c={D.accent}>{initials(attempt.customer.name)}</T>
          </View>
          <View style={s.grow}>
            <T w="b" size={13}>{attempt.customer.name}</T>
            {!!attempt.customer.phone && (
              <T size={11} c={D.sub} style={s.mt2}>{attempt.customer.phone}</T>
            )}
          </View>
          <T w="eb" size={15} style={s.num}>{dh(attempt.cents)} DH</T>
        </View>
        {attempt.balance_cents != null && (
          <View style={s.moneyLine}>
            <T size={12} c={D.sub} style={s.grow}>Their balance now</T>
            <T w="b" size={12}>{dh(attempt.balance_cents)} DH · unchanged</T>
          </View>
        )}
        <View style={attempt.balance_cents == null ? s.moneyLine : s.row11}>
          <T size={12} c={D.sub} style={s.grow}>Your float</T>
          <T w="b" size={12}>{dh(attempt.float_cents)} DH · unchanged</T>
        </View>
      </View>

      <View style={s.shieldNote}>
        <Ico name="shield" size={14} color={D.green} />
        <T size={11.5} c={D.sub} style={s.shieldText}>
          Nothing was taken twice. A top-up only counts once we've confirmed it.
        </T>
      </View>

      <Pressable onPress={onRetry} style={s.primary}>
        <T w="b" size={12.5} c="#fff" ls={0.78}>TRY AGAIN · {dh(attempt.cents)} DH</T>
      </Pressable>
      <View style={s.twoBtns}>
        <Pressable onPress={gaveItBack} style={s.solidGhost}>
          <T w="b" size={12} ls={0.4}>GAVE IT BACK</T>
        </Pressable>
        <Pressable onPress={onCallOps} style={s.outlineGhost}>
          <T w="b" size={12} c={D.sub} ls={0.4}>CALL OPS</T>
        </Pressable>
      </View>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// 10d — Licence runs out in N days
// ---------------------------------------------------------------------------
// A banner on the home screen, not a screen of its own: nine days out this is
// something to notice between clients, and the day still has to open behind it.
export function LicenceBanner({ standing, onSend }: {
  standing: { days_left: number | null; licence_expires_at: string | null } | null;
  onSend: () => void;
}) {
  if (!standing?.licence_expires_at || standing.days_left == null) return null;
  if (standing.days_left < 0 || standing.days_left > 30) return null;

  const on = new Date(`${standing.licence_expires_at}T00:00:00`)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <View style={s.licence}>
      <View style={s.row11}>
        <View style={s.warnPuck}><Ico name="alert-triangle" size={16} color={D.amber} /></View>
        <View style={s.grow}>
          <T w="b" size={13} c={D.amber}>Your licence expires {on}</T>
          <T size={11} c={D.sub} style={s.mt2}>
            {standing.days_left === 0 ? 'Today' : `${standing.days_left} days`} · takes two minutes to sort
          </T>
        </View>
      </View>
      <T size={12} c={D.textDim} style={s.licenceBody}>
        After that we have to hide you from search until it's renewed. Bookings you
        already have would still stand.
      </T>
      <Pressable onPress={onSend} style={s.amberBtn}>
        <Ico name="camera" size={15} color="#0D0D0F" />
        <T w="eb" size={12} c="#0D0D0F" ls={0.6}>PHOTOGRAPH THE NEW ONE</T>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  mt2: { marginTop: 2 },
  mt12: { marginTop: 12 },
  num: { fontVariant: ['tabular-nums'] },
  dim55: { opacity: 0.55 },
  center: { alignItems: 'center', paddingTop: 2 },
  centerBody: { textAlign: 'center', lineHeight: 19, marginTop: 7 },
  row11: { flexDirection: 'row', alignItems: 'center', gap: 11 },

  // 10a
  offBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine,
    borderRadius: 20, paddingHorizontal: 16, paddingVertical: 14,
  },
  offIcon: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: D.amberSoft16,
    alignItems: 'center', justifyContent: 'center',
  },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: D.card, borderRadius: 18, padding: 14, gap: 3 },
  limits: { backgroundColor: D.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 15, gap: 11 },
  limitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  limitDot: {
    width: 19, height: 19, borderRadius: 10, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },

  // 10b
  warnCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: D.amberSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  who: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14,
    borderWidth: 2, borderColor: 'transparent',
  },
  whoOn: { borderColor: D.accent },
  whoAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  whoAvatarWarm: { backgroundColor: D.accentSoft },
  paidChip: {
    backgroundColor: D.accentSoft, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 4,
  },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: D.card,
    borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14,
    borderWidth: 2, borderColor: 'transparent',
  },
  choiceOn: { borderColor: D.accent },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: D.muted,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: { backgroundColor: D.accent, borderColor: D.accent },
  primary: {
    height: 52, borderRadius: 999, backgroundColor: D.accent,
    alignItems: 'center', justifyContent: 'center',
  },
  footNote: { textAlign: 'center', lineHeight: 17 },

  // 10c
  failCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(248,113,113,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  moneyCard: { backgroundColor: D.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 15, gap: 11 },
  moneyLine: {
    flexDirection: 'row', alignItems: 'center', gap: 9,
    borderTopWidth: 1, borderTopColor: D.border, paddingTop: 11,
  },
  shieldNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9, backgroundColor: D.card2,
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  shieldText: { flex: 1, lineHeight: 18 },
  twoBtns: { flexDirection: 'row', gap: 9 },
  solidGhost: {
    flex: 1, height: 48, borderRadius: 999, backgroundColor: D.card2,
    alignItems: 'center', justifyContent: 'center',
  },
  outlineGhost: {
    flex: 1, height: 48, borderRadius: 999, borderWidth: 1, borderColor: D.border,
    alignItems: 'center', justifyContent: 'center',
  },

  // 10d
  licence: {
    backgroundColor: D.amberSoft12, borderWidth: 1, borderColor: D.amberLine,
    borderRadius: 20, padding: 16, gap: 13,
  },
  warnPuck: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(232,161,0,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  licenceBody: {
    lineHeight: 18, borderTopWidth: 1, borderTopColor: 'rgba(232,161,0,0.2)', paddingTop: 13,
  },
  amberBtn: {
    height: 44, borderRadius: 999, backgroundColor: D.amber, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 7,
  },
});
