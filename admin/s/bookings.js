// /bookings[?scope=30&view=…], /bookings/<id>[?case=1], /bookings/<id>/refund, /bookings/refunds[?days=]
// BKN-01 (the day's list: 0043's admin_bookings), BKN-03 (exceptions), BKN-02/06 (one
// booking: 0069's admin_booking + 0079's admin_booking_hold — who holds the deposit now),
// CUS-06 (refund: a case resolved with a refund, as the old console and CUS-04 do — it
// asks above 200 DH), BKN-04 (refunds by who bore it: 0079's admin_refund_ledger).
// Nothing on the booking page edits the booking; a refund and a case are new records.
// Addressed by id, like barbers and customers: the short ref (#A3F29B71) has no lookup.
import { esc, DH, initials, first, dayShort, hhmm, ago } from '/app.js';
import { pageHead, chips, label9, btnS, btnP, csv } from '/s/ui.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = {
  pending: ['PENDING', '#E8A100'], confirmed: ['CONFIRMED', '#9A9CA3'], queued: ['QUEUED', '#9A9CA3'], checked_in: ['CHECKED IN', '#5B8DEF'],
  in_chair: ['IN CHAIR', '#5B8DEF'], completed: ['COMPLETED', '#4ADE80'], cancelled: ['CANCELLED', '#6B6B72'], no_show: ['NO-SHOW', '#F87171'],
};
const pill = (st, disputed) => { const [t, c] = disputed ? ['DISPUTED', '#F87171'] : STATE[st] || [String(st).toUpperCase(), '#9A9CA3']; return `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:3px 7px;white-space:nowrap">${t}</span>`; };
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };
const input = 'background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none';

export default async function (ctx) {
  const [a, b] = ctx.seg;
  if (!a) return list(ctx);
  if (a === 'refunds') return refunds(ctx);
  if (UUID.test(a) && (!b || b === 'refund')) return one(ctx, a, b === 'refund');
  throw new Error('not_found');
}

// ---- BKN-01 / BKN-03 ---------------------------------------------------------------
const VIEWS = {
  all: () => true, pending: (r) => r.state === 'pending', upcoming: (r) => ['confirmed', 'queued', 'checked_in'].includes(r.state) && Date.parse(r.starts_at) > Date.now() - 36e5,
  completed: (r) => r.state === 'completed', cancelled: (r) => r.state === 'cancelled', disputed: (r) => r.disputed,
  // ponytail: somebody let down = a no-show or an open dispute. The drawn causes (cancelled
  // inside three hours, nobody there, slow refund, wrong price) need a read with cancel times.
  exceptions: (r) => r.disputed || r.state === 'no_show',
};
async function list({ rpc, q }) {
  const scope = q.get('scope') === '30' ? '30' : 'today';
  const view = VIEWS[q.get('view')] ? q.get('view') : 'all';
  const d = await rpc('admin_bookings', { p_scope: scope === '30' ? 'month' : 'today', p_limit: 200 });
  const c = d.counts;
  const rows = d.rows.filter(VIEWS[view]);
  const link = (patch) => { const u = new URLSearchParams(q); for (const [k, v] of Object.entries(patch)) { if (v) u.set(k, v); else u.delete(k); } const s = u.toString(); return '/bookings' + (s ? '?' + s : ''); };
  const when = (iso) => scope === 'today' ? hhmm(iso) : `${dayShort(iso)} ${hhmm(iso)}`;
  const row = (r) => `<a href="/bookings/${r.id}" data-row="${esc(`${r.ref} ${r.customer} ${r.salon} ${r.barber}`.toLowerCase())}" class="hov" style="display:grid;grid-template-columns:96px 1.2fr 1.4fr 1.1fr 84px 96px 100px;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;font-size:12px">
    <span style="font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:700;color:#E8917F">${esc(r.ref)}</span>
    <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.walk_in ? `<span style="color:#9A9CA3">Walk-in ·</span> ` : ''}${esc(r.customer)}</span>
    <span style="color:#9A9CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.salon)} · ${esc(first(r.barber))}</span>
    <span style="color:#9A9CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.service)}</span>
    <span class="num">${esc(when(r.starts_at))}</span>
    <span class="num"><b>${Math.round(r.deposit_cents / 100)}</b> <span style="color:#6B6B72">/ ${DH(r.price_cents)}</span></span>
    <span>${pill(r.state, r.disputed)}</span></a>`;
  const kpi = (l, v, col) => `<div style="flex:1 1 120px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:13px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:20px;font-weight:700${col ? ';color:' + col : ''}">${v}</span></div>`;
  const nEx = d.rows.filter(VIEWS.exceptions).length;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Bookings', `${esc(dayShort(new Date().toISOString()))} · ${c.today} today`, `<span style="display:flex;gap:10px;align-items:center">${btnS(scope === 'today' ? 'Last 30 days' : 'Today', `data-go="${link({ scope: scope === 'today' ? '30' : null })}"`)}${btnS('Export CSV', 'id="bk-csv"')}</span>`)}
    ${chips([['All', link({ view: null }), view === 'all'], ['Pending', link({ view: 'pending' }), view === 'pending'], ['Upcoming', link({ view: 'upcoming' }), view === 'upcoming'],
      ['Completed', link({ view: 'completed' }), view === 'completed'], ['Cancelled', link({ view: 'cancelled' }), view === 'cancelled'], ['Disputed', link({ view: 'disputed' }), view === 'disputed'],
      ['Exceptions', link({ view: 'exceptions' }), view === 'exceptions', nEx || null], ['Refunds', '/bookings/refunds', false]],
      '<input id="bk-q" placeholder="Booking ID, customer, shop…" style="height:30px;width:220px;border-radius:8px;background:#17171A;border:1px solid #26262B;padding:0 11px;color:#fff;font-size:11.5px;outline:none">')}
    <div style="flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('TODAY', c.today)}${kpi('PENDING', c.pending, c.pending ? '#E8A100' : '')}${kpi('COMPLETED', c.completed)}${kpi('CANCELLED', c.cancelled)}${kpi('NO-SHOW', c.no_show, c.no_show ? '#F87171' : '')}${kpi('DEPOSITS TAKEN', DH(c.deposit_cents))}</div>
      ${view === 'exceptions' ? '<div style="font-size:12px;color:#9A9CA3;line-height:1.55">An exception is somebody let down, not a booking that did not complete: here, the no-shows and the bookings with a case open. Cancellations made with notice stay in the full log.</div>' : ''}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
        <div style="display:grid;grid-template-columns:96px 1.2fr 1.4fr 1.1fr 84px 96px 100px;gap:12px;padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:760px"><span>ID</span><span>CUSTOMER</span><span>SALON · BARBER</span><span>SERVICE</span><span>WHEN</span><span>PAID / TOTAL</span><span>STATUS</span></div>
        <div style="min-width:760px">${rows.map(row).join('') || '<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No bookings here.</div>'}</div>
        <div id="bk-none" style="display:none;padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">Nothing matches.</div></div>
      ${d.rows.length >= 200 ? '<span style="font-size:11px;color:#6B6B72">Showing the first 200.</span>' : ''}
    </div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#bk-q').oninput = (e) => { const v = e.target.value.trim().toLowerCase().replace(/^#/, ''); let n = 0; root.querySelectorAll('[data-row]').forEach((r) => { const ok = !v || r.dataset.row.includes(v); r.style.display = ok ? '' : 'none'; if (ok) n++; }); root.querySelector('#bk-none').style.display = !v || n ? 'none' : 'block'; };
      root.querySelector('#bk-csv').onclick = () => csv(`bookings-${scope}`, [['Ref', (r) => r.ref], ['Customer', (r) => r.customer], ['Salon', (r) => r.salon], ['Barber', (r) => r.barber], ['Service', (r) => r.service],
        ['Starts', (r) => r.starts_at], ['Deposit DH', (r) => r.deposit_cents / 100], ['Price DH', (r) => r.price_cents / 100], ['State', (r) => r.state], ['Disputed', (r) => (r.disputed ? 'yes' : '')]], rows);
    },
  };
}

// ---- BKN-02 / BKN-06 / CUS-06 --------------------------------------------------------
async function one({ rpc, act, q, go, toast, dialog, closeDialog }, id, refundOpen) {
  const [d, hold] = await Promise.all([rpc('admin_booking', { p_booking: id }), rpc('admin_booking_hold', { p_booking: id }).catch(() => null)]);
  const m = d.money, cu = d.customer, ba = d.barber;
  // the list's state, from the same timestamps (admin_booking's status can still say 'confirmed')
  const has = (w) => d.timeline.some((t) => t.what === w);
  const st = d.status !== 'confirmed' ? d.status : has('Done') ? 'completed' : has('In the chair') ? 'in_chair' : has('Checked in') ? 'checked_in' : 'confirmed';
  const base = `/bookings/${id}`;
  const who = (label, name, sub, href) => `<a href="${href}" class="hov" style="flex:1 1 240px;display:flex;align-items:center;gap:12px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;text-decoration:none;color:#fff">
    <span style="width:34px;height:34px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(name))}</span>
    <span style="flex:1;min-width:0"><span style="display:block;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${label}</span><span style="display:block;font-size:13px;font-weight:700;margin-top:2px">${esc(name)}</span><span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px">${sub}</span></span></a>`;
  const money = (l, v, s) => `<div style="flex:1 1 130px;display:flex;flex-direction:column;gap:4px"><span style="font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:18px;font-weight:700">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
  const side = (l, v, href) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px"><span style="color:#9A9CA3">${l}</span>${href ? `<a href="${href}" style="font-weight:700">${v}</a>` : `<span style="font-weight:600">${v}</span>`}</div>`;
  const quiet = st === 'completed' && !d.case && d.refunded_cents === 0;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    <div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px;font-size:13px">
      <a href="/bookings" style="color:#9A9CA3;font-weight:600">Bookings</a><span style="color:#3A3A40">›</span><span style="font-weight:700;font-family:ui-monospace,Menlo,monospace">${esc(d.ref)}</span>${pill(st, d.case?.status === 'open')}
      <span style="flex:1"></span>${btnS('Copy ID', `data-copy="${esc(d.ref)}"`)}</div>
    <div style="flex:1;overflow:auto;padding:20px 24px 32px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:2 1 520px;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${who('CUSTOMER', cu.name, `${cu.visits} visit${cu.visits === 1 ? '' : 's'} · wallet ${DH(cu.wallet_cents)} · ${cu.marks ? `${cu.marks} mark${cu.marks === 1 ? '' : 's'}` : 'no marks'}`, `/customers/${cu.id}`)}
          ${who('BARBER', ba.name, `${esc(ba.salon || 'No shop')}${ba.rating ? ` · ${ba.rating} ★` : ''}`, `/barbers/${ba.id}`)}</div>
        ${label9('THE MONEY')}
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:14px">
          <div style="display:flex;gap:14px;flex-wrap:wrap">${money('SERVICE', DH(m.price_cents), `${esc(m.service)} · ${m.duration_min} min`)}${money(`DEPOSIT · ${m.deposit_pct}%`, DH(m.deposit_cents), hold ? esc(hold.holder) : 'no hold on record')}
            ${money('CASH AT SHOP', DH(m.cash_cents), st === 'completed' ? 'collected' : 'if it goes ahead')}${m.coupon || m.discount_cents ? money('COUPON', DH(m.discount_cents), esc(m.coupon || '')) : ''}</div>
          <span style="font-size:11.5px;color:#9A9CA3;line-height:1.5;border-top:1px solid #26262B;padding-top:11px">Sterncut took no commission.${d.refunded_cents ? ` ${DH(d.refunded_cents)} of the deposit has gone back to the wallet.` : ''}</span></div>
        ${label9('WHAT HAPPENED')}
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">${d.timeline.map((t, i) => `<div style="display:flex;gap:14px;padding:12px 16px;${i ? 'border-top:1px solid #1E1E22' : ''}"><span class="num" style="width:96px;flex:none;font-size:11px;color:#6B6B72">${esc(dayShort(t.at))} ${hhmm(t.at)}</span><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(t.what)}</span>${t.detail ? `<span style="display:block;font-size:11px;color:#9A9CA3;margin-top:2px">${esc(t.detail)}</span>` : ''}</span></div>`).join('')}</div>
        <span style="font-size:11px;color:#6B6B72">Nothing on this page can be edited. A booking log that can be corrected is not a log.</span>
      </div>
      <div style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:12px">
        ${quiet ? '<div style="background:rgba(74,222,128,.07);border:1px solid rgba(74,222,128,.25);border-radius:14px;padding:13px 15px;display:flex;flex-direction:column;gap:4px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#4ADE80">NOTHING TO FIX HERE</span><span style="font-size:11.5px;color:#9A9CA3;line-height:1.5">Paid and completed. The actions stay available anyway.</span></div>' : ''}
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:10px">
          ${side('Linked case', d.case ? `${esc(d.case.case_no)} · ${esc(d.case.status)}` : 'None', d.case ? `/support/${esc(d.case.case_no)}` : '')}
          ${side('Review', d.review ? `${esc(d.review.ref)} · ${esc(d.review.state)}` : 'None', d.review ? `/reviews/${d.review.id}` : '')}
          ${side('Refundable', d.refundable_cents ? `${DH(d.refundable_cents)} deposit` : 'nothing left')}</div>
        ${label9('IF A CUSTOMER COMPLAINS')}
        ${d.refundable_cents ? `<span data-go="${base}/refund" class="btn-p" style="display:flex;align-items:center;justify-content:center;height:38px;border-radius:10px;background:#E8442E;font-size:11.5px;font-weight:800;letter-spacing:.04em;cursor:pointer">REFUND THE ${DH(d.refundable_cents)} DEPOSIT</span>` : ''}
        ${d.case?.status === 'open' ? '' : `<span data-go="${base}?case=1" class="btn-s" style="display:flex;align-items:center;justify-content:center;height:38px;border-radius:10px;background:#212125;border:1px solid #3A3A40;font-size:11.5px;font-weight:700;letter-spacing:.04em;cursor:pointer">OPEN A CASE FROM THIS</span>`}
        <span style="font-size:10.5px;color:#6B6B72;line-height:1.5">A refund here credits the wallet and leaves the booking ${esc(STATE[st]?.[0].toLowerCase() || st)}.</span>
      </div></div></div>`;

  // a refund is a case resolved with a refund — the same rail as CUS-04 and the desk
  const refund = async (cents, why) => {
    let caseId = d.case?.status === 'open' ? d.case.id : null;
    if (!caseId) caseId = (await act('admin_open_case', { p_user: cu.id, p_reason: 'other', p_detail: `Refund from the booking page: ${why}`, p_booking: d.id }, { title: `Open a case on ${d.ref}` })).id;
    await act('admin_support_resolve', { p_case: caseId, p_refund_cents: cents }, { title: `Refund ${DH(cents)} on ${d.ref}`, reason: why });
  };
  return {
    top: false, html,
    ready(root) {
      root.querySelector('[data-copy]').onclick = (e) => navigator.clipboard?.writeText(e.currentTarget.dataset.copy).then(() => toast('Copied'), () => {});
      if (refundOpen && d.refundable_cents) {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Refund a booking</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">${esc(d.ref)} · ${esc(cu.name)} with ${esc(ba.name)}. The deposit is the default and the most that can go back — the cash at the shop was never ours. It lands in ${esc(first(cu.name))}’s wallet; above 200 DH, Support and Field ops ask the Head.</span>
          <label style="display:flex;flex-direction:column;gap:6px">${label9('AMOUNT · DH', '#6B6B72')}<input id="rf-dh" inputmode="numeric" value="${d.refundable_cents / 100}" style="height:42px;${input};font-size:14px"></label>
          <label style="display:flex;flex-direction:column;gap:6px">${label9('WHY', '#6B6B72')}<textarea id="rf-why" rows="3" style="${input};resize:vertical"></textarea></label>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('REFUND IT', 'id="rf-go"')}</div></div>`, { onClose: () => go(base), width: 460 });
        dl.querySelector('#rf-go').onclick = async () => {
          const cents = Math.round(Number(dl.querySelector('#rf-dh').value.replace(',', '.')) * 100);
          const why = dl.querySelector('#rf-why').value.trim();
          if (!(cents > 0)) return showErr(dl, new Error('Say how much.'));
          if (cents > d.refundable_cents) return showErr(dl, new Error(`At most ${DH(d.refundable_cents)} — what is left of the deposit.`));
          if (!why) return showErr(dl, new Error('Say why — it goes on the case.'));
          try { await refund(cents, why); closeDialog(); toast(`${DH(cents)} back in ${first(cu.name)}’s wallet`); }
          catch (e) { showErr(dl, e); }
        };
      }
      if (q.get('case') && d.case?.status !== 'open') {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Open a case from ${esc(d.ref)}</span>
          <label style="display:flex;flex-direction:column;gap:6px">${label9('WHAT WENT WRONG', '#6B6B72')}<textarea id="oc-why" rows="3" style="${input};resize:vertical"></textarea></label>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('OPEN IT', 'id="oc-go"')}</div></div>`, { onClose: () => go(base), width: 440 });
        dl.querySelector('#oc-go').onclick = async () => {
          const why = dl.querySelector('#oc-why').value.trim();
          if (!why) return showErr(dl, new Error('Say what went wrong.'));
          try { const c = await act('admin_open_case', { p_user: cu.id, p_reason: 'other', p_detail: why, p_booking: d.id }, { title: `Open a case on ${d.ref}` }); closeDialog(); toast('Case opened'); go(`/support/${c.case_no}`); }
          catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}

// ---- BKN-04 · refunds, by who bore it --------------------------------------------
async function refunds({ rpc, q }) {
  const days = [7, 30, 90].includes(Number(q.get('days'))) ? Number(q.get('days')) : 30;
  const d = await rpc('admin_refund_ledger', { p_days: days });
  const kpi = (l, v, s, col) => `<div style="flex:1 1 180px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:22px;font-weight:800${col ? ';color:' + col : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Refunds', `Last ${days} days · ${DH(d.total_cents)} across ${d.count} refund${d.count === 1 ? '' : 's'}`, `<span style="display:flex;gap:10px;align-items:center">${btnS('Export', 'id="rf-csv"')}</span>`)}
    ${chips([['7 days', '/bookings/refunds?days=7', days === 7], ['30 days', '/bookings/refunds', days === 30], ['90 days', '/bookings/refunds?days=90', days === 90], ['Back to bookings', '/bookings', false]])}
    <div style="flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:14px;max-width:1100px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('REFUNDED', DH(d.total_cents), `${d.count} booking${d.count === 1 ? '' : 's'}`)}${kpi('NEVER PAID OUT', DH(d.never_paid_cents), 'caught before settlement')}${kpi('STERNCUT BORE', DH(d.sterncut_cents), 'desk decisions for the customer', d.sterncut_cents ? '#E8A100' : '')}</div>
      ${label9('WHERE THE MONEY CAME FROM')}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
        <div style="display:grid;grid-template-columns:2fr 60px 110px 170px;gap:12px;padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72"><span>CAUSE</span><span>N</span><span>VALUE</span><span>WHO BORE IT</span></div>
        ${d.rows.map((r) => `<div style="display:grid;grid-template-columns:2fr 60px 110px 170px;gap:12px;align-items:center;padding:13px 16px;border-top:1px solid #1E1E22"><span><span style="display:block;font-size:12.5px;font-weight:700">${esc(r.label)}</span><span style="display:block;font-size:11px;color:#9A9CA3;margin-top:2px">${esc(r.why)}</span></span><span class="num" style="font-size:12.5px">${r.n}</span><span class="num" style="font-size:12.5px;font-weight:700">${DH(r.cents)}</span><span style="font-size:9.5px;letter-spacing:.1em;font-weight:800;color:${r.bore === 'STERNCUT' ? '#E8A100' : '#9A9CA3'}">${esc(r.bore)}</span></div>`).join('') || '<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No refunds in this window.</div>'}
      </div>
      <div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 15px;font-size:11.5px;color:#9A9CA3;line-height:1.55"><b style="color:#fff">Nothing is recovered from a shop yet.</b> A refund after a shop has been settled has no claw-back, so there is no “the shop · in arrears” line — it would print a zero that looks like good news.</div>
    </div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#rf-csv').onclick = () => csv(`refunds-${days}d`, [['Cause', (r) => r.label], ['Count', (r) => r.n], ['DH', (r) => r.cents / 100], ['Who bore it', (r) => r.bore]], d.rows);
    },
  };
}
