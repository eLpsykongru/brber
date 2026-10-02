// /customers and /customers/<id> — CUS-02 (every customer, who we owe on top: 0140's
// admin_customers) and CUS-03 (the file: 0136's admin_customer). Actions, all through
// the gate:
//   · credit a wallet (CUS-04) — a support case resolved with a refund, the only
//     path that credits a wallet and leaves a trail (so it asks above 200 DH);
//   · clear a barber's flag (CUS-05) — admin_clear_flag;
//   · ban or lift (CUS-07) — admin_set_suspension, Support asks the Head.
// A phone searched on the list, or in ⌘K, is written to the audit trail.
// Not built: the smaller sanctions CUS-07 offers before a ban, and the erasure
// requests page (CUS-08) — account deletion (0130) has no staff read yet.
import { esc, DH, num, initials, dayShort, dayWk, hhmm, first } from '/app.js';
import { pageHead, label9, profile, btnS, chips, csv } from '/s/ui.js';
import { REASON } from '/s/support.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const errBox = '<span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>';
const showErr = (d, e) => { if (e.handled) return; const x = d.querySelector('.dlg-err'); x.textContent = e.message; x.style.display = 'block'; };
const goBtn = (label, id) => `<span id="${id}" class="btn-p" style="display:flex;align-items:center;height:34px;border-radius:9px;padding:0 16px;font-size:11.5px;font-weight:800;letter-spacing:.05em;cursor:pointer;background:#E8442E">${label}</span>`;

export default async function (ctx) {
  const id = ctx.seg[0];
  if (!id) return list(ctx);
  if (!UUID.test(id)) throw new Error('not_found');
  return file(ctx, id);
}

// ---- CUS-02 · every customer, the ones we owe on top (0140's admin_customers) ---------------
// With no view asked for it opens on who we owe, unless nobody is owed — then everyone.
const VIEWS = [['owed', 'Owed something'], ['all', 'All'], ['flagged', 'Pay-up-front flag'], ['lapsed', 'Lapsed 60 days'], ['wallet', 'Wallet over 200 DH']];
const owedText = (o) => (o.kind === 'case' ? `${REASON[o.reason] || o.reason} · ${o.ref}${o.cents ? ` · ${DH(o.cents)}` : ''}`
  : o.kind === 'suspended_shop' ? `Booking at a shop that’s suspended · ${dayWk(o.at)} ${hhmm(o.at)}`
    : `Cancelled on ${o.n} times this month by ${first(o.barber)}`);
const what = (r) => (r.owed ? r.owed.map(owedText).join(' · ')
  : r.flag_barbers ? `Flagged by ${r.flag_barbers} barber${r.flag_barbers === 1 ? '' : 's'}${r.blocked ? ' · blocked by one' : r.full_payment ? ' · pays in full up front' : ''}`
    : '');
const seen = (t) => (!t ? '—' : dayShort(t) === dayShort(Date.now()) ? 'Today' : dayShort(t));

async function list({ rpc, q, go }) {
  const n = Math.min(500, Number(q.get('n')) || 100);
  const s = (q.get('q') || '').trim();
  const d = await rpc('admin_customers', { p_view: q.get('view') || null, p_q: s || null, p_limit: n });
  const c = d.counts, k = d.kpi;
  const link = (patch) => { const u = new URLSearchParams(q); for (const [key, v] of Object.entries(patch)) { if (v) u.set(key, v); else u.delete(key); } const x = u.toString(); return '/customers' + (x ? '?' + x : ''); };
  const kpi = (l, v, sub, col) => `<div style="flex:1 1 170px;background:#17171A;border:1px solid #1E1E22;border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px"><span style="font-size:9px;letter-spacing:.14em;font-weight:700;color:#9A9CA3">${l}</span><span class="num" style="font-size:22px;font-weight:800${col ? `;color:${col}` : ''}">${v}</span><span style="font-size:10.5px;color:#9A9CA3">${sub}</span></div>`;
  const COLS = 'display:grid;grid-template-columns:minmax(200px,1.3fr) minmax(220px,2fr) 90px 60px 80px;gap:12px;align-items:center';
  const row = (r) => `<a href="/customers/${r.id}" class="hov" style="${COLS};padding:12px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff;font-size:12px">
    <span style="display:flex;align-items:center;gap:10px;min-width:0"><span style="width:30px;height:30px;border-radius:999px;background:${r.owed ? 'rgba(232,161,0,.16)' : '#212125'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:${r.owed ? '#E8A100' : '#9A9CA3'};flex:none">${esc(initials(r.name))}</span>
      <span style="min-width:0"><span style="display:block;font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}${r.suspended ? ' <span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:#F87171">BANNED</span>' : ''}</span><span class="num" style="display:block;font-size:10.5px;color:#6B6B72">${esc(r.phone || 'no phone')}${r.marks ? ` · ${r.marks} mark${r.marks === 1 ? '' : 's'}` : ''}</span></span></span>
    <span style="min-width:0;font-size:11.5px;line-height:1.45;color:${r.owed ? '#E8A100' : '#9A9CA3'}">${esc(what(r)) || '<span style="color:#3A3A40">—</span>'}</span>
    <span class="num" style="text-align:right">${r.wallet_cents ? DH(r.wallet_cents) : '<span style="color:#3A3A40">—</span>'}</span>
    <span class="num" style="text-align:right">${r.visits}</span>
    <span class="num" style="text-align:right;color:#9A9CA3">${seen(r.last_seen)}</span></a>`;
  const empty = s ? `Nobody here matches “${esc(s)}”.` : d.view === 'owed' ? 'Nobody is owed anything.' : 'Nobody here.';
  const more = d.total > d.rows.length ? `Showing ${d.rows.length} of ${num(d.total)} — search, or <a href="${link({ n: String(n + 100) })}" style="font-weight:700">show 100 more</a>.` : '';
  const html = `<div style="height:100%;display:flex;flex-direction:column">
    ${pageHead('Customers', `${num(c.all)} in Tangier · ${c.owed ? `${num(c.owed)} need${c.owed === 1 ? 's' : ''} something from us` : 'nobody is owed anything'}`, `<span style="display:flex;gap:10px;align-items:center">${btnS('Export CSV', 'id="cu-csv"')}</span>`)}
    ${chips(VIEWS.map(([key, label]) => [label, link({ view: key, n: null }), d.view === key, c[key] || null]),
      `<input id="cu-q" value="${esc(s)}" placeholder="Phone, name or booking ID" style="height:30px;width:220px;border-radius:8px;background:#17171A;border:1px solid #26262B;padding:0 11px;color:#fff;font-size:11.5px;outline:none">`)}
    <div style="flex:1;overflow:auto;padding:18px 24px 32px;display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${kpi('OWED BACK', DH(k.owed_cents), `across ${num(k.owed_people)} ${k.owed_people === 1 ? 'person' : 'people'}`, k.owed_cents ? '#E8A100' : '')}
        ${kpi('IN WALLETS', DH(k.wallet_cents), 'we hold this, not the shops')}
        ${kpi('BOOKED AGAIN', k.again_pct == null ? '—' : `${k.again_pct}%`, k.again_pct == null ? 'not enough visits six weeks old yet' : `within 6 weeks · of ${num(k.again_n)} visits`)}
        ${kpi('LEFT AFTER A BAD ONE', k.left_pct == null ? '—' : `${k.left_pct}%`, k.left_pct == null ? 'nobody cancelled on by a barber yet' : `cancelled on, never back · of ${num(k.left_n)}`, k.left_pct ? '#F87171' : '')}</div>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:auto">
        <div style="${COLS};padding:11px 16px;font-size:9px;letter-spacing:.13em;font-weight:700;color:#6B6B72;min-width:720px"><span>CUSTOMER</span><span>WHAT WE OWE THEM</span><span style="text-align:right">WALLET</span><span style="text-align:right">VISITS</span><span style="text-align:right">LAST SEEN</span></div>
        <div style="min-width:720px">${d.rows.map(row).join('') || `<div style="padding:22px 16px;border-top:1px solid #1E1E22;font-size:12px;color:#6B6B72">${empty}</div>`}</div></div>
      ${d.view === 'owed' && !s && c.all > c.owed ? `<span style="font-size:11.5px;color:#6B6B72">${num(c.all - c.owed)} others, nothing owed. There’s no reason to open a customer who hasn’t asked us for anything — <a href="${link({ view: 'all', n: null })}" style="font-weight:700">all of them</a>.</span>` : ''}
      ${more ? `<span style="font-size:11.5px;color:#6B6B72">${more}</span>` : ''}
      <span style="font-size:10.5px;color:#6B6B72">A phone number searched here is written to the audit log, the same as in ⌘K.</span>
    </div></div>`;
  return {
    top: false, html,
    ready(root) {
      root.querySelector('#cu-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(link({ q: e.target.value.trim() || null, n: null })); });
      root.querySelector('#cu-csv').onclick = () => csv(`customers-${d.view}`, [['Name', (r) => r.name], ['Phone', (r) => r.phone || ''], ['What we owe them', (r) => what(r)], ['Wallet DH', (r) => r.wallet_cents / 100], ['Visits', (r) => r.visits], ['Last seen', (r) => r.last_seen || ''], ['Banned', (r) => (r.suspended ? 'yes' : '')]], d.rows);
    },
  };
}

async function file({ rpc, act, q, go, toast, dialog, closeDialog, me }, id) {
  const [c, fl] = await Promise.all([rpc('admin_customer', { p_customer: id }), rpc('admin_flagged_customers', { p_customer: id }).catch(() => null)]);
  const base = `/customers/${id}`;
  const k = c.counts;
  const flags = fl?.detail?.flags || [];
  const banned = !!c.suspended_at;
  const worry = banned ? ['red', 'Banned from booking', `Since ${dayShort(c.suspended_at)} — “${c.suspended_reason || 'no reason recorded'}”. Everything already paid stays theirs.`]
    : flags.some((f) => f.blocked) ? ['red', 'Blocked by a barber', 'At least one barber won’t take them. Read the flags before anything else.']
      : k.no_shows >= 3 || c.marks.length >= 2 ? ['amber', `${k.no_shows} no-shows · ${c.marks.length} live marks`, 'The smaller options come first: a barber can ask for full payment up front before anyone bans them.']
        : ['green', 'Nothing wrong', `${num(k.done)} cut${k.done === 1 ? '' : 's'} done, ${num(k.no_shows)} no-show${k.no_shows === 1 ? '' : 's'}.`];
  const html = profile({
    crumbs: [['Customers', '/customers'], [c.name]],
    pill: banned ? ['Banned', 'red'] : c.deleted_at ? ['Deleted', 'grey'] : ['Active', 'green'],
    initials: initials(c.name), name: c.name,
    tag: flags.length ? [`FLAGGED BY ${flags.length}`, 'amber'] : null,
    sub: `${esc(c.phone || 'no phone')} · customer since ${esc(new Date(c.joined).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))}${c.role !== 'customer' ? ` · ${esc(c.role)}` : ''}`,
    tiles: [
      { label: 'WALLET', value: DH(c.wallet_cents), sub: 'their own money' },
      { label: 'BOOKINGS', value: num(k.bookings), sub: `${num(k.done)} cuts done` },
      { label: 'NO-SHOWS', value: num(k.no_shows), sub: 'all time', color: k.no_shows ? '#F87171' : '#fff' },
      { label: 'THEY CANCELLED', value: num(k.cancelled_by_them), sub: 'all time' },
    ],
    call: { tone: worry[0], title: worry[1], body: worry[2], actions: [
      { label: 'Credit the wallet', href: `${base}?credit=1` },
      { label: banned ? 'Lift the ban' : 'Ban from booking', href: `${base}?sanction=1`, primary: !banned && worry[0] === 'red' },
    ] },
    sections: [
      { title: `Bookings · last ${c.bookings.length}`, empty: 'No bookings yet.',
        rows: c.bookings.map((b) => ({ title: `${dayShort(b.starts_at)} ${hhmm(b.starts_at)} · ${b.salon || '—'}`, sub: `${first(b.barber)} · ${b.status === 'no_show' ? 'no-show' : b.status}${b.ref ? ` · ${b.ref}` : ''}`, right: DH(b.price_cents), rightColor: b.status === 'no_show' ? '#F87171' : '#fff', href: `/bookings/${b.id}` })) },
      { title: `Wallet · last ${c.wallet.length}`, empty: 'Nothing has moved.',
        rows: c.wallet.map((w) => ({ title: w.kind.replace(/_/g, ' '), sub: `${dayShort(w.created_at)} ${hhmm(w.created_at)}${w.ref ? ` · ${w.ref}` : ''}`, right: `${w.amount_cents >= 0 ? '+' : '−'} ${DH(Math.abs(w.amount_cents))}`, rightColor: w.amount_cents >= 0 ? '#4ADE80' : '#fff' })) },
    ],
    side: [
      { title: 'What barbers flagged', empty: 'No barber has flagged them.',
        rows: flags.map((f) => ({ title: `${f.barber}${f.salon ? ` · ${f.salon}` : ''}`, sub: `${f.reason || 'No reason'}${f.blocked ? ' · blocked' : f.require_full_payment ? ' · full payment up front' : ''} · ${f.barber_flags} flag${f.barber_flags === 1 ? '' : 's'} raised by this barber`, right: 'Clear', rightColor: '#E8442E', href: `${base}?clear-flag=${f.barber_id}` })) },
      { title: 'Live marks', empty: 'No marks against them.', rows: c.marks.map((m) => ({ title: m.kind.replace(/_/g, ' '), sub: dayShort(m.created_at), right: m.minutes ? `${m.minutes} min` : '' })) },
      { title: 'Support cases', empty: 'No cases.', rows: c.cases.map((x) => ({ title: `${x.case_no || 'Case'} · ${x.reason}`, sub: `${x.status} · ${dayShort(x.created_at)}`, right: x.refund_cents ? DH(x.refund_cents) : '' })) },
    ],
  });

  const back = () => go(base);
  return {
    top: false, html,
    ready() {
      // CUS-04 — a credit is a case resolved with a refund: it asks above 200 DH (SET-03)
      if (q.get('credit')) {
        const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Credit ${esc(first(c.name))}’s wallet</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">It goes in as a support case resolved with a refund, so it is on their record and on yours. Above 200 DH, Support and Field ops ask the Head.</span>
          <div style="display:flex;gap:10px"><label style="flex:1;display:flex;flex-direction:column;gap:6px">${label9('AMOUNT · DH', '#6B6B72')}<input id="cr-dh" inputmode="numeric" value="${esc(q.get('credit') !== '1' ? q.get('credit') : '')}" style="height:42px;border-radius:10px;background:#111113;border:1px solid #26262B;padding:0 12px;color:#fff;font-size:14px;outline:none"></label></div>
          <label style="display:flex;flex-direction:column;gap:6px">${label9('WHY', '#6B6B72')}<textarea id="cr-why" rows="3" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea></label>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${goBtn('CREDIT IT', 'cr-go')}</div></div>`, { onClose: back, width: 460 });
        d.querySelector('#cr-go').onclick = async () => {
          const cents = Math.round(Number(d.querySelector('#cr-dh').value.replace(',', '.')) * 100);
          const why = d.querySelector('#cr-why').value.trim();
          if (!(cents > 0)) return showErr(d, new Error('Say how much.'));
          if (!why) return showErr(d, new Error('Say why — it goes on the case.'));
          try {
            const opened = await act('admin_open_case', { p_user: c.id, p_reason: 'other', p_detail: `Wallet credit from the desk: ${why}`, p_booking: null }, { title: `Open a case for ${c.name}` });
            await act('admin_support_resolve', { p_case: opened.id, p_refund_cents: cents }, { title: `Credit ${DH(cents)} to ${c.name}`, reason: why });
            closeDialog(); toast(`${DH(cents)} credited to ${first(c.name)}`);
          } catch (e) { showErr(d, e); }
        };
      }
      // CUS-05 — clearing one barber's flag
      const fb = q.get('clear-flag');
      const f = fb && flags.find((x) => x.barber_id === fb);
      if (f) {
        const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">Clear ${esc(first(f.barber))}’s flag on ${esc(first(c.name))}</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">“${esc(f.reason || 'No reason')}”. ${f.barber_flags} flags raised by this barber, ${f.barber_overturned} of their removals overturned on appeal.</span>
          <textarea id="cf-why" rows="3" placeholder="Why it comes off — the barber is told" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Keep it', 'data-dlg-close="1"')}${goBtn('CLEAR THE FLAG', 'cf-go')}</div></div>`, { onClose: back, width: 480 });
        d.querySelector('#cf-go').onclick = async () => {
          const note = d.querySelector('#cf-why').value.trim();
          if (!note) return showErr(d, new Error('Say why.'));
          try { await act('admin_clear_flag', { p_barber: f.barber_id, p_customer: c.id, p_note: note }, { title: `Clear ${f.barber}’s flag on ${c.name}`, reason: note }); closeDialog(); toast('Flag cleared'); }
          catch (e) { showErr(d, e); }
        };
      }
      // CUS-07 — ban or lift; Support asks the Head (SET-03)
      if (q.get('sanction')) {
        const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
          <span style="font-size:17px;font-weight:800">${banned ? `Lift ${esc(first(c.name))}’s ban` : `Ban ${esc(first(c.name))} from booking`}</span>
          <span style="font-size:12px;color:#9A9CA3;line-height:1.55">${banned ? 'They can book again straight away.' : 'They can’t make new bookings. Their wallet and the bookings already made stay theirs. Before this, a barber can ask for full payment up front — a smaller step.'}</span>
          <textarea id="sn-why" rows="3" placeholder="${banned ? 'Why now' : 'Why — kept on their record'}" style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:11px 12px;color:#fff;font-size:12.5px;outline:none;resize:vertical"></textarea>
          ${errBox}<div style="display:flex;gap:10px;justify-content:flex-end">${btnS('Cancel', 'data-dlg-close="1"')}${goBtn(banned ? 'LIFT THE BAN' : 'BAN FROM BOOKING', 'sn-go')}</div></div>`, { onClose: back, width: 480 });
        d.querySelector('#sn-go').onclick = async () => {
          const why = d.querySelector('#sn-why').value.trim();
          if (!why) return showErr(d, new Error('Say why.'));
          try { await act('admin_set_suspension', { p_customer: c.id, p_suspend: !banned, p_reason: why }, { title: `${banned ? 'Lift the ban on' : 'Ban'} ${c.name}`, place: 'Customers', reason: why }); closeDialog(); toast(banned ? 'Ban lifted' : 'Banned from booking'); }
          catch (e) { showErr(d, e); }
        };
      }
    },
  };
}
