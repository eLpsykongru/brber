// /{slug}/reviews[?filter=needs|all|low][&reply=<id>] — ORV-01, a phone screen,
// so on the web it is a centred column. The reply is 0031's review_reply (public,
// under the review); Flag is review_flag — it stays public while ops look (0042).
// "Needs reply" counts the way the app does: no reply yet, four stars or fewer.
import { esc, first, initials, dayShort } from '/app.js';
import { stars } from '/s/ui.js';

export default async function ({ rpc, rest, shop: s0, q, go, toast, dialog, closeDialog }) {
  const shop = await rpc('owner_shop', { p_slug: s0.slug });
  const base = `/${shop.slug}/reviews`;
  const team = await rpc('salon_team');
  const ids = team.map((m) => m.barber_id);
  const rows = ids.length ? await rest(`reviews?select=id,rating,comment,created_at,reply,replied_at,flagged_at,barber_id,customer_id&barber_id=in.(${ids.join(',')})&order=created_at.desc&limit=200`) : [];
  const names = rows.length ? Object.fromEntries((await rest(`profiles?select=id,full_name&id=in.(${[...new Set(rows.map((r) => r.customer_id))].join(',')})`).catch(() => [])).map((p) => [p.id, p.full_name])) : {};
  const barber = (id) => first(team.find((m) => m.barber_id === id)?.full_name || 'Barber');

  const needs = rows.filter((r) => !r.reply && r.rating <= 4);
  const filter = q.get('filter') || (needs.length ? 'needs' : 'all');
  const shown = filter === 'needs' ? needs : filter === 'low' ? rows.filter((r) => r.rating <= 3) : rows;
  const avg = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : 0;
  const pct = (n) => (rows.length ? Math.max(rows.filter((r) => r.rating === n).length ? 1 : 0, Math.round(rows.filter((r) => r.rating === n).length / rows.length * 100)) : 0);
  const link = (f) => `${base}?filter=${f}`;
  const pill = (label, f) => `<a href="${link(f)}" style="border-radius:999px;font-size:11px;padding:8px 14px;text-decoration:none;${filter === f ? 'background:#E8442E;color:#fff;font-weight:700' : 'background:#212125;color:#9A9CA3;font-weight:600'}">${esc(label)}</a>`;

  const card = (r) => {
    const who = names[r.customer_id] || 'A customer';
    return `<div style="background:#17171A;border-radius:20px;padding:15px;display:flex;flex-direction:column;gap:11px">
      <div style="display:flex;align-items:center;gap:11px">
        <span style="width:38px;height:38px;border-radius:999px;background:#212125;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#9A9CA3;flex:none">${esc(initials(who))}</span>
        <span style="flex:1"><span style="display:block;font-size:13px;font-weight:700">${esc(who)}</span><span style="display:block;font-size:11px;color:#9A9CA3;margin-top:2px">${esc(barber(r.barber_id))} · ${esc(dayShort(r.created_at))}${r.flagged_at ? ' · flagged' : ''}</span></span>
        <span style="font-size:11px;flex:none">${stars(r.rating)}</span>
      </div>
      ${r.comment ? `<span style="font-size:13px;line-height:1.5;color:#D8D8DC">${esc(r.comment)}</span>` : ''}
      ${r.reply ? `<div style="display:flex;align-items:flex-start;gap:9px;background:#212125;border-radius:14px;padding:12px 13px">
        <span style="width:24px;height:24px;border-radius:999px;background:rgba(232,68,46,.16);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#E8442E;flex:none">${esc(initials(shop.name))}</span>
        <span style="flex:1"><span style="display:block;font-size:11px;font-weight:700;color:#9A9CA3">${esc(shop.name)} replied</span><span style="display:block;font-size:12px;line-height:1.5;color:#D8D8DC;margin-top:4px">${esc(r.reply)}</span></span></div>`
      : `<div style="display:flex;gap:9px">
        <a href="${base}?filter=${filter}&reply=${r.id}" class="btn-p" style="flex:1;height:40px;border-radius:999px;background:#E8442E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;letter-spacing:.05em;text-decoration:none">REPLY</a>
        ${r.flagged_at ? '' : `<span data-flag="${r.id}" style="height:40px;border-radius:999px;border:1px solid #26262B;display:flex;align-items:center;padding:0 16px;font-size:12px;font-weight:700;color:#9A9CA3;cursor:pointer">Flag</span>`}
      </div>`}
    </div>`;
  };

  const html = `<div style="height:100%;overflow:auto"><div style="max-width:640px;margin:0 auto;padding:24px 20px 48px;display:flex;flex-direction:column;gap:13px;box-sizing:border-box">
    <div style="background:#17171A;border-radius:20px;padding:16px;display:flex;align-items:center;gap:18px">
      <span style="text-align:center;flex:none;min-width:70px"><span class="num" style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:34px;line-height:1">${rows.length ? avg.toFixed(1) : '—'}</span><span style="display:block;font-size:11px;margin-top:3px">${stars(Math.round(avg))}</span><span style="display:block;font-size:10px;color:#9A9CA3;margin-top:4px">${rows.length} review${rows.length === 1 ? '' : 's'}</span></span>
      <span style="flex:1;display:flex;flex-direction:column;gap:5px">${[5, 4, 3, 2, 1].map((n) => `<span style="display:flex;align-items:center;gap:7px"><span style="font-size:10px;color:#9A9CA3;width:8px">${n}</span><span style="flex:1;height:5px;border-radius:3px;background:#212125;overflow:hidden"><span style="display:block;height:100%;width:${pct(n)}%;background:#E8A100"></span></span></span>`).join('')}</span>
    </div>
    <div style="display:flex;gap:8px">${pill(`Needs reply · ${needs.length}`, 'needs')}${pill('All', 'all')}${pill('Low', 'low')}</div>
    <div style="display:flex;flex-direction:column;gap:10px">${shown.map(card).join('') || `<div style="padding:28px 12px;text-align:center;font-size:12.5px;color:#6B6B72">${filter === 'needs' ? 'Every review has an answer.' : 'No reviews here yet.'}</div>`}</div>
  </div></div>`;

  return {
    html,
    ready(root) {
      root.onclick = (e) => {
        const f = e.target.closest('[data-flag]');
        if (!f || !confirm('Flag this review? It stays public, but we take a look at it.')) return;
        rpc('review_flag', { p_review: f.dataset.flag }).then(() => { toast('Flagged — we take a look'); go(location.pathname + location.search, { replace: true }); })
          .catch((err) => toast(err.message, false));
      };
      const r = rows.find((x) => x.id === q.get('reply') && !x.reply);
      if (!r) return;
      const d = dialog(`<div style="padding:22px;display:flex;flex-direction:column;gap:14px">
        <span style="font-size:17px;font-weight:800">Reply to ${esc(names[r.customer_id] || 'this customer')}</span>
        <div style="background:#111113;border:1px solid #1E1E22;border-radius:14px;padding:12px 13px;display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px">${stars(r.rating)} <span style="color:#9A9CA3">· ${esc(barber(r.barber_id))} · ${esc(dayShort(r.created_at))}</span></span>
          ${r.comment ? `<span style="font-size:12.5px;line-height:1.5;color:#D8D8DC">${esc(r.comment)}</span>` : ''}
        </div>
        <textarea id="rv-text" rows="4" placeholder="Your reply is public, under the review, signed ${esc(shop.name)}." style="background:#111113;border:1px solid #26262B;border-radius:12px;padding:12px 13px;color:#fff;font-size:13px;line-height:1.5;outline:none;resize:vertical"></textarea>
        <span class="dlg-err" style="font-size:12px;color:#F87171;display:none"></span>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <span data-dlg-close="1" class="btn-s" style="height:40px;border-radius:999px;border:1px solid #3A3A40;background:#212125;display:flex;align-items:center;padding:0 18px;font-size:12px;font-weight:700;cursor:pointer">Cancel</span>
          <span id="rv-send" class="btn-p" style="height:40px;border-radius:999px;background:#E8442E;display:flex;align-items:center;padding:0 22px;font-size:12px;font-weight:700;letter-spacing:.05em;cursor:pointer">SEND REPLY</span>
        </div></div>`, { onClose: () => go(`${base}?filter=${filter}`), width: 520 });
      d.querySelector('#rv-text').focus();
      d.querySelector('#rv-send').onclick = async () => {
        const text = d.querySelector('#rv-text').value.trim();
        const err = d.querySelector('.dlg-err');
        if (!text) { err.textContent = 'Write the reply first.'; err.style.display = 'block'; return; }
        try { await rpc('review_reply', { p_review: r.id, p_reply: text }); closeDialog(); toast('Reply posted'); }
        catch (e) { err.textContent = e.message; err.style.display = 'block'; }
      };
    },
  };
}
