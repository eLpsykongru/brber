// The one write left on the web (ADDENDUM-app-first, A1): somebody NOT at the
// shop, who cannot install anything, puts a first name on the line.
//
//   QL-23  first name + phone. No code. The page argues against itself.
//   QL-24  the ticket exists and nobody has tapped the text: unconfirmed, and
//          the barber may call past it.
//   QL-25  confirmed from the text: read-only, no live refresh, no promises.
//
// Plain forms and server-rendered pages: nothing here needs a script.

import { en, fill } from './copy.js';
import { ICON, brand, esc, firstName, markup, pad, shell, svg, text } from './render.js';

const WARN = svg(14, '#B45309', 2, '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>');
const CHAT = svg(14, '#8A8A85', 2, '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>');
const TICK = svg(11, '#4ADE80', 2.6, '<path d="m5 13 4 4L19 7"/>');
const BACK = svg(13, '#8A8A85', 2.4, '<path d="M15 6l-6 6 6 6"/>');

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
