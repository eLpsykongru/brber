// /compliance[?scope=done], /compliance/tasks/<ref>
// CMP-01 (open follow-ups: 0058's admin_compliance) with BRB-06's task beside it —
// the same list, one task open in the side panel. Actions are 0061's admin_task_action
// (verify / remind / hide the shop / drop), through the gate like everything else.
// Not built (no backend): "give 7 more days" (nothing extends a due date), the full
// chase history (a task keeps only its last reminder), countersign / overrides / policy
// (HOP-02…08), calling the owner from here (the list carries no phone).
import { esc, initials, dayShort } from '/app.js';
import { pageHead, chips, label9, btnS, btnP } from '/s/ui.js';

const due = (t) => {
  if (!t.due_at) return ['No date', '#6B6B72'];
  if (t.status === 'done') return ['Done', '#4ADE80'];
  const d = t.days_left;
  if (d < 0) return [`${-d} day${d === -1 ? '' : 's'} late`, '#F87171'];
  if (d === 0) return ['Due today', '#E8A100'];
  return [`In ${d} day${d === 1 ? '' : 's'}`, d <= 2 ? '#E8A100' : '#9A9CA3'];
};
const history = (n) => (n === 0 ? 'first task' : `${n + 1}${['st', 'nd', 'rd'][n] || 'th'} missed task`);
// the one button a row gets: what a person would do next
const next = (t) => {
  if (t.status === 'done') return null;
  if (t.proof_at) return ['verify', 'VERIFY'];
  if (t.days_left < 0 && t.salon_status === 'live') return ['hide', 'HIDE SHOP'];
  return ['remind', 'REMIND'];
};
const CONFIRM = {
  verify: 'Mark this obligation sorted? The owner is told.',
  hide: 'Hide this shop from search now? Bookings it already has are untouched.',
};

export default async function (ctx) {
  const [a, ref] = ctx.seg;
  if (a && (a !== 'tasks' || !ref)) throw new Error('not_found');
  const { rpc, act, q, go, toast, dialog, closeDialog } = ctx;
  const scope = q.get('scope') === 'done' ? 'done' : 'open';
  let d = await rpc('admin_compliance', { p_scope: scope });
  let sel = ref ? d.rows.find((t) => t.ref === ref) : null;
  if (ref && !sel) {   // a link to a closed task from the open list, or the other way round
    const other = await rpc('admin_compliance', { p_scope: scope === 'done' ? 'open' : 'done' });
    sel = other.rows.find((t) => t.ref === ref);
    if (!sel) throw new Error('not_found');
  }
  const s = d.stats;
  const qs = scope === 'done' ? '?scope=done' : '';
  const kpi = (l, v, sub, col) => `<div style="flex:1 1 150px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:13px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:20px;font-weight:700${col ? ';color:' + col : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${sub}</span></div>`;
  const row = (t) => {
    const [dl, dc] = due(t), nx = next(t), on = sel && t.id === sel.id;
    return `<a href="/compliance/tasks/${esc(t.ref)}${qs}" class="hov" style="display:grid;grid-template-columns:1.3fr 2fr 90px 110px 96px;gap:12px;align-items:center;padding:13px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;${on ? 'background:#212125' : ''}">
      <span style="display:flex;align-items:center;gap:10px;min-width:0"><span style="width:28px;height:28px;border-radius:8px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(t.salon || '?'))}</span>
        <span style="min-width:0"><span style="display:block;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.salon || '—')}</span><span style="display:block;font-size:10.5px;color:${t.missed_before >= 2 ? '#F87171' : '#6B6B72'};margin-top:2px">${history(t.missed_before)}</span></span></span>
      <span style="min-width:0"><span style="display:block;font-size:12.5px;font-weight:600">${esc(t.title)}</span>${t.body ? `<span style="display:block;font-size:10.5px;color:#9A9CA3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.body)}</span>` : ''}</span>
      <span style="font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:700;color:#E8917F">${esc(t.ref)}</span>
      <span><span style="display:block;font-size:11.5px;font-weight:700;color:${dc}">${dl}</span>${t.due_at ? `<span class="num" style="display:block;font-size:10px;color:#6B6B72;margin-top:2px">${t.days_left < 0 && t.status !== 'done' ? 'was ' : ''}${esc(dayShort(t.due_at))}</span>` : ''}</span>
      <span style="text-align:right">${nx ? `<span data-task="${t.id}" data-act="${nx[0]}" style="font-size:9.5px;letter-spacing:.08em;font-weight:800;border-radius:7px;padding:7px 10px;cursor:pointer;${nx[0] === 'hide' ? 'background:#E8442E;color:#fff' : 'background:#212125;border:1px solid #3A3A40'}">${nx[1]}</span>` : ''}</span></a>`;
  };
  const panel = sel ? (() => {
    const t = sel, [dl, dc] = due(t), open = t.status !== 'done';
    const acts = t.days_left < 0 && t.on_overdue !== 'none' && !t.enforced_at && open;
    const line = (at, what) => `<div style="display:flex;gap:12px;font-size:11.5px"><span class="num" style="width:58px;flex:none;color:#6B6B72">${esc(dayShort(at))}</span><span style="color:#D8D8DC">${what}</span></div>`;
    const btn = (a, l, red) => `<span data-task="${t.id}" data-act="${a}" style="display:flex;align-items:center;justify-content:center;height:38px;border-radius:10px;font-size:11px;font-weight:800;letter-spacing:.05em;cursor:pointer;${red ? 'background:#E8442E' : 'background:#212125;border:1px solid #3A3A40'}">${l}</span>`;
    return `<div style="flex:1 1 300px;min-width:0;max-width:420px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:13px;align-self:flex-start">
      <div style="display:flex;align-items:center;gap:8px"><span style="font-size:10px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${esc((t.salon || '').toUpperCase())}</span><span style="flex:1"></span><span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:${dc};background:${dc}1F;border-radius:5px;padding:3px 7px">${open && t.days_left < 0 ? 'OVERDUE' : esc(dl.toUpperCase())}</span><a href="/compliance${qs}" style="color:#6B6B72;font-size:16px;line-height:1;margin-left:4px">×</a></div>
      <span style="font-size:16px;font-weight:800;line-height:1.3">${esc(t.title)}</span>
      ${t.body ? `<span style="font-size:12px;color:#9A9CA3;line-height:1.55">${esc(t.body)}</span>` : ''}
      ${label9('WHAT WE HAVE ON IT')}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${t.due_at ? line(t.due_at, `Due · ${esc(t.ref)}`) : ''}${t.reminded_at ? line(t.reminded_at, 'Last reminder sent') : ''}${t.proof_at ? line(t.proof_at, '<b>Proof sent</b> · check it and verify') : ''}${t.enforced_at ? line(t.enforced_at, 'Shop hidden for it') : ''}
        ${!t.reminded_at && !t.proof_at && !t.enforced_at ? '<span style="font-size:11.5px;color:#6B6B72">No reminder yet, nothing sent back.</span>' : ''}</div>
      ${t.consequence ? `<div style="background:${acts ? 'rgba(248,113,113,.08)' : '#111113'};border:1px solid ${acts ? 'rgba(248,113,113,.3)' : '#26262B'};border-radius:12px;padding:12px 13px;display:flex;flex-direction:column;gap:4px">
        <span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:${acts ? '#F87171' : '#6B6B72'}">${acts ? 'WHAT HAPPENS TONIGHT' : 'IF IT IS MISSED'}</span><span style="font-size:12px;line-height:1.5">${esc(t.consequence)}</span>
        ${t.on_overdue === 'hide_shop' ? '<span style="font-size:10.5px;color:#9A9CA3;line-height:1.5">Existing bookings are honoured. Nobody new can find the shop until it is sorted.</span>' : t.on_overdue === 'block_topups' ? '<span style="font-size:10.5px;color:#9A9CA3;line-height:1.5">Cash top-ups at the shop stop until it is sorted.</span>' : ''}</div>` : ''}
      ${open ? `<div style="display:flex;flex-direction:column;gap:8px">
        ${t.proof_at || t.action !== 'photo' ? btn('verify', 'IT’S SORTED · VERIFY', !!t.proof_at) : ''}
        ${t.salon_status === 'live' && t.days_left < 0 ? btn('hide', 'HIDE NOW · DON’T WAIT', true) : ''}
        ${btn('remind', 'REMIND THE OWNER')}<a href="/compliance/tasks/${esc(t.ref)}?drop=1" style="display:flex;align-items:center;justify-content:center;height:38px;border-radius:10px;font-size:11px;font-weight:800;letter-spacing:.05em;border:1px solid #3A3A40;color:#9A9CA3">DROP THE TASK</a></div>` : `<span style="font-size:11.5px;color:#4ADE80">Closed.</span>`}
    </div>`;
  })() : '';
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Compliance', scope === 'done' ? 'Done' : 'Open follow-ups')}
    ${chips([['Open', '/compliance', scope === 'open', s.open], ['Done', '/compliance?scope=done', scope === 'done', s.done]])}
    <div style="flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${kpi('OVERDUE', s.overdue, s.acts_tonight === 1 ? (s.overdue === 1 ? 'acts by itself tonight' : '1 of them acts by itself tonight') : s.acts_tonight ? `${s.acts_tonight} act by themselves tonight` : 'nothing acts by itself', s.overdue ? '#F87171' : '')}
        ${kpi('DUE THIS WEEK', s.due_week, s.reminded ? `${s.reminded} reminder${s.reminded === 1 ? '' : 's'} already sent` : 'no reminders sent')}
        ${kpi('DONE ON TIME', s.on_time_pct == null ? '—' : s.on_time_pct + '%', s.on_time_prev == null ? 'nothing last month to compare' : `${s.on_time_pct >= s.on_time_prev ? 'up' : 'down'} from ${s.on_time_prev}% last month`)}
        ${kpi('REPEAT OFFENDERS', s.repeat_offenders, '3+ tasks missed')}</div>
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:3 1 560px;min-width:0;background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
          <div style="display:grid;grid-template-columns:1.3fr 2fr 90px 110px 96px;gap:12px;padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:620px"><span>SHOP</span><span>OBLIGATION</span><span>FROM</span><span>DUE</span><span></span></div>
          <div style="min-width:620px">${d.rows.map(row).join('') || `<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">${scope === 'done' ? 'Nothing closed yet.' : 'No open follow-ups.'}</div>`}</div></div>
        ${panel}</div>
    </div></div>`;
  const run = async (t, a, note = null) => {
    await act('admin_task_action', { p_task: t.id, p_action: a, p_note: note }, { title: `${{ verify: 'Verify', remind: 'Remind', hide: 'Hide the shop for', cancel: 'Drop' }[a]} ${t.ref} · ${t.salon}`, reason: note || '' });
    toast({ verify: 'Marked done · owner told', remind: 'Reminder sent', hide: 'Shop hidden from search', cancel: 'Task dropped' }[a]);
  };
  return {
    top: false, html,
    ready(root) {
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-task]');
        if (!b) return;
        e.preventDefault(); e.stopPropagation();
        const a = b.dataset.act, t = [...d.rows, sel].find((x) => x && x.id === b.dataset.task);
        if (CONFIRM[a] && !confirm(CONFIRM[a])) return;
        try { await run(t, a); go(location.pathname + location.search, { replace: true }); }
        catch (err) { if (!err.handled) toast(err.message, false); }
      }, true);
      if (q.get('drop') && sel && sel.status !== 'done') {
        const dl = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Drop ${esc(sel.ref)}</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">${esc(sel.salon)} · ${esc(sel.title)}. It closes without being done, and the reason goes on the shop’s record.</span>
          <textarea id="dr-why" rows="3" placeholder="Why drop it?" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
          <span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>
          <div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${btnP('DROP IT', 'id="dr-go"')}</div></div>`, { onClose: () => go(`/compliance/tasks/${sel.ref}`), width: 440 });
        dl.querySelector('#dr-go').onclick = async () => {
          const why = dl.querySelector('#dr-why').value.trim();
          const err = dl.querySelector('.dlg-err');
          if (!why) { err.textContent = 'Say why — it goes on the shop’s record.'; err.style.display = 'block'; return; }
          try { await run(sel, 'cancel', why); closeDialog(); go('/compliance'); }
          catch (e) { if (!e.handled) { err.textContent = e.message; err.style.display = 'block'; } }
        };
      }
    },
  };
}
