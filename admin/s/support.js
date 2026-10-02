// /support and /support/<case> — SUP-04 (the live queue, with who is in what),
// SUP-05 (?about=money), SUP-01/07 (a case; 0066's claim_case is the lock — two
// people refunding the same money is how a customer gets paid twice), and the
// incident banner (0061's platform_incidents; opening one freezes money actions).
// Reads: admin_support, admin_support_case, case_holders, admin_desk, admin_incident.
// Writes, through the gate: reply (Support's), resolve with or without a refund
// (asks above 200 DH), take a case from someone idle, open/close an incident.
// Not built: the engineering threads and partner tickets (BRB-22/23) — no backend;
// the section home the README puts at /support — the queue lives there, as SUP-04 does.
import { esc, DH, initials, first, ago, dayShort, hhmm, icon, rpc as call } from '/app.js';
import { pageHead, chips, label9, btnS, btnP } from '/s/ui.js';

export const REASON = { no_show: 'Barber never showed', wrong_amount: 'Charged the wrong amount', wrong_service: 'Not the service booked',
  hygiene: 'Hygiene complaint', other: 'Something else', unpaid_leaver: 'Left a shop that still owes them',
  // a barber's own help topics (5c)
  booking: 'A booking', money: 'Money or float', client: 'A client’s behaviour', app: 'The app is broken', review: 'A review' };
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };

export default async function (ctx) {
  const ref = ctx.seg[0];
  if (!ref || ['incidents', 'desk', 'held'].includes(ref)) return queue(ctx);
  return caseView(ctx, ref);
}

async function incidentBar(rpc) {
  const inc = await rpc('admin_incident').catch(() => null);
  const live = inc?.live;
  if (!live) return { html: '', live: null };
  return { live, html: `<div style="display:flex;align-items:center;gap:12px;padding:11px 24px;background:rgba(248,113,113,.08);border-bottom:1px solid rgba(248,113,113,.3)">
    <span style="width:8px;height:8px;border-radius:999px;background:#F87171;flex:none"></span>
    <span style="flex:1;min-width:0;font-size:12px;line-height:1.5"><b>${esc(live.ref || 'Incident')} · ${esc(live.title)}</b> <span style="color:#9A9CA3">— since ${esc(hhmm(live.started_at))}. ${live.locks === 'money' ? 'Money actions are frozen until it is closed.' : ''}</span></span>
    <a href="/support?incident=close" style="font-size:11px;font-weight:800;letter-spacing:.06em">CLOSE IT</a></div>` };
}

// SUP-06 · the bell: 0072's admin_bell, split by whether it needs a person
const BELL_ICON = 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0';
const bellBtn = (b, href) => `<a href="${href}" title="Notifications" style="position:relative;width:34px;height:34px;border-radius:10px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;justify-content:center;color:#fff">${icon(BELL_ICON, 15)}${b?.act.length ? `<span class="num" style="position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:999px;background:#E8442E;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px">${b.act.length}</span>` : ''}</a>`;
const BELL_GO = { support: (r) => `/support/${r.ref}`, compliance: () => '/compliance', 'salons/pending': () => '/salons?state=pending' };
function bellOpen(b, { dialog, go, back }) {
  const others = b.desk.filter((p) => !p.me);
  const row = (r) => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px">
    <div style="display:flex;gap:10px"><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:700">${esc(r.title)}</span><span style="display:block;font-size:11px;color:#9A9CA3;margin-top:2px">${esc(r.detail)}</span></span><span style="font-size:10px;color:#6B6B72;flex:none">${esc(ago(r.at))}</span></div>
    <div style="display:flex;align-items:center;gap:9px"><a href="${esc((BELL_GO[r.go] || (() => '/overview'))(r))}" style="font-size:10px;font-weight:800;letter-spacing:.06em;background:#212125;border-radius:7px;padding:7px 10px;color:#fff">${esc(r.action)}</a>${r.held_by ? `<span style="font-size:10.5px;color:#E8A100">${esc(r.held_by)} is in it</span>` : ''}</div></div>`;
  const fyi = (r) => `<div style="display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid #1E1E22"><span style="flex:1;min-width:0"><span style="display:block;font-size:12px;color:#D8D8DC">${esc(r.title)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">${esc(r.detail)}</span></span><span style="font-size:10px;color:#6B6B72;flex:none">${esc(ago(r.at))}</span></div>`;
  const dl = dialog(`<div style="padding:20px;display:flex;flex-direction:column;gap:12px;max-height:80vh;overflow:auto">
    <div style="display:flex;align-items:center;gap:10px;padding-bottom:11px;border-bottom:1px solid #26262B"><span style="font-size:14px;font-weight:700">Notifications</span><span style="flex:1"></span>
      <span style="font-size:10.5px;color:#6B6B72">${others.length ? `${others.length} other${others.length === 1 ? '' : 's'} on` : 'only you'}</span><span id="bl-seen" style="cursor:pointer;font-size:10.5px;color:#9A9CA3">Mark all read</span></div>
    ${label9(`NEEDS A PERSON · ${b.act.length}`)}${b.act.map(row).join('') || '<span style="font-size:11.5px;color:#6B6B72">Nothing needs a person.</span>'}
    ${label9('JUST SO YOU KNOW')}<div>${b.fyi.map(fyi).join('') || '<span style="font-size:11.5px;color:#6B6B72">Quiet.</span>'}</div>
    <span style="font-size:10.5px;color:#6B6B72;line-height:1.5">Only money, compliance and applications ring. Everything else waits in the sidebar.</span></div>`, { onClose: () => go(back), width: 460 });
  dl.querySelector('#bl-seen').onclick = () => call('admin_bell_seen').then(() => go(back)).catch(() => go(back));
}

async function queue({ rpc, act, q, go, toast, dialog, closeDialog }) {
  const status = q.get('status') === 'resolved' ? 'resolved' : 'open';
  const [d, holders, desk, inc, bell] = await Promise.all([
    rpc('admin_support', { p_status: status }), rpc('case_holders').catch(() => []), rpc('admin_desk').catch(() => null), incidentBar(rpc),
    rpc('admin_bell').catch(() => null),
  ]);
  const held = Object.fromEntries((holders || []).map((h) => [h.ref, h]));
  let rows = d.rows;
  if (q.get('mine')) rows = rows.filter((r) => held[r.case_no]?.mine);
  if (q.get('about') === 'money') rows = rows.filter((r) => r.amount_cents > 0 || r.reason === 'wrong_amount');
  const link = (patch) => { const u = new URLSearchParams(q); for (const [k, v] of Object.entries(patch)) { if (v) u.set(k, v); else u.delete(k); } const s = u.toString(); return '/support' + (s ? '?' + s : ''); };
  const row = (c) => {
    const h = status === 'open' ? held[c.case_no] : null;   // a claim outlives the case it was on
    return `<a href="/support/${esc(c.case_no)}" class="hov" style="display:flex;align-items:center;gap:12px;padding:13px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff">
      <span style="width:74px;flex:none;font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:700;color:#E8917F">${esc(c.case_no)}</span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(REASON[c.reason] || c.reason)}</span><span style="font-size:10.5px;color:#9A9CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.customer || '—')} · ${esc(c.salon || '—')}${c.detail ? ` · “${esc(c.detail.slice(0, 80))}”` : ''}</span></span>
      ${c.amount_cents ? `<span class="num" style="flex:none;font-size:10px;font-weight:700;color:#E8442E;background:rgba(232,68,46,.14);border-radius:5px;padding:3px 7px">${DH(c.amount_cents)}</span>` : ''}
      <span style="width:130px;flex:none;font-size:11px;color:${h ? (h.mine ? '#4ADE80' : '#E8A100') : '#6B6B72'}">${h ? (h.mine ? 'You’re in it' : `${esc(first(h.holder))} is in it`) : status === 'open' ? 'Nobody yet' : ''}</span>
      <span class="num" style="width:44px;flex:none;text-align:right;font-size:11px;color:#6B6B72">${esc(ago(c.created_at))}</span></a>`;
  };
  const people = desk?.people || [];
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Support', `${d.counts.open} open · ${d.counts.resolved} closed`, `<span style="display:flex;gap:10px;align-items:center">${inc.live ? '' : btnS('Open an incident', 'data-go="/support?incident=new"')}${bellBtn(bell, link({ bell: '1' }))}</span>`)}
    ${inc.html}
    ${chips([['Open', link({ status: null }), status === 'open', d.counts.open], ['Closed', link({ status: 'resolved' }), status === 'resolved'],
      ['Mine', link({ mine: q.get('mine') ? null : '1' }), !!q.get('mine')], ['About money', link({ about: q.get('about') ? null : 'money' }), q.get('about') === 'money']])}
    <div style="flex:1;overflow:auto;padding:18px 24px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:3 1 520px;min-width:0;background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">${rows.map(row).join('') || `<div style="padding:22px 16px;font-size:12px;color:#6B6B72">${q.get('mine') ? 'Nothing is yours right now.' : 'Nothing to answer.'}</div>`}</div>
      <div style="flex:1 1 240px;min-width:0;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:10px">
        ${label9('ON THE DESK NOW')}
        ${people.map((p) => `<div style="display:flex;align-items:center;gap:10px;opacity:${(p.idle_min ?? 0) > 20 ? '.55' : '1'}"><span style="width:26px;height:26px;border-radius:999px;background:${p.me ? '#E8442E' : '#212125'};display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;flex:none">${esc(initials(p.name))}</span><span style="flex:1;min-width:0;font-size:11.5px">${esc(first(p.name))}${p.holding ? ` · <span style="color:#E8A100">${esc(p.holding)}</span>` : ''}</span><span class="num" style="font-size:10px;color:#6B6B72">${p.idle_min ? `${p.idle_min} min` : 'now'}</span></div>`).join('') || '<span style="font-size:11.5px;color:#6B6B72">Nobody else.</span>'}
        <span style="font-size:10.5px;color:#6B6B72;line-height:1.45;border-top:1px solid #26262B;padding-top:9px">Opening a case claims it. Someone else in it for less than 15 minutes means you read, not act.</span>
      </div></div></div>`;
  return {
    top: false, html,
    ready() {
      if (q.get('bell') && bell) bellOpen(bell, { dialog, go, back: link({ bell: null }) });
      if (q.get('incident') === 'new' && !inc.live) {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Open an incident</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">Every screen shows it, and money actions are frozen until someone closes it — so nobody settles or refunds while the numbers can’t be trusted.</span>
          <input id="in-title" placeholder="Payments are down" style="height:42px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:13px;outline:none">
          <textarea id="in-detail" rows="3" placeholder="What we know" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('OPEN IT', 'id="in-go"')}</div></div>`, { onClose: () => go('/support'), width: 480 });
        dl.querySelector('#in-go').onclick = async () => {
          const title = dl.querySelector('#in-title').value.trim();
          if (!title) return showErr(dl, new Error('Give it a title.'));
          try { await act('admin_open_incident', { p_title: title, p_detail: dl.querySelector('#in-detail').value.trim() || null, p_locks: 'money' }, { title: `Open an incident: ${title}` }); closeDialog(); toast('Incident open · money actions frozen'); }
          catch (e) { showErr(dl, e); }
        };
      }
      if (q.get('incident') === 'close' && inc.live) {
        if (!confirm(`Close “${inc.live.title}”? Money actions unlock immediately.`)) return go('/support', { replace: true });
        act('admin_close_incident', { p_incident: inc.live.id }, { title: `Close the incident: ${inc.live.title}` })
          .then(() => { toast('Incident closed · money actions are back'); go('/support', { replace: true }); })
          .catch((e) => { if (!e.handled) toast(e.message, false); go('/support', { replace: true }); });
      }
    },
  };
}

async function caseView({ rpc, act, go, toast, q, dialog, closeDialog }, ref) {
  // the case number is the address; its id comes from the list it is in
  let hit = null;
  for (const st of ['open', 'resolved']) {
    const d = await rpc('admin_support', { p_status: st });
    hit = d.rows.find((r) => r.case_no === ref);
    if (hit) break;
  }
  if (!hit) throw new Error('not_found');
  const claim = hit.status === 'open' ? await rpc('claim_case', { p_ref: ref }).catch(() => ({ mine: true })) : { mine: true };
  const [c, inc] = await Promise.all([rpc('admin_support_case', { p_case: hit.id }), incidentBar(rpc)]);
  const open = c.case.status === 'open';
  // what is left of the deposit, if there is a booking; the case's own disputed amount otherwise
  const depositLeft = c.booking ? Math.max(0, (c.booking.deposit_cents || 0) - (c.booking.refunded_cents || 0)) : 0;
  const suggest = c.case.amount_cents || depositLeft;
  const readOnly = open && !claim.mine;
  const line = (l, v, color) => `<span style="display:flex;justify-content:space-between;gap:10px;font-size:12px"><span style="color:#9A9CA3">${l}</span><span style="font-weight:600;text-align:right;${color ? `color:${color}` : ''}">${esc(v)}</span></span>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    <div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px;font-size:13px">
      <a href="/support" style="color:#9A9CA3;font-weight:600">Support</a><span style="color:#3A3A40">›</span><span style="font-weight:700">${esc(ref)}</span><span style="flex:1"></span>
      ${open ? (readOnly ? '' : `<a href="/support/${esc(ref)}?refund=1" style="height:32px;border-radius:9px;background:#4ADE80;color:#0D0D0F;display:flex;align-items:center;padding:0 14px;font-size:11px;font-weight:800">${suggest ? `REFUND ${DH(suggest)} &amp; CLOSE` : 'REFUND &amp; CLOSE'}</a>
        <span id="cs-close" class="btn-s" style="height:32px;border-radius:9px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 12px;font-size:11px;font-weight:700;cursor:pointer">CLOSE WITHOUT A REFUND</span>`)
        : `<span style="font-size:11px;font-weight:700;color:#4ADE80">Closed ${c.case.resolved_at ? esc(dayShort(c.case.resolved_at)) : ''}${c.case.refund_cents ? ` · ${DH(c.case.refund_cents)} refunded` : ''}</span>`}
    </div>
    ${inc.html}
    ${readOnly ? `<div style="display:flex;align-items:center;gap:12px;padding:12px 24px;background:rgba(232,161,0,.08);border-bottom:1px solid rgba(232,161,0,.28)">
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="font-size:12.5px;font-weight:700">${esc(claim.by)} got there first${claim.idle_min != null ? ` · ${claim.idle_min ? claim.idle_min + ' min ago' : 'just now'}` : ''}</span>
        <span style="font-size:11px;color:#9A9CA3">Two people refunding the same money is how a customer gets paid twice. Read it, don’t act on it — it unlocks when they leave or go idle for 15 minutes.</span></span>
      <span id="cs-take" style="flex:none;font-size:10px;font-weight:800;letter-spacing:.06em;background:#E8442E;border-radius:7px;padding:8px 11px;cursor:pointer">TAKE IT FROM ${esc(first(claim.by).toUpperCase())}</span></div>` : ''}
    <div style="flex:1;min-height:0;display:flex">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column">
        <div style="flex:1;overflow:auto;padding:20px 24px;display:flex;flex-direction:column;gap:12px">
          <div><span style="display:block;font-size:17px;font-weight:800">${esc(REASON[c.case.reason] || c.case.reason)}</span><span style="display:block;font-size:11.5px;color:#9A9CA3;margin-top:4px">Opened ${esc(dayShort(c.case.created_at))} ${hhmm(c.case.created_at)}${c.case.amount_cents ? ` · <b style="color:#E8442E">${DH(c.case.amount_cents)} in dispute</b>` : ''}${c.booking ? ` · booking ${esc(c.booking.ref)}` : ''}${c.salon ? ` · ${esc(c.salon.name)}${c.salon.status !== 'live' ? ` (${esc(c.salon.status)})` : ''}` : ''}</span></div>
          ${c.case.detail && c.messages[0]?.body !== c.case.detail ? `<div style="background:#17171A;border-radius:12px;padding:13px 15px;font-size:12.5px;line-height:1.55;color:#D8D8DC">“${esc(c.case.detail)}”</div>` : ''}
          ${c.messages.map((m) => `<div style="background:${m.from_us ? '#212125' : '#17171A'};border-radius:12px;padding:13px 15px;${m.from_us ? 'margin-left:40px' : 'margin-right:40px'}">
            <div style="display:flex;align-items:center;gap:8px"><span style="font-size:11px;font-weight:700">${esc(m.author)}</span><span style="font-size:10px;color:#6B6B72">${esc(dayShort(m.at))} · ${hhmm(m.at)}</span></div>
            <div style="font-size:12.5px;line-height:1.55;color:#D8D8DC;margin-top:6px;white-space:pre-wrap">${esc(m.body)}</div></div>`).join('') || '<span style="font-size:12px;color:#6B6B72">No messages yet.</span>'}
        </div>
        ${open && !readOnly ? `<div style="flex:none;border-top:1px solid #1E1E22;padding:14px 24px;display:flex;gap:10px;align-items:flex-end">
          <textarea id="cs-reply" rows="2" placeholder="Reply to ${esc(first(c.customer?.name || 'them'))}…" style="flex:1;background:#17171A;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;line-height:1.5;outline:none;resize:vertical"></textarea>
          <span id="cs-send" class="btn-p" style="height:40px;border-radius:10px;background:#E8442E;display:flex;align-items:center;padding:0 18px;font-size:11.5px;font-weight:800;cursor:pointer">SEND</span></div>` : ''}
      </div>
      <div style="width:300px;flex:none;border-left:1px solid #1E1E22;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:12px">
        ${label9('THE BOOKING')}
        ${c.booking ? `<div style="background:#17171A;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:9px">
          ${line('Reference', c.booking.ref)}${line('Service', c.booking.service || '—')}${line('When', `${dayShort(c.booking.starts_at)} ${hhmm(c.booking.starts_at)}`)}
          ${line('Price', DH(c.booking.price_cents))}${line('Deposit', DH(c.booking.deposit_cents), '#E8442E')}
          ${line('Status', c.booking.status === 'cancelled' ? `cancelled${c.booking.cancelled_by ? ' by ' + c.booking.cancelled_by : ''}` : c.booking.status.replace(/_/g, ' '))}
          ${line('Refunded', c.booking.refunded_cents ? DH(c.booking.refunded_cents) : 'Never issued', c.booking.refunded_cents ? '#4ADE80' : '#F87171')}</div>` : '<span style="font-size:11.5px;color:#6B6B72">No booking attached.</span>'}
        ${label9('THE CUSTOMER')}
        <div style="background:#17171A;border-radius:12px;padding:14px;display:flex;align-items:center;gap:11px">
          <span style="width:36px;height:36px;border-radius:999px;background:rgba(232,68,46,.14);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#E8442E;flex:none">${esc(initials(c.customer?.name || '?'))}</span>
          <span style="flex:1;min-width:0"><span style="display:block;font-size:12px;font-weight:700">${esc(c.customer?.name || 'Customer')}</span><span class="num" style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px">${c.customer?.bookings ?? 0} bookings · wallet ${DH(c.customer?.wallet_cents ?? 0)}</span></span></div>
        ${c.salon ? `${label9('THE SHOP')}<div style="background:#17171A;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:4px"><span style="font-size:12px;font-weight:700">${esc(c.salon.name)}</span><span style="font-size:10.5px;color:${c.salon.status === 'live' ? '#9A9CA3' : '#F87171'}">${esc(c.salon.status)} · ${c.salon.open_cases} open dispute${c.salon.open_cases === 1 ? '' : 's'}</span></div>` : ''}
      </div>
    </div></div>`;
  const reload = () => go(`/support/${ref}`, { replace: true });
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#cs-take')?.addEventListener('click', async () => {
        if (!confirm(`Take ${ref} from ${claim.by}? They are told, and it goes on both your records.`)) return;
        try { const r = await act('admin_take_case', { p_ref: ref }, { title: `Take ${ref} from ${claim.by}` }); toast(r?.taken_from ? `Taken from ${r.taken_from}` : 'It is yours'); reload(); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      });
      root.querySelector('#cs-send')?.addEventListener('click', async () => {
        const body = root.querySelector('#cs-reply').value.trim();
        if (!body) return toast('Nothing to send.', false);
        try { await act('admin_support_reply', { p_case: hit.id, p_body: body }, { title: `Reply on ${ref}` }); toast('Sent'); reload(); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      });
      const resolve = async (cents) => {
        if (!confirm(cents ? `Refund ${DH(cents)} to ${c.customer?.name || 'the customer'}’s wallet and close ${ref}?` : `Close ${ref} without a refund?`)) return;
        try { await act('admin_support_resolve', { p_case: hit.id, p_refund_cents: cents || null }, { title: cents ? `Refund ${DH(cents)} on ${ref}` : `Close ${ref}` }); toast(cents ? `Refunded ${DH(cents)} · closed` : 'Closed'); go('/support'); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      };
      root.querySelector('#cs-close')?.addEventListener('click', () => resolve(0));
      if (q.get('refund') && open && !readOnly) {
        const who = first(c.customer?.name || 'the customer');
        const ctxLine = (l, v) => `<span style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#9A9CA3">${l}</span><span class="num" style="font-weight:700">${v}</span></span>`;
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Refund and close ${esc(ref)}</span>
          <div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 13px;display:flex;flex-direction:column;gap:7px">
            ${ctxLine('In dispute', c.case.amount_cents ? DH(c.case.amount_cents) : 'no amount given')}
            ${c.booking ? ctxLine(`Deposit on ${esc(c.booking.ref)} not yet refunded`, DH(depositLeft)) : ''}
            ${ctxLine(`${esc(who)}’s wallet now`, DH(c.customer?.wallet_cents ?? 0))}</div>
          <label style="display:flex;flex-direction:column;gap:6px">${label9('AMOUNT · DH', '#6B6B72')}<input id="rf-dh" inputmode="numeric" value="${suggest ? suggest / 100 : ''}" style="height:42px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:14px;outline:none"></label>
          <span style="font-size:11.5px;color:#9A9CA3;line-height:1.55">It lands in ${esc(who)}’s wallet straight away, they’re told, and the case closes. If the booking’s deposit was already paid to the shop, the refund comes off that shop’s next statement; otherwise Sterncut bears it. Above 200 DH, Support and Field ops ask the Head first.</span>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('REFUND &amp; CLOSE', 'id="rf-go"')}</div></div>`, { onClose: () => go(`/support/${ref}`), width: 460 });
        dl.querySelector('#rf-go').onclick = async () => {
          const cents = Math.round(Number(dl.querySelector('#rf-dh').value.replace(/\s/g, '').replace(',', '.')) * 100);
          if (!(cents > 0)) return showErr(dl, new Error('Say how much.'));
          try {
            await act('admin_support_resolve', { p_case: hit.id, p_refund_cents: cents }, { title: `Refund ${DH(cents)} on ${ref}` });
            closeDialog(); toast(`${DH(cents)} back in ${who}’s wallet · closed`); go('/support');
          } catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}
