// /salons — SAL-*, on the reads the old console already had: admin_salons,
// admin_invites, admin_salon (0070), admin_approvals, admin_cap_impact (0080),
// admin_salon_money (0079). Every write goes through act(), so above your role
// it becomes an ask (SET-03): suspending asks the Head from Support and Field
// ops, a permanent refusal is the Head's alone.
//
// Not as drawn (no backend): picking where a suspended shop's customers are
// rebooked (SAL-07), "until when" (a suspension lasts until it is lifted), the
// go-live settings (SAL-36…38), bulk selection (SAL-12…20), and "send it back"
// as its own state — it is a task the owner sees in the app's To-do list.
import { esc, DH, num, first, initials, dayShort, hhmm, ago } from '/app.js';
import { pageHead, chips, btnP, btnS, plus, label9, csv } from '/s/ui.js';

const PILL = { live: ['LIVE', '#4ADE80'], pending: ['PENDING', '#E8A100'], suspended: ['SUSPENDED', '#F87171'], rejected: ['REFUSED', '#9A9CA3'], closed: ['CLOSED', '#9A9CA3'] };
const pill = (status) => { const [t, c] = PILL[status] || [String(status).toUpperCase(), '#9A9CA3']; return `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:4px 7px;white-space:nowrap">${t}</span>`; };
const crumbs = (...parts) => parts.map(([t, h], i) => (h ? `<a href="${h}" style="color:#9A9CA3;font-weight:600">${esc(t)}</a>` : `<span style="color:#fff;font-weight:700">${esc(t)}</span>`)).join('<span style="margin:0 7px;color:#3A3A40">›</span>');
const head = (left, right = '') => `<div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:14px;padding:0 24px;box-sizing:border-box;font-size:13px">${left}<span style="flex:1"></span>${right}</div>`;
const panel = (inner, extra = '') => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:9px;${extra}">${inner}</div>`;
const capSteps = (cap) => { const nice = (c) => Math.max(50000, Math.round(c / 50000) * 50000); const out = [cap]; for (const m of [1.4, 1.8]) { const v = nice(cap * m); if (!out.includes(v)) out.push(v); } return out; };
const dlgBtns = (cancelLabel, goLabel, goAttrs, danger) => `<div style="display:flex;gap:10px;justify-content:flex-end">${btnS(cancelLabel, 'data-dlg-close="1"')}<span ${goAttrs} class="btn-p" style="display:flex;align-items:center;height:34px;border-radius:9px;padding:0 16px;font-size:11.5px;font-weight:800;letter-spacing:.05em;cursor:pointer;background:${danger ? '#E8442E' : '#E8442E'}">${goLabel}</span></div>`;
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };

async function idOf(rest, slug) {
  const r = await rest(`salons?select=id,slug,name,status,short_code&slug=eq.${encodeURIComponent(slug)}`);
  if (!r[0]) throw new Error('not_found');
  return r[0];
}

export default async function (ctx) {
  const [a, b] = ctx.seg;
  if (!a) return list(ctx);
  if (a === 'new') return addSalon(ctx);
  if (a === 'pending') return pending(ctx, b);
  return shopPage(ctx, a);
}

// ---- SAL-11 / 14 / 16 / 29 · the list ------------------------------------------
async function list({ rpc, rest, q, go, toast, act }) {
  const state = ['live', 'pending', 'suspended'].includes(q.get('state')) ? q.get('state') : 'all';
  const [d, extra] = await Promise.all([rpc('admin_salons'), rest('salons?select=id,slug,district,float_cap_cents')]);
  const by = Object.fromEntries(extra.map((x) => [x.id, x]));
  const c = d.counts;
  const tabs = chips([['All', '/salons', state === 'all', c.all], ['Live', '/salons?state=live', state === 'live', c.live],
    ['Pending', '/salons?state=pending', state === 'pending', c.pending], ['Suspended', '/salons?state=suspended', state === 'suspended', c.suspended]],
  `<input id="sl-q" placeholder="Shop, owner or district" value="${esc(q.get('q') || '')}" style="height:30px;width:220px;border-radius:8px;background:#17171A;border:1px solid #26262B;padding:0 11px;color:#fff;font-size:11.5px;outline:none">
   <span style="font-size:11.5px;font-weight:600;color:#9A9CA3;padding:0 6px">Tangier</span>`);
  const title = pageHead('Salons', `${c.all} shops · ${c.live} live, ${c.pending} pending, ${c.suspended} suspended`,
    `${btnS('Export CSV', 'id="sl-csv"')}${btnP(plus + 'Add salon', 'data-go="/salons/new"')}`);

  if (state === 'pending') {
    // SAL-29: the pending table is who is waiting on whom — 0072's invites and applications
    const inv = await rpc('admin_invites');
    const rows = inv.rows.filter((r) => !r.claimed_at || r.missing?.length).filter((r) => by[r.id] && d.rows.find((x) => x.id === r.id)?.status === 'pending');
    const MISSING = { licence: 'licence', pin: 'pin', services: 'services' };
    const row = (r) => {
      const slug = by[r.id]?.slug;
      const ready = r.origin === 'applied' && !r.missing?.length;
      const act = ready ? ['review', 'REVIEW'] : !r.opened && r.invited_at && Date.now() - new Date(r.invited_at) > 20 * 864e5 ? ['drop', 'DROP IT'] : ['resend', 'COPY THE INVITE'];
      return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-top:1px solid #1E1E22">
        <span style="width:30px;height:30px;border-radius:9px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(r.name))}</span>
        <a href="/salons/pending/${esc(slug)}" style="width:220px;flex:none;min-width:0;text-decoration:none;color:#fff"><span style="display:block;font-size:12.5px;font-weight:700">${esc(r.name)}</span><span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:1px">${esc(r.district || '—')} · ${esc(r.owner || '—')}</span></a>
        <span style="width:130px;flex:none;font-size:11.5px;color:#9A9CA3">${r.origin === 'applied' ? 'They applied' : 'Ops added it'}</span>
        <span style="flex:1;min-width:0;font-size:11.5px;color:${ready ? '#4ADE80' : '#D8D8DC'}">${ready ? 'Nothing · ready for you' : `Waiting on them · ${esc((r.missing || []).map((m) => MISSING[m] || m).join(', ') || 'opening the link')}`}</span>
        <span class="num" style="width:60px;flex:none;font-size:11px;color:#6B6B72">${esc(ago(r.since))}</span>
        <span data-inv="${act[0]}:${r.id}:${esc(slug)}" style="cursor:pointer;flex:none;font-size:10px;font-weight:800;letter-spacing:.06em;background:#212125;border-radius:7px;padding:7px 10px">${act[1]}</span></div>`;
    };
    return {
      top: false,
      html: `<div style="height:100%;display:flex;flex-direction:column">${title}${tabs}<div style="flex:1;overflow:auto;padding:18px 24px">
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">${rows.map(row).join('').replace('border-top:1px solid #1E1E22', '') || '<div style="padding:22px;font-size:12px;color:#6B6B72">Nobody is waiting on us.</div>'}</div></div></div>`,
      ready(root) {
        root.onclick = async (e) => {
          const t = e.target.closest('[data-inv]');
          if (!t) return;
          const [act, id, slug] = t.dataset.inv.split(':');
          if (act === 'review') return go(`/salons/pending/${slug}`);
          if (act === 'drop' && !confirm('Drop this invite? Nothing was ever shown to customers.')) return;
          try {
            const r = await act('admin_invite_action', { p_salon: id, p_action: act }, { title: `${act === 'drop' ? 'Drop' : 'Resend'} an invite` });
            // there is no SMS rail: ops sends the exact words themselves
            if (act === 'resend' && r?.sms) await navigator.clipboard?.writeText(r.sms).catch(() => {});
            toast(act === 'drop' ? 'Dropped' : 'Invite copied — send it to them');
            go(location.pathname + location.search, { replace: true });
          } catch (err) { if (!err.handled) toast(err.message, false); }
        };
        wireSearch(root);
      },
    };
  }

  // needing a person first: suspended, pending, then the fullest floats
  const fill = (s) => { const cap = by[s.id]?.float_cap_cents; return cap ? s.float_cents / cap : 0; };
  const rank = (s) => (s.status === 'suspended' ? 0 : s.status === 'pending' ? 1 : 2);
  const rows = d.rows.filter((s) => state === 'all' || s.status === state).sort((x, y) => rank(x) - rank(y) || fill(y) - fill(x) || y.bookings - x.bookings);
  const G = 'display:grid;grid-template-columns:2.2fr 1fr .7fr .9fr 1.2fr .8fr;gap:12px;align-items:center';
  const hd = (t, r) => `<span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72${r ? ';text-align:right' : ''}">${t}</span>`;
  const row = (s) => {
    const x = by[s.id] || {}, cap = x.float_cap_cents;
    const href = s.status === 'pending' ? `/salons/pending/${x.slug}` : `/salons/${x.slug}`;
    const over = cap && s.float_cents > cap * 0.9;
    return `<a href="${href}" data-row="${esc([s.name, s.owner, x.district, s.address].join(' ').toLowerCase())}" class="hov" style="${G};padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff">
      <span style="display:flex;align-items:center;gap:10px;min-width:0"><span style="width:32px;height:32px;border-radius:9px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(s.name))}</span>
        <span style="min-width:0"><span style="display:block;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.district || s.address || '—')} · ${esc(s.owner || '—')}</span></span></span>
      <span>${pill(s.status)}</span>
      <span class="num" style="font-size:12px;text-align:right">${s.status === 'pending' ? '—' : num(s.chairs)}</span>
      <span class="num" style="font-size:12px;text-align:right">${s.status === 'pending' ? '—' : num(s.bookings)}</span>
      <span class="num" style="font-size:12px;text-align:right;${over ? 'color:#E8A100;font-weight:700' : ''}">${s.status === 'pending' ? '—' : `${num(Math.round(s.float_cents / 100))} / ${cap ? num(Math.round(cap / 100)) : '—'}`}</span>
      <span class="num" style="font-size:12px;text-align:right${s.rating && s.rating < 4 ? ';color:#F87171' : ''}">${s.rating ? s.rating : '—'}</span></a>`;
  };
  return {
    top: false,
    html: `<div style="height:100%;display:flex;flex-direction:column">${title}${tabs}<div style="flex:1;overflow:auto;padding:18px 24px">
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
        <div style="${G};padding:11px 16px">${hd('SHOP')}${hd('STATE')}${hd('CHAIRS', 1)}${hd('BOOKINGS', 1)}${hd('FLOAT / CAP', 1)}${hd('RATING', 1)}</div>
        <div id="sl-rows">${rows.map(row).join('') || '<div style="padding:22px;font-size:12px;color:#6B6B72;border-top:1px solid #1E1E22">No shop here.</div>'}</div>
        <div id="sl-none" style="display:none;padding:22px;font-size:12px;color:#6B6B72;border-top:1px solid #1E1E22">Nothing matches that.</div>
      </div>
      <span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:10px">Sorted so anything needing a person is at the top.</span></div></div>`,
    ready(root) {
      wireSearch(root);
      root.querySelector('#sl-csv').onclick = () => {
        csv('salons', [['name', (s) => s.name], ['slug', (s) => by[s.id]?.slug], ['district', (s) => by[s.id]?.district], ['owner', (s) => s.owner], ['status', (s) => s.status],
          ['chairs', (s) => s.chairs], ['bookings', (s) => s.bookings], ['float_dh', (s) => s.float_cents / 100], ['cap_dh', (s) => (by[s.id]?.float_cap_cents ?? 0) / 100], ['rating', (s) => s.rating]], rows);
        toast('Downloaded');
      };
    },
  };
}
function wireSearch(root) {
  const inp = root.querySelector('#sl-q');
  const run = () => {
    const v = inp.value.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll('[data-row]').forEach((r) => { const ok = !v || r.dataset.row.includes(v); r.style.display = ok ? '' : 'none'; if (ok) shown++; });
    const none = root.querySelector('#sl-none'); if (none) none.style.display = shown || !v ? 'none' : 'block';
    const u = new URL(location.href); if (v) u.searchParams.set('q', v); else u.searchParams.delete('q'); history.replaceState(null, '', u.pathname + u.search);
  };
  inp.oninput = run;
  if (inp.value) run();
}

// ---- SAL-10 / SAL-09 · one shop -------------------------------------------------
async function shopPage({ rpc, rest, act, q, go, toast, dialog, closeDialog, me }, slug) {
  const row = await idOf(rest, slug);
  if (row.status === 'pending') return go(`/salons/pending/${slug}`, { replace: true });
  const [d, money] = await Promise.all([rpc('admin_salon', { p_salon: row.id }), rpc('admin_salon_money', { p_salon: row.id }).catch(() => null)]);
  const base = `/salons/${slug}`;
  const live = d.status === 'live', susp = d.status === 'suspended';
  const p = d.suspend_preview || { bookings: 0, deposits_n: 0, deposits_cents: 0, customers: 0 };
  const capNet = d.float_cents - (d.owed_cents || 0);
  const kpi = (l, v, s, tone) => `<div style="flex:1;min-width:0;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:13px 15px;display:flex;flex-direction:column;gap:4px">
    <span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:21px;font-weight:700;${tone ? `color:${tone}` : ''}">${v}</span><span style="font-size:10.5px;color:#6B6B72">${s}</span></div>`;
  const ord = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');
  const team = (d.team || []).map((b) => `<a href="/barbers/${b.id}" class="hov" style="display:flex;align-items:center;gap:11px;padding:11px 8px;margin:0 -8px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;border-radius:6px">
    <span style="width:30px;height:30px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(b.name))}</span>
    <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:700">${esc(b.name)}</span><span style="display:block;font-size:10.5px;color:${b.flagged ? '#E8A100' : '#6B6B72'};margin-top:1px">${b.owner ? 'Owner · ' : ''}${esc(b.why || '')}</span></span>
    <span class="num" style="width:44px;flex:none;font-size:12px;font-weight:700;text-align:right">${b.rating == null ? '—' : b.rating}</span>
    <span class="num" style="width:80px;flex:none;font-size:10.5px;color:#6B6B72;text-align:right">${num(b.week_bookings)} this week</span></a>`).join('') || '<span style="font-size:11.5px;color:#6B6B72">Nobody on the team yet.</span>';
  const f = d.last_settlement;
  const worth = d.since_settled_cents > 0;

  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${head(crumbs(['Salons', '/salons'], [d.name]) + `<span style="font-size:12px;color:#6B6B72">${susp ? `Suspended${d.hidden_since ? ` since ${esc(dayShort(d.hidden_since))}, ${hhmm(d.hidden_since)}` : ''}` : live ? 'Live · in Explore' : esc(d.status)}</span>`,
      row.short_code ? `<a href="https://sterncut.ma/q/${esc(row.short_code)}" target="_blank" rel="noopener" style="font-size:12px;font-weight:700">Open the shop’s queue page</a>` : '')}
    <div style="flex:1;overflow:auto"><div style="padding:20px 24px 32px;display:flex;flex-direction:column;gap:16px;max-width:1180px">
      <div style="display:flex;align-items:center;gap:14px">
        <span style="width:48px;height:48px;border-radius:13px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex:none">${esc(initials(d.name))}</span>
        <span style="flex:1;min-width:0"><span style="display:flex;align-items:center;gap:10px"><span style="font-size:19px;font-weight:800">${esc(d.name)}</span>${pill(d.status)}</span>
          <span style="display:block;font-size:11.5px;color:#9A9CA3;margin-top:4px">${esc(d.address || '—')} · owner ${esc(d.owner?.name || '—')}${d.live_since ? ` · live since ${esc(dayShort(d.live_since))}` : ''}</span></span>
      </div>
      <div style="display:flex;gap:11px;flex-wrap:wrap">
        ${kpi('RATING', d.rating == null ? '—' : d.rating, `· ${num(d.reviews_n)} reviews`)}
        ${kpi('BARBERS', num(d.barbers_n), `${d.flagged_n} flagged`, d.flagged_n ? '#E8A100' : null)}
        ${kpi('BOOKINGS 30D', num(d.bookings_30d), DH(d.revenue_30d_cents))}
        ${kpi('FLOAT / CAP', num(Math.round(d.float_cents / 100)), `/ ${DH(d.cap_cents)}${money?.days_since != null ? ` · held ${money.days_since} days` : ''}`, d.gap_cents ? '#F87171' : capNet > d.cap_cents * 0.9 ? '#E8A100' : null)}
        ${kpi('UNMET ASKS', num(d.unmet_asks), d.unmet_asks && d.asks_rank ? `${ord(d.asks_rank)} worst in the city` : 'none in 30 days')}
      </div>
      ${d.task ? `<div style="display:flex;align-items:center;gap:12px;background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.28);border-radius:12px;padding:12px 14px">
        <span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:700">${d.licence_overdue_days ? `Licence ${d.licence_overdue_days} days overdue` : esc(d.task.title)}</span><span style="display:block;font-size:11px;color:#9A9CA3;margin-top:2px">${esc(d.task.ref)} · ${esc(d.task.because || d.task.title)}${d.task.due_at ? ` · due ${esc(dayShort(d.task.due_at))}` : ''}</span></span>
        <a href="/compliance" style="font-size:10px;font-weight:800;letter-spacing:.06em;color:#0D0D0F;background:#E8A100;border-radius:7px;padding:7px 11px;flex:none">OPEN THE TASK</a></div>` : ''}
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:2 1 460px;min-width:0">${panel(`${label9('THE TEAM')}${team}`)}</div>
        <div style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:12px">
          ${label9('WHAT YOU CAN DO')}
          ${panel(`<span style="font-size:10px;letter-spacing:.1em;font-weight:800;color:#6B6B72">SETTLE THE FLOAT</span>
            <span style="font-size:11px;color:#9A9CA3;line-height:1.5">${f ? `Last collection ${DH(f.amount_cents)} on ${esc(dayShort(f.at))} at ${hhmm(f.at)} by ${f.mine ? 'you' : esc(f.by)}.` : 'Nothing has ever been collected here.'} ${DH(d.since_settled_cents)} has come in since.</span>
            ${money ? `<div style="display:flex;gap:12px;border-top:1px solid #26262B;padding-top:9px">${[['DEPOSITS EARNED', DH(money.earned_cents), '#4ADE80'], ['STILL HELD', DH(money.held_cents), '#E8A100'], ['SINCE SETTLED', money.days_since == null ? 'never' : money.days_since + 'd', '#fff']].map(([l, v, c]) => `<span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:13.5px;font-weight:700;color:${c}">${v}</span></span>`).join('')}</div>` : ''}
            <span ${worth ? 'data-settle="1"' : ''} style="display:flex;align-items:center;justify-content:center;height:36px;border-radius:10px;background:${worth ? '#212125' : '#141416'};font-size:11px;font-weight:800;letter-spacing:.05em;color:${worth ? '#fff' : '#6B6B72'};cursor:${worth ? 'pointer' : 'default'}">${worth ? `SETTLE ${DH(d.since_settled_cents)}` : 'NOTHING WORTH SETTLING'}</span>`)}
          ${panel(`<span style="font-size:10px;letter-spacing:.1em;font-weight:800;color:#6B6B72">FLOAT CAP</span>
            <div style="display:flex;align-items:baseline;gap:9px"><span class="num" style="font-size:21px;font-weight:700">${DH(d.cap_cents)}</span><span class="num" style="font-size:10.5px;color:#6B6B72">net ${DH(capNet)}${d.cap_cents ? ` · ${Math.round(capNet * 100 / d.cap_cents)}%` : ''}</span></div>
            <div style="display:flex;gap:7px">${capSteps(d.cap_cents).map((c) => `<a href="${base}?cap=${c}" style="flex:1;text-align:center;height:32px;line-height:32px;border-radius:9px;font-size:11.5px;font-weight:700;text-decoration:none;${d.cap_cents === c ? 'background:#E8442E;color:#fff' : 'background:#212125;color:#9A9CA3'}">${num(Math.round(c / 100))}</a>`).join('')}</div>
            <span style="font-size:10.5px;color:#9A9CA3;line-height:1.45">Top-ups are refused above the cap. Lowering it below ${DH(d.float_cents)} would stop them tonight.</span>`)}
          ${susp ? panel(`<span style="font-size:10px;letter-spacing:.1em;font-weight:800;color:#F87171">HOW IT ENDS</span>
              <span style="font-size:11.5px;color:#9A9CA3;line-height:1.5">${d.task ? `Waiting on ${esc(d.task.title.toLowerCase())}.` : 'Lifting it puts the shop back in Explore.'} Lift it early only if the suspension was wrong.</span>
              <a href="${base}?lift=1" style="display:flex;align-items:center;justify-content:center;height:36px;border-radius:10px;background:#212125;font-size:11px;font-weight:800;letter-spacing:.05em;color:#fff">LIFT THE SUSPENSION</a>`, 'border-color:rgba(248,113,113,.3)')
            : panel(`<span style="font-size:10px;letter-spacing:.1em;font-weight:800;color:#E8442E">SUSPEND</span>
              <span style="font-size:11.5px;color:#9A9CA3;line-height:1.5">Suspending cancels what is left and refunds it: ${num(p.bookings)} booking${p.bookings === 1 ? '' : 's'}, ${DH(p.deposits_cents)} back to ${num(p.customers)} customer${p.customers === 1 ? '' : 's'}.${d.task ? '' : ' Nothing open on this shop warrants it.'}</span>
              <a href="${base}?suspend=1" style="display:flex;align-items:center;justify-content:center;height:36px;border-radius:10px;background:${d.task ? '#E8442E' : '#212125'};font-size:11px;font-weight:800;letter-spacing:.05em;color:#fff">SUSPEND THE SHOP</a>`)}
          <a href="${base}?message=1" class="btn-s" style="display:flex;align-items:center;justify-content:center;height:38px;border-radius:10px;background:#17171A;border:1px solid #26262B;font-size:11.5px;font-weight:700;color:#fff">MESSAGE ${esc(first(d.owner?.name || 'the owner').toUpperCase())}</a>
          <span style="font-size:10.5px;color:#6B6B72;text-align:center">Every action here is logged against your name.</span>
        </div>
      </div>
    </div></div></div>`;

  const back = () => go(base);
  const reload = () => go(base, { replace: true });
  return {
    top: false, html,
    async ready(root) {
      root.querySelector('[data-settle]')?.addEventListener('click', async () => {
        if (!confirm(`Settle ${DH(d.since_settled_cents)} from ${d.name}?`)) return;
        try { await act('admin_settle_float', { p_salon: d.id, p_amount_cents: d.since_settled_cents, p_note: 'Collected from the salon page' }, { title: `Settle ${DH(d.since_settled_cents)} from ${d.name}` }); toast(`Settled ${DH(d.since_settled_cents)}`); reload(); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      });

      // SAL-07 — suspend: what it costs tonight, and why, before it fires
      if (q.get('suspend') && live) {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Suspend ${esc(d.name)}</span>
          <span style="font-size:12px;color:#9A9CA3">${num(d.barbers_n)} barber${d.barbers_n === 1 ? '' : 's'}, ${num(p.bookings)} booking${p.bookings === 1 ? '' : 's'} and a float — all of it stops.</span>
          <div style="display:flex;flex-direction:column;gap:7px">${label9('WHY')}<textarea id="su-why" rows="3" placeholder="What the shop did — kept on the record" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;line-height:1.5;outline:none;resize:vertical">${esc(d.task ? d.task.title : '')}</textarea></div>
          <div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:4px 13px">${label9('WHAT IT COSTS TONIGHT')}
            ${[['Bookings cancelled', num(p.bookings)], ['Deposits refunded', `${p.deposits_n} · ${DH(p.deposits_cents)}`], ['Customers told', num(p.customers)], ['Float left with them', DH(d.float_cents)]].map(([k, v]) => `<div style="display:flex;padding:8px 0;border-top:1px solid #1E1E22"><span style="flex:1;font-size:12px;color:#9A9CA3">${k}</span><span class="num" style="font-size:12.5px;font-weight:700">${v}</span></div>`).join('')}</div>
          <span style="font-size:11px;color:#6B6B72">It lasts until someone lifts it from this page. Logged as ${esc(me.name)}.</span>
          ${errBox}${dlgBtns('CANCEL', `SUSPEND · CANCEL ${num(p.bookings)} BOOKING${p.bookings === 1 ? '' : 'S'}`, 'id="su-go"')}</div>`, { onClose: back, width: 520 });
        dl.querySelector('#su-go').onclick = async () => {
          const note = dl.querySelector('#su-why').value.trim();
          if (!note) return showErr(dl, new Error('Say why — it stays on the shop’s record.'));
          try { await act('admin_salon_decide', { p_salon: d.id, p_action: 'suspend', p_note: note }, { title: `Suspend ${d.name}`, place: 'Salons', reason: note }); closeDialog(); toast('Suspended · customers told'); }
          catch (e) { showErr(dl, e); }
        };
      }
      // SAL-23/24 — lifting it
      if (q.get('lift') && susp) {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Lift the suspension on ${esc(d.name)}</span>
          <span style="font-size:12px;line-height:1.55;color:#9A9CA3">It goes back in Explore and takes bookings again${d.task ? `, while ${esc(d.task.ref)} is still open` : ''}. Only if the suspension was wrong.</span>
          <textarea id="li-why" rows="2" placeholder="Why now (kept on the record)" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
          ${errBox}${dlgBtns('KEEP IT SUSPENDED', 'LIFT IT', 'id="li-go"')}</div>`, { onClose: back, width: 480 });
        dl.querySelector('#li-go').onclick = async () => {
          try { await act('admin_salon_decide', { p_salon: d.id, p_action: 'restore', p_note: dl.querySelector('#li-why').value.trim() || null }, { title: `Lift the suspension on ${d.name}`, place: 'Salons' }); closeDialog(); toast('Back in Explore'); }
          catch (e) { showErr(dl, e); }
        };
      }
      // SAL-08 — a message is a task the shop sees in its To-do list (turn 9's rail)
      if (q.get('message')) {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Message ${esc(d.owner?.name || 'the owner')}</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">It lands in the shop’s To-do list in the app. Ops has no chat with a shop.</span>
          <textarea id="ms-text" rows="4" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;line-height:1.5;outline:none;resize:vertical"></textarea>
          ${errBox}${dlgBtns('CANCEL', 'SEND', 'id="ms-go"')}</div>`, { onClose: back, width: 480 });
        dl.querySelector('#ms-text').focus();
        dl.querySelector('#ms-go').onclick = async () => {
          const body = dl.querySelector('#ms-text').value.trim();
          if (!body) return showErr(dl, new Error('Write the message first.'));
          try { await act('admin_issue_task', { p_salon: d.id, p_kind: 'other', p_title: body, p_action: 'none' }, { title: `Message ${d.name}` }); closeDialog(); toast('Sent to the shop'); }
          catch (e) { showErr(dl, e); }
        };
      }
      // SAL-21 — the cap: the projection and the trade before the change
      if (q.get('cap')) capDialog({ rpc, act, dialog, closeDialog, toast, go, me }, d, Number(q.get('cap')), base);
    },
  };
}

async function capDialog({ rpc, act, dialog, closeDialog, toast, go, me }, d, cents, base) {
  const imp = await rpc('admin_cap_impact', { p_salon: d.id, p_cents: cents });
  const up = imp.raising, same = cents === imp.cap_cents;
  const gate = imp.settle_first && up;
  const ta = imp.turned_away, ot = imp.ontime;
  const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
    <span style="font-size:17px;font-weight:800">${same ? `Leave ${esc(d.name)} at ${DH(imp.cap_cents)}` : `${up ? 'Raise' : 'Lower'} ${esc(d.name)} to ${DH(cents)}`}</span>
    <span class="num" style="font-size:12px;color:#9A9CA3">${num(d.bookings_30d)} bookings in 30 days · currently ${DH(imp.cap_cents)}</span>
    <div style="display:flex;gap:7px">${capSteps(imp.cap_cents).map((c) => `<a href="${base}?cap=${c}" style="flex:1;text-align:center;height:40px;line-height:40px;border-radius:11px;font-size:13.5px;font-weight:800;text-decoration:none;${cents === c ? 'background:#E8442E;color:#fff' : 'background:#212125;color:#9A9CA3'}">${num(Math.round(c / 100))}</a>`).join('')}</div>
    ${same ? '' : `<div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:14px">
      <div style="display:flex;align-items:baseline;gap:8px"><span class="num" style="font-size:26px;font-weight:800;color:#4ADE80">${imp.pct_new == null ? '—' : imp.pct_new + '%'}</span><span class="num" style="font-size:11px;color:#6B6B72">was ${imp.pct_now == null ? '—' : imp.pct_now + '%'}</span></div>
      <div style="font-size:11.5px;color:#9A9CA3;line-height:1.5;margin-top:8px">At ${DH(cents)} their current ${DH(imp.net_cents)} sits at ${imp.pct_new == null ? '—' : imp.pct_new + '%'}. ${up ? 'They stop turning away top-ups on a busy Saturday.' : 'Less of our cash sits in their till.'}</div></div>`}
    <div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:4px 14px">${[
      ['Top-ups the cap turned away · 30 days', ta.n ? `${num(ta.n)} · ${DH(ta.cents)}` : 'none logged', '#fff'],
      ['Our cash exposed at this shop', `${imp.exposure_delta_cents >= 0 ? '+' : '−'}${DH(Math.abs(imp.exposure_delta_cents))}`, up ? '#E8A100' : '#4ADE80'],
      [`Collected on time, last ${ot.n}`, ot.n ? `${ot.on_time} of ${ot.n}` : 'never collected', ot.n && ot.on_time === ot.n ? '#4ADE80' : '#E8A100'],
    ].map(([k, v, c], i) => `<div style="display:flex;padding:9px 0;${i ? 'border-top:1px solid #1E1E22' : ''}"><span style="flex:1;font-size:11.5px;color:#9A9CA3">${k}</span><span class="num" style="font-size:12.5px;font-weight:700;color:${c}">${v}</span></div>`).join('')}</div>
    ${gate ? `<div style="background:rgba(232,161,0,.09);border:1px solid rgba(232,161,0,.28);border-radius:11px;padding:12px 14px"><span style="display:block;font-size:12px;font-weight:700;color:#E8A100">Settle the ${DH(imp.net_cents)} first</span><span style="display:block;font-size:11.5px;color:#9A9CA3;line-height:1.5;margin-top:4px">Raising the cap while a ${imp.days_since == null ? 'never-collected' : imp.days_since + '-day'} float is sitting there rewards the delay. Collect, then raise it.</span></div>` : ''}
    ${same ? '' : `<div style="display:flex;flex-direction:column;gap:7px">${label9(up ? 'REASON · REQUIRED' : 'REASON · OPTIONAL', up ? '#E8A100' : '#9A9CA3')}<input id="cp-why" style="height:40px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:12.5px;outline:none"></div>`}
    <span style="font-size:10.5px;color:#6B6B72">Logged as ${esc(me.name)} · ${esc(d.owner?.name || 'the owner')} is told the new limit.</span>
    ${errBox}
    <div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Close', 'data-dlg-close="1"')}
      ${gate ? `<span id="cp-settle" class="btn-p" style="display:flex;align-items:center;height:34px;border-radius:9px;padding:0 14px;font-size:11.5px;font-weight:800;background:#E8442E;cursor:pointer">SETTLE ${DH(imp.net_cents)} FIRST</span>` : ''}
      ${same ? '' : `<span id="cp-go" style="display:flex;align-items:center;height:34px;border-radius:9px;padding:0 14px;font-size:11.5px;font-weight:800;cursor:pointer;background:${gate ? '#212125' : '#E8442E'};color:${gate ? '#9A9CA3' : '#fff'}">${up ? 'RAISE IT NOW' : 'LOWER THE CAP'}</span>`}</div></div>`,
  { onClose: () => go(base), width: 520 });
  dl.querySelector('#cp-settle')?.addEventListener('click', async () => {
    try { await act('admin_settle_float', { p_salon: d.id, p_amount_cents: imp.net_cents, p_note: 'Collected before a cap change' }, { title: `Settle ${DH(imp.net_cents)} from ${d.name}` }); closeDialog(); toast(`Collected ${DH(imp.net_cents)}`); }
    catch (e) { showErr(dl, e); }
  });
  dl.querySelector('#cp-go')?.addEventListener('click', async () => {
    const why = dl.querySelector('#cp-why').value.trim();
    // 0080 refuses a raise without a reason in SQL too; this only says so first
    if (up && !why) return showErr(dl, new Error('Raising a cap needs a reason.'));
    try { await act('admin_set_float_cap', { p_salon: d.id, p_cents: cents, p_reason: why || null, p_notify: true }, { title: `${up ? 'Raise' : 'Lower'} ${d.name}’s cap to ${DH(cents)}` }); closeDialog(); toast(`Cap is now ${DH(cents)} · the owner was told`); }
    catch (e) { showErr(dl, e); }
  });
}

// ---- SAL-02 / 26 / 28 / 35 · a shop waiting on a decision ---------------------------
async function pending({ rpc, rest, act, q, go, toast, dialog, closeDialog, me }, slug) {
  let row = null;
  if (slug) row = await idOf(rest, slug);
  const d = await rpc('admin_approvals', row ? { p_salon: row.id } : {});
  const s = d.detail;
  const slugs = Object.fromEntries((await rest('salons?select=id,slug&status=eq.pending')).map((x) => [x.id, x.slug]));
  if (!slug && s) return go(`/salons/pending/${slugs[s.id]}`, { replace: true });
  const base = slug ? `/salons/pending/${slug}` : '/salons/pending';
  const queue = d.queue.map((x) => {
    const on = s && x.id === s.id;
    return `<a href="/salons/pending/${esc(slugs[x.id])}" style="display:block;padding:13px 16px;border-bottom:1px solid #1E1E22;text-decoration:none;color:#fff;${on ? 'background:#17171A;border-left:3px solid #E8A100' : ''}">
      <div style="display:flex;gap:8px"><span style="font-size:10px;font-family:ui-monospace,Menlo,monospace;font-weight:700;color:${on ? '#E8A100' : '#6B6B72'}">${esc(x.ref)}</span><span style="flex:1"></span><span style="font-size:10px;color:#6B6B72">${esc(ago(x.submitted_at))}</span></div>
      <div style="font-size:12px;font-weight:${on ? 700 : 600};margin-top:5px">${esc(x.name)}</div><div style="font-size:11px;color:#9A9CA3;margin-top:3px">${esc(x.owner || '—')}</div>
      <div style="display:flex;align-items:center;gap:7px;margin-top:8px"><span style="flex:1;height:4px;border-radius:2px;background:#26262B;overflow:hidden"><span style="display:block;height:100%;width:${x.done * 20}%;background:${on ? '#E8A100' : '#6B6B72'}"></span></span><span style="font-size:10px;font-weight:700;color:${on ? '#E8A100' : '#6B6B72'}">${x.done}/5</span></div></a>`;
  }).join('') || '<div style="padding:16px;font-size:12px;color:#6B6B72">The queue is clear.</div>';
  const side = `<div style="width:250px;flex:none;border-right:1px solid #1E1E22;display:flex;flex-direction:column;overflow:auto">
    <div style="padding:14px 16px;border-bottom:1px solid #1E1E22">${label9('APPLICATION QUEUE · OLDEST FIRST')}</div>${queue}
    <div style="margin-top:auto;padding:16px;display:flex;flex-direction:column;gap:8px">${label9('LAST 30 DAYS')}
      ${[['Approved', num(d.last30.approved), '#4ADE80'], ['Rejected', num(d.last30.rejected), '#fff'], ['Median decision', d.last30.median_days == null ? '—' : d.last30.median_days + ' days', '#fff']].map(([k, v, c]) => `<span style="display:flex;justify-content:space-between;font-size:11px"><span style="color:#9A9CA3">${k}</span><span class="num" style="font-weight:700;color:${c}">${v}</span></span>`).join('')}</div></div>`;
  if (!s) return { top: false, html: `<div style="height:100%;display:flex;flex-direction:column">${head(crumbs(['Salons', '/salons'], ['Pending']))}<div style="flex:1;display:flex;min-height:0">${side}<div style="padding:30px;font-size:13px;color:#6B6B72">No application is waiting on us.</div></div></div>` };

  const pinOk = s.checklist.find((c) => c.key === 'pin')?.ok;
  const done = s.checklist.filter((c) => c.ok).length;
  const clk = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const detailOf = {
    identity: () => (s.owner.id_document ? `ID on file · barber ${s.owner.barber_status}` : 'No ID document uploaded'),
    phone: () => s.owner.phone || 'No phone on the account',
    services: () => (s.services.length ? `${s.services.length} services · ${Math.round(s.services[0].price_cents / 100)}–${Math.round(s.services[s.services.length - 1].price_cents / 100)} DH` : 'No services yet'),
    hours: () => (s.hours.days ? `${s.hours.days} days declared · ${clk(s.hours.from)}–${clk(s.hours.to)}` : 'No opening hours'),
    pin: () => (pinOk ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : 'Nothing to place on the map — the owner confirms the pin in the app'),
  };
  const check = (c) => (c.ok
    ? `<div style="display:flex;align-items:center;gap:12px;background:#17171A;border-radius:12px;padding:12px 14px"><span style="width:24px;height:24px;border-radius:999px;background:rgba(74,222,128,.16);color:#4ADE80;display:flex;align-items:center;justify-content:center;font-size:12px;flex:none">✓</span><span style="flex:1;min-width:0"><span style="display:block;font-size:12px;font-weight:700">${esc(c.label)}</span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">${esc(detailOf[c.key]?.() || '')}</span></span></div>`
    : `<div style="display:flex;align-items:center;gap:12px;background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.3);border-radius:12px;padding:12px 14px"><span style="width:24px;height:24px;border-radius:999px;background:rgba(232,161,0,.2);color:#E8A100;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex:none">!</span><span style="flex:1;min-width:0"><span style="display:block;font-size:12px;font-weight:700;color:#E8A100">${esc(c.label)} — missing</span><span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px">${esc(detailOf[c.key]?.() || '')}</span></span></div>`);
  const yn = (bad) => `<span style="font-weight:700;color:${bad ? '#F87171' : '#4ADE80'}">${bad ? 'Yes' : 'No'}</span>`;
  const main = `<div style="flex:1;min-width:0;overflow:auto;padding:20px 24px 32px;display:flex;flex-direction:column;gap:16px">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
      <span style="width:44px;height:44px;border-radius:12px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(s.name))}</span>
      <span style="flex:1;min-width:220px"><span style="display:flex;align-items:center;gap:9px"><span style="font-size:16px;font-weight:800">${esc(s.name)}</span>${pill('pending')}</span>
        <span style="display:block;font-size:11px;color:#9A9CA3;margin-top:4px">Applied ${esc(dayShort(s.submitted_at))} · ${esc(s.address || 'no address')} · ${s.chairs} chair${s.chairs === 1 ? '' : 's'} · owner ${esc(s.owner.name)}</span></span>
      <a href="${base}?changes=1" class="btn-s" style="height:32px;border-radius:9px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;padding:0 12px;font-size:11px;font-weight:700;color:#fff">REQUEST CHANGES</a>
      <a href="${base}?reject=1" style="height:32px;border-radius:9px;border:1px solid rgba(248,113,113,.4);display:flex;align-items:center;padding:0 12px;font-size:11px;font-weight:700;color:#F87171">REFUSE</a>
      <a ${pinOk ? `href="${base}?approve=1"` : 'title="The owner confirms the map pin in the app first"'} style="height:32px;border-radius:9px;background:${pinOk ? '#4ADE80' : '#3A3A40'};display:flex;align-items:center;padding:0 14px;font-size:11px;font-weight:800;color:${pinOk ? '#0D0D0F' : '#9A9CA3'};cursor:${pinOk ? 'pointer' : 'not-allowed'}">APPROVE &amp; GO LIVE</a>
    </div>
    <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:2 1 420px;min-width:0;display:flex;flex-direction:column;gap:10px">
        <div style="display:flex;align-items:center;gap:10px">${label9(`CHECKLIST · ${done} OF 5`)}<span style="flex:1;height:4px;border-radius:2px;background:#26262B;overflow:hidden"><span style="display:block;height:100%;width:${done * 20}%;background:#E8A100"></span></span></div>
        ${s.checklist.map(check).join('')}
        ${label9(`SERVICES · ${s.services.length} SUBMITTED`)}
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">${s.services.map((v) => `<span style="border-radius:12px;background:#17171A;padding:12px;display:flex;flex-direction:column;gap:4px;text-align:center"><span style="font-size:11.5px;font-weight:700">${esc(v.name)}</span><span class="num" style="font-size:11.5px;color:#E8442E;font-weight:700">${DH(v.price_cents)}</span></span>`).join('') || '<span style="font-size:11.5px;color:#6B6B72">No services on the application.</span>'}</div>
      </div>
      <div style="flex:1 1 260px;min-width:0">${panel(`${label9('RISK & DUPLICATES')}
        <span style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#9A9CA3">Phone seen before</span>${yn(s.risk.phone_seen)}</span>
        <span style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#9A9CA3">Address seen before</span>${yn(s.risk.address_seen)}</span>
        <span style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#9A9CA3">Owner refused before</span>${yn(s.risk.owner_banned)}</span>
        <span style="height:1px;background:#26262B"></span>
        <span style="display:flex;justify-content:space-between;font-size:12px;font-weight:700"><span>Nearest shop</span><span class="num">${s.risk.nearest_km == null ? '—' : s.risk.nearest_km + ' km'}</span></span>
        <span style="font-size:10.5px;color:#6B6B72;line-height:1.5">${s.owner.cuts ? `${esc(s.owner.name)} already cuts on Sterncut — ${s.owner.rating || '—'} ★ over ${s.owner.cuts} cuts.` : 'New to us — no cutting history yet.'}</span>`)}</div>
    </div></div>`;

  const html = `<div style="height:100%;display:flex;flex-direction:column">${head(crumbs(['Salons', '/salons'], ['Pending', '/salons?state=pending'], [s.name]) + `<span style="font-size:12px;color:#6B6B72">${d.queue.findIndex((x) => x.id === s.id) + 1} of ${d.queue.length} pending</span>`)}
    <div style="flex:1;display:flex;min-height:0">${side}${main}</div></div>`;

  const back = () => go(base);
  return {
    top: false, html,
    ready() {
      // SAL-26 — approving
      if (q.get('approve') && pinOk) {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Approve ${esc(s.name)}</span>
          <span style="font-size:12px;line-height:1.55;color:#9A9CA3">It goes live: in Explore and on the map, bookable at the times its barbers set. ${esc(first(s.owner.name))} gets owner access and can add barbers.</span>
          <div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:4px 13px">${s.checklist.map((c) => `<div style="display:flex;padding:8px 0;border-top:1px solid #1E1E22"><span style="flex:1;font-size:12px;color:#9A9CA3">${esc(c.label)}</span><span style="font-size:12px;font-weight:700;color:${c.ok ? '#4ADE80' : '#E8A100'}">${c.ok ? 'Done' : 'Missing'}</span></div>`).join('').replace('border-top:1px solid #1E1E22', '')}</div>
          <span style="font-size:11px;color:#6B6B72">Reversible: suspend it from the shop page. Logged as ${esc(me.name)}.</span>
          ${errBox}${dlgBtns('CANCEL', 'APPROVE & GO LIVE', 'id="ap-go"')}</div>`, { onClose: back, width: 500 });
        dl.querySelector('#ap-go').onclick = async () => {
          try { await act('admin_salon_decide', { p_salon: s.id, p_action: 'approve', p_note: null }, { title: `Approve ${s.name}`, place: 'Salons' }); closeDialog(); toast(`${s.name} is live`); go(`/salons/${slugs[s.id] || slug}`); }
          catch (e) { showErr(dl, e); }
        };
      }
      // SAL-28 / SAL-35 — sent back, not killed: a task in the owner's To-do
      if (q.get('changes')) {
        const WHAT = ['The licence photo is expired or unreadable', 'The pin is not where the shop is', 'Services or prices are missing', 'Opening hours are missing'];
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Send ${esc(s.name)} back to ${esc(first(s.owner.name))}</span>
          <span style="font-size:12px;color:#9A9CA3">Not a refusal — the application stays open, waiting on them.</span>
          ${label9('WHAT IS WRONG WITH IT')}
          <div id="ch-what" style="display:flex;flex-direction:column;gap:6px">${WHAT.map((w, i) => `<label style="display:flex;align-items:center;gap:10px;font-size:12.5px;cursor:pointer"><input type="checkbox" value="${i}" style="accent-color:#E8442E">${esc(w)}</label>`).join('')}</div>
          ${label9(`WHAT ${first(s.owner.name).toUpperCase()} READS`)}
          <textarea id="ch-text" rows="4" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;line-height:1.5;outline:none;resize:vertical">${esc(first(s.owner.name))} — </textarea>
          <span style="font-size:11px;color:#6B6B72">It lands in the To-do list in the app. A permanent no is the Head of Ops’, with REFUSE.</span>
          ${errBox}${dlgBtns('CANCEL', 'SEND IT BACK', 'id="ch-go"')}</div>`, { onClose: back, width: 520 });
        dl.querySelector('#ch-go').onclick = async () => {
          const picked = [...dl.querySelectorAll('#ch-what input:checked')].map((x) => WHAT[+x.value]);
          const body = dl.querySelector('#ch-text').value.trim();
          if (!picked.length && body.length < 5) return showErr(dl, new Error('Say what needs changing.'));
          try {
            await act('admin_issue_task', { p_salon: s.id, p_kind: 'other', p_title: picked[0] || 'Your application needs a change', p_body: [picked.join(' · '), body].filter(Boolean).join('\n\n'), p_action: 'none' }, { title: `Send ${s.name} back` });
            closeDialog(); toast(`Sent back — waiting on ${first(s.owner.name)}`);
          } catch (e) { showErr(dl, e); }
        };
      }
      // a permanent refusal — the Head of Ops' (SET-03)
      if (q.get('reject')) {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Refuse ${esc(s.name)} permanently</span>
          <span style="font-size:12px;line-height:1.55;color:#9A9CA3">For fraud, wrong premises or an owner we won’t work with. To ask for a fix instead, use Request changes.</span>
          <textarea id="rj-why" rows="3" placeholder="Why — kept on the record" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
          ${errBox}${dlgBtns('CANCEL', 'REFUSE IT', 'id="rj-go"')}</div>`, { onClose: back, width: 480 });
        dl.querySelector('#rj-go').onclick = async () => {
          const note = dl.querySelector('#rj-why').value.trim();
          if (!note) return showErr(dl, new Error('Say why — it stays on the record.'));
          try { await act('admin_salon_decide', { p_salon: s.id, p_action: 'reject', p_note: note }, { title: `Refuse ${s.name}`, place: 'Salons' }); closeDialog(); toast('Refused'); go('/salons?state=pending'); }
          catch (e) { showErr(dl, e); }
        };
      }
    },
  };
}

// ---- SAL-05 · add a salon --------------------------------------------------------
async function addSalon({ act, go, toast, me }) {
  const WHY = [['recruited', 'Recruited · demand'], ['walk_in', 'Walked in'], ['moved', 'Moved shop']];
  const CAPS = [150000, 300000, 600000];
  const field = (id, label, ph) => `<label style="display:flex;flex-direction:column;gap:6px">${label9(label, '#6B6B72')}<input id="${id}" placeholder="${ph}" style="height:40px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:13px;outline:none"></label>`;
  const chipRow = (name, items, sel) => `<div data-chips="${name}" style="display:flex;gap:7px;flex-wrap:wrap">${items.map(([k, l]) => `<span data-v="${k}" style="height:32px;display:inline-flex;align-items:center;padding:0 12px;border-radius:9px;font-size:11.5px;font-weight:700;cursor:pointer;${String(k) === String(sel) ? 'background:#E8442E;color:#fff' : 'background:#212125;color:#9A9CA3'}">${l}</span>`).join('')}</div>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">${head(crumbs(['Salons', '/salons'], ['Add a salon']))}
    <div style="flex:1;overflow:auto"><div style="max-width:980px;padding:22px 24px 40px;display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1 1 420px;display:flex;flex-direction:column;gap:14px">
        <div style="display:flex;flex-direction:column;gap:4px"><span style="font-size:19px;font-weight:800">Add a salon</span><span style="font-size:12px;color:#9A9CA3">For a shop you’ve signed up in person — they finish it themselves.</span></div>
        ${panel(`${label9('THE SHOP')}${field('n-name', 'NAME', 'Coiffure Atlas')}${field('n-addr', 'ADDRESS', '18 Bd Moulay Youssef')}${field('n-dist', 'DISTRICT', 'Malabata')}`)}
        ${panel(`${label9('WHO OWNS IT')}${field('n-owner', 'NAME', 'Brahim Ouazzani')}${field('n-phone', 'PHONE', '+212 6 …')}<span style="font-size:11px;color:#9A9CA3">If this number already has an account, the shop is theirs the moment they open the link.</span>`)}
        ${panel(`${label9('WHY WE’RE ADDING THEM')}${chipRow('why', WHY, 'recruited')}`)}
        ${panel(`${label9('FLOAT CAP TO START ON')}${chipRow('cap', CAPS.map((c) => [c, num(Math.round(c / 100))]), CAPS[0])}<span style="font-size:10.5px;color:#9A9CA3">New shops start low. Raise it once they’ve settled a float on time.</span>`)}
      </div>
      <div style="flex:1 1 300px;display:flex;flex-direction:column;gap:14px">
        ${panel(`${label9('WHAT YOU CAN’T DO FOR THEM')}<span style="font-size:11.5px;color:#9A9CA3;line-height:1.5">Adding a shop doesn’t list it. The owner gets the link and finishes the same checklist an applicant does: the licence photo, the pin on the door, services and photos.</span>`)}
        ${panel(`${label9('THE MESSAGE THEY GET')}<span id="n-sms" style="font-size:12px;line-height:1.55;color:#C9CAD0"></span><span style="font-size:10.5px;color:#6B6B72">Nothing sends SMS yet: creating copies the message for you to send.</span>`)}
        ${errBox}
        <span id="n-send" class="btn-p" style="height:44px;border-radius:10px;background:#E8442E;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;letter-spacing:.06em;cursor:pointer">CREATE &amp; COPY THE INVITE</span>
        <span id="n-save" class="btn-s" style="height:40px;border-radius:10px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;cursor:pointer">SAVE WITHOUT TELLING THEM</span>
        <span style="font-size:10.5px;color:#6B6B72;text-align:center">Created by ${esc(me.name)} · shows on the shop’s record for good.</span>
      </div></div></div></div>`;
  return {
    top: false, html,
    ready(root) {
      const sel = { why: 'recruited', cap: CAPS[0] };
      const v = (id) => root.querySelector(id).value.trim();
      const sms = () => { root.querySelector('#n-sms').textContent = `"Salam ${first(v('#n-owner')) || 'a sidi'} — ${first(me.name)} from Sterncut. ${v('#n-name') || 'The shop'} is ready for you: open this link and add your licence and location. sterncut.ma/c/…"`; };
      root.addEventListener('input', sms); sms();
      root.querySelectorAll('[data-chips]').forEach((row) => { row.onclick = (e) => {
        const c = e.target.closest('[data-v]'); if (!c) return;
        sel[row.dataset.chips] = row.dataset.chips === 'cap' ? Number(c.dataset.v) : c.dataset.v;
        row.querySelectorAll('[data-v]').forEach((x) => { const on = x === c; x.style.background = on ? '#E8442E' : '#212125'; x.style.color = on ? '#fff' : '#9A9CA3'; });
      }; });
      const make = async (send) => {
        const err = root.querySelector('.dlg-err');
        if (!v('#n-name') || !v('#n-phone')) { err.textContent = 'It needs a name and a phone number.'; err.style.display = 'block'; return; }
        try {
          const r = await act('admin_create_salon', { p_name: v('#n-name'), p_address: v('#n-addr') || null, p_district: v('#n-dist') || null,
            p_owner_name: v('#n-owner') || null, p_owner_phone: v('#n-phone'), p_reason: sel.why, p_cap_cents: sel.cap, p_send: send }, { title: `Add ${v('#n-name')}` });
          if (send && r?.sms) await navigator.clipboard?.writeText(r.sms).catch(() => {});
          toast(send ? 'Created · the invite is copied — send it to them' : 'Created · nobody told');
          go('/salons?state=pending');
        } catch (e) { if (!e.handled) { err.textContent = e.message; err.style.display = 'block'; } }
      };
      root.querySelector('#n-send').onclick = () => make(true);
      root.querySelector('#n-save').onclick = () => make(false);
    },
  };
}
