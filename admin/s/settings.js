// /settings — Rules (SET-01), Deposits (SET-11…13, 0077), Reliability (HOP-01, 0066),
// Pricing (SET-17, read-only), Team & roles (SET-02), Permissions (SET-03), the Audit log
// (SET-04) and Districts (SET-06). Message templates are not on the website yet (nothing
// stores them). "Take" (SET-14…16) is not built: the billing rail (0123) already decided
// what Sterncut takes.
import { esc, num, DH, first, initials, dayShort, hhmm, ROLE_LABEL } from '/app.js';
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
  if (!page) return rules(ctx);
  if (page === 'reliability') return reliability(ctx);
  if (page === 'deposit-bounds') return bounds(ctx);
  if (page === 'team') return team(ctx);
  if (page === 'permissions') return permissions(ctx);
  if (page === 'audit') return audit(ctx);
  if (page === 'districts') return districts(ctx);
  if (page === 'pricing') return pricing(ctx);
  if (page === 'templates') {
    const t = TABS.find(([, h]) => h === '/settings/' + page)[0];
    return { top: false, html: frame(`<div style="padding:26px 24px;max-width:640px;display:flex;flex-direction:column;gap:10px">
      <span style="font-size:9.5px;letter-spacing:.14em;font-weight:700;border-radius:999px;padding:4px 9px;color:#E8A100;background:rgba(232,161,0,.12);align-self:flex-start">NOT BUILT YET</span>
      <span style="font-size:13px;line-height:1.6;color:#9A9CA3">${esc(t)} isn’t on the website yet: nothing stores the product’s messages as templates — each one is written where it is sent.</span></div>`, t, '') };
  }
  throw new Error('not_found');
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

// ---------------------------------------------------------------- SET-06 --
// A district is what people call the place: the name on salons.district, nothing more.
// So a district exists once a shop is in it, and renaming one renames it on every shop
// (0060's admin_set_district, through the gate). "Add a district" with no shop in it —
// the drawn Malabata row — needs a list of districts that doesn't exist yet.
const dslug = (d) => String(d || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unassigned';
async function districts({ rest, rpc, act, q, go, toast, dialog, closeDialog }) {
  const [salons, dem] = await Promise.all([rest('salons?select=id,name,status,district'), rpc('admin_demand', { p_days: 30 }).catch(() => ({ districts: [] }))]);
  const ask = Object.fromEntries(dem.districts.map((x) => [x.district, x]));
  const names = [...new Set([...salons.map((s) => s.district || 'Unassigned'), ...dem.districts.map((x) => x.district)])];
  const rows = names.map((n) => {
    const here = salons.filter((s) => (s.district || 'Unassigned') === n);
    return { n, live: here.filter((s) => s.status === 'live').length, other: here.filter((s) => s.status !== 'live').length, shops: here, a: ask[n] };
  }).sort((a, b) => (a.n === 'Unassigned') - (b.n === 'Unassigned') || b.live - a.live || a.n.localeCompare(b.n));
  const named = rows.filter((r) => r.n !== 'Unassigned').length;
  const gap = rows.filter((r) => r.a && r.n !== 'Unassigned').sort((a, b) => b.a.unmet - a.a.unmet)[0];
  const row = (r) => `<div style="display:grid;grid-template-columns:1.6fr 90px 110px 110px 150px;gap:12px;align-items:center;padding:13px 18px;border-bottom:1px solid #1E1E22">
    <a href="/demand/tangier/${dslug(r.n)}" style="color:#fff;min-width:0"><span style="display:block;font-size:13px;font-weight:700">${esc(r.n)}</span><span style="display:block;font-size:11px;color:#6B6B72;margin-top:2px">${r.n === 'Unassigned' ? 'Shops nobody has placed yet' : r.live ? `${r.live} live${r.other ? ` · ${r.other} not live` : ''}` : r.other ? `${r.other} waiting to go live` : 'No shop yet'}</span></a>
    <span class="num" style="font-size:12.5px;font-weight:700">${r.live}</span>
    <span class="num" style="font-size:12.5px">${r.a ? r.a.asks : 0}</span>
    <span class="num" style="font-size:12.5px;color:${r.a?.unmet ? '#E8A100' : '#6B6B72'}">${r.a ? r.a.unmet : 0}</span>
    <span style="text-align:right">${r.n === 'Unassigned' ? '<a href="/demand/tangier/unassigned" style="font-size:10px;font-weight:800;letter-spacing:.06em;background:#212125;border-radius:7px;padding:7px 10px;color:#fff">PLACE THEM</a>'
      : r.shops.length ? `<a href="/settings/districts?rename=${encodeURIComponent(r.n)}" style="font-size:10px;font-weight:800;letter-spacing:.06em;background:#212125;border-radius:7px;padding:7px 10px;color:#fff">RENAME</a>` : ''}</span></div>`;
  const note = (b, t) => `<div style="flex:1 1 300px;background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 15px;font-size:11.5px;color:#9A9CA3;line-height:1.6"><b style="color:#fff">${b}</b> ${t}</div>`;
  const html = frame(`<div style="flex:1;overflow:auto;padding:20px 24px 32px;display:flex;flex-direction:column;gap:14px;max-width:1000px">
    ${gap && gap.a.unmet ? `<div style="background:#17171A;border:1px solid rgba(232,161,0,.35);border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#E8A100">WORST GAP</span><span style="flex:1;min-width:220px;font-size:12.5px"><b>${esc(gap.n)}</b> <span style="color:#9A9CA3">· ${gap.a.unmet} unmet ask${gap.a.unmet === 1 ? '' : 's'} this month with ${gap.live} live shop${gap.live === 1 ? '' : 's'}</span></span><a href="/demand/tangier/${dslug(gap.n)}" style="font-size:11px;font-weight:700">Open it in Demand</a></div>` : ''}
    <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
      <div style="display:grid;grid-template-columns:1.6fr 90px 110px 110px 150px;gap:12px;padding:11px 18px;border-bottom:1px solid #1E1E22;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:620px"><span>DISTRICT</span><span>LIVE SHOPS</span><span>ASKED · 30D</span><span>UNMET</span><span></span></div>
      <div style="min-width:620px">${rows.map(row).join('') || '<div style="padding:22px 18px;font-size:12px;color:#6B6B72">No shop has a district yet.</div>'}</div></div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      ${note('Names, not polygons.', 'A district is what people call the place, not what the census calls it — the name each shop carries. Renaming one renames it on every shop in it; renaming it to a name that already exists merges the two.')}
      ${note('A district with no shop can’t be added yet.', 'Districts live on shops, so one exists once a shop is in it. Holding an empty one open for searches — the drawn Malabata row — needs a list of districts of its own.')}</div>
  </div>`, 'Districts', `Tangier · ${named} district${named === 1 ? '' : 's'}`);
  return {
    top: false, html,
    ready() {
      const r = rows.find((x) => x.n === q.get('rename'));
      if (!r || !r.shops.length || r.n === 'Unassigned') return;
      const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:13px">
        <span style="font-size:17px;font-weight:800">Rename ${esc(r.n)}</span>
        <span style="font-size:12px;color:#9A9CA3;line-height:1.55">${r.shops.length === 1 ? 'One shop carries' : `${r.shops.length} shops carry`} this name: ${r.shops.map((s) => esc(s.name)).join(', ')}. Customers pick from these names, so use the one people actually say.</span>
        <input id="dr-name" list="dr-known" value="${esc(r.n)}" style="height:42px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:13px;outline:none">
        <datalist id="dr-known">${names.filter((n) => n !== 'Unassigned' && n !== r.n).map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>
        <div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('RENAME IT', 'id="dr-go"')}</div></div>`, { onClose: () => go('/settings/districts'), width: 460 });
      d.querySelector('#dr-go').onclick = async () => {
        const v = d.querySelector('#dr-name').value.trim(), err = d.querySelector('.dlg-err');
        if (!v || v === r.n) { err.textContent = 'Type the new name.'; err.style.display = 'block'; return; }
        try {
          for (const s of r.shops) await act('admin_set_district', { p_salon: s.id, p_district: v }, { title: `Move ${s.name} from ${r.n} to ${v}` });
          closeDialog(); toast(`${r.n} is now ${v}${names.includes(v) ? ' · merged' : ''}`);
        } catch (e) { if (!e.handled) { err.textContent = e.message; err.style.display = 'block'; } }
      };
    },
  };
}

// ---------------------------------------------------------------- SET-17 --
// What Sterncut actually bills (0123), read-only. The drawing prices 40 DH a barber + 1 DH a
// cut with free months; what is built is one list price per chair, snapshotted onto each
// subscription. Changing a price isn't offered: platform_settings has no audited setter, and
// a raw write from here would skip both the gate and the audit log.
async function pricing({ rest, rpc }) {
  const [ps, subs, live, open] = await Promise.all([
    rest('platform_settings?select=sub_monthly_cents,sub_yearly_cents,sub_chair_cap,sub_sms_included,sub_sms_unit_cents&limit=1'),
    rest('subscriptions?select=salon_id,cycle,unit_price_cents,started_on'), rest('salons?select=id&status=eq.live'), rpc('admin_subscription_ledger').catch(() => [])]);
  const p = ps[0] || {};
  const dh = (c) => (c == null ? '—' : String(Math.round(c / 100)));
  const today = new Date().toISOString().slice(0, 10);
  const yearly = subs.filter((x) => x.cycle === 'yearly').length, starting = subs.filter((x) => x.started_on > today).length;
  const stale = subs.filter((x) => x.cycle === 'monthly' && x.unit_price_cents !== p.sub_monthly_cents).length;
  const bal = open.reduce((n, r) => n + r.balance_cents, 0);
  const price = (l, v, unit, sub) => `<div style="flex:1 1 170px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:15px 16px;display:flex;flex-direction:column;gap:6px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span><span class="num" style="font-family:'Playfair Display',serif;font-weight:700;font-size:30px">${v}</span> <span style="font-size:12px;color:#9A9CA3">${unit}</span></span><span style="font-size:10.5px;color:#6B6B72;line-height:1.45">${sub}</span></div>`;
  const stat = (l, v, s) => `<div style="flex:1 1 170px;display:flex;flex-direction:column;gap:4px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:20px;font-weight:800">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
  const note = (b, t) => `<div style="flex:1 1 300px;background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 15px;font-size:11.5px;color:#9A9CA3;line-height:1.6"><b style="color:#fff">${b}</b> ${t}</div>`;
  const html = frame(`<div style="flex:1;overflow:auto;padding:20px 24px 32px;display:flex;flex-direction:column;gap:14px;max-width:1000px">
    ${label9('WHAT A NEW SUBSCRIPTION IS CHARGED')}
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      ${price('PER CHAIR, PER MONTH', dh(p.sub_monthly_cents), 'DH', 'A chair with a bookable barber on it, not an empty one')}
      ${price('PAID FOR A YEAR', dh(p.sub_yearly_cents), 'DH a chair a month', 'The same chairs, billed for twelve months at once')}
      ${price('CHAIRS BILLED', `up to ${p.sub_chair_cap ?? '—'}`, 'a shop', 'The owner first, then by the order they joined. Past that, free')}
      ${price('TEXT MESSAGES', p.sub_sms_included ?? '—', 'a month included', p.sub_sms_unit_cents ? `then ${dh(p.sub_sms_unit_cents)} DH each` : 'Nothing is charged past that until the SMS rate is confirmed')}</div>
    <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;gap:14px;flex-wrap:wrap">
      ${stat('SHOPS ON A SUBSCRIPTION', `${subs.length} of ${live.length}`, `${yearly} paying yearly${starting ? ` · ${starting} not started yet` : ''}`)}
      ${stat('ON AN OLDER PRICE', stale, 'monthly subscriptions that started on a different list price')}
      ${stat('OPEN INVOICES', open.length, bal ? `${Math.round(bal / 100)} DH still to reach us` : 'nothing open')}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap">
      ${note('A price here reprices nobody.', 'Each subscription keeps the price it started on; these numbers are for the next shop that starts. It reaches us by netting off the deposits we already hold for the shop, on the Friday statement.')}
      ${note('Not editable here yet.', 'There is no audited setter for the list price, and a direct write would skip the permission check and the audit log. Billing itself runs from <a href="/finance/charges" style="font-weight:700">Finance · Charges</a>.')}</div>
  </div>`, 'Pricing', 'What Sterncut charges a shop');
  return { top: false, html };
}

// ---------------------------------------------------------------- SET-01 --
// Rules: every dial the platform keeps, what it is now, where it is changed, and the last
// changes (settings_changes — each setter writes its before and after there). Only the
// deposit bounds, the reliability numbers and the write-off alert have a page that changes
// them; the others are shown with the line that says so — a dial with no audited setter is
// not offered as editable.
const DIAL = {
  late_after_min: ['Late after', (v) => `${v} min`], mark_days: ['A mark lasts', (v) => `${v} days`],
  clear_after_clean: ['Clean visits that clear a mark', (v) => (v == null ? 'off' : String(v))],
  floor: ['Deposit floor', (v) => `${v}%`], ceiling: ['Deposit ceiling', (v) => `${v}%`],
  writeoff_alert_cents: ['Write-off alert', (v) => (v == null ? 'off' : `${Math.round(v / 100)} DH`)],
  billing: ['Billing', (v) => String(v)],
};
const changeText = (c) => Object.keys(c.after || {}).filter((k) => DIAL[k] && JSON.stringify((c.before || {})[k]) !== JSON.stringify(c.after[k]))
  .map((k) => `${DIAL[k][0]} ${DIAL[k][1]((c.before || {})[k])} → ${DIAL[k][1](c.after[k])}`).join(' · ');
const box = (inner) => `<div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:11px">${inner}</div>`;
const fact = (label, value, sub) => `<div style="display:flex;align-items:baseline;gap:12px"><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${label}</span>${sub ? `<span style="display:block;font-size:10.5px;color:#6B6B72;margin-top:2px">${sub}</span>` : ''}</span><span class="num" style="font-size:15px;font-weight:800">${value}</span></div>`;
const goLink = (href, label) => `<a href="${href}" style="align-self:flex-start;font-size:11px;font-weight:700">${label} →</a>`;

async function rules({ rest }) {
  const [ps, changes] = await Promise.all([rest('platform_settings?select=*&limit=1'), rest('settings_changes?select=changed_by,changed_at,before,after,note&order=changed_at.desc&limit=8')]);
  const p = ps[0] || {};
  const ids = [...new Set(changes.map((c) => c.changed_by).filter(Boolean))];
  const people = ids.length ? Object.fromEntries((await rest(`profiles?select=id,full_name&id=in.(${ids.join(',')})`).catch(() => [])).map((x) => [x.id, x.full_name])) : {};
  const cancel = p.free_cancel_min == null ? '—' : p.free_cancel_min % 60 ? `${p.free_cancel_min} min` : `${p.free_cancel_min / 60} h`;
  const html = frame(`<div style="flex:1;overflow:auto;padding:20px 24px 32px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:3 1 520px;min-width:0;display:flex;flex-direction:column;gap:14px">
      ${box(`<div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:13px;font-weight:700">Deposits</span><span style="font-size:11px;color:#6B6B72">applies at checkout on every phone</span></div>
        ${fact('Floor', `${p.deposit_floor_pct}%`, 'The least a shop may ask up front')}${fact('Ceiling', `${p.deposit_ceiling_pct}%`, 'The most a shop may ask')}
        ${fact('Free cancel window', cancel, 'The deposit comes back in full before this. No screen changes it yet.')}
        ${goLink('/settings/deposit-bounds', 'Change the bounds — every shop’s position shown first')}`)}
      ${box(`<div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:13px;font-weight:700">Reliability</span><span style="font-size:11px;color:#6B6B72">Head of Ops only</span></div>
        ${fact('Late after', `${p.late_after_min} min`, 'Past the booked slot, a customer gets a mark')}${fact('A mark lasts', `${p.mark_days} days`, 'While it does, their deposit is locked at 100%')}
        ${fact('Clean visits that clear it', p.clear_after_clean == null ? 'off' : p.clear_after_clean, 'On time this many times, and the mark goes early')}
        ${goLink('/settings/reliability', 'Tune them — dry-run against the last 90 days first')}`)}
      ${box(`<span style="font-size:13px;font-weight:700">Cash</span>
        ${fact('An agent’s bag', DH(p.agent_bag_cap_cents), 'The most an agent carries before dropping at the office')}
        ${fact('Unchecked cash an agent may hold', `${DH(p.agent_unchecked_cents)} · ${p.agent_unchecked_max} receipts`, 'At either, the app won’t open another collection until the queue syncs')}
        ${fact('Days a shop may hold our float', p.float_hold_days, 'After this, a remainder carries onto the week being cut')}
        ${fact('Monthly write-off alert', p.writeoff_alert_cents == null ? 'off' : DH(p.writeoff_alert_cents), 'It never refuses a write-off; it turns the month red')}
        <span style="font-size:10.5px;color:#6B6B72">No screen changes the first three yet. ${goLink('/finance/float?alert=1', 'Change the alert')}</span>`)}
      ${box(`<span style="font-size:13px;font-weight:700">Pricing</span>
        ${fact('A chair, a month', DH(p.sub_monthly_cents), `${DH(p.sub_yearly_cents)} a month on a year · up to ${p.sub_chair_cap} chairs`)}
        ${goLink('/settings/pricing', 'What a new subscription is charged')}`)}
    </div>
    <div style="flex:2 1 300px;min-width:0;display:flex;flex-direction:column;gap:12px">
      ${box(`${label9('LAST CHANGED', '#6B6B72')}${changes.map((c, i) => `<div style="display:flex;gap:10px;align-items:flex-start;${i ? 'border-top:1px solid #1E1E22;padding-top:10px' : ''}">
          ${avatar(initials(people[c.changed_by] || 'Ops'), i ? '#212125' : '#E8442E', 26)}
          <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="font-size:12px;font-weight:600">${esc(changeText(c) || c.note || 'A platform setting')}</span>
            <span style="font-size:10.5px;color:#6B6B72">${esc(first(people[c.changed_by] || 'Ops'))} · ${esc(dayShort(c.changed_at))}, ${hhmm(c.changed_at)}</span>
            ${c.note && changeText(c) ? `<span style="font-size:10.5px;line-height:1.45;color:#9A9CA3">“${esc(c.note)}”</span>` : ''}</span></div>`).join('') || '<span style="font-size:11.5px;color:#6B6B72">Nothing has been changed since launch.</span>'}
        ${goLink('/settings/audit', 'Full audit log')}`)}
      <div style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:13px 15px;display:flex;flex-direction:column;gap:6px"><span style="font-size:12px;font-weight:700">Nothing here is a draft</span><span style="font-size:11.5px;color:#9A9CA3;line-height:1.55">Every dial writes to live shops the moment it is saved — there is no staging Sterncut. Everything not on this page belongs to the shop.</span></div>
    </div></div>`, 'Settings', 'Changes here affect every shop and every phone');
  return { top: false, html };
}

// ---------------------------------------------------------------- HOP-01 --
// 0046's 15 minutes and 90 days were guesses nobody tuned, so every figure here is counted
// against the last 90 days of real arrivals (admin_reliability_dryrun) and the page claims
// no saving it hasn't measured. Saving is the Head of Ops' alone (platform_rule).
async function reliability({ rest, rpc, act, toast, go }) {
  const saved = (await rest('platform_settings?select=late_after_min,mark_days,clear_after_clean&limit=1'))[0] || { late_after_min: 15, mark_days: 90, clear_after_clean: null };
  const draft = { ...saved };
  const html = frame('<div id="rb" style="flex:1;overflow:auto;padding:20px 24px 32px"><span style="font-size:12px;color:#6B6B72">Counting the last 90 days…</span></div>', 'Reliability',
    'Dry-run against the last 90 days before anything goes live', `<span style="display:flex;gap:10px;align-items:center">${btnS('Discard', 'id="rb-discard"')}${btnP('Save &amp; apply', 'id="rb-apply"')}</span>`);
  return {
    top: false, html,
    ready(root) {
      const body = root.querySelector('#rb');
      const dirty = () => ['late_after_min', 'mark_days', 'clear_after_clean'].some((k) => draft[k] !== saved[k]);
      const pick = (on) => `cursor:pointer;border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:4px;border:1px solid ${on ? '#E8442E' : '#1E1E22'};background:${on ? 'rgba(232,68,46,.12)' : '#17171A'}`;
      const stat = (l, v, s, tone) => `<div style="flex:1 1 140px;background:#17171A;border:1px solid #1E1E22;border-radius:12px;padding:12px 13px;display:flex;flex-direction:column;gap:4px"><span style="font-size:9px;letter-spacing:.12em;font-weight:700;color:#6B6B72">${l}</span><span class="num" style="font-size:20px;font-weight:700;color:${tone || '#fff'}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${s}</span></div>`;
      const row = (k, v, tone) => `<div style="display:flex;align-items:center;padding:9px 0;border-bottom:1px solid #1E1E22"><span style="flex:1;font-size:11.5px;color:#9A9CA3">${k}</span><span class="num" style="font-size:12.5px;font-weight:700;color:${tone || '#fff'}">${v}</span></div>`;
      let seq = 0;
      const draw = async () => {
        const n = ++seq;
        const d = await rpc('admin_reliability_dryrun', { p_late_min: draft.late_after_min, p_mark_days: draft.mark_days, p_clean: draft.clear_after_clean });
        if (n !== seq) return;   // a newer click is already counting
        const pct = (a, b) => (b ? `${(a * 100 / b).toFixed(1)}%` : '0%');
        const delta = d.marks_at - d.marks_now, freed = Math.max(0, d.carrying - d.carrying_after);
        const dispPct = d.marks_total ? Math.round(d.disputed * 100 / d.marks_total) : 0;
        body.innerHTML = `<div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
          <div style="flex:3 1 520px;min-width:0;display:flex;flex-direction:column;gap:14px">
            <span style="font-size:12.5px;color:#9A9CA3;line-height:1.55">These numbers were guesses at launch and nobody has tuned them. Every change is dry-run against the last 90 days before it goes live.</span>
            <div style="background:#111113;border:1px solid #1E1E22;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:14px">
              ${label9('WHEN IS SOMEONE LATE', '#6B6B72')}
              <div style="display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap"><span><span class="num" style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:34px;line-height:1">${draft.late_after_min} min</span><span style="display:block;font-size:11px;color:#9A9CA3;margin-top:5px">past the booked slot</span></span>
                <span style="flex:1;display:flex;gap:8px;justify-content:flex-end">${[5, 15, 20, 35].map((m) => `<span data-late="${m}" style="cursor:pointer;min-width:44px;text-align:center;padding:7px 10px;border-radius:8px;font-size:12px;font-weight:700;${draft.late_after_min === m ? 'background:#E8442E;color:#fff' : 'background:#212125;color:#9A9CA3'}">${m}</span>`).join('')}</span></div>
              <div style="display:flex;gap:11px;flex-wrap:wrap;border-top:1px solid #1E1E22;padding-top:15px">${stat(`MARKS AT ${saved.late_after_min} MIN`, num(d.marks_now), `${pct(d.marks_now, d.visits)} of visits`)}
                ${stat(`AT ${draft.late_after_min} MIN`, num(d.marks_at), delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${num(Math.abs(delta))} people`, delta === 0 ? null : delta > 0 ? '#E8A100' : '#4ADE80')}
                ${stat('DISPUTED', num(d.disputed), `${pct(d.disputed, d.marks_total)} of marks`)}</div>
              <span style="font-size:11.5px;line-height:1.5;color:#9A9CA3">${dispPct >= 10 && d.poster_tasks > 0 ? `A ${dispPct}% dispute rate is high. ${d.poster_tasks} shops have a review-poster task open, which may be the real cause rather than the threshold.` : `Dispute rate is ${dispPct}% of the marks raised in the last 90 days.`}</span></div>
            <div style="background:#111113;border:1px solid #1E1E22;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px">
              ${label9('HOW LONG A MARK LASTS', '#6B6B72')}
              <div style="display:flex;gap:10px;flex-wrap:wrap">${[[90, saved.mark_days === 90 ? `Current · ${num(d.carrying)} carrying one` : 'The launch guess'], [60, `Would clear ${num(freed)} tonight`], [30, 'Aggressive']]
                .map(([v, s]) => `<div data-days="${v}" style="flex:1 1 140px;${pick(draft.mark_days === v)}"><span style="font-size:13px;font-weight:700">${v} days</span><span style="font-size:10.5px;color:#9A9CA3">${draft.mark_days === v && v !== 90 ? `Would clear ${num(freed)} tonight` : s}</span></div>`).join('')}</div>
              <div style="display:flex;align-items:center;gap:12px;background:#17171A;border-radius:12px;padding:12px 13px"><span style="flex:1;min-width:0"><span style="display:block;font-size:12.5px;font-weight:700">Clear it after ${draft.clear_after_clean || 3} visits on time as well</span><span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px">What the customer app (39b) promises · currently ${draft.clear_after_clean ? 'on' : 'off'}</span></span>
                <span data-clean="${draft.clear_after_clean ? 'off' : '3'}" style="cursor:pointer;width:42px;height:24px;border-radius:999px;background:${draft.clear_after_clean ? '#4ADE80' : '#3A3A40'};display:flex;align-items:center;justify-content:${draft.clear_after_clean ? 'flex-end' : 'flex-start'};padding:0 3px;flex:none;box-sizing:border-box"><span style="width:18px;height:18px;border-radius:999px;background:#0D0D0F"></span></span></div></div>
            <div style="background:#111113;border:1px solid #1E1E22;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:9px">
              ${label9('WHAT A MARK ACTUALLY DOES', '#6B6B72')}
              ${[['Deposit locked at 100%', 'live since launch', '#4ADE80'], ['Barbers can refuse the booking outright', 'NOT BUILT', '#6B6B72'], ['Reliable clients get first refusal on freed slots', 'NOT BUILT', '#6B6B72']]
                .map(([t, s, c]) => `<div style="display:flex;align-items:center;gap:10px;font-size:12px"><span style="flex:1">${t}</span><span style="font-size:9.5px;letter-spacing:.1em;font-weight:800;color:${c}">${s.toUpperCase()}</span></div>`).join('')}</div>
          </div>
          <div style="flex:2 1 300px;min-width:0;background:#17171A;border:1px solid #1E1E22;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:12px">
            ${label9('DRY RUN · LAST 90 DAYS', '#6B6B72')}
            <span style="font-size:13px;font-weight:700">${dirty() ? 'If you save this' : 'As it stands'}</span>
            <span style="font-size:12px;color:#9A9CA3">Late at ${draft.late_after_min} min, a mark clears after ${draft.clear_after_clean ? `${draft.clear_after_clean} clean visits or ` : ''}${draft.mark_days} days.</span>
            <div>${row('Marked today', `${num(d.carrying)} → ${num(d.carrying_after)}`)}${row('Cleared tonight', `${num(freed)} people`, '#4ADE80')}${row('Marks at the new threshold', `${delta >= 0 ? '+' : '−'}${num(Math.abs(delta))}`, delta > 0 ? '#E8A100' : '#4ADE80')}</div>
            ${label9('WHO GETS TOLD', '#6B6B72')}
            <div>${row(`${num(freed)} customers`, '“your mark has gone”')}${row('Logged against', 'you')}</div>
            <span id="rb-save" style="height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;letter-spacing:.04em;${dirty() ? 'cursor:pointer;background:#E8442E;color:#fff' : 'background:#212125;color:#6B6B72'}">${dirty() ? 'SAVE &amp; APPLY TONIGHT' : 'NOTHING TO SAVE'}</span>
            <span style="font-size:10.5px;color:#6B6B72">Every change is logged with who made it. Only the Head of Ops can save.</span>
          </div></div>`;
        root.querySelector('#rb-apply').style.opacity = dirty() ? '1' : '.45';
        root.querySelector('#rb-discard').style.opacity = dirty() ? '1' : '.45';
      };
      const save = async () => {
        if (!dirty()) return;
        try {
          await act('admin_save_reliability', { p_late_min: draft.late_after_min, p_mark_days: draft.mark_days, p_clean: draft.clear_after_clean, p_note: null }, { title: `Reliability: late at ${draft.late_after_min} min, marks last ${draft.mark_days} days` });
          toast('Applied. Everyone affected has been told.'); go('/settings/reliability', { replace: true });
        } catch (e) { if (!e.handled) toast(e.message, false); }
      };
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-late],[data-days],[data-clean],#rb-save,#rb-apply,#rb-discard');
        if (!t) return;
        if (t.dataset.late) draft.late_after_min = Number(t.dataset.late);
        else if (t.dataset.days) draft.mark_days = Number(t.dataset.days);
        else if (t.dataset.clean) draft.clear_after_clean = t.dataset.clean === 'off' ? null : Number(t.dataset.clean);
        else if (t.id === 'rb-discard') Object.assign(draft, saved);
        else return save();
        draw().catch((err) => toast(err.message, false));
      });
      draw().catch((err) => { body.innerHTML = `<span style="font-size:12px;color:#F87171">${esc(err.message)}</span>`; });
    },
  };
}

// ---------------------------------------------------------- SET-11/12/13 --
// The deposit floor and ceiling (0077). Checked when an owner saves, never applied back:
// a shop's percentage is versioned, so moving these can't reach a booking already taken.
// `?edit=1` is SET-12/13's dialog — the impact is counted before the save, and a reason is
// required exactly when the server requires one (either bound narrowing).
const SAMPLE = 6000;   // the drawn reference cut: every bound prices itself against one service
const pctDh = (cents, pct) => Math.ceil((cents * pct) / 100) / 100;
function bandTrack(floor, ceiling, shops) {
  const hatch = 'repeating-linear-gradient(135deg,#26262B 0 4px,#1A1A1D 4px 8px)';
  // a tick per percentage a live shop actually sits on, so the band reads against the network
  const marks = [...new Set((shops || []).filter((s) => s.pct > 0).map((s) => s.pct))].sort((a, b) => a - b).slice(0, 6);
  return `<span style="position:absolute;left:0;top:0;bottom:0;width:${floor}%;border-radius:4px 0 0 4px;background:${hatch}"></span>
    <span style="position:absolute;left:${ceiling}%;right:0;top:0;bottom:0;border-radius:0 4px 4px 0;background:${hatch}"></span>
    <span style="position:absolute;left:${floor}%;width:${ceiling - floor}%;top:0;bottom:0;background:#E8442E"></span>
    ${[floor, ceiling].map((x) => `<span style="position:absolute;left:${x}%;top:-7px;bottom:-7px;width:3px;background:#fff;border-radius:2px;margin-left:-1px"></span><span class="num" style="position:absolute;left:${x}%;top:-26px;transform:translateX(-50%);font-size:10.5px;font-weight:700">${x}%</span>`).join('')}
    ${marks.map((x) => `<span style="position:absolute;left:${x}%;top:12px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px"><span style="width:1px;height:6px;background:#3A3A40"></span><span class="num" style="font-size:9.5px;color:#6B6B72">${x}%</span></span>`).join('')}`;
}

async function bounds({ rpc, act, q, go, toast, dialog, closeDialog }) {
  const d = await rpc('admin_deposit_bounds');
  const card = (label, value, sub) => `<div style="flex:1 1 200px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:6px">${label9(label, '#9A9CA3')}<span><span class="num" style="font-family:'Playfair Display',serif;font-weight:700;font-size:34px">${value}</span><span style="font-size:14px;color:#9A9CA3"> %</span></span><span style="font-size:11px;color:#9A9CA3;line-height:1.5">${sub}</span></div>`;
  const byPct = {};
  (d.shops || []).forEach((s) => { byPct[s.pct] = (byPct[s.pct] || 0) + 1; });
  const cols = Object.keys(byPct).map(Number).sort((a, b) => a - b), top = Math.max(1, ...cols.map((x) => byPct[x]));
  const stat = (v, label, colour) => `<span style="flex:1 1 120px;display:flex;flex-direction:column;gap:3px"><span class="num" style="font-size:17px;font-weight:800${colour ? `;color:${colour}` : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3;line-height:1.4">${label}</span></span>`;
  const html = frame(`<div style="flex:1;overflow:auto;padding:20px 24px 32px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
    <div style="flex:3 1 560px;min-width:0;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-size:15px;font-weight:700">Deposit floor &amp; ceiling</span><span style="font-size:9.5px;letter-spacing:.12em;font-weight:700;color:#9A9CA3">PLATFORM-WIDE</span><span style="font-size:11px;color:#6B6B72">Checked when an owner saves — never applied retroactively</span></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${card('FLOOR', d.floor_pct, `The least a shop may require · <span class="num">${pctDh(SAMPLE, d.floor_pct)} DH</span> on a 60 DH skin fade`)}
        ${card('CEILING', d.ceiling_pct, `The most · <span class="num">${pctDh(SAMPLE, d.ceiling_pct)} DH</span> on the same cut, <span class="num">${pctDh(9000, d.ceiling_pct)} DH</span> on cut and beard`)}
        ${card('OR EXACTLY', 0, 'A shop may take no deposit at all. The bounds do not touch that choice.')}</div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:34px 18px 18px;display:flex;flex-direction:column;gap:30px">
        <div style="position:relative;height:10px;border-radius:4px">${bandTrack(d.floor_pct, d.ceiling_pct, d.shops)}</div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1;min-width:220px;font-size:11px;color:#9A9CA3;line-height:1.5">Owners choose anywhere in the coral band. A shop’s percentage is versioned with an effective date, so moving these numbers can never reach a booking already taken.</span>${btnP('CHANGE BOUNDS', 'data-go="/settings/deposit-bounds?edit=1"')}</div></div>
      ${box(`<div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:13px;font-weight:700">Where ${d.total} shop${d.total === 1 ? '' : 's'} actually sit${d.total === 1 ? 's' : ''}</span><span style="font-size:11px;color:#6B6B72">their own deposit percentage, today</span></div>
        <div style="display:flex;align-items:flex-end;gap:8px;min-height:110px">${cols.length ? cols.map((x) => { const zero = x === 0, c = zero ? '#9A9CA3' : '#D8D8DC'; return `<span style="flex:1;display:flex;flex-direction:column;align-items:center;gap:7px"><span class="num" style="font-size:12px;font-weight:700;color:${c}">${byPct[x]}</span><span style="width:100%;max-width:38px;height:${Math.max(6, Math.round((byPct[x] / top) * 75))}px;border-radius:5px 5px 0 0;background:${zero ? 'repeating-linear-gradient(135deg,#3A3A40 0 4px,#2A2A2F 4px 8px)' : '#E8442E'}"></span><span class="num" style="font-size:10.5px;font-weight:700;color:${c}">${x}%</span></span>`; }).join('') : '<span style="font-size:11.5px;color:#6B6B72">No live shops yet.</span>'}</div>
        <div style="display:flex;gap:12px;flex-wrap:wrap">${stat(d.at_zero, 'at 0% — took the opt-out, no deposit at all', '#9A9CA3')}${stat(d.inside, `inside the band${d.median != null ? `, median <span class="num">${d.median}%</span>` : ''}`)}${stat(d.on_floor, 'sitting exactly on the floor')}${stat(d.on_ceiling, 'sitting exactly on the ceiling')}</div>`)}
    </div>
    <div style="flex:2 1 300px;min-width:0;display:flex;flex-direction:column;gap:12px">
      ${box(`<div style="display:flex;align-items:baseline;justify-content:space-between"><span style="font-size:13px;font-weight:700">Bound changes</span><span style="font-size:11px;color:#6B6B72">${d.changes_total === 1 ? '1 ever' : `${d.changes_total} ever`}</span></div>
        ${(d.changes || []).map((c, i) => { const both = c.floor_before !== c.floor_after && c.ceiling_before !== c.ceiling_after; return `<div style="display:flex;gap:10px;align-items:flex-start">${avatar(initials(c.who), i ? '#212125' : '#E8442E', 26)}<span style="flex:1;display:flex;flex-direction:column;gap:3px"><span style="font-size:11.5px;line-height:1.4">${both ? `Band <b class="num">${c.floor_after}% – ${c.ceiling_after}%</b>` : c.floor_before !== c.floor_after ? `Floor <b class="num">${c.floor_before}% → ${c.floor_after}%</b>` : `Ceiling <b class="num">${c.ceiling_before}% → ${c.ceiling_after}%</b>`}</span>
          <span style="font-size:10px;color:#6B6B72">${esc(c.who)} · ${esc(dayShort(c.at))}, ${hhmm(c.at)} · ${c.outside} shop${c.outside === 1 ? '' : 's'} outside</span>${c.reason ? `<span style="font-size:10.5px;line-height:1.45;color:#9A9CA3">“${esc(c.reason)}”</span>` : ''}</span></div>`; }).join('') || '<span style="font-size:11px;color:#6B6B72">Never changed. The bounds are what 0076 shipped.</span>'}`)}
      ${box(`<span style="font-size:12px;font-weight:700">What the audit records</span>${['Who, to the second', 'Both numbers before and after, even if only one moved', 'How many shops were outside the new band at that moment', 'A reason — mandatory when either bound narrows, optional when it widens'].map((t) => `<span style="font-size:11.5px;color:#9A9CA3;line-height:1.45">✓ ${t}</span>`).join('')}
        <span style="font-size:11px;color:#6B6B72;line-height:1.5">Widening can only give owners more room, so it needs no defence. Narrowing takes a choice away from a shop that already made it, and that is the entry someone will read back in six months.</span>`)}
    </div></div>`, 'Settings', 'Changes here affect every shop and every phone');
  return {
    top: false, html,
    ready() {
      if (!q.get('edit')) return;
      const s = { floor: d.floor_pct, ceiling: d.ceiling_pct, notify: true, reason: '' };
      const dl = dialog('<div id="bd" style="padding:22px;display:flex;flex-direction:column;gap:14px"></div>', { onClose: () => go('/settings/deposit-bounds'), width: 600 });
      const el = dl.querySelector('#bd');
      let seq = 0, blocked = false;
      const dial = (which, value, was, red) => `<div style="flex:1 1 200px;background:#111113;border:1px solid ${red ? 'rgba(248,113,113,.45)' : '#26262B'};border-radius:11px;padding:13px 14px;display:flex;flex-direction:column;gap:9px">
        ${label9(which.toUpperCase(), red ? '#F87171' : '#9A9CA3')}
        <div style="display:flex;align-items:center;gap:10px"><span data-step="${which}:-5" style="cursor:pointer;width:30px;height:30px;flex:none;border-radius:8px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#9A9CA3">−</span>
          <span style="flex:1;text-align:center"><span class="num" style="font-size:26px;font-weight:800;color:${red ? '#F87171' : '#fff'}">${value}</span><span style="font-size:13px;color:#9A9CA3"> %</span></span>
          <span data-step="${which}:5" style="cursor:pointer;width:30px;height:30px;flex:none;border-radius:8px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700">+</span></div>
        <span class="num" style="font-size:10.5px;color:#6B6B72">was ${was}%</span></div>`;
      const draw = async () => {
        const n = ++seq;
        const imp = await rpc('admin_bounds_impact', { p_floor: s.floor, p_ceiling: s.ceiling });
        if (n !== seq) return;
        const narrowing = s.floor > d.floor_pct || s.ceiling < d.ceiling_pct;
        // SET-13's threshold: once most of the network is stranded the panel turns red
        const heavy = imp.outside > 0 && imp.outside >= Math.ceil((d.total - imp.at_zero) / 2);
        const tint = heavy ? '#F87171' : '#E8A100', bg = heavy ? 'rgba(248,113,113,.09)' : 'rgba(232,161,0,.08)', ln = heavy ? 'rgba(248,113,113,.4)' : 'rgba(232,161,0,.28)';
        const chip = (v, label, muted) => `<span style="flex:1 1 90px;background:${muted ? 'rgba(255,255,255,.04)' : heavy ? 'rgba(248,113,113,.1)' : 'rgba(232,161,0,.1)'};border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:2px"><span class="num" style="font-size:13px;font-weight:800;color:${muted ? '#9A9CA3' : tint}">${v}</span><span style="font-size:10px;color:${muted ? '#6B6B72' : heavy ? '#F0A9A9' : '#C79A3E'}">${label}</span></span>`;
        blocked = narrowing && !s.reason.trim();
        el.innerHTML = `<div><span style="display:block;font-size:17px;font-weight:800">Change deposit bounds</span><span style="display:block;font-size:12px;margin-top:4px;color:${heavy ? '#F87171' : '#9A9CA3'}">${heavy ? 'This band strands most of the network.' : !narrowing ? 'Widening. Every shop keeps what it has.'
            : s.floor > d.floor_pct && s.ceiling < d.ceiling_pct ? 'Both bounds narrowing.' : s.floor > d.floor_pct ? 'Raising the floor. Ceiling untouched.' : 'Lowering the ceiling. Floor untouched.'}</span></div>
          <div style="display:flex;gap:12px;flex-wrap:wrap">${dial('floor', s.floor, d.floor_pct, heavy)}${dial('ceiling', s.ceiling, d.ceiling_pct, heavy)}</div>
          ${imp.outside === 0 ? `<div style="background:rgba(74,222,128,.08);border:1px solid rgba(74,222,128,.28);border-radius:11px;padding:14px 15px;font-size:12px;font-weight:700;color:#4ADE80">No shop falls outside ${s.floor}% – ${s.ceiling}%</div>`
            : `<div style="background:${bg};border:1px solid ${ln};border-radius:11px;padding:14px 15px;display:flex;flex-direction:column;gap:11px">
              <span style="font-size:12.5px;font-weight:700;color:${tint}"><span class="num">${imp.outside}${heavy ? ` of ${d.total}` : ''}</span> shop${imp.outside === 1 ? '' : 's'} would sit outside <span class="num">${s.floor}% – ${s.ceiling}%</span></span>
              <div style="display:flex;gap:8px;flex-wrap:wrap">${(imp.buckets || []).map((b) => chip(b.n, `at ${b.pct}%`)).join('')}${chip(imp.at_zero, 'at 0% · unaffected', true)}${chip(imp.inside, 'already inside', true)}</div>
              ${(imp.named || []).length ? `<div style="display:flex;flex-direction:column;gap:7px;border-top:1px solid ${ln};padding-top:11px">${imp.named.map((x) => `<span style="display:flex;gap:8px;font-size:11.5px"><span style="flex:1;color:#D8D8DC">${esc(x.name)}</span><span class="num" style="font-weight:700;color:${tint}">${x.pct}% · outside</span></span>`).join('')}</div>` : ''}
              <span style="font-size:11.5px;line-height:1.55;color:${heavy ? '#F0A9A9' : '#C79A3E'}">Each of them keeps its own percentage until its owner next opens the deposit screen — nothing is clamped, and no booking already taken changes. At that edit, <span class="num">${s.floor}%</span> becomes their lowest option.</span></div>`}
          <div style="display:flex;flex-direction:column;gap:7px">${label9(narrowing ? `REASON · REQUIRED, ${s.floor > d.floor_pct && s.ceiling < d.ceiling_pct ? 'BOTH BOUNDS ARE' : 'THE BAND IS'} NARROWING` : 'REASON · OPTIONAL, THIS IS A WIDENING', narrowing ? (heavy ? '#F87171' : '#9A9CA3') : '#6B6B72')}
            <textarea id="bd-why" rows="2" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical">${esc(s.reason)}</textarea></div>
          ${imp.outside > 0 ? `<div style="display:flex;align-items:center;gap:12px"><span style="flex:1"><span style="display:block;font-size:12.5px;font-weight:700">Tell the ${imp.outside} owner${imp.outside === 1 ? '' : 's'} the range moved</span><span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px">They find out now, not the next time they try to save.</span></span>
            <span id="bd-notify" style="cursor:pointer;width:42px;height:24px;border-radius:999px;background:${s.notify ? '#E8442E' : '#3A3A40'};display:flex;align-items:center;justify-content:${s.notify ? 'flex-end' : 'flex-start'};padding:0 3px;flex:none;box-sizing:border-box"><span style="width:18px;height:18px;border-radius:999px;background:#0D0D0F"></span></span></div>` : ''}
          <span id="bd-log" style="font-size:11px;color:#6B6B72"></span>
          <div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('SAVE BOUNDS', 'id="bd-save"')}</div>`;
        const log = () => { blocked = narrowing && !s.reason.trim(); el.querySelector('#bd-log').innerHTML = blocked ? '<span style="color:#F87171;font-weight:700">A reason is required before this can be saved</span>' : `Will be logged as — floor ${d.floor_pct} → ${s.floor} · ceiling ${d.ceiling_pct} → ${s.ceiling} · ${imp.outside} outside`; el.querySelector('#bd-save').style.opacity = blocked ? '.45' : '1'; };
        el.querySelector('#bd-why').oninput = (e) => { s.reason = e.target.value; log(); };
        log();
      };
      el.addEventListener('click', async (e) => {
        const st = e.target.closest('[data-step]');
        if (st) {
          const [which, by] = st.dataset.step.split(':');
          const next = Math.min(100, Math.max(0, s[which] + Number(by)));
          if (which === 'floor') s.floor = Math.min(next, s.ceiling); else s.ceiling = Math.max(next, s.floor);
          return draw();
        }
        if (e.target.closest('#bd-notify')) { s.notify = !s.notify; return draw(); }
        if (!e.target.closest('#bd-save')) return;
        if (blocked) return toast('Narrowing needs a reason.', false);
        try {
          await act('admin_set_deposit_bounds', { p_floor: s.floor, p_ceiling: s.ceiling, p_reason: s.reason.trim() || null, p_notify: s.notify }, { title: `Deposit bounds ${s.floor}% – ${s.ceiling}%`, reason: s.reason.trim() });
          closeDialog(); toast(`Bounds are now ${s.floor}% – ${s.ceiling}%`);
        } catch (err) { if (!err.handled) toast(err.message, false); }
      });
      draw().catch((err) => { el.innerHTML = `<span style="font-size:12px;color:#F87171">${esc(err.message)}</span>`; });
    },
  };
}
