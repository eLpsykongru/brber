// The barber's line under ADDENDUM-app-first (turns B10 and B11), as plain rules the
// board, Home and the checks share. The database keeps the same order for the you're-next
// text (0119's guest_next_check); these decide what the barber sees and is asked.

import type { Block, Range, Window } from './slots';
import { tr } from './i18n';

/** A5 — the called-chair hold. Barber-side: when it runs out he is asked (BTD-15), nothing is removed. */
export const HOLD_MIN = 8;

/**
 * BTD-16 sends a text, and until a text provider exists nothing sends (BACKLOG, SMS
 * rail). An offer takes a man out of today's line, so it is not offered until his
 * text can reach him — the same switch the web page's QL-23 waits on.
 */
export const smsSends = () => ['1', 'true', 'on'].includes(String(process.env.EXPO_PUBLIC_SMS_SENDS ?? '').toLowerCase());

export type LineRow = {
  id: string;
  starts_at: string;
  checked_in_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  dropped_at: string | null;
};

/** Everybody still waiting, in the order he calls them: in their places by start, then whoever he dropped to the end, in the order he dropped them. */
export function callOrder<R extends LineRow>(rows: R[]): R[] {
  return rows
    .filter((r) => !r.started_at && !r.completed_at)
    .sort((a, b) => Number(!!a.dropped_at) - Number(!!b.dropped_at)
      || (a.dropped_at ?? '').localeCompare(b.dropped_at ?? '')
      || a.starts_at.localeCompare(b.starts_at)
      || a.id.localeCompare(b.id));
}

export const heldUntil = (calledAt: string) => new Date(calledAt).getTime() + HOLD_MIN * 60_000;

/** The man he called who has not sat down — the one CALL NEXT asks about first (BTD-15). */
export function calledNotHere<R extends LineRow>(rows: R[]): R | null {
  return callOrder(rows).find((r) => r.checked_in_at) ?? null;
}

/** …and only once his eight minutes are up does the question open by itself. */
export function lapsedCall<R extends LineRow>(rows: R[], now: number): R | null {
  const r = calledNotHere(rows);
  return r && heldUntil(r.checked_in_at!) <= now ? r : null;
}

/** Who CALL NEXT would call: the first man in the order who has not been called. */
export function nextToCall<R extends LineRow>(rows: R[], except: string | null = null): R | null {
  return callOrder(rows).find((r) => !r.checked_in_at && r.id !== except) ?? null;
}

// ---- B11 · one list per chair, one ladder of verbs ------------------------------
// A booking and a walk-in are the same row in different states. The rung is read off
// 0018's timestamps — never off who the customer is — and the primary button off the rung.

export type ChairRow = LineRow & {
  /** 'pending' is a request nobody has answered; 'confirmed' is in the line */
  status: string;
  customer_id: string;
  price_cents: number;
  deposit_cents?: number | null;
  /** held his own place in the app (0119) */
  joined_line?: boolean | null;
};

export type Rung = 'request' | 'waiting' | 'called' | 'in_chair' | 'done';

export function rungOf(r: ChairRow): Rung {
  if (r.status === 'pending') return 'request';
  if (r.completed_at) return 'done';
  if (r.started_at) return 'in_chair';
  if (r.checked_in_at) return 'called';
  return 'waiting';
}

/**
 * A place in the line — written down by hand, taken on the web, or held in the app — is
 * called up. A booked time is checked in when he walks in. Both land on the same rung.
 */
export const isLinePlace = (r: ChairRow, barberId: string) => r.customer_id === barberId || !!r.joined_line;

export type Verb = 'CALL HIM' | "HE'S HERE" | 'SEAT HIM' | 'DONE';

/** The one primary button a row carries. */
export function verbOf(r: ChairRow, barberId: string): Verb | null {
  switch (rungOf(r)) {
    case 'waiting': return isLinePlace(r, barberId) ? 'CALL HIM' : "HE'S HERE";
    case 'called': return 'SEAT HIM';
    case 'in_chair': return 'DONE';
    default: return null;
  }
}

/**
 * Whether 0119's queue_take_off would take him: a walk-in, anybody called or dropped,
 * or a booking whose time has come. An app client not yet due is a cancellation.
 */
export const canTakeOff = (r: ChairRow, barberId: string, now: number) =>
  r.status === 'confirmed' && !r.started_at && !r.completed_at
  && (r.customer_id === barberId || !!r.checked_in_at || !!r.dropped_at || new Date(r.starts_at).getTime() <= now);

/** What he says out loud at DONE: a held deposit is already out of the wallet (0075). */
export const collectCents = (r: ChairRow) => Math.max(0, r.price_cents - (r.deposit_cents ?? 0));

/**
 * THE CHAIR (BTD-20): whoever is in the chair, then the line in the order he calls it,
 * with a request nobody has answered sitting at its own time. A done row has left.
 */
export function chairList<R extends ChairRow>(rows: R[]): R[] {
  const live = rows.filter((r) => r.status === 'confirmed' && !r.completed_at);
  const inChair = live.filter((r) => r.started_at)
    .sort((a, b) => a.started_at!.localeCompare(b.started_at!) || a.id.localeCompare(b.id));
  const out = callOrder(live);
  const requests = rows.filter((r) => r.status === 'pending')
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id));
  for (const q of requests) {
    let i = out.findIndex((r) => !r.dropped_at && r.starts_at > q.starts_at);
    if (i < 0) i = out.findIndex((r) => !!r.dropped_at);   // never behind the men he dropped
    out.splice(i < 0 ? out.length : i, 0, q);
  }
  return [...inChair, ...out];
}

/** Waiting (A10): the line — not whoever is in the chair, and not a request nobody accepted. */
export const waitingOf = <R extends ChairRow>(rows: R[]): R[] =>
  callOrder(rows.filter((r) => r.status === 'confirmed'));

/** TAKEN climbs only when a man is done; BOOKED is every confirmed cut of the day. One number is never labelled both ways. */
export function dayMoney(rows: ChairRow[]): { takenCents: number; bookedCents: number } {
  const confirmed = rows.filter((r) => r.status === 'confirmed');
  const sum = (xs: ChairRow[]) => xs.reduce((a, r) => a + r.price_cents, 0);
  return { takenCents: sum(confirmed.filter((r) => r.completed_at)), bookedCents: sum(confirmed) };
}

/**
 * BTD-22 — done is the only rung that moves money, so it is the only one with a way back:
 * the chair's latest done, until somebody sits down after it. Seating the next man is what
 * counts the cash. No clock — only the rows (0121 asks the same of the database).
 */
export function undoableDone<R extends ChairRow>(rows: R[]): R | null {
  const t = (iso: string) => new Date(iso).getTime();
  let last: R | null = null;
  for (const r of rows) {
    if (r.completed_at && (!last || t(r.completed_at) > t(last.completed_at!))) last = r;
  }
  if (!last) return null;
  const doneAt = t(last.completed_at!);
  return rows.some((r) => r.started_at && t(r.started_at) > doneAt) ? null : last;
}

export type Step = { label: string; at: string | null; state: 'past' | 'next' | 'later' };

/** BTD-21's four rungs, with where the row sits on them. `created_at` is when the place or the booking was made. */
export function ladderOf(r: ChairRow & { created_at: string }, barberId: string): Step[] {
  const line = isLinePlace(r, barberId);
  const reached = { request: 0, waiting: 1, called: 2, in_chair: 3, done: 4 }[rungOf(r)];
  const steps: [string, string | null][] = [
    [line ? tr('In the line') : tr('Booked'), r.created_at],
    [line ? tr('Called') : tr("He's here"), r.checked_in_at],
    [tr('In the chair'), r.started_at],
    [tr('Done · {cash} DH in cash', { cash: Math.round(collectCents(r) / 100) }), r.completed_at],
  ];
  return steps.map(([label, at], i) => ({
    label, at, state: i < reached ? 'past' : i === reached ? 'next' : 'later',
  }));
}

// ---- BTD-16 / BTD-19 · a time on another day ------------------------------------

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const localDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a: Date, b: Date) => localDateStr(a) === localDateStr(b);

export const hhmmOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "tomorrow" or "Sat 19 Sep" — the words 0119 puts in the text, so the preview matches it */
export function dayWords(at: Date, now = new Date()): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(at, tomorrow)) return 'tomorrow';
  return `${DAYS[at.getDay()]} ${pad(at.getDate())} ${MONTHS[at.getMonth()]}`;
}

/** The offer text as 0119's queue_offer_day writes it, with the link blanked: the app never holds the token. */
export function offerText(barber: string, at: Date, shop: string, now = new Date()): string {
  return `Sterncut: ${barber} offers you ${dayWords(at, now)} ${hhmmOf(at)} at ${shop}. Confirm with one tap: https://sterncut.ma/c/…`;
}

export type Gap = { start: Date; startMin: number; minutes: number; fits: boolean };

type Span = [number, number];

function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtract(free: Span[], taken: Span[]): Span[] {
  let out = free;
  for (const [ta, tb] of merge(taken)) {
    out = out.flatMap(([a, b]): Span[] => {
      if (tb <= a || ta >= b) return [[a, b]];
      const keep: Span[] = [];
      if (ta > a) keep.push([a, ta]);
      if (tb < b) keep.push([tb, b]);
      return keep;
    });
  }
  return out;
}

/**
 * BTD-19's rows: the free stretches of one day, with whether this man's service fits
 * in each. His weekly hours and any room made by hand, less breaks, less every
 * booking with its cleaning time either side (daySlots' rule), less the past. A
 * stretch under ten minutes is not a gap anyone would offer.
 */
export function dayGaps(
  day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[],
  blocks: Block[] = [], bufferMin = 0, now = Date.now(),
): Gap[] {
  const ds = localDateStr(day);
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const minOf = (iso: string) => Math.round((new Date(iso).getTime() - midnight.getTime()) / 60_000);

  const open: Span[] = [];
  if (!daysOff.includes(ds)) {
    for (const w of windows.filter((x) => x.weekday === day.getDay())) open.push([w.start_min, w.end_min]);
  }
  for (const b of blocks.filter((x) => x.kind === 'open' && x.day === ds)) open.push([b.start_min, b.end_min]);

  const taken: Span[] = blocks
    .filter((b) => b.kind !== 'open' && (b.day === null || b.day === ds))
    .map((b): Span => [b.start_min, b.end_min]);
  for (const b of booked) {
    const s = minOf(b.starts_at), e = minOf(b.ends_at);
    if (e <= 0 || s >= 1440) continue;
    taken.push([s - bufferMin, e + bufferMin]);
  }
  const nowMin = Math.ceil((now - midnight.getTime()) / 60_000);
  if (nowMin > 0) taken.push([0, Math.min(1440, nowMin)]);

  return subtract(merge(open), taken)
    .filter(([a, b]) => b - a >= 10)
    .map(([a, b]) => ({
      start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, a),
      startMin: a, minutes: b - a, fits: b - a >= durationMin,
    }));
}

/** BTD-16's two suggestions: the first stretches that fit him, from tomorrow on. */
export function firstFits(
  from: Date, days: number, durationMin: number, windows: Window[], booked: Range[], daysOff: string[],
  blocks: Block[] = [], bufferMin = 0, take = 2, now = Date.now(),
): Gap[] {
  const out: Gap[] = [];
  for (let i = 0; i < days && out.length < take; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    for (const g of dayGaps(day, durationMin, windows, booked, daysOff, blocks, bufferMin, now)) {
      if (g.fits && out.length < take) out.push(g);
    }
  }
  return out;
}
