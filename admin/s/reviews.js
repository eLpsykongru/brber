// /reviews, /reviews/<id>, /reviews/flagged[/<id>][?remove=1], /reviews/appeals[/<id>]
// RVW-05 (the list, 0043's admin_reviews: all / held / removed / low), RVW-01/13 (one
// review with the visit behind it: admin_review), RVW-03 (removal needs a reason on
// the record — 0042 refuses one without), RVW-04/07 (the appeal desk: 0068's
// admin_appeal_desk; 0057 refuses deciding your own removal).
// Writes through the gate: keep/remove are the Moderator's; appeals too.
// Not built: the derived tags (RVW-05's "waited · 34") — nothing stores them, so the
// list is searched instead; "someone else got there first" on a review (SUP-03).
import { esc, initials, ago, dayShort, hhmm } from '/app.js';
import { pageHead, chips, label9, btnS } from '/s/ui.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = [
  ['no_visit', 'No matching visit', 'No booking or check-in on the record'],
  ['abusive', 'Abusive or hateful language', 'Slurs, threats, harassment'],
  ['personal_details', 'Personal details or contact info', 'Phone numbers, addresses, other people named'],
  ['off_service', 'Not about the service', 'Complaint is about something outside the barber’s control'],
  ['spam', 'Spam or a promo code', 'Advertising, referral links, repeated posting'],
  ['duplicate', 'Duplicate of another review', 'Same visit reviewed more than once'],
];
const VISIT = { none: 'no visit on record', qr: 'walk-in by QR', verified: 'visit verified', booked: 'booked, no check-in' };
const STATE = { held: ['HELD FROM PUBLIC', '#E8A100'], removed: ['REMOVED', '#F87171'], public: ['PUBLIC', '#4ADE80'] };
const stars = (n) => `<span style="letter-spacing:1px"><span style="color:#E8A100">${'★'.repeat(Math.round(n))}</span><span style="color:#3A3A40">${'★'.repeat(5 - Math.round(n))}</span></span>`;
const tag = (state) => { const [t, c] = STATE[state] || [String(state || 'public').toUpperCase(), '#9A9CA3']; return `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:3px 7px">${t}</span>`; };
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };

export default async function (ctx) {
  const [a, b] = ctx.seg;
  if (!a) return list(ctx);
  if (a === 'appeals') return appeals(ctx, b);
  if (a === 'flagged') {
    if (b) return one(ctx, b);
    const d = await ctx.rpc('admin_reviews', { p_filter: 'held' });
    if (d.rows[0]) return ctx.go(`/reviews/flagged/${d.rows[0].id}`, { replace: true });
    return ctx.go('/reviews?filter=held', { replace: true });
  }
  if (UUID.test(a)) return one(ctx, a);
  throw new Error('not_found');
}

async function list({ rpc, q }) {
  const filter = ['held', 'removed', 'low'].includes(q.get('filter')) ? q.get('filter') : 'all';
  const d = await rpc('admin_reviews', { p_filter: filter });
  const m = d.stats || {};
  const row = (r) => `<a href="/reviews/${r.state === 'held' ? 'flagged/' : ''}${r.id}" data-row="${esc(((r.comment || '') + ' ' + r.barber + ' ' + r.customer).toLowerCase())}" class="hov" style="display:flex;align-items:flex-start;gap:12px;padding:13px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff">
    <span style="width:84px;flex:none;font-size:11px">${stars(r.rating)}</span>
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="font-size:12.5px;line-height:1.45">${esc(r.comment || '— no text —')}</span><span style="font-size:10.5px;color:#9A9CA3">${esc(r.customer)} on ${esc(r.barber)} · ${esc(VISIT[r.visit] || r.visit)}${r.removal_reason ? ` · removed: ${esc(r.removal_reason.replace(/_/g, ' '))}` : ''}</span></span>
    <span style="flex:none">${tag(r.state)}</span>
    <span class="num" style="width:44px;flex:none;text-align:right;font-size:11px;color:#6B6B72">${esc(ago(r.flagged_at || r.created_at))}</span></a>`;
  const kpi = (l, v, s) => `<div style="flex:1;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 15px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:22px;font-weight:800">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Reviews', 'Every review, and the ones held back', `<a href="/reviews/appeals" style="font-size:12px;font-weight:700">The appeal desk</a>`)}
    ${chips([['All', '/reviews', filter === 'all'], ['Held', '/reviews?filter=held', filter === 'held', m.held || null], ['Removed', '/reviews?filter=removed', filter === 'removed'], ['2 stars or less', '/reviews?filter=low', filter === 'low']],
      '<input id="rv-q" placeholder="Words, barber or customer" style="height:30px;width:220px;border-radius:8px;background:#17171A;border:1px solid #26262B;padding:0 11px;color:#fff;font-size:11.5px;outline:none">')}
    <div style="flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px">${kpi('THIS MONTH', m.average == null ? '—' : m.average + ' ★', `${m.month ?? 0} review${m.month === 1 ? '' : 's'}${m.prev_month != null ? ` · ${m.prev_month} last month` : ''}`)}${kpi('HELD FROM PUBLIC', m.held ?? 0, m.held_since ? `oldest ${ago(m.held_since)}` : 'none waiting')}${kpi('REMOVED', m.removed ?? 0, 'all time, each with a reason on the record')}</div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">${d.rows.map(row).join('') || '<div style="padding:22px 16px;font-size:12px;color:#6B6B72">No reviews here.</div>'}
        <div id="rv-none" style="display:none;padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">None of these mention that.</div></div>
    </div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#rv-q').oninput = (e) => { const v = e.target.value.trim().toLowerCase(); let n = 0; root.querySelectorAll('[data-row]').forEach((r) => { const ok = !v || r.dataset.row.includes(v); r.style.display = ok ? '' : 'none'; if (ok) n++; }); root.querySelector('#rv-none').style.display = !v || n ? 'none' : 'block'; };
    },
  };
}

async function one({ rpc, act, q, go, toast, dialog, closeDialog }, id) {
  const d = await rpc('admin_review', { p_review: id });
  const r = d.review, v = d.visit;
  const base = location.pathname;
  const held = r.state === 'held';
  const line = (l, val, c) => `<span style="display:flex;justify-content:space-between;gap:10px;font-size:12px"><span style="color:#9A9CA3">${l}</span><span style="font-weight:600;${c ? `color:${c}` : ''}">${esc(val)}</span></span>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    <div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px;font-size:13px">
      <a href="/reviews" style="color:#9A9CA3;font-weight:600">Reviews</a><span style="color:#3A3A40">›</span><span style="font-weight:700">${esc(r.ref || 'Review')}</span><span style="flex:1"></span>
      ${held ? `<span id="rv-keep" class="btn-s" style="height:32px;border-radius:9px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 13px;font-size:11px;font-weight:700;cursor:pointer">KEEP IT PUBLIC</span>
        <a href="${base}?remove=1" style="height:32px;border-radius:9px;border:1px solid rgba(248,113,113,.4);display:flex;align-items:center;padding:0 13px;font-size:11px;font-weight:700;color:#F87171">REMOVE</a>` : ''}
    </div>
    <div style="flex:1;overflow:auto;padding:20px 24px 32px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:2 1 460px;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;align-items:center;gap:12px"><span style="width:44px;height:44px;border-radius:12px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(d.customer.name))}</span>
          <span style="flex:1;min-width:0"><span style="display:flex;align-items:center;gap:9px;flex-wrap:wrap"><span style="font-size:15px;font-weight:700">${esc(d.customer.name)} <span style="color:#6B6B72;font-weight:400">on</span> ${esc(d.barber.name)}</span>${tag(r.state)}</span>
          <span style="display:block;font-size:11px;color:#9A9CA3;margin-top:4px">Posted ${esc(dayShort(r.created_at))}, ${hhmm(r.created_at)} · ${esc(d.barber.salon || '—')}${r.flagged_at ? ` · disputed ${esc(ago(r.flagged_at))} ago` : ''}</span></span></div>
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px">
          <span style="font-size:13px">${stars(r.rating)}</span>
          <span style="font-size:13.5px;line-height:1.6;color:#D8D8DC">${esc(r.comment || '— no text —')}</span>
          ${r.reply ? `<div style="background:#212125;border-radius:11px;padding:11px 13px;font-size:12px;line-height:1.5;color:#C9CAD0"><b style="color:#9A9CA3">The shop replied:</b> ${esc(r.reply)}</div>` : ''}
          ${r.removal_reason ? `<span style="font-size:11.5px;color:#F87171">Removed ${r.moderated_at ? esc(dayShort(r.moderated_at)) : ''}: ${esc(r.removal_reason.replace(/_/g, ' '))}</span>` : ''}
        </div>
        ${label9('THE VISIT BEHIND IT')}
        ${v ? `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:9px">
          ${line('Booking', v.ref || '—')}${line('Service', v.service || '—')}${line('Slot', `${dayShort(v.starts_at)} ${hhmm(v.starts_at)}`)}
          ${line('Checked in', v.checked_in_at ? hhmm(v.checked_in_at) : 'no check-in on record', v.checked_in_at ? null : '#E8A100')}
          ${line('In the chair', v.started_at ? `${hhmm(v.started_at)}${v.late_min > 0 ? ` · ${v.late_min} min late` : ''}` : '—', v.late_min > 15 ? '#E8A100' : null)}
          ${line('Done', v.completed_at ? hhmm(v.completed_at) : '—')}${line('Status', v.status)}</div>`
        : '<div style="background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.28);border-radius:14px;padding:14px 16px;font-size:12px;color:#E8A100">No booking behind this review.</div>'}
        ${d.case ? `<a href="/support/${esc(d.case.case_no)}" style="font-size:12px;font-weight:700">Support case ${esc(d.case.case_no)} · ${esc(d.case.status)}</a>` : ''}
        ${d.log?.length ? `${label9('DECISIONS ON THIS ONE')}<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">${d.log.map((x, i) => `<div style="padding:11px 16px;${i ? 'border-top:1px solid #1E1E22;' : ''}font-size:12px"><b>${esc(x.admin || 'Staff')}</b> ${esc(x.action)}${x.reason ? ` · ${esc(x.reason.replace(/_/g, ' '))}` : ''}${x.note ? ` · “${esc(x.note)}”` : ''} <span style="color:#6B6B72">· ${esc(dayShort(x.at))}</span></div>`).join('')}</div>` : ''}
      </div>
      <div style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:12px">
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:10px">
          ${label9(`WHAT IT DOES TO ${d.barber.name.toUpperCase()}`)}
          <div style="display:flex;justify-content:space-between;align-items:flex-end"><span><span style="display:block;font-size:9px;letter-spacing:.12em;font-weight:700;color:#6B6B72">IF KEPT</span><span class="num" style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:4px">${d.barber.rating_now ?? '—'}</span></span>
            <span style="text-align:right"><span style="display:block;font-size:9px;letter-spacing:.12em;font-weight:700;color:#6B6B72">IF REMOVED</span><span class="num" style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:4px;color:#4ADE80">${d.barber.rating_without ?? '—'}</span></span></div>
          <span style="font-size:10.5px;color:#6B6B72">Across ${d.barber.count} public review${d.barber.count === 1 ? '' : 's'}</span>
        </div>
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:8px">
          ${label9('WHO WROTE IT')}${line('Bookings with us', String(d.customer.bookings))}${line('Reviews written', String(d.customer.reviews))}
        </div>
      </div>
    </div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#rv-keep')?.addEventListener('click', async () => {
        try { await act('admin_review_decide', { p_review: r.id, p_action: 'keep' }, { title: `Keep ${r.ref || 'a review'} public` }); toast('Kept public'); go('/reviews/flagged'); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      });
      if (q.get('remove') && held) {
        const checkedIn = v && (v.checked_in_at || v.completed_at);
        let reason = null;
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:12px">
          <span style="font-size:17px;font-weight:800">Remove this review</span>
          <span style="font-size:11.5px;color:#9A9CA3">${esc(r.ref || '')} · ${esc(d.customer.name)} on ${esc(d.barber.name)} · ${r.rating} ★. A removal goes on the record with its reason, and both sides are told.</span>
          <div id="rm-list" style="display:flex;flex-direction:column;gap:7px">${REASONS.map(([k, t, s]) => {
            const off = k === 'no_visit' && checkedIn;
            return `<span data-reason="${off ? '' : k}" style="display:flex;align-items:center;gap:12px;background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 13px;${off ? 'opacity:.45' : 'cursor:pointer'}"><span class="dot" style="width:16px;height:16px;border-radius:999px;border:1.5px solid #3A3A40;flex:none"></span><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(t)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">${esc(off ? 'Doesn’t apply — check-in on record' : s)}</span></span></span>`;
          }).join('')}</div>
          <textarea id="rm-note" rows="2" placeholder="A line for the record (optional)" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:10px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}<span id="rm-go" class="btn-p" style="display:flex;align-items:center;height:34px;border-radius:9px;padding:0 16px;font-size:11.5px;font-weight:800;background:#E8442E;cursor:pointer">REMOVE IT</span></div></div>`,
        { onClose: () => go(base), width: 520 });
        dl.querySelector('#rm-list').onclick = (e) => {
          const row = e.target.closest('[data-reason]');
          if (!row || !row.dataset.reason) return;
          reason = row.dataset.reason;
          dl.querySelectorAll('[data-reason]').forEach((x) => { const on = x === row; x.style.borderColor = on ? '#F87171' : '#26262B'; x.querySelector('.dot').style.background = on ? '#F87171' : ''; });
        };
        dl.querySelector('#rm-go').onclick = async () => {
          if (!reason) return showErr(dl, new Error('Pick a reason — a removal needs one on the record.'));
          try { await act('admin_review_decide', { p_review: r.id, p_action: 'remove', p_reason: reason, p_note: dl.querySelector('#rm-note').value.trim() || null }, { title: `Remove ${r.ref || 'a review'}` }); closeDialog(); toast('Removed · both sides notified'); go('/reviews/flagged'); }
          catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}

// ---- RVW-04 / RVW-07 · the appeal desk ---------------------------------------------
async function appeals({ rpc, act, go, toast }, id) {
  const desk = await rpc('admin_appeal_desk', UUID.test(id || '') ? { p_appeal: id } : {});
  const d = desk.detail;
  if (!id && d) return go(`/reviews/appeals/${d.id}`, { replace: true });
  const mo = desk.this_month || { total: 0, upheld: 0, overturn_pct: 0 };
  const queue = desk.queue.map((x) => { const on = d && x.id === d.id; return `<a href="/reviews/appeals/${x.id}" style="display:block;padding:12px 16px;border-bottom:1px solid #1E1E22;text-decoration:none;color:#fff;${on ? 'background:#17171A;border-left:3px solid #E8A100' : ''}">
    <div style="display:flex;gap:8px"><span style="font-size:10px;font-family:ui-monospace,Menlo,monospace;font-weight:700;color:${on ? '#E8A100' : '#6B6B72'}">${esc(x.ref)}</span><span style="flex:1"></span><span style="font-size:10px;color:${x.days_left <= 1 ? '#F87171' : '#6B6B72'}">${x.days_left} day${x.days_left === 1 ? '' : 's'} left</span></div>
    <div style="font-size:12px;font-weight:600;margin-top:5px">${esc(x.customer)}</div><div style="font-size:10.5px;color:#9A9CA3;margin-top:2px">removed by ${esc(x.mine ? 'you' : x.removed_by)}</div></a>`; }).join('') || '<div style="padding:16px;font-size:12px;color:#6B6B72">No appeals waiting.</div>';
  const side = `<div style="width:250px;flex:none;border-right:1px solid #1E1E22;display:flex;flex-direction:column;overflow:auto">
    <div style="padding:14px 16px;border-bottom:1px solid #1E1E22">${label9('APPEALS · OLDEST DEADLINE FIRST')}</div>${queue}
    <div style="margin-top:auto;padding:16px;font-size:11px;color:#9A9CA3;line-height:1.5">${mo.total} appeal${mo.total === 1 ? '' : 's'} this month · ${mo.upheld} upheld · ${mo.overturn_pct}% overturned. A high overturn rate says more about the removal bar than about the people appealing.</div></div>`;
  const head = `<div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px;font-size:13px"><a href="/reviews" style="color:#9A9CA3;font-weight:600">Reviews</a><span style="color:#3A3A40">›</span><span style="font-weight:700">Appeals</span>${d ? `<span style="color:#3A3A40">›</span><span style="font-weight:700">${esc(d.ref)}</span>` : ''}</div>`;
  if (!d) return { top: false, html: `<div style="height:100%;display:flex;flex-direction:column">${head}<div style="flex:1;display:flex;min-height:0">${side}<div style="padding:30px;font-size:13px;color:#6B6B72">Nothing to decide.</div></div></div>` };
  const own = d.is_own_removal;
  const main = `<div style="flex:1;min-width:0;overflow:auto;padding:20px 24px 32px;display:flex;flex-direction:column;gap:14px;max-width:760px">
    <span style="font-size:17px;font-weight:800">${esc(d.customer)} appeals a removed review of ${esc(d.barber)}</span>
    <span style="font-size:11.5px;color:#9A9CA3">Removed by ${esc(d.removed_by)} ${d.removed_at ? esc(dayShort(d.removed_at)) : ''} for ${esc((d.removal_reason || '').replace(/_/g, ' '))} · appealed ${esc(dayShort(d.appealed_at))} · ${esc(d.salon || '')}</span>
    <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:8px"><span style="font-size:12.5px">${stars(d.rating || 0)}</span><span style="font-size:13px;line-height:1.6;color:#D8D8DC">${esc(d.body || '— no text —')}</span></div>
    ${d.reason || d.note ? `<div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.55"><b>Why they appeal:</b> ${esc(d.reason || '')}${d.note ? ` — “${esc(d.note)}”` : ''}</div>` : ''}
    ${own ? '<div style="background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.28);border-radius:12px;padding:12px 14px;font-size:12px;color:#E8A100">You removed this review. A second reviewer decides the appeal — send it back to the queue.</div>' : `
    <label style="display:flex;flex-direction:column;gap:7px">${label9('WHAT THE SECOND REVIEW FOUND')}<textarea id="ap-note" rows="3" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea></label>
    <label style="display:flex;flex-direction:column;gap:7px">${label9('A TASK FOR THE SHOP, IF UPHELD (OPTIONAL)', '#6B6B72')}<input id="ap-action" placeholder="e.g. Move the QR poster outside" style="height:40px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:12.5px;outline:none"></label>`}
    <div style="display:flex;gap:10px">${own ? `<span data-reassign="1" class="btn-s" style="height:38px;border-radius:10px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:700;cursor:pointer">SEND IT BACK TO THE QUEUE</span>`
      : `<span data-decide="up" style="height:38px;border-radius:10px;background:#4ADE80;color:#0D0D0F;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:800;cursor:pointer">UPHOLD — PUT IT BACK</span>
         <span data-decide="down" class="btn-s" style="height:38px;border-radius:10px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:700;cursor:pointer">KEEP IT REMOVED</span>`}</div></div>`;
  return {
    top: false,
    html: `<div style="height:100%;display:flex;flex-direction:column">${head}<div style="flex:1;display:flex;min-height:0">${side}${main}</div></div>`,
    ready(root) {
      root.onclick = async (e) => {
        const re = e.target.closest('[data-reassign]'), dec = e.target.closest('[data-decide]');
        try {
          if (re) { await act('admin_reassign_appeal', { p_appeal: d.id }, { title: `Send appeal ${d.ref} back` }); toast('Back in the queue for somebody else'); go('/reviews/appeals'); }
          if (dec) {
            const note = root.querySelector('#ap-note').value.trim();
            if (!note) return toast('Say what the second review found.', false);
            const action = root.querySelector('#ap-action').value.trim();
            await act('admin_decide_appeal', { p_appeal: d.id, p_upheld: dec.dataset.decide === 'up', p_note: note, p_action: action || null,
              p_due: action ? new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10) : null }, { title: `Decide appeal ${d.ref}`, reason: note });
            toast('Decided · both sides told'); go('/reviews/appeals');
          }
        } catch (err) { if (!err.handled) toast(err.message, false); }
      };
    },
  };
}
