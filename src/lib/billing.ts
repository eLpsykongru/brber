// The owner's bill and the barber's account (design_handoff_billing_rail). Pure,
// so `npm run check` can hold the arithmetic the screens print to the designs.
//
// Every figure a screen shows is a field from the server or one line of
// arithmetic here on two of them — never a number that exists only on screen.

/** 192000 → "1 920 DH". The space inside the number is a no-break one: a plain space
 * splits "1 920" in two, and an Arabic sentence then prints it as "920 1". */
export function dh(cents: number): string {
  return `${Math.round(Math.abs(cents) / 100).toLocaleString('en-US').replace(/,/g, '\u00a0')} DH`;
}

/** 103 → "1,03 DH" — OSB-04's per-booking figure, with the French decimal comma. */
export function dhFine(cents: number): string {
  return `${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')} DH`;
}

/**
 * OSB-02's arithmetic, shown rather than asserted. The discount and the months
 * free both round DOWN: "the public copy rounds down to trois mois offerts,
 * which never overstates the discount" (README §4). 40 ÷ 55 is 27,27 % → 27;
 * twelve yearly months cost 8,7 monthly ones → 3 months free, never 4.
 */
export function planMath(monthlyCents: number, yearlyCents: number, chairs: number) {
  const yearAtMonthly = monthlyCents * 12 * chairs;
  const yearAtYearly = yearlyCents * 12 * chairs;
  return {
    yearAtMonthly,
    yearAtYearly,
    saving: yearAtMonthly - yearAtYearly,
    savingPct: Math.floor((1 - yearlyCents / monthlyCents) * 100),
    monthsFree: Math.floor(12 - (yearlyCents * 12) / monthlyCents),
  };
}

export type SeatReason = 'not_on_page' | 'paused' | 'over_cap' | 'joined_mid_period' | 'paid_this_term' | null;
export type CensusRow = {
  barber_id: string; name: string; billable: boolean; reason: SeatReason;
  is_owner: boolean; setting_up: boolean; me: boolean;
};

/** What the 1st will count, as the shop stands now (OSB-01's hero). */
export function forecast(census: CensusRow[], unitCents: number, cap: number) {
  const billed = census.filter((c) => c.billable).length;
  const counted = billed + census.filter((c) => c.reason === 'over_cap').length;
  return { billed, counted, cap, cents: billed * unitCents, atCap: billed >= cap };
}

/**
 * OSB-01's amber line: a barber still setting up. At the cap he will cost the
 * shop nothing when he is live; under it, he counts from the 1st after he is on
 * the page. Returns the first such barber, or null when nobody is setting up.
 */
export function comingSoon(census: CensusRow[], cap: number) {
  const next = census.find((c) => !c.billable && c.reason === 'not_on_page' && c.setting_up);
  if (!next) return null;
  return { name: next.name, free: census.filter((c) => c.billable).length >= cap };
}

/** OSB-04: what the month cost per cut. Null when nobody sat down — no division by zero on a screen. */
export function perBooking(totalCents: number, bookings: number): number | null {
  return bookings > 0 ? Math.round(totalCents / bookings) : null;
}

/**
 * OSB-03's worked Friday: this week's deposits so far, the open bill, and what
 * comes off. The bill never takes more than the deposits (0123), so what is
 * left is never negative and a quiet week carries the rest.
 */
export function friday(depositsCents: number, openCents: number) {
  const nets = Math.min(openCents, Math.max(depositsCents, 0));
  return { nets, left: Math.max(depositsCents, 0) - nets, carries: openCents - nets };
}

/** BAC-01: the one number and which way it points. */
export function netWay(netCents: number): 'hand_over' | 'you_are_owed' | 'square' {
  return netCents > 0 ? 'hand_over' : netCents < 0 ? 'you_are_owed' : 'square';
}

/** BAC-08's last line: kept, returned, and the net across the bookings nobody sat down for. */
export function awkwardNet(keptCents: number, refundCents: number) {
  return { kept: keptCents, returned: Math.abs(refundCents), net: keptCents - Math.abs(refundCents) };
}

/** OSB-05: which rung a date is on. `called` gates the whole ladder (0124). */
export function rung(today: string, hiddenOn: string, closedOn: string, called: boolean):
  'open' | 'search_hidden' | 'bookings_closed' {
  if (!called) return 'open';
  if (today >= closedOn) return 'bookings_closed';
  if (today >= hiddenOn) return 'search_hidden';
  return 'open';
}
