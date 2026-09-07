// Self-check for chat-thread grouping. Runs with the slot math:
//
//     npm run check
//
// The Chats tab drew one row per booking, so three bookings with Mehdi were
// three identical rows. Collapsing them is a two-clause branch (who owns the
// thread) and a two-key sort — the two things worth pinning, plus the fallback
// key that stops every barber-less booking becoming one impossible thread.

import { groupThreads, ThreadRow } from './threads';

let failures = 0;
function ok(label: string, cond: boolean, got?: unknown) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} → ${JSON.stringify(expected)}`, actual === expected, actual);
}

const row = (id: string, peer_id: string | null, starts_at: string, last_at?: string | null)
  : ThreadRow => ({ id, starts_at, peer_id, last_at });

// three bookings with one barber are one thread, not three rows
{
  const t = groupThreads([
    row('b1', 'mehdi', '2026-09-10T10:00Z'),
    row('b2', 'mehdi', '2026-09-12T10:00Z'),
    row('b3', 'mehdi', '2026-09-14T10:00Z'),
  ]);
  eq('one barber, one thread', t.length, 1);
  eq('it keeps all three rows, so a caller can count the upcoming ones',
    t[0].rows.map((r) => r.id).sort().join(','), 'b1,b2,b3');
  eq('nothing said yet, so the soonest owns it', t[0].head.id, 'b1');
}

// whoever spoke last owns the thread, whatever the appointment order
{
  const t = groupThreads([
    row('b1', 'mehdi', '2026-09-10T10:00Z', '2026-09-01T08:00Z'),
    row('b2', 'mehdi', '2026-09-12T10:00Z', '2026-09-05T08:00Z'),
  ]);
  eq('the newest message decides, not the date', t[0].head.id, 'b2');
}

// a booking with messages beats one without, whichever arrives first
for (const reversed of [false, true]) {
  const rows = [
    row('quiet', 'mehdi', '2026-09-09T10:00Z'),
    row('loud', 'mehdi', '2026-09-20T10:00Z', '2026-09-02T08:00Z'),
  ];
  const t = groupThreads(reversed ? rows.reverse() : rows);
  eq(`messages win regardless of input order (reversed=${reversed})`, t[0].head.id, 'loud');
}

// two barbers stay two threads
{
  const t = groupThreads([
    row('b1', 'mehdi', '2026-09-10T10:00Z'),
    row('b2', 'karim', '2026-09-11T10:00Z'),
  ]);
  eq('different people are different conversations', t.length, 2);
}

// the bug the fallback key exists to prevent: "no peer" must not mean
// "everyone with no peer is the same person"
{
  const t = groupThreads([
    row('b1', null, '2026-09-10T10:00Z'),
    row('b2', null, '2026-09-11T10:00Z'),
  ]);
  eq('two unknown peers are not one thread', t.length, 2);
}

// ordering: recent talk first, then soonest appointment
{
  const t = groupThreads([
    row('quiet-late', 'a', '2026-09-20T10:00Z'),
    row('quiet-soon', 'b', '2026-09-11T10:00Z'),
    row('talked', 'c', '2026-09-30T10:00Z', '2026-09-06T08:00Z'),
  ]);
  eq('messages first, then by appointment',
    t.map((x) => x.head.id).join(','), 'talked,quiet-soon,quiet-late');
}

// history joins the thread rather than starting a second one: the whole
// point of widening past live bookings
{
  const t = groupThreads([
    row('last-year', 'mehdi', '2025-09-10T10:00Z', '2025-09-10T11:00Z'),
    row('upcoming', 'mehdi', '2026-09-10T10:00Z'),
  ]);
  eq('an old visit and a future one are one conversation', t.length, 1);
  eq('and both are carried', t[0].rows.length, 2);
  eq('the one that was spoken on owns it', t[0].head.id, 'last-year');
}

eq('an empty inbox groups to nothing', groupThreads([]).length, 0);

if (failures) { console.error(`\nthreads: ${failures} check(s) failed.`); process.exit(1); }
console.log('threads: all checks passed.');
