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
