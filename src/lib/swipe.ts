// Whether a left-edge drag was a decision to go back.
//
// Kept out of the component so it can be checked in node: importing
// components/motion.tsx would drag React Native in with it.

/**
 * Far enough, or fast enough. Velocity matters as much as distance — a flick
 * is how people actually dismiss, and demanding a third of the screen from a
 * fast one feels broken. But speed alone is not a decision: a quick twitch
 * while scrolling must not throw the screen away, hence the small floor.
 */
export function shouldDismiss(dx: number, vx: number, width: number) {
  if (dx <= 0) return false;
  return dx > width * 0.32 || (vx > 0.45 && dx > 24);
}

/**
 * EXPL-27 — whether a leftward drag on a row was a decision to remove it.
 *
 * Not `shouldDismiss` with the sign flipped: this one is stricter on both
 * counts. A row sits inside a vertical list, so a stray horizontal component
 * of a scroll is common, and the cost of being wrong is deleting something the
 * customer chose to keep — recoverable through the undo toast, but still the
 * wrong default. Distance is measured against the row's width, not the
 * screen's, which happen to be near enough the same on a phone and would not
 * be on a tablet.
 */
export function shouldRemove(dx: number, vx: number, width: number) {
  if (dx >= 0) return false;
  return -dx > width * 0.45 || (vx < -0.8 && -dx > 56);
}
