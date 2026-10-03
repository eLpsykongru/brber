// A chair's rent, as every screen that shows one writes it (0142, 0144).
import { loc, tr } from './i18n';

export type RentPeriod = 'week' | 'month';

const dh = (c: number) => `${Math.round(c / 100).toLocaleString('en-US').replace(/,/g, ' ')} DH`;

/** "1 500 DH / mo" — an agreed or asked rent with its period. */
export const perRent = (cents: number, period: RentPeriod) =>
  `${dh(cents)} ${tr(period === 'week' ? '/ wk' : '/ mo')}`;

/** "October 2026", or "Week of 6 Oct" for a weekly rent. */
export function rentPeriodName(iso: string, week: boolean) {
  const d = new Date(iso);
  return week
    ? tr('Week of {date}', { date: d.toLocaleDateString(loc('en-US'), { month: 'short', day: 'numeric' }) })
    : d.toLocaleDateString(loc('en-US'), { month: 'long', year: 'numeric' });
}

/** A written-down period, named by its own length rather than today's terms. */
export const paidPeriodName = (from: string, to: string) =>
  rentPeriodName(from, Date.parse(to) - Date.parse(from) < 8 * 864e5);

/** The month (or Monday's week) we are in, on this phone's clock. */
export function periodStart(week: boolean) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (week) d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); else d.setDate(1);
  return d.toISOString();
}
