// Pure slot math, shared by the specialist screen and the booking sheet.

export type Window = { weekday: number; start_min: number; end_min: number };
export type Range = { starts_at: string; ends_at: string };
// partial-day unavailability; day = null recurs every day (e.g. lunch).
// kind 'open' inverts the row (8k): room the barber made by hand on one date.
export type Block = {
  day: string | null; start_min: number; end_min: number;
  kind?: string | null; label?: string | null;
};
export type SlotStatus = 'free' | 'full' | 'past';
export type Slot = { time: Date; status: SlotStatus };

export const SLOT_STEP_MIN = 30;

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// all slots in the day's working window: free / full (booked or blocked) / past.
// bufferMin = prep+cleanup gap: booked ranges repel new slots by that much on both sides.
//
// An 'open' row (8k) adds a slot the ordinary rules would not produce, and it
// outranks the weekly hours, the breaks and the buffers — the barber weighed all
// three when he made the room. The one thing it never outranks is a booking:
// room he made can still only be taken once. `fill_booking` carries the same
// exemption server-side, so the two agree on what is bookable.
export function daySlots(day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[], blocks: Block[] = [], bufferMin = 0): Slot[] {
  const ds = localDateStr(day);
  const onDay = blocks.filter((b) => b.day === null || b.day === ds);
  const opens = onDay.filter((b) => b.kind === 'open' && b.day === ds);
  const dayBlocks = onDay.filter((b) => b.kind !== 'open');
  const now = Date.now();
  const buf = bufferMin * 60_000;

  const mk = (t: number, opened: boolean): Slot => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t);
    const end = start.getTime() + durationMin * 60_000;
    const pad = opened ? 0 : buf;
    const full = booked.some((b) => start.getTime() < new Date(b.ends_at).getTime() + pad
      && end > new Date(b.starts_at).getTime() - pad)
      || (!opened && dayBlocks.some((b) => t < b.end_min && t + durationMin > b.start_min));
    return { time: start, status: start.getTime() <= now ? 'past' : full ? 'full' : 'free' };
  };

  // keyed by start minute so an open row replaces the ordinary slot at that time
  // rather than doubling it — that is the whole point of options (b) and (c),
  // which free a time the grid already knows about but calls full.
  const byMin = new Map<number, Slot>();
  if (!daysOff.includes(ds)) {
    for (const w of windows.filter((x) => x.weekday === day.getDay())) {
      for (let t = w.start_min; t + durationMin <= w.end_min; t += SLOT_STEP_MIN) byMin.set(t, mk(t, false));
    }
  }
  for (const o of opens) {
    if (o.start_min + durationMin <= o.end_min) byMin.set(o.start_min, mk(o.start_min, true));
  }
  return [...byMin.keys()].sort((a, b) => a - b).map((t) => byMin.get(t)!);
}

// 34c — "2 of 12 times today can hold 70 min." A 70-minute bundle needs three
// consecutive 30-minute cells, so most of a busy day cannot take it while every
// single service still fits. `all` counts the day's ordinary start times.
export function fitCount(day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[], blocks: Block[] = [], bufferMin = 0): { fits: number; all: number } {
  const free = (d: number) => daySlots(day, d, windows, booked, daysOff, blocks, bufferMin)
    .filter((sl) => sl.status === 'free').length;
  return { fits: free(durationMin), all: daySlots(day, SLOT_STEP_MIN, windows, booked, daysOff, blocks, bufferMin).length };
}

// 34c's caption under a slot that fits: why this one is worth taking. Null when
// there is nothing interesting to say — an empty afternoon needs no note.
export function slotNote(start: Date, durationMin: number, windows: Window[], booked: Range[], blocks: Block[] = []): string | null {
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = startMin + durationMin;
  const dayBlocks = blocks.filter((b) => b.day === null || b.day === localDateStr(start));

  // butting straight up against a break that just ended reads as a find
  if (dayBlocks.some((b) => b.end_min === startMin)) return 'fits · straight after his break';

  // the next thing that occupies the chair, in minutes-from-midnight
  const edges: number[] = [];
  for (const b of booked) {
    const bs = new Date(b.starts_at);
    if (bs.toDateString() === start.toDateString()) edges.push(bs.getHours() * 60 + bs.getMinutes());
  }
  for (const b of dayBlocks) edges.push(b.start_min);
  for (const w of windows.filter((x) => x.weekday === start.getDay())) edges.push(w.end_min);

  const next = edges.filter((e) => e >= endMin).sort((a, b) => a - b)[0];
  if (next == null) return 'fits';
  const gap = next - endMin;
  return gap > 0 && gap < 60 ? `fits · leaves a ${gap}-min gap after` : 'fits';
}

// Barber turn 7c — how many sittings of `min` fit a day of `dayMin` run back to
// back with the barber's buffer. The whole "is this bundle worth it" comparison
// is this one line applied twice, so it lives here where it can be checked.
export function fitsPerDay(dayMin: number, min: number, bufferMin: number): number {
  const step = min + bufferMin;
  return step > 0 && dayMin > 0 ? Math.floor(dayMin / step) : 0;
}

// ---------------------------------------------------------------------------
// 8k — where a slot comes from on a day with nothing left
// ---------------------------------------------------------------------------
// An offer has to anchor to a real gap. On a full day there is no gap, so the
// only honest move is to make one, and there are exactly three places it can
// come from: the end of the day, a break, or the cleaning time between clients.
// Each option is a fact about *this* day, not a setting — it opens one slot on
// one date and the barber's usual hours are untouched.
export type RoomSource = 'later' | 'break' | 'buffers';
export type RoomOption = {
  source: RoomSource;
  title: string;
  sub: string;
  /** the cleaning-time option costs something the other two don't */
  warn?: boolean;
  at: Date;
  startMin: number;
  endMin: number;
};

const hhmmOf = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export function makeRoomOptions(
  day: Date, slotMin: number, windows: Window[], booked: Range[], daysOff: string[],
  blocks: Block[] = [], bufferMin = 0, breakFloorMin = 15,
): RoomOption[] {
  const ds = localDateStr(day);
  if (daysOff.includes(ds)) return [];
  const wins = windows.filter((w) => w.weekday === day.getDay());
  if (wins.length === 0) return [];   // making room on a day he doesn't work is not making room

  const at = (min: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, min);
  const dayBooked = booked.filter((b) => localDateStr(new Date(b.starts_at)) === ds);
  const out: RoomOption[] = [];

  // (a) the end of the day — nothing is in the way there by definition
  const close = Math.max(...wins.map((w) => w.end_min));
  if (close + slotMin <= 24 * 60) {
    out.push({
      source: 'later', at: at(close), startMin: close, endMin: close + slotMin,
      title: `Stay open ${slotMin} min later`,
      sub: `Close ${hhmmOf(close + slotMin)} instead of ${hhmmOf(close)}`,
    });
  }

  // (b) the longest break that can spare the time and still be a break
  const breaks = blocks
    .filter((b) => b.kind !== 'open' && (b.day === null || b.day === ds))
    .filter((b) => b.start_min + breakFloorMin + slotMin <= b.end_min)
    .sort((a, b) => (b.end_min - b.start_min) - (a.end_min - a.start_min));
  if (breaks[0]) {
    const b = breaks[0];
    const start = b.start_min + breakFloorMin;
    out.push({
      source: 'break', at: at(start), startMin: start, endMin: start + slotMin,
      title: `Cut ${b.label ?? 'the break'} to ${breakFloorMin} min`,
      sub: `Break ${hhmmOf(b.start_min)} – ${hhmmOf(start)}`,
    });
  }

  // (c) the cleaning time between clients — the first slot that is only full
  // because of the buffer, which is exactly what dropping the buffer would free
  if (bufferMin > 0) {
    const padded = daySlots(day, slotMin, windows, booked, daysOff, blocks, bufferMin);
    const bare = daySlots(day, slotMin, windows, booked, daysOff, blocks, 0);
    const freedAt = bare.find((sl) => {
      if (sl.status !== 'free') return false;
      const same = padded.find((p) => p.time.getTime() === sl.time.getTime());
      return same?.status === 'full';
    });
    if (freedAt) {
      const startMin = freedAt.time.getHours() * 60 + freedAt.time.getMinutes();
      // the bookings whose cleaning time would go: the ones this slot sits against
      const touched = dayBooked.filter((b) =>
        freedAt.time.getTime() < new Date(b.ends_at).getTime() + bufferMin * 60_000
        && freedAt.time.getTime() + slotMin * 60_000 > new Date(b.starts_at).getTime() - bufferMin * 60_000);
      const edges = touched.flatMap((b) => [new Date(b.starts_at), new Date(b.ends_at)]);
      const lo = Math.min(...edges.map((d) => d.getHours() * 60 + d.getMinutes()));
      const hi = Math.max(...edges.map((d) => d.getHours() * 60 + d.getMinutes()));
      out.push({
        source: 'buffers', at: freedAt.time, startMin, endMin: startMin + slotMin, warn: true,
        title: `Drop the buffers, ${hhmmOf(lo)} – ${hhmmOf(hi)}`,
        sub: `No cleaning time between ${touched.length} client${touched.length === 1 ? '' : 's'}`,
      });
    }
  }

  // room he cannot use is not room. 8j's "too late to open anything today" is
  // this list coming back empty.
  return out.filter((o) => o.at.getTime() > Date.now()
    && !dayBooked.some((b) => o.at.getTime() < new Date(b.ends_at).getTime()
      && o.at.getTime() + slotMin * 60_000 > new Date(b.starts_at).getTime()));
}

// per-day busyness for the schedule strip. 'closed' = not a working weekday or a day off.
export type DayState = 'closed' | 'empty' | 'partial' | 'full';
export function dayStatus(day: Date, windows: Window[], dayBookings: Range[], daysOff: string[], blocks: Block[] = [], bufferMin = 0): { state: DayState; count: number } {
  const working = windows.some((w) => w.weekday === day.getDay());
  if (!working || daysOff.includes(localDateStr(day))) return { state: 'closed', count: 0 };
  const count = dayBookings.length;
  if (count === 0) return { state: 'empty', count: 0 };
  const anyFree = daySlots(day, 30, windows, dayBookings, daysOff, blocks, bufferMin).some((sl) => sl.status === 'free');
  return { state: anyFree ? 'partial' : 'full', count };
}

// Monday-based start of the week containing d
export function weekStartOf(d: Date): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = s.getDay();
  s.setDate(s.getDate() - (day === 0 ? 6 : day - 1));
  return s;
}

export function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}
