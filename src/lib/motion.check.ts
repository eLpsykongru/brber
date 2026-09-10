// Self-check for the swipe-back threshold. Runs with the slot math:
//
//     npm run check
//
// One branch decides whether a drag goes back or springs home, and getting it
// wrong is felt on every screen: too eager and the app leaves while you are
// scrolling, too strict and a normal flick does nothing.

import { shouldDismiss, shouldRemove } from './swipe';

const W = 400;
let failures = 0;
function ok(label: string, cond: boolean, got?: unknown) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}

// a drag that goes nowhere, or the wrong way, never dismisses
ok('a still finger stays', !shouldDismiss(0, 0, W));
ok('dragging left never goes back', !shouldDismiss(-120, -2, W));
ok('a slow nudge stays', !shouldDismiss(20, 0.1, W));

// far enough on its own
ok('a third of the screen goes back', shouldDismiss(W * 0.4, 0, W));
ok('just under a third stays', !shouldDismiss(W * 0.3, 0, W));

// or fast enough on its own — a flick is how people actually dismiss, and
// asking for a third of the screen from a fast one feels broken
ok('a quick flick goes back', shouldDismiss(60, 1.2, W));
// ...but speed alone is not enough: a fast tiny twitch is not a decision
ok('a fast twitch stays', !shouldDismiss(10, 3, W));

// the threshold follows the screen, so a tablet does not need a longer drag
ok('a wide screen scales its threshold', !shouldDismiss(200, 0, 1000));
ok('and a narrow one does too', shouldDismiss(200, 0, 400));

// ---- EXPL-27's row swipe: the other direction, and a stricter one ----
const ROW = 340;
ok('a row never leaves on a rightward drag', !shouldRemove(200, 2, ROW));
ok('a still finger keeps the row', !shouldRemove(0, 0, ROW));
// the threshold a screen dismissal would have accepted must NOT remove a row —
// this is the whole reason the two predicates are separate
ok('a third of the row is not enough', !shouldRemove(-ROW * 0.35, 0, ROW));
ok('half of it is', shouldRemove(-ROW * 0.5, 0, ROW));
ok('a firm flick removes', shouldRemove(-70, -1.2, ROW));
ok('a fast twitch does not', !shouldRemove(-20, -3, ROW));
ok('a lazy nudge does not', !shouldRemove(-60, -0.2, ROW));

if (failures) { console.error(`\nmotion: ${failures} check(s) failed.`); process.exit(1); }
console.log('motion: all checks passed.');
