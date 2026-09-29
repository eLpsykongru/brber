// /{slug}/reports[?period=week|month|year] — ORP-01, the app's Shop report (2e) on
// the web, the same reads: salon_report for this period and the one before it,
// the top-ups over the counter, and what each commission barber owes since he
// was last squared up (salon_last_settled). "Mark settled in cash" is
// bookkeeping only — it records cash handed over and moves nothing (0031).
// Not built: picking an earlier month (handoff §10 — "the same screen with other
// numbers"). Export is a CSV here; the app's is a PDF.
import { esc, DH, first } from '/app.js';
import { column, card, eyebrow, CHAIR_TINTS, csv } from '/s/ui.js';

function range(p, back = 0) {
  const now = new Date();
  if (p === 'week') {
    const to = new Date(now); to.setHours(0, 0, 0, 0);
    to.setDate(to.getDate() - ((to.getDay() + 6) % 7) - back * 7 + 7);
    const from = new Date(to); from.setDate(from.getDate() - 7);
    return { from, to, label: `Week of ${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` };
  }
  if (p === 'year') return { from: new Date(now.getFullYear() - back, 0, 1), to: new Date(now.getFullYear() - back + 1, 0, 1), label: String(now.getFullYear() - back) };
  const from = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return { from, to: new Date(now.getFullYear(), now.getMonth() - back + 1, 1), label: from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

export default async function ({ rpc, rest, shop: s0, q, go, toast }) {
  const shop = await rpc('owner_shop', { p_slug: s0.slug });
  const base = `/${shop.slug}/reports`;
  const period = ['week', 'month', 'year'].includes(q.get('period')) ? q.get('period') : 'month';
  const cur = range(period), before = range(period, 1);
  const iso = (d) => d.toISOString();
  const [rows, past, tu, last] = await Promise.all([
    rpc('salon_report', { p_from: iso(cur.from), p_to: iso(cur.to) }),
    rpc('salon_report', { p_from: iso(before.from), p_to: iso(before.to) }),
    rest(`wallet_transactions?select=amount_cents&created_at=gte.${iso(cur.from)}&created_at=lt.${iso(cur.to)}`).catch(() => []),
    rpc('salon_last_settled').catch(() => []),
  ]);
  const lastBy = Object.fromEntries((last || []).map((r) => [r.barber_id, r.covers_to]));
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const owing = rows.filter((r) => r.pay_model === 'commission' && !r.is_owner);
  let due = [];
  if (owing.length) {
    const oldest = owing.reduce((a, r) => { const d = lastBy[r.barber_id] ? new Date(lastBy[r.barber_id]) : weekAgo; return d < a ? d : a; }, new Date());
    due = (await rpc('salon_report', { p_from: iso(oldest), p_to: iso(new Date()) }))
      .filter((r) => owing.some((f) => f.barber_id === r.barber_id) && r.commission_cents > 0);
  }

  const take = rows.reduce((a, r) => a + (r.booked_cents ?? 0), 0);
  const prior = past.reduce((a, r) => a + (r.booked_cents ?? 0), 0) || null;
  const delta = prior ? Math.round((take - prior) / prior * 100) : null;
  const bookings = rows.reduce((a, r) => a + r.bookings, 0);
  const commission = rows.reduce((a, r) => a + r.commission_cents, 0);
  const topUps = tu.reduce((a, t) => a + t.amount_cents, 0);
  const noShows = rows.reduce((a, r) => a + r.no_shows, 0);
  const max = Math.max(...rows.map((r) => r.booked_cents ?? 0), 1);
  const totalDue = due.reduce((a, r) => a + r.commission_cents, 0);
  const seg = (k, l) => `<a href="${base}?period=${k}" style="flex:1;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:12px;text-decoration:none;${period === k ? 'background:#212125;color:#fff;font-weight:700' : 'color:#9A9CA3;font-weight:600'}">${l}</a>`;
  const tile = (l, v, c = '#fff') => `<div style="flex:1;background:#17171A;border:1px solid #1E1E22;border-radius:16px;padding:13px 14px;display:flex;flex-direction:column;gap:6px">${eyebrow(l)}<span class="num" style="font-size:19px;font-weight:700;color:${c}">${esc(v)}</span></div>`;

  const inner = `
    <div style="display:flex;gap:10px;align-items:center">
      <div style="flex:1;display:flex;gap:4px;padding:4px;background:#17171A;border:1px solid #1E1E22;border-radius:12px">${seg('week', 'Week')}${seg('month', 'Month')}${seg('year', 'Year')}</div>
      <span data-csv="1" class="btn-s" style="height:40px;border-radius:10px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:700;cursor:pointer">Export CSV</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">${eyebrow(`${cur.label.toUpperCase()} · SHOP TAKE`)}
      <span class="num" style="font-family:'Playfair Display',serif;font-size:40px;font-weight:700;line-height:1.1">${DH(take)}</span>
      <span style="display:flex;align-items:center;gap:8px;font-size:12px;color:#9A9CA3">${delta != null ? `<span style="font-weight:700;color:${delta >= 0 ? '#4ADE80' : '#F87171'}">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}%</span> vs previous · ` : ''}${bookings} booking${bookings === 1 ? '' : 's'}</span></div>
    ${rows.length ? card(`${eyebrow('BY BARBER')}${rows.map((r, i) => `<div style="display:flex;flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between"><span style="font-size:13px;font-weight:700">${esc(first(r.name))}${r.is_owner ? ' <span style="font-size:11px;color:#9A9CA3;font-weight:500">· you</span>' : ''}</span><span class="num" style="font-size:13px;font-weight:700">${r.booked_cents == null ? 'rent' : DH(r.booked_cents)}</span></div>
        <div style="height:6px;border-radius:3px;background:#212125;overflow:hidden"><div style="height:100%;width:${Math.round((r.booked_cents ?? 0) / max * 100)}%;background:${CHAIR_TINTS[i % CHAIR_TINTS.length]}"></div></div></div>`).join('')}`) : ''}
    <div style="display:flex;gap:10px">${tile('COMMISSION', DH(commission))}${tile('TOP-UPS', DH(topUps))}${tile('NO-SHOWS', String(noShows), noShows ? '#F87171' : '#fff')}</div>
    ${due.length ? `${eyebrow('SETTLEMENT · OWED NOW')}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:16px;overflow:hidden">${due.map((r) => `<div style="display:flex;padding:13px 16px;border-bottom:1px solid #1E1E22"><span style="flex:1;font-size:13px;font-weight:600">${esc(r.name)}</span><span class="num" style="font-size:13px;font-weight:700;color:#E8442E">${DH(r.commission_cents)}</span></div>`).join('')}
        <div style="display:flex;padding:13px 16px"><span style="flex:1;font-size:13px;font-weight:700">Total to collect</span><span class="num" style="font-size:15px;font-weight:800">${DH(totalDue)}</span></div></div>
      <span data-settle="1" class="btn-p" style="height:48px;border-radius:999px;background:#E8442E;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;letter-spacing:.08em;cursor:pointer">MARK SETTLED IN CASH</span>` : ''}`;

  return {
    html: column(inner),
    ready(root) {
      root.querySelector('[data-csv]').onclick = () => {
        csv(`report-${period}`, [['barber', (r) => r.name], ['bookings', (r) => r.bookings], ['booked_dh', (r) => (r.booked_cents == null ? 'rent' : r.booked_cents / 100)],
          ['commission_dh', (r) => r.commission_cents / 100], ['no_shows', (r) => r.no_shows]], rows);
        toast('Downloaded');
      };
      root.querySelector('[data-settle]')?.addEventListener('click', async () => {
        if (!confirm(`Record ${DH(totalDue)} as collected in cash from ${due.map((r) => first(r.name)).join(', ')}?`)) return;
        try {
          for (const r of due) {
            await rpc('salon_mark_settled', { p_barber: r.barber_id, p_amount_cents: r.commission_cents,
              p_from: iso(lastBy[r.barber_id] ? new Date(lastBy[r.barber_id]) : weekAgo), p_to: iso(new Date()) });
          }
          toast(`${DH(totalDue)} recorded as collected in cash`);
          go(location.pathname + location.search, { replace: true });
        } catch (e) { toast(e.message, false); }
      });
    },
  };
}
