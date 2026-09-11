// Self-check for the barber's own-page rules. Runs with the slot math:
//
//     npm run check
//
// BRV-08's number is judged by customers and BPR-08's lock is enforced by 0109;
// if either drifts from what the server does, the screen says one thing and the
// page does another.

import {
  ReviewRow, disputeOf, filterReviews, formerlyName, nameLockedUntil,
  reviewSummary, sinceYear, yearsFrom,
} from './profileRules';

let failures = 0;
function ok(label: string, cond: boolean, got?: unknown) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} → ${JSON.stringify(expected)}`, actual === expected, actual);
}

const DAY = 86_400_000;

// ---- BRV-08 --------------------------------------------------------------------
{
  const r = (id: string, rating: number, over: Partial<ReviewRow> = {}): ReviewRow => ({
    id, rating, reply: null, state: 'public', flagged_at: null, moderated_at: null, ...over,
  });
  const rows = [
    r('five-replied', 5, { reply: 'Thanks' }),
    r('five', 5),
    r('four', 4, { reply: 'Merci' }),
    r('three-held', 3, { state: 'held', flagged_at: '2026-09-10T10:00:00Z' }),
    r('two-kept', 2, { moderated_at: '2026-09-01T10:00:00Z' }),
    r('two-restored', 2, { moderated_at: '2026-08-20T10:00:00Z', reply: 'Sorry' }),
  ];
  const restored = new Set(['two-restored']);
  const sum = reviewSummary(rows, restored);

  eq('every readable review counts', sum.count, 6);
  eq('average over all of them', sum.average, (5 + 5 + 4 + 3 + 2 + 2) / 6);
  eq('histogram five stars first', sum.histogram.join(','), '2,1,1,2,0');
  eq('unanswered', sum.unanswered, 3);
  eq('three stars and under', sum.low, 3);
  eq('disputed counts held, kept and restored', sum.disputed, 3);
  eq('no reviews has no average', reviewSummary([], new Set()).average, null);

  eq('held is with Sterncut', disputeOf(rows[3], restored), 'with_sterncut');
  eq('restored outranks its moderation date', disputeOf(rows[5], restored), 'restored');
  eq('decided and left up is kept', disputeOf(rows[4], restored), 'kept');
  eq('an untouched review is not a dispute', disputeOf(rows[1], restored), null);

  eq('filter unanswered', filterReviews(rows, 'unanswered', restored).map((x) => x.id).join(','),
    'five,three-held,two-kept');
  eq('filter disputed', filterReviews(rows, 'disputed', restored).length, 3);
  eq('filter all is everything', filterReviews(rows, 'all', restored).length, 6);
}

// ---- BPR-08 --------------------------------------------------------------------------
{
  const now = Date.parse('2026-09-11T12:00:00Z');
  const ago = (days: number) => new Date(now - days * DAY).toISOString();

  ok('changed 59 days ago is still locked', nameLockedUntil(ago(59), now) !== null);
  eq('changed 61 days ago can change', nameLockedUntil(ago(61), now), null);
  eq('never changed can change', nameLockedUntil(null, now), null);
  eq('BPR-06 prints 12 November for a change on 13 September',
    nameLockedUntil('2026-09-13T12:00:00Z', now)?.toISOString().slice(0, 10), '2026-11-12');

  eq('formerly shows inside thirty days', formerlyName('Youssef El Amrani', ago(29), now), 'Youssef El Amrani');
  eq('and not after', formerlyName('Youssef El Amrani', ago(31), now), null);
  eq('no previous name, nothing to show', formerlyName(null, ago(2), now), null);
}

// ---- BPR-06 --------------------------------------------------------------------------
{
  const now = new Date(2026, 8, 11);
  eq('ten years is since 2016', sinceYear(10, now), 2016);
  eq('no experience on file has no year', sinceYear(null, now), null);
  eq('2016 is ten years', yearsFrom(2016, now), 10);
  eq('this year is zero', yearsFrom(2026, now), 0);
  eq('a future year is refused', yearsFrom(2030, now), null);
  eq('past the 80-year check is refused', yearsFrom(1900, now), null);
  eq('not a whole year is refused', yearsFrom(2016.5, now), null);
}

if (failures) {
  console.error(`\n${failures} profile rule check(s) failed`);
  process.exit(1);
}
console.log('profile rules: all checks passed');
