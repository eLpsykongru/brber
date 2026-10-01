// /coupons[?view=running|draft|ended · ?send=<id>], /coupons/new — the campaign desk (0059),
// behind STERNCUT_FLAGS.coupons. Coupons are held from v1 (README §186): with the flag off the
// shell shows the held stub and never loads this.
// CPN-02 (the campaigns) and CPN-01 (a new one: who pays, the offer, who gets it, the cap).
// Not built (no backend): "came back after" and cost per keeper (nothing links a redeemed
// coupon to the bookings after it), topping up a cap, sending to yourself first, and
// CPN-03…15 / SAL-39/40 (armed triggers, barber returns, board reports, overrides, passes).
import { esc, DH, num } from '/app.js';
import { pageHead, chips, label9, btnS, btnP } from '/s/ui.js';

const STATE = { draft: ['DRAFT', '#9A9CA3'], running: ['RUNNING', '#4ADE80'], stopped: ['STOPPED', '#E8A100'], done: ['CAPPED OUT', '#9A9CA3'] };
const AUD = { lapsed: ['Lapsed · no booking in 60 days', 'They’ve used the app before, so they know how it works'], never_booked: ['Signed up, never booked', 'They got as far as an account and stopped'], city: ['Everyone in Tangier', 'Every customer account'] };
const pill = ([t, c]) => `<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${c};background:${c}1F;border-radius:5px;padding:3px 7px;white-space:nowrap">${t}</span>`;
const kpi = (l, v, s, col) => `<div style="flex:1 1 170px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:22px;font-weight:800${col ? ';color:' + col : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
const input = 'height:42px;background:#111113;border:1px solid #26262B;border-radius:11px;padding:0 12px;color:#fff;font-size:13px;outline:none;width:100%;box-sizing:border-box';
const worth = (c) => (c.amount_off_cents != null ? `${DH(c.amount_off_cents)} off` : `${c.percent_off}% off`);
const until = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };
// 'the shop already full' / 'one of the 4 shops already full'
const fullShops = (n) => (n === 1 ? 'the one shop already full most days' : `one of the ${n} shops already full most days`);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });

export default async function (ctx) {
  if (!ctx.seg[0]) return list(ctx);
  if (ctx.seg[0] === 'new') return builder(ctx);
  throw new Error('not_found');
}

// ---- CPN-02 ------------------------------------------------------------------------
async function list({ rpc, act, q, go, toast, dialog, closeDialog }) {
  const all = await rpc('admin_campaigns');
  const view = ['running', 'draft', 'ended'].includes(q.get('view')) ? q.get('view') : 'all';
  const ended = (c) => c.status === 'stopped' || c.status === 'done';
  const rows = all.filter((c) => view === 'all' || (view === 'ended' ? ended(c) : c.status === view));
  const sum = (k, f = () => true) => all.filter(f).reduce((n, c) => n + (c[k] || 0), 0);
  const sent = sum('issued_count'), used = sum('redeemed');
  const COLS = 'display:grid;grid-template-columns:minmax(200px,1.8fr) 100px minmax(150px,1.2fr) 90px 110px 110px 80px;gap:12px;align-items:center';
  const row = (c) => {
    const capPct = c.budget_cap_cents ? Math.min(100, Math.round(c.issued_cents * 100 / c.budget_cap_cents)) : 0;
    return `<div style="${COLS};padding:13px 16px;border-top:1px solid #1E1E22;font-size:12px">
      <span style="min-width:0"><span style="display:block;font-weight:700">${esc(c.name)} · <span style="font-family:ui-monospace,Menlo,monospace;color:#9A9CA3">${esc(c.code)}</span></span><span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">${worth(c)}${c.min_spend_cents ? ` · on ${DH(c.min_spend_cents)} or more` : ''}${c.expires_on ? ` · until ${until(c.expires_on)}` : ' · no end date'} · ${esc(AUD[c.audience]?.[0] || c.audience)}</span></span>
      <span style="color:${c.funded_by === 'platform' ? '#9A9CA3' : '#E8A100'}">${c.funded_by === 'platform' ? 'Sterncut' : 'The shops'}</span>
      <span>${c.budget_cap_cents ? `<span class="num" style="font-size:11.5px">${DH(c.issued_cents)} / ${DH(c.budget_cap_cents)}</span><span style="display:block;height:5px;border-radius:3px;background:#212125;overflow:hidden;margin-top:6px"><span style="display:block;height:5px;width:${capPct}%;background:${capPct >= 100 ? '#E8A100' : '#E8442E'}"></span></span>` : `<span style="font-size:11.5px;color:#6B6B72">${c.funded_by === 'platform' ? 'no cap' : 'costs us nothing'}</span>`}</span>
      <span class="num">${num(c.issued_count)}</span>
      <span class="num">${num(c.redeemed)}${c.issued_count ? ` <span style="color:#6B6B72">· ${Math.round(c.redeemed * 100 / c.issued_count)}%</span>` : ''}</span>
      <span>${pill(STATE[c.status] || [String(c.status).toUpperCase(), '#9A9CA3'])}</span>
      <span style="text-align:right">${c.status === 'draft' ? `<a href="/coupons?send=${c.id}" style="font-size:10px;font-weight:800;letter-spacing:.06em;background:#E8442E;border-radius:7px;padding:7px 10px;color:#fff">SEND</a>`
        : c.status === 'running' ? `<span data-stop="${c.id}" style="cursor:pointer;font-size:10px;font-weight:800;letter-spacing:.06em;border:1px solid #3A3A40;border-radius:7px;padding:6px 10px;color:#9A9CA3">STOP</span>` : ''}</span></div>`;
  };
  const link = (v) => (v === 'all' ? '/coupons' : `/coupons?view=${v}`);
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Coupons', `${all.length} campaign${all.length === 1 ? '' : 's'} · ${all.filter((c) => c.status === 'running').length} running`, btnP('New campaign', 'data-go="/coupons/new"'))}
    ${chips([['All', link('all'), view === 'all'], ['Running', link('running'), view === 'running', all.filter((c) => c.status === 'running').length || null], ['Drafts', link('draft'), view === 'draft'], ['Ended', link('ended'), view === 'ended']])}
    <div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">${kpi('ACTUALLY SPENT', DH(sum('spent_cents')), 'coupons used at a shop, all campaigns')}
        ${kpi('COMMITTED', DH(sum('issued_cents', (c) => c.status === 'running')), 'codes sitting in wallets, running campaigns')}
        ${kpi('CUTS BOUGHT', num(used), 'coupons redeemed')}${kpi('REDEMPTION', sent ? `${Math.round(used * 100 / sent)}%` : '—', `${num(used)} of ${num(sent)} sent`)}</div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
        <div style="${COLS};padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:860px"><span>CAMPAIGN</span><span>PAID BY</span><span>BUDGET USED</span><span>SENT TO</span><span>REDEEMED</span><span>STATE</span><span></span></div>
        <div style="min-width:860px">${rows.map(row).join('') || '<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">No campaigns here.</div>'}</div></div>
      <span style="font-size:11px;color:#6B6B72">Codes already in a wallet always work — cap or no cap, stopped or not.</span>
    </div></div>`;
  return {
    top: false, html,
    async ready(root) {
      root.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', async () => {
        const c = all.find((x) => x.id === b.dataset.stop);
        if (!confirm(`Stop issuing ${c.code}? Coupons already in a wallet keep working.`)) return;
        try { await act('admin_stop_campaign', { p_campaign: c.id }, { title: `Stop ${c.name} · ${c.code}` }); toast('Stopped issuing'); go(location.pathname + location.search, { replace: true }); }
        catch (e) { if (!e.handled) toast(e.message, false); }
      }));
      const c = all.find((x) => x.id === q.get('send') && x.status === 'draft');
      if (!c) return;
      const aud = await rpc('admin_campaign_audience', { p_audience: c.audience });
      const wait = c.funded_by === 'shop' && c.notice_until && c.notice_until > today();
      const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:13px">
        <span style="font-size:17px;font-weight:800">Send ${esc(c.code)}</span>
        <span style="font-size:12px;color:#9A9CA3;line-height:1.55">${worth(c)}${c.min_spend_cents ? ` on ${DH(c.min_spend_cents)} or more` : ''} to ${esc(AUD[c.audience]?.[0] || c.audience)} — <b style="color:#fff">${num(aud.reach)} people</b>${aud.full_shops ? `, leaving out anyone whose usual shop is ${fullShops(aud.full_shops)}` : ''}. Each gets it in My coupons and as one notification.${c.budget_cap_cents ? ` Issuing stops the moment ${DH(c.budget_cap_cents)} is reserved.` : ''}</span>
        ${wait ? `<div style="background:rgba(232,161,0,.08);border:1px solid rgba(232,161,0,.35);border-radius:11px;padding:11px 13px;font-size:12px;line-height:1.5;color:#E8A100">Shops get 14 days’ notice before a campaign they pay for — this one can go from ${until(c.notice_until)}.</div>` : ''}
        ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${wait ? '' : btnP(`SEND TO ${num(aud.reach)} PEOPLE`, 'id="cp-go"')}</div></div>`, { onClose: () => go('/coupons'), width: 480 });
      dl.querySelector('#cp-go')?.addEventListener('click', async () => {
        try { const r = await act('admin_send_campaign', { p_campaign: c.id }, { title: `Send ${c.name} · ${c.code}` }); closeDialog(); toast(`Sent to ${num(r.issued)} people`); }
        catch (e) { showErr(dl, e); }
      });
    },
  };
}

// ---- CPN-01 · a new campaign ----------------------------------------------------------
async function builder({ rpc, act, go, toast }) {
  let funder = 'platform', audience = 'lapsed', aud = await rpc('admin_campaign_audience', { p_audience: audience });
  const field = (l, id, attrs) => `<label style="flex:1 1 140px;display:flex;flex-direction:column;gap:6px">${label9(l, '#6B6B72')}<input id="${id}" ${attrs} style="${input}"></label>`;
  const box = (inner) => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px">${inner}</div>`;
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('New campaign', 'Draft · not sent', btnS('Cancel', 'data-go="/coupons"'))}
    <div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
      <div style="flex:3 1 520px;min-width:0;display:flex;flex-direction:column;gap:14px">
        ${box(`${label9('WHO PAYS FOR THE DISCOUNT', '#6B6B72')}<div id="cm-funder" style="display:flex;gap:12px;flex-wrap:wrap"></div>`)}
        ${box(`${label9('THE OFFER', '#6B6B72')}<div style="display:flex;gap:12px;flex-wrap:wrap">${field('AMOUNT OFF · DH', 'cm-amount', 'inputmode="numeric" value="20"')}${field('MIN SPEND · DH', 'cm-min', 'inputmode="numeric" value="60"')}${field('PER PERSON', 'cm-per', 'inputmode="numeric" value="1"')}</div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">${field('NAME', 'cm-name', 'placeholder="Back to school"')}${field('CODE', 'cm-code', 'placeholder="RENTREE20"')}${field('RUNS UNTIL', 'cm-until', 'type="date"')}</div>`)}
        ${box(`${label9('WHO GETS IT', '#6B6B72')}<div id="cm-aud" style="display:flex;flex-direction:column;gap:8px"></div><span id="cm-exclude" style="font-size:11.5px;color:#9A9CA3;line-height:1.5"></span>`)}
        ${box(`${label9('WHAT IT COSTS US', '#6B6B72')}<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">${field('BUDGET CAP · DH', 'cm-cap', 'inputmode="numeric" value="8000"')}<span id="cm-cuts" style="flex:1 1 140px;font-size:13px;font-weight:700;padding-bottom:12px"></span></div>
          <span style="font-size:11px;color:#6B6B72">Stops issuing the moment the cap is hit. Codes already in a wallet still work.</span>`)}
      </div>
      <div style="flex:2 1 300px;min-width:0;display:flex;flex-direction:column;gap:14px">
        ${box(`${label9('WHAT THEY’LL SEE', '#6B6B72')}<div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:5px"><span id="pv-title" style="font-size:14px;font-weight:800"></span><span id="pv-sub" style="font-size:11.5px;color:#9A9CA3"></span><span style="font-size:11.5px;color:#9A9CA3;line-height:1.5;margin-top:4px">Comes off what you pay from your wallet. Your barber still gets the full price.</span></div>
          <span style="font-size:11px;color:#6B6B72">Lands in My coupons and as one notification. No second reminder.</span>`)}
        <span id="cm-notice" style="font-size:11.5px;color:#E8A100;line-height:1.5;display:none">Shops get 14 days’ notice before a campaign they pay for. Save it now; it can be sent from the list once the notice has run.</span>
        <span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>
        <div style="display:flex;gap:10px;flex-wrap:wrap">${btnP('SEND', 'id="cm-send"')}${btnS('Save as a draft', 'id="cm-save"')}</div>
      </div></div></div>`;
  return {
    top: false, html,
    ready(root) {
      const $ = (id) => root.querySelector('#' + id), v = (id) => $(id).value.trim();
      const dh = (id) => Math.round(Number(v(id).replace(',', '.')) * 100) || null;
      const pick = (sel, on) => `border:${on ? '2px solid #E8442E' : '2px solid transparent'};background:#111113;${sel}`;
      const draw = () => {
        $('cm-funder').innerHTML = [['platform', 'Sterncut pays', 'The customer pays less and the barber is still paid full price — Sterncut covers the difference.', 'Marketing spend · comes off the budget below', '#9A9CA3'],
          ['shop', 'Shops pay, opt-in', 'Each shop chooses to join and takes the cut itself. Costs us nothing, but most shops decline.', 'Needs 14 days’ notice to shops', '#E8A100']]
          .map(([k, t, b, f, c]) => `<div data-funder="${k}" style="flex:1 1 220px;border-radius:12px;padding:14px;cursor:pointer;${pick('', funder === k)}"><span style="display:block;font-size:13px;font-weight:700">${t}</span><span style="display:block;font-size:11.5px;line-height:1.5;color:#9A9CA3;margin-top:6px">${b}</span><span style="display:block;font-size:10.5px;color:${c};margin-top:8px">${f}</span></div>`).join('');
        $('cm-aud').innerHTML = Object.entries(AUD).map(([k, [t, s]]) => `<div data-aud="${k}" style="display:flex;align-items:center;gap:12px;border-radius:12px;padding:12px 14px;cursor:pointer;${pick('', audience === k)}"><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${t}</span><span style="display:block;font-size:11px;color:#6B6B72;margin-top:2px">${s}</span></span><span class="num" style="font-size:15px;font-weight:700">${num(aud[k])}</span></div>`).join('');
        // said out loud: the difference between a campaign that creates cuts and one that lengthens a waiting list
        $('cm-exclude').textContent = aud.full_shops ? `Not sent to people whose usual shop is ${fullShops(aud.full_shops)} — a coupon there just makes the waiting list longer. ${num(aud.reach)} would actually receive it.` : `${num(aud.reach)} would receive it.`;
        const amt = dh('cm-amount'), cap = dh('cm-cap'), min = dh('cm-min');
        // the same arithmetic admin_send_campaign uses, so the estimate can't lie to the desk
        $('cm-cuts').textContent = amt && cap ? `= at most ${num(Math.floor(cap / amt))} cuts at ${DH(amt)}` : 'Set an amount and a cap.';
        $('pv-title').textContent = amt ? `${DH(amt)} off your next cut` : 'Set an amount';
        $('pv-sub').textContent = [min ? `On ${DH(min)} or more` : '', v('cm-until') ? `until ${until(v('cm-until'))}` : ''].filter(Boolean).join(' · ');
        $('cm-notice').style.display = funder === 'shop' ? 'block' : 'none';
        $('cm-send').style.display = funder === 'shop' ? 'none' : 'flex';
        $('cm-send').textContent = `SEND TO ${num(aud.reach)} PEOPLE`;
      };
      root.addEventListener('click', async (e) => {
        const f = e.target.closest('[data-funder]');
        if (f) { funder = f.dataset.funder; return draw(); }
        const a = e.target.closest('[data-aud]');
        if (a && a.dataset.aud !== audience) { audience = a.dataset.aud; aud = await rpc('admin_campaign_audience', { p_audience: audience }); return draw(); }
      });
      root.addEventListener('input', (e) => { if (e.target.id === 'cm-code') e.target.value = e.target.value.toUpperCase(); draw(); });
      const fail = (m) => { const x = root.querySelector('.dlg-err'); x.textContent = m; x.style.display = 'block'; };
      const save = async (send) => {
        root.querySelector('.dlg-err').style.display = 'none';
        if (!v('cm-code')) return fail('A campaign needs a code.');
        if (!dh('cm-amount')) return fail('Say how much comes off.');
        try {
          const id = await act('admin_save_campaign', { p_name: v('cm-name') || v('cm-code'), p_code: v('cm-code'), p_funded_by: funder, p_audience: audience,
            p_amount_off_cents: dh('cm-amount'), p_min_spend_cents: dh('cm-min'), p_per_person: Number(v('cm-per')) || 1, p_expires_on: v('cm-until') || null, p_budget_cap_cents: dh('cm-cap') },
          { title: `Save the campaign ${v('cm-code').toUpperCase()}` });
          if (send) { const r = await act('admin_send_campaign', { p_campaign: id }, { title: `Send ${v('cm-code').toUpperCase()}` }); toast(`Sent to ${num(r.issued)} people`); }
          else toast('Saved as a draft');
          go('/coupons');
        } catch (e) { if (!e.handled) fail(e.message); }
      };
      $('cm-send').onclick = () => save(true);
      $('cm-save').onclick = () => save(false);
      draw();
    },
  };
}
