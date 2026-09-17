// Self-check for the barber's line rules (ADDENDUM-app-first, turns B10 and B11). Runs
// with the rest:
//
//     npm run check
//
// What only this file would notice: CALL NEXT calling a man he dropped before the
// people still in their places; BTD-15 opening before the eight minutes are up; a
// day picker offering a gap that runs into a break, a booking's cleaning time or
// the past; the offer text drifting from what 0119 writes; Home counting the man in
// the chair or an unanswered request as waiting; TAKEN counting a cut not yet done;
// a row's button picked by who the customer is rather than where the row sits.

import {
  calledNotHere, callOrder, canTakeOff, chairList, collectCents, dayGaps, dayMoney, dayWords, firstFits,
  ladderOf, lapsedCall, nextToCall, offerText, rungOf, undoableDone, verbOf, waitingOf,
} from './line';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.error(`FAIL  ${label} → ${e}  (got ${a})`);
}

const at = (h: number, m = 0, dayOffset = 0) => {
  const d = new Date(2026, 8, 17 + dayOffset, h, m);
  return d.toISOString();
};
const row = (id: string, h: number, m: number, extra: Partial<Record<string, string | null>> = {}) => ({
  id, starts_at: at(h, m), checked_in_at: null, started_at: null, completed_at: null, dropped_at: null, ...extra,
});

// ---- who is called, and in what order ----------------------------------------------
const line = [
  row('04', 10, 0, { started_at: at(10, 18) }),
  row('05', 10, 30, { dropped_at: at(10, 40) }),
  row('06', 10, 45),
  row('07', 11, 15),
  row('03', 9, 30, { completed_at: at(10, 0) }),
  row('08', 11, 45, { dropped_at: at(10, 35) }),
];
eq('in their places by start, then the dropped in the order they were dropped',
  callOrder(line).map((r) => r.id), ['06', '07', '08', '05']);
eq('CALL NEXT calls the first man not yet called', nextToCall(line)?.id, '06');
eq('…and a dropped man only once nobody is left in his place',
  nextToCall(line.filter((r) => r.id !== '06' && r.id !== '07'))?.id, '08');

const called = line.map((r) => (r.id === '06' ? { ...r, checked_in_at: at(10, 50) } : r));
eq('a called man who has not sat down is the one asked about', calledNotHere(called)?.id, '06');
eq('BTD-15 does not open inside his eight minutes', lapsedCall(called, new Date(at(10, 57)).getTime()), null);
eq('…and opens once they are up', lapsedCall(called, new Date(at(10, 58)).getTime())?.id, '06');
eq('the next man past him is still 07', nextToCall(called, '06')?.id, '07');

// ---- BTD-19 · the gaps of a day -------------------------------------------------------
const windows = [{ weekday: 5, start_min: 570, end_min: 1140 }];   // Fridays 09:30 – 19:00
const friday = new Date(2026, 8, 18);
const booked = [
  { starts_at: at(11, 0, 1), ends_at: at(11, 30, 1) },
  { starts_at: at(12, 30, 1), ends_at: at(13, 0, 1) },
];
const lunch = [{ day: null, start_min: 840, end_min: 870, kind: 'block' }];   // 14:00 – 14:30
const early = new Date(at(8, 0)).getTime();
const gaps = dayGaps(friday, 35, windows, booked, [], lunch, 15, early)
  .map((g) => [g.startMin, g.minutes, g.fits]);
eq('hours less bookings with their cleaning time, less the break', gaps,
  [[570, 75, true], [705, 30, false], [795, 45, true], [870, 270, true]]);
eq('a day off has no gaps', dayGaps(friday, 35, windows, booked, ['2026-09-18'], lunch, 15, early), []);
eq('room made by hand opens a day he does not usually work',
  dayGaps(new Date(2026, 8, 20), 35, windows, [], [], [{ day: '2026-09-20', start_min: 600, end_min: 660, kind: 'open' }], 0, early)
    .map((g) => [g.startMin, g.minutes]), [[600, 60]]);
eq('the past is dead', dayGaps(friday, 35, windows, [], [], [], 0, new Date(at(18, 0, 1)).getTime())
  .map((g) => [g.startMin, g.minutes]), [[1080, 60]]);
eq('two suggestions from tomorrow, skipping what is too short',
  firstFits(friday, 7, 35, windows, booked, [], lunch, 15, 2, early).map((g) => g.startMin), [570, 795]);

// ---- the text he gets ---------------------------------------------------------------
const now = new Date(2026, 8, 17, 16, 0);
eq('tomorrow is said as tomorrow', dayWords(new Date(2026, 8, 18, 10, 0), now), 'tomorrow');
eq('any other day as 0119 writes it', dayWords(new Date(2026, 8, 19, 10, 0), now), 'Sat 19 Sep');
const text = offerText('Youssef', new Date(2026, 8, 19, 9, 30), 'Le Fade Tanger', now);
eq('the preview is 0119\'s text with the link blanked', text,
  'Sterncut: Youssef offers you Sat 19 Sep 09:30 at Le Fade Tanger. Confirm with one tap: https://sterncut.ma/c/…');

// ---- B11 · one list per chair -------------------------------------------------------
const ME = 'barber';
const chair = (id: string, h: number, m: number, extra: Record<string, unknown> = {}) => ({
  ...row(id, h, m), status: 'confirmed', customer_id: 'client-' + id, price_cents: 6000,
  deposit_cents: 0, joined_line: false, created_at: at(8, 0), ...extra,
});
const day = [
  chair('mehdi', 10, 15, { started_at: at(10, 18), price_cents: 6000 }),
  chair('amine', 11, 0, { checked_in_at: at(10, 58), deposit_cents: 2400 }),
  chair('05', 11, 30, { customer_id: ME, price_cents: 4000 }),
  chair('07', 11, 45, { customer_id: ME }),
  chair('kabbaj', 12, 0, { status: 'pending', price_cents: 9000 }),
  chair('app', 12, 30, { joined_line: true }),
  chair('karim', 9, 30, { started_at: at(9, 31), completed_at: at(10, 0), price_cents: 4000 }),
  chair('gone', 10, 0, { dropped_at: at(10, 40), customer_id: ME }),
];
eq('THE CHAIR: in the chair, the line in call order, a request at its own time, the dropped last',
  chairList(day).map((r) => r.id), ['mehdi', 'amine', '05', '07', 'kabbaj', 'app', 'gone']);
eq('a request is never put behind a man he dropped',
  chairList([...day.filter((r) => r.id !== 'app'), chair('late', 18, 0, { status: 'pending' })]).map((r) => r.id),
  ['mehdi', 'amine', '05', '07', 'kabbaj', 'late', 'gone']);
eq('waiting leaves out the man in the chair and the request nobody accepted',
  waitingOf(day).map((r) => r.id), ['amine', '05', '07', 'app', 'gone']);
eq('taken is only the done cut; booked is every confirmed one',
  dayMoney(day), { takenCents: 4000, bookedCents: 6000 + 6000 + 4000 + 6000 + 6000 + 4000 + 6000 });

const byId = (id: string) => day.find((r) => r.id === id)!;
eq('rungs are read off the timestamps', ['kabbaj', '05', 'amine', 'mehdi', 'karim'].map((id) => rungOf(byId(id))),
  ['request', 'waiting', 'called', 'in_chair', 'done']);
eq('a place in the line is called; a booked time is checked in; then one verb each',
  ['05', 'app', 'amine', 'mehdi', 'kabbaj', 'karim'].map((id) => verbOf(byId(id), ME)),
  ['CALL HIM', 'CALL HIM', 'SEAT HIM', 'DONE', null, null]);
eq("a booking not yet here is HE'S HERE", verbOf(chair('b', 16, 0), ME), "HE'S HERE");
eq('DONE collects what the deposit left', collectCents(byId('amine')), 3600);
const ten = new Date(at(10, 0)).getTime();
eq('take off: a walk-in, a called man, a booking that is due — not an app client still ahead of his time',
  [chair('w', 15, 0, { customer_id: ME }), byId('amine'), chair('due', 9, 45), chair('ahead', 15, 0), byId('mehdi')]
    .map((r) => canTakeOff(r, ME, ten)), [true, true, true, false, false]);

// BTD-22 — the latest done, until somebody sits down after it; no clock anywhere
const cut = (id: string, sat: [number, number], doneAt: [number, number] | null) =>
  chair(id, sat[0], sat[1], { started_at: at(...sat), completed_at: doneAt ? at(...doneAt) : null });
eq('nothing done, nothing to undo', undoableDone([chair('a', 10, 0)]), null);
eq('the latest done can be undone while nobody has sat down since',
  undoableDone([cut('a', [9, 30], [10, 0]), cut('b', [10, 5], [10, 40])])?.id, 'b');
eq('an hour later it still can: time does not close it',
  undoableDone([cut('b', [10, 5], [10, 40]), chair('c', 11, 45)])?.id, 'b');
eq('seating the next man closes it',
  undoableDone([cut('b', [10, 5], [10, 40]), cut('c', [10, 42], null)]), null);
eq('a man already in the chair before the done does not close it',
  undoableDone([cut('a', [10, 0], null), cut('b', [9, 50], [10, 20])])?.id, 'b');
eq('an earlier done is never the one undone',
  undoableDone([cut('a', [9, 30], [10, 0]), cut('b', [10, 5], [10, 40]), cut('c', [10, 50], null)]), null);
eq('the four rungs, with the next one marked',
  ladderOf(byId('amine'), ME).map((s) => [s.label, s.state]),
  [['Booked', 'past'], ["He's here", 'past'], ['In the chair', 'next'], ['Done · 36 DH in cash', 'later']]);
eq('a walk-in climbs the same ladder under line words',
  ladderOf(byId('05'), ME).map((s) => [s.label, s.state]),
  [['In the line', 'past'], ['Called', 'next'], ['In the chair', 'later'], ['Done · 40 DH in cash', 'later']]);

if (failures) {
  console.error(`\n${failures} line check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('line: all checks pass');
