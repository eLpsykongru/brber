// /requests — §5.2. The Head of Ops sees "WAITING ON YOU"; everyone else sees
// the same asks marked "With {head}". Nothing on this list has happened yet:
// an ask is a stored call that runs only when the Head says so (0133).
import { esc, ago, dayShort, first } from '/app.js';

const T = { red: ['rgba(248,113,113,.3)', '#F87171'], amber: ['rgba(232,161,0,.28)', '#E8A100'], grey: ['#1E1E22', '#3A3A40'] };

export default async function ({ me, rpc }) {
  const r = await rpc('admin_requests');
  const lead = me.role === 'head';
  const head = first(me.head) || 'the Head of Ops';
  const withAsk = (path, id) => (path || '/requests') + ((path || '').includes('?') ? '&' : '?') + 'ask=' + id;

  const row = ({ title, sub, where, age, action, tone = 'grey', to, muted }) => {
    const [border, bar] = T[tone];
    return `<div ${to ? `data-go="${esc(to)}"` : ''} class="hov" style="display:flex;align-items:center;gap:12px;background:#17171A;border:1px solid ${border};border-radius:12px;padding:13px 15px;cursor:${to ? 'pointer' : 'default'}">
      <span style="width:6px;height:30px;border-radius:3px;background:${bar};flex:none"></span>
      <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(title)}</span><span style="font-size:10.5px;color:#9A9CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sub)}</span></span>
      <span style="width:104px;flex:none;font-size:11px;color:#9A9CA3">${esc(where || '')}</span>
      <span class="num" style="width:44px;flex:none;text-align:right;font-size:11px;color:#6B6B72">${esc(age || '')}</span>
      <span style="width:84px;flex:none;text-align:right;font-size:11px;font-weight:700;color:${muted ? '#9A9CA3' : '#E8442E'}">${esc(action)}</span>
    </div>`;
  };

  const old = (a) => Date.now() - new Date(a.asked_at) > 24 * 3600e3;
  const pending = r.waiting.map((a) => row(lead
    ? { title: a.title, sub: `${a.asked_by} asked · “${a.reason}”`, where: a.place, age: ago(a.asked_at),
        tone: old(a) ? 'red' : 'amber', to: withAsk(a.path, a.id), action: 'Decide' }
    : { title: a.title, sub: a.mine ? `You asked · nothing has happened yet` : `${a.asked_by} asked · nothing has happened yet`,
        where: a.place, age: ago(a.asked_at), tone: a.mine ? 'amber' : 'grey', to: withAsk(a.path, a.id), action: `With ${head}`, muted: true }));
  const decided = r.decided.map((a) => row({
    title: a.title,
    sub: `${a.state === 'done' ? 'Done' : a.state === 'refused' ? 'Refused' : 'Withdrawn'} ${dayShort(a.decided_at)}`
      + (a.decided_by ? ` · by ${a.decided_by}` : '') + ` · asked by ${a.mine ? 'you' : a.asked_by}` + (a.note ? ` · “${a.note}”` : ''),
    where: a.place, to: withAsk(a.path, a.id), action: 'Read', muted: true }));

  const group = (label, rows, empty) => `
    <div style="display:flex;flex-direction:column;gap:11px">
      <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">${label}</span>
      <div style="display:flex;flex-direction:column;gap:8px">${rows.join('') || `<span style="font-size:12px;color:#6B6B72;padding:6px 2px">${empty}</span>`}</div>
    </div>`;

  return {
    html: `<div style="height:100%;overflow:auto;box-sizing:border-box">
      <div style="max-width:900px;padding:22px 24px 44px;display:flex;flex-direction:column;gap:24px;box-sizing:border-box">
        <span style="font-size:12.5px;line-height:1.6;color:#9A9CA3;max-width:620px">${lead
          ? 'Asks from the team that only you can decide. Nothing on this list has happened yet.'
          : `Some actions need ${esc(head)}. When you ask, it lands here — and nothing happens to the shop, barber or customer until ${esc(head)} decides.`}</span>
        ${group(lead ? `WAITING ON YOU · ${pending.length}` : `WITH ${esc(head.toUpperCase())} · ${pending.length}`, pending, 'Nothing is waiting.')}
        ${group('DECIDED', decided, 'Nothing decided in the last 30 days.')}
      </div></div>`,
  };
}
