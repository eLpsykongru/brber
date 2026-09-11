// Self-check for the notification-gap rules. Runs with the slot math:
//
//     npm run check
//
// Three screens read these: BDY-14 says whether a move fits the day, BNT-05 says
// what the chair held back, NTF-10 says what never reached the phone. Each is a
// sentence about someone's own day, so each branch that could quietly lie is here.

import {
  Ask, Attempt, Busy, Fit, InboxNotif, asksFor, fitAt, heldDuringCut, laneOf,
  missedWhilePushOff, ordinal, sortWorth, spanLabel,
} from './inboxRules';

let failures = 0;
function ok(label: string, cond: boolean, got?: unknown) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} → ${JSON.stringify(expected)}`, actual === expected, actual);
}

// local times throughout: the rules read the device's own clock, as the app does
const at = (h: number, m = 0, day = 12) => new Date(2026, 8, day, h, m);   // Sat 12 Sep 2026
const iso = (h: number, m = 0, day = 12) => at(h, m, day).toISOString();

// ---- words ------------------------------------------------------------------
eq('80 minutes reads as minutes', spanLabel(80 * 60_000), '80 minutes');
eq('1 h 45 keeps the minutes', spanLabel(105 * 60_000), '1 h 45');
eq('a round three hours', spanLabel(180 * 60_000), '3 h');
eq('two days', spanLabel(48 * 3_600_000), '2 days');
eq('negative notice is none', spanLabel(-5 * 60_000), '0 minutes');
eq('ordinal 1', ordinal(1), '1st');
eq('ordinal 2', ordinal(2), '2nd');
eq('ordinal 4', ordinal(4), '4th');
eq('ordinal 11 is not 11st', ordinal(11), '11th');
eq('ordinal 13', ordinal(13), '13th');
eq('ordinal 22', ordinal(22), '22nd');

// the tsc here runs without --strict, where a boolean discriminant does not narrow
const why = (f: Fit) => ('why' in f ? f.why : 'ok');

// ---- BDY-14 · fitAt -----------------------------------------------------------
{
  const hours = [{ weekday: 6, start_min: 9 * 60, end_min: 19 * 60 }];   // Saturday 09:00–19:00
  const busy: Busy[] = [{ id: 'b1', starts_at: iso(14), ends_at: iso(14, 30), who: 'Mehdi' }];
  const lunch = [{ day: null, start_min: 12 * 60, end_min: 12 * 60 + 30 }];

  eq('an empty hour fits', fitAt(at(16), 30, hours, busy, [], lunch, 0).ok, true);
  const clash = fitAt(at(14, 15), 30, hours, busy, [], lunch, 0);
  eq('a true overlap is booked', why(clash), 'booked');
  const tight = fitAt(at(14, 30), 30, hours, busy, [], lunch, 15);
  eq('straight after a cut with a 15-min buffer is the buffer', why(tight), 'buffer');
  eq('straight after a cut with no buffer fits', fitAt(at(14, 30), 30, hours, busy, [], lunch, 0).ok, true);
  const late = fitAt(at(18, 45), 30, hours, busy, [], lunch, 0);
  eq('running past closing is closed', why(late), 'closed');
  const brk = fitAt(at(12, 15), 30, hours, busy, [], lunch, 0);
  eq('inside the lunch break is the break', why(brk), 'break');
  const off = fitAt(at(16), 30, hours, busy, ['2026-09-12'], lunch, 0);
  eq('a day off beats everything', why(off), 'day_off');

  // 8k — room made by hand outranks hours and breaks, never a booking
  const made = [{ day: '2026-09-12', start_min: 19 * 60, end_min: 20 * 60, kind: 'open' }];
  eq('made room after closing fits', fitAt(at(19), 30, hours, busy, [], made, 0).ok, true);
  const madeOverBooking = fitAt(at(14), 30, hours, busy, [],
    [{ ...made[0], start_min: 13 * 60, end_min: 15 * 60 }], 0);
  eq('made room never outranks a booking', why(madeOverBooking), 'booked');
}

// ---- BDY-14 · asksFor -----------------------------------------------------------
{
  const asks: Ask[] = [
    { day: '2026-09-12', earliest_min: null, customer_id: 'a' },
    { day: '2026-09-12', earliest_min: 17 * 60, customer_id: 'b' },   // not before 17:00
    { day: '2026-09-12', earliest_min: 15 * 60, customer_id: 'anas' },
    { day: '2026-09-13', earliest_min: null, customer_id: 'c' },
  ];
  eq('16:00 suits the open ask and the 15:00 one', asksFor(asks, '2026-09-12', 16 * 60), 2);
  eq('the person moving is not waiting for their own slot', asksFor(asks, '2026-09-12', 16 * 60, 'anas'), 1);
  eq('18:00 suits all three that day', asksFor(asks, '2026-09-12', 18 * 60), 3);
  eq('another day counts its own', asksFor(asks, '2026-09-13', 10 * 60), 1);
}

// ---- BNT-05 · heldDuringCut -------------------------------------------------------
{
  const n = (id: string, kind: string, h: number, m: number, booking: string | null = null): InboxNotif => ({
    id, kind, title: id, body: null, booking_id: booking, read_at: null, created_at: iso(h, m),
  });
  const cut = { started_at: iso(13, 58), completed_at: iso(14, 34) };
  const rule = { silent: true, urgentAlways: true, pushCancellation: true, cancellationsBreak: false };
  const bookings = {
    soon: { id: 'soon', status: 'cancelled', starts_at: iso(16) },     // 1 h 53 after 14:07
    later: { id: 'later', status: 'cancelled', starts_at: iso(18) },   // well outside two hours
  };
  const notifs = [
    n('before', 'message', 13, 50),
    n('edge-in', 'review', 13, 58),
    n('urgent-cancel', 'cancellation', 14, 7, 'soon'),
    n('calm-cancel', 'cancellation', 14, 10, 'later'),
    n('request', 'booking_request', 14, 19),
    n('edge-out', 'message', 14, 34),
  ];

  const r = heldDuringCut(notifs, cut, rule, bookings);
  eq('the window opens when the cut starts', r.held.some((x) => x.id === 'edge-in'), true);
  eq('and closes at mark-done', r.held.some((x) => x.id === 'edge-out'), false);
  eq('what came before is not held', r.held.some((x) => x.id === 'before'), false);
  eq('a cancellation inside two hours got through', r.held.some((x) => x.id === 'urgent-cancel'), false);
  eq('and is counted rather than listed', r.gotThrough, 1);
  eq('a calm cancellation was held', r.held.some((x) => x.id === 'calm-cancel'), true);
  eq('held reads oldest first', r.held.map((x) => x.id).join(','), 'edge-in,calm-cancel,request');

  eq('with the rule off nothing is held', heldDuringCut(notifs, cut, { ...rule, silent: false }, bookings).held.length, 0);
  const broke = heldDuringCut(notifs, cut, { ...rule, cancellationsBreak: true }, bookings);
  eq('0108 lets every cancellation through', broke.gotThrough, 2);
  const muted = heldDuringCut(notifs, cut, { ...rule, pushCancellation: false }, bookings);
  eq('with the cancellation toggle off nothing got through', muted.gotThrough, 0);
}

// ---- BNT-05 · laneOf + sortWorth ----------------------------------------------------
{
  const now = at(14, 34).getTime();
  const n = (kind: string, booking = 'x'): InboxNotif => ({
    id: kind, kind, title: kind, body: null, booking_id: booking, read_at: null, created_at: iso(14, 10),
  });
  const ahead = (status: string) => ({ id: 'x', status, starts_at: iso(16) });
  const gone = (status: string) => ({ id: 'x', status, starts_at: iso(11) });

  eq('a cancelled slot still ahead is worth offering',
    laneOf(n('cancellation'), ahead('cancelled'), false, now).action, 'offer');
  eq('a cancelled slot already past is just reading',
    laneOf(n('cancellation'), gone('cancelled'), false, now).worth, false);
  eq('a refilled slot is not offered again',
    laneOf(n('cancellation'), ahead('confirmed'), false, now).worth, false);
  eq('an open request ahead can be answered',
    laneOf(n('booking_request'), ahead('pending'), false, now).action, 'answer_request');
  eq('a request whose time passed cannot',
    laneOf(n('booking_request'), gone('pending'), false, now).worth, false);
  eq('an accepted request is reading',
    laneOf(n('booking_request'), ahead('confirmed'), false, now).worth, false);
  eq('an ask still open can be answered',
    laneOf(n('reschedule'), ahead('confirmed'), true, now).action, 'answer_ask');
  eq('an ask already answered cannot',
    laneOf(n('reschedule'), ahead('confirmed'), false, now).worth, false);
  eq('a review opens the review', laneOf(n('review'), undefined, false, now).action, 'open_review');

  const order = sortWorth([
    { action: 'answer_ask' as const, notif: { ...n('reschedule'), created_at: iso(14, 0) } },
    { action: 'answer_request' as const, notif: { ...n('booking_request'), created_at: iso(14, 1) } },
    { action: 'offer' as const, notif: { ...n('cancellation'), created_at: iso(14, 20) } },
  ]).map((x) => x.action).join(',');
  eq('money first, then requests, then moves', order, 'offer,answer_request,answer_ask');
}

// ---- NTF-10 · missedWhilePushOff ------------------------------------------------------
{
  const row = (id: string, h: number, day = 10) => ({ id, created_at: iso(h, 0, day) });
  const notifs = [
    row('never-tried', 9), row('quiet-pref', 10), row('sent-before-denied', 11),
    row('sent-after-denied', 15), row('also-after', 18),
  ];
  const attempts: Attempt[] = [
    { notification_id: 'never-tried', note: 'no push token registered for this user' },
    { notification_id: 'sent-before-denied', note: null },
    { notification_id: 'sent-after-denied', note: null },
    { notification_id: 'also-after', note: null },
    // 'quiet-pref' has no attempt: notif_should_push said no, it was never meant to buzz
  ];
  const deniedSince = iso(12, 0, 10);

  const missed = missedWhilePushOff(notifs, attempts, deniedSince).map((x) => x.id);
  eq('a push the server never tried is missed', missed.includes('never-tried'), true);
  eq('a push a preference stopped is not missed', missed.includes('quiet-pref'), false);
  eq('a push sent before push was seen off is not claimed', missed.includes('sent-before-denied'), false);
  eq('one sent after it is', missed.includes('sent-after-denied'), true);
  eq('newest first', missed.join(','), 'also-after,sent-after-denied,never-tried');
  eq('with no denial on record only the untried count',
    missedWhilePushOff(notifs, attempts, null).map((x) => x.id).join(','), 'never-tried');
}

if (failures) {
  console.error(`\n${failures} inbox rule check(s) failed`);
  process.exit(1);
}
console.log('inbox rules: all checks passed');
