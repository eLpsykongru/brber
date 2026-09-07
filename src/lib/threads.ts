// A conversation is with a person, not with a booking.
//
// `messages` is keyed on `booking_id`, so booking Mehdi three times used to
// draw Mehdi three times — identically, since the row shows neither the
// service nor the date. This collapses every booking you share with one
// person into a single thread: `head` is what a new message attaches to,
// `rows` is all of them, so a caller can still say how many are upcoming
// without the grouper needing to know what "upcoming" means.
//
// Used from both sides of the chair, which is why the key is `peer_id`.

export type ThreadRow = {
  id: string;
  starts_at: string;
  /** the other person in the conversation: the barber if you are the
   *  customer, the customer if you are the barber. null when there is nobody
   *  to merge on (a walk-in, a deleted account) — those never merge. */
  peer_id: string | null;
  /** created_at of the newest message on this booking, if any */
  last_at?: string | null;
};

export type Thread<T extends ThreadRow> = { head: T; rows: T[] };

export function groupThreads<T extends ThreadRow>(rows: T[]): Thread<T>[] {
  const by = new Map<string, Thread<T>>();
  for (const r of rows) {
    // falling back to the booking id keeps two unknown peers apart, rather
    // than merging everyone with no peer into one impossible thread
    const key = r.peer_id ?? `booking:${r.id}`;
    const cur = by.get(key);
    if (!cur) { by.set(key, { head: r, rows: [r] }); continue; }
    // whoever spoke last owns the thread; with nothing said on either, the
    // sooner appointment does
    const newer = (r.last_at ?? '') > (cur.head.last_at ?? '')
      || (!r.last_at && !cur.head.last_at && r.starts_at < cur.head.starts_at);
    by.set(key, { head: newer ? r : cur.head, rows: [...cur.rows, r] });
  }
  // said-something-recently first, then whoever you are seeing soonest —
  // without the tiebreak every thread with no messages yet compares equal
  return [...by.values()].sort((a, b) =>
    (b.head.last_at ?? '').localeCompare(a.head.last_at ?? '')
    || a.head.starts_at.localeCompare(b.head.starts_at));
}
