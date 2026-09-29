// /customers and /customers/<id> — CUS-02 (who needs something: 0056's flagged
// customers) and CUS-03 (the file: 0136's admin_customer). Actions, all through
// the gate:
//   · credit a wallet (CUS-04) — a support case resolved with a refund, the only
//     path that credits a wallet and leaves a trail (so it asks above 200 DH);
//   · clear a barber's flag (CUS-05) — admin_clear_flag;
//   · ban or lift (CUS-07) — admin_set_suspension, Support asks the Head.
// Anyone else is found with ⌘K, where a phone lookup is written to the audit trail.
// Not built: the smaller sanctions CUS-07 offers before a ban, and the erasure
// requests page (CUS-08) — account deletion (0130) has no staff read yet.
import { esc, DH, num, initials, dayShort, hhmm, first } from '/app.js';
import { pageHead, label9, profile, btnS } from '/s/ui.js';

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

async function list({ rpc }) {
  const d = await rpc('admin_flagged_customers', {});
  const rows = d.flagged.map((c) => `<a href="/customers/${c.id}" class="hov" style="display:flex;align-items:center;gap:12px;padding:13px 16px;border-top:1px solid #1E1E22;text-decoration:none;color:#fff">
    <span style="width:30px;height:30px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(c.name))}</span>
    <span style="width:220px;flex:none;min-width:0"><span style="display:block;font-size:12.5px;font-weight:700">${esc(c.name)}</span><span style="display:block;font-size:10.5px;color:#9A9CA3">${esc(c.phone || 'no phone')}</span></span>
    <span style="flex:1;min-width:0;font-size:11.5px;color:#D8D8DC">Flagged by ${c.barbers} barber${c.barbers === 1 ? '' : 's'}${c.blocked ? ' · blocked by one' : c.full_payment ? ' · pays in full up front' : ''}</span>
    <span class="num" style="width:90px;flex:none;font-size:11.5px;color:${c.no_shows ? '#F87171' : '#9A9CA3'}">${c.no_shows} no-show${c.no_shows === 1 ? '' : 's'}</span>
    <span class="num" style="width:80px;flex:none;font-size:11.5px;color:#9A9CA3">${c.live_marks} mark${c.live_marks === 1 ? '' : 's'}</span>
    <span style="width:90px;flex:none;text-align:right">${c.suspended ? '<span style="font-size:9px;letter-spacing:.1em;font-weight:800;color:#F87171;background:rgba(248,113,113,.12);border-radius:5px;padding:4px 7px">BANNED</span>' : ''}</span></a>`).join('');
  const html = `<div style="height:100%;display:flex;flex-direction:column">${pageHead('Customers', 'Who needs something', btnS('Find someone · ⌘K', 'data-pal="1"'))}
    <div style="flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:12px">
      <span style="font-size:12px;color:#9A9CA3;line-height:1.55;max-width:640px">Customers a barber has flagged, newest first. Anyone else is one search away — a phone number looked up in ⌘K is written to the audit trail, with your name.</span>
      <div style="background:#17171A;border:1px solid #1E1E22;border-radius:14px;overflow:hidden">${rows || '<div style="padding:22px 16px;font-size:12px;color:#6B6B72">No barber has flagged anyone.</div>'}</div></div></div>`;
  return { top: false, html };
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
