// /barbers[?filter=look|all|cancels|rating] and /barbers/<id> — BRB-09 (the
// roster, 0066's admin_barbers) and BRB-03/15 (his file, 0136's admin_barber, with
// 0066's admin_barber_cost for what acting on him would cost). His cancellations
// and his reviews (BRB-05, BRB-18) are sections of the file, not pages of their own.
//
// Not built (no backend): suspending, capping or hiding a single barber (BRB-04,
// 07, 08), moving barbers between shops (BRB-17/25), the cap reviews and notices
// (BRB-26…28), the cancellation-reason settings and refusals (BRB-29, 31, 33), the
// never-turns-on-the-queue tab (BRB-13, 19…21).
import { esc, DH, num, initials, dayShort, hhmm } from '/app.js';
import { pageHead, chips, label9, csv, btnS, profile } from '/s/ui.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function (ctx) {
  const id = ctx.seg[0];
  if (!id) return roster(ctx);
  if (!UUID.test(id)) throw new Error('not_found');
  return file(ctx, id);
}

async function roster({ rpc, q, toast }) {
  const d = await rpc('admin_barbers');
  const look = d.rows.filter((b) => b.flagged);
  // opens on who needs a look — or on everyone, when nobody does
  const filter = ['all', 'cancels', 'rating', 'look'].includes(q.get('filter')) ? q.get('filter') : look.length ? 'look' : 'all';
  const rows = filter === 'look' ? look
    : filter === 'cancels' ? d.rows.filter((b) => b.cancel_pct != null).sort((a, b) => b.cancel_pct - a.cancel_pct)
      : filter === 'rating' ? d.rows.filter((b) => b.rating != null && b.rating < 4).sort((a, b) => a.rating - b.rating)
        : d.rows;
  const kpi = (l, v, s) => `<div style="flex:1;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 15px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:24px;font-weight:700">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
  const ACT = { review: 'REVIEW', open: 'OPEN', message: 'MESSAGE' };
  const row = (b) => `<a href="/barbers/${b.id}" data-row="${esc((b.name + ' ' + b.shop).toLowerCase())}" class="hov" style="display:flex;align-items:center;gap:12px;padding:13px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;${b.flagged ? 'box-shadow:inset 3px 0 0 #F87171' : ''}">
    <span style="width:230px;flex:none;display:flex;align-items:center;gap:9px;min-width:0"><span style="width:30px;height:30px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(b.name))}</span>
      <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:700">${esc(b.name)}</span><span style="display:block;font-size:10px;color:#9A9CA3;margin-top:1px">${b.owner ? 'Owner · ' : ''}since ${esc(new Date(b.since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))}</span></span></span>
    <span style="width:150px;flex:none;font-size:11.5px;color:#D8D8DC">${esc(b.shop || '—')}</span>
    <span style="flex:1;min-width:0;font-size:11.5px;color:${b.flagged ? '#D8D8DC' : '#6B6B72'}">${esc(b.why || '')}</span>
    <span class="num" style="width:56px;flex:none;font-size:12px;font-weight:700">${b.rating == null ? '—' : b.rating}</span>
    <span class="num" style="width:56px;flex:none;font-size:12px;color:${b.cancel_pct >= 15 ? '#F87171' : '#9A9CA3'}">${b.cancel_pct == null ? '—' : b.cancel_pct + '%'}</span>
    <span style="width:84px;flex:none;text-align:right">${b.action ? `<span style="font-size:10px;font-weight:800;letter-spacing:.06em;color:#0D0D0F;background:#E8A100;border-radius:6px;padding:5px 9px">${ACT[b.action] || 'OPEN'}</span>` : ''}</span></a>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Barbers', `Tangier · ${num(d.total)}`, btnS('Export CSV', 'id="bb-csv"'))}
    ${chips([['Needs a look', '/barbers?filter=look', filter === 'look', look.length], ['All', '/barbers?filter=all', filter === 'all'], ['Most cancels', '/barbers?filter=cancels', filter === 'cancels'], ['Rated under 4.0', '/barbers?filter=rating', filter === 'rating', d.below_four]],
      `<input id="bb-q" placeholder="Barber or shop" style="height:30px;width:200px;border-radius:8px;background:#17171A;border:1px solid #26262B;padding:0 11px;color:#fff;font-size:11.5px;outline:none">`)}
    <div style="flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px">${kpi('CUTTING THIS WEEK', `${d.cutting}<span style="font-size:12px;font-weight:400;color:#9A9CA3"> / ${d.total}</span>`, `${d.idle} idle 14+ days`)}${kpi('MEDIAN RATING', d.median_rating == null ? '—' : d.median_rating + ' ★', `${d.below_four || 0} below 4.0`)}${kpi('CANCEL RATE', `${d.cancel_rate ?? 0} %`, 'shop-side, last 30 days')}${kpi('NEW THIS MONTH', num(d.new_month), 'approved barbers')}</div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
        <div style="display:flex;gap:12px;padding:10px 16px;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72"><span style="width:230px">BARBER</span><span style="width:150px">SHOP</span><span style="flex:1">WHY</span><span style="width:56px">RATING</span><span style="width:56px">CANCELS</span><span style="width:84px"></span></div>
        <div>${rows.map(row).join('') || `<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">${filter === 'look' ? 'Nobody needs a look right now.' : 'Nobody here.'}</div>`}</div>
      </div></div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#bb-q').oninput = (e) => { const v = e.target.value.trim().toLowerCase(); root.querySelectorAll('[data-row]').forEach((r) => { r.style.display = !v || r.dataset.row.includes(v) ? '' : 'none'; }); };
      root.querySelector('#bb-csv').onclick = () => { csv('barbers', [['name', (b) => b.name], ['shop', (b) => b.shop], ['rating', (b) => b.rating], ['cancel_pct', (b) => b.cancel_pct], ['why', (b) => b.why]], rows); toast('Downloaded'); };
    },
  };
}

async function file({ rpc }, id) {
  const [b, cost] = await Promise.all([rpc('admin_barber', { p_barber: id }), rpc('admin_barber_cost', { p_barber: id }).catch(() => null)]);
  const l = b.last30;
  const cancelPct = l.bookings ? Math.round(l.cancels * 100 / l.bookings) : null;
  const shop = b.salon;
  const licenceOut = b.licence_expires_at && new Date(b.licence_expires_at) < new Date();
  const worry = licenceOut ? ['red', 'Licence expired', `It ran out on ${dayShort(b.licence_expires_at + 'T12:00:00Z')}. The shop’s compliance task is where it is chased.`]
    : l.late_cancels >= 2 || (cancelPct ?? 0) >= 15 ? ['red', `${l.cancels} cancellations in 30 days`, `${l.late_cancels} inside two hours of the slot. ${cost ? `Acting on this barber touches ${cost.week_ahead} bookings this week and ${cost.deposits} deposits.` : ''}`]
      : l.no_shows >= 3 ? ['amber', `${l.no_shows} no-shows on this chair`, 'Customers who didn’t come — worth checking the reminders and the deposit setting.']
        : ['green', 'Nothing wrong', `${num(l.bookings)} booking${l.bookings === 1 ? '' : 's'} in 30 days, ${num(l.cancels)} cancelled by the barber.`];
  const html = profile({
    crumbs: [['Barbers', '/barbers'], [b.name]],
    pill: b.suspended_at ? ['Suspended', 'red'] : b.status === 'approved' ? [b.accepting ? 'Taking bookings' : 'Line paused', b.accepting ? 'green' : 'amber'] : [b.status, 'amber'],
    initials: initials(b.name), name: b.name,
    tag: shop?.is_owner ? ['OWNER', 'amber'] : null,
    sub: `${shop ? `<a href="/salons/${esc(shop.slug)}">${esc(shop.name)}</a>${b.chair ? ` · ${esc(b.chair)}` : ''}` : 'No shop'} · since ${esc(new Date(b.joined).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))}${b.phone ? ` · ${esc(b.phone)}` : ''}${b.pay_model ? ` · ${b.pay_model === 'rent' ? 'rents the chair' : `on ${b.commission_pct}% commission`}` : ''}`,
    rating: b.rating == null ? '—' : `${b.rating} ★ · ${b.reviews_n}`,
    tiles: [
      { label: 'BOOKINGS 30D', value: num(l.bookings), sub: `${DH(l.booked_cents)} booked` },
      { label: 'BARBER CANCELLED', value: num(l.cancels), sub: `${l.late_cancels} late · ${cancelPct == null ? '—' : cancelPct + '%'}`, color: l.cancels ? '#F87171' : '#fff' },
      { label: 'NO-SHOWS', value: num(l.no_shows), sub: 'on this chair, 30 days' },
      { label: 'THIS WEEK AHEAD', value: num(b.week_ahead), sub: 'bookings still to come' },
      { label: 'LICENCE', value: b.licence_expires_at ? dayShort(b.licence_expires_at + 'T12:00:00Z') : '—', sub: b.licence_expires_at ? (licenceOut ? 'expired' : 'expires') : 'no date on file', color: licenceOut ? '#F87171' : '#fff' },
    ],
    call: { tone: worry[0], title: worry[1], body: worry[2], actions: shop ? [{ label: 'Open the shop', href: `/salons/${shop.slug}` }, { label: 'Message the shop', href: `/salons/${shop.slug}?message=1` }] : [] },
    sections: [
      { title: `Cancelled by the barber · last ${b.cancellations.length}`, empty: 'No cancellations by the barber.',
        rows: b.cancellations.map((c) => ({ title: `${c.customer} · ${dayShort(c.starts_at)} ${hhmm(c.starts_at)}`, sub: `${c.cancel_reason || 'No reason given'}${c.late ? ' · inside two hours' : ''}${c.ref ? ` · ${c.ref}` : ''}`, right: c.deposit_cents ? `${DH(c.deposit_cents)} refunded` : '', rightColor: '#9A9CA3' })) },
      { title: `Reviews · last ${b.reviews.length}`, empty: 'No reviews yet.',
        rows: b.reviews.map((r) => ({ title: `${r.rating} ★ · ${r.customer}`, sub: `${r.comment || '—'}${r.state === 'held' ? ' · held for moderation' : r.state === 'removed' ? ' · removed' : ''}`, right: dayShort(r.created_at), rightColor: '#6B6B72' })) },
    ],
    side: cost ? [{ title: 'Before you act', rows: [
      { title: 'Bookings this week', right: num(cost.week_ahead) },
      { title: 'Deposits at risk', right: `${cost.deposits} · ${DH(cost.deposit_cents)}` },
      ...cost.reasons.map((r) => ({ title: r.reason, right: `×${r.n}`, rightColor: '#9A9CA3' })),
      ...(cost.shop_hidden ? [{ title: 'The shop is hidden right now too', sub: 'Worth one call about both.', rightColor: '#E8A100' }] : []),
    ] }] : null,
  });
  return { top: false, html };
}
