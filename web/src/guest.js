// Step 2 of the queue link: QL-04 (who's coming), QL-05 (the code), QL-06 (the
// ticket) and QL-10 (one line at a time), plus the endings no design draws —
// left, started, done, gone. Plain forms that work with no script at all;
// guest-client.js only adds the four boxes, the countdowns and the live line.
// The addendum's states land here too: QL-11 (a wrong code), QL-12 (the place let
// go), QL-14 (missed) and QL-15 (the line frozen, the ticket standing).

import { en, fill } from './copy.js';
import { guestClient } from './guest-client.js';
import { ICON, brand, clock, esc, firstName, json, markup, pad, shell, text } from './render.js';

const SCRIPT = `(${guestClient})();`;
// before the first paint, so the code field is drawn as four boxes straight away
const JS_CLASS = '\n<script>document.documentElement.classList.add("js")</script>';

const svg = (size, stroke, width, paths) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" aria-hidden="true">${paths}</svg>`;
const LOCK = svg(28, '#5C5C58', 2, '<rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>');
const ALERT = svg(16, '#E8442E', 2.2, '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>');
const CLOCK_AMBER = svg(16, '#B57A00', 2.2, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
const PAUSE_AMBER = svg(17, '#B57A00', 2.2, '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>');
const AGAIN = svg(15, '#fff', 2.2, '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/>');
const PIN_WHITE = svg(19, '#fff', 2, '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>');

const nine = (phone) => String(phone ?? '').replace(/\D/g, '').slice(-9);
/** "+212 6 61 34 12 90" — the number QL-05 says the code went to. */
const intl = (phone) => {
  const d = nine(phone);
  return `+212 ${d[0]} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
};
/** "0661 34 12 90" — the number QL-06 says the texts will go to. */
const local = (phone) => {
  const d = nine(phone);
  return `0${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
};
const dh = (cents) => Math.round(cents / 100);
const mmss = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const secondsUntil = (iso, nowIso) =>
  Math.max(0, Math.ceil((Date.parse(iso) - Date.parse(nowIso ?? new Date().toISOString())) / 1000));
/** What the page's poll compares; guest-client.js builds the same array from the JSON. */
const sigOf = (tk) => JSON.stringify([tk.stage, tk.no, tk.ahead, tk.in_chair ? tk.in_chair.no : null, !!tk.paused]);

/** Where an expired or refused step goes back to: the same chair, re-quoted (README §5). */
export const requote = (want, shop) => `/q/${want?.shop || shop}${want?.barber ? `?b=${want.barber}` : ''}`;

// ---- QL-04 · the only two things we ask ------------------------------------------
export function renderJoin(data, chair, service, { src = 'link', values = {}, error = null, t = en } = {}) {
  const barber = firstName(chair.name);
  const back = `/q/${data.code}?b=${chair.code}${src === 'code' ? '&src=code' : ''}`;
  const problem = !error ? ''
    : error.limited ? fill(t.limited, { time: clock(new Date(error.limited)) })
      : error.field === 'name' ? t.badName : t.badPhone;
  const invalid = (field) => (error?.field === field ? ' aria-invalid="true" autofocus' : '');

  const body = `<form class="sheet" method="post" action="/q/${esc(data.code)}/join" novalidate>
<span class="grab"></span>
<div class="sheethead"><span class="slot"></span><h1 class="serif">${text(t.whoComing)}</h1><a class="slot" href="${esc(back)}" aria-label="${text(t.close)}">${ICON.close}</a></div>
<div class="mini"><span class="serif">${text(t.ticketNo, { no: pad(chair.next_no) })}</span><span class="vr"></span><span class="grow">${text(t.ticketFor, { barber, service: service.name, dh: dh(service.price_cents), mins: service.wait_min })}</span></div>
<label class="field"><span class="label">${text(t.firstName)}</span><input class="input" name="first_name" autocomplete="given-name" maxlength="30" required value="${esc(values.first_name)}"${invalid('name')}><span class="hint">${text(t.nameHint, { barber })}</span></label>
<label class="field"><span class="label">${text(t.phone)}</span><span class="phone"><span class="cc">+212</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" required value="${esc(values.phone)}"${invalid('phone')}></span></label>
${problem ? `<p class="err" role="alert">${esc(problem)}</p>` : ''}
<aside class="note">${ICON.chat}<span>${text(t.smsPromise)}</span></aside>
<input type="hidden" name="b" value="${esc(chair.code)}"><input type="hidden" name="s" value="${esc(service.id)}"><input type="hidden" name="src" value="${esc(src)}">
<button class="cta" type="submit">${text(t.sendCode)}</button>
</form>`;
  return shell({ t, title: fill(t.title, { shop: data.name }), body, sheet: true });
}

// ---- QL-05 · four digits, because the number is the ticket -----------------------
// One screen for all three conversations: joining (with the held place and its
// countdown), leaving, and proving a number that already holds a ticket. After a
// wrong code it is QL-11: the digits stay on show in red, the place is "still
// holding", and once a new code may be sent the button sends one.
export function renderCode(view, { shop, token, error = null, t = en } = {}) {
  const base = `/q/${esc(shop)}/code/${esc(token)}`;
  const want = view.want ?? {};
  const leaving = view.purpose === 'leave';
  const hold = view.purpose === 'join' ? view.hold : null;
  const wrong = error?.wrong ?? null;
  const back = leaving
    ? `/q/${want.shop || shop}/t/${want.ticket}`
    : `/q/${want.shop || shop}/join?b=${want.barber}&s=${want.service}&src=${want.source === 'code' ? 'code' : 'link'}`;
  const resendIn = secondsUntil(view.resend_at, view.now);
  const heldFor = secondsUntil(view.expires_at, view.now);
  const phone = `<strong>${esc(intl(view.phone))}</strong>`;
  const said = wrong != null
    ? markup(t.checkLast, { phone })
    : markup(leaving ? t.leaveTextedTo : t.textedTo, { phone });
  const problem = error?.limited ? fill(t.limited, { time: clock(new Date(error.limited)) }) : '';
  const newCodeCta = wrong != null && resendIn === 0;

  const heldCard = hold ? `<div class="held"><span class="eyebrow">${text(wrong != null ? t.stillHolding : t.heldWhile)}</span>`
    + `<div class="heldrow"><span><span class="serif no24">${text(t.ticketNo, { no: pad(hold.no) })}</span>`
    + `<span class="sub">${text(t.barberAtShop, { barber: hold.barber, shop: hold.shop })}</span></span>`
    + `<span><span class="eyebrow">${text(wrong != null ? t.holdingFor : t.heldFor)}</span><b class="count" data-until="${esc(view.expires_at)}">${mmss(heldFor)}</b></span></div></div>` : '';
  const bad = wrong != null && /^\d{4}$/.test(error.digits ?? '') ? ` data-bad="${esc(error.digits)}"` : '';

  const body = `<div class="sheet">
<span class="grab"></span>
<div class="sheethead"><a class="slot" href="${esc(back)}" aria-label="${text(t.back)}">${ICON.back}</a><h1 class="serif">${text(t.yourCode)}</h1><span class="slot"></span></div>
<p class="textedto">${said}</p>
<form method="post" action="${base}" id="code">
<label class="digits"${bad}><input name="code" inputmode="numeric" pattern="[0-9]*" autocomplete="one-time-code" maxlength="4" required aria-label="${text(t.yourCode)}"><span></span><span></span><span></span><span></span></label>
</form>
${wrong != null ? `<p class="alarm" role="alert">${ALERT}<span>${text(wrong === 1 ? t.notTheCode1 : t.notTheCode2)}</span></p>` : ''}
${problem ? `<p class="err" style="text-align:center" role="alert">${esc(problem)}</p>` : ''}
${newCodeCta
    ? `<form id="resend" method="post" action="${base}/resend" hidden></form>`
    : `<form class="resend" id="resend" method="post" action="${base}/resend">
<span data-resend-wait data-at="${esc(view.resend_at)}"${resendIn === 0 ? ' hidden' : ''}>${ICON.clock} ${markup(t.sendAgainIn, { time: `<span data-left>${mmss(resendIn)}</span>` })}</span>
<button type="submit" data-resend${resendIn > 0 ? ' hidden' : ''}>${text(t.sendAgain)}</button>
</form>`}
${heldCard}
${newCodeCta
    ? `<button class="cta" type="submit" form="resend">${AGAIN}<span>${text(t.newCode)}</span></button>`
    : `<button class="cta" type="submit" form="code">${text(leaving ? t.leaveConfirm : t.confirm)}</button>`}
${view.purpose === 'join' ? `<form method="post" action="${base}/drop"><button class="link" type="submit">${text(t.wrongNumber)}</button></form>` : ''}
</div>`;

  const state = { now: view.now, expired: leaving ? back : requote(want, shop) };
  const script = `<script id="g-data" type="application/json">${json(state)}</script>\n<script>${SCRIPT}</script>`;
  return shell({ t, title: 'Sterncut', body, sheet: true, head: JS_CLASS, script });
}

// ---- QL-12 · three wrong codes: the place is let go ---------------------------------------
// Not here: BOOK A TIME INSTEAD — a browser with no account cannot book.
export function renderLetGo(result, { shop, data = null, t = en } = {}) {
  const want = result.want ?? {};
  const chair = data?.found ? data.chairs.find((c) => c.code === want.barber) ?? null : null;
  const service = chair && data.open && !data.shut && chair.state === 'taking'
    ? chair.services.find((s) => s.id === want.service && s.wait_min != null) ?? null
    : null;
  const barber = chair ? firstName(chair.name) : null;
  const src = want.source === 'code' ? 'code' : 'link';
  const again = service ? `/q/${data.code}/join?b=${chair.code}&s=${service.id}&src=${src}` : requote(want, shop);

  const body = `<span class="lockc">${LOCK}</span>
<div><h1 class="serif h26">${text(t.letGo1)}<br>${text(t.letGo2, { no: pad(result.released_no) })}</h1><p class="lede">${text(t.letGoBody)}${barber ? ` ${text(t.boardCarriedOn, { barber })}` : ''}</p></div>
${service ? `<section class="card"><span class="eyebrow">${text(t.movedOn)}</span><div class="heldrow"><span><small class="lbl">${text(t.nextFree)}</small><span class="serif no26">${text(t.ticketNo, { no: pad(chair.next_no) })}</span></span><span class="r"><small class="lbl">${text(t.waitNowPlain)}</small><b class="w20">${text(t.mins, { n: service.wait_min })}</b></span></div><p class="cardnote">${text(t.rejoinFree)}</p></section>` : ''}
${barber ? `<aside class="amberbox">${CLOCK_AMBER}<span><strong>${text(t.inShop)}</strong> ${text(t.askByName, { barber })}</span></aside>` : ''}`;

  const dock = `<footer class="dock"><a class="cta hot" href="${esc(again)}">${service
    ? text(t.tryAgainFor, { no: pad(chair.next_no) })
    : text(t.seeLine)}</a></footer>`;
  return shell({ t, title: 'Sterncut', body, dock, loose: true });
}

// ---- QL-06 · a ticket that is just a web page --------------------------------------
export function renderTicket(tk, { token, error = null, t = en } = {}) {
  if (tk.paused && tk.stage === 'waiting') return frozenTicket(tk, { token, error, t });
  const shop = tk.shop_code;
  const inChair = tk.in_chair;
  const mine = tk.stage === 'in_chair';
  const waitingBefore = Math.max(0, tk.ahead - (inChair ? 1 : 0));
  const sub = mine ? t.inChairNow
    : inChair
      ? (waitingBefore > 0
        ? fill(t.moreAfter, { n: waitingBefore, who: firstName(inChair.label) })
        : fill(t.afterWho, { who: firstName(inChair.label) }))
      : tk.ahead > 0 ? fill(t.aheadOfYou, { n: tk.ahead }) : t.youreNextRow;

  const chairRow = inChair && !mine
    ? `<div class="row"><span class="av hot">${pad(inChair.no)}</span><span class="who"><b>${esc(inChair.label)}</b>`
      + `<span>${text(t.inChairNow)}</span></span><span class="badge">${text(t.nowBadge)}</span></div>`
    : '';
  const myRow = `<div class="row me"><span class="av me">${pad(tk.no)}</span><span class="who"><b>${text(t.youName, { name: tk.first_name })}</b>`
    + `<span>${esc(sub)}</span></span>`
    + (mine ? `<span class="badge">${text(t.nowBadge)}</span>` : `<span class="coral" data-mins>${text(t.mins, { n: tk.wait_min })}</span>`)
    + '</div>';

  const body = `<div class="inrow"><span class="okc">${ICON.tickBig}</span><span class="grow"><h1 class="serif h20">${text(t.youreIn, { name: tk.first_name })}</h1><span class="sub">${text(t.joinedAt, { time: clock(new Date(tk.joined_at)) })}</span></span></div>
<section class="ticket"><span class="eyebrow">${text(t.walkInTicket)}</span><span class="serif t52">${text(t.ticketNo, { no: pad(tk.no) })}</span><span class="tsub">${text(t.barberAtShop, { barber: tk.barber, shop: tk.shop })}</span>
<div class="stats"><span><b>${tk.ahead}</b><small>${text(t.aheadLabel)}</small></span><i></i><span><b><span data-num>~${tk.wait_min}</span><em> min</em></b><small>${text(t.estWait)}</small></span><i></i><span><b>${dh(tk.price_cents)}<em> DH</em></b><small>${text(t.inCash)}</small></span></div></section>
<section class="card"><span class="eyebrow">${text(t.canClose)}</span><div class="texted"><span class="ico">${ICON.chatCoral}</span><span>${markup(t.weText, { phone: `<strong>${esc(local(tk.phone))}</strong>` })}</span></div></section>
<p class="label">${text(t.whosUp)}</p>
<div class="rows">${chairRow}${myRow}</div>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}`;

  // no leaving once the cut has started — the server refuses it too
  const dock = mine ? ''
    : `<footer class="dock"><form method="post" action="/q/${esc(shop)}/t/${esc(token)}/leave"><button class="link" type="submit">${text(t.leave)}</button></form></footer>`;

  const state = { poll: `/q/${shop}/t/${token}?json=1`, sig: sigOf(tk), mins: t.mins };
  const script = `<script id="g-data" type="application/json">${json(state)}</script>\n<script>${SCRIPT}</script>`;
  return shell({ t, title: fill(t.title, { shop: tk.shop }), body, dock, script });
}

// ---- QL-15 · the line frozen, the ticket standing -------------------------------------
// Not here: "Boards come back inside 20 minutes most days" (nothing measures it),
// "We text you the moment it restarts" (a third text nobody designed — A7), and
// CALL THE SHOP (whose phone that is waits on the owner — BACKLOG).
function frozenTicket(tk, { token, error, t }) {
  const since = tk.paused_at ? clock(new Date(tk.paused_at)) : null;
  const frozen = tk.paused_at ? Math.max(0, Math.floor((Date.now() - Date.parse(tk.paused_at)) / 60_000)) : null;

  const body = `<div class="amberbar">${PAUSE_AMBER}<span>${text(since ? t.pausedBoardAt : t.pausedBoard, { barber: tk.barber, time: since })}</span></div>
<section class="ticket"><span class="eyebrow">${text(t.ticketHeld)}</span><span class="serif t52">${text(t.ticketNo, { no: pad(tk.no) })}</span><span class="tsub">${text(t.barberAtShop, { barber: tk.barber, shop: tk.shop })}</span>
<div class="stats"><span><b>${tk.ahead}</b><small>${text(t.aheadLabel)}</small></span><i></i><span><b class="dimnum">${text(t.pausedWord)}</b><small>${text(t.estWait)}</small></span><i></i>${frozen != null
    ? `<span><b><span data-since="${esc(tk.paused_at)}">${frozen}</span><em> min</em></b><small>${text(t.frozenFor)}</small></span>`
    : `<span><b>${dh(tk.price_cents)}<em> DH</em></b><small>${text(t.inCash)}</small></span>`}</div></section>
<section class="card"><span class="eyebrow">${text(t.pauseUsually)}</span><p class="cardtext">${text(t.pauseBody)}</p></section>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}`;

  const dock = `<footer class="dock"><form method="post" action="/q/${esc(tk.shop_code)}/t/${esc(token)}/leave"><button class="link" type="submit">${text(t.leave)}</button></form></footer>`;
  const state = { poll: `/q/${tk.shop_code}/t/${token}?json=1`, sig: sigOf(tk), mins: t.mins, now: new Date().toISOString() };
  const script = `<script id="g-data" type="application/json">${json(state)}</script>\n<script>${SCRIPT}</script>`;
  return shell({ t, title: fill(t.title, { shop: tk.shop }), body, dock, script });
}

// ---- QL-13 · called, while the page is still open ----------------------------------------
// The one page that arrives with no tap: the ticket's 20 s poll reads
// `stage: 'called'` and redraws (ADDENDUM A5 — a poll, not a realtime channel,
// which is README §6's own mechanism). The countdown is the server's: 0116 holds
// the chair eight minutes from the call, five more if he asks for them, and its
// sweep ends the hold whether or not this page is open — so at zero the page
// reloads, into QL-14.
// Not here: "3 min walk · second door past the pharmacy" — nothing knows where he
// is standing, or what the door looks like.
export function renderCalled(tk, { token, t = en } = {}) {
  const base = `/q/${esc(tk.shop_code)}/t/${esc(token)}`;
  const left = secondsUntil(tk.called_until);
  const after = tk.behind > 0
    ? fill(t.afterThat, { barber: tk.barber, no: pad(tk.no + 1) })
    : t.afterThatAlone;
  const where = tk.address ? fill(t.shopAt, { shop: tk.shop, address: tk.address }) : tk.shop;
  // only said when 0113 really queued one: joining an empty chair sends no text
  const said = tk.texted
    ? markup(t.alsoTexted, { phone: `<strong>${esc(local(tk.phone))}</strong>` })
    : esc(t.turnedRed);
  // both, when he tapped both: one of them replacing the other would read as the
  // five minutes not having been given
  const asked = [
    tk.coming ? fill(t.onTheWay, { barber: tk.barber }) : null,
    tk.extended ? fill(t.fiveAdded, { barber: tk.barber }) : null,
  ].filter(Boolean);

  const body = `<div><span class="kick">${text(t.calledKicker, { no: pad(tk.no), barber: tk.barber.toUpperCase() })}</span>
<h1 class="serif h46">${text(t.comeIn1)}<br>${text(t.comeIn2)}</h1></div>
<section class="holdcard"><span class="eyebrow">${text(t.chairHeldFor)}</span><b class="hold56" data-until="${esc(tk.called_until)}">${mmss(left)}</b><p>${esc(after)}</p></section>
<div class="inkrow"><span class="pin">${PIN_WHITE}</span><span class="grow"><b>${esc(where)}</b></span></div>
<p class="darkbox">${said}</p>
${asked.map((line) => `<p class="darkbox">${esc(line)}</p>`).join('')}`;

  // "I'm walking in" tells the barber and leaves the clock alone; the five
  // minutes can be asked for once. Each button goes when its say is said.
  const taps = [
    tk.coming ? '' : `<form method="post" action="${base}/coming"><button class="cta white" type="submit">${text(t.walkingIn)}</button></form>`,
    tk.extended ? '' : `<form method="post" action="${base}/wait"><button class="cta ink" type="submit">${text(t.giveMe5)}</button></form>`,
  ].filter(Boolean).join('');
  const dock = taps ? `<footer class="dock">${taps}</footer>` : '';

  const state = {
    poll: `/q/${tk.shop_code}/t/${token}?json=1`,
    sig: sigOf(tk),
    mins: t.mins,
    now: new Date().toISOString(),
    // the hold running out is a new page, not a stopped clock
    expired: `/q/${tk.shop_code}/t/${token}`,
  };
  const script = `<script id="g-data" type="application/json">${json(state)}</script>\n<script>${SCRIPT}</script>`;
  return shell({ t, title: fill(t.title, { shop: tk.shop }), body, dock, script, loose: true, skin: 'hot' });
}

// ---- QL-14 · missed, and the chair moved on ----------------------------------------------
// Reached when the hold above runs out, or when the barber marks the guest a
// no-show. The eight minutes are quoted only to somebody who was called — a guest
// taken off the line was never given them. Not here: "Or take 16:15 today" with
// its BOOK button, because a browser cannot book.
export function renderMissed(tk, { token, data = null, t = en } = {}) {
  const chair = data?.found ? data.chairs.find((c) => c.code === tk.barber_code) ?? null : null;
  const service = chair && data.open && !data.shut && chair.state === 'taking'
    ? chair.services.find((s) => s.id === tk.service_id && s.wait_min != null) ?? null
    : null;
  const released = tk.missed_at ? clock(new Date(tk.missed_at)) : null;
  const when = released && tk.called_at
    ? fill(t.calledReleased, { called: clock(new Date(tk.called_at)), released })
    : released ? fill(t.releasedAt, { released }) : '';
  const cutting = tk.in_chair ? fill(t.cuttingNow, { barber: tk.barber, no: pad(tk.in_chair.no) }) : '';
  const n = tk.since_call ?? 0;
  const charge = tk.called_at ? `${t.holdIsEight} ${t.noCharge}` : t.noCharge;

  const body = `<section class="missed"><div class="r1"><span class="serif strike">${text(t.ticketNo, { no: pad(tk.no) })}</span><span class="vr"></span><span class="grow">${when ? `<b>${esc(when)}</b>` : ''}${cutting ? `<small>${esc(cutting)}</small>` : ''}</span></div><p>${esc(charge)}</p></section>
<div><h1 class="serif h24">${text(t.stillWant)}</h1>${n > 0 ? `<p class="lede">${text(n === 1 ? t.behind1 : t.behindN, { n })}</p>` : ''}</div>
${service ? `<section class="card"><div class="heldrow"><span><span class="eyebrow">${text(t.rejoinAs)}</span><span class="serif no26">${text(t.ticketNo, { no: pad(chair.next_no) })}</span></span><span class="r"><span class="eyebrow">${text(t.waitLabel)}</span><b class="w20">${text(t.mins, { n: service.wait_min })}</b></span></div><p class="cardnote">${text(t.noNewCode)}</p></section>` : ''}`;

  const dock = service
    ? `<footer class="dock"><form method="post" action="/q/${esc(tk.shop_code)}/t/${esc(token)}/rejoin"><button class="cta hot" type="submit">${text(t.rejoinCta, { no: pad(chair.next_no) })}</button></form></footer>`
    : `<footer class="dock"><a class="cta" href="${esc(requote({ shop: tk.shop_code, barber: tk.barber_code }))}">${text(t.seeLine)}</a></footer>`;
  return shell({ t, title: fill(t.title, { shop: tk.shop }), body, dock, loose: true });
}

// ---- QL-10 · already in a line today ------------------------------------------------
// Shown only after the code: until the number is proven, nothing says whether
// it holds a ticket, or where.
export function renderOneLine(result, { session, wantData = null, t = en } = {}) {
  const tk = result.ticket;
  const want = result.want ?? {};
  const wantChair = wantData?.found ? wantData.chairs.find((c) => c.code === want.barber) : null;
  // an app booking is never cancelled from a web page, and switching to the chair
  // he already holds would change nothing
  const canSwitch = result.guest && wantChair && wantChair.code !== tk.barber_code;

  const body = `<div><h1 class="serif h26">${text(t.oneLine1)}<br>${text(t.oneLine2)}</h1><p class="lede">${text(t.oneLineBody)}</p></div>
<section class="held10"><div class="r1"><span class="serif">${text(t.ticketNo, { no: pad(tk.no) })}</span><span class="vr"></span><span class="grow"><b>${esc(tk.shop)} · ${esc(tk.barber)}</b><small>${text(t.serviceCash, { service: tk.service, dh: dh(tk.price_cents) })}</small></span></div>
<div class="stats start"><span><b>${tk.ahead}</b><small>${text(t.aheadLabel)}</small></span><i></i><span><b>~${tk.wait_min}<em> min</em></b><small>${text(t.estWait)}</small></span><i></i><span><b>${clock(new Date(tk.joined_at))}</b><small>${text(t.joinedLabel)}</small></span></div></section>
${canSwitch ? `<div class="offer"><span class="ico">${ICON.plus}</span><span class="grow"><b>${text(t.wantInstead, { barber: firstName(wantChair.name), shop: wantData.name })}</b><p>${text(t.giveUpFirst, { no: pad(tk.no), barber: tk.barber })}</p></span></div>` : ''}
${result.guest ? '' : `<aside class="note">${ICON.info}<span>${text(t.appTicket)}</span></aside>`}`;

  const dock = result.guest
    ? `<footer class="dock"><a class="cta" href="/q/${esc(tk.shop_code)}/t/${esc(tk.token)}">${text(t.keep, { no: pad(tk.no) })}</a>`
      + (canSwitch
        ? `<form method="post" action="/q/${esc(want.shop)}/code/${esc(session)}/switch"><button class="ghost" type="submit">${text(t.leaveAndJoin, { barber: firstName(wantChair.name).toUpperCase() })}</button></form>`
        : '')
      + '</footer>'
    : '';
  return shell({ t, title: 'Sterncut', body, dock, loose: true });
}

// ---- the endings no design draws: the smallest true thing each ------------------------
export function renderEnded(kind, { shop = null, barber = null, t = en } = {}) {
  const say = {
    left: [t.leftTitle, t.leftBody],
    started: [t.startedTitle, null],
    done: [t.doneTitle, null],
    locked: [t.yourCode, t.locked],
  }[kind] ?? [t.goneTitle, null];
  const href = shop ? `/q/${shop}${barber ? `?b=${barber}` : ''}` : null;
  return shell({
    t, title: 'Sterncut', loose: true,
    body: `${brand(t, false)}\n<div><h1 class="serif h24">${esc(say[0])}</h1>${say[1] ? `<p class="lede">${esc(say[1])}</p>` : ''}</div>`,
    dock: href ? `<footer class="dock"><a class="cta" href="${esc(href)}">${text(t.seeLine)}</a></footer>` : '',
  });
}
