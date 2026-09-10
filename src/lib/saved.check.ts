// Self-check for the Saved sections. Runs with the slot math:
//
//     npm run check
//
// Two things here can lie to a customer and only this file would notice: a row
// that cannot be booked landing under FREE TODAY, and a row disappearing from
// the list because it was neither free nor later nor blocked.

import { Filter, SavedBarber, SavedRow, SavedSalon, splitSaved } from './saved';

let failures = 0;
function ok(label: string, cond: boolean, got?: unknown) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} → ${JSON.stringify(expected)}`, actual === expected, actual);
}

const barber = (name: string, free: number | null, over: Partial<SavedBarber> = {}): SavedBarber => ({
  kind: 'barber', id: name, name, salon: 'Le Fade Tanger', rating: 4.86,
  free_today: free, bookable: true, reason: null, has_booking: false, ...over,
});
const salon = (name: string, open: boolean, over: Partial<SavedSalon> = {}): SavedSalon => ({
  kind: 'salon', id: name, name, district: 'Kasbah', from_cents: 4000,
  open, bookable: true, reason: null, has_booking: false, ...over,
});

const ids = (rows: SavedRow[]) => rows.map((r) => r.id).join(',');

// the whole point of the tab: soonest chair first, both kinds in one section
{
  const t = splitSaved([
    barber('Omar Tazi', null),
    salon('Le Fade Tanger', true),
    barber('Youssef El Amrani', 660),          // 11:00
    barber('Bilal Hachimi', 570),              // 09:30
  ]);
  eq('free today is by time, shops after the timed rows',
    ids(t.free), 'Bilal Hachimi,Youssef El Amrani,Le Fade Tanger');
  eq('the rest fall to later', ids(t.later), 'Omar Tazi');
  eq('nothing is blocked', t.blocked.length, 0);
}

// EXPL-26 — a name that can't be booked is never "free today", whatever the
// scan said, and it never leaves the list
{
  const t = splitSaved([
    barber('Mehdi Zniber', 600, { bookable: false, reason: 'No shop on Sterncut' }),
    salon('Marina Barber Club', true, { bookable: false, reason: 'Pulled from search' }),
  ]);
  eq('an unbookable barber with a slot is still not free today', t.free.length, 0);
  eq('nor is a shop that is open but pulled', t.later.length, 0);
  eq('both are kept, greyed', ids(t.blocked), 'Marina Barber Club,Mehdi Zniber');
}

// no row may fall through the three sections — a saved name that renders
// nowhere reads exactly like an unsave we did for them
{
  const rows: SavedRow[] = [
    barber('a', 600), barber('b', null), salon('c', true), salon('d', false),
    barber('e', null, { bookable: false, reason: 'x' }),
  ];
  const t = splitSaved(rows);
  eq('every row lands somewhere', t.free.length + t.later.length + t.blocked.length, rows.length);
  eq('a closed-today shop is later, not blocked', ids(t.later), 'b,d');
}

// the chips filter the view; the counts describe the list
{
  const rows: SavedRow[] = [barber('a', 600), barber('b', null), salon('c', true)];
  for (const f of ['all', 'barber', 'salon'] as Filter[]) {
    const t = splitSaved(rows, f);
    eq(`counts are stable under the ${f} chip`, `${t.counts.all}/${t.counts.barbers}/${t.counts.salons}/${t.counts.free}`,
      '3/2/1/2');
  }
  eq('the barber chip shows only barbers',
    ids(splitSaved(rows, 'barber').free) + '|' + ids(splitSaved(rows, 'barber').later), 'a|b');
  eq('the salon chip shows only salons',
    ids(splitSaved(rows, 'salon').free), 'c');
}

eq('an empty wishlist splits to nothing', splitSaved([]).counts.all, 0);

if (failures) { console.error(`\nsaved: ${failures} check(s) failed.`); process.exit(1); }
console.log('saved: all checks passed.');
