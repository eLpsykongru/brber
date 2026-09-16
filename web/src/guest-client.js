// The page half of QL-05 and QL-06. Everything works without it — the forms
// post, and the server keeps every rule the timers only show — this draws the
// four boxes, counts down, and keeps the ticket's line current.
export function guestClient() {
  const dataEl = document.getElementById('g-data');
  const d = dataEl ? JSON.parse(dataEl.textContent) : {};
  // count against the server's clock, not the phone's: a phone set five minutes
  // fast would otherwise show a hold that has already gone
  const skew = d.now ? Date.now() - Date.parse(d.now) : 0;
  const secondsTo = (iso) => Math.max(0, Math.ceil((Date.parse(iso) + skew - Date.now()) / 1000));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  // QL-05 · four boxes drawn over one real field, so the phone's own code
  // autofill still lands in it
  const input = document.querySelector('.digits input');
  if (input) {
    const label = input.closest('.digits');
    const boxes = [...label.querySelectorAll('span')];
    // QL-11 · the digits that were wrong stay on show, in red, until he types
    let bad = label.dataset.bad || '';
    const sync = () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 4);
      if (input.value) bad = '';
      label.classList.toggle('bad', !!bad);
      const focused = document.activeElement === input;
      boxes.forEach((box, i) => {
        box.textContent = (bad || input.value)[i] || '';
        box.classList.toggle('on', !bad && focused && i === Math.min(input.value.length, 3));
      });
      if (input.value.length === 4 && !input.form.dataset.sent) {
        input.form.dataset.sent = '1';
        input.form.submit();
      }
    };
    for (const type of ['input', 'focus', 'blur']) input.addEventListener(type, sync);
    input.focus();
    sync();
  }

  const held = document.querySelector('[data-until]');
  const wait = document.querySelector('[data-resend-wait]');
  const resend = document.querySelector('[data-resend]');
  const since = [...document.querySelectorAll('[data-since]')];
  const tick = () => {
    if (held) {
      const s = secondsTo(held.dataset.until);
      held.textContent = mmss(s);
      // README §5: a hold that runs out re-quotes rather than failing
      if (s === 0 && d.expired) { const to = d.expired; d.expired = null; location.href = to; }
    }
    if (wait && resend) {
      const s = secondsTo(wait.dataset.at);
      wait.hidden = s === 0;
      resend.hidden = s > 0;
      const left = wait.querySelector('[data-left]');
      if (left) left.textContent = mmss(s);
    }
    // QL-15 · how long the line has been frozen, on the server's clock
    for (const e of since) {
      e.textContent = Math.max(0, Math.floor((Date.now() - skew - Date.parse(e.dataset.since)) / 60000));
    }
  };
  if (held || wait || since.length) { tick(); setInterval(tick, 1000); }

  // QL-06 · the line every 20 s, like QueueScreen.tsx. A new number, somebody
  // new in the chair, a new stage or a pause redraws the page — which is how
  // QL-15 and QL-14 arrive without a tap; the minutes just count.
  if (d.poll) {
    const sig = (j) => JSON.stringify([j.stage, j.no, j.ahead, j.in_chair && j.in_chair.no, !!j.paused]);
    setInterval(() => {
      if (document.hidden) return;
      fetch(d.poll, { headers: { accept: 'application/json' } })
        .then((res) => (res.ok ? res.json() : null))
        .then((j) => {
          if (!j) return;
          if (!j.found || sig(j) !== d.sig) { location.reload(); return; }
          for (const e of document.querySelectorAll('[data-num]')) e.textContent = `~${j.wait_min}`;
          for (const e of document.querySelectorAll('[data-mins]')) e.textContent = d.mins.replace('{n}', j.wait_min);
        })
        .catch(() => {});
    }, 20000);
  }
}
