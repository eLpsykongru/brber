// /{slug}/shop[/deposit|/pause] — Your shop. The listing (the salon row the owner's
// own RLS lets him edit, as the app's Salon management does), the deposit
// (OSH-11/12/13, shop_deposit_state / set_shop_deposit, 0076) and the pause
// (OSH-09, shop_pause_preview / close_shop / reopen_shop, 0064).
// Not built here: the poster (it needs a QR generator this site doesn't load —
// the app prints it) and "hidden from search" (OSH-08, no backend anywhere).
import { esc, patch } from '/app.js';
import { column, card, eyebrow, kv, rule } from '/s/ui.js';

const dh = (c) => Math.round(c / 100).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const input = (id, label, value, attrs = '') => `<label style="display:flex;flex-direction:column;gap:7px">${eyebrow(label, '#6B6B72')}
  <input id="${id}" value="${esc(value ?? '')}" ${attrs} style="height:42px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 13px;color:#fff;font-size:13px;outline:none"></label>`;
const bigBtn = (label, attrs, ghost) => `<span ${attrs} class="${ghost ? 'btn-s' : 'btn-p'}" style="height:46px;border-radius:999px;${ghost ? 'background:#212125;border:1px solid #3A3A40' : 'background:#E8442E'};display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;letter-spacing:.08em;cursor:pointer">${label}</span>`;

export default async function (ctx) {
  const { rpc, shop: s0, seg } = ctx;
  const shop = await rpc('owner_shop', { p_slug: s0.slug });
  const base = `/${shop.slug}/shop`;
  const page = seg[0] || '';
  const tabs = [['Listing', base, !page], ['Deposit', `${base}/deposit`, page === 'deposit'], ['Pause', `${base}/pause`, page === 'pause']];
  if (page === 'deposit') return deposit(ctx, base, tabs);
  if (page === 'pause') return pause(ctx, base, tabs);
  if (page) throw new Error('not_found');
  return listing(ctx, shop, tabs);
}

async function listing({ rest, go, toast, refreshMe }, shop, tabs) {
  const s = (await rest(`salons?select=name,address,bio,website,open_min,close_min,short_code,status&id=eq.${shop.id}`))[0];
  const inner = `${card(`${eyebrow('HOW YOUR SHOP READS ON STERNCUT')}
      ${input('f-name', 'NAME', s.name)}${input('f-address', 'ADDRESS', s.address)}
      <label style="display:flex;flex-direction:column;gap:7px">${eyebrow('ABOUT', '#6B6B72')}<textarea id="f-bio" rows="3" style="border-radius:10px;background:#111113;border:1px solid #26262B;padding:11px 13px;color:#fff;font-size:13px;line-height:1.5;outline:none;resize:vertical">${esc(s.bio || '')}</textarea></label>
      ${input('f-web', 'WEBSITE', s.website, 'placeholder="https://"')}
      <div style="display:flex;gap:10px">${input('f-open', 'OPENS', clock(s.open_min ?? 600), 'type="time"')}${input('f-close', 'CLOSES', clock(s.close_min ?? 1260), 'type="time"')}</div>
      <span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>
      ${bigBtn('SAVE THE LISTING', 'id="f-save"')}`)}
    ${card(`${kv('Status', s.status === 'live' ? 'Live — customers can find you' : s.status)}${rule}${kv('Shop code, under the walk-in QR', s.short_code || '—')}
      <span style="font-size:11px;color:#6B6B72;line-height:1.5">The poster with the QR prints from the Sterncut app — Profile → Salon management.</span>`)}`;
  return {
    html: column(inner, tabs),
    ready(root) {
      root.querySelector('#f-save').onclick = async () => {
        const v = (id) => root.querySelector(id).value.trim();
        const min = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const err = root.querySelector('.dlg-err');
        const body = { name: v('#f-name'), address: v('#f-address') || null, bio: v('#f-bio') || null, website: v('#f-web') || null,
          open_min: min(v('#f-open')), close_min: min(v('#f-close')) };
        if (!body.name) { err.textContent = 'The shop needs a name.'; err.style.display = 'block'; return; }
        if (!(body.close_min > body.open_min)) { err.textContent = 'Closing has to come after opening.'; err.style.display = 'block'; return; }
        try { await patch(`salons?id=eq.${shop.id}`, body); toast('Saved'); refreshMe?.(); go(location.pathname, { replace: true }); }
        catch (e) { err.textContent = e.message; err.style.display = 'block'; }
      };
    },
  };
}

// ---- OSH-11 / 12 / 13 ----------------------------------------------------------
async function deposit({ rpc, q, go, toast, dialog, closeDialog }, base, tabs) {
  const st = await rpc('shop_deposit_state');
  const want = q.has('pct') ? Math.max(0, Math.min(100, Number(q.get('pct')) || 0)) : st.pct;
  const pct = want && (want < st.floor_pct || want > st.ceiling_pct) ? st.pct : want;
  const on = pct > 0, dirty = pct !== st.pct;
  const steps = [st.floor_pct, 30, 40, 50, st.ceiling_pct].filter((n, i, a) => n >= st.floor_pct && n <= st.ceiling_pct && a.indexOf(n) === i).sort((a, b) => a - b);
  const sample = st.services[0] || null;
  const held = (c, p = pct) => Math.ceil(c * p / 100);
  const toggle = `<a href="${base}/deposit?pct=${on ? 0 : st.floor_pct}" style="display:flex;align-items:center;gap:12px;background:#17171A;border:1px solid #1E1E22;border-radius:18px;padding:15px 16px;text-decoration:none;color:#fff">
    <span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:13.5px;font-weight:700">Ask for a deposit</span><span style="font-size:11px;color:#9A9CA3">${on ? 'Held from the customer’s wallet at booking' : 'Off — customers book with nothing held'}</span></span>
    <span style="width:42px;height:24px;border-radius:999px;background:${on ? '#E8442E' : '#3A3A40'};position:relative"><span style="position:absolute;top:3px;${on ? 'right' : 'left'}:3px;width:18px;height:18px;border-radius:999px;background:#fff"></span></span></a>`;
  const inner = on ? `${toggle}
    ${card(`<div style="display:flex;justify-content:space-between;align-items:flex-end"><span style="display:flex;flex-direction:column;gap:4px">${eyebrow('YOUR SHOP ASKS FOR')}<span class="num" style="font-family:'Playfair Display',serif;font-size:44px;font-weight:700;line-height:1">${pct}<span style="font-size:22px">%</span></span></span>
        ${sample ? `<span style="display:flex;flex-direction:column;align-items:flex-end;gap:3px"><span class="num" style="font-size:18px;font-weight:800;color:#E8A100">${dh(held(sample.price_cents))} DH</span><span style="font-size:10.5px;color:#9A9CA3">on a ${dh(sample.price_cents)} DH cut</span></span>` : ''}</div>
      <div style="position:relative;height:8px;border-radius:4px;background:#212125;margin:6px 0">
        <span style="position:absolute;top:0;bottom:0;left:0;width:${st.floor_pct}%;background:repeating-linear-gradient(45deg,#26262B 0 4px,transparent 4px 8px);border-radius:4px"></span>
        <span style="position:absolute;top:0;bottom:0;left:${st.ceiling_pct}%;right:0;background:repeating-linear-gradient(45deg,#26262B 0 4px,transparent 4px 8px);border-radius:4px"></span>
        <span style="position:absolute;top:0;bottom:0;left:${st.floor_pct}%;width:${pct - st.floor_pct}%;background:#E8442E"></span>
        <span style="position:absolute;top:-4px;left:calc(${pct}% - 8px);width:16px;height:16px;border-radius:999px;background:#fff"></span></div>
      <div style="display:flex;justify-content:space-between;font-size:10.5px;font-weight:700;color:#6B6B72"><span>🔒 ${st.floor_pct}% Sterncut floor</span><span>${st.ceiling_pct}% ceiling</span></div>
      <div style="display:flex;gap:6px">${steps.map((n) => `<a href="${base}/deposit?pct=${n}" style="flex:1;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;text-decoration:none;${n === pct ? 'background:#E8442E;color:#fff' : 'background:#212125;color:#9A9CA3'}">${n}%</a>`).join('')}</div>
      <span style="font-size:11px;color:#6B6B72">Now ${st.pct}%${st.since ? `, set ${esc(new Date(st.since).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }))}` : ''}. A customer may always choose to pay more — up to the full price — never less.</span>`)}
    ${st.services.length ? `${eyebrow('WHAT A CUSTOMER WILL BE ASKED')}${card(st.services.slice(0, 4).map((sv) => `<div style="display:flex;gap:12px;align-items:center"><span style="flex:1;font-size:12.5px;font-weight:600">${esc(sv.name)} <span style="color:#6B6B72">${dh(sv.price_cents)} DH</span></span><span class="num" style="font-size:12.5px;font-weight:700;color:#E8A100">${dh(held(sv.price_cents))} DH</span><span class="num" style="font-size:11.5px;color:#9A9CA3;width:90px;text-align:right">${dh(sv.price_cents - held(sv.price_cents))} DH cash</span></div>`).join(rule))}` : ''}
    <div style="background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.25);border-radius:14px;padding:12px 14px;font-size:11.5px;line-height:1.5;color:#E8A100">A deposit is <b>held</b>, not paid to you. It becomes the shop’s when the cut is done, or if the customer doesn’t turn up. Rounded to the dirham.</div>
    ${bigBtn(dirty ? `SAVE · ${pct}% DEPOSIT` : `${pct}% DEPOSIT`, dirty ? `data-go="${base}/deposit?pct=${pct}&confirm=1"` : '')}`
    : `${toggle}
    ${card(`${eyebrow('YOUR SHOP ASKS FOR')}<span class="num" style="font-family:'Playfair Display',serif;font-size:44px;font-weight:700;line-height:1">0<span style="font-size:22px">%</span></span>
      <span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">Bookings at ${esc(st.salon_name)} work exactly as they do today: the whole price in cash at the shop, nothing held in advance.</span>`)}
    ${eyebrow('WHAT THAT MEANS')}
    ${card(`<span style="font-size:12px;line-height:1.5">A slot costs nothing to break. Someone who doesn’t turn up loses nothing.</span>${rule}
      <span style="font-size:12px;line-height:1.5">${st.no_shows > 0 ? `Last month, your chairs lost <b style="color:#F87171">${st.no_shows} slot${st.no_shows === 1 ? '' : 's'}</b> to no-shows — ${dh(st.no_show_cents)} DH of chair time.` : 'No no-shows in the last month. A deposit is what keeps it that way when it changes.'}</span>${rule}
      <span style="font-size:12px;line-height:1.5">Customers keep their wallets. Money already in one can’t be spent here until you turn deposits on.</span>`)}
    <span style="font-size:11.5px;color:#9A9CA3">🔒 Turn it back on and the lowest Sterncut allows is ${st.floor_pct}%.</span>
    ${dirty ? bigBtn('SAVE · NO DEPOSIT', 'data-save="0"', true) : ''}`;

  return {
    html: column(inner, tabs),
    ready(root) {
      const save = async (p) => {
        try { await rpc('set_shop_deposit', { p_pct: p }); closeDialog(); toast(p ? `Deposit is ${p}% from today` : 'No deposit from today'); go(`${base}/deposit`, { replace: true }); }
        catch (e) { toast(e.message, false); }
      };
      root.querySelector('[data-save]')?.addEventListener('click', () => save(0));
      if (q.get('confirm') && dirty && on) {
        // OSH-12 — from today, forward only
        const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-family:'Playfair Display',serif;font-size:24px;font-weight:700">${pct > st.pct ? 'Raise' : 'Lower'} the deposit to ${pct}%?</span>
          <div style="display:flex;align-items:center;gap:14px;background:#111113;border:1px solid #1E1E22;border-radius:14px;padding:14px">
            <span style="flex:1;display:flex;flex-direction:column;gap:3px">${eyebrow('UNTIL NOW', '#6B6B72')}<span class="num" style="font-size:24px;font-weight:800">${st.pct}%</span>${sample ? `<span style="font-size:10.5px;color:#6B6B72">${dh(held(sample.price_cents, st.pct))} DH on ${dh(sample.price_cents)} DH</span>` : ''}</span>
            <span style="color:#6B6B72">→</span>
            <span style="flex:1;display:flex;flex-direction:column;gap:3px">${eyebrow('FROM TODAY', '#E8442E')}<span class="num" style="font-size:24px;font-weight:800;color:#E8442E">${pct}%</span>${sample ? `<span style="font-size:10.5px;color:#E8A100">${dh(held(sample.price_cents))} DH on ${dh(sample.price_cents)} DH</span>` : ''}</span></div>
          ${kv('Applies to', 'Bookings taken from now')}${kv('Already booked', `${st.already_booked} keep their ${st.pct}%`)}
          <span style="font-size:11.5px;line-height:1.5;color:#9A9CA3">Every customer who has already booked pays the deposit they agreed to. Nothing you change here reaches bookings already taken.</span>
          <div style="display:flex;gap:10px;justify-content:flex-end"><span data-dlg-close="1" class="btn-s" style="height:40px;border-radius:999px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 18px;font-size:12px;font-weight:700;cursor:pointer">Cancel</span>
            <span id="dep-go" class="btn-p" style="height:40px;border-radius:999px;background:#E8442E;display:flex;align-items:center;padding:0 18px;font-size:12px;font-weight:700;cursor:pointer">SET ${pct}% FROM TODAY</span></div></div>`,
        { onClose: () => go(`${base}/deposit?pct=${pct}`), width: 500 });
        d.querySelector('#dep-go').onclick = () => save(pct);
      }
    },
  };
}

// ---- OSH-09 · pause the shop ------------------------------------------------------
async function pause({ rpc, rest, go, toast, q }, base, tabs) {
  const [p, meta] = await Promise.all([rpc('shop_pause_preview'), rest(`salons?select=accepting_bookings,closed_until&slug=eq.${base.split('/')[1]}`).then((r) => r[0] || {})]);
  if (meta.accepting_bookings === false) {
    const inner = `${card(`${eyebrow('PAUSED', '#E8A100')}<span style="font-size:15px;font-weight:700">${esc(p.name)} is paused ${meta.closed_until ? `until ${esc(new Date(meta.closed_until + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }))}` : 'until you reopen'}</span>
      <span style="font-size:12px;line-height:1.55;color:#9A9CA3">No new bookings and no one joins a line. Every booking already in the book is still honoured.</span>`, 'border-color:rgba(232,161,0,.3)')}${bigBtn('REOPEN THE SHOP', 'data-reopen="1"')}`;
    return { html: column(inner, tabs), ready(root) { root.querySelector('[data-reopen]').onclick = async () => { try { await rpc('reopen_shop'); toast('The shop is open again'); go(`${base}/pause`, { replace: true }); } catch (e) { toast(e.message, false); } }; } };
  }
  const scope = q.get('for') === 'open' ? 'open' : 'today';
  const tell = q.get('tell') !== '0';
  const link = (patchq) => { const u = new URLSearchParams({ for: scope, tell: tell ? '1' : '0', ...patchq }); return `${base}/pause?${u}`; };
  const chip = (k, l) => `<a href="${link({ for: k })}" style="flex:1;height:38px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:12.5px;text-decoration:none;${scope === k ? 'background:#E8442E;color:#fff;font-weight:700' : 'background:#212125;color:#9A9CA3;font-weight:600'}">${l}</a>`;
  const inner = `<span style="font-size:17px;font-weight:800">Close ${esc(p.name)}</span>
    <span style="font-size:11.5px;color:#9A9CA3">This closes the whole shop, not just you.</span>
    ${eyebrow('FOR HOW LONG')}<div style="display:flex;gap:8px">${chip('today', 'Rest of today')}${chip('open', 'Until I reopen')}</div>
    ${card(`${eyebrow('WHAT IT COVERS')}${kv('Barbers on the page', String(p.barbers))}${kv('Booked today', String(p.booked_today))}${kv('On the waiting list', String(p.waiting))}
      ${p.working_today?.length ? `<span style="font-size:11px;color:#9A9CA3">Working today: ${esc(p.working_today.map((w) => w.name).join(', '))}</span>` : ''}
      <span style="font-size:11.5px;line-height:1.5;color:#9A9CA3">No new bookings and no one joins a line while it is closed. Every booking already in the book is still honoured.</span>`)}
    <a href="${link({ tell: tell ? '0' : '1' })}" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:#fff;font-size:12.5px"><span style="width:18px;height:18px;border-radius:5px;border:1.5px solid ${tell ? '#E8442E' : '#3A3A40'};background:${tell ? '#E8442E' : 'transparent'};display:flex;align-items:center;justify-content:center;font-size:11px">${tell ? '✓' : ''}</span>Tell the people on the waiting list</a>
    ${bigBtn(scope === 'today' ? 'CLOSE FOR THE REST OF TODAY' : 'CLOSE UNTIL I REOPEN', 'data-close="1"')}
    <span style="font-size:10.5px;color:#6B6B72;text-align:center">Picking dates isn’t on the website — the app’s pause does the same two.</span>`;
  return {
    html: column(inner, tabs),
    ready(root) {
      root.querySelector('[data-close]').onclick = async () => {
        if (!confirm(`Close ${p.name} ${scope === 'today' ? 'for the rest of today' : 'until you reopen'}?`)) return;
        try { await rpc('close_shop', { p_scope: scope, p_until: null, p_tell_waitlist: tell }); toast('The shop is paused'); go(`${base}/pause`, { replace: true }); }
        catch (e) { toast(e.message, false); }
      };
    },
  };
}
