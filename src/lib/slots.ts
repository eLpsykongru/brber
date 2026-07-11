// Pure slot math, shared by the specialist screen and the booking sheet.

export type Window = { weekday: number; start_min: number; end_min: number };
export type Range = { starts_at: string; ends_at: string };
export type SlotStatus = 'free' | 'full' | 'past';
export type Slot = { time: Date; status: SlotStatus };

const SLOT_STEP_MIN = 30;

function localDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// all slots in the day's working window: free / full (booked) / past
export function daySlots(day: Date, durationMin: number, windows: Window[], booked: Range[], daysOff: string[]): Slot[] {
  if (daysOff.includes(localDateStr(day))) return [];
  const now = Date.now();
  const slots: Slot[] = [];
  for (const w of windows.filter((x) => x.weekday === day.getDay())) {
    for (let t = w.start_min; t + durationMin <= w.end_min; t += SLOT_STEP_MIN) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, t);
      const end = start.getTime() + durationMin * 60_000;
      const full = booked.some((b) => start.getTime() < new Date(b.ends_at).getTime()
        && end > new Date(b.starts_at).getTime());
      const status: SlotStatus = start.getTime() <= now ? 'past' : full ? 'full' : 'free';
      slots.push({ time: start, status });
    }
  }
  return slots;
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
