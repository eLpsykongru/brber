// Self-check for the pure slot + bundle-day math. No framework, no new dep:
//
//     npm run check
//
// Everything money or time depends on in turns 34 and 7 that ISN'T in SQL is in
// here. The SQL half has its own `assert` block in 0047/0048; this is the half
// that runs on the phone, and the numbers it pins are the ones both designs draw.

import { Block, daySlots, fitCount, fitsPerDay, makeRoomOptions, Range, slotNote, Window } from './slots';

let failures = 0;
function ok(label: string, cond: boolean, got?: unknown) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} → ${JSON.stringify(expected)}`, actual === expected, actual);
}

// ---- 7c · a full day, back to back ----------------------------------------
// "A full 09:30 – 19:00 day, back to back with your 5-min buffer" → the design
// reads 7 Grooms at 910 DH against 16 single cuts at 960 DH.
const DAY = 19 * 60 - (9 * 60 + 30);   // 570
const BUF = 5;
eq('the drawn day is 570 min', DAY, 570);
eq('Grooms that fit a full day', fitsPerDay(DAY, 70, BUF), 7);
eq('single cuts that fit the same day', fitsPerDay(DAY, 30, BUF), 16);
eq('all Grooms, in cents', fitsPerDay(DAY, 70, BUF) * 13000, 91000);
eq('all single cuts, in cents', fitsPerDay(DAY, 30, BUF) * 6000, 96000);
eq('fewer chances to be booked', fitsPerDay(DAY, 30, BUF) - fitsPerDay(DAY, 70, BUF), 9);
// a barber with no hours set must not read as an infinitely productive day
eq('no working hours → nothing fits', fitsPerDay(0, 70, BUF), 0);
eq('a zero-length service never divides by zero', fitsPerDay(DAY, 0, 0), 0);

// ---- 34c · 70 minutes does not fit a 30-minute grid ------------------------
// A day far enough ahead that nothing is 'past'.
const day = new Date();
day.setDate(day.getDate() + 30);
day.setHours(0, 0, 0, 0);
const windows: Window[] = [{ weekday: day.getDay(), start_min: 570, end_min: 1140 }];

const empty = daySlots(day, 30, windows, [], [], [], 0);
const empty70 = daySlots(day, 70, windows, [], [], [], 0);
ok('an empty day offers single-service slots', empty.length > 0, empty.length);
ok('a 70-min sitting has fewer start times than a 30-min one',
  empty70.length < empty.length, [empty70.length, empty.length]);
ok('an empty day is all free', empty.every((s) => s.status === 'free'));

// Two bookings leaving exactly one 60-minute hole: 10:00–11:00 and 12:00–13:00.
// A 30-min service fits the hole; a 70-min sitting cannot.
const at = (min: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min).toISOString();
const booked: Range[] = [
  { starts_at: at(570), ends_at: at(660) },    // 09:30 – 11:00
  { starts_at: at(720), ends_at: at(1140) },   // 12:00 – 19:00
];
const free30 = daySlots(day, 30, windows, booked, [], [], 0).filter((s) => s.status === 'free');
const free70 = daySlots(day, 70, windows, booked, [], [], 0).filter((s) => s.status === 'free');
eq('a 60-min hole takes two 30-min services', free30.length, 2);
eq('the same hole takes no 70-min sitting', free70.length, 0);

// fitCount is what 34c's "N of M times" line reads.
const counts = fitCount(day, 70, windows, booked, [], [], 0);
eq('nothing fits 70 min on that day', counts.fits, 0);
ok('but the day still has start times to compare against', counts.all > 0, counts.all);
ok('fits never exceeds the total', counts.fits <= counts.all);

// a day off is closed, whatever the hours say
eq('a day off offers nothing', daySlots(day, 30, windows, [], [dayStr(day)], [], 0).length, 0);
function dayStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- 34c · the caption under a slot that fits ------------------------------
// 11:00 start, 70 min, next booking at 12:30 → "leaves a 20-min gap after".
const note = slotNote(
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 11, 0), 70,
  windows, [{ starts_at: at(750), ends_at: at(810) }], [],
);
eq('the gap a 70-min sitting leaves', note, 'fits · leaves a 20-min gap after');

const breakBlocks: Block[] = [{ day: null, start_min: 660, end_min: 690 }]; // 11:00–11:30
const afterBreak = slotNote(
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 11, 30), 70, windows, [], breakBlocks,
);
eq('a slot butting onto the end of a break', afterBreak, 'fits · straight after his break');

// ---- 8j/8k · making room on a day with nothing left ------------------------
// The full day the design draws: 09:30–19:00, a lunch break, and a book with no
// gap in it. Nothing is free, so no offer can be anchored — that is 8j.
const fullBooked: Range[] = [
  { starts_at: at(570), ends_at: at(720) },     // 09:30 – 12:00
  { starts_at: at(780), ends_at: at(1140) },    // 13:00 – 19:00, either side of lunch
];
const lunch: Block[] = [{ day: dayStr(day), start_min: 720, end_min: 780, label: 'Lunch' }];
eq('a fully booked day has nothing to offer',
  daySlots(day, 30, windows, fullBooked, [], lunch, 0).filter((s) => s.status === 'free').length, 0);

const opts = makeRoomOptions(day, 30, windows, fullBooked, [], lunch, 0);
eq('a full day still has somewhere to take a slot from', opts.length, 2);
eq('the first source is the end of the day', opts[0].source, 'later');
eq('staying open later starts at closing time', opts[0].startMin, 1140);
eq('and says what the new closing time is', opts[0].sub, 'Close 19:30 instead of 19:00');
eq('the second source is the break', opts[1].source, 'break');
eq('a 60-min lunch cut to 15 frees the 15-min mark', opts[1].startMin, 735);
eq('the break option names the break', opts[1].title, 'Cut Lunch to 15 min');

// a 30-min break cannot spare 30 min and still be a break
eq('a break too short to cut is not an option',
  makeRoomOptions(day, 30, windows, fullBooked, [],
    [{ day: dayStr(day), start_min: 720, end_min: 750, label: 'Lunch' }], 0).length, 1);

// ---- the room he made is bookable, and only once -----------------------------
const made: Block[] = [...lunch, { day: dayStr(day), start_min: 1140, end_min: 1170, kind: 'open' }];
const withRoom = daySlots(day, 30, windows, fullBooked, [], made, 0);
const madeSlot = withRoom.find((s) => s.time.getHours() === 19 && s.time.getMinutes() === 0);
ok('made room shows up past closing time', !!madeSlot);
eq('and it is free', madeSlot?.status, 'free');
eq('made room is the only free slot on a full day',
  withRoom.filter((s) => s.status === 'free').length, 1);
eq('a day off does not hide room he deliberately made',
  daySlots(day, 30, windows, fullBooked, [dayStr(day)], made, 0)
    .filter((s) => s.status === 'free').length, 1);
eq('but a booking in it does — room can still only be taken once',
  daySlots(day, 30, windows, [...fullBooked, { starts_at: at(1140), ends_at: at(1170) }], [], made, 0)
    .filter((s) => s.status === 'free').length, 0);

// (c) the cleaning-time option: two bookings 15 min apart with a 15-min buffer.
// The 30-min slot between them is full only because of the buffer.
const tight: Range[] = [
  { starts_at: at(570), ends_at: at(660) },     // 09:30 – 11:00
  { starts_at: at(690), ends_at: at(1140) },    // 11:30 – 19:00
];
eq('the buffer hides the slot between two clients',
  daySlots(day, 30, windows, tight, [], [], 15).filter((s) => s.status === 'free').length, 0);
const bufOpt = makeRoomOptions(day, 30, windows, tight, [], [], 15)
  .find((o) => o.source === 'buffers');
ok('dropping the buffers is offered when it would free something', !!bufOpt);
eq('and it points at the slot the buffer was hiding', bufOpt?.startMin, 660);
eq('it names the clients whose cleaning time goes', bufOpt?.sub, 'No cleaning time between 2 clients');
ok('and it is the one option that costs something', bufOpt?.warn === true);
eq('with no buffer set there is nothing to drop',
  makeRoomOptions(day, 30, windows, tight, [], [], 0).filter((o) => o.source === 'buffers').length, 0);

// 8j's "too late to open anything today": every source is in the past
const past = new Date();
past.setHours(0, 0, 0, 0);
eq('a day whose sources have all passed offers none',
  makeRoomOptions(past, 30, [{ weekday: past.getDay(), start_min: 0, end_min: 1 }], [], [], [], 0).length, 0);

// ---- done ------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('slots + bundle-day math: all checks passed.');
