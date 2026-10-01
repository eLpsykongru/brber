// /wallets, /wallets/witnessed[?visit=<id>], /wallets/agents[?agent=<id>], /wallets/unchecked
// SAL-03 (wallets & float: 0044's admin_wallets), AGT-08 (the duty desk: 0102's
// admin_duty_queue and 0100's four-step call — the owner's figure is taken before the
// agent's, and the server refuses it the other way round), AGT-12 (ops-call receipts as
// a rate: 0101's audit and its three actions), AGT-20 (what the latest run still has
// unchecked: 0098's receipt states on admin_run).
// Not built (no backend): "hold payouts" on a mismatch, "push all agents to sync",
// suspending an agent (needs a second approver — 0101 refuses it and says so).
import { esc, DH, first, initials, dayShort, hhmm, ago } from '/app.js';
import { pageHead, chips, label9, btnS, btnP, csv } from '/s/ui.js';

const TABS = (at, duty) => chips([['Float', '/wallets', at === 'float'], ['Witnessed handovers', '/wallets/witnessed', at === 'witnessed', duty || null],
  ['Unchecked', '/wallets/unchecked', at === 'unchecked'], ['Agent rates', '/wallets/agents', at === 'agents']]);
const STATE = { balanced: ['BALANCED', '#4ADE80'], mismatch: ['MISMATCH', '#F87171'], awaiting: ['AWAITING PICKUP', '#E8A100'], we_owe: ['WE OWE THEM', '#5B8DEF'] };
const pill = ([t, c]) => `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:3px 7px;white-space:nowrap">${esc(t)}</span>`;
const kpi = (l, v, s, col) => `<div style="flex:1 1 200px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:22px;font-weight:800${col ? ';color:' + col : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
const signed = (c) => `${c > 0 ? '+' : c < 0 ? '−' : ''}${DH(Math.abs(c))}`;
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };
const cents = (v) => Math.round(Number(String(v).replace(/\s/g, '').replace(',', '.')) * 100);
const page = (head, tabs, body) => `<div style="height:100%;display:flex;flex-direction:column">${head}${tabs}<div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;flex-direction:column;gap:14px">${body}</div></div>`;

export default async function (ctx) {
  const [a] = ctx.seg;
  if (!a) return float(ctx);
  if (a === 'witnessed') return witnessed(ctx);
  if (a === 'agents') return agents(ctx);
  if (a === 'unchecked') return unchecked(ctx);
  throw new Error('not_found');
}

// ---- SAL-03 ------------------------------------------------------------------------
const LEDGER = { cash_topup: 'Top-up', topup: 'Top-up', deposit: 'Deposit', deposit_refund: 'Refund', refund: 'Refund', referral: 'Referral reward', settlement: 'Settlement', payout: 'Paid out to the shop' };
async function float({ rpc, rest }) {
  const [d, salons, duty] = await Promise.all([rpc('admin_wallets'), rest('salons?select=id,slug'), rpc('admin_duty_queue').catch(() => [])]);
  const slug = Object.fromEntries(salons.map((s) => [s.id, s.slug]));
  const gaps = d.shops.filter((s) => s.gap_cents !== 0);
  const row = (s) => `<a href="/salons/${esc(slug[s.id] || '')}" class="hov" style="display:grid;grid-template-columns:1.6fr 80px 110px 100px 130px;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;font-size:12px">
    <span style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}${s.cap_cents && s.float_cents > s.cap_cents ? ' <span style="font-size:10px;color:#F87171;font-weight:600">· over cap</span>' : ''}</span>
    <span class="num">${s.topups}</span><span class="num" style="font-weight:700">${DH(s.float_cents)}</span>
    <span class="num" style="color:${s.gap_cents ? '#F87171' : '#6B6B72'}">${s.gap_cents ? signed(s.gap_cents) : '0'}</span><span>${pill(STATE[s.state] || [s.state, '#9A9CA3'])}</span></a>`;
  const g = gaps[0];
  const html = page(pageHead('Wallets & float', d.last_settlement ? `Last collected from a shop · ${esc(dayShort(d.last_settlement))}` : 'Nothing collected from a shop yet',
      `<span style="display:flex;gap:10px;align-items:center">${btnS('Ledger export', 'id="wl-csv"')}${btnP('Run settlement', 'data-go="/finance"')}</span>`), TABS('float', duty.length),
    `${duty.length ? `<a href="/wallets/witnessed" style="display:flex;align-items:center;gap:12px;background:rgba(232,68,46,.09);border:1px solid rgba(232,68,46,.4);border-radius:12px;padding:12px 15px;color:#fff"><span style="width:8px;height:8px;border-radius:999px;background:#E8442E;flex:none"></span><span style="flex:1;font-size:12.5px;font-weight:700">${duty.length} agent${duty.length === 1 ? ' is' : 's are'} standing in a shop waiting for the duty desk</span><span style="font-size:10px;font-weight:800;letter-spacing:.06em">TAKE THE CALL</span></a>` : ''}
    <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('CUSTOMER WALLETS', DH(d.wallets.liability_cents), `${d.wallets.count} wallet${d.wallets.count === 1 ? '' : 's'} · liability we hold`)}
      ${kpi('AGENT CASH IN HAND', DH(d.agent_cash_cents), `owed to Sterncut by ${d.shops_owing} shop${d.shops_owing === 1 ? '' : 's'}`)}
      ${kpi('UNRECONCILED', d.unreconciled_cents ? signed(d.unreconciled_cents) : '0 DH', gaps.length ? `${gaps.length} shop${gaps.length === 1 ? '' : 's'} · needs a call` : 'every drawer adds up', d.unreconciled_cents ? '#F87171' : '')}</div>
    <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:3 1 520px;min-width:0;background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
        <div style="padding:13px 16px;display:flex;align-items:baseline;gap:10px"><span style="font-size:13px;font-weight:700">Agent float by shop</span><span style="font-size:11px;color:#6B6B72">${d.last_settlement ? `since last settlement · ${esc(dayShort(d.last_settlement))}` : ''}</span></div>
        <div style="display:grid;grid-template-columns:1.6fr 80px 110px 100px 130px;gap:12px;padding:9px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:560px"><span>SHOP</span><span>TOP-UPS</span><span>CASH HELD</span><span>DELTA</span><span>STATE</span></div>
        <div style="min-width:560px">${d.shops.map(row).join('') || '<div style="padding:20px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No shop is holding cash.</div>'}</div></div>
      <div style="flex:2 1 300px;min-width:0;display:flex;flex-direction:column;gap:14px">
        ${g ? `<div style="background:#17171A;border:1px solid rgba(248,113,113,.35);border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;align-items:center;gap:8px"><span style="font-size:13px;font-weight:700;color:#F87171">Float mismatch</span><span style="flex:1"></span><span style="font-size:10.5px;color:#6B6B72">${g.last_topup ? `last top-up ${esc(ago(g.last_topup))} ago` : ''}</span></div>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">${esc(g.name)} logged ${g.topups} top-up${g.topups === 1 ? '' : 's'}, and the drawer doesn’t agree with them by ${DH(Math.abs(g.gap_cents))}.</span>
          <div style="display:flex;gap:10px"><div style="flex:1;background:#111113;border-radius:10px;padding:9px 11px"><span style="display:block;font-size:9px;letter-spacing:.12em;font-weight:700;color:#6B6B72">CASH HELD</span><span class="num" style="font-size:14px;font-weight:700">${DH(g.float_cents)}</span></div>
            <div style="flex:1;background:#111113;border-radius:10px;padding:9px 11px"><span style="display:block;font-size:9px;letter-spacing:.12em;font-weight:700;color:#6B6B72">GAP</span><span class="num" style="font-size:14px;font-weight:700;color:#F87171">${signed(g.gap_cents)}</span></div></div>
          <a href="/salons/${esc(slug[g.id] || '')}" style="align-self:flex-start;font-size:10px;font-weight:800;letter-spacing:.06em;background:#E8442E;border-radius:7px;padding:8px 11px;color:#fff">OPEN THE SHOP</a>
          ${gaps.length > 1 ? `<span style="font-size:10.5px;color:#6B6B72">and ${gaps.length - 1} more in the table</span>` : ''}</div>` : ''}
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:10px">
          ${label9('RECENT LEDGER')}
          ${d.ledger.slice(0, 12).map((l) => `<div style="display:flex;gap:10px;align-items:center"><span style="flex:1;min-width:0"><span style="display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(LEDGER[l.kind] || l.kind.replace(/_/g, ' '))} · ${esc(l.ref || l.who)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:1px">${esc(l.where)} · ${esc(dayShort(l.at))} ${hhmm(l.at)}</span></span><span class="num" style="font-size:12px;font-weight:700;color:${l.amount_cents > 0 ? '#4ADE80' : '#fff'}">${signed(l.amount_cents)}</span></div>`).join('') || '<span style="font-size:12px;color:#6B6B72">Nothing yet.</span>'}</div>
      </div></div>`);
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#wl-csv').onclick = () => csv('ledger', [['When', (l) => l.at], ['Kind', (l) => LEDGER[l.kind] || l.kind], ['Who', (l) => l.who], ['Where', (l) => l.where], ['Ref', (l) => l.ref || ''], ['DH', (l) => l.amount_cents / 100]], d.ledger);
    },
  };
}

// ---- AGT-08 · the duty desk ------------------------------------------------------------
async function witnessed({ rpc, act, q, go, toast, dialog }) {
  const queue = await rpc('admin_duty_queue') || [];
  const html = page(pageHead('Witnessed handovers', 'The owner still vouches — ops is the witness'), TABS('witnessed', queue.length),
    `${queue.length ? `<div style="background:#17171A;border:1px solid rgba(232,68,46,.4);border-radius:14px;overflow:hidden">
      <div style="padding:11px 16px;background:rgba(232,68,46,.09);font-size:12.5px;font-weight:700;color:#E8442E">${queue.length} agent${queue.length === 1 ? ' is' : 's are'} standing in a shop waiting for you</div>
      ${queue.map((r) => `<a href="/wallets/witnessed?visit=${r.visit}" class="hov" style="display:flex;align-items:center;gap:14px;padding:13px 16px;border-top:1px solid #1E1E22;color:#fff">
        <span style="width:200px;flex:none;min-width:0"><span style="display:block;font-size:12.5px;font-weight:700">${esc(r.salon)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">${esc(r.agent)}</span></span>
        <span class="num" style="width:100px;flex:none;text-align:right;font-size:13px;font-weight:800">${DH(r.cents)}</span>
        <span style="flex:1;min-width:0;font-size:11.5px;color:#9A9CA3">${esc(r.why)}</span>
        <span class="num" style="font-size:11px;color:${r.waiting_min > 10 ? '#E8A100' : '#6B6B72'}">waiting ${r.waiting_min} min</span></a>`).join('')}</div>`
      : '<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:22px 18px;font-size:12.5px;color:#6B6B72">Nobody is waiting on the duty desk.</div>'}
    <div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 15px;font-size:11.5px;color:#9A9CA3;line-height:1.6;max-width:760px"><b style="color:#fff">Ops does not authorise the agent — ops reaches the owner.</b> The owner’s figure is taken first and the agent’s second; the server refuses them the other way round. If they match, six digits are issued for that amount and that visit only, good for ten minutes, read aloud. If they don’t, nothing is issued.</div>`);
  return {
    top: false, html,
    async ready() {
      const visit = q.get('visit');
      if (!visit) return;
      let p;
      try { p = await act('admin_ops_call_open', { p_visit: visit }, { title: 'Open a duty call' }); }
      catch (e) { if (!e.handled) toast(e.message, false); return go('/wallets/witnessed', { replace: true }); }
      const st = { stage: 1, reached: null, issued: null, discrepancy: null };
      const bag = p.bag || {}, qu = p.queue || {}, ra = p.rates || {};
      const dl = dialog('<div id="dc" style="padding:22px;display:flex;flex-direction:column;gap:12px"></div>', { onClose: () => go('/wallets/witnessed'), width: 620 });
      const step = (n, title, body, inner) => {
        const on = st.stage === n, done = st.stage > n;
        return `<div style="display:flex;gap:12px;padding:12px 0;${n < 4 ? 'border-bottom:1px solid #1E1E22;' : ''}opacity:${on || done ? 1 : 0.4}">
          <span style="width:22px;height:22px;flex:none;border-radius:999px;background:${done ? '#4ADE80' : on ? '#E8442E' : '#212125'};color:${done ? '#0D0D0F' : '#fff'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${done ? '✓' : n}</span>
          <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${title}</span><span style="display:block;font-size:11px;line-height:1.5;color:#9A9CA3;margin-top:3px">${body}</span>${on && inner ? `<div style="margin-top:10px;display:flex;gap:9px;align-items:center;flex-wrap:wrap">${inner}</div>` : ''}</span></div>`;
      };
      const amount = (id) => `<input id="${id}" inputmode="numeric" placeholder="DH" style="width:120px;height:38px;border-radius:9px;background:#111113;border:1px solid #26262B;color:#fff;padding:0 12px;font-size:14px;outline:none">`;
      const draw = () => {
        dl.querySelector('#dc').innerHTML = `
          <div style="display:flex;align-items:flex-start;gap:10px"><span style="flex:1"><span style="display:block;font-size:17px;font-weight:800">Ring ${esc(p.owner)}</span><span style="display:block;font-size:11.5px;color:#9A9CA3;margin-top:4px">${esc(p.ref)} · ${esc(p.salon)} · ${DH(p.cents)} · week ${esc(String(p.week).slice(-2))}</span></span><span data-dlg-close="1" style="cursor:pointer;color:#6B6B72;font-size:18px">×</span></div>
          <div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:4px 14px">${[['Agent', esc(p.agent)], ['Where their phone says they are', p.km_from_shop == null ? 'not known' : `${p.km_from_shop} km from the shop`],
            ['Carrying', `${DH(bag.in_bag_cents || 0)} of ${DH(bag.cap_cents || 0)}`], ['Unchecked in their queue', `${qu.n || 0}${qu.n ? ` · ${DH(qu.cents)}` : ''}`], ['Asked for the desk', `${ra.calls || 0} in 30 days · team ${ra.team_calls ?? 0}`]]
            .map(([k, v], i) => `<div style="display:flex;padding:8px 0;${i < 4 ? 'border-bottom:1px solid #1E1E22' : ''}"><span style="flex:1;font-size:11.5px;color:#9A9CA3">${k}</span><span class="num" style="font-size:11.5px;font-weight:600">${v}</span></div>`).join('')}</div>
          <div>${step(1, 'Tell the agent to stay in the shop', 'And <b style="color:#D8D8DC">not to say the amount yet</b>. You are going to ask the owner first.', btnP('THEY ARE STAYING PUT', 'data-s="1"'))}
          ${step(2, `Ring ${esc(p.owner)} on the number we have`, `Never a number the agent reads out. ${p.owner_phone ? `<b style="color:#fff">${esc(p.owner_phone)}</b> <a href="tel:${esc(p.owner_phone)}" style="font-weight:700">call</a>` : '<span style="color:#F87171">We have no number on file for them.</span>'}`,
            `${btnS('THEY ANSWERED', 'data-s="reached"')}${btnS('NO ANSWER', 'data-s="noreach"')}`)}
          ${step(3, st.reached === false ? 'No figure of theirs to take' : 'Ask the owner the amount, first',
            st.reached === false ? 'The agent is now the only voucher. This still issues, and it is visibly thinner on their statement — they get three days to say otherwise.' : 'How much did you hand over? Not <em>was it X?</em> — type what they say.',
            st.reached === false ? '' : `${amount('dc-owner')}${btnP('THAT IS WHAT THEY SAID', 'data-s="3"')}`)}
          ${step(4, 'Now ask the agent', 'And type what they say. If the two don’t match, nothing is issued.', `${amount('dc-agent')}${btnP('CHECK AND ISSUE', 'data-s="4"')}`)}</div>
          ${st.issued ? `<div style="background:rgba(74,222,128,.09);border:1px solid rgba(74,222,128,.4);border-radius:14px;padding:17px;text-align:center"><span style="display:block;font-size:9.5px;letter-spacing:.14em;font-weight:700;color:#4ADE80">READ THESE SIX DIGITS TO THE AGENT</span>
            <span class="num" style="display:block;font-size:34px;font-weight:800;letter-spacing:.14em;margin:9px 0">${esc(st.issued.auth_code)}</span>
            <span style="display:block;font-size:11px;color:#9A9CA3;line-height:1.5">Aloud, on the call. Don’t send them. Good for ten minutes, until ${hhmm(st.issued.expires_at)}, and only for ${DH(st.issued.cents)} at this shop.${st.issued.owner_reached ? '' : ' The owner wasn’t reached, so the receipt says so.'}</span></div>` : ''}
          ${st.discrepancy ? `<div style="background:rgba(248,113,113,.09);border:1px solid rgba(248,113,113,.4);border-radius:14px;padding:17px"><span style="display:block;font-size:12.5px;font-weight:700;color:#F87171">Two different amounts — nothing issued</span><span style="display:block;font-size:11.5px;color:#9A9CA3;line-height:1.5;margin-top:5px">The owner said ${DH(st.discrepancy.owner_cents)} and the agent said ${DH(st.discrepancy.agent_cents)}. No cash can be recorded on this visit until a person settles it. The agent should not leave with it.</span></div>` : ''}
          ${errBox}`;
      };
      dl.addEventListener('click', async (e) => {
        const s = e.target.closest('[data-s]')?.dataset.s;
        if (!s) return;
        dl.querySelector('.dlg-err').style.display = 'none';
        try {
          if (s === '1') st.stage = 2;
          if (s === 'reached') { st.reached = true; st.stage = 3; }
          if (s === 'noreach') { await act('admin_ops_call_owner_amount', { p_call: p.call, p_cents: null, p_reached: false }, { title: `Owner not reached · ${p.ref}` }); st.reached = false; st.stage = 4; }
          if (s === '3') {
            const c = cents(dl.querySelector('#dc-owner').value);
            if (!(c > 0)) throw new Error('Type what the owner said.');
            await act('admin_ops_call_owner_amount', { p_call: p.call, p_cents: c, p_reached: true }, { title: `Owner’s figure · ${p.ref}` }); st.stage = 4;
          }
          if (s === '4') {
            const c = cents(dl.querySelector('#dc-agent').value);
            if (!(c > 0)) throw new Error('Type what the agent said.');
            const r = await act('admin_ops_call_agent_amount', { p_call: p.call, p_cents: c }, { title: `Agent’s figure · ${p.ref}` });
            st.stage = 5;
            if (r.issued) st.issued = r; else st.discrepancy = r;
            toast(r.issued ? 'Six digits issued' : 'They don’t match · nothing issued', !!r.issued);
          }
          draw();
        } catch (err) { showErr(dl, err); }
      });
      draw();
    },
  };
}

// ---- AGT-12 · a rate per agent ------------------------------------------------------
const ACTIONS = [['ring_owners', 'Ring the owners yourself', 'About five minutes each. Ask them how the visits went.'],
  ['morning_window', 'Move their late shops to a morning window', 'Usually the answer. A round that can’t be closed at 19:30 is a routing fault before it is an agent fault.'],
  ['ride_along', 'Send someone out with them for a day', 'Logged, so it is on the record that it happened.']];
async function agents({ rpc, act, q, go, toast, dialog, closeDialog }) {
  const days = q.get('days') === '30' ? 30 : 90;
  const rows = await rpc('admin_ops_call_audit', { p_days: days }) || [];
  const calls = rows.reduce((n, a) => n + a.calls, 0), cols = rows.reduce((n, a) => n + a.collections, 0);
  const nr = rows.reduce((n, a) => n + a.not_reached, 0), disp = rows.reduce((n, a) => n + a.disputes, 0);
  const flagged = rows.filter((a) => a.over_7d || a.over_30d);
  const spark = (xs) => { const m = Math.max(1, ...xs); return `<span style="display:inline-flex;align-items:flex-end;gap:2px;height:18px">${xs.map((n) => `<span style="width:4px;border-radius:1px;background:${n ? '#E8A100' : '#26262B'};height:${Math.max(2, Math.round(n / m * 18))}px"></span>`).join('')}</span>`; };
  const row = (a) => { const over = a.over_7d || a.over_30d; return `<a ${a.calls ? `href="/wallets/agents?agent=${a.agent}${days === 30 ? '&days=30' : ''}"` : ''} class="${a.calls ? 'hov' : ''}" style="display:grid;grid-template-columns:1.3fr 100px 70px 80px 90px 2fr;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;color:#fff;${a.calls ? '' : 'opacity:.55'}">
    <span style="display:flex;align-items:center;gap:10px;min-width:0"><span style="width:28px;height:28px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(a.name))}</span><span style="min-width:0"><span style="display:block;font-size:12px;font-weight:700">${esc(a.name)}</span>${over ? `<span style="display:block;font-size:9.5px;font-weight:800;color:#E8A100;margin-top:2px">${a.over_7d ? '3+ IN 7 DAYS' : '4+ NOT REACHED'} · REVIEW OPEN</span>` : ''}</span></span>
    <span class="num" style="font-size:11.5px;color:#9A9CA3">${a.calls} of ${a.collections}</span>
    <span class="num" style="font-size:12.5px;font-weight:700;color:${over ? '#E8A100' : a.calls ? '#fff' : '#3A3A40'}">${a.pct}%</span>
    <span class="num" style="font-size:11.5px;color:#6B6B72">${a.vs_fleet == null ? '—' : a.vs_fleet + '× the fleet'}</span>
    <span>${spark(a.spark || [])}</span>
    <span style="font-size:10.5px;color:#6B6B72">${a.calls ? [`${a.shops} shop${a.shops === 1 ? '' : 's'}`, a.late ? `${a.late} after 18:00` : null, a.not_reached ? `owner not reached ${a.not_reached} of ${a.calls}` : null, a.disputes ? `${a.disputes} discrepanc${a.disputes === 1 ? 'y' : 'ies'}` : null].filter(Boolean).join(' · ') : 'never needed it'}</span></a>`; };
  const html = page(pageHead('Collections proved without the owner’s code', `Last ${days} days${flagged.length ? ` · ${flagged.length} over a threshold` : ' · nobody over a threshold'}`,
      btnS(days === 90 ? 'Last 30 days' : 'Last 90 days', `data-go="/wallets/agents${days === 90 ? '?days=30' : ''}"`)), TABS('agents'),
    `    <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('OPS-CALL RECEIPTS', calls, cols ? `${(calls * 100 / cols).toFixed(1)}% of ${cols} collections` : 'no collections yet')}
      ${kpi('AGENTS INVOLVED', `${rows.filter((a) => a.calls).length} of ${rows.length}`, 'who needed the desk at least once')}
      ${kpi('OWNER NOT REACHED', `${nr} of ${calls}`, 'on an agent’s word alone', nr ? '#E8A100' : '')}${kpi('DISCREPANCIES', disp, 'two figures that didn’t match')}</div>
    <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
      <div style="display:grid;grid-template-columns:1.3fr 100px 70px 80px 90px 2fr;gap:12px;padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:760px"><span>AGENT</span><span>OPS CALLS</span><span>RATE</span><span>VS FLEET</span><span>12 WEEKS</span><span>SHAPE OF IT</span></div>
      <div style="min-width:760px">${rows.map(row).join('') || '<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No agents yet.</div>'}</div></div>
    <div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 15px;font-size:11.5px;color:#9A9CA3;line-height:1.6;max-width:760px"><b style="color:#fff">The threshold, written down.</b> 3 ops-call collections from one agent in 7 rolling days, or 4 “owner not reached” in 30, opens a review by itself. Below that, nobody is watched and no agent is asked to explain anything. Agents with none are listed on purpose — it is possible to work a round without ever needing the desk.</div>`);
  return {
    top: false, html,
    ready() {
      const a = rows.find((x) => x.agent === q.get('agent'));
      if (!a || !a.calls) return;
      let pick = null;
      const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:12px">
        <span style="font-size:17px;font-weight:800">${esc(a.name)} · ${a.calls} of ${a.collections} (${a.pct}%)</span>
        <span style="font-size:11.5px;color:#9A9CA3;line-height:1.55">${[`${a.shops} shop${a.shops === 1 ? '' : 's'}`, a.late ? `${a.late} after 18:00` : null, a.not_reached ? `owner not reached ${a.not_reached} times` : null].filter(Boolean).join(' · ')}. The data can’t tell a hard round from a habit. A person can.</span>
        <div id="ag-list" style="display:flex;flex-direction:column;gap:7px">${ACTIONS.map(([k, t, s]) => `<span data-act="${k}" style="display:flex;gap:12px;background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 13px;cursor:pointer"><span class="dot" style="width:16px;height:16px;border-radius:999px;border:1.5px solid #3A3A40;flex:none;margin-top:1px"></span><span><span style="display:block;font-size:12.5px;font-weight:600">${t}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px;line-height:1.45">${s}</span></span></span>`).join('')}
          <span style="display:flex;gap:12px;border:1px dashed #26262B;border-radius:11px;padding:11px 13px;opacity:.55"><span style="width:16px;flex:none"></span><span style="font-size:11.5px;color:#9A9CA3">Suspending needs a second approver, and there is no second approver yet.</span></span></div>
        <textarea id="ag-note" rows="2" placeholder="A line for the record (optional)" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:10px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
        ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('DO IT', 'id="ag-go"')}</div></div>`, { onClose: () => go(`/wallets/agents${days === 30 ? '?days=30' : ''}`), width: 500 });
      dl.querySelector('#ag-list').onclick = (e) => {
        const r = e.target.closest('[data-act]'); if (!r) return;
        pick = r.dataset.act;
        dl.querySelectorAll('[data-act]').forEach((x) => { const on = x === r; x.style.borderColor = on ? '#E8442E' : '#26262B'; x.querySelector('.dot').style.background = on ? '#E8442E' : ''; });
      };
      dl.querySelector('#ag-go').onclick = async () => {
        if (!pick) return showErr(dl, new Error('Pick one.'));
        try {
          const r = await act('admin_ops_call_action', { p_agent: a.agent, p_action: pick, p_note: dl.querySelector('#ag-note').value.trim() || null }, { title: `${ACTIONS.find((x) => x[0] === pick)[1]} · ${a.name}` });
          closeDialog(); toast(pick === 'morning_window' ? (r.moved ? `${r.moved} visit${r.moved === 1 ? '' : 's'} moved to a morning window` : 'No late visits to move') : `Logged · ${first(a.name)}`);
        } catch (e) { showErr(dl, e); }
      };
    },
  };
}

// ---- AGT-20 · unchecked on the latest run ------------------------------------------
const RSTATE = (s) => (/INCIDENT|DIDN/.test(s) ? '#F87171' : /DUTY/.test(s) ? '#E8A100' : /PROVED/.test(s) ? '#4ADE80' : '#9A9CA3');
async function unchecked({ rpc }) {
  const run = await rpc('admin_run').catch(() => null);
  if (!run || !run.id) return { top: false, html: page(pageHead('Unchecked handovers', 'No run yet'), TABS('unchecked'), '<span style="font-size:12.5px;color:#6B6B72">Nothing has been cut yet, so nothing is waiting to be checked.</span>') };
  const pf = run.proof || {};
  // queued or failed is admin_run_proof's own test for "unchecked"; an incident stays until it clears
  const rows = run.lines.flatMap((l) => l.receipts.filter((r) => ['queued', 'failed'].includes(r.verification) || r.incident).map((r) => ({ ...r, salon: l.salon })))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const hours = (at) => Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 36e5));
  const html = page(pageHead(`Week ${esc(String(run.week).slice(-2))} settlement run`, run.released_at ? `Released ${esc(dayShort(run.released_at))} ${hhmm(run.released_at)}${run.released_by ? ` · ${esc(run.released_by)}` : ''}` : `${esc(run.state)} · not released`), TABS('unchecked'),
    `<div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('PROVED BY OWNER CODE', DH(pf.code_cents || 0), `${pf.code_n || 0} receipt${pf.code_n === 1 ? '' : 's'}`)}
      ${kpi('PROVED BY OPS CALL', DH(pf.call_cents || 0), `${pf.call_n || 0} receipt${pf.call_n === 1 ? '' : 's'} · audit`)}
      ${kpi('COLLECTED, UNCHECKED', DH(pf.unchecked_cents || 0), `${pf.unchecked_n || 0} receipt${pf.unchecked_n === 1 ? '' : 's'}${pf.failed_n ? ` · ${pf.failed_n} code didn’t match` : ''}`, pf.unchecked_cents ? '#F87171' : '')}</div>
    ${pf.unchecked_cents ? `<div style="background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.3);border-radius:12px;padding:13px 15px;font-size:12.5px;line-height:1.55">${run.released_at ? 'This week is released, and' : 'On this run,'} <b>${DH(pf.unchecked_cents)}</b> of it has not been checked against an owner’s code. <span style="color:#9A9CA3">The money is real and banked. What is outstanding is proof.</span></div>` : ''}
    <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
      <div style="display:grid;grid-template-columns:1.5fr 1fr 100px 110px 170px;gap:12px;padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:640px"><span>SHOP · RECEIPT</span><span>AGENT</span><span>AMOUNT</span><span>UNCHECKED FOR</span><span>STATE</span></div>
      <div style="min-width:640px">${rows.map((r) => `<div style="display:grid;grid-template-columns:1.5fr 1fr 100px 110px 170px;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;font-size:12px">
        <span><span style="display:block;font-weight:700">${esc(r.salon)}</span><span style="display:block;font-family:ui-monospace,Menlo,monospace;font-size:10px;color:#6B6B72;margin-top:2px">${esc(r.ref)}</span></span>
        <span style="color:#9A9CA3">${esc(r.by)}</span><span class="num" style="font-weight:700">${DH(r.cents)}</span><span class="num">${hours(r.at)} h</span>
        <span>${pill([`${r.state}${r.incident ? ` ${r.incident}` : ''}`, RSTATE(r.state)])}</span></div>`).join('') || '<div style="padding:20px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">Every receipt on this run is proved.</div>'}</div></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;max-width:900px">
      <div style="flex:1 1 380px;background:#111113;border:1px solid #26262B;border-radius:12px;padding:14px 15px;display:flex;flex-direction:column;gap:9px">
        ${label9('THE CLOCK, AND WHO HEARS ABOUT IT')}
        ${[['< 24 h', 'Nobody. The agent’s own tally only.'], ['24 h', 'The duty desk, once.'], ['72 h', 'An incident: the agent’s next round is blocked, and the owner is told we still can’t check it.'], ['any', 'A code that fails is an incident at once. It never waits in a queue.']]
          .map(([k, v]) => `<div style="display:flex;gap:12px;font-size:11.5px;line-height:1.5"><span class="num" style="width:48px;flex:none;font-weight:700">${k}</span><span style="color:#9A9CA3">${v}</span></div>`).join('')}
        <span style="font-size:10.5px;color:#6B6B72;line-height:1.5">Age runs from the collection, not from the first sync attempt — an agent who never opens the app can’t stop the clock.</span></div>
      <div style="flex:1 1 300px;font-size:11.5px;color:#9A9CA3;line-height:1.6;padding:4px 2px">A queued receipt can’t be marked verified by anyone here. Only the stored code meeting the real one does that — or an ops call replacing the proof outright.</div></div>`);
  return { top: false, html };
}
