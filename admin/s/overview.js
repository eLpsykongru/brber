// /overview — OVW-02, "the morning screen — nine things and yesterday".
// admin_morning (0134) counts what is waiting and what happened yesterday; this
// page words it. "Who is on" is 0066's admin_desk presence, and demand without
// supply is 0060's admin_demand. Not as drawn: TAKEN says what deposits were held,
// not "8% to us" — there is no commission (0123).
import { esc, DH, num, first, initials, ago, dayLong } from '/app.js';

const TONE = { red: ['rgba(248,113,113,.3)', '#F87171'], amber: ['rgba(232,161,0,.28)', '#E8A100'], grey: ['#1E1E22', '#3A3A40'] };
const s = (n, one, many) => (n === 1 ? one : many);

export default async function ({ rpc, me }) {
  const [m, desk, demand] = await Promise.all([
    rpc('admin_morning'),
    rpc('admin_desk').catch(() => null),
    rpc('admin_demand', { p_days: 7 }).catch(() => null),
  ]);
  const head = first(me.head) || 'the Head of Ops';
  const lead = me.role === 'head';

  // each kind of waiting thing, in the page's words
  const word = {
    asks: (x) => ({ title: lead ? `${x.n} ${s(x.n, 'ask', 'asks')} waiting on you` : `${x.n} ${s(x.n, 'ask', 'asks')} with ${head}`, sub: x.detail, where: 'Requests', to: '/requests', action: lead ? 'Decide' : 'See', tone: lead ? 'amber' : 'grey' }),
    overdue_tasks: (x) => ({ title: `${x.n} shop ${s(x.n, 'task', 'tasks')} overdue`, sub: x.detail, where: 'Compliance', to: '/compliance', action: 'Open', tone: 'red' }),
    float_gap: (x) => ({ title: `${x.n} ${s(x.n, 'drawer', 'drawers')} that don’t add up`, sub: `${x.detail} · ${DH(Math.abs(x.cents))} unaccounted`, where: 'Finance', to: '/finance/float', action: 'Open', tone: 'red' }),
    float_over_cap: (x) => ({ title: `${x.n} ${s(x.n, 'shop', 'shops')} over the float cap`, sub: `${x.detail} · ${DH(x.cents)} over`, where: 'Wallets & float', to: '/wallets', action: 'Settle', tone: 'amber' }),
    pending_shops: (x) => ({ title: `${x.n} ${s(x.n, 'shop', 'shops')} waiting on a decision`, sub: x.detail, where: 'Salons', to: '/salons/pending', action: 'Review', tone: 'amber' }),
    held_reviews: (x) => ({ title: `${x.n} ${s(x.n, 'review', 'reviews')} held`, sub: x.detail ? `At ${x.detail}` : '', where: 'Reviews', to: '/reviews', action: 'Moderate', tone: 'amber' }),
    open_cases: (x) => ({ title: `${x.n} support ${s(x.n, 'case', 'cases')} open`, sub: 'Oldest first', where: 'Support', to: '/support', action: 'Answer', tone: 'amber' }),
    customer_marks: (x) => { const usual = Number(String(x.detail || '').replace(/\D/g, '')) || 0;
      return { title: `${x.n} ${s(x.n, 'customer', 'customers')} marked this week`, sub: x.n > usual ? `Above the usual ${usual} — worth a look at why` : `The usual is ${usual}`, where: 'Customers', to: '/customers', action: 'See', tone: 'grey' }; },
  };
  const needs = m.needs.filter((x) => word[x.kind]).map((x) => ({ ...word[x.kind](x), age: x.since ? ago(x.since) : '—' }));
  const row = (r) => {
    const [border, bar] = TONE[r.tone];
    return `<a href="${r.to}" class="hov" style="display:flex;align-items:center;gap:12px;background:#17171A;border:1px solid ${border};border-radius:12px;padding:13px 15px;text-decoration:none;color:#fff">
      <span style="width:6px;height:30px;border-radius:3px;background:${bar};flex:none"></span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(r.title)}</span><span style="font-size:10.5px;color:#9A9CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.sub || '')}</span></span>
      <span style="width:104px;flex:none;font-size:11px;color:#9A9CA3">${esc(r.where)}</span>
      <span class="num" style="width:44px;flex:none;text-align:right;font-size:11px;color:#6B6B72">${esc(r.age)}</span>
      <span style="width:66px;flex:none;text-align:right;font-size:11px;font-weight:700;color:${r.tone === 'grey' ? '#9A9CA3' : '#E8442E'}">${esc(r.action)}</span></a>`;
  };

  const y = m.yesterday;
  const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
  const d = pct(y.bookings, y.bookings_week_ago);
  const dayName = new Date(m.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const rate = y.bookings ? (y.no_shows / y.bookings * 100) : 0;
  const rateWas = y.bookings_week_ago ? (y.no_shows_week_ago / y.bookings_week_ago * 100) : null;
  const tile = (label, value, note, to, noteColor = '#9A9CA3') => `<a href="${to}" style="background:#17171A;border:1px solid #1E1E22;border-radius:13px;padding:14px 15px;display:flex;flex-direction:column;gap:5px;text-decoration:none;color:#fff">
    <span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${label}</span><span class="num" style="font-size:22px;font-weight:800">${esc(value)}</span><span style="font-size:10px;color:${noteColor}">${esc(note)}</span></a>`;

  // bookings by hour, 09–21 as drawn; the peak two hours in the accent
  const hours = m.by_hour.filter((h) => h.hour >= 9 && h.hour <= 21);
  const max = Math.max(...hours.map((h) => h.n), 1);
  const peak = hours.reduce((a, h, i) => (i && hours[i - 1].n + h.n > a.n ? { i, n: hours[i - 1].n + h.n } : a), { i: 0, n: -1 });
  const bar = (h, i) => `<span title="${h.hour}:00 · ${h.n}" style="flex:1;height:${Math.max(4, h.n / max * 100)}%;border-radius:3px 3px 0 0;background:${peak.n > 0 && (i === peak.i || i === peak.i - 1) ? '#E8442E' : h.n / max > .5 ? '#3A3A40' : '#26262B'}"></span>`;

  const people = desk?.people || [];
  const hoursLeft = Math.max(0, Math.round((Date.parse(m.next_cut_at) - Date.now()) / 3600e3));
  const districts = (demand?.districts || []).filter((x) => x.unmet > 0).sort((a, b) => b.unmet - a.unmet).slice(0, 3);
  const dmax = Math.max(...districts.map((x) => x.unmet), 1);

  const html = `<div style="height:100%;overflow:auto;box-sizing:border-box">
  <div style="padding:20px 24px 28px;display:flex;flex-wrap:wrap;align-items:flex-start;gap:18px;box-sizing:border-box">
    <div style="flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:15px">
      <div style="display:flex;flex-direction:column;gap:11px">
        <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">WHAT NEEDS A PERSON TODAY · ${needs.length}</span>
        <div style="display:flex;flex-direction:column;gap:8px">${needs.map(row).join('') || '<span style="font-size:12px;color:#6B6B72;padding:6px 2px">Nothing is waiting on a person.</span>'}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:11px">
        <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">YESTERDAY · ${esc(dayLong(m.date + 'T12:00:00Z').toUpperCase())}</span>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px">
          ${tile('BOOKINGS', num(y.bookings), d == null ? 'nothing last week to compare' : `${d >= 0 ? '+' : ''}${d}% on last ${dayName}`, '/bookings', d != null && d < 0 ? '#F87171' : '#9A9CA3')}
          ${tile('TAKEN', DH(y.taken_cents), `${DH(y.deposits_cents)} of it held as deposits`, '/finance')}
          ${tile('NO-SHOW RATE', rate.toFixed(1) + '%', rateWas == null ? `${y.no_shows} no-show${y.no_shows === 1 ? '' : 's'}` : `was ${rateWas.toFixed(1)}% last ${dayName}`, '/bookings')}
          ${tile('SHOPS TRADING', `${m.shops.live} / ${m.shops.trading}`, m.shops.suspended.length ? `${m.shops.suspended.map((x) => x.name).join(', ')} suspended` : 'none suspended', '/salons', m.shops.suspended.length ? '#E8A100' : '#9A9CA3')}
        </div>
      </div>
      <div style="height:236px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px 17px;display:flex;flex-direction:column;gap:13px;box-sizing:border-box">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px"><span style="font-size:12.5px;font-weight:700">Bookings by hour</span>
          <span style="font-size:10.5px;color:#6B6B72">Yesterday${peak.n > 0 ? ` · peak ${String(hours[peak.i - 1]?.hour ?? hours[peak.i].hour).padStart(2, '0')}:00–${String(hours[peak.i].hour + 1).padStart(2, '0')}:00` : ' · no bookings'}</span></div>
        <div style="flex:1;min-height:0;display:flex;align-items:flex-end;gap:5px">${hours.map(bar).join('')}</div>
        <div class="num" style="display:flex;justify-content:space-between;font-size:9.5px;color:#6B6B72"><span>09</span><span>12</span><span>15</span><span>18</span><span>21</span></div>
      </div>
    </div>
    <div style="flex:1 1 296px;min-width:0;display:flex;flex-direction:column;gap:14px">
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px"><span style="font-size:12.5px;font-weight:700">Who is on</span><a href="/settings/team" style="font-size:10.5px;font-weight:600;color:#6B6B72">Team</a></div>
        <div style="display:flex;flex-direction:column;gap:10px">${people.map((p) => {
          const idle = (p.idle_min ?? 0) > 20;
          return `<div style="display:flex;align-items:center;gap:10px;opacity:${idle ? '.55' : '1'}">
            <span style="width:26px;height:26px;border-radius:999px;background:${p.me ? '#E8442E' : '#212125'};display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;flex:none">${esc(initials(p.name))}</span>
            <span style="flex:1;min-width:0;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(first(p.name))}${p.holding ? ` · in ${esc(p.holding)}` : idle ? ` · idle ${p.idle_min} min` : ''}</span>
            ${p.me ? '<span style="font-size:10px;color:#6B6B72">you</span>' : ''}
            <span style="width:6px;height:6px;border-radius:999px;background:${idle ? '#6B6B72' : '#4ADE80'};flex:none"></span></div>`;
        }).join('') || '<span style="font-size:11.5px;color:#6B6B72">Nobody else is on the desk.</span>'}</div>
      </div>
      <div style="background:#17171A;border:1px solid rgba(232,161,0,.28);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px">
        <span style="font-size:12.5px;font-weight:700;color:#E8A100">Friday closes in ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}</span>
        <span style="font-size:11px;line-height:1.5;color:#9A9CA3">The week is cut at Friday 21:00. Nothing is paid or collected until the run is released.</span>
        <a href="/finance" style="align-self:flex-start;font-size:11px;font-weight:700">Open the payout run</a>
      </div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:11px">
        <span style="font-size:12.5px;font-weight:700">Where demand has no supply</span>
        <div style="display:flex;flex-direction:column;gap:4px">${districts.map((x, i) => `<a href="/demand" class="hov" style="display:flex;align-items:center;gap:9px;padding:4px 6px;margin:0 -6px;border-radius:7px;text-decoration:none;color:#fff">
          <span style="flex:1;font-size:11.5px">${esc(x.district || 'No district')}</span>
          <span style="width:70px;height:4px;border-radius:2px;background:#26262B;flex:none"><span style="display:block;height:100%;width:${Math.round(x.unmet / dmax * 100)}%;background:${['#E8442E', '#E8A100', '#6B6B72'][i]};border-radius:2px"></span></span>
          <span class="num" style="width:26px;flex:none;text-align:right;font-size:11px;font-weight:700">${x.unmet}</span></a>`).join('') || '<span style="font-size:11.5px;color:#6B6B72">Every search in the last week found a shop.</span>'}</div>
        <span style="font-size:10.5px;line-height:1.45;color:#6B6B72;border-top:1px solid #26262B;padding-top:10px">People searched and found nothing. Each one is a recruiting lead.</span>
      </div>
    </div>
  </div></div>`;
  return { html };
}
