// Every customer-facing string on the queue page, as the designs draw it
// (Public - Queue Link: QL-01, QL-03, QL-08, QL-09). `{name}` marks a value.
//
// French and Arabic are required (README §7) and nobody has written them yet,
// so there is only `en`. A translation is added as a sibling of this object —
// never guessed here — and RTL waits for its own design.

export const en = {
  lang: 'en',
  dir: 'ltr',
  title: '{shop} · Sterncut',

  // QL-01 — the preview card. The wait is in the text, so a preview that fails
  // to load does not take the only useful number with it.
  ogWait: '{n} waiting with {who} · ~{mins} min',
  ogUntil: ' · open until {until}',
  ogClosed: 'No walk-ins right now',

  // QL-03
  live: 'LIVE',
  openUntil: 'open until {until}',
  waitNow: 'WAIT NOW',
  mins: '~{n} min',
  ahead0: "Nobody ahead of you with {who} · you'd be ticket Nº {no}",
  ahead1: "1 person ahead of you with {who} · you'd be ticket Nº {no}",
  aheadN: "{n} people ahead of you with {who} · you'd be ticket Nº {no}",
  chair: 'CHAIR',
  anyone: 'Anyone',
  service: 'SERVICE',
  chip: '{name} · {dh} DH',
  cash: 'No deposit and no account — pay {who} in cash at the chair. Be in the shop when your turn comes or you lose the place.',
  take: 'TAKE TICKET Nº {no}',
  free: 'Free · nothing is charged on this page',
  notTaking: 'Not taking',

  // QL-08
  atShop: "You're at the shop",
  scanned: 'Scanned the code by the mirror · {time}',
  takeATicket: 'Take a ticket',
  working: '{shop} · {n} barbers working today',
  working1: '{shop} · 1 barber working today',
  soonest: 'WHO CUTS YOU · SOONEST FIRST',
  nobodyWaiting: 'Nobody waiting',
  freeNow: 'free now',
  waiting: '{n} waiting',
  stars: '{r} ★',
  cuts: '{n} cuts',
  ticketNo: 'Nº {no}',
  full: 'Booked solid until close',
  paused: 'Not taking anyone right now',
  continue: 'CONTINUE WITH {who} · Nº {no}',
  noAccount: 'No app account needed — exactly what the poster promises',
  codeTip: "Camera wouldn't read it? The six characters under the poster — {code} — do the same job.",

  // QL-09
  noWalkIns1: 'No walk-ins',
  noWalkIns2: 'right now',
  pausedAt: '{shop} paused the line at {time} — usually a full board or a barber finishing late. The code works again the moment they reopen it.',
  pausedNoTime: '{shop} paused the line — usually a full board or a barber finishing late. The code works again the moment they reopen it.',
  stillWorks: 'WHAT STILL WORKS',
  standRange: 'Tickets already taken — Nº 01 to Nº {last} stand',
  standOne: 'Tickets already taken — Nº 01 stands',
  standMany: 'Tickets already taken still stand',
  noJoin: 'Joining the line from this code',

  // QL-04
  whoComing: "Who's coming?",
  ticketFor: '{barber} · {service} {dh} DH · ~{mins} min from now',
  firstName: 'FIRST NAME',
  nameHint: "It's what {barber} will call out. No surname needed.",
  phone: 'PHONE',
  smsPromise: "One text when you're next, one if the shop closes the line. Nothing else, ever — and no marketing.",
  sendCode: 'SEND ME THE CODE',
  close: 'Close',

  // QL-05
  yourCode: 'Your code',
  textedTo: 'Texted to {phone}. It proves the number is yours, so nobody else can take your turn.',
  sendAgainIn: 'Send it again in {time}',
  sendAgain: 'Send it again',
  heldWhile: 'YOUR PLACE IS HELD WHILE YOU DO THIS',
  heldFor: 'HELD FOR',
  confirm: 'CONFIRM MY PLACE',
  wrongNumber: 'Wrong number — change it',
  back: 'Back',

  // QL-06
  youreIn: "You're in, {name}",
  joinedAt: 'Joined {time} · no account made',
  walkInTicket: 'WALK-IN TICKET',
  barberAtShop: '{barber} · {shop}',
  aheadLabel: 'AHEAD',
  estWait: 'EST. WAIT',
  inCash: 'IN CASH',
  canClose: 'YOU CAN CLOSE THIS PAGE',
  weText: 'We text {phone} when one person is left. Re-open this link any time to see the line.',
  whosUp: "WHO'S UP",
  inChairNow: 'In the chair now',
  nowBadge: 'NOW',
  youName: 'You · {name}',
  moreAfter: '{n} more after {who}, then you',
  afterWho: '{who} first, then you',
  aheadOfYou: '{n} ahead of you',
  youreNextRow: "You're next",
  leave: 'Leave the queue',

  // QL-10
  oneLine1: 'One line at',
  oneLine2: 'a time',
  oneLineBody: 'This number already holds a ticket today. Two tickets means one empty chair somewhere, so here is the one you have.',
  serviceCash: '{service} · {dh} DH cash',
  joinedLabel: 'JOINED',
  wantInstead: 'Want {barber} at {shop} instead?',
  giveUpFirst: "Give up Nº {no} first. {barber} sees you left and the chair behind you moves up — no penalty, it's a walk-in.",
  keep: 'KEEP Nº {no} · SEE THE LINE',
  leaveAndJoin: 'LEAVE IT AND JOIN {barber}',

  // Not drawn in any design: the smallest true sentence until they are.
  missingTitle: 'No shop at this address',
  missingBody: 'Check the six characters under the poster.',
  downTitle: "The line can't be shown right now",
  downBody: 'Try again in a minute.',
  badName: 'Type a first name.',
  badPhone: 'That is not a Moroccan mobile number.',
  limited: 'Too many codes for this number right now. Try again at {time}.',
  wrongCode: "That code doesn't match. {n} left to try.",
  locked: 'Too many wrong codes. Start again from the line.',
  leaveConfirm: 'LEAVE THE LINE',
  leaveTextedTo: 'Texted to {phone}. It proves the number is yours, so nobody else can give up your turn.',
  leftTitle: 'You left the line',
  leftBody: 'Your place went to whoever was behind you. Nothing was charged.',
  startedTitle: 'Your cut has already started',
  doneTitle: 'This cut is done',
  goneTitle: 'This ticket is no longer in the line',
  seeLine: 'SEE THE LINE',
  appTicket: 'This ticket is in the Sterncut app on that phone.',

  // ---- ADDENDUM-guest-states ----
  // QL-11
  checkLast: 'Texted to {phone}. Check the last message — codes older than 5 minutes stop working.',
  notTheCode2: "That's not the code. Two more tries, then we start over with a new number.",
  // not drawn: the same sentence, one try later
  notTheCode1: "That's not the code. One more try, then we start over with a new number.",
  stillHolding: 'STILL HOLDING',
  holdingFor: 'FOR',
  newCode: 'TEXT ME A NEW CODE',

  // QL-12
  letGo1: 'We let',
  letGo2: 'Nº {no} go',
  letGoBody: "Three wrong codes in a row usually means the number isn't the phone in your hand — and a held number nobody can confirm blocks the person behind it.",
  boardCarriedOn: "{barber}'s board carried on without you.",
  movedOn: 'THE LINE MOVED ON',
  nextFree: 'Next free number',
  waitNowPlain: 'Wait now',
  rejoinFree: 'Rejoining is free and takes the same four digits. You can also try in 15 minutes — we block repeat attempts from this number until then.',
  inShop: 'Standing in the shop?',
  askByName: 'Ask {barber} to add you by name — he can put a walk-in on the board without any of this.',
  tryAgainFor: 'TRY AGAIN FOR Nº {no}',

  // QL-13
  calledKicker: 'Nº {no} · {barber} IS READY',
  comeIn1: 'Come in',
  comeIn2: 'now',
  chairHeldFor: 'CHAIR HELD FOR',
  afterThat: "After that {barber} takes Nº {no} and you'd rejoin at the back.",
  // not drawn: the same sentence when nobody is behind him to take it
  afterThatAlone: "After that the chair moves on and you'd rejoin at the back.",
  shopAt: '{shop} · {address}',
  alsoTexted: 'We also texted {phone} — this page turned red on its own, nothing to refresh.',
  // not drawn: the same reassurance when no text went out (he joined an empty chair)
  turnedRed: 'This page turned red on its own — nothing to refresh.',
  walkingIn: "I'M WALKING IN",
  giveMe5: 'GIVE ME 5 MINUTES',
  // not drawn: what each tap leaves on the page. Only the barber can hold the
  // chair longer, so neither one claims the clock stopped.
  onTheWay: '{barber} can see you are on the way. The chair is still counting down.',
  fiveAdded: 'Five minutes added, once. {barber} can see that too.',

  // QL-14
  holdIsEight: 'Eight minutes is the hold every chair gets.',
  calledReleased: 'Called {called} · released {released}',
  releasedAt: 'Released {released}',
  cuttingNow: '{barber} is cutting Nº {no} now',
  noCharge: "Nothing was charged and this doesn't count against you.",
  stillWant: 'Still want the cut?',
  behindN: 'Rejoining puts you behind the {n} people who arrived while the chair sat empty.',
  behind1: 'Rejoining puts you behind the one person who arrived while the chair sat empty.',
  rejoinAs: 'REJOIN AS',
  waitLabel: 'WAIT',
  noNewCode: 'No new code needed — this number is already confirmed today.',
  rejoinCta: 'REJOIN AS Nº {no}',

  // QL-15
  pausedBoardAt: "{barber} paused the board at {time}. Your place is kept, the clock isn't running.",
  pausedBoard: "{barber} paused the board. Your place is kept, the clock isn't running.",
  ticketHeld: 'WALK-IN TICKET · HELD',
  pausedWord: 'paused',
  frozenFor: 'FROZEN FOR',
  pauseUsually: 'WHAT A PAUSE USUALLY IS',
  pauseBody: "A long cut running over, or a break. Nobody new can join while it's paused, so you won't slip further back.",

  // QL-17
  shutEyebrow: '{shop} · {time}',
  shut1: 'Shut for',
  shut2: 'tonight',
  shutBody: 'Walk-ins run while the doors are open — {when}.',
  whenTomorrow: '{time} tomorrow',
  whenOn: '{time} on {day}',
  firstChairTomorrow: 'FIRST CHAIR TOMORROW',
  firstChairOn: 'FIRST CHAIR {DAY}',
  withLabel: 'WITH',
  openHours: 'OPEN HOURS',
  hoursRange: '{from} — {to}',
  closedDay: 'Closed',
  openTill: '{shop} is open till {time}',
  nearbySub: '{distance} · {n} in line · ~{mins} min',
  scanAgain: 'Or scan this code again in the morning — it never changes.',
  days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

/** Put values into a template. Unknown or empty values print nothing, never "undefined". */
export function fill(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (values[key] == null ? '' : String(values[key])));
}
