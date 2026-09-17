// Every customer-facing string on the queue page, as ADDENDUM-app-first (turn Q3)
// draws it: QL-18, QL-23 … QL-26, plus QL-09, whose overlap with QL-26 is the
// owner's to decide. `{name}` marks a value.
//
// French and Arabic are required and nobody has written them for the page yet,
// so there is only `en`. A translation is added as a sibling of this object —
// never guessed here — and RTL waits for its own design (A8).

export const en = {
  lang: 'en',
  dir: 'ltr',
  title: '{shop} · Sterncut',

  // QL-01 — the preview card. The wait is in the text, so a preview that fails
  // to load does not take the only useful number with it.
  ogWait: '{n} waiting with {who} · ~{mins} min',
  ogLine: '{n} in the line · ~{mins} min',
  ogUntil: ' · open until {until}',
  ogClosed: 'No walk-ins right now',
  ogShut: 'No line right now',

  // QL-18 · the line, read-only
  live: 'LIVE',
  openUntil: 'open until {until}',
  waitNow: 'WAIT NOW',
  mins: '~{n} min',
  // A6 item 2 — the page must never imply a place is held
  inLine: '{n} in the line right now. Nothing on this page holds a place for you.',
  inLine0: 'Nobody in the line right now. Nothing on this page holds a place for you.',
  theLine: 'THE LINE',
  ticketNo: 'Nº {no}',
  inChair: 'In the chair',
  next: 'Next',
  waitingRow: 'Waiting',
  // BTD-15 — called, never came, dropped to the end by the barber: no minutes to quote
  calledEnd: 'Called · at the end',
  withWho: '{state} · {who}',
  nowWord: 'now',
  chairsToday: 'CHAIRS TODAY',
  notTaking: 'Not taking',
  // A6 item 1 — the in-shop path, and it must read as the easy option
  inShop: 'Standing in the shop?',
  inShopBody: "Just tell us your name — we'll put it on the line for you.",
  getApp: 'GET STERNCUT TO HOLD A PLACE',
  notAtShop: 'Not at the shop? Put your name on the line',

  // QL-23 · the one form left on the web
  backToLine: 'Back to the line',
  putName1: 'Put your name',
  putName2: 'on the line',
  putNameBody: "For when you're on your way and can't install anything. In the shop? Ask the barber instead — it's faster.",
  yourName: 'YOUR NAME',
  yourNumber: 'YOUR NUMBER',
  noCode: 'No code to type.',
  // A6 item 3
  noCodeBody: 'We text you once — tap the link in that text and the place is confirmed.',
  putMeOn: 'PUT ME ON Nº {no}',
  // A6 item 4 — do not soften
  mayCallPast: 'Until you confirm, {barber} may call past your number',
  badName: 'Type a first name.',
  badPhone: 'That is not a Moroccan mobile number.',
  limited: 'Too many texts to this number right now. Try again at {time}.',
  already: 'This number already holds a place in a line today.',

  // QL-24 · unconfirmed
  notConfirmed: 'NOT CONFIRMED YET',
  nameAtShop: '{name} · {shop}',
  aheadWith: '{n} ahead with {barber} · ~{mins} min',
  aheadWith0: 'Nobody ahead with {barber} · ~{mins} min',
  weTexted: 'WE JUST TEXTED YOU',
  // A6 item 5
  greyed: '{barber} sees Nº {no} greyed on his board and {past}',
  mayCallPastIt: 'may call past it.',
  openTheText: 'Nothing to do here — open the text',

  // QL-25 · confirmed
  confirmed: 'CONFIRMED',
  nameWithBarber: '{name} · WITH {barber}',
  aheadOfYou: 'AHEAD OF YOU',
  about: 'ABOUT',
  minUnit: '{n} min',
  oneMore: 'One more text, then nothing.',
  // A6 item 6
  oneMoreBody: "You'll hear from us when you're next — this page won't ping you, so don't sit watching it.",
  // not drawn: the same card once that one text has already gone
  nextSent: "That text has gone: you're next.",
  nextSentBody: 'Come to the chair. There is nothing more to wait for here.',
  withApp: "With the app you'd watch the line move and leave it in one tap.",
  getTheApp: 'GET THE APP',
  giveUp: 'Give up my place',

  // QL-26 · closed
  closedBadge: 'CLOSED',
  noLine: 'No line right now',
  closedAt: 'The shop closed at {time}.',
  closedToday: 'The shop is closed for the rest of today.',
  openAgain: '{who} open again {when} — the line starts filling then.',
  opensAgain: '{who} opens again {when} — the line starts filling then.',
  whenTomorrow: 'tomorrow at {time}',
  whenOn: 'on {day} at {time}',
  tomorrow: 'Tomorrow',
  hoursRange: '{from} – {to}',
  closedDay: 'Closed',
  bookInstead: 'BOOK A TIME INSTEAD',
  and: ' and ',
  days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

  // QL-09 · the shop closed the line (kept as built until the owner picks QL-09 or QL-26)
  noWalkIns1: 'No walk-ins',
  noWalkIns2: 'right now',
  pausedAt: '{shop} paused the line at {time} — usually a full board or a barber finishing late. The code works again the moment they reopen it.',
  pausedNoTime: '{shop} paused the line — usually a full board or a barber finishing late. The code works again the moment they reopen it.',
  stillWorks: 'WHAT STILL WORKS',
  standRange: 'Tickets already taken — Nº 01 to Nº {last} stand',
  standOne: 'Tickets already taken — Nº 01 stands',
  standMany: 'Tickets already taken still stand',
  noJoin: 'Joining the line from this code',

  // Not drawn in any design: the smallest true sentence until they are.
  missingTitle: 'No shop at this address',
  missingBody: 'Check the six characters under the poster.',
  downTitle: "The line can't be shown right now",
  downBody: 'Try again in a minute.',
  leftTitle: 'You gave up your place',
  leftBody: 'It went to whoever was behind you. Nothing was charged.',
  startedTitle: 'Your cut has already started',
  doneTitle: 'This cut is done',
  goneTitle: 'This place is no longer in the line',
  seeLine: 'SEE THE LINE',

  // QL-27 · he tapped, and the place was already gone. Never an error page: what
  // happened, the wait now, and the two real options.
  goneBadge: 'Nº {no} IS GONE',
  goneBadgePlain: 'THIS PLACE IS GONE',
  ranOutBadge: 'THIS LINK HAS RUN OUT',
  cameAndWent1: 'Your turn came',
  cameAndWent2: 'and went',
  cameAndWentBody: "{barber} reached Nº {no} and we never got a tap from this phone, so he couldn't know you were coming and carried on down the line.",
  placeGone1: 'That place is',
  placeGone2: 'no longer in the line',
  placeGoneBody: 'Nº {no} with {barber} is not in the line any more.',
  placeGonePlain: 'It is not in the line any more.',
  ranOut1: 'That link',
  ranOut2: 'has run out',
  ranOutBody: 'It only worked on the day it was sent, and that line has finished.',
  goneWait: '{n} in the line now · {who} is free soonest',
  goneWait0: 'Nobody in the line now · {who} is free',
  stillWant: 'IF YOU STILL WANT A CUT',
  walkIn: 'Walk in and say your name.',
  walkInBody: '{barber} will put you back on — that is the fastest thing on this page.',
  walkInLater: 'Walk in when the shop is taking names again, and say your name.',
  putAgain: 'Put your name on again',
  putAgainBody: " — you'd start at the back, and you'd have to tap the text this time.",
  nothingHeld: 'Nothing is held against you. There is no account here to mark, and no fee — you never paid anything.',
  seeLineNow: 'SEE THE LINE NOW',
  putMineAgain: 'Put my name on again',

  // BTD-16's text, tapped · not drawn: the smallest true thing each
  booked: 'BOOKED',
  withBarber: 'WITH {barber}',
  dayWord: 'DAY',
  whereWord: 'AT',
  bookedWhat: '{service} at {shop}',
  payCash: 'Pay {barber} in cash at the chair.',
  payCashBody: 'No deposit, and nothing more to tap.',
  takenTitle1: 'That time',
  takenTitle2: 'has gone',
  takenBody: 'Somebody took {when} with {barber} before you tapped. Nothing was booked, and nothing was charged.',
  offerRanOut1: 'That offer',
  offerRanOut2: 'has run out',
  offerRanOutBody: '{when} with {barber} has already passed. Nothing was booked, and nothing was charged.',
  offerGoneTitle: 'This booking is no longer in the book',
  offerGoneBody: 'Nothing was charged.',
  askAnother: 'Walk in and ask {barber} for another time, or get the app and book one yourself.',
  whenDay: '{day} at {time}',
  unknownTitle: 'That link does not match a place',
  unknownBody: 'Check the text it came in, or ask the barber to put your name on the line.',
  previewTitle: 'Open this link on your phone',
  previewBody: 'It confirms a place in a line, so it only works when it is tapped.',
  noStoreTitle: "Sterncut isn't in this phone's app store yet",
  noStoreBody: 'Ask the barber to put your name on the line.',
};

/** Put values into a template. Unknown or empty values print nothing, never "undefined". */
export function fill(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (values[key] == null ? '' : String(values[key])));
}
