// /{slug}/chairs[/<barber id>|/cash][?invite=1] — OBR-05 (the team), OBR-01 (a
// barber, as a side panel), OBR-02 (invite) and OBR-07 (who holds the cash).
// The app's reads and writes: salon_team, salon_report, shop_bookings,
// salon_approve_member / salon_remove_member, cash_agent_state / set_cash_agent.
//
// Not as drawn: the invite has no "by phone" — nothing sends SMS — so it hands
// the owner the words to send; a barber joins by picking the shop in the app and
// the owner approves him here. "Hand the shop over" and "Standing in" (OBR-03/04)
// are not built anywhere yet. Chat lives in the app.
import { esc, DH, first, initials, dayShort } from '/app.js';
import { card, eyebrow, kv, rule, column } from '/s/ui.js';

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
  const [members, meta] = await Promise.all([
    rpc('salon_team'),
    rest(`salons?select=open_min,close_min,cash_agent_id&id=eq.${shop.id}`).then((r) => r[0] || {}),
  ]);
  const approved = members.filter((m) => m.salon_status === 'approved');
  const pending = members.filter((m) => m.salon_status === 'pending');
  const m = pick && members.find((x) => x.barber_id === pick);
  if (pick && !m) throw new Error('not_found');

  const rateOf = (x) => (x.salon_role === 'owner' ? 'Owner' : x.pay_model === 'rent' ? `Rent ${DH(x.rent_cents)}` : `${100 - x.commission_pct}%`);
  const grid = 'display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(140px,1.2fr) 110px 110px 14px;gap:12px';
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
  let panel = '';
  if (m) {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6);
    const to = new Date(); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
    const [rep, bks, prof] = await Promise.all([
      rpc('salon_report', { p_from: from.toISOString(), p_to: to.toISOString() }),
      rpc('shop_bookings', { p_from: from.toISOString(), p_to: to.toISOString(), p_barber: m.barber_id }),
      rest(`profiles?select=phone&id=eq.${m.barber_id}`).catch(() => []),
    ]);
    const w = rep.find((r) => r.barber_id === m.barber_id) || { bookings: 0, booked_cents: 0, commission_cents: 0, no_shows: 0 };
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      return bks.filter((b) => (b.status === 'confirmed' || b.status === 'completed') && new Date(b.starts_at).toDateString() === d.toDateString()).reduce((a, b) => a + (b.price_cents ?? 0), 0);
    });
    const max = Math.max(...days, 1);
    const avg = w.bookings ? Math.round((w.booked_cents ?? 0) / w.bookings) : 0;
    const occ = Math.min(100, Math.round(w.bookings * 30 / (Math.max(1, (meta.close_min ?? 1260) - (meta.open_min ?? 600)) * 7) * 100));
    const own = m.salon_role === 'owner';
    const rent = m.pay_model === 'rent' && !own;   // the owner's own cuts are all his, whatever pay_model says
    const phone = prof[0]?.phone;
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
              <span style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">${eyebrow(own ? 'ALL YOURS' : rent ? 'RENT' : `SHOP CUT · ${100 - m.commission_pct}%`)}<span class="num" style="font-size:17px;font-weight:700;color:#E8442E">${DH(own ? (w.booked_cents ?? 0) : rent ? m.rent_cents : w.commission_cents)}</span></span></div>
            ${rent ? '' : `<div style="display:flex;align-items:flex-end;gap:5px;height:54px">${days.map((v, i) => `<span style="flex:1;height:${Math.max(6, v / max * 100)}%;border-radius:4px;background:${i === 6 ? '#5B8DEF' : 'rgba(91,141,239,.3)'}"></span>`).join('')}</div>`}
            <div style="display:flex;gap:8px">${mini(String(w.bookings), 'CLIENTS')}${mini(occ + '%', 'OCCUPANCY')}${mini(String(w.no_shows), 'NO-SHOWS')}${mini(rent ? '—' : DH(avg), 'AVG TICKET')}</div>
          </div>
          ${eyebrow('ACCESS')}
          <div style="background:#111113;border:1px solid #1E1E22;border-radius:14px;padding:4px 14px">
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #1E1E22"><span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:600">Holds the shop’s cash</span><span style="font-size:10.5px;color:#9A9CA3">${m.is_cash_agent ? 'Yes — takes top-ups and pays the chairs' : 'No'}</span></span><a href="${base}/cash" style="font-size:11.5px;font-weight:700">Change</a></div>
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0"><span style="flex:1;font-size:12.5px;font-weight:600">${own ? 'Pay' : rent ? 'Chair rent' : 'Commission rate'}</span><span class="num" style="font-size:12px;font-weight:700;background:#212125;border-radius:999px;padding:4px 10px">${esc(rateOf(m))}</span></div>
          </div>
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
        <div style="${grid};padding:10px 16px;font-size:9px;letter-spacing:.14em;font-weight:700;color:#6B6B72"><span>BARBER</span><span>RIGHT NOW</span><span>RATING</span><span>COMMISSION</span><span></span></div>
        ${approved.map(row).join('')}
      </div>
      ${pending.length ? `<span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">ASKED TO JOIN · ${pending.length}</span>
        <div style="background:#17171A;border:1px solid rgba(232,161,0,.28);border-radius:14px;overflow:hidden">${pending.map(request).join('').replace('border-top:1px solid #1E1E22', '')}</div>`
        : '<span style="font-size:11.5px;color:#6B6B72">Nobody is waiting to join.</span>'}
    </div></div>${panel}</div>`;

  return {
    html,
    ready(root) {
      root.onclick = async (e) => {
        const a = e.target.closest('[data-approve],[data-decline],[data-remove],[data-chat]');
        if (!a) return;
        if (a.dataset.chat) return toast('Chat is in the Sterncut app', false);
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
