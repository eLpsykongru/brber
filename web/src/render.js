// The queue page, rendered on the server: QL-08 (the poster — pick a chair),
// QL-03 (a chair's own link) and QL-09 (the line is closed). One HTML response
// per request, no framework and no bundle: this page is opened by somebody
// standing in a shop on 3G, deciding whether to bother. guest.js draws the rest
// of the walk-in's way through with the same parts.

import { client } from './client.js';
import { en, fill } from './copy.js';
import { fitting, menuFor, resolvePick } from './pick.js';
import { CSS } from './styles.js';

const TZ = 'Africa/Casablanca';   // single-city, like every shop_tz in the migrations
const clockFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ,
});
// Loaded without blocking the first paint; the page reads fine in system fonts
// until they arrive.
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:wght@700&display=swap';
const SCRIPT = `${fitting}\n${resolvePick}\n${menuFor}\n(${client})();`;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
/** A copy template filled with plain values, escaped for HTML. */
const text = (template, values) => esc(fill(template, values));
/** A copy template whose values are already HTML. */
const markup = (template, values) => esc(template).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
/** Data for the page's own script; `<` escaped so a name can never close the tag. */
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const pad = (n) => String(n).padStart(2, '0');
const clock = (date) => clockFormat.format(date);
const minuteClock = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const firstName = (name) => String(name ?? '').split(' ')[0];
const waitOf = (chair) => fitting(chair)[0]?.wait_min ?? null;
const bySoonest = (a, b) =>
  (waitOf(a) ?? Infinity) - (waitOf(b) ?? Infinity) || a.name.localeCompare(b.name);
const canonical = (url, data) => `${url.origin}/q/${data.code}${data.chosen ? `?b=${data.chosen}` : ''}`;

const svg = (size, stroke, width, paths) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" aria-hidden="true">${paths}</svg>`;
const CHAT = '<path d="M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12z"/>';
const ICON = {
  logo: svg(13, '#fff', 2, '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.5 20 20M8.2 16.5 20 4"/>'),
  info: svg(14, '#8A8A85', 2, '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  people: svg(15, '#8A8A85', 1.8, '<circle cx="9" cy="8" r="3"/><circle cx="16" cy="9" r="2.5"/><path d="M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5"/>'),
  tick: svg(15, '#16A34A', 3, '<path d="M5 12l5 5L20 7"/>'),
  tickBig: svg(19, '#16A34A', 3, '<path d="M5 12l5 5L20 7"/>'),
  qr: svg(15, '#5C5C58', 1.9, '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><path d="M13 13h3v3h-3zM18 18h2v2h-2z"/>'),
  pause: svg(28, '#E8A100', 2, '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>'),
  yes: svg(10, '#16A34A', 3.2, '<path d="M5 12l5 5L20 7"/>'),
  no: svg(10, '#8A8A85', 3, '<path d="M6 6l12 12M18 6 6 18"/>'),
  close: svg(16, '#111', 2, '<path d="M6 6l12 12M18 6 6 18"/>'),
  back: svg(16, '#111', 2, '<path d="M15 6l-6 6 6 6"/>'),
  chat: svg(14, '#8A8A85', 2, CHAT),
  chatCoral: svg(14, '#E8442E', 2, CHAT),
  clock: svg(13, '#8A8A85', 2, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  plus: svg(15, '#E8442E', 2, '<path d="M4 12h16M12 4v16"/>'),
};

function shell({
  t, title, preview, body, dock = '', script = '', head = '', loose = false, sheet = false, skin = '',
}) {
  const og = preview ? `
<meta name="description" content="${esc(preview.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Sterncut">
<meta property="og:title" content="${esc(preview.title)}">
<meta property="og:description" content="${esc(preview.description)}">
<meta property="og:url" content="${esc(preview.url)}">` : '';
  // a sheet (QL-04, QL-05) is its own page here: the screen behind it is the dim
  // backdrop the design draws, without a second render of QL-03 underneath
  const main = sheet
    ? `<div class="sheetpage">\n${body}\n</div>`
    : `<div class="wrap">
<main class="page${loose ? ' loose' : ''}">
${body}
</main>
${dock}
</div>`;
  return `<!doctype html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#EBE8E1">${og}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(FONTS)}" media="print" onload="this.media='all'">
<style>${CSS}</style>${head}
</head>
<body${skin ? ` class="${skin}"` : ''}>
${main}
${script}
</body>
</html>`;
}

function brand(t, live) {
  return `<header class="brand"><span class="logo">${ICON.logo}</span><span class="wordmark">Sterncut</span>`
    + `${live ? `<span class="live"><i></i>${text(t.live)}</span>` : ''}</header>`;
}

// QL-01's card: the wait is written into the text, so it survives a preview
// that never loads its image.
function preview(t, data, url, chair, mins) {
  const until = data.close_min != null ? fill(t.ogUntil, { until: minuteClock(data.close_min) }) : '';
  return {
    title: data.name,
    description: fill(t.ogWait, { n: chair.waiting, who: firstName(chair.name), mins }) + until,
    url: canonical(url, data),
  };
}

/**
 * Which of the three screens this shop is, right now. `src` is where the
 * visitor came in — 'code' from the poster (through QL-08), 'link' from a
 * barber's own link — and rides along to the ticket as BTD-13's "BY LINK".
 */
export function renderQueue(data, { url, fromCode = false, src = 'link', nearby = null, t = en }) {
  // QL-17 before QL-09 (ADDENDUM A2): a shop that is shut never says it paused
  if (data.shut) return shutPage(t, data, nearby, url);
  const open = data.chairs.filter((c) => c.state === 'taking').sort(bySoonest);
  if (!data.open || open.length === 0) return closedPage(t, data, url);
  return data.chosen ? chairPage(t, data, open, url, src) : shopPage(t, data, open, url, fromCode);
}

// ---- QL-17 · shut for the day, not paused ----------------------------------------------
// Not here: BOOK 09:00 TOMORROW and "Booking ahead works right now" — a browser with
// no account cannot book — and "Last walk-in taken 45 minutes before close", a rule
// nothing enforces. The hours are the barbers' own (0115's `week`).
const dowFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ });
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PIN = svg(17, '#5C5C58', 2, '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/>');
const CHEVRON = svg(15, '#8A8A85', 2.2, '<path d="M9 6l6 6-6 6"/>');
const distance = (m) => (m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`);

function shutPage(t, data, nearby, url) {
  const now = new Date(data.now ?? Date.now());
  const today = SHORT_DAYS.indexOf(dowFormat.format(now));
  const opens = data.opens ?? null;
  const openDay = opens ? t.days[(today + opens.days) % 7] : null;
  const when = opens
    ? fill(opens.days === 1 ? t.whenTomorrow : t.whenOn, { time: minuteClock(opens.start_min), day: openDay })
    : null;

  // Monday first, and a run of days with the same hours folded: "Mon — Fri"
  const week = [1, 2, 3, 4, 5, 6, 0]
    .map((dow) => data.week?.find((w) => w.dow === dow) ?? { dow, open_min: null, close_min: null });
  const runs = [];
  for (const w of week) {
    const last = runs[runs.length - 1];
    if (last && last.open_min === w.open_min && last.close_min === w.close_min) last.to = w.dow;
    else runs.push({ ...w, from: w.dow, to: w.dow });
  }
  const hours = week.some((w) => w.open_min != null)
    ? runs.map((r) => `<div class="hrow"><span>${esc(r.from === r.to
      ? t.days[r.from]
      : fill(t.hoursRange, { from: t.daysShort[r.from], to: t.daysShort[r.to] }))}</span>`
      + (r.open_min == null
        ? `<b class="off">${text(t.closedDay)}</b>`
        : `<b>${text(t.hoursRange, { from: minuteClock(r.open_min), to: minuteClock(r.close_min) })}</b>`)
      + '</div>').join('')
    : '';

  const near = nearby
    ? `<a class="near" href="/q/${esc(nearby.code)}"><span class="pin">${PIN}</span><span class="grow"><b>${nearby.until_min != null
      ? text(t.openTill, { shop: nearby.name, time: minuteClock(nearby.until_min) })
      : esc(nearby.name)}</b>`
      + `<small>${text(t.nearbySub, { distance: distance(nearby.meters), n: nearby.waiting, mins: nearby.wait_min })}</small></span>${CHEVRON}</a>`
    : '';

  const body = `<div><span class="kicker">${text(t.shutEyebrow, { shop: data.name.toUpperCase(), time: clock(now) })}</span>
<h1 class="serif h26 mt9">${text(t.shut1)}<br>${text(t.shut2)}</h1>${when ? `<p class="lede">${text(t.shutBody, { when })}</p>` : ''}</div>
${opens ? `<section class="inkcard"><span><span class="eyebrow">${text(opens.days === 1 ? t.firstChairTomorrow : t.firstChairOn, { DAY: openDay.toUpperCase() })}</span><span class="serif t28">${esc(minuteClock(opens.start_min))}</span></span><span class="right"><span class="eyebrow">${text(t.withLabel)}</span><b>${esc(opens.barber)}</b></span></section>` : ''}
${hours ? `<section class="card"><span class="eyebrow">${text(t.openHours)}</span>${hours}</section>` : ''}
${near}`;

  return shell({
    t,
    title: fill(t.title, { shop: data.name }),
    preview: { title: data.name, description: `${t.shut1} ${t.shut2}`, url: canonical(url, data) },
    body,
    dock: `<footer class="dock"><p class="fine">${text(t.scanAgain)}</p></footer>`,
    loose: true,
  });
}

// ---- QL-03 · a chair's own link ----------------------------------------------
function chairPage(t, data, open, url, src) {
  const chosen = data.chairs.find((c) => c.code === data.chosen);
  const chosenTakes = chosen?.state === 'taking';
  // a chair that cannot take anyone is shown as that, and the pick moves to
  // whoever can — the link still lands somewhere useful
  const start = { chair: chosenTakes ? chosen.code : open.length === 1 ? open[0].code : '*', service: null };
  const r = resolvePick(data.chairs, start);
  const pick = { chair: start.chair, service: r.service.name };
  const who = firstName(r.chair.name);
  const no = pad(r.chair.next_no);
  const n = r.chair.waiting;
  const soonest = waitOf(open[0]);
  const join = `/q/${data.code}/join`;
  const meta = [data.address, data.close_min != null ? fill(t.openUntil, { until: minuteClock(data.close_min) }) : null]
    .filter(Boolean).join(' · ');

  const card = (c) => {
    const on = pick.chair === c.code;
    const wait = waitOf(c);
    return `<button type="button" class="chair${on ? ' on' : ''}" data-chair="${esc(c.code)}" aria-pressed="${on}">`
      + `<span class="av">${esc(c.initials)}</span><b>${esc(firstName(c.name))}</b>`
      + `<small${wait === soonest ? ' class="soon"' : ''}>${text(t.mins, { n: wait })}</small></button>`;
  };
  const ordered = chosenTakes ? [chosen, ...open.filter((c) => c.code !== chosen.code)] : open;
  const notTaking = chosen && !chosenTakes
    ? `<div class="chair dim" aria-disabled="true"><span class="av">${esc(chosen.initials)}</span>`
      + `<b>${esc(firstName(chosen.name))}</b><small>${text(t.notTaking)}</small></div>`
    : '';
  const anyone = open.length > 1
    ? `<button type="button" class="chair${pick.chair === '*' ? ' on' : ''}" data-chair="*" aria-pressed="${pick.chair === '*'}">`
      + `<span class="av">${ICON.people}</span><b>${text(t.anyone)}</b>`
      + `<small class="soon">${text(t.mins, { n: soonest })}</small></button>`
    : '';
  const chips = menuFor(data.chairs, pick).map((s) => {
    const on = s.name === pick.service;
    return `<button type="button" class="chip${on ? ' on' : ''}" data-service="${esc(s.name)}" aria-pressed="${on}">`
      + `${text(t.chip, { name: s.name, dh: Math.round(s.price_cents / 100) })}</button>`;
  }).join('');

  const body = `${brand(t, true)}
<div><h1 class="serif">${esc(data.name)}</h1>${meta ? `<p class="meta">${esc(meta)}</p>` : ''}</div>
<section class="wait"><div class="now"><span class="eyebrow">${text(t.waitNow)}</span><span class="big" data-wait>${text(t.mins, { n: r.service.wait_min })}</span></div><span class="vr"></span><p data-ahead>${text(n === 0 ? t.ahead0 : n === 1 ? t.ahead1 : t.aheadN, { n, who, no })}</p></section>
<p class="label">${text(t.chair)}</p>
<div class="chairs">${notTaking}${ordered.map(card).join('')}${anyone}</div>
<p class="label">${text(t.service)}</p>
<div class="chips" data-chips>${chips}</div>
<aside class="note">${ICON.info}<span data-cash>${text(t.cash, { who })}</span></aside>`;

  const dock = `<footer class="dock"><a class="cta" data-cta href="${esc(`${join}?b=${r.chair.code}&s=${r.service.id}&src=${src}`)}">${text(t.take, { no })}</a>`
    + `<p class="fine">${text(t.free)}</p></footer>`;

  const state = {
    chairs: data.chairs,
    pick,
    join,
    src,
    poll: `/q/${data.code}?json=1${data.chosen ? `&b=${data.chosen}` : ''}`,
    t: { mins: t.mins, ahead0: t.ahead0, ahead1: t.ahead1, aheadN: t.aheadN, cash: t.cash, take: t.take, chip: t.chip },
  };
  const script = `<script id="q-data" type="application/json">${json(state)}</script>\n<script>${SCRIPT}</script>`;

  return shell({
    t,
    title: fill(t.title, { shop: data.name }),
    preview: preview(t, data, url, r.chair, r.service.wait_min),
    body, dock, script,
  });
}

// ---- QL-08 · the poster, salon-level ------------------------------------------
function shopPage(t, data, open, url, fromCode) {
  const soonest = open[0];
  const rest = data.chairs.filter((c) => c.state === 'paused' || c.state === 'full');
  const working = data.chairs.filter((c) => c.state !== 'off' && c.state !== 'no_services').length;
  const chairHref = (c) => `/q/${esc(data.code)}?b=${esc(c.code)}&amp;src=code`;

  // QL-08 has no service picker, so a chair opens its own QL-03 rather than
  // going straight to the name-and-phone sheet
  const row = (c) => {
    const wait = waitOf(c);
    const sub = c.waiting === 0
      ? [t.nobodyWaiting, wait <= 5 ? t.freeNow : null]
      : [
        fill(t.waiting, { n: c.waiting }),
        c.rating != null ? fill(t.stars, { r: Number(c.rating).toFixed(1) }) : null,
        c.cuts ? fill(t.cuts, { n: c.cuts }) : null,
      ];
    return `<a class="row" href="${chairHref(c)}"><span class="av">${esc(c.initials)}</span>`
      + `<span class="who"><b>${esc(c.name)}</b><span>${esc(sub.filter(Boolean).join(' · '))}</span></span>`
      + `<span class="when"><b${c === soonest ? ' class="soon"' : ''}>${text(t.mins, { n: wait })}</b>`
      + `<span>${text(t.ticketNo, { no: pad(c.next_no) })}</span></span></a>`;
  };
  const dimRow = (c) => `<div class="row dim"><span class="av">${esc(c.initials)}</span>`
    + `<span class="who"><b>${esc(c.name)}</b><span>${text(c.state === 'full' ? t.full : t.paused)}</span></span>`
    + `<span class="nt">${text(t.notTaking)}</span></div>`;

  // only a bare code says "you're at the shop": a barber's link or a shared one
  // may be opened from anywhere
  const banner = fromCode
    ? `<div class="banner"><span class="tick">${ICON.tick}</span><span><b>${text(t.atShop)}</b>`
      + `<span>${text(t.scanned, { time: clock(new Date(data.now ?? Date.now())) })}</span></span></div>\n`
    : '';
  const body = `${banner}<div><h1 class="serif h24">${text(t.takeATicket)}</h1><p class="meta">${text(working === 1 ? t.working1 : t.working, { shop: data.name, n: working })}</p></div>
<p class="label">${text(t.soonest)}</p>
<div class="rows">${open.map(row).join('')}${rest.map(dimRow).join('')}</div>
<div class="tip">${ICON.qr}<span>${markup(t.codeTip, { code: `<strong>${esc(data.code)}</strong>` })}</span></div>`;

  const dock = `<footer class="dock"><a class="cta" href="${chairHref(soonest)}">`
    + `${text(t.continue, { who: firstName(soonest.name).toUpperCase(), no: pad(soonest.next_no) })}</a>`
    + `<p class="fine">${text(t.noAccount)}</p></footer>`;

  return shell({
    t,
    title: fill(t.title, { shop: data.name }),
    preview: preview(t, data, url, soonest, waitOf(soonest)),
    body, dock,
  });
}

// ---- QL-09 · the shop closed the line -------------------------------------------
// Only what is true is drawn. Closing a shop stops appointments too, and a
// browser with no account cannot book one, so the drawn "booking a time for
// later" line, the next-free-slot card and its button are not here; nor is
// CALL THE SHOP, which waits on the owner choosing whose phone that is (BACKLOG).
function closedPage(t, data, url) {
  const time = !data.open && data.closed_at ? clock(new Date(data.closed_at)) : null;
  const holding = data.chairs.filter((c) => c.next_no > 1);
  const stand = holding.length > 1 ? t.standMany
    : holding.length === 1
      ? (holding[0].next_no === 2 ? t.standOne : fill(t.standRange, { last: pad(holding[0].next_no - 1) }))
      : null;
  const fact = (yes, sentence) =>
    `<div class="fact ${yes ? 'yes' : 'no'}"><i>${yes ? ICON.yes : ICON.no}</i><span>${esc(sentence)}</span></div>`;

  const body = `<span class="pause">${ICON.pause}</span>
<div><h1 class="serif h26">${text(t.noWalkIns1)}<br>${text(t.noWalkIns2)}</h1><p class="lede">${text(time ? t.pausedAt : t.pausedNoTime, { shop: data.name, time })}</p></div>
<section class="card"><span class="eyebrow">${text(t.stillWorks)}</span>${stand ? fact(true, stand) : ''}${fact(false, t.noJoin)}</section>`;

  return shell({
    t,
    title: fill(t.title, { shop: data.name }),
    preview: { title: data.name, description: t.ogClosed, url: canonical(url, data) },
    body,
    loose: true,
  });
}

// ---- not drawn: an address that is not a shop, and a database that is down ----
export function renderMissing(t = en) {
  return shell({
    t, title: 'Sterncut',
    body: `${brand(t, false)}\n<div><h1 class="serif h24">${text(t.missingTitle)}</h1><p class="lede">${text(t.missingBody)}</p></div>`,
  });
}

export function renderDown(t = en) {
  return shell({
    t, title: 'Sterncut',
    body: `${brand(t, false)}\n<div><h1 class="serif h24">${text(t.downTitle)}</h1><p class="lede">${text(t.downBody)}</p></div>`,
  });
}

export { ICON, brand, clock, esc, firstName, json, markup, pad, shell, text };
