// Self-check for the billing rail's arithmetic (design_handoff_billing_rail). Runs
// with the rest:
//
//     npm run check
//
// What only this file would notice: the yearly discount or the months free being
// rounded UP (the handoff forbids it anywhere); the 7-chair salon being billed for
// seven; OSB-04's "1,03 DH a booking" drifting; a quiet Friday taking more than the
// deposits it nets against; the unpaid ladder moving before anybody has called.

import {
  awkwardNet, comingSoon, dh, dhFine, forecast, friday, netWay, perBooking, planMath, rung,
  type CensusRow,
} from './billing';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.error(`FAIL  ${label} → ${e}  (got ${a})`);
}

// money on screen
eq('1 920 DH', dh(192000), '1 920 DH');
eq('55 DH', dh(5500), '55 DH');
eq('a negative prints unsigned — the word carries the direction', dh(-112000), '1 120 DH');
eq('1,03 DH', dhFine(103), '1,03 DH');

// OSB-02, the arithmetic in full, four chairs
const p = planMath(5500, 4000, 4);
eq('monthly for the year', p.yearAtMonthly, 264000);
eq('yearly for the year', p.yearAtYearly, 192000);
eq('you keep 720 DH', p.saving, 72000);
eq('−27 %, rounded down from 27,27', p.savingPct, 27);
eq('three months free — 3,27 rounds down, never up', p.monthsFree, 3);

// OSB-01: the Le Fade census — four billed, three not counted, and at the cap
const row = (name: string, billable: boolean, reason: CensusRow['reason'], setting_up = false): CensusRow =>
  ({ barber_id: name, name, billable, reason, is_owner: false, setting_up, me: false });
const leFade: CensusRow[] = [
  row('Youssef Alami', true, null), row('Hamza Bennani', true, null),
  row('Salim Ouazzani', true, null), row('Rachid Idrissi', true, null),
  row('Omar Tazi', false, 'not_on_page'), row('Zakaria Boukhris', false, 'paused'),
  row('Karim Idrissi', false, 'paused'), row('Anas Rifi', false, 'not_on_page', true),
];
const f = forecast(leFade, 5500, 4);
eq('four chairs billed', f.billed, 4);
eq('220 DH on the 1st', f.cents, 22000);
eq('and at the cap', f.atCap, true);
eq('Anas, still setting up, costs nothing once live', comingSoon(leFade, 4), { name: 'Anas Rifi', free: true });
eq('nobody setting up, no amber line', comingSoon(leFade.slice(0, 4), 4), null);

// a seven-chair salon is the same 220 DH (§0)
const seven = [...leFade.slice(0, 4), row('A', false, 'over_cap'), row('B', false, 'over_cap'), row('C', false, 'over_cap')];
eq('seven chairs counted', forecast(seven, 5500, 4).counted, 7);
eq('still 220 DH', forecast(seven, 5500, 4).cents, 22000);

// OSB-04: August, 214 bookings
eq('1,03 DH a booking', dhFine(perBooking(22000, 214)!), '1,03 DH');
eq('0,75 DH on the yearly', dhFine(perBooking(16000, 214)!), '0,75 DH');
eq('a month nobody booked has no per-booking figure', perBooking(22000, 0), null);

// OSB-03: 1 840 held − 220 = 1 620; a quiet 90 DH week nets 90 and carries 130
eq('the Friday nets the bill', friday(184000, 22000), { nets: 22000, left: 162000, carries: 0 });
eq('a quiet week carries the rest', friday(9000, 22000), { nets: 9000, left: 0, carries: 13000 });
eq('refunds past the deposits net nothing', friday(-500, 22000), { nets: 0, left: 0, carries: 22000 });

// BAC-01 and BAC-08
eq('3 240 − 1 820 is his to hand over', netWay(324000 - 182000), 'hand_over');
eq('the flip', netWay(-32000), 'you_are_owed');
eq('square', netWay(0), 'square');
eq('60 kept, 40 returned, +20', awkwardNet(6000, -4000), { kept: 6000, returned: 4000, net: 2000 });

// OSB-05: the ladder moves only after a person has called
eq('day 30 with no call is still open', rung('2026-10-31', '2026-10-15', '2026-10-31', false), 'open');
eq('called, day 11', rung('2026-10-12', '2026-10-15', '2026-10-31', true), 'open');
eq('called, 15 October', rung('2026-10-15', '2026-10-15', '2026-10-31', true), 'search_hidden');
eq('called, 31 October', rung('2026-10-31', '2026-10-15', '2026-10-31', true), 'bookings_closed');

if (failures) {
  console.error(`\n${failures} billing check(s) failed`);
  process.exit(1);
}
console.log('billing: all checks passed');
