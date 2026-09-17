// The one write left on the web (ADDENDUM-app-first, A1): somebody NOT at the
// shop, who cannot install anything, puts a first name on the line.
//
//   QL-23  first name + phone. No code. The page argues against itself.
//   QL-24  the ticket exists and nobody has tapped the text: unconfirmed, and
//          the barber may call past it.
//   QL-25  confirmed from the text: read-only, no live refresh, no promises.
//   QL-27  he tapped, and the place was already gone: what happened, the wait now,
//          and the two real options. Never an error page.
//   and the tap on BTD-16's offer of another day, which no design draws.
//
// Plain forms and server-rendered pages: nothing here needs a script.

import { en, fill } from './copy.js';
import { ICON, TZ, brand, clock, esc, firstName, markup, pad, shell, svg, taking, text, waitOf } from './render.js';

const WARN = svg(14, '#B45309', 2, '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>');
const CHAT = svg(14, '#8A8A85', 2, '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>');
const TICK = svg(11, '#4ADE80', 2.6, '<path d="m5 13 4 4L19 7"/>');
const BACK = svg(13, '#8A8A85', 2.4, '<path d="M15 6l-6 6 6 6"/>');
const GONE = svg(11, '#8A8A85', 2.4, '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>');

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
/** "tomorrow at 10:00" or "Sat 19 Sep at 10:00", in the shop's own time */
function whenOf(iso, now, t) {
  const at = new Date(iso);
  const tomorrow = dayKey.format(new Date(now.getTime() + 86_400_000)) === dayKey.format(at);
  return {
    tomorrow,
    day: tomorrow ? t.tomorrow : dayLabel.format(at),
    time: clock(at),
    said: tomorrow ? fill(t.whenTomorrow, { time: clock(at) }) : fill(t.whenDay, { day: dayLabel.format(at), time: clock(at) }),
  };
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- QL-23 · not at the shop · the one form left on the web -------------------------
// The chair and the service are chosen here and carried in the form, so the number
// the button promises and the barber the footer names are the ones written.
export function renderName(data, chair, service, { src = 'code', values = {}, error = null, t = en } = {}) {
  const barber = firstName(chair.name);
  const back = `/q/${data.code}${data.chosen ? `?b=${data.chosen}` : ''}`;
  const problem = !error ? ''
    : error.limited ? fill(t.limited, { time: error.limited })
      : error.already ? t.already
        : error.field === 'name' ? t.badName : t.badPhone;
  const invalid = (field) => (error?.field === field ? ' aria-invalid="true" autofocus' : '');

  const body = `<a class="back" href="${esc(back)}">${BACK}${text(t.backToLine)}</a>
<div><h1 class="serif h26">${text(t.putName1)}<br>${text(t.putName2)}</h1><p class="lede">${text(t.putNameBody)}</p></div>
<form id="name" method="post" action="/q/${esc(data.code)}/name" novalidate>
<input type="hidden" name="b" value="${esc(chair.code)}"><input type="hidden" name="s" value="${esc(service.id)}"><input type="hidden" name="src" value="${esc(src)}">
<div class="fields">
<label class="field"><span class="label">${text(t.yourName)}</span><input class="input" name="first_name" autocomplete="given-name" maxlength="30" required value="${esc(values.first_name)}"${invalid('name')}></label>
<label class="field"><span class="label">${text(t.yourNumber)}</span><span class="phone"><span class="cc">+212</span><input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" required value="${esc(values.phone)}"${invalid('phone')}></span></label>
</div>
</form>
${problem ? `<p class="err" role="alert">${esc(problem)}</p>` : ''}
<aside class="note">${CHAT}<span><strong>${text(t.noCode)}</strong> ${text(t.noCodeBody)}</span></aside>`;

  const dock = `<footer class="dock"><button class="cta" type="submit" form="name">${text(t.putMeOn, { no: pad(chair.next_no) })}</button>`
    + `<p class="fine">${text(t.mayCallPast, { barber })}</p></footer>`;
  return shell({ t, title: fill(t.title, { shop: data.name }), body, dock });
}

// ---- QL-24 · unconfirmed · one tap in the text --------------------------------------
// The text is quoted with its link blanked (0118's guest_ticket): this page's own
// address must never be enough to confirm the place.
export function renderUnconfirmed(tk, { t = en } = {}) {
  const ahead = tk.ahead > 0
    ? fill(t.aheadWith, { n: tk.ahead, barber: tk.barber, mins: tk.wait_min })
    : fill(t.aheadWith0, { barber: tk.barber, mins: tk.wait_min });
  const no = pad(tk.no);

  const body = `<section class="tk unconfirmed"><span class="badge amber">${ICON.clockAmber}${text(t.notConfirmed)}</span>
<div><span class="kicker">${esc(fill(t.nameAtShop, { name: tk.first_name, shop: tk.shop }).toUpperCase())}</span><span class="serif t52">${text(t.ticketNo, { no })}</span><span class="tsub">${esc(ahead)}</span></div></section>
${tk.hold_text ? `<section class="inkbox"><span class="eyebrow">${text(t.weTexted)}</span><p class="quote">${esc(tk.hold_text)}</p></section>` : ''}
<p class="amber">${WARN}<span>${markup(t.greyed, { barber: esc(tk.barber), no, past: `<strong>${text(t.mayCallPastIt)}</strong>` })}</span></p>`;

  const dock = `<footer class="dock flat"><p class="fine">${text(t.openTheText)}</p></footer>`;
  return shell({ t, title: fill(t.title, { shop: tk.shop }), body, dock });
}

// ---- QL-25 · confirmed from the text · read-only ------------------------------------
// No poll: "this page won't ping you" is the promise, and the next text is the news.
export function renderConfirmed(tk, { token, t = en } = {}) {
  const sent = !!tk.texted;
  const body = `<section class="tk ink"><span class="badge green">${TICK}${text(t.confirmed)}</span>
<div><span class="kicker">${esc(fill(t.nameWithBarber, { name: tk.first_name, barber: tk.barber }).toUpperCase())}</span><span class="serif t52">${text(t.ticketNo, { no: pad(tk.no) })}</span></div>
<div class="stats"><span><span class="eyebrow">${text(t.aheadOfYou)}</span><b class="serif">${esc(tk.ahead)}</b></span><span class="vr"></span><span><span class="eyebrow">${text(t.about)}</span><b class="serif">${text(t.minUnit, { n: tk.wait_min })}</b></span></div></section>
<aside class="note">${CHAT}<span><strong>${text(sent ? t.nextSent : t.oneMore)}</strong> ${text(sent ? t.nextSentBody : t.oneMoreBody)}</span></aside>
<section class="card"><p>${text(t.withApp)}</p><a class="soft" href="${esc(`/q/${tk.shop_code}/app`)}">${text(t.getTheApp)}</a></section>
<form method="post" action="/q/${esc(tk.shop_code)}/t/${esc(token)}/leave"><button class="textlink muted" type="submit">${text(t.giveUp)}</button></form>`;
  return shell({ t, title: fill(t.title, { shop: tk.shop }), body, loose: true });
}

// ---- the endings no design draws: the smallest true thing each ------------------------
export function renderEnded(kind, { shop = null, t = en } = {}) {
  const say = {
    left: [t.leftTitle, t.leftBody],
    started: [t.startedTitle, null],
    done: [t.doneTitle, null],
  }[kind] ?? [t.goneTitle, null];
  return shell({
    t, title: 'Sterncut', loose: true,
    body: `${brand(t)}\n<div><h1 class="serif h24">${esc(say[0])}</h1>${say[1] ? `<p class="lede">${esc(say[1])}</p>` : ''}</div>`,
    dock: shop ? `<footer class="dock flat"><a class="cta" href="${esc(`/q/${shop}`)}">${text(t.seeLine)}</a></footer>` : '',
  });
}

// ---- QL-27 · he tapped, and the place was already gone ------------------------------
// The barber chose Drop him (BTD-17) or Take him off (BTD-15), the link ran out, or
// the place left the line some other way. `tk` is the ticket when it can still be
// read. `remote` is whether QL-23 can be offered at all (the text has to really send).
export function renderGone(data, tk, { expired = false, remote = false, t = en } = {}) {
  const no = tk ? pad(tk.no) : null;
  const [title1, title2, why] = expired
    ? [t.ranOut1, t.ranOut2, t.ranOutBody]
    : tk?.stage === 'missed'
      ? [t.cameAndWent1, t.cameAndWent2, fill(t.cameAndWentBody, { barber: tk.barber, no })]
      : [t.placeGone1, t.placeGone2, tk ? fill(t.placeGoneBody, { barber: tk.barber, no }) : t.placeGonePlain];
  const badge = expired ? t.ranOutBadge : tk ? fill(t.goneBadge, { no }) : t.goneBadgePlain;

  // the line as it is now — usually better news than the loss
  const open = data.shut || !data.open ? [] : data.chairs.filter(taking);
  const soonest = [...open].sort((a, b) => waitOf(a) - waitOf(b))[0] ?? null;
  const count = data.chairs.reduce((n, c) => n + (c.line?.length ?? 0), 0);
  const wait = soonest
    ? `<section class="wait"><div class="now"><span class="eyebrow">${text(t.waitNow)}</span><span class="big">${text(t.mins, { n: waitOf(soonest) })}</span></div><span class="vr"></span><p>${text(count ? t.goneWait : t.goneWait0, { n: count, who: firstName(soonest.name) })}</p></section>`
    : '';
  const his = tk ? open.find((c) => c.code === tk.barber_code) ?? null : null;
  const again = remote && soonest
    ? `/q/${data.code}/name?${his ? `b=${his.code}&` : ''}src=code`
    : null;

  const steps = `<section class="card"><span class="eyebrow">${text(t.stillWant)}</span>`
    + `<div class="step"><i>1</i><span>${soonest
      ? `<strong>${text(t.walkIn)}</strong> ${text(t.walkInBody, { barber: tk?.barber ?? firstName(soonest.name) })}`
      : text(t.walkInLater)}</span></div>`
    + (again ? `<div class="step"><i>2</i><span><strong>${text(t.putAgain)}</strong>${text(t.putAgainBody)}</span></div>` : '')
    + '</section>';

  const body = `<section class="tk"><span class="badge grey">${GONE}${esc(badge)}</span>
<div><h1 class="serif h26">${esc(title1)}<br>${esc(title2)}</h1><p class="lede">${esc(why)}</p></div></section>
${wait}
${steps}
<p class="fine left">${text(t.nothingHeld)}</p>`;

  const dock = `<footer class="dock"><a class="cta" href="${esc(`/q/${data.code}`)}">${text(t.seeLineNow)}</a>`
    + (again ? `<a class="textlink" href="${esc(again)}">${text(t.putMineAgain)}</a>` : '')
    + '</footer>';
  return shell({ t, title: fill(t.title, { shop: data.name }), body, dock });
}

// ---- BTD-16's text, tapped ----------------------------------------------------------
// Booked, or the time went to somebody else first, or it passed. No design draws
// these, so each says the smallest true thing — and never that a place is held.
export function renderOffer(r, { t = en, now = new Date() } = {}) {
  const w = r.starts_at ? whenOf(r.starts_at, now, t) : null;

  if (r.state === 'booked') {
    const who = r.first_name ? fill(t.nameWithBarber, { name: r.first_name, barber: r.barber }) : fill(t.withBarber, { barber: r.barber });
    const body = `<section class="tk ink"><span class="badge green">${TICK}${text(t.booked)}</span>
<div><span class="kicker">${esc(who.toUpperCase())}</span><span class="serif t52">${esc(w.time)}</span></div>
<div class="stats"><span><span class="eyebrow">${text(t.dayWord)}</span><b class="serif">${esc(w.day)}</b></span><span class="vr"></span><span><span class="eyebrow">${text(t.whereWord)}</span><b class="serif">${esc(r.shop_name)}</b></span></div></section>
<p class="lede">${text(t.bookedWhat, { service: r.service, shop: [r.shop_name, r.address].filter(Boolean).join(', ') })}</p>
<aside class="note">${CHAT}<span><strong>${text(t.payCash, { barber: r.barber })}</strong> ${text(t.payCashBody)}</span></aside>`;
    return shell({ t, title: fill(t.title, { shop: r.shop_name }), body, loose: true });
  }

  if (r.state === 'gone') {
    return shell({
      t, title: 'Sterncut', loose: true,
      body: `${brand(t)}\n<div><h1 class="serif h24">${text(t.offerGoneTitle)}</h1><p class="lede">${text(t.offerGoneBody)}</p></div>`,
      dock: `<footer class="dock flat"><a class="cta" href="${esc(`/q/${r.shop}`)}">${text(t.seeLineNow)}</a></footer>`,
    });
  }

  const [title1, title2, why] = r.state === 'expired'
    ? [t.offerRanOut1, t.offerRanOut2, fill(t.offerRanOutBody, { when: capital(w?.said ?? ''), barber: r.barber })]
    : [t.takenTitle1, t.takenTitle2, fill(t.takenBody, { when: w?.said ?? '', barber: r.barber })];
  const body = `${brand(t)}
<div><h1 class="serif h26">${esc(title1)}<br>${esc(title2)}</h1><p class="lede">${esc(why)}</p></div>
<aside class="note">${ICON.info}<span>${text(t.askAnother, { barber: r.barber })}</span></aside>`;
  const dock = `<footer class="dock flat"><a class="cta" href="${esc(`/q/${r.shop}/app`)}">${text(t.bookInstead)}</a>`
    + `<a class="textlink" href="${esc(`/q/${r.shop}`)}">${text(t.seeLineNow)}</a></footer>`;
  return shell({ t, title: 'Sterncut', body, dock, loose: true });
}
