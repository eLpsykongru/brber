// /finance — the settlement period and billing. Native since 2026-10-01; until then the run,
// statements, corrections and the float were the old console in a frame (its screens were
// already the FIN-14…19 canvases, so they are ported, not redrawn).
//   /finance, /finance/settlement/<2026-W39>        FIN-14/15 the run · ?release=1 · ?plan=1 · ?settle=<line>
//   /finance/statements/<2026-W39-001>               FIN-16 one shop's statement
//   /finance/corrections                             FIN-17 refunds that landed after their week was settled
//   /finance/float                                   FIN-19 cash in the shops, written off this month · ?writeoff=<id> · ?alert=1
//   /finance/float/transfers[/<TRF-…>[/write-off]]   FIN-18/18b drawer handovers that don't add up
//   /finance/charges                                 billing (0123/0124) · ?call=|?cash=|?waive=<invoice> · ?start=1
// Ops calls (/finance/calls) live under Wallets now: the duty desk and the audit.
// Billing had a backend and no screen anywhere, so Charges is new: FIN-12's "to collect" on
// the real invoices, the ladder they climb when nothing nets them, and the three things ops
// can do — log the call, record cash, write it off with a reason. Carrying is the default:
// an open invoice nets off the shop's next Friday statement by itself.
// Not as drawn: FIN-11's per-barber + per-cut model and free months aren't what 0123
// bills (one subscription per shop, netted weekly); FIN-01/02/03/13 have no backend.
import { esc, DH, num, first, initials, dayShort, dayWk, hhmm, ago, ZONE } from '/app.js';
import { pageHead, chips, label9, btnS, btnP, csv } from '/s/ui.js';

const RUNG = { open: ['OPEN', '#9A9CA3'], search_hidden: ['HIDDEN FROM SEARCH', '#E8A100'], bookings_closed: ['BOOKINGS CLOSED', '#F87171'] };
const pill = ([t, c]) => `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:3px 7px;white-space:nowrap">${esc(t)}</span>`;
const kpi = (l, v, s, col) => `<div style="flex:1 1 180px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:22px;font-weight:800${col ? ';color:' + col : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
const month = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: ZONE });
const input = 'background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none';
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };
const cents = (v) => Math.round(Number(String(v).replace(/\s/g, '').replace(',', '.')) * 100);
const when = (t) => (t ? `${dayWk(t)} ${hhmm(t)}` : '—');   // §7: 'Fri 4 Sep 21:04'
const wk = (w) => String(w || '').slice(-2);                 // '2026-W39' → '39'
const CASA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const casa = (t) => Object.fromEntries(CASA.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
// a run's label from its cut: settlement_week_label's arithmetic, the ISO week read in Casablanca
function weekOf(t) {
  const p = casa(t), d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = d.getUTCFullYear();
  return `${y}-W${String(Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)).padStart(2, '0')}`;
}
// 'HH:MM' today on the shop's clock → an instant. Visit windows are Tangier time, not the browser's.
function casaToday(hm) {
  const [h, m] = hm.split(':').map(Number), p = casa(Date.now());
  const guess = Date.UTC(+p.year, +p.month - 1, +p.day, h, m), s = casa(guess);
  return new Date(guess - (Date.UTC(+s.year, +s.month - 1, +s.day, +s.hour, +s.minute) - guess)).toISOString();
}
const TABS = (at) => chips([['Settlement run', '/finance', at === 'run'], ['Charges', '/finance/charges', at === 'charges'], ['Corrections', '/finance/corrections', at === 'corrections'],
  ['Cash in shops', '/finance/float', at === 'float'], ['Handovers', '/finance/float/transfers', at === 'handovers']]);
const page = (head, tabs, body) => `<div style="height:100%;display:flex;flex-direction:column">${head}${tabs}<div style="flex:1;overflow:auto;padding:18px 24px 32px">${body}</div></div>`;
const card = (inner) => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:11px">${inner}</div>`;
const note = (title, body) => `<div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 15px;display:flex;flex-direction:column;gap:6px"><span style="font-size:12px;font-weight:700">${title}</span><span style="font-size:11.5px;color:#9A9CA3;line-height:1.55">${body}</span></div>`;
const line = (l, v, col) => `<div style="display:flex;align-items:baseline;gap:12px"><span style="flex:1;font-size:12px;color:#9A9CA3">${l}</span><span class="num" style="font-size:12.5px;font-weight:700;color:${col || '#fff'}">${v}</span></div>`;
const bar = (pct, col) => `<div style="height:5px;border-radius:3px;background:#212125;margin-top:8px;overflow:hidden"><span style="display:block;height:5px;background:${col};width:${Math.max(0, Math.min(100, pct))}%"></span></div>`;
const sheet = (title, sub, fields, go_) => `<div style="padding:22px;display:flex;flex-direction:column;gap:13px"><span style="font-size:17px;font-weight:800">${title}</span>${sub ? `<span style="font-size:12px;color:#9A9CA3;line-height:1.55">${sub}</span>` : ''}${fields}${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${go_ ? btnP(go_, 'id="fn-go"') : ''}</div></div>`;

export default async function (ctx) {
  const [a, b, c, d] = ctx.seg;
  if (!a) return runPage(ctx, null);
  if (a === 'settlement' && b) return runPage(ctx, b);
  if (a === 'statements' && b) return statement(ctx, b);
  if (a === 'corrections') return corrections(ctx);
  if (a === 'charges') return charges(ctx);
  if (a === 'float' && !b) return float(ctx);
  if (a === 'float' && b === 'transfers') return handovers(ctx, c, d === 'write-off');
  if (a === 'calls') return ctx.go('/wallets/witnessed', { replace: true });     // the old console's paths
  if (a === 'handovers') return ctx.go('/finance/float/transfers', { replace: true });
  throw new Error('not_found');
}

async function charges({ rpc, rest, act, q, go, toast, dialog, closeDialog }) {
  const [rows, subs, live, ps] = await Promise.all([rpc('admin_subscription_ledger'), rest('subscriptions?select=salon_id'), rest('salons?select=id&status=eq.live'),
    rest('platform_settings?select=sub_monthly_cents&limit=1')]);
  const billed = new Set(subs.map((s) => s.salon_id));
  const unbilled = live.filter((s) => !billed.has(s.id)).length;
  const bal = rows.reduce((n, r) => n + r.balance_cents, 0);
  const calls = rows.filter((r) => r.needs_call), dry = rows.filter((r) => r.no_deposits);
  const row = (r) => `<div style="display:grid;grid-template-columns:1.5fr 120px 100px 100px 90px 150px 1.3fr;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;font-size:12px">
    <span><span style="display:block;font-weight:700">${esc(r.salon)}</span><span style="display:block;font-size:10.5px;color:${r.no_deposits ? '#E8A100' : '#6B6B72'};margin-top:2px">${r.no_deposits ? '0% deposit · nothing to net against' : `${esc({ month: 'Monthly', year: 'Yearly', year_extra: 'Chairs added to a year' }[r.kind] || r.kind)} · nets off Fridays`}</span></span>
    <span style="color:#9A9CA3">${esc(month(r.period_start))}</span>
    <span class="num">${DH(r.total_cents)}</span><span class="num" style="font-weight:700">${DH(r.balance_cents)}</span>
    <span class="num" style="color:${r.short_fridays >= 4 ? '#E8A100' : '#9A9CA3'}">${r.days} d · ${r.short_fridays} Fri</span>
    <span>${pill(RUNG[r.rung] || [String(r.rung).toUpperCase(), '#9A9CA3'])}</span>
    <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
      ${r.called_at ? `<span title="${esc(r.call_note || '')}" style="font-size:10px;color:#6B6B72;align-self:center">called ${esc(ago(r.called_at))} ago</span>` : `<a href="/finance/charges?call=${r.invoice}" style="font-size:9.5px;font-weight:800;letter-spacing:.06em;border-radius:7px;padding:6px 9px;${r.needs_call ? 'background:#E8442E;color:#fff' : 'background:#212125;color:#fff'}">LOG THE CALL</a>`}
      <a href="/finance/charges?cash=${r.invoice}" style="font-size:9.5px;font-weight:800;letter-spacing:.06em;background:#212125;border-radius:7px;padding:6px 9px;color:#fff">CASH</a>
      <a href="/finance/charges?waive=${r.invoice}" style="font-size:9.5px;font-weight:800;letter-spacing:.06em;border:1px solid #3A3A40;border-radius:7px;padding:5px 9px;color:#9A9CA3">WAIVE</a></span></div>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Charges', 'What Sterncut billed, and what is still open', `<span style="display:flex;gap:10px;align-items:center">${btnS('Export CSV', 'id="ch-csv"')}${btnP('Raise this month’s invoices', 'id="ch-run"')}</span>`)}
    ${TABS('charges')}
    <div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('OPEN INVOICES', rows.length, `${DH(bal)} still to reach us`)}
        ${kpi('NEEDS A CALL', calls.length, 'four short Fridays and nobody has rung', calls.length ? '#E8442E' : '')}
        ${kpi('NOTHING TO NET AGAINST', dry.length, 'shops taking 0% deposit', dry.length ? '#E8A100' : '')}
        ${kpi('NOT BILLED YET', unbilled, `live shop${unbilled === 1 ? '' : 's'} with no subscription`)}</div>
      ${unbilled ? `<div style="display:flex;align-items:center;gap:12px;background:#111113;border:1px solid #26262B;border-radius:12px;padding:12px 15px;font-size:12px;color:#9A9CA3;line-height:1.5;flex-wrap:wrap"><span style="flex:1;min-width:240px">${unbilled} live shop${unbilled === 1 ? ' isn’t' : 's aren’t'} on a subscription. Starting billing puts each on ${ps[0] ? DH(ps[0].sub_monthly_cents) : 'the standard price'} a chair a month from the first of a month; shops already billed are untouched.</span>${btnS('Start billing', 'data-go="/finance/charges?start=1"')}</div>` : ''}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
        <div style="display:grid;grid-template-columns:1.5fr 120px 100px 100px 90px 150px 1.3fr;gap:12px;padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:900px"><span>SHOP</span><span>FOR</span><span>INVOICED</span><span>STILL OPEN</span><span>AGE</span><span>WHERE IT IS</span><span></span></div>
        <div style="min-width:900px">${rows.map(row).join('') || '<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">Every invoice is paid. Each one netted off a Friday statement.</div>'}</div></div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;max-width:1000px">
        <div style="flex:1 1 360px;background:#111113;border:1px solid #26262B;border-radius:12px;padding:14px 15px;display:flex;flex-direction:column;gap:8px">
          ${label9('HOW IT REACHES US')}
          <span style="font-size:11.5px;color:#9A9CA3;line-height:1.6">Sterncut deducts the subscription from deposits it already holds for the shop, on the Friday statement — nothing is charged to a card and no shop hands over cash for it. That only works while a shop takes deposits; a 0% shop has nothing to net against.</span></div>
        <div style="flex:1 1 360px;background:#111113;border:1px solid #26262B;border-radius:12px;padding:14px 15px;display:flex;flex-direction:column;gap:8px">
          ${label9('WHEN NOTHING NETS IT')}
          ${[['Day 0', 'Open. It waits for a Friday with deposits — carrying is the default.'], ['4 Fridays', 'Needs a call. Somebody rings the owner and writes down what was said.'], ['Day 14', 'Hidden from search, once the call is logged.'], ['Day 30', 'New appointments closed. Bookings already made are kept; walk-ins still join the queue.'], ['Paid', 'Everything reverses the moment the balance is 0.']]
            .map(([k, v]) => `<div style="display:flex;gap:12px;font-size:11.5px;line-height:1.5"><span class="num" style="width:70px;flex:none;font-weight:700">${k}</span><span style="color:#9A9CA3">${v}</span></div>`).join('')}</div></div>
    </div></div>`;
  const back = () => go('/finance/charges');
  const inv = (id) => rows.find((r) => r.invoice === id);
  const form = (title, sub, fields, go_) => `<div style="padding:22px;display:flex;flex-direction:column;gap:13px"><span style="font-size:17px;font-weight:800">${title}</span><span style="font-size:12px;color:#9A9CA3;line-height:1.55">${sub}</span>${fields}${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP(go_, 'id="ch-go"')}</div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#ch-csv').onclick = () => csv('charges-open', [['Shop', (r) => r.salon], ['For', (r) => r.period_start], ['Invoiced DH', (r) => r.total_cents / 100], ['Open DH', (r) => r.balance_cents / 100], ['Days', (r) => r.days], ['Short Fridays', (r) => r.short_fridays], ['Rung', (r) => r.rung], ['No deposits', (r) => (r.no_deposits ? 'yes' : '')], ['Called', (r) => r.called_at || '']], rows);
      root.querySelector('#ch-run').onclick = async () => {
        if (!confirm('Raise this month’s invoices for every shop on a subscription? A shop already invoiced for the month is skipped.')) return;
        try { const n = await act('admin_run_billing', {}, { title: 'Raise this month’s invoices' }); toast(`${n} invoice${n === 1 ? '' : 's'} raised`); go('/finance/charges', { replace: true }); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      };
      const r = inv(q.get('call') || q.get('cash') || q.get('waive'));
      if (q.get('call') && r) {
        const dl = dialog(form(`Log the call to ${esc(r.salon)}`, `${DH(r.balance_cents)} open for ${esc(month(r.period_start))}, ${r.short_fridays} Friday${r.short_fridays === 1 ? '' : 's'} without enough to net it. Write down what was said — it goes on the invoice.${r.days >= 30 ? ` <b style="color:#F87171">It is day ${r.days}: logging this closes new appointments at ${esc(r.salon)} straight away.</b>` : r.days >= 14 ? ` <b style="color:#E8A100">It is day ${r.days}: logging this hides ${esc(r.salon)} from search straight away, and new appointments close on day 30.</b>` : ` Once it is logged, the shop is hidden from search on day 14 and new appointments close on day 30 if it is still open.`}`,
          `<textarea id="ch-note" rows="3" placeholder="What the owner said" style="${input};resize:vertical"></textarea>`, 'LOG IT'), { onClose: back, width: 460 });
        dl.querySelector('#ch-go').onclick = async () => {
          const note = dl.querySelector('#ch-note').value.trim();
          if (!note) return showErr(dl, new Error('Write down what was said on the call.'));
          try { await act('admin_log_billing_call', { p_invoice: r.invoice, p_note: note }, { title: `Log the billing call · ${r.salon}`, reason: note }); closeDialog(); toast('Call logged'); }
          catch (e) { showErr(dl, e); }
        };
      }
      if (q.get('cash') && r) {
        const dl = dialog(form(`Record cash from ${esc(r.salon)}`, `Up to ${DH(r.balance_cents)} is open. Cash taken on a visit comes off the invoice; the rest keeps netting off Fridays.`,
          `<label style="display:flex;flex-direction:column;gap:6px">${label9('AMOUNT · DH', '#6B6B72')}<input id="ch-dh" inputmode="numeric" value="${Math.round(r.balance_cents / 100)}" style="height:42px;${input};font-size:14px"></label>
           <textarea id="ch-note" rows="2" placeholder="Who took it, where (optional)" style="${input};resize:vertical"></textarea>`, 'RECORD IT'), { onClose: back, width: 460 });
        dl.querySelector('#ch-go').onclick = async () => {
          const c = Math.round(Number(dl.querySelector('#ch-dh').value.replace(',', '.')) * 100);
          if (!(c > 0)) return showErr(dl, new Error('Say how much.'));
          try { const x = await act('admin_record_subscription_cash', { p_invoice: r.invoice, p_cents: c, p_note: dl.querySelector('#ch-note').value.trim() || null }, { title: `Record ${DH(c)} cash · ${r.salon}` }); closeDialog(); toast(x?.balance_cents > 0 ? `${DH(c)} recorded · ${DH(x.balance_cents)} still open` : `${r.salon} is paid`); }
          catch (e) { showErr(dl, e); }
        };
      }
      if (q.get('waive') && r) {
        const dl = dialog(form(`Waive ${DH(r.balance_cents)} for ${esc(r.salon)}`, `The invoice closes without being paid and the shop comes off the ladder. Under 100 DH, chasing usually costs more than it brings in. The reason goes on the record.`,
          `<textarea id="ch-note" rows="3" placeholder="Why waive it" style="${input};resize:vertical"></textarea>`, 'WAIVE IT'), { onClose: back, width: 460 });
        dl.querySelector('#ch-go').onclick = async () => {
          const note = dl.querySelector('#ch-note').value.trim();
          if (!note) return showErr(dl, new Error('A write-off needs a reason.'));
          try { await act('admin_write_off_invoice', { p_invoice: r.invoice, p_note: note }, { title: `Waive ${DH(r.balance_cents)} · ${r.salon}`, reason: note }); closeDialog(); toast('Waived'); }
          catch (e) { showErr(dl, e); }
        };
      }
      if (q.get('start') && unbilled) {
        const next = new Date(); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + 1);
        const dl = dialog(form('Start billing', `${unbilled} live shop${unbilled === 1 ? '' : 's'} with no subscription go on ${ps[0] ? DH(ps[0].sub_monthly_cents) : 'the standard price'} a chair a month. It always starts on the first of a month; any other date moves to the next first.`,
          `<label style="display:flex;flex-direction:column;gap:6px">${label9('FROM', '#6B6B72')}<input id="ch-from" type="date" value="${next.toISOString().slice(0, 10)}" style="height:42px;${input}"></label>`, 'START BILLING'), { onClose: back, width: 460 });
        dl.querySelector('#ch-go').onclick = async () => {
          const from = dl.querySelector('#ch-from').value || null;
          try { const n = await act('admin_start_billing', { p_salon: null, p_from: from }, { title: `Start billing ${unbilled} shop${unbilled === 1 ? '' : 's'}` }); closeDialog(); toast(`${n} shop${n === 1 ? '' : 's'} on a subscription from ${from ? dayShort(from) : 'next month'}`); }
          catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}

// ---------------------------------------------------------------- FIN-14/15 · the run --
// The header equals the sum of the lines, and a run whose statement disagrees with its own
// items refuses to release and names the shop. Released, the three totals become progress.
const DIR = { collect: ['Collect', '#E8442E'], pay_out: ['Pay out', '#4ADE80'], nil: ['No visit', '#6B6B72'] };
const VISIT = { pending: 'Not yet visited', collected: 'Collected', part: 'Part paid', paid: 'Handed over', open: 'Open' };
const settled = (l) => l.direction === 'nil' || l.visit === 'collected' || l.visit === 'paid';
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

async function runPage({ rpc, rest, act, q, go, toast, dialog, closeDialog }, week) {
  const runs = (await rest('settlement_runs?select=id,covers_to,state&order=covers_to.desc&limit=12')).map((r) => ({ ...r, week: weekOf(r.covers_to) }));
  const pick = week ? runs.find((r) => r.week === week) : null;
  if (week && !pick) throw new Error('not_found');
  const d = runs.length ? await rpc('admin_run', { p_run: pick ? pick.id : null }) : null;
  const latest = !d || d.id === runs[0].id;
  const draft = d?.state === 'draft';
  const [prog, open] = await Promise.all([d && !draft ? rpc('admin_run_progress', { p_run: d.id }) : null, latest ? rpc('admin_open_lines').catch(() => []) : []]);
  const base = latest ? '/finance' : `/finance/settlement/${d.week}`;
  const needs = d ? d.lines.filter((l) => !settled(l) && !l.on_round).length : 0;
  const right = !latest ? btnS('Back to the latest week', 'data-go="/finance"') : `<span style="display:flex;gap:10px;align-items:center">${draft
    ? btnP(`RELEASE ${plural(d.shops, 'STATEMENT', 'STATEMENTS')}`, 'data-go="/finance?release=1"')
    : `${btnS('CUT THIS WEEK', 'id="fn-cut"')}${d ? (needs ? btnP(`PLAN ${plural(needs, 'VISIT', 'VISITS')}`, 'data-go="/finance?plan=1"')
      : '<span style="height:32px;border-radius:9px;background:#212125;display:flex;align-items:center;padding:0 14px;font-size:12px;font-weight:700;color:#6B6B72">ROUND IS PLANNED</span>') : ''}`}</span>`;
  const head = pageHead(d ? `Settlement run · week ${wk(d.week)}` : 'Settlement run',
    !d ? 'No week has been cut yet' : draft ? `Draft · covers ${when(d.covers_from)} → ${when(d.covers_to)}` : `Released ${when(d.released_at)}${d.released_by ? ` by ${d.released_by}` : ''}`, right);
  if (!d) {
    return { top: false, html: page(head, TABS('run'), '<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:26px;font-size:12.5px;color:#9A9CA3;line-height:1.6;max-width:640px">Cut this week to build the draft. Every live shop gets a line, including the ones where nothing moved — a nil week is a fact, not a gap.</div>'), ready: (root) => bindCut(root, act, go, toast) };
  }

  const weeks = runs.length > 1 ? `<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;font-size:11px;color:#6B6B72"><span style="margin-right:6px">Weeks</span>${runs.slice(0, 8).map((r, i) => `<a href="${i ? `/finance/settlement/${r.week}` : '/finance'}" style="height:24px;border-radius:7px;padding:0 9px;display:inline-flex;align-items:center;font-weight:700;${r.id === d.id ? 'background:#212125;color:#fff' : 'color:#9A9CA3'}">W${wk(r.week)}${r.state === 'draft' ? ' · draft' : ''}</a>`).join('')}</div>` : '';
  const stat = (l, v, foot, col) => `<div style="flex:1 1 200px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9.5px;letter-spacing:.13em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:22px;font-weight:800;color:${col}">${v}</span><div style="font-size:10.5px;color:#9A9CA3">${foot}</div></div>`;
  const p = prog || {}, pct = (a, b) => (b ? Math.round(a * 100 / b) : 0);
  const stats = draft
    ? stat('IN THE RUN', plural(d.shops, 'shop', 'shops'), d.exclusions.length ? `<span style="color:#E8A100">${d.exclusions.length} excluded · named beside</span>` : 'every live shop has a line', '#fff')
      + stat('TO COLLECT · THE AGENT TAKES CASH OUT', DH(d.collect_cents), `from ${plural(d.collect_shops, 'shop', 'shops')}`, '#E8442E')
      + stat('TO PAY OUT · THE AGENT HANDS CASH OVER', DH(d.pay_cents), `to ${plural(d.pay_shops, 'shop', 'shops')}`, '#4ADE80')
    : stat('COLLECTED', DH(p.collected_cents), `of ${DH(p.collect_cents)} · ${p.collect_done} of ${plural(p.collect_shops, 'visit', 'visits')}${bar(pct(p.collected_cents, p.collect_cents), '#4ADE80')}`, '#4ADE80')
      + stat('PAID OUT', DH(p.paid_cents), `${p.pay_done === p.pay_shops && p.pay_shops ? 'all ' : ''}${p.pay_done} of ${plural(p.pay_shops, 'shop', 'shops')}${bar(pct(p.paid_cents, p.pay_cents), '#4ADE80')}`, '#4ADE80')
      // amber, because it is our cash in someone else's till, not a balance
      + stat('STILL WITH THE SHOPS', DH(p.open_cents), `${plural(p.open_shops, 'shop', 'shops')}${p.oldest_days != null ? ` · oldest dirham day ${p.oldest_days} of 14` : ''}${bar(pct(p.open_cents, p.collect_cents), '#E8A100')}`, '#E8A100');
  const net = d.collect_cents - d.pay_cents;
  const netCard = `<div style="background:#141416;border:1px solid #1E1E22;border-radius:12px;padding:13px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="font-size:12px;font-weight:700">Net across the city this week</span><span class="num" style="font-size:15px;font-weight:800;color:${net >= 0 ? '#E8442E' : '#4ADE80'}">${DH(Math.abs(net))} ${net >= 0 ? 'in' : 'out'}</span><span style="flex:1"></span><span style="font-size:10.5px;color:#6B6B72;line-height:1.45;max-width:340px">What the shops hold of ours, less the deposits they earned. One number per shop, and it can point either way.</span></div>`;
  // AGT-20: three siblings, so nobody reconciles a week believing it is finished
  const pf = d.proof || {};
  const proof = `<div style="display:flex;gap:12px;flex-wrap:wrap">${[['PROVED BY OWNER CODE', pf.code_cents, pf.code_n, '#4ADE80', ''], ['PROVED BY OPS CALL', pf.call_cents, pf.call_n, '#E8A100', 'six digits, a duty officer'],
    ['COLLECTED, UNCHECKED', pf.unchecked_cents, pf.unchecked_n, '#F87171', [pf.incident_n ? plural(pf.incident_n, 'incident', 'incidents') : '', pf.failed_n ? `${pf.failed_n} didn’t match` : '', pf.queued_n ? `${pf.queued_n} still queued` : ''].filter(Boolean).join(' · ')]]
    .map(([l, c, n, col, foot]) => `<${l === 'COLLECTED, UNCHECKED' && c && latest ? 'a href="/wallets/unchecked"' : 'div'} style="flex:1 1 180px;background:#17171A;border:1px solid ${l === 'COLLECTED, UNCHECKED' && c ? 'rgba(248,113,113,.4)' : '#1E1E22'};border-radius:14px;padding:14px 15px;display:flex;flex-direction:column;gap:4px;color:#fff"><span style="font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:18px;font-weight:800;color:${c ? col : '#3A3A40'}">${DH(c || 0)}</span><span style="font-size:10px;color:#6B6B72">${plural(n || 0, 'receipt', 'receipts')}${foot ? ` · ${foot}` : ''}</span></${l === 'COLLECTED, UNCHECKED' && c && latest ? 'a' : 'div'}>`).join('')}</div>`;
  const receipts = (l) => (l.receipts || []).map((rc) => {
    const how = rc.verified_by === 'signature' ? 'signed' : rc.verified_by === 'ops_call' ? 'by ops call' : rc.verification === 'verified' ? 'code' : null;
    return `${esc(rc.ref)} ${how || `<b style="color:${rc.incident || rc.verification === 'failed' ? '#F87171' : '#E8A100'}">${esc(rc.state)}${rc.incident ? ` ${esc(rc.incident)}` : ''}</b>`}`;
  }).join(' · ');
  const visit = (l) => (draft ? (l.age_days == null ? '' : `oldest dirham day ${l.age_days} of 14`)
    : l.direction === 'nil' ? 'Closed'
      : [esc(VISIT[l.visit] || l.visit), l.collected_cents != null ? `${DH(l.collected_cents)} taken` : '', l.visit === 'part' ? `${DH(Math.abs(l.amount_cents) - l.collected_cents)} open` : '',
        l.agent ? esc(l.agent) : '', l.settled_at ? when(l.settled_at) : '', receipts(l), l.on_round && !settled(l) ? `with ${esc(l.on_round)}` : ''].filter(Boolean).join(' · '));
  // six number columns; what happened on the visit gets the full width underneath, so it never truncates
  const COLS = 'display:grid;grid-template-columns:minmax(150px,1.6fr) 92px 92px 80px 80px 110px;gap:10px;align-items:center';
  const row = (l) => {
    const [word, col] = DIR[l.direction] || ['', '#9A9CA3'];
    const late = draft && l.age_days != null && l.age_days > 14;
    return `<div data-go="/finance/statements/${esc(l.ref)}" class="hov" style="${COLS};row-gap:8px;padding:11px 16px;border-top:1px solid #1E1E22;cursor:pointer;font-size:11.5px">
      <span style="min-width:0"><span style="display:block;font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.salon)}</span><span style="display:block;font-size:9.5px;color:#6B6B72;font-family:ui-monospace,Menlo,monospace">${esc(l.ref)}</span></span>
      <span class="num" style="text-align:right;color:#9A9CA3">${DH(l.hold_cents)}</span><span class="num" style="text-align:right;color:#9A9CA3">${DH(l.earned_cents)}</span>
      <span class="num" style="text-align:right;color:${l.carried_cents ? '#E8A100' : '#3A3A40'}">${l.carried_cents ? DH(l.carried_cents) : '—'}</span>
      <span class="num" style="text-align:right;color:${l.subscription_cents ? '#FF7A66' : '#3A3A40'}">${l.subscription_cents ? DH(l.subscription_cents) : '—'}</span>
      <span class="num" style="text-align:right;font-size:12.5px;font-weight:800;color:${col}">${DH(Math.abs(l.amount_cents))}</span>
      <span style="grid-column:1 / -1;display:flex;align-items:center;gap:10px;min-width:0"><span style="font-size:11px;font-weight:700;color:${col};flex:none">${word}</span><span style="flex:1;min-width:0;font-size:10.5px;color:#6B6B72;line-height:1.5">${visit(l)}</span>${late ? '<span style="font-size:10px;font-weight:700;color:#E8A100;flex:none">OVER 14</span>' : ''}
        ${!draft && !settled(l) ? `<span data-go="${base}?settle=${l.id}" style="flex:none;height:24px;border-radius:7px;background:#212125;display:flex;align-items:center;padding:0 10px;font-size:9.5px;font-weight:800;letter-spacing:.05em">${l.direction === 'collect' ? 'RECORD COLLECTION' : 'RECORD HANDOVER'}</span>` : ''}</span></div>`;
  };
  const bad = d.imbalance || [];
  const side = [
    bad.length ? `<div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.4);border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:8px"><span style="font-size:12px;font-weight:700;color:#F87171">This run cannot be released</span>${bad.map((b) => `<span style="font-size:11px;line-height:1.5;color:#9A9CA3">${esc(b.salon)}’s statement says ${DH(b.line_cents)} but its lines add to ${DH(b.items_cents)}. A difference with no line under it is a bug, not a rounding.</span>`).join('')}</div>` : '',
    d.exclusions.length ? `<div style="background:#17171A;border:1px solid rgba(248,113,113,.4);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px"><span style="font-size:12.5px;font-weight:700;color:#F87171">${plural(d.exclusions.length, 'shop is', 'shops are')} not in this run</span>${d.exclusions.map((x) => `<span style="font-size:11px;line-height:1.55;color:#9A9CA3;padding-top:9px;border-top:1px solid #1E1E22">${esc(x.sentence)}</span>`).join('')}</div>` : '',
    open.length ? card(`<span style="font-size:12.5px;font-weight:700">Still open from earlier weeks</span>${open.slice(0, 6).map((o) => `<a href="/finance/settlement/${esc(o.week)}" style="display:flex;flex-direction:column;gap:3px;padding-top:9px;border-top:1px solid #1E1E22;color:#fff"><span style="display:flex;align-items:baseline;gap:7px"><span style="flex:1;font-size:11.5px;font-weight:600">${esc(o.salon)}</span><span class="num" style="font-size:12px;font-weight:700;color:${o.days > o.limit_days ? '#E8A100' : '#fff'}">${DH(o.open_cents)}</span></span>
        <span style="font-size:10.5px;color:#6B6B72;line-height:1.45">Week ${wk(o.week)} · ${o.visit === 'part' ? `${DH(o.collected_cents)} already taken · ` : ''}day ${o.days} of ${o.limit_days}${o.carried ? ' · already carried forward' : o.days > o.limit_days || !o.carries_on ? ' · carries at the next cut' : ` · carries ${dayShort(o.carries_on)}`}</span></a>`).join('')}
      <span style="font-size:10.5px;line-height:1.5;color:#6B6B72;border-top:1px solid #1E1E22;padding-top:9px">A remainder stays on its own line until its week is ${open[0].limit_days} days old, then carries onto the week being cut. It never becomes a separate debt to chase — there is one number per shop per week and this is part of it.</span>`) : '',
    note('A run is a draft, then released', 'It is cut at Friday 21:00 and read whole before anyone presses anything. A run that assembles itself as agents collect has no pay-out total until Thursday — and that total is the only thing that answers Friday’s question: is Sterncut collecting this week, or paying?'),
    note('Nothing is skimmed on the way past', 'There is no commission column here. The run moves our float out of their till and the deposits they earned back to them, and nets the month’s subscription off those deposits (the BILL column). Releasing dispatches agent visits, not a bank instruction.'),
  ].join('');
  const html = page(head, TABS('run'), `<div style="display:flex;flex-direction:column;gap:14px">${weeks}
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:3 1 640px;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;gap:12px;flex-wrap:wrap">${stats}</div>${netCard}${proof}
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
          <div style="${COLS};padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:620px"><span>SHOP · THE VISIT</span><span style="text-align:right">THEY HOLD</span><span style="text-align:right">THEY EARNED</span><span style="text-align:right">CARRIED</span><span style="text-align:right">BILL</span><span style="text-align:right">ONE NUMBER</span></div>
          <div style="min-width:620px">${d.lines.map(row).join('') || '<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No shop had a line this week.</div>'}</div></div></div>
      <div style="flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:12px">${side}</div></div></div>`);

  return {
    top: false, html,
    async ready(root) {
      bindCut(root, act, go, toast);
      // ---- release: §8 does not block on unchecked cash, it spells out what releasing turns into incidents
      if (q.get('release') && draft && latest) {
        const un = pf.unchecked_cents || 0;
        const dl = dialog(sheet(`Release week ${wk(d.week)}`, bad.length ? '' : `${plural(d.shops, 'statement goes', 'statements go')} out to the owners and the agents’ visits become due. It can’t be partly undone — a correction after this is a new line on the next week.`,
          `<div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:8px">${line(`To collect from ${plural(d.collect_shops, 'shop', 'shops')}`, DH(d.collect_cents), '#E8442E')}${line(`To hand over to ${plural(d.pay_shops, 'shop', 'shops')}`, DH(d.pay_cents), '#4ADE80')}</div>
           ${un ? `<div style="background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.35);border-radius:11px;padding:11px 13px;font-size:12px;line-height:1.5;color:#E8A100">${DH(un)} of it was collected but not checked — ${pf.queued_n || 0} still queued, ${pf.failed_n || 0} where the code didn’t match. Releasing makes every one of them an incident, and the owners are told.</div>` : ''}
           ${bad.length ? `<div style="background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.4);border-radius:11px;padding:11px 13px;font-size:12px;line-height:1.5;color:#F87171">A statement disagrees with its own lines, so nothing can be released: ${bad.map((b) => esc(b.salon)).join(', ')}.</div>` : ''}`,
          bad.length ? null : `RELEASE ${plural(d.shops, 'STATEMENT', 'STATEMENTS')}`), { onClose: () => go('/finance'), width: 500 });
        dl.querySelector('#fn-go')?.addEventListener('click', async () => {
          try { const r = await act('admin_release_run', { p_run: d.id }, { title: `Release week ${wk(d.week)}` }); closeDialog(); toast(`Week ${wk(r.week)} released · ${plural(r.shops, 'statement', 'statements')}${r.unchecked ? ` · ${r.unchecked} unchecked, now incidents` : ''}`); }
          catch (e) { showErr(dl, e); }
        });
      }
      // ---- plan the round: nothing can be collected until someone is given it
      if (q.get('plan') && !draft && latest) {
        const [agents, ps] = await Promise.all([rpc('admin_agents'), rest('platform_settings?select=agent_bag_cap_cents&limit=1')]);
        const cap = ps[0]?.agent_bag_cap_cents ?? 1200000;
        const toCollect = d.lines.filter((l) => l.direction === 'collect' && !l.on_round && !settled(l)).reduce((n, l) => n + Math.abs(l.amount_cents) - (l.collected_cents || 0), 0);
        let who = null;
        const dl = dialog(sheet(`Plan the round · week ${wk(d.week)}`, `Every shop on week ${wk(d.week)} nobody has visited yet goes on one agent’s phone${toCollect ? ` — ${DH(toCollect)} to collect` : ''}.`,
          `${label9('WHO IS DRIVING IT', '#6B6B72')}<div id="pl-list" style="display:flex;flex-direction:column;gap:7px">${agents.map((a) => `<span data-agent="${a.id}" style="display:flex;align-items:center;gap:12px;background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 13px;cursor:pointer"><span class="dot" style="width:16px;height:16px;border-radius:999px;border:1.5px solid #3A3A40;flex:none"></span><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(a.name)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">carrying ${DH(a.in_bag_cents)}${a.open_visits ? ` · ${plural(a.open_visits, 'visit', 'visits')} still open` : ''}</span></span></span>`).join('') || '<span style="font-size:12px;color:#F87171">Nobody has the agent role yet.</span>'}</div>
           <span id="pl-warn" style="font-size:11.5px;color:#E8A100;line-height:1.5;display:none"></span>
           ${label9('VISIT WINDOW TODAY · TANGIER TIME', '#6B6B72')}<div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap"><input id="pl-from" type="time" value="17:00" style="height:40px;${input}"><span style="color:#6B6B72">to</span><input id="pl-to" type="time" value="20:00" style="height:40px;${input}"><span style="font-size:11px;color:#6B6B72">empty both for no window</span></div>`,
          'GIVE THEM THE ROUND'), { onClose: () => go('/finance'), width: 520 });
        dl.querySelector('#pl-list').onclick = (e) => {
          const el = e.target.closest('[data-agent]'); if (!el) return;
          who = agents.find((a) => a.id === el.dataset.agent);
          dl.querySelectorAll('[data-agent]').forEach((x) => { const on = x === el; x.style.borderColor = on ? '#E8442E' : '#26262B'; x.querySelector('.dot').style.background = on ? '#E8442E' : ''; });
          // a round is planned against what they already carry, so nobody sets off over the cap
          const w = dl.querySelector('#pl-warn'), over = who.in_bag_cents + toCollect > cap;
          w.style.display = over ? 'block' : 'none';
          w.textContent = over ? `${first(who.name)} is carrying ${DH(who.in_bag_cents)} and this round collects ${DH(toCollect)} — over the ${DH(cap)} cap, so they’ll need to drop at the office partway.` : '';
        };
        dl.querySelector('#fn-go').onclick = async () => {
          if (!who) return showErr(dl, new Error('Pick who drives it.'));
          const f = dl.querySelector('#pl-from').value, t = dl.querySelector('#pl-to').value;
          if (!f !== !t) return showErr(dl, new Error('Give the window both ends, or neither.'));
          try { const r = await act('admin_plan_visits', { p_run: d.id, p_agent: who.id, p_from: f ? casaToday(f) : null, p_to: t ? casaToday(t) : null }, { title: `Give ${who.name} the week ${wk(d.week)} round` }); closeDialog(); toast(r.planned ? `${plural(r.planned, 'visit', 'visits')} on ${first(who.name)}’s phone` : 'Nothing left to plan'); }
          catch (e) { showErr(dl, e); }
        };
      }
      // ---- §3.2: what actually crossed the counter, which is not always the line
      const sl = q.get('settle') ? d.lines.find((l) => l.id === q.get('settle')) : null;
      if (sl && !draft && !settled(sl)) {
        const openC = Math.abs(sl.amount_cents) - (sl.collected_cents || 0), coll = sl.direction === 'collect';
        const dl = dialog(sheet(`${coll ? 'Record a collection from' : 'Record a handover to'} ${esc(sl.salon)}`, `${DH(openC)} is open on this line. Record what actually crossed the counter — a smaller amount is a part payment and the rest stays on the line.`,
          `<label style="display:flex;flex-direction:column;gap:6px">${label9('AMOUNT · DH', '#6B6B72')}<input id="st-dh" inputmode="numeric" value="${openC / 100}" style="height:42px;${input};font-size:14px"></label>
           <label style="display:flex;flex-direction:column;gap:6px">${label9('RECEIPT REFERENCE · OPTIONAL', '#6B6B72')}<input id="st-ref" style="height:42px;${input}"></label>`, 'RECORD IT'), { onClose: () => go(base), width: 460 });
        dl.querySelector('#fn-go').onclick = async () => {
          const c = cents(dl.querySelector('#st-dh').value);
          if (!(c > 0)) return showErr(dl, new Error('That isn’t an amount.'));
          try { const r = await act('admin_settle_line', { p_line: sl.id, p_cents: c, p_declared_cents: null, p_receipt: dl.querySelector('#st-ref').value.trim() || null }, { title: `${coll ? 'Collect' : 'Hand over'} ${DH(c)} · ${sl.salon}` }); closeDialog(); toast(r.open_cents > 0 ? `${DH(r.taken_cents)} taken · ${DH(r.open_cents)} still open` : `${sl.salon} is settled`); }
          catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}

function bindCut(root, act, go, toast) {
  root.querySelector('#fn-cut')?.addEventListener('click', async () => {
    if (!confirm('Cut the week that just closed? Every live shop gets a line, and the draft can be read before anything is released.')) return;
    try { const r = await act('admin_cut_run', {}, { title: 'Cut the week that just closed' }); toast(`Week ${wk(r.week)} cut · ${plural(r.lines, 'line', 'lines')}, ${r.excluded} excluded`); go('/finance', { replace: true }); }
    catch (e) { if (!e.handled) toast(e.message, false); }
  });
}

// ------------------------------------------------------------- FIN-16 · the statement --
// The builder the owner's own statement reads (statement_json), so the two can't disagree.
async function statement({ rpc, rest }, ref) {
  const runs = await rest('settlement_runs?select=id,covers_to&order=covers_to.desc&limit=60');
  const r = runs.find((x) => weekOf(x.covers_to) === ref.slice(0, 8));
  const l = r ? (await rpc('admin_run', { p_run: r.id })).lines.find((x) => x.ref === ref) : null;
  if (!l) throw new Error('not_found');
  const [d, sal] = await Promise.all([rpc('admin_statement', { p_line: l.id }), rest(`salons?select=slug&id=eq.${l.salon_id}`)]);
  const collect = d.direction === 'collect', nil = d.direction === 'nil';
  const accent = nil ? '#6B6B72' : collect ? '#E8442E' : '#4ADE80';
  const runPath = r.id === runs[0].id ? '/finance' : `/finance/settlement/${d.week}`;
  const SR = 'display:grid;grid-template-columns:minmax(0,1fr) 118px 130px 96px;gap:10px;align-items:center';
  const sRow = (x, o = {}) => `<div style="${SR};min-height:38px;padding:4px 18px;border-bottom:1px solid #1E1E22"><span style="font-size:11.5px;color:${o.strong ? '#fff' : '#9A9CA3'}">${esc(x.label)}</span><span style="font-size:10.5px;color:#6B6B72">${esc(x.ref || '')}</span><span class="num" style="font-size:10.5px;color:#6B6B72">${x.at ? when(x.at) : ''}</span><span class="num" style="text-align:right;font-size:12px;font-weight:700;color:${o.colour || '#fff'}">${o.sign || ''}${DH(Math.abs(x.cents))}</span></div>`;
  const sHead = (l2, total, colour) => `<div style="display:flex;align-items:center;height:34px;padding:0 18px;background:#141416;border-top:1px solid #1E1E22;border-bottom:1px solid #1E1E22"><span style="flex:1;font-size:9.5px;letter-spacing:.13em;font-weight:700;color:#6B6B72">${l2}</span><span class="num" style="font-size:12px;font-weight:800;color:${colour}">${total}</span></div>`;
  const fl = d.float_lines || [], el = d.earned_lines || [], cl = d.carried_lines || [], sl = d.subscription_lines || [];
  const body = sHead('OUR FLOAT IN THEIR TILL', DH(d.hold_cents), '#fff') + fl.map((x) => sRow(x)).join('')
    + sHead('DEPOSITS THE SHOP EARNED', `− ${DH(d.earned_cents)}`, '#fff') + el.map((x) => sRow(x, x.kind === 'refund' ? { colour: '#4ADE80', sign: '+ ' } : { sign: '− ' })).join('')
    + (sl.length ? sHead('SUBSCRIPTION, NETTED OFF THOSE DEPOSITS', `+ ${DH(d.subscription_cents)}`, '#FF7A66') + sl.map((x) => sRow(x, { colour: '#FF7A66', sign: '+ ' })).join('') : '')
    + (cl.length ? `<div style="display:flex;align-items:center;height:40px;padding:0 18px;border-bottom:1px solid #1E1E22"><span style="flex:1;font-size:12px;font-weight:600">This week’s movement</span><span class="num" style="font-size:13px;font-weight:700">${DH(d.subtotal_cents)}</span></div>`
      + cl.map((x) => sRow(x, { colour: '#E8A100', sign: x.cents >= 0 ? '+ ' : '− ', strong: true })).join('') : '')
    + `<div style="display:flex;align-items:center;height:52px;padding:0 18px;background:#141416"><span style="flex:1;font-size:13px;font-weight:700">${collect ? 'To collect' : nil ? 'Nothing to move' : 'To hand over'}</span><span class="num" style="font-size:17px;font-weight:800;color:${accent}">${DH(d.total_cents)}</span></div>`;
  const lw = d.last_week;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    <div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px;font-size:13px">
      <a href="${runPath}" style="color:#9A9CA3;font-weight:600">Week ${wk(d.week)}</a><span style="color:#3A3A40">›</span><span style="font-weight:700">${esc(d.salon)}</span>
      <span class="num" style="font-size:11.5px;color:#6B6B72">${esc(d.ref)}${d.released_at ? ` · released ${when(d.released_at)}` : ' · draft'}${d.settled_at ? ` · ${collect ? 'collected' : 'handed over'} ${when(d.settled_at)}` : ''}</span>
      <span style="flex:1"></span>${sal[0] ? btnS('THE SHOP', `data-go="/salons/${esc(sal[0].slug)}"`) : ''}</div>
    ${TABS('run')}
    <div style="flex:1;overflow:auto;padding:20px 24px 32px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:3 1 560px;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div style="background:#17171A;border:1px solid ${nil ? '#1E1E22' : accent + '55'};border-radius:14px;padding:19px 20px;display:flex;flex-direction:column;gap:7px">
          <span style="font-size:9.5px;letter-spacing:.13em;font-weight:700;color:${accent}">${nil ? 'NOTHING MOVED THIS WEEK' : collect ? 'TO COLLECT FROM THIS SHOP' : 'TO HAND OVER TO THIS SHOP'}</span>
          <span class="num" style="font-family:'Playfair Display',serif;font-weight:700;font-size:38px;line-height:1.1">${DH(d.total_cents)}</span>
          <span style="font-size:11.5px;line-height:1.55;color:#9A9CA3">${d.settled_at ? `${esc(d.agent || 'An agent')} ${collect ? 'counted it out of the till' : 'handed it over'} ${when(d.settled_at)}${d.receipt_ref ? ` and left receipt ${esc(d.receipt_ref)}` : ''}. ` : ''}${nil ? 'A nil week is a fact, not a gap — the shop still gets a statement saying so.' : 'This is the only number the owner is asked to trust; everything below explains it and nothing below contradicts it.'}</span></div>
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto"><div style="min-width:560px">${body}</div></div>
        ${lw ? `<div style="background:#141416;border:1px solid #1E1E22;border-radius:12px;padding:13px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="font-size:9.5px;letter-spacing:.13em;font-weight:700;color:#6B6B72">LAST WEEK</span><span style="font-size:11.5px;color:#9A9CA3">Week ${wk(lw.week)} · ${lw.direction === 'collect' ? 'this shop handed us' : 'we handed this shop'} <b class="num" style="color:#fff">${DH(lw.total_cents)}</b></span><span style="flex:1"></span><span style="font-size:10.5px;color:#6B6B72">Closed${cl.length ? ` · untouched by the ${DH(Math.abs(cl[0].cents))} above` : ''}</span></div>` : ''}
      </div>
      <div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:12px">
        ${note('Where the week ends', 'A line lands in the week that contains <b style="color:#fff">the moment it happened</b>: for a cut, the moment the barber marked it done; for float, the moment the cash was taken. Cut-off Friday 21:00. A late tap moves money a week, and that is the price — stamping the line with the appointment time instead would mean reopening a released week, and a released week cannot be reopened.')}
        ${note('Two numbers, one of them trusted', cl.length
          ? `<b style="color:#fff">${DH(d.total_cents)}</b> is what crosses the counter. <b style="color:#D8D8DC">${DH(d.subtotal_cents)}</b> is a named subtotal — this week’s movement — and it is only on the page because a carried line follows it. The bottom number always equals the lines above it; if it does not, that is a bug, not a rounding.`
          : 'One number, and the lines under it add to exactly that. Nothing was carried into this week, so there is no subtotal to name — a smaller number at the top with no line explaining it is the failure mode, not a rounding.')}
        ${note('On time, from the oldest dirham', d.oldest_at == null ? 'Nothing of ours is sitting in this till.'
          : `The clock starts at <b style="color:#fff">${when(d.oldest_at)}</b>, the first movement nobody has settled — <b style="color:${d.age_days > d.hold_limit_days ? '#E8A100' : '#fff'}">day ${d.age_days} of ${d.hold_limit_days}</b>. Measuring from the last collection would restart the clock at every top-up, and a shop that tops up most days could hold our money forever and never be late.`)}
      </div></div></div>`;
  return { top: false, html };
}

// ------------------------------------------------------------- FIN-17 · corrections --
// A refund that lands after its week was settled. The released week is never edited; the
// refund becomes one new line on the week being cut, and the amount is read off the refund.
async function corrections({ rpc, act, go, toast }) {
  const [rows, r] = await Promise.all([rpc('admin_corrections', { p_limit: 20 }), rpc('admin_run')]);
  const draft = r && r.state === 'draft' ? r : null;
  const pending = rows.filter((c) => !c.landed);
  const item = (c) => {
    const tl = (c.timeline || []).filter((x) => x.at || x.what);
    return `<div style="background:#17171A;border:1px solid ${c.landed ? '#1E1E22' : 'rgba(232,161,0,.34)'};border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:13px;font-weight:700">${esc(c.salon)}</span><span style="font-size:11px;color:#6B6B72">${esc(c.booking_ref)} · refunded after week ${wk(c.source_week)} was settled</span><span style="flex:1"></span><span class="num" style="font-size:15px;font-weight:800;color:#E8A100">+ ${DH(c.amount_cents)}</span></div>
      <div>${tl.map((x, i) => `<div style="display:flex;gap:14px;padding:7px 0"><span class="num" style="width:118px;flex:none;font-size:10.5px;color:#6B6B72">${x.at ? when(x.at) : '—'}</span><span style="width:6px;height:6px;border-radius:999px;margin-top:5px;flex:none;background:${i === tl.length - 1 ? '#E8A100' : '#3A3A40'}"></span><span style="flex:1;font-size:11.5px;line-height:1.5;color:${i === tl.length - 1 ? '#D8D8DC' : '#9A9CA3'}">${esc(x.what)}</span></div>`).join('')}</div>
      ${c.landed ? '' : `<div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1 1 240px;border:1px dashed #3A3A40;border-radius:12px;padding:13px 14px;display:flex;flex-direction:column;gap:6px;opacity:.62"><span style="font-size:11.5px;font-weight:700;color:#6B6B72;text-decoration:line-through">Edit week ${wk(c.source_week)}</span><span style="font-size:10.5px;line-height:1.5;color:#6B6B72">Refused, and not offered as a permission. The statement is released and the cash is counted; changing it now leaves the receipt in the owner’s drawer describing a week that no longer exists.</span></div>
        <div style="flex:1 1 240px;border:1px solid #E8442E;border-radius:12px;padding:13px 14px;display:flex;flex-direction:column;gap:6px"><span style="font-size:11.5px;font-weight:700">Carry it onto ${draft ? `week ${wk(draft.week)}` : 'the next week'}</span><span style="font-size:10.5px;line-height:1.5;color:#9A9CA3">One new line on the next statement, carrying the old booking’s reference and both times. Last week stays exactly as the owner received it. This is the only way money moves backwards in Sterncut.</span></div></div>`}
      <div style="background:#141416;border:1px solid #1E1E22;border-radius:11px;padding:12px 14px;display:flex;flex-direction:column;gap:9px">${label9(c.landed ? 'THE LINE ON THE STATEMENT' : 'THE LINE THIS WILL CREATE', '#6B6B72')}
        <div style="display:flex;align-items:center;gap:10px"><span style="flex:1;min-width:0"><span style="display:block;font-size:11.5px;color:#D8D8DC">${esc(c.label)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">${esc(c.booking_ref)}${c.case_no ? ` · case <a href="/support/${esc(c.case_no)}" style="color:#9A9CA3">${esc(c.case_no)}</a>` : ''}</span></span><span class="num" style="font-size:12.5px;font-weight:700;color:#E8A100">+ ${DH(c.amount_cents)}</span></div></div>
      ${c.landed ? `<span style="font-size:10.5px;color:#4ADE80">Already on a statement. The owner is told once, when that week is cut — a mid-week message about ${DH(c.amount_cents)} is a fright, not a service.</span>`
        : `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1;min-width:220px;font-size:10.5px;line-height:1.45;color:#6B6B72">The amount is read off the refund, never typed. You are choosing the week and nothing else.</span>${draft ? btnP(`CUT THE LINE ONTO WEEK ${wk(draft.week)}`, `data-carry="${c.booking_id}"`) : '<span style="height:32px;border-radius:9px;background:#212125;color:#6B6B72;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:700">NO DRAFT WEEK YET</span>'}</div>`}</div>`;
  };
  const html = page(pageHead('Corrections', pending.length ? `${num(pending.length)} waiting for a week to land on` : 'Nothing waiting'), TABS('corrections'),
    `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap"><div style="flex:3 1 560px;min-width:0;display:flex;flex-direction:column;gap:14px">${rows.map(item).join('')
      || '<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:26px;font-size:12px;line-height:1.6;color:#6B6B72">No refund has landed against a week that was already settled. A refund inside its own week nets out on that week’s statement and never becomes a correction.</div>'}</div>
      <div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:12px">
        ${note('There is no dispute state', 'If an owner says a deduction is wrong, the product has nowhere to put that. The button on their statement can only open a support case, and the case can only end in another line on another week. That is drawn honestly rather than as a dispute flow that does not exist — a real one needs a state on the line and a rule about who wins.')}
        ${note('Both directions, same line', 'On a shop we owe, this line lands with the same sign and shrinks what we hand over. It never becomes a separate debt to chase — there is one number per shop per week and this is part of it.')}
        ${note('The amount is not typed', 'It is the refunded amount, read off the refund row. Ops picks which week the line lands in and nothing else, so nobody can invent a number against a shop.')}</div></div>`);
  return {
    top: false, html,
    ready(root) {
      root.querySelectorAll('[data-carry]').forEach((b) => b.addEventListener('click', async () => {
        const c = rows.find((x) => x.booking_id === b.dataset.carry);
        if (!confirm(`Put ${DH(c.amount_cents)} on ${c.salon}’s week ${wk(draft.week)} statement? Week ${wk(c.source_week)} is not touched. The owner is told when this week is cut.`)) return;
        try { await act('admin_carry_correction', { p_booking: c.booking_id, p_run: draft.id }, { title: `Carry ${DH(c.amount_cents)} onto ${c.salon}’s week ${wk(draft.week)}` }); toast(`Carried onto week ${wk(draft.week)}`); go('/finance/corrections', { replace: true }); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      }));
    },
  };
}

// ----------------------------------------- FIN-19 · cash in the shops, and write-offs --
// Always beside the float, never filtered: one write-off is reasonable; twenty small ones
// nobody sees is a leak. Rows can't be edited — a mistaken one is reversed by a new line.
async function float(ctx) {
  const { rpc, act, q, go, toast, dialog, closeDialog } = ctx;
  const c = await rpc('admin_cash_in_shops', {});
  const mo = (y, m) => new Date(Date.UTC(y, m, 15)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const [y, m] = [Number(c.month.slice(0, 4)), Number(c.month.slice(5, 7)) - 1];
  const monthName = mo(y, m), lastName = mo(y, m - 1);
  const over = c.alert_cents != null && c.month_cents > c.alert_cents;
  const newest = c.writeoffs[c.writeoffs.length - 1];
  const SC = 'display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) 110px 120px;gap:10px;align-items:center';
  const html = page(pageHead(`Cash in the shops — ${monthName}`, `Held for us across ${plural(c.shops.length, 'shop', 'shops')}`), TABS('float'),
    `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:3 1 520px;min-width:0;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('HELD FOR US, ALL SHOPS', DH(c.held_cents), 'our float in their drawers right now')}${kpi(`WRITTEN OFF · ${monthName.toUpperCase()}`, DH(c.month_cents), `${lastName}: ${DH(c.last_month_cents)}`, over ? '#F87171' : '')}</div>
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
          <div style="${SC};padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:520px"><span>SHOP</span><span>AGENT</span><span style="text-align:right">IN DRAWER</span><span style="text-align:right">OWED TO CHAIRS</span></div>
          <div style="min-width:520px">${c.shops.map((s) => `<div style="${SC};padding:12px 16px;border-top:1px solid #1E1E22;font-size:12px"><span style="font-weight:700">${esc(s.name)}</span><span style="color:#9A9CA3">${esc(s.agent || '—')}</span><span class="num" style="text-align:right;font-weight:700">${DH(s.drawer_cents)}</span><span class="num" style="text-align:right;color:#9A9CA3">${DH(s.owed_cents)}</span></div>`).join('') || '<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No shop is live yet.</div>'}</div></div>
      </div>
      <div style="flex:2 1 320px;min-width:0;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:baseline;justify-content:space-between">${label9(`WRITTEN OFF · ${monthName.toUpperCase()}`, '#F87171')}<span style="font-size:10.5px;color:#6B6B72">${lastName}: ${DH(c.last_month_cents)}</span></div>
        ${c.writeoffs.length ? `<div style="background:#141416;border:1px solid #1E1E22;border-radius:12px;overflow:hidden">${c.writeoffs.map((w, i) => `<a href="/finance/float?writeoff=${w.id}" class="hov" style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;color:#fff;${i ? 'border-top:1px solid #1E1E22;' : ''}${w === newest && Date.now() - new Date(w.at) < 864e5 ? 'background:rgba(232,68,46,.06)' : ''}">
            <span style="flex:1;min-width:0"><span style="display:block;font-size:12px;font-weight:700">${esc(w.salon)}</span><span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px">${esc(w.barber)} · ${dayShort(w.at)} · signed ${esc(first(w.signer))}${w.bearer === 'salon' ? ' · <span style="color:#E8A100">shop bears it</span>' : ''}${w.reversal ? ' · reversal' : ''}</span></span>
            <span style="flex:none;text-align:right"><span class="num" style="display:block;font-size:12.5px;font-weight:700">${w.amount_cents < 0 ? '− ' : ''}${DH(Math.abs(w.amount_cents))}</span><span class="num" style="display:block;font-size:10px;color:#6B6B72;margin-top:2px">${DH(w.running_cents)}</span></span></a>`).join('')}</div>`
          : `<span style="font-size:12px;color:#6B6B72">Nothing written off in ${monthName}.</span>`}
        <div style="display:flex;align-items:baseline;justify-content:space-between;padding:4px 2px 0"><span style="font-size:12.5px;font-weight:700">Running total</span><span class="num" style="font-family:'Playfair Display',serif;font-weight:700;font-size:22px;${over ? 'color:#F87171' : ''}">${DH(c.month_cents)}</span></div>
        ${line('Borne by Sterncut / by shops', `${DH(c.sterncut_cents)} / ${DH(c.salon_cents)}`, '#9A9CA3')}
        ${over ? `<div style="border:1px solid rgba(248,113,113,.35);background:rgba(232,68,46,.08);border-radius:10px;padding:10px 12px;font-size:11.5px;line-height:1.45;color:#F87171">Over the monthly alert by <b>${DH(c.month_cents - c.alert_cents)}</b>. Nothing is refused — this is the flag that someone should look.</div>` : ''}
        <div style="display:flex;flex-direction:column;gap:6px;padding:0 2px">
          <div style="display:flex;align-items:baseline;justify-content:space-between"><span style="font-size:11px;color:#9A9CA3">Monthly alert</span><span style="font-size:11.5px;font-weight:700;color:#9A9CA3">${c.alert_cents == null ? 'Off' : `Above ${DH(c.alert_cents)}`}${c.can_set_alert ? ' · <a href="/finance/float?alert=1" style="font-weight:700">Change</a>' : ''}</span></div>
          <span style="font-size:10.5px;color:#6B6B72">${c.alert_set ? `Set by ${esc(c.alert_set.by)}, ${dayShort(c.alert_set.at)}${c.alert_set.note ? ` · “${esc(c.alert_set.note)}”` : ''}` : 'The starting figure — finance hasn’t set one yet.'}</span>
          <span style="font-size:10.5px;line-height:1.45;color:#6B6B72">Only a full-access admin moves it, never a signer on their own limit.</span></div>
        <span style="font-size:11px;line-height:1.5;color:#6B6B72;border-top:1px solid #1E1E22;padding-top:12px">Every row opens its note and its handover. Rows can’t be edited or deleted — a mistaken write-off is reversed with a new line, and that shows here too.</span>
      </div></div>`);
  return {
    top: false, html,
    ready() {
      if (q.get('writeoff')) writeoffRead(ctx, q.get('writeoff'), '/finance/float');
      if (q.get('alert') && c.can_set_alert) {
        const dl = dialog(sheet('The monthly write-off alert', 'When the month’s write-offs pass this, Cash in shops and the overview turn red. It never refuses a write-off — it is the flag that someone should look.',
          `<label style="display:flex;flex-direction:column;gap:6px">${label9('DH A MONTH · EMPTY TURNS IT OFF', '#6B6B72')}<input id="al-dh" inputmode="numeric" value="${c.alert_cents == null ? '' : c.alert_cents / 100}" style="height:42px;${input};font-size:14px"></label>
           <textarea id="al-why" rows="2" placeholder="Why — logged against your name" style="${input};resize:vertical"></textarea>`, 'SAVE'), { onClose: () => go('/finance/float'), width: 460 });
        dl.querySelector('#fn-go').onclick = async () => {
          const raw = dl.querySelector('#al-dh').value.replace(/\s/g, '');
          if (raw && !/^\d+$/.test(raw)) return showErr(dl, new Error('Whole dirhams, or empty for off.'));
          try { await act('admin_set_writeoff_alert', { p_cents: raw ? Number(raw) * 100 : null, p_reason: dl.querySelector('#al-why').value.trim() || null }, { title: raw ? `Set the write-off alert to ${DH(Number(raw) * 100)} a month` : 'Turn the write-off alert off' }); closeDialog(); toast(raw ? `The alert is now ${DH(Number(raw) * 100)} a month` : 'The alert is off'); }
          catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}

// FIN-18b, read-only: what was signed, why, and what was sent. A signer can reverse it
// from here (0129) — a new line, never an edit.
const bearers = (chosen, salon, readOnly) => `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">${[['sterncut', 'Sterncut', 'A loss on our books. Nobody at the shop owes it.'], ['salon', 'The shop', `Taken from ${esc(salon)}’s Friday settlement, shown on the owner’s statement.`]]
  .map(([k, t, s]) => { const on = chosen === k; return `<div ${readOnly ? '' : `data-bearer="${k}"`} style="${readOnly ? '' : 'cursor:pointer;'}flex:1 1 200px;border:${on ? '1.5px solid #E8442E' : '1px solid #26262B'};border-radius:10px;padding:12px 13px;display:flex;flex-direction:column;gap:4px"><span style="font-size:12.5px;font-weight:700;color:${on || !chosen ? '#fff' : '#9A9CA3'}">${t}</span><span style="font-size:11px;line-height:1.45;color:${on || !chosen ? '#9A9CA3' : '#6B6B72'}">${s}</span></div>`; }).join('')}</div>`;
// the messages the database will send, from its own template, in each person's language
function messages(msgs, sent) {
  if (!msgs || !msgs.length) return '<span style="font-size:11px;color:#6B6B72">Pick who loses it to see the messages.</span>';
  const [lead, ...rest] = msgs;
  return `<div style="display:flex;flex-direction:column;gap:8px">${label9(`WHAT ${first(lead.name).toUpperCase()} ${sent ? 'WAS' : 'WILL BE'} SENT${lead.lang && lead.lang !== 'en' ? ` · ${String(lead.lang).toUpperCase()}` : ''}`, '#6B6B72')}
    <div dir="auto" style="background:#212125;border-radius:12px;padding:12px 14px;font-size:12px;line-height:1.5">${esc(lead.body)}</div>
    ${rest.map((x) => `<span style="font-size:11px;line-height:1.5;color:#6B6B72">${esc(first(x.name))} ${sent ? 'got' : 'gets'}${x.lang && x.lang !== 'en' ? ` (${esc(String(x.lang).toUpperCase())})` : ''}: “<bdi>${esc(x.body)}</bdi>”</span>`).join('')}</div>`;
}

async function writeoffRead({ rpc, act, go, toast, dialog, closeDialog }, id, back) {
  const x = await rpc('admin_writeoff', { p_id: id }).catch(() => null);
  if (!x) return go(back, { replace: true });
  const reversal = !!x.reverses_ref;
  const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:15px">
    <div>${label9(`${reversal ? 'REVERSAL' : 'WRITE OFF'} · ${x.ref} · ${x.transfer_ref || ''}`, '#F87171')}<span class="num" style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:32px;line-height:1.1;margin-top:6px">${x.amount_cents < 0 ? '− ' : ''}${DH(Math.abs(x.amount_cents))}</span>
      <span style="display:block;font-size:12px;color:#9A9CA3;margin-top:4px">${reversal ? `Reverses ${esc(x.reverses_ref)}` : `The gap between ${esc(first(x.from_name))}’s ${DH(x.declared_cents)} and ${esc(first(x.to_name))}’s ${DH(x.counted_cents)}`} · ${esc(x.salon)} · on ${esc(x.barber)}</span></div>
    <div>${label9('WHO LOSES IT', '#6B6B72')}${bearers(x.bearer, x.salon, true)}</div>
    <div style="display:flex;flex-direction:column;gap:8px">${label9('WHY', '#6B6B72')}<div style="background:#111113;border:1px solid #26262B;border-radius:10px;padding:11px 13px;font-size:12px;line-height:1.5">${esc(x.note)}</div></div>
    ${x.messages ? messages(x.messages, true) : ''}
    <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid #26262B;padding-top:14px">
      <span style="font-size:11.5px;color:#9A9CA3">Signed by <b style="color:#fff">${esc(x.signer)}</b> · ${when(x.signed_at)}</span>
      ${x.reversed_by ? `<span style="font-size:11.5px;color:#E8A100">Reversed by ${esc(x.reversed_by.ref)} · ${esc(x.reversed_by.signer)}, ${dayShort(x.reversed_by.at)}${x.reversed_by.note ? ` · “${esc(x.reversed_by.note)}”` : ''}</span>` : ''}
      <span style="font-size:10.5px;color:#6B6B72">Rows can’t be edited or deleted — a mistaken write-off is reversed with a new line.</span></div>
    ${x.can_reverse ? `<div style="display:flex;flex-direction:column;gap:8px">${label9('REVERSE IT · WHY, REQUIRED', '#6B6B72')}
      <textarea id="rv-note" rows="3" style="${input};resize:vertical"></textarea><span id="rv-count" style="font-size:10.5px;color:#6B6B72">20 more characters</span>
      <span style="font-size:11px;line-height:1.45;color:#9A9CA3">A new line of − ${DH(x.amount_cents)}. The shortfall goes back on ${esc(x.barber)}’s account and they are told${x.bearer === 'salon' ? '; so is the owner, because it comes off the shop’s next Friday' : ''}.</span></div>` : ''}
    ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS(x.can_reverse ? 'Cancel' : 'Close', 'data-dlg-close="1"')}${x.can_reverse ? btnP('REVERSE &amp; SEND', 'id="rv-go"') : ''}</div></div>`, { onClose: () => go(back), width: 580 });
  if (!x.can_reverse) return;
  const t = dl.querySelector('#rv-note'), b = dl.querySelector('#rv-go');
  b.style.opacity = '.45';
  t.oninput = () => { const left = 20 - t.value.trim().length; dl.querySelector('#rv-count').textContent = left > 0 ? `${left} more characters` : ''; b.style.opacity = left > 0 ? '.45' : '1'; };
  b.onclick = async () => {
    if (t.value.trim().length < 20) return;
    try { const r = await act('admin_reverse_writeoff', { p_writeoff: id, p_note: t.value.trim() }, { title: `Reverse ${x.ref} · ${x.salon}`, reason: t.value.trim() }); closeDialog(); toast(`${r.ref} reverses ${r.reverses}. The shortfall is open again, and they’ve been told.`); }
    catch (e) { showErr(dl, e); }
  };
}

// ------------------------------------------------- FIN-18 · a handover that doesn't add up --
// The drawer is physical and both people were in the room: ops can't pick a winner from a
// screen. Everything here supports a phone call, and recording a figure never makes money
// disappear — the difference becomes a shortfall on whoever handed over.
const HV = { mismatch: ['UNACCOUNTED', '#F87171'], pending: ['COUNTING', '#E8A100'], done: ['MATCHED', '#4ADE80'], resolved: ['SETTLED', '#4ADE80'], cancelled: ['CANCELLED', '#6B6B72'] };
const SF = { open: ['SHORTFALL OPEN', '#E8A100'], paid: ['PAID BACK', '#4ADE80'], written_off: ['WRITTEN OFF', '#9A9CA3'] };

async function handovers(ctx, ref, signing) {
  const { rpc, act, q, go, toast } = ctx;
  const list = (await rpc('admin_drawer_transfers')) || [];
  const open = list.filter((t) => t.state === 'mismatch'), owing = list.filter((t) => t.shortfall_status === 'open');
  const sel = ref ? list.find((t) => t.ref === ref) : (open[0] || owing[0] || list[0]);
  if (ref && !sel) throw new Error('not_found');
  const sub = open.length ? `${num(open.length)} with cash nobody is holding` : owing.length ? `${plural(owing.length, 'shortfall', 'shortfalls')} still open` : list.length ? 'Nothing unaccounted' : 'No drawer has changed hands yet';
  const d = sel ? await rpc('admin_drawer_transfer', { p_id: sel.id }) : null;
  const items = list.map((t) => `<a href="/finance/float/transfers/${esc(t.ref)}" class="hov" style="display:flex;align-items:center;gap:10px;background:#17171A;border:1px solid ${sel && t.id === sel.id ? '#3A3A40' : '#1E1E22'};border-radius:12px;padding:11px 13px;color:#fff">
      <span style="font:700 10.5px ui-monospace,Menlo,monospace;color:#6B6B72;flex:none">${esc(t.ref)}</span>
      <span style="flex:1;min-width:0;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.salon)}<span style="color:#9A9CA3;font-weight:400"> · ${esc(first(t.from_name))} → ${esc(first(t.to_name))}</span></span>
      ${t.gap_cents ? `<span class="num" style="font-size:12px;font-weight:700;color:#F87171;flex:none">${DH(Math.abs(t.gap_cents))}</span>` : ''}${pill(t.shortfall_status ? SF[t.shortfall_status] : (HV[t.state] || HV.pending))}</a>`).join('');
  const notes = note('Ops can’t pick a winner from a screen', 'The drawer is physical and both people work in the same room. Everything here exists to support a phone call — both statements, the float history, each person’s collection record, and the clock.')
    + note('Our books are not evidence', 'They agree with the outgoing agent because that agent entered every top-up on them. That tells you the records are internally consistent, nothing more. Sending the collection agent to count the drawer is the only way to get a number that isn’t a claim.')
    + note('The shop keeps working', 'The outgoing agent stays liable and stays the one who pays the chairs. No barber’s wages are held, and bookings, the queue and the shop page are untouched. A cash dispute must never become a suspension.')
    + note('Writing it off is a signature', 'Recording a figure names the new agent and leaves the difference on whoever handed over, as a shortfall they owe Sterncut — not the shop. Writing it off takes a finance signer, a reason of 20 characters or more, and a choice of who loses it: Sterncut, or the shop on its next Friday. Never a barber. Every write-off lands in <a href="/finance/float" style="font-weight:700">Cash in shops</a>.');
  if (!d) return { top: false, html: page(pageHead('Drawer handovers', sub), TABS('handovers'), `<div style="display:flex;gap:16px;flex-wrap:wrap"><div style="flex:2 1 420px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:22px;font-size:12.5px;color:#6B6B72">No drawer has changed hands yet.</div><div style="flex:1 1 280px;display:flex;flex-direction:column;gap:12px">${notes}</div></div>`) };

  const path = `/finance/float/transfers/${d.ref}`;
  const gap = d.gap_cents, sf = d.shortfall;
  const man = (who, amount, label, subline) => `<div style="flex:1 1 200px;min-width:0;display:flex;flex-direction:column;gap:8px">${label9(label, '#6B6B72')}
      <div style="display:flex;align-items:center;gap:10px"><span style="width:30px;height:30px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none">${esc(initials(who.name))}</span><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(who.name)}</span><span style="display:block;font-size:10.5px;color:#6B6B72">${subline}</span></span></div>
      <span class="num" style="font-family:'Playfair Display',serif;font-weight:700;font-size:26px">${DH(amount)}</span></div>`;
  const fromSub = [d.from.is_owner ? 'Owner' : esc(d.from.chair || 'Barber'), d.from.agent_since ? `agent since ${dayShort(d.from.agent_since)}` : '', plural(d.from.collections || 0, 'clean collection', 'clean collections'), d.from.failed ? `${d.from.failed} that didn’t verify` : ''].filter(Boolean).join(' · ');
  const toSub = [esc(d.to.chair || 'Barber'), d.to.held_before ? 'has held the drawer before' : 'never held the drawer before'].join(' · ');
  const steps = [
    [`Owner picked ${d.to.name} as agent`, d.at],
    d.declared_cents != null ? [`${d.from.name} handed over ${DH(d.declared_cents)}`, d.counted_at] : null,
    d.counted_cents != null ? [`${d.to.name} counted ${DH(d.counted_cents)}${gap ? ' · transfer refused · both told' : ''}`, d.counted_at] : null,
    d.count_requested_at ? [`Collection agent asked to count the drawer${d.count_requested_by ? ` by ${d.count_requested_by}` : ''}`, d.count_requested_at] : null,
    d.resolved_at ? [`Settled at ${DH(d.agreed_cents)} by ${d.resolved_by || 'ops'}`, d.resolved_at] : null,
    sf && sf.status === 'paid' ? [`${sf.barber} paid the ${DH(sf.cents)} back into the drawer`, sf.closed_at] : null,
    sf && sf.writeoff ? [`Written off ${sf.writeoff.ref} by ${sf.writeoff.signer}`, sf.writeoff.at] : null,
    d.state === 'mismatch' ? [`Cash nobody is holding, for ${ago(d.counted_at)}`, null] : null,
  ].filter(Boolean);
  const woLink = (cents) => (d.can_sign ? `<a href="${path}/write-off" class="btn-s" style="height:34px;border-radius:9px;background:#212125;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:700;letter-spacing:.05em;color:#fff">WRITE OFF ${DH(cents)}</a>`
    : `<span style="font-size:10.5px;color:#6B6B72">Writing off ${DH(cents)} takes a finance signer.</span>`);
  let action;
  if (d.state === 'mismatch') {
    action = card(`${label9('RECORD WHAT WAS AGREED ON THE CALL', '#6B6B72')}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><span data-set="${d.counted_cents}" style="cursor:pointer;height:30px;border-radius:8px;background:#212125;display:flex;align-items:center;padding:0 12px;font-size:11.5px;font-weight:600">${esc(first(d.to.name))}’s ${DH(d.counted_cents)} stands</span><span data-set="${d.declared_cents}" style="cursor:pointer;height:30px;border-radius:8px;background:#212125;display:flex;align-items:center;padding:0 12px;font-size:11.5px;font-weight:600">${esc(first(d.from.name))}’s ${DH(d.declared_cents)} stands</span></div>
      <div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap"><input id="hv-amount" inputmode="numeric" value="${(d.counted_cents || 0) / 100}" style="width:120px;height:38px;${input};font-size:13px"><span style="font-size:11.5px;color:#6B6B72">DH in the drawer when it was counted</span></div>
      <input id="hv-note" placeholder="What the call settled — logged against your name" style="height:40px;${input}">
      <span style="font-size:11px;line-height:1.5;color:#9A9CA3">Whichever number is recorded, the difference becomes a <b style="color:#fff">shortfall on ${esc(d.from.name)}’s account</b>, owed to Sterncut and not to the shop, until they pay it back into the drawer or a finance signer writes it off. Recording a figure names the new agent; it never makes money disappear.</span>
      <div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center">${btnP(`RECORD &amp; NAME ${esc(first(d.to.name).toUpperCase())} AGENT`, 'id="hv-save"')}
        ${d.count_requested_at ? `<span style="font-size:11px;color:#9A9CA3">Collection agent asked ${ago(d.count_requested_at)} ago</span>` : btnS('SEND THE COLLECTION AGENT TO COUNT IT', 'id="hv-count"')}
        ${gap > 0 ? woLink(gap) : ''}</div>`);
  } else if (d.state === 'resolved') {
    action = card(`${label9('SETTLED', '#4ADE80')}${line('Agreed on the call', DH(d.agreed_cents))}${sf ? line(`The difference, on ${esc(sf.barber)}’s account`, DH(sf.cents), '#E8A100') : ''}<span style="font-size:11.5px;color:#9A9CA3">${esc(d.resolution_note || '')} — ${esc(d.resolved_by || 'ops')}, ${dayShort(d.resolved_at)}</span>`)
      + (sf ? card(`<div style="display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:12.5px;font-weight:700">${DH(sf.cents)} on ${esc(sf.barber)}</span>${pill(SF[sf.status] || [sf.status, '#9A9CA3'])}</div>${sf.status === 'open'
        ? `<span style="font-size:11px;line-height:1.5;color:#9A9CA3">It is theirs to settle, not the shop’s: the shop’s Friday figure already came down by it. They pay it back by handing it to whoever holds the drawer, who records it — or a finance signer writes it off.</span><div style="display:flex;gap:9px;align-items:center">${woLink(sf.cents)}</div>`
        : sf.status === 'paid' ? `<span style="font-size:11px;color:#9A9CA3">Paid back into the drawer ${dayShort(sf.closed_at)}. It goes to Sterncut with the shop’s Friday collection.</span>`
          : `<a href="${path}?writeoff=${sf.writeoff?.id || ''}" style="font-size:11px;color:#9A9CA3">Written off <b style="color:#fff">${esc(sf.writeoff?.ref || '')}</b> · ${sf.writeoff?.bearer === 'salon' ? 'the shop bears it' : 'Sterncut bears it'} · signed ${esc(sf.writeoff?.signer || '')} · open it</a>`}`) : '');
  } else {
    action = card(`<span style="font-size:11.5px;color:#9A9CA3">${d.state === 'pending' ? `${esc(d.to.name)} hasn’t counted it yet. Nothing for ops to do until they do.` : d.state === 'done' ? 'Counted, and it matched. Nothing for ops to do.' : 'Cancelled before anyone counted it.'}</span>`);
  }
  const booksMatch = d.books.drawer_cents === d.declared_cents;
  const html = page(pageHead('Drawer handovers', sub), TABS('handovers'), `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:1 1 280px;min-width:0;display:flex;flex-direction:column;gap:8px">${items}<div style="height:6px"></div>${notes}</div>
    <div style="flex:2.2 1 520px;min-width:0;display:flex;flex-direction:column;gap:12px">
      ${card(`<div style="display:flex;align-items:flex-start;gap:12px"><span style="flex:1;min-width:0"><span style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:19px">${esc(d.salon.name)} — ${esc(d.from.name)} → ${esc(d.to.name)}</span>
        <span style="display:block;font-size:11.5px;color:#6B6B72;margin-top:4px">${esc(d.ref)} · started ${when(d.at)}${d.salon.address ? ` · ${esc(d.salon.address)}` : ''} · ${plural(d.salon.chairs || 0, 'chair', 'chairs')}</span></span>${pill(HV[d.state] || HV.pending)}</div>`)}
      ${d.counted_cents != null ? card(`<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">${man(d.from, d.declared_cents, 'HANDED OVER, THEY SAY', fromSub)}
        <span style="flex:none;text-align:center"><span class="num" style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:22px;color:${gap ? '#F87171' : '#4ADE80'}">${DH(Math.abs(gap || 0))}</span><span style="display:block;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">GAP</span></span>
        ${man(d.to, d.counted_cents, 'COUNTED, THEY SAY', toSub)}</div>`) : ''}
      ${card(`${label9('WHAT THE FLOAT SAYS IT SHOULD BE', '#6B6B72')}${line(`${plural(d.books.topups, 'top-up', 'top-ups')} recorded${d.books.since ? ` since ${dayShort(d.books.since)}` : ''}`, DH(d.books.topups_cents))}${line(`Of those, entered by ${esc(d.from.name)}`, num(d.books.topups_by_him))}
        ${line('Paid out to chairs, confirmed by code', DH(d.books.paid_out_cents))}${line('Owed to Sterncut on the next collection', DH(d.books.sterncut_cents))}${line('<b style="color:#fff">Our books, right now</b>', DH(d.books.drawer_cents))}
        <span style="font-size:11px;line-height:1.5;color:#9A9CA3;border-top:1px solid #1E1E22;padding-top:10px">${booksMatch ? `Our number matches ${esc(first(d.from.name))}’s exactly — which is <b style="color:#D8D8DC">not evidence</b>. Every top-up on it was entered by them. It tells you the records are internally consistent, nothing more.` : `Our books match neither figure. Sending the collection agent to count the drawer is the only way to a number that isn’t a claim.`}</span>`)}
      ${card(`${label9('OWED TO CHAIRS, RIGHT NOW', '#6B6B72')}${(d.dues || []).length ? d.dues.map((x) => line(esc(x.name), DH(x.cents), x.cents < 0 ? '#E8A100' : '#4ADE80')).join('') : '<span style="font-size:11.5px;color:#6B6B72">Nobody is owed anything today.</span>'}<span style="font-size:11px;line-height:1.5;color:#9A9CA3">${esc(d.from.name)} goes on paying these while this is open. No barber’s wages wait on it.</span>`)}
      ${card(`${label9('WHAT HAPPENED, IN ORDER', '#6B6B72')}${steps.map(([t, at]) => `<div style="display:flex;gap:10px;align-items:baseline"><span style="width:6px;height:6px;border-radius:999px;background:#3A3A40;flex:none;transform:translateY(-2px)"></span><span style="flex:1;font-size:12px">${esc(t)}</span><span class="num" style="font-size:11px;color:#6B6B72">${at ? when(at) : ''}</span></div>`).join('')}`)}
      ${action}</div></div>`);
  return {
    top: false, html,
    ready(root) {
      const amount = root.querySelector('#hv-amount');
      root.querySelectorAll('[data-set]').forEach((el) => { el.onclick = () => { amount.value = Number(el.dataset.set) / 100; }; });
      root.querySelector('#hv-save')?.addEventListener('click', async () => {
        const noteTxt = root.querySelector('#hv-note').value.trim(), c = cents(amount.value);
        if (!noteTxt) return toast('Say what the call settled — it is logged against your name.', false);
        if (!(c >= 0)) return toast('That isn’t an amount.', false);
        try {
          const r = await act('admin_resolve_drawer_transfer', { p_id: d.id, p_agreed_cents: c, p_note: noteTxt }, { title: `Settle ${d.ref} at ${DH(c)} · ${d.salon.name}`, reason: noteTxt });
          toast(r.gap_cents > 0 ? `${DH(r.gap_cents)} is now a shortfall on ${d.from.name}. ${d.to.name} is the agent.` : `${d.to.name} is the agent${r.gap_cents < 0 ? `, and the drawer owes ${d.from.name} ${DH(-r.gap_cents)}` : ', with nothing missing'}.`);
          go(path, { replace: true });
        } catch (e) { if (!e.handled) toast(e.message, false); }
      });
      root.querySelector('#hv-count')?.addEventListener('click', async () => {
        try { await act('admin_request_drawer_count', { p_id: d.id }, { title: `Send the collection agent to count ${d.salon.name}’s drawer` }); toast('Logged. Send them on the next round — a third number is the only one that isn’t a claim.'); go(path, { replace: true }); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      });
      if (signing) writeoffSign(ctx, d, path);
      if (q.get('writeoff')) writeoffRead(ctx, q.get('writeoff'), path);
    },
  };
}

// FIN-18b · the signature. No bearer is preselected, and the box won't close without a
// person's reason; the monthly alert warns before the signature and never refuses it.
async function writeoffSign({ rpc, act, go, toast, dialog, closeDialog }, d, back) {
  const target = d.state === 'mismatch' && d.gap_cents > 0 ? { p_transfer: d.id, p_shortfall: null }
    : d.shortfall?.status === 'open' ? { p_transfer: null, p_shortfall: d.shortfall.id } : null;
  if (!target || !d.can_sign) return go(back, { replace: true });
  let bearer = null, why = '', p = null;
  const dl = dialog('<div id="wo" style="padding:22px;display:flex;flex-direction:column;gap:16px"><span style="font-size:12px;color:#6B6B72">Loading…</span></div>', { onClose: () => go(back), width: 600 });
  const box = dl.querySelector('#wo');
  const ready = () => !!bearer && why.trim().length >= 20 && p.can_sign;
  const draw = async (err) => {
    p = await rpc('admin_writeoff_preview', { ...target, p_bearer: bearer });
    const after = p.month_cents + p.gap_cents, over = p.alert_cents != null && after > p.alert_cents;
    box.innerHTML = `<div>${label9(`WRITE OFF · ${p.ref}`, '#F87171')}<span class="num" style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:34px;line-height:1.1;margin-top:6px">${DH(p.gap_cents)}</span>
        <span style="display:block;font-size:12px;color:#9A9CA3;margin-top:4px">The gap between ${esc(first(p.from_name))}’s ${DH(p.declared_cents)} and ${esc(first(p.to_name))}’s ${DH(p.counted_cents)} · ${esc(p.salon)}</span></div>
      ${over ? `<div style="border:1px solid rgba(232,161,0,.35);background:rgba(232,161,0,.08);border-radius:10px;padding:10px 12px;font-size:11.5px;line-height:1.45;color:#E8A100">This takes the month’s write-offs to <b>${DH(after)}</b> — over the ${DH(p.alert_cents)} monthly alert. You can still sign it; it shows red on Cash in shops and on the overview.</div>` : ''}
      <div>${label9(`WHO LOSES THE ${DH(p.gap_cents)}`, '#6B6B72')}${bearers(bearer, p.salon, false)}<span style="display:block;font-size:11px;color:#6B6B72;margin-top:8px">Never an individual barber. A barber’s shortfall stays on their account until paid — writing it off is the only way it leaves.</span></div>
      <div style="display:flex;flex-direction:column;gap:8px">${label9('WHY · REQUIRED', '#6B6B72')}<textarea id="wo-note" rows="3" style="${input};resize:vertical">${esc(why)}</textarea><span id="wo-count" style="font-size:10.5px;color:#6B6B72">${why.trim().length < 20 ? `${20 - why.trim().length} more characters` : ''}</span></div>
      ${messages(p.messages, false)}
      ${err ? `<span style="font-size:11.5px;color:#F87171">${esc(err)}</span>` : ''}
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid #26262B;padding-top:16px"><span style="flex:1;min-width:200px;font-size:11.5px;color:#9A9CA3">Logged against your name · <b style="color:#fff">${esc(p.signer)}</b>${p.can_sign ? '' : ' · <span style="color:#F87171">finance signers only</span>'}</span>
        ${btnS('Cancel', 'data-dlg-close="1"')}${btnP('WRITE OFF &amp; SEND', 'id="wo-go"')}</div>`;
    box.querySelector('#wo-go').style.opacity = ready() ? '1' : '.45';
    const t = box.querySelector('#wo-note');
    t.oninput = () => { why = t.value; const left = 20 - why.trim().length; box.querySelector('#wo-count').textContent = left > 0 ? `${left} more characters` : ''; box.querySelector('#wo-go').style.opacity = ready() ? '1' : '.45'; };
  };
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-bearer]');
    if (b) { bearer = b.dataset.bearer; return draw(); }
    if (!e.target.closest('#wo-go') || !ready()) return;
    try {
      const args = { p_bearer: bearer, p_note: why.trim() }, title = { title: `Write off ${DH(p.gap_cents)} · ${d.ref}`, reason: why.trim() };
      const r = target.p_transfer ? await act('admin_write_off_transfer', { p_transfer: d.id, ...args }, title) : await act('admin_write_off_shortfall', { p_shortfall: target.p_shortfall, ...args }, title);
      closeDialog(); toast(`${r.ref} signed. ${bearer === 'salon' ? 'It goes on the shop’s Friday statement.' : 'A loss on our books.'} Both have been told.`);
    } catch (err) { if (!err.handled) draw(err.message); }
  });
  draw().catch((e) => { box.innerHTML = `<span style="font-size:12px;color:#F87171">${esc(e.message)}</span>`; });
}
