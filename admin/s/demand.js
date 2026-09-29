// /demand[?days=90], /demand/tangier/<district>[?ask=hours | ?district=<salon id>]
// DMD-01/02 (0060's admin_demand: unmet waitlist asks, read as a supply shortage or an
// hours mismatch per district) and DMD-03/06/08 (one district: its shops, and asking
// them to try later evenings — a task in the owner's To-do with no date and no
// consequence, the same channel as SAL-08's "message the owner").
// Not built: the map (nothing stores district outlines or ask locations — the bars
// stand in for it), the asks one by one (DMD-03/04 — the read only counts), "tell them
// when it opens" (DMD-05/09), recruiting queues and visits (DMD-11…14), other cities
// (§10). ⚑ "≈ 19 000 DH walked away" isn't printed: nothing prices an unfilled ask.
import { esc } from '/app.js';
import { pageHead, chips, label9, btnS, btnP, csv } from '/s/ui.js';

const CITY = 'tangier';   // ponytail: one launch city; §10 flags the others
const VERDICT = { supply: ['SUPPLY SHORT', '#F87171'], hours: ['HOURS MISMATCH', '#E8A100'], healthy: ['HEALTHY', '#4ADE80'] };
const READING = {
  supply: 'The shops here are full when people ask. This is a chairs problem, not an hours problem.',
  hours: 'The chairs exist — they are shut when people ask. Recruiting here is the wrong move.',
  healthy: 'Asks here get filled. Nothing to fix.',
};
const tag = (v) => { const [t, c] = VERDICT[v] || [String(v).toUpperCase(), '#9A9CA3']; return `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:3px 7px;white-space:nowrap">${t}</span>`; };
const hm = (m) => m == null ? '—' : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// the same shape as 0133's slugify(): accents off, anything else a hyphen
const slug = (district) => String(district || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unassigned';
const kpi = (l, v, s, col) => `<div style="flex:1 1 160px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:13px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:22px;font-weight:800${col ? ';color:' + col : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
const box = (inner, extra = '') => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;${extra}">${inner}</div>`;
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };

export default async function (ctx) {
  const [city, district] = ctx.seg;
  if (!city) return city_(ctx);
  if (city === CITY && district) return one(ctx, district);
  return ctx.go('/demand', { replace: true });
}

async function city_({ rpc, q }) {
  const days = q.get('days') === '90' ? 90 : 30;
  const d = await rpc('admin_demand', { p_days: days });
  const t = d.totals;
  const maxU = Math.max(1, ...d.districts.map((x) => x.unmet));
  const bars = d.districts.map((x) => `<a href="/demand/${CITY}/${slug(x.district)}" class="hov" style="display:flex;align-items:center;gap:12px;padding:6px 4px;border-radius:8px;text-decoration:none;color:#fff">
    <span style="width:120px;flex:none;font-size:11.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.district)}</span>
    <span style="flex:1;height:14px;background:#111113;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${Math.max(2, x.unmet / maxU * 100)}%;background:${(VERDICT[x.verdict] || [, '#9A9CA3'])[1]};opacity:.85"></span></span>
    <span class="num" style="width:36px;flex:none;text-align:right;font-size:12px;font-weight:700">${x.unmet}</span></a>`).join('');
  // the whole working day, so an evening spike reads against the empty afternoon
  const at = Object.fromEntries(d.by_hour.map((h) => [h.hour, h]));
  const span = d.by_hour.map((h) => h.hour);
  const hours = [];
  for (let h = Math.min(8, ...span); h <= Math.max(22, ...span); h++) hours.push(at[h] || { hour: h, asks: 0, outside: 0 });
  const maxH = Math.max(1, ...hours.map((h) => h.asks));
  const hist = d.by_hour.length ? `<div style="display:flex;align-items:flex-end;gap:4px;height:110px">${hours.map((h) => `<span title="${h.asks} asks at ${String(h.hour).padStart(2, '0')}:00 · ${h.outside} outside opening hours" style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
      <span style="display:block;height:${(h.asks - h.outside) / maxH * 100}%;background:#3A3A40;border-radius:3px 3px 0 0"></span><span style="display:block;height:${h.outside / maxH * 100}%;background:#E8A100;${h.asks === h.outside ? 'border-radius:3px 3px 0 0' : ''}"></span></span>`).join('')}</div>
    <div style="display:flex;gap:4px">${hours.map((h) => `<span class="num" style="flex:1;text-align:center;font-size:9px;color:#6B6B72">${String(h.hour).padStart(2, '0')}</span>`).join('')}</div>` : '<span style="font-size:12px;color:#6B6B72">No asks with a time on them.</span>';
  const todo = d.districts.filter((x) => x.verdict !== 'healthy').slice(0, 3).map((x) => `<div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 14px;display:flex;flex-direction:column;gap:7px">
    <div style="display:flex;align-items:center;gap:8px">${tag(x.verdict)}<span style="flex:1"></span><span class="num" style="font-size:11px;color:#9A9CA3">${x.unmet} unmet</span></div>
    <span style="font-size:13px;font-weight:700">${esc(x.district)} · ${x.shops} shop${x.shops === 1 ? '' : 's'} asked about</span>
    <span style="font-size:11.5px;color:#9A9CA3;line-height:1.5">${x.verdict === 'hours' ? `${x.hours_asks} of ${x.unmet} unmet asks came when the shops were shut.` : `${x.unmet} of ${x.asks} asks went unmet, most of them while the shops were open.`}</span>
    <a href="${x.verdict === 'hours' ? `/demand/${CITY}/${slug(x.district)}?ask=hours` : `/demand/${CITY}/${slug(x.district)}`}" style="font-size:10px;font-weight:800;letter-spacing:.06em;align-self:flex-start;background:#212125;border-radius:7px;padding:7px 10px;color:#fff">${x.verdict === 'hours' ? 'ASK THE SHOPS ABOUT HOURS' : 'SEE WHO IS THERE'}</a></div>`).join('') || '<span style="font-size:12px;color:#6B6B72">Nothing short and nothing shut.</span>';
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Demand', 'Tangier', `<span style="display:flex;gap:10px;align-items:center">${btnS('Export CSV', 'id="dm-csv"')}</span>`)}
    ${chips([['Last 30d', '/demand', days === 30], ['90d', '/demand?days=90', days === 90]])}
    <div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('UNMET ASKS', t.unmet, `of ${t.asks} asks`)}${kpi('FILLED FROM ASKS', t.filled, `${t.conversion_pct}% conversion`)}${kpi('EXPIRED UNFILLED', t.expired, 'nobody took the slot')}${kpi('SHOPS ASKED ABOUT', t.full_shops, 'with a waiting-list ask')}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">
        ${box(`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">${label9('UNMET ASKS BY DISTRICT')}<span style="flex:1"></span>${Object.entries(VERDICT).map(([, [l, c]]) => `<span style="display:flex;align-items:center;gap:5px;font-size:10px;color:#9A9CA3"><span style="width:8px;height:8px;border-radius:2px;background:${c}"></span>${l.toLowerCase()}</span>`).join('')}</div>
          ${bars || '<span style="font-size:12px;color:#6B6B72">No asks in this window.</span>'}`, 'flex:3 1 480px;min-width:0')}
        ${box(`${label9('WHAT TO DO ABOUT IT')}${todo}`, 'flex:2 1 300px;min-width:0')}</div>
      ${box(`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">${label9('WHEN THE ASKS LAND · ALL DISTRICTS')}<span style="flex:1"></span><span style="font-size:11.5px;font-weight:700;color:#E8A100">${t.outside_hours_pct}% of the unmet fall outside opening hours somewhere</span></div>${hist}`)}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
        <div style="display:grid;grid-template-columns:1.4fr 70px 70px 90px 70px 150px;gap:12px;padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:620px"><span>DISTRICT</span><span>ASKS</span><span>UNMET</span><span>SHUT HOURS</span><span>SHOPS</span><span>READING</span></div>
        <div style="min-width:620px">${d.districts.map((x) => `<a href="/demand/${CITY}/${slug(x.district)}" class="hov" style="display:grid;grid-template-columns:1.4fr 70px 70px 90px 70px 150px;gap:12px;align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;font-size:12px">
          <span style="font-weight:700">${esc(x.district)}</span><span class="num">${x.asks}</span><span class="num" style="font-weight:700">${x.unmet}</span><span class="num">${x.hours_asks}</span><span class="num">${x.shops}</span><span>${tag(x.verdict)}</span></a>`).join('')}</div></div>
      ${d.top_shops.length ? box(`${label9('TOP SHOPS BY UNMET DEMAND')}${d.top_shops.map((s) => `<div style="display:flex;align-items:center;gap:12px;font-size:12px"><span style="flex:1;min-width:0;font-weight:600">${esc(s.salon)} <span style="color:#6B6B72;font-weight:400">· ${esc(s.district)}${s.closes_min != null ? ` · shuts ${hm(s.closes_min)}` : ''}</span></span><span class="num" style="font-weight:700">${s.unmet}</span></div>`).join('')}`) : ''}
    </div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#dm-csv').onclick = () => csv(`demand-${days}d`, [['District', (x) => x.district], ['Asks', (x) => x.asks], ['Unmet', (x) => x.unmet], ['Filled', (x) => x.filled], ['Unmet while shut', (x) => x.hours_asks], ['Shops', (x) => x.shops], ['Reading', (x) => x.verdict]], d.districts);
    },
  };
}

async function one({ rpc, rest, act, q, go, toast, dialog, closeDialog }, dslug) {
  const days = q.get('days') === '90' ? 90 : 30;
  const [d, salons, list] = await Promise.all([rpc('admin_demand', { p_days: days }), rest('salons?select=id,slug,name,status,district'), rpc('admin_salons')]);
  const x = d.districts.find((r) => slug(r.district) === dslug);
  const name = x?.district || salons.find((s) => slug(s.district || '') === dslug)?.district;
  if (!name) throw new Error('not_found');
  const unassigned = name === 'Unassigned';
  const chairs = Object.fromEntries((list.rows || []).map((r) => [r.id, r]));
  const asks = Object.fromEntries(d.top_shops.map((s) => [s.salon_id, s]));
  const shops = salons.filter((s) => (unassigned ? !s.district : s.district === name) && s.status !== 'pending');
  const base = `/demand/${CITY}/${dslug}`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    <div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px;font-size:13px">
      <a href="/demand" style="color:#9A9CA3;font-weight:600">Demand</a><span style="color:#3A3A40">›</span><span style="color:#9A9CA3">Tangier</span><span style="color:#3A3A40">›</span><span style="font-weight:700">${esc(name)}</span>${x ? tag(x.verdict) : ''}</div>
    ${chips([['Last 30d', base, days === 30], ['90d', base + '?days=90', days === 90]])}
    <div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;flex-direction:column;gap:14px;max-width:1100px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('ASKS', x?.asks ?? 0, `last ${days} days`)}${kpi('UNMET', x?.unmet ?? 0, `${x?.filled ?? 0} filled`)}${kpi('UNMET WHILE SHUT', x?.hours_asks ?? 0, 'asked when every shop was closed', x?.verdict === 'hours' ? '#E8A100' : '')}${kpi('SHOPS', shops.length, `${shops.reduce((n, s) => n + (chairs[s.id]?.chairs || 0), 0)} chairs`)}</div>
      ${x ? `<span style="font-size:13px;line-height:1.55;color:#D8D8DC">${READING[x.verdict]}</span>` : '<span style="font-size:13px;color:#6B6B72">No asks here in this window.</span>'}
      ${unassigned ? '<span style="font-size:12px;color:#E8A100">These shops have no district, so their asks can’t be read against a neighbourhood. Name one.</span>' : ''}
      ${label9(`THE SHOPS IN ${name.toUpperCase()}`)}
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">${shops.map((s, i) => { const a = asks[s.id], c = chairs[s.id]; return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;${i ? 'border-top:1px solid #1E1E22' : ''}">
        <a href="/salons/${esc(s.slug)}" style="flex:1;min-width:0;color:#fff"><span style="display:block;font-size:12.5px;font-weight:700">${esc(s.name)}</span><span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px">${c ? `${c.chairs} chair${c.chairs === 1 ? '' : 's'}` : ''}${a?.closes_min != null ? ` · shuts ${hm(a.closes_min)}` : ''}${s.status !== 'live' ? ` · ${esc(s.status)}` : ''}</span></a>
        <span class="num" style="font-size:12px;color:#9A9CA3">${a ? `${a.unmet} unmet · ${a.filled} filled` : 'no asks'}</span>
        ${unassigned ? `<a href="${base}?district=${s.id}" style="font-size:10px;font-weight:800;letter-spacing:.06em;background:#212125;border-radius:7px;padding:7px 10px;color:#fff">NAME THE DISTRICT</a>` : ''}</div>`; }).join('') || '<div style="padding:18px 16px;font-size:12px;color:#6B6B72">No shop here yet — these asks found nothing to book.</div>'}</div>
      ${!unassigned && x && x.verdict !== 'healthy' ? `<div style="display:flex;gap:10px;flex-wrap:wrap">${x.verdict === 'hours' && shops.some((s) => s.status === 'live') ? btnP('ASK THE SHOPS ABOUT LATER HOURS', `data-go="${base}?ask=hours"`) : ''}${btnS(x.verdict === 'hours' ? 'Recruit here anyway' : 'Add a shop here', 'data-go="/salons/new"')}</div>` : ''}
    </div></div>`;
  return {
    top: false, html,
    ready() {
      if (q.get('ask') === 'hours' && x) {
        const live = shops.filter((s) => s.status === 'live');
        const text = `In the last ${days} days, ${x.hours_asks} ${x.hours_asks === 1 ? 'person' : 'people'} in ${name} asked for a cut at an hour when every shop here was shut. If you open later on a few evenings, those are bookings you would get. Try it for four weeks — if it is not worth it, close it again and nothing is held against you.`;
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:13px">
          <span style="font-size:17px;font-weight:800">Ask ${esc(name)}’s shops to try later hours</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">Hours are the owner’s, not ours. This lands in each owner’s To-do with their district’s numbers, no date and no consequence — they decide. Ask the ones who plausibly would, not every one who could.</span>
          ${label9('WHO GETS ASKED')}
          <div style="display:flex;flex-direction:column;gap:7px">${live.map((s) => `<label style="display:flex;align-items:center;gap:11px;background:#111113;border:1px solid #26262B;border-radius:11px;padding:10px 12px;cursor:pointer"><input type="checkbox" value="${s.id}" style="accent-color:#E8442E"><span style="flex:1;font-size:12.5px;font-weight:600">${esc(s.name)}</span><span style="font-size:10.5px;color:#6B6B72">${asks[s.id]?.closes_min != null ? `shuts ${hm(asks[s.id].closes_min)}` : ''}</span></label>`).join('')}</div>
          ${label9('WHAT THEY READ')}
          <textarea id="ah-text" rows="5" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;line-height:1.5;outline:none;resize:vertical">${esc(text)}</textarea>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('SEND THE REQUESTS', 'id="ah-go"')}</div></div>`, { onClose: () => go(base), width: 520 });
        dl.querySelector('#ah-go').onclick = async () => {
          const ids = [...dl.querySelectorAll('input[type=checkbox]:checked')].map((i) => i.value);
          const body = dl.querySelector('#ah-text').value.trim();
          if (!ids.length) return showErr(dl, new Error('Pick at least one shop.'));
          if (!body) return showErr(dl, new Error('Say what they read.'));
          try {
            for (const id of ids) await act('admin_issue_task', { p_salon: id, p_kind: 'other', p_title: 'Try later hours for four weeks', p_body: body, p_action: 'none' }, { title: `Ask ${shops.find((s) => s.id === id).name} to try later hours` });
            closeDialog(); toast(`${ids.length} request${ids.length === 1 ? '' : 's'} sent · in Compliance with no date`);
          } catch (e) { showErr(dl, e); }
        };
      }
      const sid = q.get('district');
      const shop = sid && shops.find((s) => s.id === sid);
      if (shop) {
        const known = [...new Set(salons.map((s) => s.district).filter(Boolean))].sort();
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:13px">
          <span style="font-size:17px;font-weight:800">Which district is ${esc(shop.name)} in?</span>
          <input id="ds-name" list="ds-known" placeholder="Malabata" style="height:42px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:13px;outline:none">
          <datalist id="ds-known">${known.map((k) => `<option value="${esc(k)}">`).join('')}</datalist>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('SAVE', 'id="ds-go"')}</div></div>`, { onClose: () => go(base), width: 420 });
        dl.querySelector('#ds-go').onclick = async () => {
          const v = dl.querySelector('#ds-name').value.trim();
          if (!v) return showErr(dl, new Error('Name the district.'));
          try { await act('admin_set_district', { p_salon: shop.id, p_district: v }, { title: `Put ${shop.name} in ${v}` }); closeDialog(); toast(`${shop.name} is in ${v}`); }
          catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}
