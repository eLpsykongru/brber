// /finance/charges[?call=|?cash=|?waive=<invoice>|?start=1] native; the rest of /finance framed.
// The run, statements, corrections and the float (FIN-14…19) stay the old console in a
// frame: its screens already are those canvases. Billing had a backend (0123/0124) and no
// screen anywhere, so it is built here: FIN-12's "to collect" on the real invoices, the
// ladder they climb when nothing nets them, and the three things ops can do — log the
// call, record cash, write it off with a reason. Carrying is the default: an open invoice
// nets off the shop's next Friday statement by itself.
// Not as drawn: FIN-11's per-barber + per-cut model and free months aren't what 0123
// bills (one subscription per shop, netted weekly); FIN-01/02/03/13 have no backend.
import { esc, DH, dayShort, ago, framed } from '/app.js';
import { pageHead, chips, label9, btnS, btnP, csv } from '/s/ui.js';

const RUNG = { open: ['OPEN', '#9A9CA3'], search_hidden: ['HIDDEN FROM SEARCH', '#E8A100'], bookings_closed: ['BOOKINGS CLOSED', '#F87171'] };
const pill = ([t, c]) => `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:3px 7px;white-space:nowrap">${esc(t)}</span>`;
const kpi = (l, v, s, col) => `<div style="flex:1 1 180px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:22px;font-weight:800${col ? ';color:' + col : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
const month = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'Africa/Casablanca' });
const input = 'background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none';
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };

export default async function (ctx) {
  if (ctx.seg[0] !== 'charges') return framed(ctx.path);
  return charges(ctx);
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
    ${chips([['Settlement run', '/finance', false], ['Charges', '/finance/charges', true], ['Corrections', '/finance/corrections', false], ['Float', '/finance/float', false]])}
    <div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('OPEN INVOICES', rows.length, `${DH(bal)} still to reach us`)}
        ${kpi('NEEDS A CALL', calls.length, 'four short Fridays and nobody has rung', calls.length ? '#E8442E' : '')}
        ${kpi('NOTHING TO NET AGAINST', dry.length, 'shops taking 0% deposit', dry.length ? '#E8A100' : '')}
        ${kpi('NOT BILLED YET', unbilled, `live shop${unbilled === 1 ? '' : 's'} with no subscription`)}</div>
      ${unbilled ? `<div style="display:flex;align-items:center;gap:12px;background:#111113;border:1px solid #26262B;border-radius:12px;padding:12px 15px;font-size:12px;color:#9A9CA3;line-height:1.5;flex-wrap:wrap"><span style="flex:1;min-width:240px">${unbilled} live shop${unbilled === 1 ? ' isn’t' : 's aren’t'} on a subscription. Starting billing puts each on ${ps[0] ? DH(ps[0].sub_monthly_cents) : 'the standard price'} a month from the first of a month; shops already billed are untouched.</span>${btnS('Start billing', 'data-go="/finance/charges?start=1"')}</div>` : ''}
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
        const dl = dialog(form('Start billing', `${unbilled} live shop${unbilled === 1 ? '' : 's'} with no subscription go on ${ps[0] ? DH(ps[0].sub_monthly_cents) : 'the standard price'} a month. It always starts on the first of a month; any other date moves to the next first.`,
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
