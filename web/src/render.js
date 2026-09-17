// The queue page, rendered on the server — ADDENDUM-app-first (turn Q3):
//
//   QL-18  the line, read-only: the wait, the numbers, the chairs. No join control.
//   QL-26  closed: hours, and who opens next.
//   QL-09  the shop closed the line — kept as built; it overlaps QL-26 and which
//          one survives is the owner's call (A2), so no third variant is drawn.
//
// One HTML response per request, no framework and no bundle: this page is opened
// by somebody standing three metres from the barber on 3G, deciding whether to
// wait. guest.js draws the remote fallback (QL-23 … QL-25) with the same parts.

import { en, fill } from './copy.js';
import { CSS } from './styles.js';

const TZ = 'Africa/Casablanca';   // single-city, like every shop_tz in the migrations
const clockFormat = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ,
});
const dowFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: TZ });
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Loaded without blocking the first paint; the page reads fine in system fonts
// until they arrive.
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:wght@700&display=swap';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
/** A copy template filled with plain values, escaped for HTML. */
const text = (template, values) => esc(fill(template, values));
/** A copy template whose values are already HTML. */
const markup = (template, values) => esc(template).replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
const pad = (n) => String(n).padStart(2, '0');
const clock = (date) => clockFormat.format(date);
const minuteClock = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const firstName = (name) => String(name ?? '').split(' ')[0];
/** A chair's soonest start today, on the first service that still fits (QL-18's default). */
const waitOf = (chair) => (chair.services ?? []).find((s) => s.wait_min != null)?.wait_min ?? null;
const taking = (chair) => chair.state === 'taking' && waitOf(chair) != null;
/** "Youssef", "Youssef and Hamza", "Youssef, Hamza and Sami" */
const names = (list, t) => (list.length < 2 ? list.join('')
  : `${list.slice(0, -1).join(', ')}${t.and}${list[list.length - 1]}`);

const svg = (size, stroke, width, paths) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" aria-hidden="true">${paths}</svg>`;
const ICON = {
  logo: svg(13, '#fff', 2, '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.5 20 20M8.2 16.5 20 4"/>'),
  info: svg(14, '#8A8A85', 2, '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  clockAmber: svg(14, '#B45309', 2, '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pause: svg(28, '#E8A100', 2, '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>'),
  yes: svg(10, '#16A34A', 3.2, '<path d="M5 12l5 5L20 7"/>'),
  no: svg(10, '#8A8A85', 3, '<path d="M6 6l12 12M18 6 6 18"/>'),
};

/**
 * What the page's 20 s poll compares — QueueScreen.tsx's rail — so a change
 * anyone could see reloads the page and nothing else does. Short on purpose: the
 * poll answers with this and nothing more.
 */
export function signature(data) {
  const s = JSON.stringify([data.found, data.open, data.shut, (data.chairs ?? []).map((c) => [
    c.code, c.state, c.next_no, waitOf(c), (c.line ?? []).map((l) => [l.no, l.in_chair, l.wait_min]),
  ])]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const POLL = `(function(){var e=document.getElementById('q-poll');if(!e)return;var d=JSON.parse(e.textContent);`
  + `setInterval(function(){if(document.hidden)return;fetch(d.url).then(function(r){return r.ok?r.text():null})`
  + `.then(function(s){if(s&&s!==d.sig)location.reload()}).catch(function(){})},20000)})();`;

function shell({ t, title, preview, body, dock = '', script = '', loose = false, skin = '' }) {
  const og = preview ? `
<meta name="description" content="${esc(preview.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Sterncut">
<meta property="og:title" content="${esc(preview.title)}">
<meta property="og:description" content="${esc(preview.description)}">
<meta property="og:url" content="${esc(preview.url)}">` : '';
  return `<!doctype html>
<html lang="${t.lang}" dir="${t.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="${skin === 'warm' ? '#F2F0EB' : '#EBE8E1'}">${og}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(FONTS)}" media="print" onload="this.media='all'">
<style>${CSS}</style>
</head>
<body${skin ? ` class="${skin}"` : ''}>
<div class="wrap">
<main class="page${loose ? ' loose' : ''}">
${body}
</main>
${dock}
</div>
${script}
</body>
</html>`;
}

function brand(t, badge = null) {
  const off = badge === 'closed';
  return `<header class="brand"><span class="logo${off ? ' ink' : ''}">${ICON.logo}</span><span class="wordmark">Sterncut</span>`
    + (badge ? `<span class="live${off ? ' off' : ''}"><i></i>${text(off ? t.closedBadge : t.live)}</span>` : '')
    + '</header>';
}

const canonical = (url, data) => `${url.origin}/q/${data.code}${data.chosen ? `?b=${data.chosen}` : ''}`;

/**
 * Which screen this shop is, right now. `src` is how the visitor came — 'link'
 * from a barber's own text (?b=), 'code' off the poster — and rides along to
 * QL-23 as BTD-13's "BY LINK". `notice` is a sentence from /c/ about a link that
 * ran out.
 */
export function renderQueue(data, { url, src = 'code', notice = null, remote = false, t = en }) {
  // closed beats paused (the guest-states addendum's A2, still true)
  if (data.shut) return closedPage(t, data, url);
  const open = data.chairs.filter(taking);
  if (!data.open || open.length === 0) return pausedPage(t, data, url);
  return linePage(t, data, open, url, src, notice, remote);
}

// ---- QL-18 · poster scanned · the line, read-only ------------------------------------
// Numbers carry no names (A3.1). Nothing here holds a place, and the page says so.
// `remote` is whether QL-23's link is offered: only once its text can really be sent.
function linePage(t, data, open, url, src, notice, remote) {
  const chosen = data.chairs.find((c) => c.code === data.chosen) ?? null;
  const soonest = [...open].sort((a, b) => waitOf(a) - waitOf(b))[0];
  const head = chosen && taking(chosen) ? chosen : soonest;
  const working = data.chairs.filter((c) => c.state !== 'off');
  const many = working.length > 1;
  const count = data.chairs.reduce((n, c) => n + (c.line?.length ?? 0), 0);
  const meta = [data.address, data.close_min != null ? fill(t.openUntil, { until: minuteClock(data.close_min) }) : null]
    .filter(Boolean).join(' · ');

  // one list across the chairs, soonest first; each chair's first waiting ticket is "Next"
  const rows = [];
  for (const c of data.chairs) {
    let nextGiven = false;
    for (const l of c.line ?? []) {
      const state = l.in_chair ? t.inChair : nextGiven ? t.waitingRow : t.next;
      if (!l.in_chair) nextGiven = true;
      rows.push({ ...l, state, who: firstName(c.name) });
    }
  }
  rows.sort((a, b) => (a.in_chair ? -1 : a.wait_min) - (b.in_chair ? -1 : b.wait_min) || a.no - b.no);
  const line = rows.map((r) => `<div class="lrow"><b class="serif lno">${text(t.ticketNo, { no: pad(r.no) })}</b>`
    + `<span class="grow">${many ? text(t.withWho, { state: r.state, who: r.who }) : esc(r.state)}</span>`
    + (r.in_chair ? `<small class="hot">${text(t.nowWord)}</small>` : `<small>${text(t.mins, { n: r.wait_min })}</small>`)
    + '</div>').join('');

  const soonestWait = waitOf(soonest);
  const card = (c) => {
    const wait = waitOf(c);
    const on = chosen?.code === c.code;
    return `<div class="chair${on ? ' on' : ''}${taking(c) ? '' : ' dim'}"><span class="av">${esc(c.initials)}</span>`
      + `<b>${esc(firstName(c.name))}</b>`
      + (taking(c)
        ? `<small${wait === soonestWait ? ' class="soon"' : ''}>${text(t.mins, { n: wait })}</small>`
        : `<small>${text(t.notTaking)}</small>`)
      + '</div>';
  };
  const chairs = working.filter((c) => c.state !== 'no_services');
  const ordered = chosen ? [...chairs.filter((c) => c.code === chosen.code), ...chairs.filter((c) => c.code !== chosen.code)] : chairs;

  const body = `${brand(t, 'live')}
${notice ? `<p class="notice">${ICON.clockAmber}<span>${esc(notice)}</span></p>` : ''}
<div><h1 class="serif">${esc(data.name)}</h1>${meta ? `<p class="meta">${esc(meta)}</p>` : ''}</div>
<section class="wait"><div class="now"><span class="eyebrow">${text(t.waitNow)}</span><span class="big">${text(t.mins, { n: waitOf(head) })}</span></div><span class="vr"></span><p>${text(count === 0 ? t.inLine0 : t.inLine, { n: count })}</p></section>
${line ? `<p class="label">${text(t.theLine)}</p>\n<div class="list">${line}</div>` : ''}
<p class="label">${text(t.chairsToday)}</p>
<div class="chairs">${ordered.map(card).join('')}</div>
<aside class="note">${ICON.info}<span><strong>${text(t.inShop)}</strong> ${text(t.inShopBody)}</span></aside>`;

  const b = chosen && taking(chosen) ? `b=${chosen.code}&` : '';
  const dock = `<footer class="dock"><a class="cta" href="${esc(`/q/${data.code}/app${chosen ? `?b=${chosen.code}` : ''}`)}">${text(t.getApp)}</a>`
    + (remote ? `<a class="textlink" href="${esc(`/q/${data.code}/name?${b}src=${src}`)}">${text(t.notAtShop)}</a>` : '')
    + '</footer>';

  const poll = { url: `/q/${data.code}?sig=1${data.chosen ? `&b=${data.chosen}` : ''}`, sig: signature(data) };
  const script = `<script id="q-poll" type="application/json">${JSON.stringify(poll).replace(/</g, '\\u003c')}</script>\n<script>${POLL}</script>`;

  const preview = {
    title: data.name,
    description: (head === chosen
      ? fill(t.ogWait, { n: chosen.waiting, who: firstName(chosen.name), mins: waitOf(chosen) })
      : fill(t.ogLine, { n: count, mins: waitOf(head) }))
      + (data.close_min != null ? fill(t.ogUntil, { until: minuteClock(data.close_min) }) : ''),
    url: canonical(url, data),
  };
  return shell({ t, title: fill(t.title, { shop: data.name }), preview, body, dock, script });
}

// ---- QL-26 · closed · the page has no line to show ----------------------------------
// No join link, not even the remote one: there is no line until the shop opens.
// The hours are the barbers' own (0115's `week`); who opens next is 0118's.
function closedPage(t, data, url) {
  const now = new Date(data.now ?? Date.now());
  const today = SHORT_DAYS.indexOf(dowFormat.format(now));
  const opens = data.opens ?? null;
  const first = opens ? (opens.barbers?.length ? opens.barbers : [opens.barber]).filter(Boolean) : [];
  const when = opens
    ? fill(opens.days === 1 ? t.whenTomorrow : t.whenOn,
      { time: minuteClock(opens.start_min), day: t.days[(today + opens.days) % 7] })
    : null;
  const said = [
    data.close_min != null ? fill(t.closedAt, { time: minuteClock(data.close_min) }) : t.closedToday,
    when && first.length
      ? fill(first.length === 1 ? t.opensAgain : t.openAgain, { who: names(first, t), when })
      : null,
  ].filter(Boolean).join(' ');

  // the next three days, tomorrow first
  const hours = data.week?.some((w) => w.open_min != null)
    ? [1, 2, 3].map((ahead) => {
      const dow = (today + ahead) % 7;
      const w = data.week.find((x) => x.dow === dow) ?? {};
      return `<div class="hrow"><span class="d${ahead === 1 ? ' first' : ''}">${esc(ahead === 1 ? t.tomorrow : t.days[dow])}</span>`
        + (w.open_min == null
          ? `<span class="h off">${text(t.closedDay)}</span>`
          : `<span class="h">${text(t.hoursRange, { from: minuteClock(w.open_min), to: minuteClock(w.close_min) })}</span>`)
        + '</div>';
    }).join('')
    : '';

  const body = `${brand(t, 'closed')}
<div><h1 class="serif">${esc(data.name)}</h1>${data.address ? `<p class="meta">${esc(data.address)}</p>` : ''}</div>
<section class="card big22"><h2 class="serif plain">${text(t.noLine)}</h2><p>${esc(said)}</p></section>
${hours ? `<section class="card hours">${hours}</section>` : ''}`;

  // A browser cannot book; the app can, so that is where BOOK A TIME goes.
  const dock = `<footer class="dock flat"><a class="cta" href="${esc(`/q/${data.code}/app`)}">${text(t.bookInstead)}</a></footer>`;
  return shell({
    t,
    title: fill(t.title, { shop: data.name }),
    preview: { title: data.name, description: t.ogShut, url: canonical(url, data) },
    body, dock, loose: true, skin: 'warm',
  });
}

// ---- QL-09 · the shop closed the line --------------------------------------------------
// As built in step 1. Only what is true is drawn: closing a shop stops appointments
// too and a browser cannot book, so the drawn booking card and its button are not
// here; nor is CALL THE SHOP, which waits on the owner choosing whose phone that is.
function pausedPage(t, data, url) {
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

// ---- not drawn: the smallest true thing each -----------------------------------------
function plainPage(t, title, body, { dock = '' } = {}) {
  return shell({
    t, title: 'Sterncut', loose: true, dock,
    body: `${brand(t)}\n<div><h1 class="serif h24">${esc(title)}</h1>${body ? `<p class="lede">${esc(body)}</p>` : ''}</div>`,
  });
}

export const renderMissing = (t = en) => plainPage(t, t.missingTitle, t.missingBody);
export const renderDown = (t = en) => plainPage(t, t.downTitle, t.downBody);
export const renderUnknownLink = (t = en) => plainPage(t, t.unknownTitle, t.unknownBody);
export const renderLinkPreview = (t = en) => plainPage(t, t.previewTitle, t.previewBody);
export const renderNoStore = (shop, t = en) => plainPage(t, t.noStoreTitle, t.noStoreBody, {
  dock: `<footer class="dock flat"><a class="cta" href="${esc(`/q/${shop}`)}">${text(t.seeLine)}</a></footer>`,
});

export { ICON, brand, clock, esc, firstName, markup, pad, plainPage, shell, svg, taking, text, waitOf };
