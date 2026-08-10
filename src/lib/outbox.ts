// Barber turn 10 — the queue of things he did while the phone couldn't reach us.
//
// Turn 10's rule: **an error must never stop the queue moving.** He is mid-cut,
// one-handed, with someone in the chair and three waiting, so nothing here may
// block on a network round trip. Marking a cut done, adding a walk-in and rating
// a client all write to this list first and go out when they can.
//
// This file is the pure half — no storage, no network, no React — so the money
// and retry arithmetic behind 10a's two counters and 10f's "tried 4 times" has a
// runnable check. `src/lib/sync.ts` is the half that touches the world.

export type JobCall =
  | { rpc: string; args: Record<string, unknown> }
  | { insert: string; row: Record<string, unknown> }
  | { update: string; id: string; patch: Record<string, unknown> };

export type Job = {
  id: string;
  /** when he did it, not when we sent it — 10f lists his morning, not ours */
  at: string;
  label: string;
  icon: 'check' | 'plus' | 'star' | 'message-square' | 'x';
  /** cash he took for this, if any. 10a's CASH TAKEN is the sum. */
  cents?: number;
  tries: number;
  lastError?: string;
  /** 10b — somebody else got the slot while he was offline */
  conflict?: boolean;
  /** enough to draw the row on his timeline before it exists on ours (10a's
   *  "TODAY · FROM MEMORY"), and to name both people in 10b */
  meta?: { bookingId?: string; startsAt?: string; who?: string; service?: string };
  call: JobCall;
};

/** 10a's two cards and 10f's header, from one pass over the queue. */
export function summarise(jobs: Job[]): {
  count: number; cents: number; tries: number; conflicts: number; since: string | null;
} {
  let cents = 0;
  let tries = 0;
  let conflicts = 0;
  let since: string | null = null;
  for (const j of jobs) {
    cents += j.cents ?? 0;
    if (j.tries > tries) tries = j.tries;      // "tried 4 times" is the worst case, not the total
    if (j.conflict) conflicts++;
    if (since === null || j.at < since) since = j.at;
  }
  return { count: jobs.length, cents, tries, conflicts, since };
}

// A slot that went to someone else is not a network problem and retrying it for
// ever is how 10f fills up with things that can never send. The two the database
// actually raises are the exclusion constraint (0001's `no_double_booking`) and
// claim_slot_offer's own message.
const CONFLICT = [
  'no_double_booking',
  'already took it',
  'already booked',
  'conflicting key value',
  'exclusion constraint',
  'duplicate key',
];

export function isConflict(message: string): boolean {
  const m = message.toLowerCase();
  return CONFLICT.some((c) => m.includes(c));
}

/** One failed attempt. A conflicting job stops being a retry and becomes a question. */
export function bump(job: Job, message: string): Job {
  return {
    ...job,
    tries: job.tries + 1,
    lastError: message,
    conflict: job.conflict || isConflict(message),
  };
}

/** Jobs worth trying again: everything the network might still fix. */
export function sendable(jobs: Job[]): Job[] {
  return jobs.filter((j) => !j.conflict);
}

export function without(jobs: Job[], id: string): Job[] {
  return jobs.filter((j) => j.id !== id);
}

/** Replace one job in place, keeping his order — 10f is a timeline, not a set. */
export function replace(jobs: Job[], next: Job): Job[] {
  return jobs.map((j) => (j.id === next.id ? next : j));
}
