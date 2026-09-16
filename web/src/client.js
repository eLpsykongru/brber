// QL-03's picker, running in the page. The server already painted the first
// state; this repaints when a chair or a service is tapped, and asks for fresh
// numbers every 20 s — QueueScreen.tsx's QUEUE_POLL_MS, the app's own rail.
//
// render.js inlines this function by source next to pick.js's three functions,
// which is why `fitting`, `resolvePick` and `menuFor` are not imported here.
/* global fitting, resolvePick, menuFor */
export function client() {
  const dataEl = document.getElementById('q-data');
  if (!dataEl) return;
  const d = JSON.parse(dataEl.textContent);
  const $ = (selector) => document.querySelector(selector);
  const pad = (n) => String(n).padStart(2, '0');
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : String(v[k])));
  const waitOf = (chair) => (chair ? (fitting(chair)[0] || {}).wait_min : undefined);
  const takingCodes = (chairs) => chairs.filter((c) => c.state === 'taking').map((c) => c.code).sort().join();

  function paint() {
    const r = resolvePick(d.chairs, d.pick);
    if (!r) { location.reload(); return; }
    d.pick.service = r.service.name;
    const who = r.chair.name.split(' ')[0];
    const no = pad(r.chair.next_no);
    const n = r.chair.waiting;

    $('[data-wait]').textContent = fill(d.t.mins, { n: r.service.wait_min });
    $('[data-ahead]').textContent = fill(n === 0 ? d.t.ahead0 : n === 1 ? d.t.ahead1 : d.t.aheadN, { n, who, no });
    $('[data-cash]').textContent = fill(d.t.cash, { who });
    const cta = $('[data-cta]');
    cta.textContent = fill(d.t.take, { no });
    cta.href = `${d.join}?b=${encodeURIComponent(r.chair.code)}&s=${encodeURIComponent(r.service.id)}&src=${d.src}`;

    const open = d.chairs.filter((c) => c.state === 'taking');
    const soonest = Math.min(...open.map(waitOf));
    for (const button of document.querySelectorAll('button[data-chair]')) {
      const code = button.getAttribute('data-chair');
      const on = code === d.pick.chair;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
      const wait = code === '*' ? soonest : waitOf(open.find((c) => c.code === code));
      const small = button.querySelector('small');
      small.textContent = fill(d.t.mins, { n: wait });
      small.classList.toggle('soon', wait === soonest);
    }

    const chips = $('[data-chips]');
    chips.textContent = '';
    for (const service of menuFor(d.chairs, d.pick)) {
      const on = service.name === d.pick.service;
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = on ? 'chip on' : 'chip';
      chip.setAttribute('data-service', service.name);
      chip.setAttribute('aria-pressed', String(on));
      chip.textContent = fill(d.t.chip, { name: service.name, dh: Math.round(service.price_cents / 100) });
      chips.appendChild(chip);
    }
  }

  document.addEventListener('click', (e) => {
    const chair = e.target.closest('button[data-chair]');
    if (chair) { d.pick.chair = chair.getAttribute('data-chair'); paint(); return; }
    const chip = e.target.closest('button[data-service]');
    if (chip) { d.pick.service = chip.getAttribute('data-service'); paint(); }
  });

  // A chair opening or closing changes the cards themselves, which only the
  // server draws — so that is a reload, and everything else a repaint.
  setInterval(() => {
    if (document.hidden) return;
    fetch(d.poll, { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((next) => {
        if (!next) return;
        if (!next.found || !next.open || takingCodes(next.chairs) !== takingCodes(d.chairs)) {
          location.reload();
          return;
        }
        d.chairs = next.chairs;
        paint();
      })
      .catch(() => {});
  }, 20000);
}
