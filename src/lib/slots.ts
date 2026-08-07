// Pure slot math, shared by the specialist screen and the booking sheet.

export type Window = { weekday: number; start_min: number; end_min: number };
export type Range = { starts_at: string; ends_at: string };
// partial-day unavailability; day = null recurs every day (e.g. lunch)
export type Block = { day: string | null; start_min: number; end_min: number };
export type SlotStatus = 'free' | 'full' | 'past';
export type Slot = { time: Date; status: SlotStatus };

export const SLOT_STEP_MIN = 30;

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// all slots in the day's working window: free / full (booked or blocked) / past.
// bufferMin = prep+cleanup gap: booked ranges repel new slots by that much on both sides.
export function daySlots(day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[], blocks: Block[] = [], bufferMin = 0): Slot[] {
  if (daysOff.includes(localDateStr(day))) return [];
  const now = Date.now();
  const buf = bufferMin * 60_000;
  const dayBlocks = blocks.filter((b) => b.day === null || b.day === localDateStr(day));
  const slots: Slot[] = [];
  for (const w of windows.filter((x) => x.weekday === day.getDay())) {
    for (let t = w.start_min; t + durationMin <= w.end_min; t += SLOT_STEP_MIN) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t);
      const end = start.getTime() + durationMin * 60_000;
      const full = booked.some((b) => start.getTime() < new Date(b.ends_at).getTime() + buf
        && end > new Date(b.starts_at).getTime() - buf)
        || dayBlocks.some((b) => t < b.end_min && t + durationMin > b.start_min);
      const status: SlotStatus = start.getTime() <= now ? 'past' : full ? 'full' : 'free';
      slots.push({ time: start, status });
    }
  }
  return slots;
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
