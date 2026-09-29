// /{slug}/services — what the shop sells, read from the same places the app does:
// the bundles on the shop page (salon_bundles) and each chair's services.
// Not built: editing bundles (OSV-02/03) and "how long each takes" (OSV-04…08) —
// they are drawn, but nothing stores a duration per pair of hands yet; and Passes
// (OSV-09/10) are held from v1 (handoff §10). A barber edits his own services in
// the app.
import { esc, DH, first } from '/app.js';
import { column, card, eyebrow, rule } from '/s/ui.js';

export default async function ({ rpc, rest, shop: s0 }) {
  const shop = await rpc('owner_shop', { p_slug: s0.slug });
  const team = (await rpc('salon_team')).filter((m) => m.salon_status === 'approved');
  const ids = team.map((m) => m.barber_id);
  const [bundles, svcs] = await Promise.all([
    rpc('salon_bundles', { p_salon: shop.id }).catch(() => []),
    ids.length ? rest(`services?select=barber_id,name,price_cents,duration_min,is_active&barber_id=in.(${ids.join(',')})&order=price_cents`) : [],
  ]);
  const inner = `
    <span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">What ${esc(shop.name)} sells, as customers see it. Each barber sets their own services and prices in the Sterncut app.</span>
    ${eyebrow(`BUNDLES · ${bundles.length}`)}
    ${bundles.length ? bundles.map((b) => card(`<div style="display:flex;align-items:baseline;gap:12px"><span style="flex:1;font-size:14px;font-weight:700">${esc(b.name)}</span><span class="num" style="font-size:15px;font-weight:800">${DH(b.price_cents)}</span></div>
        <span style="font-size:11px;color:#9A9CA3">${esc(first(b.barber))} · ${b.duration_min} min · ${esc(b.services.map((s) => s.name).join(' + '))}${b.list_cents > b.price_cents ? ` · <span style="color:#4ADE80">saves ${DH(b.list_cents - b.price_cents)}</span>` : ''}</span>`)).join('')
      : '<span style="font-size:11.5px;color:#6B6B72">No bundles on your page.</span>'}
    ${team.map((m) => {
      const mine = svcs.filter((s) => s.barber_id === m.barber_id);
      return `${eyebrow(`${first(m.full_name).toUpperCase()} · ${mine.filter((s) => s.is_active).length} ON THE PAGE`)}
        ${card(mine.map((s) => `<div style="display:flex;align-items:center;gap:12px;${s.is_active ? '' : 'opacity:.45'}"><span style="flex:1;font-size:12.5px;font-weight:600">${esc(s.name)}${s.is_active ? '' : ' <span style="font-size:10.5px;color:#6B6B72">· hidden</span>'}</span><span style="font-size:11px;color:#9A9CA3">${s.duration_min} min</span><span class="num" style="font-size:12.5px;font-weight:700;width:70px;text-align:right">${DH(s.price_cents)}</span></div>`).join(rule) || '<span style="font-size:11.5px;color:#6B6B72">No services yet.</span>')}`;
    }).join('')}
    <span style="font-size:10.5px;color:#6B6B72;line-height:1.5">Not on the website yet: editing bundles and how long each service takes. Passes are held from v1.</span>`;
  return { html: column(inner) };
}
