// The rules behind the three notification gaps the routing audit closed:
// BDY-14 (a reschedule ask and what it does to the day), BNT-05 (what "silent
// while cutting" held back) and NTF-10 (what never reached a phone with push off).
//
// Pure, so `inboxRules.check.ts` runs them under node. Each one decides what a
// screen tells someone about their own day or their own money, which is exactly
// the kind of branch that starts lying quietly.

const MIN = 60_000;
const HOUR = 60 * MIN;

// ---- words -------------------------------------------------------------------

/** "80 minutes", "1 h 45", "3 h", "2 days" — the units the design reads out. */
export function spanLabel(ms: number): string {
  const min = Math.max(0, Math.round(ms / MIN));
  if (min < 90) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

export function agoLabel(ms: number): string {
  return ms < MIN ? 'just now' : `${spanLabel(ms)} ago`;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** A count said in a sentence: "Three" up to ten, digits after. */
export function countWord(n: number): string {
  return WORDS[n] ?? String(n);
}

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- BDY-14 · does the time asked for fit the day ------------------------------

export type Win = { weekday: number; start_min: number; end_min: number };
export type Blk = { day: string | null; start_min: number; end_min: number; kind?: string | null };
export type Busy = { id: string; starts_at: string; ends_at: string; who: string };

export type Fit =
  | { ok: true }
  | { ok: false; why: 'day_off' | 'closed' | 'break' }
  | { ok: false; why: 'booked' | 'buffer'; with: Busy };

/**
 * Whether `start` for `durationMin` fits. Mirrors `daySlots`: room made by hand
 * (a kind 'open' block, 8k) outranks the hours, the breaks and the buffers but
 * never a booking, and a day off outranks everything.
 *
 * Advisory. The server refuses only a true overlap (no_double_booking), so
 * 'booked' means accepting will fail and 'buffer' means it will squeeze the day.
 * `gapMin` is the barber's before + after buffer: the room two sittings need.
 */
export function fitAt(
  start: Date, durationMin: number, windows: Win[], busy: Busy[],
  daysOff: string[], blocks: Blk[], gapMin: number,
): Fit {
  const day = localDay(start);
  if (daysOff.includes(day)) return { ok: false, why: 'day_off' };

  const s = start.getHours() * 60 + start.getMinutes();
  const e = s + durationMin;
  const onDay = blocks.filter((b) => b.day === null || b.day === day);
  const made = onDay.some((b) => b.kind === 'open' && b.start_min <= s && b.end_min >= e);

  if (!made) {
    const inHours = windows.some((w) => w.weekday === start.getDay() && w.start_min <= s && w.end_min >= e);
    if (!inHours) return { ok: false, why: 'closed' };
    if (onDay.some((b) => b.kind !== 'open' && b.start_min < e && b.end_min > s)) {
      return { ok: false, why: 'break' };
    }
  }

  const from = start.getTime();
  const to = from + durationMin * MIN;
  const hit = busy.find((b) => Date.parse(b.starts_at) < to && Date.parse(b.ends_at) > from);
  if (hit) return { ok: false, why: 'booked', with: hit };

  if (!made && gapMin > 0) {
    const gap = gapMin * MIN;
    const near = busy.find((b) => Date.parse(b.starts_at) < to + gap && Date.parse(b.ends_at) + gap > from);
    if (near) return { ok: false, why: 'buffer', with: near };
  }
  return { ok: true };
}

export type Ask = { day: string; earliest_min: number | null; customer_id: string };

/**
 * People on the waitlist a time would suit. Asks are for a DAY (0050), with an
 * optional "not before", so this can say "asked for that day" — never "asked for
 * 16:00". The person moving is not waiting for their own slot.
 */
export function asksFor(asks: Ask[], day: string, minute: number, except?: string): number {
  return asks.filter((a) => a.day === day && a.customer_id !== except
    && (a.earliest_min == null || a.earliest_min <= minute)).length;
}

// ---- BNT-05 · what silent-while-cutting held ------------------------------------

export type InboxNotif = {
  id: string; kind: string; title: string; body: string | null;
  booking_id: string | null; read_at: string | null; created_at: string;
};
export type LiveBooking = { id: string; status: string; starts_at: string };
export type Cut = { started_at: string; completed_at: string };
export type SilenceRule = {
  silent: boolean; urgentAlways: boolean; pushCancellation: boolean; cancellationsBreak: boolean;
};

/**
 * What arrived while someone was in the chair and did not buzz.
 *
 * Nothing on the server records a push a preference stopped (0104 logs only the
 * ones it tried), so this is read back off the cut itself: everything that landed
 * between the start of the cut and mark-done. Two kinds of cancellation got
 * through anyway and are counted, not listed — one inside two hours when "urgent
 * gets through" is on (0037 returns before it looks at the chair), and any at all
 * when 0108's exception is on.
 */
export function heldDuringCut(
  notifs: InboxNotif[], cut: Cut, rule: SilenceRule, bookings: Record<string, LiveBooking>,
): { held: InboxNotif[]; gotThrough: number } {
  if (!rule.silent) return { held: [], gotThrough: 0 };
  const from = Date.parse(cut.started_at);
  const to = Date.parse(cut.completed_at);
  const held: InboxNotif[] = [];
  let gotThrough = 0;
  for (const n of notifs) {
    const at = Date.parse(n.created_at);
    if (at < from || at >= to) continue;
    if (n.kind === 'cancellation' && rule.pushCancellation) {
      const b = n.booking_id ? bookings[n.booking_id] : undefined;
      const urgent = !!b && Date.parse(b.starts_at) < at + 2 * HOUR;
      if ((urgent && rule.urgentAlways) || rule.cancellationsBreak) { gotThrough++; continue; }
    }
    held.push(n);
  }
  held.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { held, gotThrough };
}

export type Action = 'offer' | 'answer_request' | 'answer_ask' | 'open_review' | null;

/** "Still worth doing" is only what can still be done: a slot that has not
 *  started, a request still open, an ask still waiting. The rest is reading. */
export function laneOf(n: InboxNotif, b: LiveBooking | undefined, openAsk: boolean, now: number): {
  worth: boolean; action: Action;
} {
  const ahead = !!b && Date.parse(b.starts_at) > now;
  if (n.kind === 'cancellation' && b?.status === 'cancelled' && ahead) return { worth: true, action: 'offer' };
  if (n.kind === 'booking_request' && b?.status === 'pending' && ahead) {
    return { worth: true, action: 'answer_request' };
  }
  if (n.kind === 'reschedule' && openAsk && (b?.status === 'pending' || b?.status === 'confirmed')) {
    return { worth: true, action: 'answer_ask' };
  }
  if (n.kind === 'review' && n.booking_id) return { worth: false, action: 'open_review' };
  return { worth: false, action: null };
}

const WORTH_ORDER: Record<string, number> = { offer: 0, answer_request: 1, answer_ask: 2 };

/** Money first: a slot to refill outranks a request, which outranks a move. */
export function sortWorth<T extends { action: Action; notif: InboxNotif }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    (WORTH_ORDER[a.action ?? ''] ?? 9) - (WORTH_ORDER[b.action ?? ''] ?? 9)
    || a.notif.created_at.localeCompare(b.notif.created_at));
}

// ---- NTF-10 · what never reached a phone with push off --------------------------

export type Attempt = { notification_id: string | null; note: string | null };

/**
 * An attempt row exists only when notif_should_push said yes — 0104 logs nothing
 * for a preference that said no — so every candidate was meant to reach the
 * phone. It did not when the server never even tried (a note: no token, pg_net
 * refused), or when it went out after this phone was first seen with push denied.
 * Before that moment nothing here can tell, so nothing is claimed.
 */
export function missedWhilePushOff<T extends { id: string; created_at: string }>(
  notifs: T[], attempts: Attempt[], deniedSince: string | null,
): T[] {
  const noted = new Map<string, boolean>();
  for (const a of attempts) {
    if (!a.notification_id) continue;
    noted.set(a.notification_id, (noted.get(a.notification_id) ?? false) || a.note != null);
  }
  const since = deniedSince ? Date.parse(deniedSince) : Number.POSITIVE_INFINITY;
  return notifs
    .filter((n) => noted.has(n.id) && (noted.get(n.id) || Date.parse(n.created_at) >= since))
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
}
