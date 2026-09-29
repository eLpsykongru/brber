// /{slug}/payouts[/2026-W36][?late=<ref>] — OSH-16/17/18 as the web lays them out.
// The same statement the app and FIN-16 draw, off the same builder
// (statement_json via my_statement, 0086): nothing here adds anything up.
//
// §2.7's rule, kept from the app: the owing direction is not a minus sign on the
// paid layout — a different sentence, a different colour, "this is not a bill".
// The agent's four digits are not shown here: my_visit_code rotates the code, and
// minting it on the web would change the one the app is showing him.
import { esc, DH, hhmm, dayWk as day } from '/app.js';

const W = (label) => String(label || '').slice(-2);
const when = (iso) => (iso ? `${day(iso)} ${hhmm(iso)}` : '');
const chip = (t, c) => `<span style="font-size:8.5px;letter-spacing:.12em;font-weight:700;color:${c};background:${c}1F;border-radius:999px;padding:3px 7px">${t}</span>`;
const line = (label, sub, amount, opts = {}) => `
  <div ${opts.go ? `data-go="${esc(opts.go)}"` : ''} class="${opts.go ? 'hov' : ''}" style="display:flex;align-items:center;gap:14px;padding:12px ${opts.go ? '10px' : '0'};${opts.go ? 'margin:0 -10px;border-radius:10px;cursor:pointer;' : ''}border-top:1px solid ${opts.strong ? '#3A3A40' : '#26262B'}">
    <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="font-size:12.5px;font-weight:${opts.strong ? 700 : 600};color:${opts.color || '#fff'}">${esc(label)}</span>${sub ? `<span style="font-size:10.5px;color:#9A9CA3">${esc(sub)}</span>` : ''}${opts.why ? `<span style="font-size:10.5px;font-weight:700;color:#E8442E">${esc(opts.why)}</span>` : ''}</span>
    <span class="num" style="flex:none;font-size:13px;font-weight:${opts.strong ? 800 : 700};color:${opts.color || '#fff'}">${esc(amount)}</span>
  </div>`;
const signed = (sign, c) => `${sign} ${DH(Math.abs(c))}`;

export default async function ({ rpc, shop: s0, seg, q, go, toast }) {
  const shop = await rpc('owner_shop', { p_slug: s0.slug });
  const base = `/${shop.slug}/payouts`;
  let p = await rpc('my_statement', { p_week: null });
  const want = seg[0];
  if (want && p.statement && p.statement.week !== want) {
    const w = (p.weeks || []).find((x) => x.week === want);
    if (!w) throw new Error('not_found');
    p = await rpc('my_statement', { p_week: w.covers_to });
  }
  const vs = await rpc('my_visit_status').catch(() => null);
  const s = p.statement;
  const held = p.held && p.held.reason === 'suspended' ? p.held : null;

  const heldCard = held ? `<div style="background:#17171A;border:1px solid rgba(232,161,0,.3);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:5px">
    <span style="font-size:12.5px;font-weight:700">${held.amount_cents != null ? `${DH(held.amount_cents)} held while the shop is suspended` : 'Held while the shop is suspended'}</span>
    <span style="font-size:11.5px;line-height:1.5;color:#9A9CA3">It is yours and it is not kept.${held.unlocks_on ? ` It unlocks on ${esc(day(held.unlocks_on + 'T12:00:00Z'))}.` : ''}${held.told_by ? ` ${esc(held.told_by)} told you.` : ''}</span></div>` : '';

  if (!s) {
    return { top: true, html: `<div style="height:100%;overflow:auto"><div style="padding:20px 24px;max-width:640px;display:flex;flex-direction:column;gap:14px">${heldCard}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:22px;font-size:12.5px;line-height:1.6;color:#9A9CA3">No week has been closed yet. Statements are cut on Friday evening and cover the seven days before.</div></div></div>` };
  }

  const pay = s.direction === 'pay_out', nil = s.direction === 'nil';
  const accent = nil ? '#9A9CA3' : pay ? '#4ADE80' : '#E8A100';
  const status = s.settled_at ? (pay ? ['PAID', '#4ADE80'] : ['COLLECTED', '#4ADE80']) : nil ? ['CLOSED', '#9A9CA3'] : ['DUE FRIDAY', '#E8A100'];
  const pend = vs?.pending;
  const lede = s.settled_at
    ? `<span style="color:#fff;font-weight:700">${esc(s.agent || 'An agent')} ${pay ? 'brought it' : 'counted it with you'} ${esc(when(s.settled_at))}.</span>${pay ? ' You counted it and signed.' : ''}${s.receipt_ref ? ` Receipt ${esc(s.receipt_ref)}.` : ''}`
    : nil ? 'No cash moved either way this week. You still get the statement — a nil week is a fact, not a gap.'
      : pay ? `<span style="color:#fff;font-weight:700">${esc(pend?.agent || 'An agent')} brings it${pend?.window_from ? ` Friday between ${hhmm(pend.window_from)} and ${hhmm(pend.window_to)}` : ' on Friday'}</span>. Count it with them and sign.`
        : `Have it ready in the till. <span style="color:#fff;font-weight:700">${esc(pend?.agent || 'An agent')} comes Friday${pend?.window_from ? ` between ${hhmm(pend.window_from)} and ${hhmm(pend.window_to)}` : ' between 17:00 and 20:00'}</span>, counts it with you and leaves a receipt.`;

  // the lines, in the app's order: our float first when he holds it, his earnings first when we owe him
  const rows = [];
  const bill = (sign) => (s.subscription_lines || []).map((x) => line(
    x.invoice_kind === 'year' ? `The year from ${day(x.period_start)}` : `${new Date(x.period_start.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · ${x.seats} chair${x.seats === 1 ? '' : 's'}${x.invoice_kind === 'year_extra' ? ' added' : ''}`,
    `${x.ref} · ${when(x.at)}`, signed(sign, x.cents), { color: '#FF7A66' }));
  const float = (sign) => s.float_lines.length ? [line(pay ? 'Our cash your barbers took' : 'Our cash in your till',
    `${s.float_lines.length} top-up${s.float_lines.length === 1 ? '' : 's'} · ${s.float_lines.slice(0, 4).map((x) => x.ref).join(', ')}${s.float_lines.length > 4 ? '…' : ''}`, signed(sign, s.hold_cents))] : [];
  const earned = (sign) => {
    const cuts = s.earned_lines.filter((x) => x.kind !== 'refund'), refunds = s.earned_lines.filter((x) => x.kind === 'refund');
    const out = [];
    if (cuts.length) out.push(line('Deposits you earned', `${cuts.length} cut${cuts.length === 1 ? '' : 's'} · ${cuts[0].ref}${cuts.length > 1 ? ' → ' + cuts[cuts.length - 1].ref : ''}`, signed(sign, cuts.reduce((a, x) => a + x.cents, 0)), { color: '#4ADE80' }));
    for (const x of refunds) out.push(line('Refund · deposit given back', `${x.ref} · refunded ${when(x.at)}`, signed(sign === '+' ? '−' : '+', x.cents)));
    return out;
  };
  if (pay) rows.push(...earned('+'), ...bill('−'), ...float('−'));
  else rows.push(...float('+'), ...earned('−'), ...bill('+'));
  if (s.carried_lines.length) {
    rows.push(line('This week', '', DH(s.subtotal_cents), { strong: true }));
    for (const x of s.carried_lines) {
      const sign = x.cents >= 0 ? '+' : '−';
      if (/^(TRF|WO)-/.test(x.ref)) {
        rows.push(line(x.ref.startsWith('WO-') ? (x.cents >= 0 ? `Write-off ${x.ref} · the shop bears it` : `Write-off ${x.ref} reversed`)
          : (x.cents < 0 ? `Handover ${x.ref} came up short · on the barber, not the shop` : `Handover ${x.ref} · the shortfall was paid back`),
        when(x.at), signed(sign, x.cents), { color: '#E8A100' }));
      } else {
        rows.push(line(`From week ${W(x.source_week)} · a refund`, `${x.ref} · refunded ${when(x.at)}`, signed(sign, x.cents),
          { go: `${base}/${s.week}?late=${encodeURIComponent(x.ref)}`, why: 'Why is it on this week?' }));
      }
    }
  }
  rows.push(line(nil ? 'Nothing to move' : pay ? 'We hand you' : 'You put on the counter', '', DH(s.total_cents), { strong: true }));

  const weeks = (p.weeks || []).slice(0, 8);
  const weekCard = (w) => {
    const on = w.week === s.week;
    return `<a href="${base}/${esc(w.week)}" style="display:flex;flex-direction:column;gap:5px;padding:13px 14px;border-radius:12px;text-decoration:none;color:#fff;background:${on ? '#17171A' : 'transparent'};border:1px solid ${on ? '#3A3A40' : '#1E1E22'}">
      <span style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span style="font-size:12.5px;font-weight:700">Week ${esc(W(w.week))}</span>${on ? chip(...status) : ''}</span>
      <span class="num" style="font-size:17px;font-weight:800">${DH(w.total_cents)}</span>
      <span style="font-size:10.5px;color:#9A9CA3">${w.direction === 'pay_out' ? 'We owe you' : w.direction === 'nil' ? 'Nothing moved' : 'You are holding ours'}</span></a>`;
  };

  const late = q.get('late') && s.carried_lines.find((x) => x.ref === q.get('late'));
  const lw = s.last_week;
  const drawer = late ? `
    <a href="${base}/${s.week}" style="position:absolute;inset:0;z-index:6;background:rgba(5,5,6,.45)"></a>
    <div style="position:absolute;top:0;right:0;bottom:0;z-index:7;width:min(380px,100%);overflow:auto;border-left:1px solid #26262B;box-shadow:-24px 0 60px rgba(0,0,0,.45)">
      <div style="min-height:100%;background:#17171A;padding:20px;display:flex;flex-direction:column;gap:16px;box-sizing:border-box">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><span style="font-size:14px;font-weight:800">One line explained</span>
          <a href="${base}/${s.week}" aria-label="Close" style="width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9A9CA3"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg></a></div>
        <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">ON WEEK ${esc(W(s.week))} · CARRIED FROM WEEK ${esc(W(late.source_week))}</span><span class="num" style="font-size:26px;font-weight:800">${signed(late.cents >= 0 ? '+' : '−', late.cents)}</span></div>
        <div style="display:flex;flex-direction:column;background:#111113;border:1px solid #1E1E22;border-radius:12px;padding:2px 13px">
          ${[['Booking', late.ref], ['Refunded', when(late.at)], ['From', `Week ${W(late.source_week)}`]].map(([k, v], i) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;${i ? 'border-top:1px solid #1E1E22;' : ''}font-size:11.5px"><span style="color:#9A9CA3">${k}</span><span style="font-weight:700">${esc(v)}</span></div>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:12.5px;font-weight:700">Why it is on this week and not last week</span>
          <span style="font-size:12px;line-height:1.6;color:#C9CAD0">Your week ${esc(W(late.source_week))} statement is closed${lw ? ` and the ${DH(lw.total_cents)} ${lw.direction === 'pay_out' ? 'you were paid' : 'you counted'}` : ' and the amount you counted'} was right when you counted it. We do not go back and change a week you have already been settled for — you would be holding a receipt that no longer matches. Money that moves late arrives as its own line on the next statement, with the old booking on it.</span></div>
        ${lw ? `<a href="${base}/${esc(lw.week)}" style="display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:11px;background:#111113;border:1px solid #1E1E22;text-decoration:none;color:#fff">
          <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span class="num" style="font-size:12px;font-weight:700">Week ${esc(W(lw.week))} · ${DH(lw.total_cents)}</span><span style="font-size:10.5px;color:#9A9CA3">Unchanged</span></span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B72" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg></a>` : ''}
        <span data-dispute="1" style="height:40px;border-radius:10px;border:1px solid #26262B;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;letter-spacing:.08em;color:#C9CAD0;cursor:pointer">THIS ISN’T RIGHT</span>
      </div>
    </div>` : '';

  const numbers = [`Week ${W(s.week)} · ${s.ref}`, `Covers ${day(s.covers_from)} 21:00 → ${day(s.covers_to)} 21:00`, ...s.float_lines.concat(s.earned_lines, s.carried_lines).map((x) => `${x.ref} ${x.label || ''} ${DH(x.cents)}`), `${nil ? 'Nothing to move' : pay ? 'We hand you' : 'You put on the counter'}: ${DH(s.total_cents)}`].join('\n');

  const html = `<div style="position:relative;height:100%">
  <div style="position:absolute;inset:0;overflow:auto">
  <div style="padding:20px 24px 32px;display:flex;flex-wrap:wrap;align-items:flex-start;gap:18px;box-sizing:border-box">
    <div style="flex:1 1 220px;max-width:260px;min-width:200px;display:flex;flex-direction:column;gap:8px">
      <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72;padding:0 2px 4px">FRIDAY STATEMENTS</span>
      ${weeks.map(weekCard).join('')}
    </div>
    <div style="flex:999 1 480px;min-width:0;display:flex;flex-direction:column;gap:14px">
      ${heldCard}
      ${pend && pend.direction === 'collect' && !s.settled_at ? `<div style="background:rgba(232,68,46,.08);border:1px solid rgba(232,68,46,.3);border-radius:12px;padding:12px 14px;font-size:11.5px;line-height:1.5;color:#C9CAD0">The four digits ${esc(pend.agent)} asks for are in the Sterncut app, under this week’s statement. They change after every visit.</div>` : ''}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:18px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:${accent}">WEEK ${esc(W(s.week))} · ${nil ? 'NOTHING MOVED' : pay ? 'WE OWE YOU' : 'YOU ARE HOLDING OURS'}</span>${chip(...status)}</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="num" style="font-size:34px;font-weight:800;letter-spacing:-.01em">${DH(s.total_cents)}</span>
          <span style="font-size:13px;line-height:1.55;color:#C9CAD0;max-width:540px">${lede}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:11px;color:#9A9CA3">
          <span style="background:#111113;border:1px solid #26262B;border-radius:7px;padding:5px 9px">Covers ${esc(day(s.covers_from))} 21:00 → ${esc(day(s.covers_to))} 21:00</span>
          ${!pay && !nil ? '<span>This is not a bill.</span>' : ''}
        </div>
        <div style="display:flex;flex-direction:column">
          <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72;padding-bottom:6px">HOW IT ADDS UP</span>
          ${rows.join('')}
        </div>
        <span style="font-size:11px;line-height:1.55;color:#6B6B72">${(s.subscription_lines || []).length
          ? 'Sterncut takes no commission and no fee on cash. The subscription is the only charge and it has its own line.'
          : 'Sterncut takes no fee from either side.'} Every line carries its reference and the minute it happened, so you can check any one of them against your own day.</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><span data-copy="1" style="height:36px;border-radius:9px;background:#212125;display:flex;align-items:center;padding:0 14px;font-size:11px;font-weight:700;letter-spacing:.08em;cursor:pointer">COPY THE NUMBERS</span></div>
      </div>
    </div>
  </div></div>${drawer}</div>`;

  return {
    html,
    ready(root) {
      root.querySelector('[data-copy]').onclick = async () => { await navigator.clipboard?.writeText(numbers).catch(() => {}); toast('Copied'); };
      root.querySelector('[data-dispute]')?.addEventListener('click', async () => {
        try {
          // §5: there is no dispute state in the product — it opens a support case and says so
          await rpc('file_support_case', { p_booking: null, p_reason: 'wrong_amount',
            p_detail: `Carried line on my statement: ${late.ref}, ${DH(late.cents)}, from week ${W(late.source_week)}. I don't think this is right.` });
          toast('Sent to Sterncut — someone looks at this line and comes back to you');
          go(`${base}/${s.week}`);
        } catch (e) { toast(e.message, false); }
      });
    },
  };
}
