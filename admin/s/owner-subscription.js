// /{slug}/subscription[/plans|/how-it-is-paid|/unpaid|/<YYYY-MM>|/<invoice id>] —
// OSB-01…05 and OSH-14/15, the app's SubscriptionScreen on the web. Every number is
// a field of my_subscription / my_invoice / my_unpaid (0123, 0124), or one line of
// the arithmetic in src/lib/billing.ts on two of them (copied below, same names).
//
// Deliberately absent, as in the app (README §8 of the billing rail): an invoice
// number and a PDF — a Moroccan invoice needs a sequence and an ICE nobody has set
// up — and any SMS price.
import { esc, DH, dayShort } from '/app.js';
import { column, card, eyebrow, kv, rule } from '/s/ui.js';

// ---- src/lib/billing.ts, the pieces these pages print ------------------------
const dhFine = (c) => `${(Math.abs(c) / 100).toFixed(2).replace('.', ',')} DH`;
const planMath = (m, y, chairs) => ({
  yearAtMonthly: m * 12 * chairs, yearAtYearly: y * 12 * chairs, saving: (m - y) * 12 * chairs,
  savingPct: Math.floor((1 - y / m) * 100), monthsFree: Math.floor(12 - (y * 12) / m),
});
const friday = (dep, open) => { const nets = Math.min(open, Math.max(dep, 0)); return { nets, left: Math.max(dep, 0) - nets, carries: open - nets }; };
const perBooking = (total, n) => (n > 0 ? Math.round(total / n) : null);

const noon = (iso) => new Date(iso.length > 10 ? iso : `${iso}T12:00:00Z`);
const dayMonth = (iso) => noon(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Africa/Casablanca' });
const monthName = (iso) => noon(iso.slice(0, 10)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthOnly = (iso) => noon(iso.slice(0, 10)).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
const whyNot = (c, cap) => (c.reason === 'over_cap' ? `Past the first ${cap} chairs — free` : c.reason === 'paused' ? 'Paused — not accepting bookings'
  : c.setting_up ? 'Invited, never finished setup — not on your page' : 'Not on your shop page');
const invTitle = (i) => (i.kind === 'year' ? `The year from ${dayMonth(i.period_start)}` : i.kind === 'year_extra' ? `${monthName(i.period_start)} · chairs added`
  : `${monthName(i.period_start)} · ${i.seats_billed} chair${i.seats_billed === 1 ? '' : 's'}`);
const invSub = (i) => (i.status === 'void' ? (i.closed_reason === 'no_bookings' ? 'No chair took a booking all month' : 'Credited when you switched to the yearly plan')
  : i.status === 'written_off' ? 'Written off' : i.status === 'open' ? `${DH(i.balance_cents)} still open` : 'Settled');
const btn = (label, attrs, ghost) => `<span ${attrs} class="${ghost ? 'btn-s' : 'btn-p'}" style="height:46px;border-radius:999px;${ghost ? 'border:1px solid #3A3A40;background:#212125' : 'background:#E8442E'};display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;letter-spacing:.08em;cursor:pointer">${label}</span>`;
const initials = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export default async function ({ rpc, shop: s0, seg, go, toast }) {
  const shop = await rpc('owner_shop', { p_slug: s0.slug });
  const base = `/${shop.slug}/subscription`;
  const [p, unpaid] = await Promise.all([rpc('my_subscription'), rpc('my_unpaid').catch(() => null)]);
  const page = seg[0] || '';
  const tabs = [['This month', base, !page], ['Plans', `${base}/plans`, page === 'plans'], ['How it is paid', `${base}/how-it-is-paid`, page === 'how-it-is-paid' || /^\d{4}-\d{2}$|^[0-9a-f-]{36}$/.test(page)]]
    .concat(unpaid ? [['Unpaid', `${base}/unpaid`, page === 'unpaid']] : []);
  const out = (inner, ready) => ({ html: column(inner, tabs), ready });

  const sub = p.subscription;
  const cap = sub?.chair_cap ?? p.list.cap;
  const yearly = sub?.cycle === 'yearly';
  const billed = p.census.filter((c) => c.billable);

  // ---- OSB-02 · monthly or yearly
  if (page === 'plans') {
    const m = planMath(p.list.monthly_cents, p.list.yearly_cents, Math.max(billed.length, 1));
    const tier = (on, name, price, blurb, year) => `<div style="position:relative;background:#17171A;border:1.5px solid ${on ? '#E8442E' : '#1E1E22'};border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:10px">
      ${year ? `<span style="position:absolute;top:-10px;right:14px;background:#E8442E;border-radius:999px;padding:3px 9px;font-size:9.5px;font-weight:700;letter-spacing:.1em">${m.monthsFree} MONTH${m.monthsFree === 1 ? '' : 'S'} FREE</span>` : ''}
      <div style="display:flex;align-items:center;gap:10px"><span style="width:18px;height:18px;border-radius:999px;border:2px solid ${on ? '#E8442E' : '#3A3A40'};display:flex;align-items:center;justify-content:center">${on ? '<span style="width:8px;height:8px;border-radius:999px;background:#E8442E"></span>' : ''}</span>
        <span style="flex:1;font-size:14px;font-weight:700">${name}</span><span class="num" style="font-family:'Playfair Display',serif;font-size:30px;font-weight:700;color:${year ? '#FF7A66' : '#fff'}">${Math.round(price / 100)}</span><span style="font-size:11px;font-weight:700;color:#9A9CA3">DH / chair</span></div>
      ${rule}<span style="font-size:11.5px;line-height:1.55;color:#9A9CA3">${blurb}</span></div>`;
    const inner = `<span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">Same product either way. The yearly is cheaper because you pay once and we stop chasing you.</span>
      ${tier(!yearly, 'Monthly', p.list.monthly_cents, `Billed on the 1st for the chairs you have that morning — the first ${cap} only. Close for a whole month, pay nothing for it.`)}
      ${tier(yearly, 'Yearly', p.list.yearly_cents, `One payment for twelve months. A chair under the cap is pro-rated at ${Math.round(p.list.yearly_cents / 100)} for the months left; a chair over it is free.`, true)}
      ${card(`${eyebrow(billed.length ? `YOUR FIRST ${billed.length} CHAIRS, TWELVE MONTHS` : 'ONE CHAIR, TWELVE MONTHS')}
        ${kv('Monthly', DH(m.yearAtMonthly))}${kv('Yearly', DH(m.yearAtYearly), '#FF7A66')}${rule}
        ${kv(`Every chair past the first ${cap}`, '0 DH', '#4ADE80')}
        <div style="display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:12.5px;font-weight:700">You keep</span><span style="font-size:11px;font-weight:700;color:#4ADE80">−${m.savingPct}%</span><span class="num" style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;color:#4ADE80">${DH(m.saving)}</span></div>`)}
      <span style="font-size:11.5px;line-height:1.55;color:#9A9CA3">Switch to yearly mid-month and today’s month is credited. Switch back and the unused months come back as credit, not cash.</span>
      ${!sub ? '<span style="font-size:11.5px;color:#6B6B72;text-align:center">Your shop is not billed yet, so there is no plan to change.</span>'
        : yearly ? btn('GO BACK TO MONTHLY', 'data-cycle="monthly"', true) : btn(`PAY ${DH(m.yearAtYearly)} FOR THE YEAR`, billed.length ? 'data-cycle="yearly"' : 'style="opacity:.5"')}`;
    return out(inner, (root) => {
      root.querySelector('[data-cycle]')?.addEventListener('click', async (e) => {
        const cycle = e.currentTarget.dataset.cycle;
        const ok = confirm(cycle === 'yearly'
          ? `Pay ${DH(m.yearAtYearly)} for the year? It comes off your Friday deposits like the monthly bill. This month’s bill is credited.`
          : 'Go back to monthly? The unused whole months come back as credit, not cash.');
        if (!ok) return;
        try {
          const r = await rpc('switch_subscription_cycle', { p_cycle: cycle });
          toast(cycle === 'yearly' ? `You are on the yearly plan — ${DH(m.yearAtYearly)} comes off your Friday deposits`
            : r?.credited_cents > 0 ? `Back on monthly — ${DH(r.credited_cents)} kept as credit` : 'Back on monthly from the 1st');
          go(base);
        } catch (err) { toast(err.message, false); }
      });
    });
  }

  // ---- OSB-03 · how it gets paid, and the past invoices
  if (page === 'how-it-is-paid') {
    const fr = friday(p.friday.deposits_cents, p.friday.open_cents);
    const invs = [...p.invoices.filter((i) => i.status === 'open'), ...p.invoices.filter((i) => i.status !== 'open')];
    const month = (i) => (i.kind === 'month' ? i.period_start.slice(0, 7) : i.id);
    const inner = `<span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">Nothing new to set up. We already owe you the deposits your clients paid — the subscription comes off that on Friday.</span>
      ${card(`${eyebrow(`FRIDAY ${dayMonth(p.friday.cut_at).toUpperCase()} · SO FAR THIS WEEK`)}
        ${kv('Deposits we hold for you', DH(Math.max(p.friday.deposits_cents, 0)))}${kv('Your subscription', `− ${DH(fr.nets)}`, '#FF7A66')}${rule}
        <div style="display:flex;align-items:center;gap:12px"><span style="flex:1;font-size:13px;font-weight:700">Left of your deposits</span><span class="num" style="font-family:'Playfair Display',serif;font-size:26px;font-weight:700;color:#4ADE80">${DH(fr.left)}</span></div>
        ${fr.carries > 0 ? `<span style="font-size:11px;color:#E8A100">${DH(fr.carries)} of the bill carries to the next Friday.</span>` : ''}
        <span style="font-size:11px;line-height:1.5;color:#6B6B72">${p.friday.float_cents > 0 ? 'Same settlement, same Friday, one line more. Your top-up cash is on the same statement, and your receipt shows every number.' : 'Same settlement, same Friday, one line more. Your receipt shows both numbers.'}</span>`)}
      ${card(`${eyebrow('IF FRIDAY ISN’T ENOUGH')}
        <span style="font-size:12px;line-height:1.5">1 · A quiet week leaves less than the bill — the rest carries to next Friday. No fee, no letter.</span>
        <span style="font-size:12px;line-height:1.5">2 · Four Fridays short and we call you before anything changes on your page.</span>`)}
      <div style="background:rgba(232,161,0,${p.collection === 'agent_cash' ? '.1' : '.05'});border:1px solid rgba(232,161,0,.25);border-radius:14px;padding:12px 14px;font-size:11.5px;line-height:1.5;color:#C9CAD0">${p.collection === 'agent_cash'
        ? 'Your shop takes no deposits, so there is no Friday to net against. You pay in cash to the agent — the only path we have until a card rail exists.'
        : 'A shop that takes no deposits has no Friday to net against. Those shops pay in cash to the agent — the only path we have until a card rail exists.'}</div>
      ${eyebrow('PAST INVOICES')}
      ${invs.map((i) => `<a href="${base}/${month(i)}" class="hov" style="display:flex;align-items:center;gap:12px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:13px 14px;text-decoration:none;color:#fff">
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:12px;font-weight:600">${esc(invTitle(i))}</span><span style="font-size:10.5px;color:#6B6B72">${esc(invSub(i))}</span></span>
        <span class="num" style="font-size:12px;font-weight:700;color:${i.status === 'open' ? '#E8A100' : i.status === 'settled' ? '#fff' : '#4ADE80'}">${i.status === 'void' ? '0 DH' : DH(i.total_cents)}</span></a>`).join('') || '<span style="font-size:11.5px;color:#6B6B72">No invoice yet.</span>'}
      <span style="font-size:10.5px;color:#6B6B72;text-align:center">No card. No RIB. No transfer fee. It is the same cash you already collect.</span>`;
    return out(inner);
  }

  // ---- OSB-05 · unpaid
  if (page === 'unpaid') {
    if (!unpaid) throw new Error('not_found');
    const u = unpaid, now = u.rung;
    const rung = (dot, title, subl, dim) => `<div style="display:flex;gap:11px;${dim ? 'opacity:.5' : ''}"><span style="width:9px;height:9px;border-radius:999px;background:${dot};margin-top:5px;flex:none"></span><span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(title)}</span><span style="font-size:11px;line-height:1.5;color:#9A9CA3">${esc(subl)}</span></span></div>`;
    const inner = `${card(`${eyebrow(`UNPAID · ${u.days} DAYS`, '#FF7A66')}
        <div style="display:flex;align-items:baseline;gap:10px"><span class="num" style="font-family:'Playfair Display',serif;font-size:38px;font-weight:700">${DH(u.balance_cents)}</span><span style="font-size:12px;color:#9A9CA3">for ${esc(u.kind === 'month' ? monthOnly(u.period_start) : monthName(u.period_start))}</span></div>
        <span style="font-size:12px;line-height:1.55">${now === 'open' ? (u.short_fridays === 1 ? 'One Friday, your deposits didn’t cover it.' : `${u.short_fridays} Fridays running, your deposits didn’t cover it.`) + ' Nothing has changed on your page yet.'
          : now === 'search_hidden' ? 'New clients can’t find you in search right now. Your own clients, your link and your QR still work.'
            : 'New appointments are closed. Every booking already in the book is still honoured.'}</span>`, 'border-color:rgba(255,122,102,.35)')}
      ${card(`${eyebrow('WHAT HAPPENS, AND WHEN')}
        ${rung('#4ADE80', 'Today — nothing', 'Bookings, queue, wall display, all normal.', now !== 'open')}
        ${rung('#E8A100', `${dayMonth(u.hidden_on)} — off search`, 'New clients stop finding you. Your own clients, your link and your QR keep working.', now === 'bookings_closed')}
        ${rung('#E8442E', `${dayMonth(u.closed_on)} — bookings close`, 'No new appointments. Every booking already in the book is still honoured.')}
        ${u.called ? '' : '<span style="font-size:11px;color:#6B6B72">Neither step happens before we have called you.</span>'}`)}
      ${card(`${eyebrow('WHAT WE NEVER DO')}${['Cancel a client’s appointment over your bill', 'Hold back deposits that are already yours', 'Delete your shop, your history or your ratings']
        .map((x) => `<span style="font-size:11.5px;line-height:1.5"><span style="color:#4ADE80">✓</span> ${x}</span>`).join('')}`)}
      ${u.cash_requested_at ? `<span style="font-size:11.5px;color:#9A9CA3;text-align:center">You asked for the agent on ${esc(dayMonth(u.cash_requested_at))}. They are coming for ${DH(u.balance_cents)}.</span>`
        : btn(`PAY ${DH(u.balance_cents)} IN CASH TO THE AGENT`, 'data-agent="1"')}
      <span style="font-size:10.5px;color:#6B6B72;text-align:center">Or leave it — next Friday’s deposits clear it automatically.</span>`;
    return out(inner, (root) => root.querySelector('[data-agent]')?.addEventListener('click', async () => {
      try { await rpc('request_subscription_collection'); toast(`We will send the agent — pay ${DH(u.balance_cents)} in cash`); go(`${base}/unpaid`, { replace: true }); }
      catch (e) { toast(e.message, false); }
    }));
  }

  // ---- OSB-04 / OSH-14 / OSH-15 · one invoice, by month or by id
  if (page) {
    const hit = p.invoices.find((i) => i.id === page || (i.kind === 'month' && i.period_start.startsWith(page)));
    if (!hit) throw new Error('not_found');
    const inv = await rpc('my_invoice', { p_invoice: hit.id });
    const per = perBooking(inv.total_cents, inv.bookings);
    const perY = inv.kind === 'month' ? perBooking(inv.seats_billed * inv.yearly_unit_cents, inv.bookings) : null;
    const [chipT, chipC] = inv.status === 'settled' ? ['SETTLED', '#4ADE80'] : inv.status === 'open' ? ['OPEN', '#E8A100'] : inv.status === 'void' ? ['NOT BILLED', '#9A9CA3'] : ['WRITTEN OFF', '#9A9CA3'];
    const range = inv.kind === 'month' ? `${inv.period_start.slice(8, 10)}–${Number(inv.period_end.slice(8, 10))} ${monthOnly(inv.period_start)}` : `${dayMonth(inv.period_start)} – ${dayMonth(inv.period_end)}`;
    const pay = (x) => (x.method === 'cash' ? `Paid in cash to the agent on ${dayMonth(x.at)} — ${DH(x.cents)}.`
      : x.direction === 'pay_out' ? `Netted off your week ${(x.week || '').slice(-2)} settlement — you received ${DH(x.line_cents || 0)} instead of ${DH(x.without_cents || 0)}.`
        : x.direction === 'collect' ? `Netted off your week ${(x.week || '').slice(-2)} settlement — you handed over ${DH(x.line_cents || 0)} instead of ${DH(x.without_cents || 0)}.`
          : `Netted off your week ${(x.week || '').slice(-2)} deposits — ${DH(x.cents)}, and nothing else had to cross the counter.`);
    const inner = `${card(`<div style="display:flex;align-items:flex-start;gap:12px"><span style="flex:1;display:flex;flex-direction:column;gap:4px">${eyebrow(inv.salon.toUpperCase())}<span style="font-family:'Playfair Display',serif;font-size:20px;font-weight:700">${esc(range)}</span></span>
          <span style="font-size:10.5px;font-weight:700;color:${chipC};background:${chipC}1F;border-radius:999px;padding:4px 9px">${chipT}</span></div>${rule}
        ${kv(`Chairs billed on ${dayMonth(inv.counted_at)}`, String(inv.seats_billed))}
        ${kv(inv.kind === 'month' ? 'Per chair · monthly' : `Per chair · ${inv.months} month${inv.months === 1 ? '' : 's'} at the yearly price`, inv.kind === 'month' ? DH(inv.unit_price_cents) : DH(inv.unit_price_cents * inv.months))}
        ${inv.sms_month ? kv(`SMS to clients with no app · ${monthOnly(inv.sms_month)}`, `${inv.sms_used} of ${inv.sms_included} · ${DH(inv.sms_charged_cents)}`, inv.sms_charged_cents ? '#fff' : '#4ADE80') : ''}
        ${inv.credit_cents > 0 ? kv('Credit from earlier', `− ${DH(inv.credit_cents)}`, '#4ADE80') : ''}
        ${kv('Commission taken by Sterncut', 'None', '#4ADE80')}${rule}
        <div style="display:flex;align-items:center;gap:12px"><span style="flex:1;font-size:13px;font-weight:700">Invoice total</span><span class="num" style="font-family:'Playfair Display',serif;font-size:30px;font-weight:700">${DH(inv.total_cents)}</span></div>
        ${inv.payments.map((x) => `<span style="font-size:11.5px;line-height:1.5"><span style="color:#4ADE80">✓</span> ${esc(pay(x))}</span>`).join('')}
        ${inv.status === 'open' ? `<span style="font-size:11px;color:#E8A100">${DH(inv.balance_cents)} still open — it comes off your next Friday deposits.</span>` : ''}`)}
      ${per != null ? card(`${eyebrow('WHAT IT COST YOU PER CUT')}<div style="display:flex;gap:14px;align-items:center"><span style="display:flex;flex-direction:column"><span class="num" style="font-family:'Playfair Display',serif;font-size:32px;font-weight:700">${dhFine(per)}</span><span style="font-size:10.5px;color:#9A9CA3">per booking</span></span>
        <span style="flex:1;font-size:11.5px;line-height:1.5;color:#9A9CA3">${perY != null ? `${inv.bookings} booking${inv.bookings === 1 ? '' : 's'} in ${esc(monthOnly(inv.period_start))}. On the yearly plan the same month would have cost ${dhFine(perY)} a booking.` : `${inv.bookings} booking${inv.bookings === 1 ? '' : 's'} in the period.`}</span></div>`) : ''}
      ${card(`${eyebrow('WHO WAS COUNTED')}${inv.seats.map((z) => `<div style="display:flex;gap:12px"><span style="flex:1;font-size:12px;font-weight:${z.billable ? 700 : 500};color:${z.billable ? '#fff' : '#9A9CA3'}">${esc(z.name)}</span><span style="font-size:10.5px;color:${z.billable ? '#9A9CA3' : '#6B6B72'}">${z.billable ? 'Billed' : z.reason === 'over_cap' ? 'Past the cap — free' : z.reason === 'paused' ? 'Paused' : z.reason === 'paid_this_term' ? 'Already paid this year' : 'Not on your page'}</span></div>`).join('')}`)}
      <span style="font-size:11.5px;line-height:1.55;color:#9A9CA3">A downloadable invoice needs a legal invoice number and an ICE. Nobody has set those up yet, so there is no PDF.</span>`;
    return out(inner);
  }

  // ---- OSB-01 · what you pay on the 1st
  const unit = sub?.unit_price_cents ?? p.list.monthly_cents;
  const cents = billed.length * unit;
  const hero = !sub ? cents : yearly ? (sub.term_seats ?? 0) * sub.unit_price_cents * 12 : cents;
  const math = planMath(sub ? (yearly ? p.list.monthly_cents : sub.unit_price_cents) : p.list.monthly_cents, p.list.yearly_cents, Math.max(billed.length, 1));
  const notCounted = p.census.filter((c) => !c.billable);
  const soon = p.census.find((c) => !c.billable && c.reason === 'not_on_page' && c.setting_up);
  const seat = (c) => `<div style="display:flex;align-items:center;gap:11px"><span style="width:30px;height:30px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(c.name))}</span>
    <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(c.name)}</span><span style="font-size:10.5px;color:#9A9CA3">${c.me ? 'You — and you cut' : 'On your page · taking bookings'}</span></span>
    <span class="num" style="font-size:12px;font-weight:700">${DH(unit)}</span></div>`;
  const inner = `${unpaid ? `<a href="${base}/unpaid" style="display:flex;align-items:center;gap:10px;background:rgba(255,122,102,.08);border:1px solid rgba(255,122,102,.35);border-radius:14px;padding:12px 14px;text-decoration:none;color:#fff;font-size:12.5px;font-weight:700">Unpaid · ${unpaid.days} days · ${DH(unpaid.balance_cents)}</a>` : ''}
    <div style="display:flex;flex-direction:column;gap:6px">${eyebrow(!sub ? `NOT BILLED YET · ${billed.length} CHAIRS` : yearly ? `THE YEAR · ${sub.term_seats ?? 0} CHAIRS` : `DUE ${dayMonth(p.next_count).toUpperCase()} · ${billed.length} CHAIRS`)}
      <span class="num" style="font-family:'Playfair Display',serif;font-size:44px;font-weight:700;line-height:1.1">${DH(hero)}</span>
      <span style="font-size:12px;line-height:1.55;color:#9A9CA3">${!sub ? 'Sterncut tells you before your first bill. This is what it would be as your shop stands today.'
        : yearly ? `Renews ${esc(dayMonth(sub.renews_on))}. Only chairs you add before then are billed, for the months left.` : `As your shop stands today. Counted again on ${esc(dayMonth(p.next_count))}.`}</span></div>
    <a href="${base}/plans" class="hov" style="display:flex;align-items:center;gap:12px;background:#17171A;border:1px solid #1E1E22;border-radius:18px;padding:15px 16px;text-decoration:none;color:#fff">
      <span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:13px;font-weight:700">${yearly ? `Yearly · ${DH(sub.unit_price_cents)} per chair` : `Monthly · ${DH(unit)} per chair`}</span>
        <span style="font-size:11.5px;color:#9A9CA3">${yearly ? `${math.monthsFree} month${math.monthsFree === 1 ? '' : 's'} free against monthly.` : `Pay yearly and keep ${DH(math.saving)} a year`}</span></span>
      <span style="font-size:11.5px;font-weight:700;background:#212125;border-radius:999px;padding:6px 12px">Change</span></a>
    ${card(`${eyebrow(`WHAT YOU’RE PAYING FOR · ${billed.length} CHAIRS`)}${billed.map(seat).join('') || '<span style="font-size:11.5px;color:#9A9CA3">Nobody on your page is taking bookings, so there is nothing to pay.</span>'}
      ${notCounted.length ? `${rule}${eyebrow(`NOT COUNTED · ${notCounted.length}`, '#6B6B72')}${notCounted.map((c) => `<div style="display:flex;gap:12px"><span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12px;font-weight:600;color:#9A9CA3">${esc(c.name)}</span><span style="font-size:10.5px;color:#6B6B72">${esc(whyNot(c, cap))}</span></span><span style="font-size:11.5px;font-weight:700;color:#4ADE80">0 DH</span></div>`).join('')}` : ''}`)}
    ${soon ? `<div style="background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.25);border-radius:14px;padding:12px 14px;font-size:11.5px;line-height:1.5">${esc(soon.name)} is still finishing their setup — a chair counts once it’s on your page${billed.length >= cap ? '. And you’re already at the cap, so when they’re live they cost you <b>nothing</b>.' : ', from the next 1st.'}</div>` : ''}
    <a href="${base}/how-it-is-paid" class="hov" style="display:flex;align-items:center;gap:10px;border-radius:14px;padding:12px 4px;text-decoration:none;color:#fff;font-size:12.5px;font-weight:700"><span style="flex:1">How it gets paid</span><span style="color:#9A9CA3">›</span></a>
    <span style="font-size:10.5px;line-height:1.5;color:#6B6B72">A chair counts if it’s on your shop page and taking bookings — only the first ${cap} are billed, ever. SMS this month: ${p.sms.used} of ${p.sms.included} included.</span>`;
  return out(inner);
}
