// BRV-08 and BPR-06/08 — the numbers and rules a barber reads about their own
// page. Pure, so `profileRules.check.ts` runs them under node: a rating that
// counts the wrong rows, or a lock that opens a day early, is invisible on a
// screen and obvious here.

const DAY = 86_400_000;

// ---- BRV-08 · the reviews and the number behind them -----------------------------

export type ReviewRow = {
  id: string; rating: number; reply: string | null; state: string;
  flagged_at: string | null; moderated_at: string | null;
};

/**
 * What happened to a review someone reported. `held` is waiting on ops (0042's
 * review_flag); a review restored on appeal comes from `my_restored_reviews`
 * (0046); anything else ops decided and left up was kept. Order matters: a
 * restored review also carries a moderation date.
 */
export type Dispute = 'with_sterncut' | 'restored' | 'kept' | null;

export function disputeOf(r: ReviewRow, restored: ReadonlySet<string>): Dispute {
  if (r.state === 'held') return 'with_sterncut';
  if (restored.has(r.id)) return 'restored';
  if (r.moderated_at) return 'kept';
  return null;
}

export type Summary = {
  average: number | null; count: number;
  /** index 0 is five stars, index 4 is one — the order the bars are drawn */
  histogram: [number, number, number, number, number];
  unanswered: number; low: number; disputed: number;
};

/**
 * Every review the barber can read counts, which is every review the public page
 * counts: `reviews_select` (0042) hides only removed ones, from both of them.
 */
export function reviewSummary(rows: ReviewRow[], restored: ReadonlySet<string>): Summary {
  const histogram: Summary['histogram'] = [0, 0, 0, 0, 0];
  let sum = 0;
  let unanswered = 0;
  let low = 0;
  let disputed = 0;
  for (const r of rows) {
    const star = Math.min(5, Math.max(1, Math.round(r.rating)));
    histogram[5 - star]++;
    sum += r.rating;
    if (!r.reply) unanswered++;
    if (r.rating <= 3) low++;
    if (disputeOf(r, restored)) disputed++;
  }
  return {
    average: rows.length ? sum / rows.length : null, count: rows.length,
    histogram, unanswered, low, disputed,
  };
}

export type ReviewFilter = 'all' | 'unanswered' | 'low' | 'disputed';

export function filterReviews<T extends ReviewRow>(
  rows: T[], f: ReviewFilter, restored: ReadonlySet<string>,
): T[] {
  if (f === 'unanswered') return rows.filter((r) => !r.reply);
  if (f === 'low') return rows.filter((r) => r.rating <= 3);
  if (f === 'disputed') return rows.filter((r) => disputeOf(r, restored) !== null);
  return rows;
}

// ---- BPR-08 · the name, rationed ----------------------------------------------------

export const NAME_LOCK_DAYS = 60;   // 0109's trigger
export const FORMERLY_DAYS = 30;

/** When the name can change again, or null when it can change now. */
export function nameLockedUntil(changedAt: string | null, now: number): Date | null {
  if (!changedAt) return null;
  const until = Date.parse(changedAt) + NAME_LOCK_DAYS * DAY;
  return until > now ? new Date(until) : null;
}

/** The old name while the page still carries it, otherwise null. */
export function formerlyName(previous: string | null, changedAt: string | null, now: number): string | null {
  if (!previous || !changedAt) return null;
  return Date.parse(changedAt) + FORMERLY_DAYS * DAY > now ? previous : null;
}

// ---- BPR-06 · the fields --------------------------------------------------------------

/** "Cutting since 2016" is stored as years_experience (0012). */
export function sinceYear(years: number | null, now: Date): number | null {
  return years == null ? null : now.getFullYear() - years;
}

/** null when the year cannot be right: in the future, or past 0012's 80-year check. */
export function yearsFrom(year: number, now: Date): number | null {
  if (!Number.isInteger(year)) return null;
  const years = now.getFullYear() - year;
  return years >= 0 && years <= 80 ? years : null;
}

// the keys 0109's check constraint allows, in the order BPR-06 draws them
export const LANGUAGES: { key: string; label: string }[] = [
  { key: 'darija', label: 'Darija' },
  { key: 'ar', label: 'العربية' },
  { key: 'fr', label: 'Français' },
  { key: 'en', label: 'English' },
];

export const ABOUT_MAX = 200;
