// /{slug}/chairs[/<barber id>[?terms=1]|/cash][?invite=1|?chair=<id>|?week=<date>] —
// OBR-05 (the team), OBR-01 (a barber, as a side panel), OBR-02 (invite), OBR-07 (who
// holds the cash), and BRB-30: the chairs' week (0145) and an empty chair offered to
// barbers (0142), who can ask for it in the app (0144).
// The app's reads and writes: salon_team, salon_report, shop_bookings, salon_chairs,
// salon_chair_week, salon_set_chair, salon_chair_asks / take_chair_ask / decline_chair_ask,
// salon_set_terms, rent_payments / salon_rent_received / salon_rent_undo,
// salon_approve_member / salon_remove_member, cash_agent_state / set_cash_agent.
//
// Not as drawn: the invite has no "by phone" — nothing sends SMS — so it hands
// the owner the words to send; a barber joins by picking the shop in the app and
// the owner approves him here. "Hand the shop over" and "Standing in" (OBR-03/04)
// are not built anywhere yet. Chat lives in the app. BRB-30's prose about why the
// mornings are empty is not written for the owner — the page gives him the numbers.
// Chairs are added in the app.
import { esc, DH, first, initials, dayShort, dayWk, ZONE } from '/app.js';
import { card, eyebrow, kv, rule, column, label9 } from '/s/ui.js';

const input = 'background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;box-sizing:border-box';
const per = (p) => (p === 'week' ? '/ wk' : '/ mo');
const monthName = (t) => new Date(t).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: ZONE });
// a written-down rent period, named the way the app names it
const periodName = (from, to) => (Date.parse(to) - Date.parse(from) < 8 * 864e5 ? `Week of ${dayShort(from)}` : monthName(from));

const btn = (label, attrs = '', tone = 'p') => `<span ${attrs} class="${tone === 'p' ? 'btn-p' : 'btn-s'}" style="display:inline-flex;align-items:center;justify-content:center;height:34px;border-radius:9px;padding:0 14px;font-size:11.5px;font-weight:700;cursor:pointer;white-space:nowrap;${tone === 'p' ? 'background:#E8442E' : 'background:#212125;border:1px solid #3A3A40'}${tone === 'red' ? ';color:#F87171;border-color:rgba(248,113,113,.4)' : ''}">${label}</span>`;

export default async function (ctx) {
  const { rpc, rest, shop: s0, seg } = ctx;
  const shop = await rpc('owner_shop', { p_slug: s0.slug });
  if (seg[0] === 'cash') return cash(ctx, shop);
  return team(ctx, shop, seg[0]);
}

// ---- OBR-05 + OBR-01 ------------------------------------------------------------
async function team({ rpc, rest, q, go, toast, dialog, closeDialog }, shop, pick) {
  const base = `/${shop.slug}/chairs`;
  const [members, meta, chairs, week] = await Promise.all([
    rpc('salon_team'),
    rest(`salons?select=open_min,close_min,cash_agent_id&id=eq.${shop.id}`).then((r) => r[0] || {}),
    rpc('salon_chairs'),
    rpc('salon_chair_week', { p_day: /^\d{4}-\d\d-\d\d$/.test(q.get('week') || '') ? q.get('week') : null }),
  ]);
  const approved = members.filter((m) => m.salon_status === 'approved');
  const pending = members.filter((m) => m.salon_status === 'pending');
  const m = pick && members.find((x) => x.barber_id === pick);
  if (pick && !m) throw new Error('not_found');

  const rateOf = (x) => (x.salon_role === 'owner' ? 'Owner' : x.pay_model === 'rent' ? `${DH(x.rent_cents)} ${per(x.rent_period)}` : `${100 - x.commission_pct}%`);
  const grid = 'display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(140px,1.2fr) 110px 120px 14px;gap:12px';
  const chev = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B72" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>';
  // BRB-30 — the chairs this week: hours open, sold and empty, what the shop takes (0145),
  // and what an empty one asks (0142)
  const wk = Object.fromEntries(week.map((w) => [w.chair_id, w]));
  const mon = week[0]?.week_start;
  const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const hrs = (min) => `${Math.round(min / 60)}h`;
  const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const DAYS = ['No days', 'One day', 'Two days', 'Three days', 'Four days', 'Five days', 'Six days', 'Seven days'];
  const tot = week.reduce((a, w) => ({ open: a.open + w.open_min, sold: a.sold + w.sold_min, empty: a.empty + w.empty_min, am: a.am + w.empty_am_min, share: a.share + w.share_cents }),
    { open: 0, sold: 0, empty: 0, am: 0, share: 0 });
  const cgrid = 'display:grid;grid-template-columns:minmax(80px,.6fr) minmax(200px,1.8fr) 64px 64px 120px 14px;gap:12px';
  const chairRow = (c) => {
    const w = wk[c.chair_id] || {};
    const mem = members.find((x) => x.barber_id === c.barber_id);
    const approx = mem && mem.salon_role !== 'owner' && mem.pay_model === 'rent' && mem.rent_period !== 'week';   // a month's rent, by the week
    return `<a href="${base}?chair=${c.chair_id}" class="hov" style="${cgrid};align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff">
    <span style="font-size:12.5px;font-weight:700">${esc(c.label)}</span>
    <span style="display:flex;flex-direction:column;gap:2px">${c.barber_id
      ? `<span style="font-size:12px;font-weight:600">${esc(c.barber_name)}</span>
         <span style="font-size:10.5px;color:#6B6B72">${w.days ? `${DAYS[w.days]} · ${hm(w.from_min)} to ${hm(w.to_min)}` : 'No hours this week'}</span>`
      : `<span style="font-size:12px;font-weight:600;color:${c.listed_at || c.asks ? '#E8442E' : '#9A9CA3'}">${c.asks ? `${c.asks} barber${c.asks === 1 ? '' : 's'} asked for it` : c.listed_at ? 'Looking for a barber' : 'Nobody'}</span>
         <span style="font-size:10.5px;color:#6B6B72">${c.vacant_since ? `Empty since ${esc(dayShort(c.vacant_since))}` : 'Empty'}${c.rent_cents != null ? ` · asks ${DH(c.rent_cents)} ${per(c.rent_period)}` : ''}${c.listed_at ? ' · barbers on Sterncut can see it' : ' · not shown to barbers'}</span>`}</span>
    <span class="num" style="font-size:12px;font-weight:700">${c.barber_id ? hrs(w.sold_min ?? 0) : '—'}</span>
    <span class="num" style="font-size:12px;font-weight:700;color:#9A9CA3">${c.barber_id ? hrs(w.empty_min ?? 0) : '—'}</span>
    <span class="num" style="font-size:12px;font-weight:700">${c.barber_id ? `${approx ? '≈ ' : ''}${DH(w.share_cents ?? 0)}` : '—'}</span>
    ${chev}</a>`;
  };
  const stat = (k, v, sub) => `<div style="flex:1;min-width:150px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:4px">
    <span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${k}</span><span class="num" style="font-size:20px;font-weight:800">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${sub}</span></div>`;
  const row = (x) => `<a href="${base}/${x.barber_id}" class="hov" style="${grid};align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;${x.barber_id === pick ? 'background:#1C1C20' : ''}">
    <span style="display:flex;align-items:center;gap:10px;min-width:0">${`<span style="width:30px;height:30px;border-radius:999px;background:${x.salon_role === 'owner' ? 'rgba(232,68,46,.16)' : '#212125'};color:${x.salon_role === 'owner' ? '#E8442E' : '#fff'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none">${esc(initials(x.full_name))}</span>`}
      <span style="font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.full_name)}</span>${x.salon_role === 'owner' ? '<span style="font-size:8.5px;letter-spacing:.12em;font-weight:700;color:#9A9CA3;background:#26262B;border-radius:5px;padding:3px 5px">YOU</span>' : ''}${x.is_cash_agent ? '<span title="Holds the cash" style="font-size:8.5px;letter-spacing:.12em;font-weight:700;color:#E8A100;background:rgba(232,161,0,.12);border-radius:5px;padding:3px 5px">CASH</span>' : ''}</span>
    <span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:12px;font-weight:600">${x.in_service ? 'Cutting' : x.today_bookings ? `${x.today_bookings} today` : 'Nothing booked today'}</span><span style="font-size:10.5px;color:#9A9CA3">${esc(x.chair_label || '')}</span></span>
    <span class="num" style="display:flex;flex-direction:column;gap:2px"><span style="font-size:12px;font-weight:700">${x.reviews_count ? `${Number(x.rating).toFixed(1)} ★` : '—'}</span><span style="font-size:10.5px;color:#9A9CA3">${x.reviews_count} review${x.reviews_count === 1 ? '' : 's'}</span></span>
    <span class="num" style="font-size:12px;font-weight:700">${esc(rateOf(x))}</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B72" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg></a>`;
  const request = (x) => `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #1E1E22">
    <span style="width:30px;height:30px;border-radius:999px;border:1.5px dashed #3A3A40;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(x.full_name))}</span>
    <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(x.full_name)}</span><span style="font-size:10.5px;color:#9A9CA3">Asked to join ${esc(shop.name)}</span></span>
    ${btn('Decline', `data-decline="${x.barber_id}"`, 's')}${btn('Approve', `data-approve="${x.barber_id}"`)}</div>`;

  // OBR-01 — the barber, as the app's 2c computes him
  let panel = '', rentNext = '', rentLast = '', rentNow = '';
  if (m) {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
    const to = new Date(); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
    const own = m.salon_role === 'owner';
    const rent = m.pay_model === 'rent' && !own;   // the owner's own cuts are all his, whatever pay_model says
    const [rep, bks, prof, paid] = await Promise.all([
      rpc('salon_report', { p_from: from.toISOString(), p_to: to.toISOString() }),
      rpc('shop_bookings', { p_from: from.toISOString(), p_to: to.toISOString(), p_barber: m.barber_id }),
      rest(`profiles?select=phone&id=eq.${m.barber_id}`).catch(() => []),
      rent ? rest(`rent_payments?select=id,covers_from,covers_to,amount_cents&barber_id=eq.${m.barber_id}&order=covers_to.desc&limit=6`) : [],
    ]);
    const w = rep.find((r) => r.barber_id === m.barber_id) || { bookings: 0, booked_cents: 0, commission_cents: 0, no_shows: 0 };
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return bks.filter((b) => (b.status === 'confirmed' || b.status === 'completed') && new Date(b.starts_at).toDateString() === d.toDateString()).reduce((a, b) => a + (b.price_cents ?? 0), 0);
    });
    const max = Math.max(...days, 1);
    const avg = w.bookings ? Math.round((w.booked_cents ?? 0) / w.bookings) : 0;
    const occ = Math.min(100, Math.round(w.bookings * 30 / (Math.max(1, (meta.close_min ?? 1260) - (meta.open_min ?? 600)) * 7) * 100));
    const phone = prof[0]?.phone;
    // 0142 — the rent taken at the shop. The server writes the period after the last
    // one, else the month (or Monday's week) we are in; this only names it.
    const week = m.rent_period === 'week';
    const monday = new Date(); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const upTo = paid[0]?.covers_to;
    const next = upTo ? (week ? `Week of ${dayShort(upTo)}` : monthName(upTo)) : (week ? `Week of ${dayShort(monday)}` : monthName(new Date()));
    // more than a period behind: maybe owed, maybe he wasn't on rent then (0144)
    const curStart = week ? new Date(monday.getFullYear(), monday.getMonth(), monday.getDate()) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const behind = !!upTo && Date.parse(upTo) < curStart.getTime();
    rentNow = week ? `Week of ${dayShort(curStart)}` : monthName(curStart);
    rentNext = `${DH(m.rent_cents)} for ${next}`;
    rentLast = paid[0] ? periodName(paid[0].covers_from, paid[0].covers_to) : '';
    const mini = (v, l) => `<span style="flex:1;display:flex;flex-direction:column;gap:3px"><span class="num" style="font-size:14px;font-weight:700">${esc(v)}</span><span style="font-size:9px;letter-spacing:.12em;font-weight:700;color:#6B6B72">${l}</span></span>`;
    panel = `<a href="${base}" style="position:absolute;inset:0;z-index:6;background:rgba(5,5,6,.45)"></a>
      <div style="position:absolute;top:0;right:0;bottom:0;z-index:7;width:min(400px,100%);overflow:auto;border-left:1px solid #26262B;box-shadow:-24px 0 60px rgba(0,0,0,.45);background:#17171A">
        <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
          <div style="display:flex;align-items:center;gap:14px"><span style="width:56px;height:56px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex:none">${esc(initials(m.full_name))}</span>
            <span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:16px;font-weight:800">${esc(m.full_name)}</span>
              <span style="font-size:11.5px;color:#9A9CA3">${m.salon_role === 'owner' ? 'Owner' : m.chair_label ? `Barber · ${esc(m.chair_label)}` : 'Barber'}${m.reviews_count ? ` · ${Number(m.rating).toFixed(1)} ★ (${m.reviews_count})` : ' · no reviews yet'}</span></span>
            <a href="${base}" aria-label="Close" style="color:#9A9CA3;font-size:18px;text-decoration:none">×</a></div>
          <div style="display:flex;gap:8px">${phone ? `<a href="tel:${esc(phone.replace(/\s/g, ''))}" class="btn-s" style="flex:1;height:36px;border-radius:999px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;text-decoration:none">Call ${esc(phone)}</a>` : ''}
            <span data-chat="1" class="btn-s" style="flex:1;height:36px;border-radius:999px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;cursor:pointer">Chat</span></div>
          ${eyebrow('THIS WEEK')}
          <div style="background:#111113;border:1px solid #1E1E22;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;justify-content:space-between"><span style="display:flex;flex-direction:column;gap:4px">${eyebrow('BOOKED VALUE')}<span class="num" style="font-family:'Playfair Display',serif;font-size:26px;font-weight:700">${rent ? '—' : DH(w.booked_cents ?? 0)}</span></span>
              <span style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${eyebrow(own ? 'ALL YOURS' : rent ? `RENT · A ${week ? 'WEEK' : 'MONTH'}` : `SHOP CUT · ${100 - m.commission_pct}%`)}<span class="num" style="font-size:17px;font-weight:700;color:#E8442E">${DH(own ? (w.booked_cents ?? 0) : rent ? m.rent_cents : w.commission_cents)}</span></span></div>
            ${rent ? '' : `<div style="display:flex;align-items:flex-end;gap:5px;height:54px">${days.map((v, i) => `<span style="flex:1;height:${Math.max(6, v / max * 100)}%;border-radius:4px;background:${i === 6 ? '#5B8DEF' : 'rgba(91,141,239,.3)'}"></span>`).join('')}</div>`}
            <div style="display:flex;gap:8px">${mini(String(w.bookings), 'CLIENTS')}${mini(occ + '%', 'OCCUPANCY')}${mini(String(w.no_shows), 'NO-SHOWS')}${mini(rent ? '—' : DH(avg), 'AVG TICKET')}</div>
          </div>
          ${eyebrow('ACCESS')}
          <div style="background:#111113;border:1px solid #1E1E22;border-radius:14px;padding:4px 14px">
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #1E1E22"><span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:600">Holds the shop’s cash</span><span style="font-size:10.5px;color:#9A9CA3">${m.is_cash_agent ? 'Yes — takes top-ups and pays the chairs' : 'No'}</span></span><a href="${base}/cash" style="font-size:11.5px;font-weight:700">Change</a></div>
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0"><span style="flex:1;font-size:12.5px;font-weight:600">${own ? 'Pay' : rent ? 'Chair rent' : 'Commission rate'}</span><span class="num" style="font-size:12px;font-weight:700;background:#212125;border-radius:999px;padding:4px 10px">${esc(rateOf(m))}</span>${own ? '' : `<a href="${base}/${m.barber_id}?terms=1" style="font-size:11.5px;font-weight:700">Change</a>`}</div>
          </div>
          ${rent ? `${eyebrow('RENT')}
          <div style="background:#111113;border:1px solid #1E1E22;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px">
            <span style="font-size:12.5px;font-weight:700;color:${upTo && Date.parse(upTo) <= Date.now() ? '#F87171' : '#fff'}">${!upTo ? 'Nothing written down yet' : Date.parse(upTo) > Date.now() ? `Paid up to ${esc(dayShort(upTo))}` : `Due since ${esc(dayShort(upTo))}`}</span>
            ${paid.map((r, i) => `<div style="display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:12px;color:#C9CAD0">${esc(periodName(r.covers_from, r.covers_to))}${i === 0 ? ' · <span data-rent-undo="1" style="color:#E8442E;font-weight:700;cursor:pointer">Take back</span>' : ''}</span><span class="num" style="font-size:12px;font-weight:700">${DH(r.amount_cents)}</span></div>`).join('')}
            ${m.rent_cents > 0 ? btn(`MARK ${esc(next.toUpperCase())} PAID IN CASH`, 'data-rent="1"')
              + (behind ? `<span data-rent-restart="1" style="font-size:11.5px;font-weight:700;color:#E8442E;cursor:pointer">Start again from ${esc(rentNow)}</span>` : '')
              : '<span style="font-size:11px;color:#6B6B72">Set the rent first — Change, above.</span>'}
          </div>` : ''}
          ${m.salon_role === 'owner' ? '' : `<span data-remove="1" style="height:44px;border-radius:999px;border:1px solid rgba(248,113,113,.4);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;letter-spacing:.08em;color:#F87171;cursor:pointer">REMOVE FROM SHOP</span>`}
        </div></div>`;
  }

  const html = `<div style="position:relative;height:100%"><div style="position:absolute;inset:0;overflow:auto">
    <div style="padding:20px 24px 32px;display:flex;flex-direction:column;gap:16px;max-width:1100px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">WORKING · ${approved.length}</span><span style="flex:1"></span>
        <a href="${base}/cash" class="btn-s" style="height:34px;border-radius:9px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:700;color:#fff;text-decoration:none">Cash in the till</a>
        <a href="${base}?invite=1" class="btn-p" style="height:34px;border-radius:9px;background:#E8442E;display:flex;align-items:center;padding:0 14px;font-size:11.5px;font-weight:700;color:#fff;text-decoration:none">Invite a barber</a>
      </div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
        <div style="${grid};padding:10px 16px;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72"><span>BARBER</span><span>RIGHT NOW</span><span>RATING</span><span>PAY</span><span></span></div>
        ${approved.map(row).join('')}
      </div>
      ${pending.length ? `<span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">ASKED TO JOIN · ${pending.length}</span>
        <div style="background:#17171A;border:1px solid rgba(232,161,0,.28);border-radius:14px;overflow:hidden">${pending.map(request).join('').replace('border-top:1px solid #1E1E22', '')}</div>`
        : '<span style="font-size:11.5px;color:#6B6B72">Nobody is waiting to join.</span>'}
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px">
        <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">THE CHAIRS · ${chairs.length}</span>
        ${mon ? `<span style="font-size:11.5px;color:#9A9CA3">${esc(dayWk(mon))} – ${esc(dayWk(shift(mon, 6)))}</span><span style="flex:1"></span>
          <a href="${base}?week=${shift(mon, -7)}" class="btn-s" style="height:30px;border-radius:8px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 10px;font-size:11.5px;font-weight:700;color:#fff;text-decoration:none">‹ Week before</a>
          <a href="${base}?week=${shift(mon, 7)}" class="btn-s" style="height:30px;border-radius:8px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 10px;font-size:11.5px;font-weight:700;color:#fff;text-decoration:none">Week after ›</a>` : ''}
      </div>
      ${chairs.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap">
          ${stat('CHAIR-HOURS SOLD', hrs(tot.sold), `of ${hrs(tot.open)} open`)}
          ${stat('EMPTY', hrs(tot.empty), tot.open ? `${Math.round(tot.empty / tot.open * 100)}% · ${hrs(tot.am)} of them before noon` : 'no hours open')}
          ${stat('YOUR SHARE', DH(tot.share), 'from the chairs this week')}</div>
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
          <div style="${cgrid};padding:10px 16px;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72"><span>CHAIR</span><span>WHO SITS IN IT</span><span>SOLD</span><span>EMPTY</span><span>YOUR SHARE</span><span></span></div>
          ${chairs.map(chairRow).join('')}</div>`
        : '<span style="font-size:11.5px;color:#6B6B72">No chairs yet — add them in the Sterncut app, under Salon management.</span>'}
    </div></div>${panel}</div>`;

  return {
    html,
    async ready(root) {
      root.onclick = async (e) => {
        const a = e.target.closest('[data-approve],[data-decline],[data-remove],[data-chat],[data-rent],[data-rent-undo],[data-rent-restart]');
        if (!a) return;
        if (a.dataset.chat) return toast('Chat is in the Sterncut app', false);
        // 0142 — rent is written down, not moved: the cash is in the owner's hand first
        if (a.dataset.rent || a.dataset.rentUndo || a.dataset.rentRestart) {
          if (a.dataset.rent && !confirm(`${rentNext}, received in cash?\n\nOnly once it is in your hand. The latest one can be taken back.`)) return;
          if (a.dataset.rentUndo && !confirm(`Take back ${rentLast}? It goes back to unpaid.`)) return;
          if (a.dataset.rentRestart && !confirm(`Start again from ${rentNow}?\n\nThe periods in between stay off the record. Use it when he wasn’t on rent then — not to clear what he owes.`)) return;
          try {
            await rpc(a.dataset.rentUndo ? 'salon_rent_undo' : 'salon_rent_received',
              a.dataset.rentRestart ? { p_barber: m.barber_id, p_restart: true } : { p_barber: m.barber_id });
            toast(a.dataset.rentUndo ? 'Taken back' : 'Written down');
            go(location.pathname, { replace: true });
          } catch (err) { toast(err.message, false); }
          return;
        }
        const id = a.dataset.approve || a.dataset.decline || m?.barber_id;
        const who = members.find((x) => x.barber_id === id);
        try {
          if (a.dataset.approve) { await rpc('salon_approve_member', { p_barber: id }); toast(`${first(who.full_name)} is on the team`); }
          else if (a.dataset.decline) { if (!confirm(`Decline ${who.full_name}’s request?`)) return; await rpc('salon_remove_member', { p_barber: id }); toast('Request declined'); }
          else {
            // OBR-01's "asks first": the removal says what happens to his clients before it happens
            const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
              <span style="font-size:17px;font-weight:800">Remove ${esc(first(who.full_name))} from ${esc(shop.name)}?</span>
              <span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">${esc(first(who.full_name))} keeps their Sterncut account, their own clients and their reviews, but leaves ${esc(shop.name)} and its page.</span>
              <div style="display:flex;gap:10px;justify-content:flex-end">${btn(`KEEP ${esc(first(who.full_name).toUpperCase())}`, 'data-dlg-close="1"', 's')}${btn('REMOVE', 'id="rm-go"')}</div></div>`, { width: 460 });
            d.querySelector('#rm-go').onclick = async () => {
              try { await rpc('salon_remove_member', { p_barber: id }); closeDialog(); toast(`${first(who.full_name)} has left ${shop.name}`); go(base); }
              catch (err) { toast(err.message, false); }
            };
            return;
          }
          go(location.pathname, { replace: true });
        } catch (err) { toast(err.message, false); }
      };
      if (q.get('invite')) {
        const words = `Join ${shop.name} on Sterncut: open the Sterncut app, sign up as a barber, choose “Join a salon” and pick ${shop.name}${shop.address ? ` (${shop.address})` : ''}. I approve you from here.`;
        const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Invite a barber</span>
          <span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">A barber joins from the Sterncut app: they sign up as a barber, choose <b style="color:#fff">Join a salon</b> and picks ${esc(shop.name)}. The request lands here, under the team, for you to approve.</span>
          <div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:12px 13px;font-size:12px;line-height:1.55;color:#C9CAD0">${esc(words)}</div>
          <span style="font-size:11px;color:#6B6B72">There is no invite by phone number yet: nothing sends SMS. Copy the words and send them yourself.</span>
          <div style="display:flex;gap:10px;justify-content:flex-end">${btn('Close', 'data-dlg-close="1"', 's')}${btn('Copy the words', 'id="inv-copy"')}</div></div>`, { onClose: () => go(base), width: 480 });
        d.querySelector('#inv-copy').onclick = async () => { await navigator.clipboard?.writeText(words).catch(() => {}); toast('Copied'); };
      }
      // BRB-30 — what an empty chair asks, and LOOK FOR A BARBER
      const ch = q.get('chair') && chairs.find((c) => c.chair_id === q.get('chair'));
      if (ch) {
        const empty = !ch.barber_id;
        // 0144 — barbers who asked for it in the app, with what you'd ask about them first
        const asks = empty && ch.asks ? await rpc('salon_chair_asks', { p_chair: ch.chair_id }) : [];
        // RVW-12 — he came through Chairs for rent: when, and who heard (0146)
        const taken = empty ? null : (await rest(`chair_asks?select=answered_at,told&chair_id=eq.${ch.chair_id}&barber_id=eq.${ch.barber_id}&answer=eq.taken&order=answered_at.desc&limit=1`).catch(() => []))[0];
        const askRow = (a) => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid #1E1E22">
          <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(a.full_name)}</span>
            <span style="font-size:10.5px;color:#9A9CA3">${esc([a.reviews_count ? `${Number(a.rating).toFixed(1)} ★ (${a.reviews_count})` : null,
              `${a.cuts} cut${a.cuts === 1 ? '' : 's'} on Sterncut`, a.shop_name ? `at ${a.shop_name}` : 'no shop now'].filter(Boolean).join(' · '))}</span></span>
          ${a.phone ? `<a href="tel:${esc(a.phone.replace(/\s/g, ''))}" style="font-size:11.5px;font-weight:700">Call</a>` : ''}
          ${btn('No', `data-ask-no="${a.ask_id}"`, 's')}${btn('Take on', `data-ask-take="${a.ask_id}"`)}</div>`;
        const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">${esc(ch.label)}</span>
          <span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">${empty
            ? `${ch.vacant_since ? `Empty since ${esc(dayShort(ch.vacant_since))}.` : 'Empty.'} An empty chair is not bookable, so customers never see it.`
            : `${esc(ch.barber_name)} sits in it. What he pays is on his own terms, under the team.${taken
              ? ` Taken on ${esc(dayShort(taken.answered_at))} from Chairs for rent${taken.told ? ` — ${taken.told} of his customers ${taken.told === 1 ? 'was' : 'were'} told where he went, once.` : '.'}`
              : ''}`}</span>
          ${asks.length ? `${label9(`ASKED FOR IT · ${asks.length}`, '#6B6B72')}
            <div style="background:#111113;border:1px solid #26262B;border-radius:12px;overflow:hidden">${asks.map(askRow).join('').replace('border-top:1px solid #1E1E22', '')}</div>` : ''}
          ${empty ? `
          <label style="display:flex;flex-direction:column;gap:6px">${label9('RENT · DH', '#6B6B72')}
            <span style="display:flex;gap:8px"><input id="ch-rent" inputmode="numeric" maxlength="6" placeholder="Not said" value="${ch.rent_cents != null ? Math.round(ch.rent_cents / 100) : ''}" style="${input};flex:1">
            <select id="ch-per" style="${input}"><option value="month"${ch.rent_period === 'week' ? '' : ' selected'}>a month</option><option value="week"${ch.rent_period === 'week' ? ' selected' : ''}>a week</option></select></span></label>
          <label style="display:flex;flex-direction:column;gap:6px">${label9('WHAT COMES WITH IT', '#6B6B72')}<textarea id="ch-note" rows="3" maxlength="280" placeholder="Products, days off, the hours you open…" style="${input};resize:vertical">${esc(ch.note || '')}</textarea></label>
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer"><input id="ch-list" type="checkbox"${ch.listed_at ? ' checked' : ''} style="margin-top:3px">
            <span style="display:flex;flex-direction:column;gap:3px"><span style="font-size:12.5px;font-weight:700">Look for a barber for ${esc(ch.label)}</span><span style="font-size:11px;line-height:1.5;color:#9A9CA3">Barbers on Sterncut see this chair, your shop and your phone number, to call you about it.</span></span></label>
          <div style="display:flex;gap:10px;justify-content:flex-end">${btn('Cancel', 'data-dlg-close="1"', 's')}${btn('Save', 'id="ch-go"')}</div>`
          : `<div style="display:flex;justify-content:flex-end">${btn('Close', 'data-dlg-close="1"', 's')}</div>`}</div>`, { onClose: () => go(base), width: 480 });
        d.querySelector('#ch-go')?.addEventListener('click', async () => {
          const raw = d.querySelector('#ch-rent').value.replace(/\D/g, '');
          const listed = d.querySelector('#ch-list').checked;
          try {
            await rpc('salon_set_chair', {
              p_chair: ch.chair_id, p_rent_cents: raw ? Number(raw) * 100 : null, p_rent_period: d.querySelector('#ch-per').value,
              p_note: d.querySelector('#ch-note').value, p_listed: listed,
            });
            closeDialog();
            toast(listed && !ch.listed_at ? `Posted — barbers on Sterncut can see ${ch.label}` : 'Saved');
          } catch (err) { toast(err.message, false); }
        });
        d.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-ask-take],[data-ask-no]');
          if (!b) return;
          const a = asks.find((x) => x.ask_id === (b.dataset.askTake || b.dataset.askNo));
          const take = !!b.dataset.askTake;
          if (take && !confirm(`Take ${a.full_name} on for ${ch.label}?\n\n${a.shop_name ? `He leaves ${a.shop_name} and sits` : 'He sits'} in ${ch.label} from today, on the rent this chair asks. His terms can be changed after.`)) return;
          if (!take && !confirm(`Say no to ${a.full_name}?\n\nHe is told, and can still ask for your other chairs.`)) return;
          try {
            await rpc(take ? 'take_chair_ask' : 'decline_chair_ask', { p_ask: a.ask_id });
            closeDialog();
            toast(take ? `${first(a.full_name)} is on the team, in ${ch.label}` : `${first(a.full_name)} is told no`);
          } catch (err) { toast(err.message, false); }
        });
      }
      // OBR-01's terms: rent or commission, and how much
      if (q.get('terms') && m && m.salon_role !== 'owner') {
        const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">${esc(first(m.full_name))}’s terms</span>
          <label style="display:flex;flex-direction:column;gap:6px">${label9('PAY', '#6B6B72')}<select id="t-model" style="${input}">
            <option value="commission"${m.pay_model === 'commission' ? ' selected' : ''}>Commission — the shop keeps a share of each cut</option>
            <option value="rent"${m.pay_model === 'rent' ? ' selected' : ''}>Rent — pays for the chair, keeps every cut</option></select></label>
          <label id="t-comm" style="display:flex;flex-direction:column;gap:6px">${label9('THE SHOP KEEPS · %', '#6B6B72')}<input id="t-cut" inputmode="numeric" maxlength="3" value="${100 - m.commission_pct}" style="${input}"></label>
          <label id="t-rent" style="display:flex;flex-direction:column;gap:6px">${label9('CHAIR RENT · DH', '#6B6B72')}
            <span style="display:flex;gap:8px"><input id="t-amt" inputmode="numeric" maxlength="6" placeholder="0" value="${m.rent_cents ? Math.round(m.rent_cents / 100) : ''}" style="${input};flex:1">
            <select id="t-per" style="${input}"><option value="month"${m.rent_period === 'week' ? '' : ' selected'}>a month</option><option value="week"${m.rent_period === 'week' ? ' selected' : ''}>a week</option></select></span>
            <span style="font-size:11px;line-height:1.5;color:#9A9CA3">A rent barber’s takings stay his: you see his bookings, not what they made.</span></label>
          <div style="display:flex;gap:10px;justify-content:flex-end">${btn('Cancel', 'data-dlg-close="1"', 's')}${btn('Save', 'id="t-go"')}</div></div>`,
        { onClose: () => go(`${base}/${m.barber_id}`), width: 480 });
        const sync = () => {
          const r = d.querySelector('#t-model').value === 'rent';
          d.querySelector('#t-comm').style.display = r ? 'none' : 'flex';
          d.querySelector('#t-rent').style.display = r ? 'flex' : 'none';
        };
        d.querySelector('#t-model').onchange = sync; sync();
        d.querySelector('#t-go').onclick = async () => {
          const model = d.querySelector('#t-model').value;
          const cut = Number(d.querySelector('#t-cut').value);
          if (model === 'commission' && !(Number.isInteger(cut) && cut >= 0 && cut <= 100)) return toast('The shop keeps between 0 and 100%', false);
          const amt = Number(d.querySelector('#t-amt').value.replace(/\D/g, '')) || 0;
          try {
            await rpc('salon_set_terms', {
              p_barber: m.barber_id, p_salon_role: m.salon_role, p_pay_model: model,
              p_commission_pct: model === 'commission' ? 100 - cut : m.commission_pct,
              p_rent_cents: model === 'rent' ? amt * 100 : m.rent_cents, p_chair: m.chair_label || '',
              p_rent_period: model === 'rent' ? d.querySelector('#t-per').value : null,
            });
            closeDialog(); toast('Terms saved');
          } catch (err) { toast(err.message, false); }
        };
      }
    },
  };
}

// ---- OBR-07 · who holds the cash --------------------------------------------------
async function cash({ rpc, go, toast, q }, shop) {
  const base = `/${shop.slug}/chairs`;
  const s = await rpc('cash_agent_state');
  const blocked = q.get('blocked') && s.candidates.find((c) => c.id === q.get('blocked'));
  const owed = s.dues.filter((d) => d.cents > 0);
  const inner = `
    <a href="${base}" style="font-size:12px;font-weight:600;color:#9A9CA3">← The chairs</a>
    <span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">One person keeps the shop’s cash and pays the others what they’re owed. Everyone can see who it is.</span>
    ${eyebrow('RIGHT NOW')}
    ${card(`<div style="display:flex;align-items:center;gap:12px"><span style="width:40px;height:40px;border-radius:999px;background:rgba(232,68,46,.16);color:#E8442E;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${esc(initials(s.agent.name))}</span>
      <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:13.5px;font-weight:700">${esc(s.agent.name)}${s.agent.is_me ? ' — you' : ''}</span>
      <span class="num" style="font-size:11px;color:#9A9CA3">Holding ${DH(s.drawer_cents)} · ${owed.length ? `owes ${DH(owed.reduce((n, d) => n + d.cents, 0))} to ${owed.length} chair${owed.length === 1 ? '' : 's'}` : 'owes nothing to the chairs'}</span></span></div>
      ${s.agent.since ? `<span style="font-size:10.5px;color:#6B6B72">Since ${esc(dayShort(s.agent.since))}</span>` : ''}`)}
    ${s.transfer ? `<div style="background:${s.transfer.state === 'mismatch' ? 'rgba(248,113,113,.08)' : 'rgba(232,161,0,.08)'};border:1px solid ${s.transfer.state === 'mismatch' ? 'rgba(248,113,113,.35)' : 'rgba(232,161,0,.3)'};border-radius:14px;padding:13px 14px;display:flex;flex-direction:column;gap:6px">
      <span style="font-size:12.5px;font-weight:700">${s.transfer.state === 'mismatch' ? 'The two counts did not match' : `${esc(first(s.transfer.to_name))} is counting it in`}</span>
      <span style="font-size:11.5px;line-height:1.5;color:#9A9CA3">${s.transfer.state === 'mismatch'
        ? `${esc(first(s.transfer.from_name))} handed over ${DH(s.transfer.declared_cents ?? 0)} by our books; ${esc(first(s.transfer.to_name))} counted ${DH(s.transfer.counted_cents ?? 0)}. Sterncut is ringing them both. Until it is settled ${esc(first(s.transfer.from_name))} still holds the drawer and still pays the chairs.`
        : `They confirm ${DH(s.transfer.started_cents)} on their own phone. Until they do, ${esc(first(s.transfer.from_name))} still holds it and still pays the chairs.`}</span>
      ${s.transfer.state === 'pending' ? '<span data-stop="1" style="font-size:11.5px;font-weight:700;color:#E8A100;cursor:pointer">Stop the handover</span>' : ''}</div>` : ''}
    ${blocked ? card(`<span style="font-size:13px;font-weight:700">Not yet — there is cash attached to ${esc(first(s.agent.name))}</span>
      <span style="font-size:11.5px;line-height:1.55;color:#9A9CA3">${esc(first(s.agent.name))} holds ${DH(s.drawer_cents)}${owed.length ? ` and owes ${DH(owed.reduce((n, d) => n + d.cents, 0))} to the chairs` : ''}. The drawer is counted over to ${esc(first(blocked.name))} first — ${esc(first(blocked.name))} confirms the amount on their own phone, and only then does the role move.</span>
      <div style="display:flex;gap:10px">${btn(`COUNT IT OVER TO ${esc(first(blocked.name).toUpperCase())}`, `data-count="${blocked.id}"`)}${btn('Not now', `data-go="${base}/cash"`, 's')}</div>`, 'border-color:rgba(232,161,0,.3)') : ''}
    ${eyebrow('GIVE IT TO')}
    <div style="background:#17171A;border:1px solid #1E1E22;border-radius:18px;overflow:hidden">${s.candidates.filter((c) => c.id !== s.agent.id).map((c) => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #1E1E22"><span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(c.name)}</span><span style="font-size:10.5px;color:#9A9CA3">${c.is_owner ? 'Owner' : esc(c.chair || 'Barber')}</span></span>
        ${s.transfer ? '' : btn('Give it to them', `data-give="${c.id}"`, 's')}</div>`).join('').replace('border-top:1px solid #1E1E22', '') || '<div style="padding:14px 16px;font-size:12px;color:#6B6B72">Nobody else on the team to give it to.</div>'}</div>`;
  return {
    html: column(inner),
    ready(root) {
      root.onclick = async (e) => {
        const g = e.target.closest('[data-give]'), c = e.target.closest('[data-count]'), x = e.target.closest('[data-stop]');
        try {
          if (g) {
            // the database decides: the role moves, or it says what is attached (0127)
            const r = await rpc('set_cash_agent', { p_barber: g.dataset.give });
            if (r.state === 'blocked') return go(`${base}/cash?blocked=${g.dataset.give}`);
            toast('Done — the cash role has moved'); go(`${base}/cash`, { replace: true });
          } else if (c) { await rpc('start_drawer_transfer', { p_barber: c.dataset.count }); toast('Handover started'); go(`${base}/cash`); }
          else if (x) { await rpc('cancel_drawer_transfer'); toast('Handover stopped'); go(`${base}/cash`, { replace: true }); }
        } catch (err) { toast(err.message, false); }
      };
    },
  };
}
