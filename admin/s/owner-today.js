// /{slug}/today — README §4: the web Today merges OSH-02 (dashboard), OSH-19
// (the chairs' lines) and OSH-03 (all chairs, day view). Every figure is the
// app's own read: salon_team, shop_bookings (0120), shop_lines_today (0119),
// my_statement (0086) and the reviews nobody answered (0031's reply column; four
// stars or fewer, as the app counts "needs a reply").
//
// Not as drawn: "Pause walk-ins, whole shop" is not a separate switch. The app
// keeps one shop-wide lever on purpose (OSH-09, close_shop — LinesScreen says so),
// and it pauses new bookings as well as the line, so the card opens that page.
import { esc, DH, first, initials, hhmm, dayShort, ZONE } from '/app.js';
import { shopDay, shopMin, clock, CHAIR_TINTS, stars } from '/s/ui.js';

const tile = (label, value, note, noteColor = '#9A9CA3', href) => `
  <${href ? `a href="${href}"` : 'div'} style="background:#17171A;border:1px solid #1E1E22;border-radius:13px;padding:14px 15px;display:flex;flex-direction:column;gap:5px;text-decoration:none;color:#fff">
    <span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${label}</span>
    <span class="num" style="font-size:22px;font-weight:800">${esc(value)}</span>
    <span style="font-size:10px;color:${noteColor}">${esc(note)}</span>
  </${href ? 'a' : 'div'}>`;

export default async function ({ rpc, rest, shop: s0 }) {
  const shop = await rpc('owner_shop', { p_slug: s0.slug });      // not_found → the 404
  const base = `/${shop.slug}`;
  const day = shopDay();
  const [meta, team, rows, lines, st, vs] = await Promise.all([
    rest(`salons?select=open_min,close_min,accepting_bookings,closed_until&id=eq.${shop.id}`).then((r) => r[0] || {}),
    rpc('salon_team'),
    rpc('shop_bookings', { p_from: day.from, p_to: day.to }),
    rpc('shop_lines_today').catch(() => []),
    rpc('my_statement', { p_week: null }).catch(() => null),
    rpc('my_visit_status').catch(() => null),
  ]);
  const roster = team.filter((m) => m.salon_status === 'approved');
  const ids = roster.map((m) => m.barber_id);
  const inIds = `in.(${ids.join(',')})`;
  const [blocks, off, reviews] = ids.length ? await Promise.all([
    rest(`time_blocks?select=barber_id,label,day,start_min,end_min&kind=eq.block&barber_id=${inIds}`).catch(() => []),
    rest(`days_off?select=barber_id&day=eq.${day.ymd}&barber_id=${inIds}`).catch(() => []),
    rest(`reviews?select=id,rating,comment,created_at,barber_id,customer_id&reply=is.null&rating=lte.4&barber_id=${inIds}&order=created_at.desc&limit=20`).catch(() => []),
  ]) : [[], [], []];
  const names = reviews.length
    ? Object.fromEntries((await rest(`profiles?select=id,full_name&id=in.(${[...new Set(reviews.map((r) => r.customer_id))].join(',')})`).catch(() => [])).map((p) => [p.id, p.full_name]))
    : {};

  // ---- the numbers, the way the app's dashboard counts them
  const live = rows.filter((b) => ids.includes(b.barber_id));
  const done = live.filter((b) => b.status === 'confirmed' || b.status === 'completed');
  const take = done.reduce((a, b) => a + (b.price_cents ?? 0), 0);
  const cut = roster.filter((m) => m.pay_model === 'commission').reduce((a, m) =>
    a + Math.round(done.filter((b) => b.barber_id === m.barber_id).reduce((x, b) => x + (b.price_cents ?? 0), 0) * (100 - m.commission_pct) / 100), 0);
  const noShows = live.filter((b) => b.status === 'no_show');
  const byLine = Object.fromEntries(lines.map((c) => [c.barber_id, c]));
  const waiting = lines.reduce((a, c) => a + c.waiting, 0);
  const unconfirmed = lines.reduce((a, c) => a + c.unconfirmed, 0);
  const worst = lines.filter((c) => c.wait_min != null).sort((a, b) => b.wait_min - a.wait_min)[0];
  // off: marked off today, or not on the rota with nothing booked (a booking is a day's work)
  const isOff = (id) => off.some((o) => o.barber_id === id) || (byLine[id] && !byLine[id].working && !done.some((b) => b.barber_id === id));
  const working = roster.filter((m) => !isOff(m.barber_id));
  const openMin = Math.max(1, (meta.close_min ?? 1260) - (meta.open_min ?? 600)) * Math.max(1, working.length);
  const bookedMin = done.reduce((a, b) => a + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000, 0);
  const occ = Math.min(100, Math.round(bookedMin / openMin * 100));
  const tint = Object.fromEntries(roster.map((m, i) => [m.barber_id, CHAIR_TINTS[i % CHAIR_TINTS.length]]));
  const nameOf = (id) => first(roster.find((m) => m.barber_id === id)?.full_name || 'Barber');
  const who = (b) => b.walk_in_name || (b.customer?.full_name ? `${first(b.customer.full_name)} ${(b.customer.full_name.split(' ')[1] || '')[0] || ''}.`.replace(/ \.$/, '') : 'Walk-in');

  // ---- the chairs, right now
  const grid = 'display:grid;grid-template-columns:minmax(140px,1.1fr) minmax(150px,1.4fr) minmax(110px,1fr) minmax(90px,.8fr) 14px;gap:12px';
  const chairRow = (m) => {
    const c = byLine[m.barber_id];
    const mine = done.filter((b) => b.barber_id === m.barber_id);
    const inChair = mine.find((b) => b.started_at && !b.completed_at);
    const dayOff = isOff(m.barber_id);
    const next = mine.find((b) => !b.started_at && !b.completed_at);
    const now = dayOff ? ['Day off', ''] : inChair ? [`Cutting ${who(inChair)}`, `free ${hhmm(inChair.ends_at)}`]
      : c?.paused ? ['Line paused', 'still cutting bookings'] : ['Free', next ? `next ${hhmm(next.starts_at)}` : 'nothing booked'];
    const rev = mine.reduce((a, b) => a + (b.price_cents ?? 0), 0);
    const hidden = m.pay_model === 'rent' && m.salon_role !== 'owner';   // 0025: a rent barber's takings are his
    const me = m.salon_role === 'owner';
    return `<a href="${base}/chairs/${m.barber_id}" class="hov" style="${grid};align-items:center;padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;${dayOff ? 'opacity:.55' : ''}">
      <span style="display:flex;align-items:center;gap:10px;min-width:0"><span style="position:relative;width:30px;height:30px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex:none">${esc(initials(m.full_name))}<span style="position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:999px;background:${dayOff ? '#3A3A40' : tint[m.barber_id]};border:2px solid #17171A"></span></span><span style="font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(first(m.full_name))}</span>${me ? '<span style="font-size:8.5px;letter-spacing:.12em;font-weight:700;color:#9A9CA3;background:#26262B;border-radius:5px;padding:3px 5px">YOU</span>' : ''}</span>
      <span style="display:flex;flex-direction:column;gap:2px;min-width:0"><span style="font-size:12px;font-weight:600">${esc(now[0])}</span><span style="font-size:10.5px;color:#9A9CA3">${esc(now[1])}</span></span>
      ${dayOff ? '<span style="font-size:12px;color:#6B6B72">—</span>' : `<span style="display:flex;flex-direction:column;gap:2px"><span class="num" style="font-size:12px;font-weight:700;color:${(c?.wait_min ?? 0) >= 45 ? '#E8A100' : '#fff'}">${c?.waiting ? `~${c.wait_min ?? 0} min` : 'Nobody waiting'}</span><span style="font-size:10.5px;color:#9A9CA3">${c?.unconfirmed ? `${c.unconfirmed} unconfirmed` : c?.waiting ? `${c.waiting} waiting` : ''}</span></span>`}
      ${dayOff ? '<span style="font-size:12px;color:#6B6B72">—</span>' : `<span style="display:flex;flex-direction:column;gap:2px"><span class="num" style="font-size:12px;font-weight:700">${hidden ? '—' : DH(rev)}</span><span style="font-size:10.5px;color:#9A9CA3">${mine.length} booking${mine.length === 1 ? '' : 's'}</span></span>`}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B6B72" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>
    </a>`;
  };

  // ---- the day view: one 42 px lane per chair, the shop's hours
  const o = meta.open_min ?? 600, cl = Math.max((meta.close_min ?? 1260), o + 60);
  const span = cl - o, pct = (m) => ((m - o) / span * 100).toFixed(2);
  const ticks = []; for (let m = o; m < cl; m += 60) ticks.push(m);
  const lane = (m) => {
    if (isOff(m.barber_id)) {
      return `<div style="display:flex;align-items:center;gap:12px;opacity:.55"><span style="width:80px;flex:none;display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700"><span style="width:7px;height:7px;border-radius:999px;background:#3A3A40;flex:none"></span>${esc(first(m.full_name))}</span>
        <div style="flex:1;min-width:0;height:42px;border-radius:10px;border:1px dashed #3A3A40;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:10px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">DAY OFF</div></div>`;
    }
    const slot = (l, w, bg, label, sub, dark, extra = '') => `<span style="position:absolute;top:4px;bottom:4px;left:${l}%;width:${w}%;border-radius:7px;background:${bg};${dark ? 'color:#0D0D0F;' : ''}padding:0 7px;display:flex;flex-direction:column;justify-content:center;overflow:hidden;box-sizing:border-box;${extra}"><span style="font-size:10px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</span>${sub ? `<span style="font-size:9px;opacity:.75;white-space:nowrap">${esc(sub)}</span>` : ''}</span>`;
    const brk = blocks.filter((b) => b.barber_id === m.barber_id && (!b.day || b.day === day.ymd))
      .map((b) => slot(pct(Math.max(o, b.start_min)), Math.max(1, (Math.min(cl, b.end_min) - Math.max(o, b.start_min)) / span * 100).toFixed(2), 'rgba(232,161,0,.5)', b.label || 'Break', '', true));
    const bks = live.filter((b) => b.barber_id === m.barber_id && b.status !== 'cancelled').map((b) => {
      const s = shopMin(b.starts_at, day.off), e = shopMin(b.ends_at, day.off);
      const w = Math.max(1.5, (Math.min(e, cl) - Math.max(s, o)) / span * 100).toFixed(2);
      if (b.status === 'no_show') return slot(pct(s), w, 'rgba(248,113,113,.28)', 'No-show', '', false, 'border:1px dashed rgba(248,113,113,.7);color:#F87171');
      if (b.started_at && !b.completed_at) return slot(pct(s), w, 'rgba(74,222,128,.9)', who(b), 'In chair', true);
      return slot(pct(s), w, tint[m.barber_id] + 'E6', who(b), b.services?.name || '', false);
    });
    return `<div style="display:flex;align-items:center;gap:12px"><span style="width:80px;flex:none;display:flex;align-items:center;gap:7px;font-size:11.5px;font-weight:700"><span style="width:7px;height:7px;border-radius:999px;background:${tint[m.barber_id]};flex:none"></span>${esc(first(m.full_name))}</span>
      <div style="flex:1;min-width:0;position:relative;height:42px;background:#141416;border-radius:10px;overflow:hidden">
        ${ticks.slice(1).map((t) => `<span style="position:absolute;top:0;bottom:0;left:${pct(t)}%;width:1px;background:#1E1E22"></span>`).join('')}
        ${brk.join('')}${bks.join('')}
      </div></div>`;
  };

  // ---- the right column
  const closed = meta.accepting_bookings === false;
  const walkins = closed ? `
    <div style="background:#17171A;border:1px solid #26262B;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:11px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:12.5px;font-weight:700">Walk-ins</span><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#E8A100;background:rgba(232,161,0,.12);border-radius:999px;padding:3px 8px">PAUSED</span></div>
      <span style="font-size:11px;line-height:1.5;color:#9A9CA3">The shop is paused ${meta.closed_until ? `until ${esc(dayShort(meta.closed_until + 'T12:00:00Z'))}` : 'until you reopen'}. Barbers still cut the bookings they have.</span>
      <span data-reopen="1" class="btn-p" style="height:38px;border-radius:9px;background:#E8442E;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Reopen the shop</span>
    </div>` : `
    <div style="background:#17171A;border:1px solid ${waiting ? 'rgba(232,161,0,.28)' : '#1E1E22'};border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:11px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span style="font-size:12.5px;font-weight:700">Walk-ins</span><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#4ADE80;background:rgba(74,222,128,.12);border-radius:999px;padding:3px 8px">LIVE</span></div>
      <div style="display:flex;align-items:baseline;gap:8px"><span class="num" style="font-size:26px;font-weight:800">${waiting}</span><span style="font-size:11px;color:#9A9CA3">waiting in the shop</span></div>
      ${worst ? `<span style="font-size:11px;line-height:1.5;color:#9A9CA3">Longest wait is ~${worst.wait_min} min at ${worst.me ? 'your chair' : esc(first(worst.name)) + '’s chair'}.</span>` : ''}
      ${unconfirmed ? `<span style="font-size:10.5px;font-weight:600;color:#E8A100">${unconfirmed} name${unconfirmed === 1 ? '' : 's'} never confirmed</span>` : ''}
      <a href="${base}/shop/pause" class="btn-s" style="height:38px;border-radius:9px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#fff;text-decoration:none">Pause the shop</a>
    </div>`;
  const s = st?.statement;
  const pend = vs?.pending;
  const settle = !s ? '' : `
    <a href="${base}/payouts/${esc(s.week)}" style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:7px;text-decoration:none;color:#fff">
      <span style="font-size:12.5px;font-weight:700">${s.settled_at ? `Week ${esc(s.week.slice(-2))} · settled` : s.direction === 'pay_out' ? 'Weekly payout coming' : s.direction === 'nil' ? `Week ${esc(s.week.slice(-2))} · nothing moved` : 'Weekly settlement due'}</span>
      <span class="num" style="font-size:22px;font-weight:800">${DH(s.total_cents)}</span>
      <span style="font-size:11px;color:#9A9CA3">Week ${esc(s.week.slice(-2))}${pend ? ` · ${esc(pend.agent)} ${pend.direction === 'pay_out' ? 'brings it' : 'collects'} ${pend.window_from ? `Friday ${hhmm(pend.window_from)}–${hhmm(pend.window_to)}` : 'Friday'}` : s.settled_at ? ` · receipt ${esc(s.receipt_ref || '')}` : ''}</span>
      <span style="font-size:11px;font-weight:700;color:#E8442E;margin-top:3px">Open the statement</span>
    </a>`;
  const reply = reviews.slice(0, 2);
  const needs = `
    <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <span style="display:flex;align-items:center;gap:8px"><span style="font-size:12.5px;font-weight:700">Needs a reply</span>${reviews.length ? `<span class="num" style="font-size:10px;font-weight:700;color:#0D0D0F;background:#E8A100;border-radius:999px;padding:2px 7px">${reviews.length}</span>` : ''}</span>
        <a href="${base}/reviews" style="font-size:10.5px;font-weight:600;color:#6B6B72">All reviews</a>
      </div>
      ${reply.length ? reply.map((r, i) => `<a href="${base}/reviews?reply=${r.id}" class="hov" style="display:flex;flex-direction:column;gap:5px;padding:10px;margin:0 -10px;border-radius:10px;text-decoration:none;color:#fff;${i ? 'border-top:1px solid #26262B' : ''}">
        <span style="display:flex;align-items:center;gap:8px;font-size:11.5px"><span style="font-weight:700">${esc(names[r.customer_id] || 'A customer')}</span>${stars(r.rating)}</span>
        ${r.comment ? `<span style="font-size:11px;line-height:1.5;color:#C9CAD0">${esc(r.comment)}</span>` : ''}
        <span style="font-size:10px;color:#6B6B72">${esc(nameOf(r.barber_id))} · ${esc(dayShort(r.created_at))}</span></a>`).join('')
        : '<span style="font-size:11px;color:#6B6B72">Every review has an answer.</span>'}
    </div>`;

  const html = `<div style="height:100%;overflow:auto;box-sizing:border-box">
  <div style="padding:20px 24px 32px;display:flex;flex-wrap:wrap;align-items:flex-start;gap:18px;box-sizing:border-box">
    <div style="flex:999 1 600px;min-width:0;display:flex;flex-direction:column;gap:18px">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:11px">
        ${tile('SHOP TAKE TODAY', DH(take), `${done.length} booking${done.length === 1 ? '' : 's'} · ${DH(cut)} commission`, '#9A9CA3', `${base}/reports`)}
        ${tile('OCCUPANCY', occ + '%', `${working.length} of ${roster.length} chair${roster.length === 1 ? '' : 's'} working`)}
        ${tile('WAITING', String(waiting), worst ? `longest ~${worst.wait_min} min` : 'nobody in line', worst && worst.wait_min >= 45 ? '#E8A100' : '#9A9CA3')}
        ${tile('NO-SHOWS', String(noShows.length), noShows.length ? noShows.slice(0, 2).map((b) => `${nameOf(b.barber_id)}’s ${hhmm(b.starts_at)}`).join(', ') : 'none today', noShows.length ? '#F87171' : '#9A9CA3')}
      </div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden;display:flex;flex-direction:column">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:15px 16px 12px"><span style="font-size:12.5px;font-weight:700">The chairs · right now</span><span style="font-size:10.5px;color:#6B6B72">Open a chair to see its week</span></div>
        <div style="${grid};padding:8px 16px;border-top:1px solid #1E1E22;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72"><span>BARBER</span><span>RIGHT NOW</span><span>LINE</span><span>TODAY</span><span></span></div>
        ${roster.map(chairRow).join('') || '<div style="padding:16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No barber has joined the shop yet.</div>'}
      </div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px 17px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px"><span style="font-size:12.5px;font-weight:700">Day view</span><span style="font-size:10.5px;color:#6B6B72">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: ZONE }))} · ${occ}% full</span></div>
        <div style="display:flex;gap:12px"><span style="width:80px;flex:none"></span><div class="num" style="flex:1;min-width:0;display:flex;font-size:10px;color:#6B6B72">${ticks.map((t) => `<span style="flex:1">${clock(t)}</span>`).join('')}</div></div>
        ${roster.map(lane).join('')}
        <div style="display:flex;flex-wrap:wrap;gap:16px;padding-left:92px;font-size:10px;color:#9A9CA3">
          <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:rgba(74,222,128,.9)"></span>In chair</span>
          <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:rgba(232,161,0,.5)"></span>Break</span>
          <span style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:3px;background:rgba(248,113,113,.28);border:1px dashed rgba(248,113,113,.7);box-sizing:border-box"></span>No-show</span>
        </div>
      </div>
    </div>
    <div style="flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:14px">${walkins}${settle}${needs}</div>
  </div></div>`;

  return {
    html,
    ready(root) {
      root.querySelector('[data-reopen]')?.addEventListener('click', async () => {
        const { toast, go } = await import('/app.js');
        try { await rpc('reopen_shop'); toast('The shop is open again'); go(location.pathname, { replace: true }); }
        catch (e) { toast(e.message, false); }
      });
    },
  };
}
