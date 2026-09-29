// /settings — Team & roles (SET-02), Permissions (SET-03) and the Audit log
// (SET-04) are drawn here from 0133's tables. Rules, Deposits and Reliability
// are still the old console's screens; Pricing, Message templates and Districts
// are not on the website yet. "Take" (SET-14…16) is not built: the billing rail
// (0123) already decided what Sterncut takes.
import { esc, first, initials, dayShort, ROLE_LABEL, framed } from '/app.js';
import { pageHead, subTabs, chips, btnP, btnS, plus, avatar, label9, csv } from '/s/ui.js';

const ROLES = ['head', 'support', 'mod', 'field'];
// mirrors staff_caps() in 0133 — the matrix below is computed from it
const CAPS = { head: ['*'], support: ['support'], mod: ['moderation'], field: ['shops', 'growth'] };
const TABS = [['Rules', '/settings'], ['Deposits', '/settings/deposit-bounds'], ['Pricing', '/settings/pricing'],
  ['Reliability', '/settings/reliability'], ['Team & roles', '/settings/team'], ['Permissions', '/settings/permissions'],
  ['Audit log', '/settings/audit'], ['Message templates', '/settings/templates'], ['Districts', '/settings/districts']];

const frame = (inner, title, sub, right) => `<div style="height:100%;display:flex;flex-direction:column;min-width:0">
  ${pageHead(title, sub, right)}
  ${subTabs(TABS.map(([l, h]) => [l, h, location.pathname === h]))}
  ${inner}</div>`;

function when(t) {
  const m = (Date.now() - new Date(t)) / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + ' min ago';
  if (m < 1440) return Math.round(m / 60) + 'h ago';
  if (m < 2880) return 'Yesterday';
  return dayShort(t);
}

export default async function (ctx) {
  const page = ctx.seg[0] || '';
  if (page === 'team') return team(ctx);
  if (page === 'permissions') return permissions(ctx);
  if (page === 'audit') return audit(ctx);
  if (['pricing', 'templates', 'districts'].includes(page)) {
    const t = TABS.find(([, h]) => h === '/settings/' + page)[0];
    return { top: false, html: frame(`<div style="padding:26px 24px;max-width:640px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:9.5px;letter-spacing:.14em;font-weight:700;border-radius:999px;padding:4px 9px;color:#E8A100;background:rgba(232,161,0,.12);align-self:flex-start">NOT BUILT YET</span>
      <span style="font-size:13px;line-height:1.6;color:#9A9CA3">${esc(t)} isn’t on the website yet.${page === 'pricing' ? ' The price list lives in platform_settings, which the public site already reads.' : ''}</span></div>`, t, '') };
  }
  return framed(ctx.path);
}

// ---------------------------------------------------------------- SET-02 --
async function team({ me, rpc, act, q, go, toast, dialog, closeDialog }) {
  const t = await rpc('admin_team');
  const lead = me.role === 'head';
  const pill = (r) => r === 'head'
    ? '<span style="font-size:11px;font-weight:700;color:#E8442E;background:rgba(232,68,46,.14);border-radius:6px;padding:3px 9px">Head of Ops</span>'
    : `<span style="font-size:11px;font-weight:700;color:#9A9CA3;background:rgba(255,255,255,.07);border-radius:6px;padding:3px 9px">${esc(ROLE_LABEL[r])}</span>`;
  const person = (p) => `
    <div ${lead ? `data-go="/settings/team?person=${p.id}"` : ''} class="${lead ? 'hov' : ''}" style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #1E1E22">
      <span style="width:250px;flex:none;display:flex;align-items:center;gap:11px">${avatar(initials(p.name), p.is_head ? '#E8442E' : '#212125')}<span style="display:flex;flex-direction:column;gap:1px;min-width:0"><span style="font-size:13px;font-weight:700">${esc(p.name)}${p.is_me ? ' <span style="font-weight:500;color:#6B6B72">· you</span>' : ''}</span><span style="font-size:10.5px;color:#6B6B72">${esc(p.email)}</span></span></span>
      <span style="width:150px;flex:none">${pill(p.role)}</span>
      <span style="width:130px;flex:none;font-size:12px;color:#9A9CA3">${p.is_head ? 'All' : 'Tangier'}</span>
      <span style="flex:1;font-size:11.5px;color:#9A9CA3">${p.last_action ? `${esc(p.last_action)} · ${esc(when(p.last_at))}` : '—'}</span>
      <span style="width:90px;flex:none;font-size:11px;font-weight:700;color:${p.two_factor ? '#4ADE80' : '#E8A100'}">${p.two_factor ? 'On' : 'Not set'}</span>
    </div>`;
  const invite = (i) => `
    <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #1E1E22;opacity:.6">
      <span style="width:250px;flex:none;display:flex;align-items:center;gap:11px"><span style="width:32px;height:32px;border-radius:999px;border:1.5px dashed #3A3A40;display:flex;align-items:center;justify-content:center;flex:none"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6B6B72" stroke-width="2"><path d="M4 7h16v13H4zM4 7l8 6 8-6"></path></svg></span><span style="display:flex;flex-direction:column;gap:1px"><span style="font-size:13px;font-weight:700">${esc(i.email)}</span><span style="font-size:10.5px;color:#6B6B72">Invited by ${esc(first(i.invited_by))}, ${esc(when(i.invited_at).replace('Yesterday', 'yesterday'))}</span></span></span>
      <span style="width:150px;flex:none">${pill(i.role)}</span>
      <span style="width:130px;flex:none;font-size:12px;color:#9A9CA3">${i.role === 'head' ? 'All' : 'Tangier'}</span>
      <span style="flex:1;font-size:11.5px;color:#E8A100">Not accepted yet</span>
      <span data-resend="${esc(i.email)}" style="width:90px;flex:none;font-size:11px;font-weight:700;color:#E8442E;cursor:pointer">Resend</span>
    </div>`;
  const no2fa = t.people.filter((p) => !p.two_factor);
  const html = frame(`
    <div style="flex:1;min-height:0;padding:22px 24px;display:flex;flex-direction:column;gap:14px;box-sizing:border-box;overflow:auto">
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:12px;padding:11px 18px;border-bottom:1px solid #1E1E22;background:#141416">
          <span style="width:250px;flex:none">${label9('PERSON')}</span><span style="width:150px;flex:none">${label9('ROLE')}</span>
          <span style="width:130px;flex:none">${label9('CITIES')}</span><span style="flex:1">${label9('LAST ACTION')}</span><span style="width:90px;flex:none">${label9('2FA')}</span>
        </div>
        ${t.people.map(person).join('')}${t.invites.map(invite).join('')}
      </div>
      <div style="display:flex;gap:14px">
        ${no2fa.length ? `<div style="flex:1;background:#17171A;border:1px solid rgba(232,161,0,.25);border-radius:14px;padding:16px;display:flex;gap:12px;align-items:flex-start">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E8A100" stroke-width="1.9" style="margin-top:1px;flex:none"><circle cx="12" cy="12" r="9"></circle><path d="M12 7.5v5.5M12 16.5h.01"></path></svg>
          <span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:12.5px;font-weight:700">${esc(no2fa.map((p) => first(p.name)).join(', '))} ${no2fa.length === 1 ? 'has' : 'have'} no second factor</span><span style="font-size:11px;line-height:1.45;color:#9A9CA3">Nothing in this console opens without one — it is set up at the next sign-in, before the first page loads.</span></span>
        </div>` : '<div style="flex:1"></div>'}
        <div style="width:290px;flex:none;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px">
          <span style="font-size:12.5px;font-weight:700">Nobody is an admin</span>
          <span style="font-size:11px;line-height:1.5;color:#9A9CA3">Four roles, each named after a job. If a new person does not fit one, that is a sign the org changed — not that they need a fifth role.</span>
        </div>
      </div>
    </div>`, 'Team & roles', `${t.people.length} ${t.people.length === 1 ? 'person' : 'people'} · ${t.invites.length} invite${t.invites.length === 1 ? '' : 's'} pending`,
    btnP(plus + 'Invite', 'data-go="/settings/team?invite=1"'));

  const back = () => go('/settings/team');
  const roleChips = (sel) => `<div id="roles" style="display:flex;gap:6px;flex-wrap:wrap">${ROLES.map((r) => `<span data-role="${r}" style="height:30px;border-radius:8px;display:flex;align-items:center;padding:0 12px;font-size:11.5px;font-weight:700;cursor:pointer;${r === sel ? 'background:#E8442E;color:#fff' : 'background:#212125;color:#9A9CA3;border:1px solid #26262B'}">${ROLE_LABEL[r]}</span>`).join('')}</div>`;
  const fail = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };

  function ready(root) {
    root.onclick = async (e) => {
      const r = e.target.closest('[data-resend]');
      if (!r) return;
      // no email rail: "Resend" hands ops the words to send themselves
      await navigator.clipboard?.writeText(`You’re on the Sterncut ops team. Sign up in the Sterncut app with ${r.dataset.resend} (and confirm the email), then sign in at admin.sterncut.ma.`).catch(() => {});
      toast('Copied — send it to them');
    };
    if (q.get('invite')) {
      let role = 'field';
      const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:16px">
        <span style="font-size:17px;font-weight:800">Invite a colleague</span>
        <div style="display:flex;flex-direction:column;gap:8px">${label9('WORK EMAIL', '#6B6B72')}
          <input id="inv-email" placeholder="name@sterncut.ma" autocomplete="off" style="height:44px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 14px;color:#fff;font-size:13.5px;outline:none"></div>
        <div style="display:flex;flex-direction:column;gap:8px">${label9('ROLE', '#6B6B72')}<div id="rolebox">${roleChips(role)}</div></div>
        <span style="font-size:11.5px;line-height:1.55;color:#9A9CA3">There is no email from us. They sign up in the Sterncut app with this address and confirm it; the first time they sign in here, the invite makes them staff.</span>
        <span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>
        <div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('Send invite', 'id="inv-go"')}</div>
      </div>`, { onClose: back, width: 480 });
      d.querySelector('#rolebox').onclick = (e) => { const c = e.target.closest('[data-role]'); if (c) { role = c.dataset.role; d.querySelector('#rolebox').innerHTML = roleChips(role); } };
      d.querySelector('#inv-email').focus();
      d.querySelector('#inv-go').onclick = async () => {
        const email = d.querySelector('#inv-email').value.trim();
        try {
          const r = await act('admin_invite_colleague', { p_email: email, p_role: role }, { title: `Invite ${email}` });
          closeDialog();
          toast(r.accepted ? `${r.email} is on the team` : `Invited — waiting for ${r.email}`);
        } catch (e) { fail(d, e); }
      };
    }
    const pid = q.get('person');
    const p = pid && t.people.find((x) => x.id === pid);
    if (p) {
      let role = p.role;
      const self = p.is_me;
      const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;align-items:center;gap:12px">${avatar(initials(p.name), p.is_head ? '#E8442E' : '#212125', 40)}
          <span style="display:flex;flex-direction:column;gap:2px"><span style="font-size:15px;font-weight:800">${esc(p.name)}</span><span style="font-size:11.5px;color:#9A9CA3">${esc(p.email)}</span></span></div>
        ${self ? '<span style="font-size:12px;line-height:1.5;color:#9A9CA3">This is you. Another Head of Ops changes your role, your second factor or your place on the team.</span>' : `
        <div style="display:flex;flex-direction:column;gap:8px">${label9('ROLE', '#6B6B72')}<div id="rolebox">${roleChips(role)}</div></div>
        <div style="display:flex;align-items:center;gap:12px;background:#111113;border:1px solid #1E1E22;border-radius:12px;padding:12px 14px">
          <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">Second factor · <span style="color:${p.two_factor ? '#4ADE80' : '#E8A100'}">${p.two_factor ? 'On' : 'Not set'}</span></span><span style="font-size:11px;color:#9A9CA3;line-height:1.45">Lost phone? Re-enrol clears it and signs them out everywhere; they set a new one up at the next sign-in. Do it in person.</span></span>
          ${p.two_factor ? btnS('Re-enrol', 'id="p-reset"') : ''}
        </div>`}
        <span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>
        <div style="display:flex;gap:10px;align-items:center">${self ? '' : `<span id="p-remove" style="font-size:12px;font-weight:700;color:#F87171;cursor:pointer">Remove from the team</span>`}<span style="flex:1"></span>
          ${btnS('Close', 'data-dlg-close="1"')}${self ? '' : btnP('Save role', 'id="p-save"')}</div>
      </div>`, { onClose: back, width: 480 });
      if (!self) {
        d.querySelector('#rolebox').onclick = (e) => { const c = e.target.closest('[data-role]'); if (c) { role = c.dataset.role; d.querySelector('#rolebox').innerHTML = roleChips(role); } };
        const run = async (fn, args, done, title) => { try { await act(fn, args, { title }); closeDialog(); toast(done); } catch (e) { fail(d, e); } };
        d.querySelector('#p-save').onclick = () => run('admin_set_role', { p_admin: p.id, p_role: role }, `${first(p.name)} is ${ROLE_LABEL[role]}`, `Make ${p.name} ${ROLE_LABEL[role]}`);
        d.querySelector('#p-reset')?.addEventListener('click', () => run('admin_reset_factor', { p_admin: p.id }, `${first(p.name)} sets up a new code at the next sign-in`, `Re-enrol ${p.name}`));
        d.querySelector('#p-remove').onclick = () => { if (confirm(`Remove ${p.name} from the team? They keep their app account.`)) run('admin_remove_colleague', { p_admin: p.id }, `${first(p.name)} is off the team`, `Remove ${p.name}`); };
      }
    }
  }
  return { top: false, html, ready };
}

// ---------------------------------------------------------------- SET-03 --
async function permissions({ me, rest }) {
  const acts = await rest('staff_actions?select=key,label,allow,ask,sort&order=sort');
  const cell = (a, r) => {
    const caps = CAPS[r];
    if (r === 'head' || caps.some((c) => a.allow.includes(c))) return '<span style="width:76px;flex:none;text-align:center;font-size:13px;color:#4ADE80">&check;</span>';
    if (caps.some((c) => a.ask.includes(c))) return '<span style="width:76px;flex:none;text-align:center;font-size:10px;font-weight:700;color:#E8A100">ASK</span>';
    return '<span style="width:76px;flex:none;text-align:center;font-size:12px;color:#3A3A40">&mdash;</span>';
  };
  const row = (label, cells, last) => `<div style="display:flex;align-items:center;padding:12px 18px;${last ? '' : 'border-bottom:1px solid #1E1E22'}"><span style="flex:1;font-size:12.5px">${esc(label)}</span>${cells}</div>`;
  const drawn = acts.filter((a) => a.sort < 10), rest2 = acts.filter((a) => a.sort >= 10);
  const all = '<span style="width:76px;flex:none;text-align:center;font-size:13px;color:#4ADE80">&check;</span>'.repeat(4);
  const head = first(me.head) || 'the Head of Ops';
  const html = frame(`
    <div style="flex:1;min-height:0;padding:22px 24px;display:flex;gap:20px;box-sizing:border-box;overflow:auto">
      <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:14px;align-self:flex-start">
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
          <div style="display:flex;align-items:center;padding:11px 18px;border-bottom:1px solid #1E1E22;background:#141416">
            <span style="flex:1">${label9('ACTION')}</span>
            ${['SUPPORT', 'MOD', 'FIELD'].map((l) => `<span style="width:76px;flex:none;text-align:center;font-size:9.5px;letter-spacing:.1em;font-weight:700;color:#9A9CA3">${l}</span>`).join('')}
            <span style="width:76px;flex:none;text-align:center;font-size:9.5px;letter-spacing:.1em;font-weight:700;color:#E8442E">HEAD</span>
          </div>
          ${row('Read a booking, wallet or case', all)}
          ${drawn.map((a, i) => row(a.label, ROLES.slice(1).concat('head').map((r) => cell(a, r)).join(''), i === drawn.length - 1)).join('')}
        </div>
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">
          <div style="padding:11px 18px;border-bottom:1px solid #1E1E22;background:#141416">${label9('THE REST OF THE DESK')}</div>
          ${rest2.map((a, i) => row(a.label, ROLES.slice(1).concat('head').map((r) => cell(a, r)).join(''), i === rest2.length - 1)).join('')}
        </div>
      </div>
      <div style="width:330px;flex:none;display:flex;flex-direction:column;gap:14px">
        <span style="font-size:10px;letter-spacing:.13em;font-weight:700;color:#9A9CA3">WHAT “ASK” LOOKS LIKE</span>
        <div style="background:#17171A;border:1px solid #26262B;border-radius:14px;padding:17px;display:flex;flex-direction:column;gap:13px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:32px;height:32px;border-radius:9px;background:rgba(232,161,0,.14);display:flex;align-items:center;justify-content:center;flex:none"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E8A100" stroke-width="1.9"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg></span>
            <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:700">${esc(head)} has to agree</span><span style="font-size:10.5px;color:#9A9CA3">Suspending a shop</span></span>
          </div>
          <span style="font-size:11.5px;line-height:1.5;color:#9A9CA3;border-top:1px solid #26262B;padding-top:12px">Your reasoning goes to ${esc(head)}, not the action. ${esc(head)} sees exactly the screen you were on.</span>
          <div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:12px 13px;display:flex;flex-direction:column;gap:7px">
            <span style="font-size:10px;letter-spacing:.13em;font-weight:700;color:#6B6B72">WHY THIS SHOP, TODAY</span>
            <span style="font-size:11.5px;line-height:1.5;color:#6B6B72">What you know that ${esc(head)} doesn’t.</span>
          </div>
          <span style="height:42px;border-radius:999px;background:#E8442E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;letter-spacing:.06em">SEND TO ${esc(head.toUpperCase())}</span>
          <span style="font-size:10.5px;line-height:1.45;color:#6B6B72;text-align:center">Nothing happens to the shop until ${esc(head)} decides.</span>
        </div>
        <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px">
          <span style="font-size:12.5px;font-weight:700">Why not just hide it</span>
          <span style="font-size:11px;line-height:1.5;color:#9A9CA3">Because the person asking is the one holding the evidence. Hiding the button moves the decision to WhatsApp and loses the reasoning — the audit log would show ${esc(head)} acting alone on a case they never read.</span>
        </div>
      </div>
    </div>`, 'Permissions', 'Per action, not per tab');
  return { top: false, html };
}

// ---------------------------------------------------------------- SET-04 --
const KINDS = [['Everything', ''], ['Money', 'money'], ['Suspensions', 'suspensions'], ['Refused asks', 'refused'], ['Rule changes', 'rules']];
async function audit({ rpc, q, go, toast, me }) {
  const kind = q.get('filter') || '';
  const who = q.get('who') || '';
  const [a, t] = await Promise.all([rpc('admin_audit', { p_kind: kind || null, p_staff: who || null }), rpc('admin_team')]);
  const link = (k, w) => { const u = new URLSearchParams(); if (k) u.set('filter', k); if (w) u.set('who', w); const s = u.toString(); return '/settings/audit' + (s ? '?' + s : ''); };
  const heads = new Set(t.people.filter((p) => p.is_head).map((p) => p.id));
  const row = (r) => `
    <div style="display:flex;align-items:flex-start;gap:13px;background:#17171A;border:1px solid ${r.kind === 'refused' ? 'rgba(232,161,0,.25)' : '#1E1E22'};border-radius:12px;padding:14px 16px">
      ${avatar(initials(r.who), heads.has(r.staff_id) ? '#E8442E' : '#212125', 30)}
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
        <span style="font-size:12.5px;line-height:1.45"><strong style="font-weight:700">${esc(first(r.who))}</strong> ${esc(r.what)}${r.subject ? ` <strong style="font-weight:700">${esc(r.subject)}</strong>` : ''}</span>
        ${r.note ? `<span style="font-size:10.5px;color:#6B6B72">${esc(r.note)}</span>` : ''}
      </span>
      <span style="font-size:10.5px;color:#6B6B72;white-space:nowrap;flex:none">${esc(when(r.at))}</span>
    </div>`;
  const pat = a.pattern;
  const who2 = `<select id="au-who" style="height:30px;border-radius:8px;background:#17171A;border:1px solid #26262B;padding:0 10px;font-size:11.5px;font-weight:600;color:#9A9CA3;outline:none">
      <option value="">Who: anyone</option>${t.people.map((p) => `<option value="${p.id}" ${p.id === who ? 'selected' : ''}>Who: ${esc(p.name)}</option>`).join('')}</select>`;
  const html = frame(`
    ${chips(KINDS.map(([l, k]) => [l, link(k, who), k === kind, k === 'refused' && a.refused ? a.refused : null]), who2)}
    <div style="flex:1;min-height:0;padding:18px 24px;box-sizing:border-box;overflow:auto;display:flex;flex-direction:column;gap:10px">
      ${a.rows.length ? a.rows.map(row).join('') : `<div style="padding:30px 16px;text-align:center;font-size:12px;color:#6B6B72">${kind || who ? 'Nothing on record for this filter in the last 30 days.' : 'Nothing on record in the last 30 days.'}</div>`}
      ${pat && me.role === 'head' ? `<div style="display:flex;align-items:center;gap:12px;background:rgba(232,161,0,.06);border:1px solid rgba(232,161,0,.25);border-radius:12px;padding:14px 16px;margin-top:4px">
        <span style="flex:1;font-size:12px;line-height:1.5;color:#C9CAD0">${esc(first(pat.who))} has asked to ${esc(pat.label[0].toLowerCase() + pat.label.slice(1))} ${pat.asked} times this month and been refused ${pat.refused}. Either the limit is wrong or ${esc(first(pat.who))} needs ten minutes of your time.</span>
        <a href="${link('refused', pat.staff_id)}" style="font-size:11.5px;font-weight:700;white-space:nowrap">See all ${pat.asked}</a></div>` : ''}
    </div>`, 'Audit log', `Last 30 days · ${a.rows.length.toLocaleString('fr-FR').replace(/ /g, ' ')} entr${a.rows.length === 1 ? 'y' : 'ies'}`,
    btnS('Export CSV', 'id="au-csv"'));
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#au-who').onchange = (e) => go(link(kind, e.target.value));
      root.querySelector('#au-csv').onclick = () => {
        csv('audit', [['when', (r) => r.at], ['who', (r) => r.who], ['what', (r) => r.what], ['subject', (r) => r.subject], ['note', (r) => r.note]], a.rows);
        toast('Downloaded');
      };
    },
  };
}
