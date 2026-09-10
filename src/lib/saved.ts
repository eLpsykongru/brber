// EXPL-24 — a saved list sorted by the only thing that matters at the moment
// of looking: can you sit in the chair today.
//
// Barbers and salons interleave inside the sections, so they have to become one
// list before anything can be sorted. `kind` is the tag that survives the merge;
// everything else about a row stays where `my_wishlist` put it.
//
// Pure, so `saved.check.ts` can run the section split under node — the branch
// that decides FREE TODAY is the one that would quietly start lying.

export type SavedBarber = {
  kind: 'barber';
  id: string; name: string; salon: string; rating: number;
  /** minutes from midnight of today's first free slot, or null. Today only —
   *  see `barber_next_free_today`'s ceiling note in 0065. */
  free_today: number | null;
  bookable: boolean; reason: string | null; has_booking: boolean;
};

export type SavedSalon = {
  kind: 'salon';
  id: string; name: string; district: string; from_cents: number | null;
  /** the shop's own switch for today (0064), not the same as `bookable` */
  open: boolean;
  bookable: boolean; reason: string | null; has_booking: boolean;
};

export type SavedRow = SavedBarber | SavedSalon;
export type Filter = 'all' | 'barber' | 'salon';

/** Can you get in the chair today? A barber needs a slot the scan actually
 *  found; a shop needs to be open. Neither counts if something refuses the
 *  booking outright. */
export function freeToday(r: SavedRow): boolean {
  if (!r.bookable) return false;
  return r.kind === 'barber' ? r.free_today != null : r.open;
}

export type Split = {
  free: SavedRow[];
  later: SavedRow[];
  /** kept, never hidden — we do not unsave anyone for the customer */
  blocked: SavedRow[];
  counts: { all: number; barbers: number; salons: number; free: number };
};

export function splitSaved(rows: SavedRow[], filter: Filter = 'all'): Split {
  // the chips filter what you see; the counts always describe the whole list,
  // or "Barbers 4" would change the moment you pressed it
  const counts = {
    all: rows.length,
    barbers: rows.filter((r) => r.kind === 'barber').length,
    salons: rows.filter((r) => r.kind === 'salon').length,
    free: rows.filter(freeToday).length,
  };
  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter);
  const free = shown.filter(freeToday).sort(byTimeThenName);
  const blocked = shown.filter((r) => !r.bookable).sort(byName);
  const later = shown.filter((r) => r.bookable && !freeToday(r)).sort(byName);
  return { free, later, blocked, counts };
}

// soonest first among the ones with a time; a shop has no time of its own, so
// it sorts after the barbers rather than being given one it never produced
function byTimeThenName(a: SavedRow, b: SavedRow): number {
  const ta = a.kind === 'barber' ? a.free_today : null;
  const tb = b.kind === 'barber' ? b.free_today : null;
  if (ta != null && tb != null) return ta - tb || byName(a, b);
  if (ta != null) return -1;
  if (tb != null) return 1;
  return byName(a, b);
}

function byName(a: SavedRow, b: SavedRow): number {
  return a.name.localeCompare(b.name);
}
