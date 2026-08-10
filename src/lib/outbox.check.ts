// Self-check for the offline queue's arithmetic. Runs with the slot math:
//
//     npm run check
//
// Turn 10 promises two things in words — "3 waiting to send", "150 DH counted
// here" — and one in behaviour: a slot somebody else took must stop retrying.
// Those are the three things worth pinning.

import { bump, isConflict, Job, replace, sendable, summarise, without } from './outbox';

let failures = 0;
function ok(label: string, cond: boolean, got?: unknown) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} → ${JSON.stringify(expected)}`, actual === expected, actual);
}

const job = (id: string, at: string, cents?: number): Job => ({
  id, at, label: id, icon: 'check', cents, tries: 0,
  call: { rpc: 'noop', args: {} },
});

// ---- 10a's two counters ----------------------------------------------------
// The morning the design draws: a cut done at 10:48 for 60 DH, a walk-in added
// at 11:14 with nothing paid, and a rating at 10:49.
const morning: Job[] = [
  job('done-mehdi', '2026-08-09T10:48:00Z', 6000),
  job('rate-mehdi', '2026-08-09T10:49:00Z'),
  job('walkin-hicham', '2026-08-09T11:14:00Z'),
];
const sum = summarise(morning);
eq('three things waiting to send', sum.count, 3);
eq('and 60 DH of it is cash he is holding', sum.cents, 6000);
eq('nothing has failed yet', sum.tries, 0);
eq('the queue starts at the first thing he did', sum.since, '2026-08-09T10:48:00Z');
eq('an empty queue holds no cash', summarise([]).cents, 0);
eq('and has no start', summarise([]).since, null);

// a second paid cut adds to the cash he is holding, not to a running total of
// everything he ever did offline
const withSecond = [...morning, job('done-anas', '2026-08-09T11:40:00Z', 9000)];
eq('two cuts, both unsent', summarise(withSecond).cents, 15000);

// ---- retries ---------------------------------------------------------------
// "Tried 4 times since 10:42" is the worst case in the queue, not the sum:
// one stubborn row must not read as four separate failures.
let one = job('done-mehdi', '2026-08-09T10:48:00Z', 6000);
for (let i = 0; i < 4; i++) one = bump(one, 'Network request failed');
eq('four attempts on one job', one.tries, 4);
ok('and it is still worth sending', !one.conflict);
eq('the header quotes the worst case', summarise([one, job('b', '2026-08-09T11:00:00Z')]).tries, 4);

// ---- the one failure retrying cannot fix -----------------------------------
ok('the exclusion constraint is a conflict', isConflict('conflicting key value violates exclusion constraint "no_double_booking"'));
ok('so is claim_slot_offer refusing', isConflict('Someone already took it'));
ok('a dropped connection is not', !isConflict('Network request failed'));
ok('nor is a server hiccup', !isConflict('502 Bad Gateway'));

const clashed = bump(job('walkin-hicham', '2026-08-09T11:14:00Z'), 'Someone already took it');
ok('a clashing job is marked', clashed.conflict === true);
eq('a clash never retries', sendable([clashed, one]).length, 1);
eq('but it stays on the list to be answered', summarise([clashed, one]).conflicts, 1);

// once conflicted, a later network error must not un-flag it
eq('a conflict survives a later timeout', bump(clashed, 'Network request failed').conflict, true);

// ---- the list is his morning, in order -------------------------------------
const patched = replace(morning, { ...morning[1], tries: 2 });
eq('replacing a job keeps its place', patched[1].id, 'rate-mehdi');
eq('and its neighbours', patched[2].id, 'walkin-hicham');
eq('a sent job leaves the queue', without(morning, 'rate-mehdi').length, 2);
eq('removing something absent changes nothing', without(morning, 'nope').length, 3);

// ---- done ------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} outbox check(s) failed.`);
  process.exit(1);
}
console.log('outbox: all checks passed.');
