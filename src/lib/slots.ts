// Pure slot math, shared by the specialist screen and the booking sheet.

export type Window = { weekday: number; start_min: number; end_min: number };
export type Range = { starts_at: string; ends_at: string };
// partial-day unavailability; day = null recurs every day (e.g. lunch)
export type Block = { day: string | null; start_min: number; end_min: number };
export type SlotStatus = 'free' | 'full' | 'past';
export type Slot = { time: Date; status: SlotStatus };

const SLOT_STEP_MIN = 30;

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// all slots in the day's working window: free / full (booked or blocked) / past
export function daySlots(day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[], blocks: Block[] = []): Slot[] {
  if (daysOff.includes(localDateStr(day))) return [];
  const now = Date.now();
  const dayBlocks = blocks.filter((b) => b.day === null || b.day === localDateStr(day));
  const slots: Slot[] = [];
  for (const w of windows.filter((x) => x.weekday === day.getDay())) {
    for (let t = w.start_min; t + durationMin <= w.end_min; t += SLOT_STEP_MIN) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t);
      const end = start.getTime() + durationMin * 60_000;
      const full = booked.some((b) => start.getTime() < new Date(b.ends_at).getTime()
        && end > new Date(b.starts_at).getTime())
        || dayBlocks.some((b) => t < b.end_min && t + durationMin > b.start_min);
      const status: SlotStatus = start.getTime() <= now ? 'past' : full ? 'full' : 'free';
      slots.push({ time: start, status });
    }
  }
  return slots;
}

// per-day busyness for the schedule strip. 'closed' = not a working weekday or a day off.
export type DayState = 'closed' | 'empty' | 'partial' | 'full';
export function dayStatus(day: Date, windows: Window[], dayBookings: Range[], daysOff: string[], blocks: Block[] = []): { state: DayState; count: number } {
  const working = windows.some((w) => w.weekday === day.getDay());
  if (!working || daysOff.includes(localDateStr(day))) return { state: 'closed', count: 0 };
  const count = dayBookings.length;
  if (count === 0) return { state: 'empty', count: 0 };
  const anyFree = daySlots(day, 30, windows, dayBookings, daysOff, blocks).some((sl) => sl.status === 'free');
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
