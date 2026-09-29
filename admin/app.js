// admin.sterncut.ma — the shell (design_handoff_admin_owner_site README §1–§4).
//
// One site, two audiences. Staff (@sterncut.ma + password + authenticator code,
// aal2) get the ops console; owners (their Sterncut app account) get their own
// shop at /{slug}/…. The database is the guard — is_admin() needs aal2 and the
// domain, owner_shop() refuses a slug that isn't yours, and every gated write
// answers ask:/deny: (0133). This file only draws what those answers mean.
//
// A section is s/<name>.js: `export default async (ctx) => ({ html, ready?, top?, heading?, place? })`.
// Sections not rebuilt yet run the old console (legacy.html) in a frame.

const CFG = { url: (window.SUPABASE_URL || '').replace(/\/$/, ''), key: window.SUPABASE_ANON_KEY || '' };
export const FLAGS = window.STERNCUT_FLAGS || {};
const CITY = 'Tangier';                 // ponytail: the one launch city; per-person cities when a second opens
const IDLE_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------- helpers --
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sp = (n) => Number(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
export const num = (n) => (n == null ? '—' : sp(n));
export const DH = (c) => (c == null ? '—' : sp(Math.round(c / 100)) + ' DH');   // "3 240 DH"
export const initials = (s) => String(s || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const first = (s) => String(s || '').split(/\s+/)[0];
const TZ = { timeZone: 'Africa/Casablanca' };
export const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...TZ });
export const dayLong = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...TZ });
// §7: 'Fri 4 Sep' — en-US parts, because en-GB now prints 'Sept'
const DP = new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', ...TZ });
const parts = (t) => Object.fromEntries(DP.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
export const dayShort = (t) => { const o = parts(t); return `${o.day} ${o.month}`; };
export const dayWk = (t) => { if (!t) return ''; const o = parts(t); return `${o.weekday} ${o.day} ${o.month}`; };
export function ago(t) {
  if (!t) return '';
  const m = (Date.now() - new Date(t)) / 60000;
  if (m < 60) return Math.max(1, Math.round(m)) + 'm';
  if (m < 1440) return Math.round(m / 60) + 'h';
  return Math.round(m / 1440) + 'd';
}
const $ = (sel, el = document) => el.querySelector(sel);
const LOGO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="6" cy="6" r="2.5"></circle><circle cx="6" cy="18" r="2.5"></circle><path d="M8.2 7.5 20 20M8.2 16.5 20 4"></path></svg>';
export const icon = (d, size = 15, sw = 1.8, color = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="${d}"></path></svg>`;
export const TONE = { red: ['#F87171', 'rgba(248,113,113,.12)'], amber: ['#E8A100', 'rgba(232,161,0,.12)'], green: ['#4ADE80', 'rgba(74,222,128,.12)'], grey: ['#9A9CA3', '#212125'] };

export const IC = {
  overview: 'M3 5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM14 5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2zM3 16a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM14 16a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z',
  requests: 'M3 13h5l1.5 3h5l1.5-3h5M6 4h12l3 9v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z',
  demand: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10zM10 11a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  salons: 'M4 20V9l8-5 8 5v11M9 20v-6h6v6',
  barbers: 'M6 8a3 3 0 1 0 6 0a3 3 0 1 0-6 0M13.5 9a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M3 20c.7-3.4 3-5 6-5s5.3 1.6 6 5',
  customers: 'M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21c1-4.5 4-6.5 8-6.5s7 2 8 6.5',
  bookings: 'M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3 9.5h18M8 3v4M16 3v4',
  wallets: 'M6 7h12a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3zM16 13h.01M3 10V7a2 2 0 0 1 2-2h11',
  finance: 'M12 3v18M5 8h9a3.5 3.5 0 0 1 0 7H5',
  support: 'M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12z',
  reviews: 'M12 3l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 18.2 5.9 21.6l1.4-6.8L2.2 10.1l6.9-.8L12 3z',
  compliance: 'M9 11l2 2 4-4M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z',
  settings: 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2.6 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21.4 11a2 2 0 1 1 0 4zM8.8 12a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0',
  today: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  services: 'M3.5 6a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M3.5 18a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8.2 7.5 20 20M8.2 16.5 20 4',
  reports: 'M5 20v-7M11 20V5M17 20v-10M3 20h18',
  subscription: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  coupons: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM10 5v14',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V8a4 4 0 0 1 8 0v3',
  out: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4',
  search: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M16.5 16.5 21 21',
  shield: 'M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z',
  chev: 'M9 6l6 6-6 6',
};

// Staff menu (§3). Every staff member sees the same menu — permissions change
// actions, not pages. Coupons is held from v1 (§10) and says so.
const STAFF_NAV = [
  ['overview', 'Overview'], ['requests', 'Requests'], ['demand', 'Demand'], ['salons', 'Salons'],
  ['barbers', 'Barbers'], ['customers', 'Customers'], ['bookings', 'Bookings'], ['wallets', 'Wallets & float'],
  ['finance', 'Finance'], ['support', 'Support'], ['reviews', 'Reviews'], ['coupons', 'Coupons'],
  ['compliance', 'Compliance'], ['settings', 'Settings'],
].map(([key, label]) => ({ key, label }));
const OWNER_NAV = [
  ['today', 'Today', 'today'], ['chairs', 'Chairs', 'barbers'], ['services', 'Services', 'services'],
  ['reviews', 'Reviews', 'reviews'], ['payouts', 'Payouts', 'wallets'], ['subscription', 'Subscription', 'subscription'],
  ['reports', 'Reports', 'reports'], ['shop', 'Your shop', 'salons'],
].map(([key, label, ic]) => ({ key, label, ic }));
// sections rebuilt on this site; every other staff section is still the old console
const NATIVE = { overview: 'overview', requests: 'requests', salons: 'salons', barbers: 'barbers', customers: 'customers', support: 'support', reviews: 'reviews', bookings: 'bookings', compliance: 'compliance', demand: 'demand', settings: 'settings' };
const OWNER_NATIVE = { today: 'today', payouts: 'payouts', reviews: 'reviews', subscription: 'subscription', reports: 'reports', chairs: 'chairs', shop: 'shop', services: 'services' };
export const ROLE_LABEL = { head: 'Head of Ops', support: 'Support', mod: 'Moderator', field: 'Field ops' };

// ---------------------------------------------------------------- session --
// The same key legacy.html reads, so its screens run on this aal2 session.
const KEY = 'sc_admin';
let sess = (() => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } })();
const keep = (s) => { sess = s; localStorage.setItem(KEY, JSON.stringify(s)); };
const forget = () => { sess = null; localStorage.removeItem(KEY); localStorage.removeItem('sc_locked'); };
const claims = () => {
  try { return JSON.parse(atob(sess.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
};
const isStaffEmail = (e) => /@sterncut\.ma$/i.test(String(e || '').trim());

async function api(path, opts = {}) {
  const r = await fetch(CFG.url + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json', apikey: CFG.key,
      ...(sess ? { Authorization: 'Bearer ' + sess.access_token } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    throw Object.assign(new Error(body?.message || body?.msg || body?.error_description || r.statusText),
      { status: r.status, code: body?.code, detail: body?.details });
  }
  return body;
}

// One retry on 401: an ops session sits open far longer than an access token lives.
export async function rpc(fn, args = {}) {
  const call = () => api('/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });
  try { return await call(); } catch (e) {
    if (e.status !== 401 || !sess?.refresh_token) throw e;
    keep(await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: sess.refresh_token }) }));
    return call();
  }
}
export const rest = (path) => api('/rest/v1/' + path);
// a row the caller's own RLS lets them change (an owner's salon: 0011's salons_update_own)
export const patch = (path, body) => api('/rest/v1/' + path, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' } });

// ------------------------------------------------------------------- auth --
const signInPassword = async (email, password) =>
  keep(await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }));
async function totpFactors() {
  const u = await api('/auth/v1/user');
  return (u.factors || []).filter((f) => f.factor_type === 'totp');
}
async function verifyCode(factorId, code) {
  const ch = await api(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', body: '{}' });
  keep(await api(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', body: JSON.stringify({ challenge_id: ch.id, code }) }));
}
async function signOut(mode) {
  await api('/auth/v1/logout', { method: 'POST' }).catch(() => {});
  forget(); me = null; frame = null;
  si = { ...si, mode: mode || si.mode, error: '', pw: '' };
  go('/sign-in', { replace: true });
}

// who is signed in: staff → admin_me(); owner → my_shops()
let me = null;
let ACTIONS = {};                        // staff_actions by key: labels for asks and SET-03
async function whoami() {
  me = null;
  if (!sess) return;
  const c = claims();
  // an aal2 session is a staff one if the database says so: the address rule
  // (@sterncut.ma, or 0135's allowlist) lives in is_admin(), not here
  if (c.aal === 'aal2') {
    const staff = await rpc('admin_me').catch(() => null);
    if (staff) {
      me = { kind: 'staff', ...staff };
      const acts = await rest('staff_actions?select=key,label,did,allow,ask,sort&order=sort').catch(() => []);
      ACTIONS = Object.fromEntries(acts.map((a) => [a.key, a]));
      return;
    }
  }
  if (isStaffEmail(c.email)) return;     // a staff session that hasn't passed its code yet
  const shops = await rpc('my_shops');
  if (!shops.length) return;
  const prof = await rest(`profiles?select=full_name,phone&id=eq.${c.sub}`).catch(() => []);
  me = { kind: 'owner', shops, name: prof[0]?.full_name || c.email, email: c.email, phone: prof[0]?.phone };
}
const head = () => first(me?.head) || 'the Head of Ops';

// ----------------------------------------------------------------- router --
export function go(path, { replace = false } = {}) {
  if (path !== location.pathname + location.search) history[replace ? 'replaceState' : 'pushState'](null, '', path);
  route();
}
addEventListener('popstate', () => route());
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); return go(g.dataset.go); }
  const a = e.target.closest('a[href^="/"]');
  if (a && !a.target && !a.hasAttribute('download')) { e.preventDefault(); go(a.getAttribute('href')); }
});

let seq = 0;
let si = { mode: 'staff', email: '', pw: '', error: '', busy: false };
let pending = null;                     // the code step: { factorId?, enroll?: {id, qr, secret} }

async function route() {
  const n = ++seq;
  const url = new URL(location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  closePal();
  dialogClose = null;                    // a page's dialog belongs to that page
  if ($('#overlay')) $('#overlay').innerHTML = '';
  if (!CFG.url || !CFG.key) return paint(signInPage('No Supabase project configured — copy admin/config.example.js to admin/config.js and fill it in.'));
  if (!me) {
    if (seg[0] === 'sign-in') return seg[1] === 'code' && pending ? paint(codePage()) : paint(signInPage());
    if (path !== '/') sessionStorage.setItem('sc_next', path + url.search);
    return go('/sign-in', { replace: true });
  }
  if (!seg.length || seg[0] === 'sign-in') return go(home(), { replace: true });

  let key, mod, ctx = { path, seg, q: url.searchParams, me, go, rpc, rest, act, toast, dialog, closeDialog, refreshMe, url };
  if (me.kind === 'owner') {
    const shop = me.shops.find((s) => s.slug === seg[0]);
    if (!shop) return shell(null, missing(path));
    if (!seg[1]) return go(`/${shop.slug}/today`, { replace: true });
    key = seg[1];
    if (!OWNER_NAV.some((x) => x.key === key)) return shell(null, missing(path), shop);
    ctx = { ...ctx, shop, seg: seg.slice(2) };
    mod = OWNER_NATIVE[key] ? 'owner-' + OWNER_NATIVE[key] : null;
    shell(key, loading(), shop);
    if (!mod) return n === seq && shell(key, notBuilt(key, true), shop);
  } else {
    key = seg[0];
    if (!STAFF_NAV.some((x) => x.key === key)) return shell(null, missing(path));
    ctx = { ...ctx, seg: seg.slice(1) };
    if (key === 'coupons' && !FLAGS.coupons) return shell(key, notBuilt('coupons'));
    mod = NATIVE[key];
    if (!mod) return shell(key, framed(path));
    shell(key, loading());
  }
  try {
    const page = await (await import(`/s/${mod}.js`)).default(ctx);
    if (n !== seq) return;               // a newer navigation won
    shell(key, page, ctx.shop);
  } catch (e) {
    if (n !== seq) return;
    if (/not_found/.test(e.message)) return shell(null, missing(path), ctx.shop);
    shell(key, { html: failed(e) }, ctx.shop);
  }
}
const home = () => (me.kind === 'owner' ? `/${me.shops[0].slug}/today` : '/overview');

// ------------------------------------------------------------------ paint --
const root = document.getElementById('root');
function paint(html) { root.innerHTML = html; frame = null; document.title = 'Sign in · Sterncut'; bindSignIn(); }

// the shell: rail + top bar + page. `page` = { html, ready?, top?, heading?, place?, frame? }
let frame = null;                       // the legacy iframe, kept across legacy pages
let cur = {};                           // the section on screen, for redrawing the rail
function shell(key, page, shop) {
  const owner = me.kind === 'owner';
  cur = { key, shop };
  const nav = owner ? OWNER_NAV : STAFF_NAV;
  const label = key ? (nav.find((x) => x.key === key) || {}).label : '';
  const isHome = key === 'overview' || key === 'today';
  document.title = !key ? 'Not found · Sterncut' : `${label} · ${owner ? shop.name : 'Sterncut Admin'}`;
  if (!$('#rail')) {
    root.innerHTML = `
      <div style="position:fixed;inset:0;display:flex">
        <div id="rail" style="width:216px;flex:none;background:#111113;border-right:1px solid #1E1E22;display:flex;flex-direction:column;padding:20px 14px 14px;box-sizing:border-box;gap:18px;position:relative;z-index:2"></div>
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;position:relative">
          <div id="top"></div><div id="askbar"></div>
          <div id="page" style="flex:1;min-height:0;position:relative"></div>
          <div id="legacy" style="position:absolute;inset:0;display:none"></div>
        </div>
      </div>
      <div id="overlay"></div><div id="toast"></div>`;
  }
  drawRail(key, shop);
  const top = page.top !== false && !page.frame;
  $('#top').innerHTML = top ? `
    <div style="height:62px;flex:none;border-bottom:1px solid #1E1E22;display:flex;align-items:center;gap:12px;padding:0 24px;box-sizing:border-box">
      <span style="font-size:15px;font-weight:700;white-space:nowrap">${esc(page.heading || (isHome ? dayLong(Date.now()) : label || 'Not found'))}</span>
      <span style="font-size:12px;color:#6B6B72;white-space:nowrap">${esc(page.place || (owner ? shop?.name || '' : `${CITY} · ${hhmm(Date.now())}`))}</span>
      <span style="flex:1"></span>
      <span data-pal="1" style="display:flex;align-items:center;gap:9px;height:32px;min-width:200px;box-sizing:border-box;border-radius:9px;background:#17171A;border:1px solid #26262B;padding:0 8px 0 12px;font-size:11.5px;color:#6B6B72;cursor:pointer">
        ${icon(IC.search, 13, 2)}<span style="flex:1">${owner ? 'Search your shop' : 'Search anything'}</span>
        <span style="font-family:ui-monospace,Menlo,monospace;font-size:10px;background:#26262B;border-radius:4px;padding:2px 5px;color:#9A9CA3">⌘K</span>
      </span>
    </div>` : '';
  const pg = $('#page'), lg = $('#legacy');
  if (page.frame) {
    pg.style.display = 'none'; lg.style.display = 'block';
    lg.style.top = $('#askbar').offsetHeight + 'px';
    if (!frame || !lg.contains(frame)) {
      lg.innerHTML = `<iframe title="Sterncut Admin" src="/legacy.html?embed=1#/${page.frame}" style="border:0;width:100%;height:100%;display:block"></iframe>`;
      frame = lg.firstElementChild;
    } else if (frame.contentWindow.location.hash !== '#/' + page.frame) {
      frame.contentWindow.location.hash = '#/' + page.frame;
    }
  } else {
    lg.style.display = 'none'; pg.style.display = 'block';
    pg.innerHTML = page.html || '';
    page.ready?.(pg);
  }
  askBar();
}

function drawRail(key, shop) {
  const owner = me.kind === 'owner';
  shop = shop || me.shops?.[0];              // a 404 still belongs to the owner's shop
  const nav = owner ? OWNER_NAV : STAFF_NAV;
  const item = (x) => {
    const on = x.key === key;
    let badge = null, tone = 'amber';
    if (x.key === 'requests' && me.asks_waiting) { badge = me.asks_waiting; tone = me.role === 'head' ? 'red' : 'amber'; }
    if (x.key === 'coupons' && !FLAGS.coupons) { badge = 'LATER'; tone = 'grey'; }
    const [bfg, bbg] = tone === 'red' ? ['#fff', '#E8442E'] : tone === 'grey' ? ['#C9CAD0', '#26262B'] : ['#0D0D0F', '#E8A100'];
    const href = owner ? `/${shop.slug}/${x.key}` : `/${x.key}`;
    return `<a href="${href}" class="${on ? '' : 'nav-i'}" style="display:flex;align-items:center;gap:10px;height:38px;flex:none;padding:0 12px;border-radius:10px;font-size:13px;text-decoration:none;${on ? 'background:#212125;font-weight:700;color:#fff' : 'font-weight:500;color:#9A9CA3'}">
      ${icon(IC[x.ic || x.key], 15, on ? 1.9 : 1.8)}
      <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.label)}</span>
      ${badge != null ? `<span class="num" style="font-size:10px;font-weight:700;border-radius:999px;padding:2px 7px;color:${bfg};background:${bbg}">${esc(badge)}</span>` : ''}
    </a>`;
  };
  const sub = owner ? `Owner · ${shop?.name || ''}` : `${ROLE_LABEL[me.role] || 'Staff'} · ${me.role === 'head' ? 'All cities' : CITY}`;
  const contact = me.email || me.phone || '';
  $('#rail').innerHTML = `
    <div style="display:flex;align-items:center;gap:9px;padding:0 8px">
      <span style="width:28px;height:28px;border-radius:8px;background:#E8442E;display:flex;align-items:center;justify-content:center;flex:none">${LOGO}</span>
      <span><span style="display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:14px;letter-spacing:.14em;text-transform:uppercase">Sterncut</span><span style="display:block;font-size:9px;letter-spacing:.16em;font-weight:700;color:#9A9CA3;margin-top:1px">${owner ? 'OWNER' : 'ADMIN'}</span></span>
    </div>
    ${owner && shop ? `<div style="display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:#17171A;border:1px solid #1E1E22">
      <span style="font-size:12.5px;font-weight:700">${esc(shop.name)}</span>
      <span style="font-size:10.5px;color:#9A9CA3">${esc(shop.address || '')}</span>
    </div>` : ''}
    <div style="flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:2px">${nav.map(item).join('')}</div>
    <div style="position:relative;flex:none">
      <div id="acct-menu" hidden>
        <div data-acct-close="1" style="position:fixed;inset:0;z-index:14"></div>
        <div style="position:absolute;left:0;right:0;bottom:62px;z-index:15;background:#1B1B1E;border:1px solid #2A2A30;border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.5);padding:6px;display:flex;flex-direction:column;gap:2px">
          <div style="padding:9px 10px 10px;display:flex;flex-direction:column;gap:2px;border-bottom:1px solid #26262B;margin-bottom:4px">
            <span style="font-size:12.5px;font-weight:700">${esc(me.name)}</span>
            <span style="font-size:11px;color:#9A9CA3">${esc(contact)}</span>
          </div>
          ${owner ? '' : `<span data-lock="1" class="hov2" style="display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border-radius:8px;font-size:12.5px;color:#C9CAD0;cursor:pointer">${icon(IC.lock, 14, 2)}Lock screen</span>`}
          <span data-signout="1" class="hov2" style="display:flex;align-items:center;gap:10px;height:34px;padding:0 10px;border-radius:8px;font-size:12.5px;color:#C9CAD0;cursor:pointer">${icon(IC.out, 14, 2)}Sign out</span>
        </div>
      </div>
      <div data-acct="1" class="hov" style="display:flex;align-items:center;gap:9px;padding:10px;border-radius:12px;background:#17171A;cursor:pointer">
        <span style="width:30px;height:30px;border-radius:999px;background:${me.role === 'head' ? '#E8442E' : '#212125'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none">${esc(initials(me.name))}</span>
        <span style="flex:1;min-width:0"><span style="display:block;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(me.name)}</span><span style="display:block;font-size:10px;color:#9A9CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sub)}</span></span>
        ${icon('M8 10l4-4 4 4M8 14l4 4 4-4', 13, 2, '#6B6B72')}
      </div>
    </div>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-acct]')) { const m = $('#acct-menu'); if (m) m.hidden = !m.hidden; }
  else if (e.target.closest('[data-acct-close]')) $('#acct-menu').hidden = true;
  else if (e.target.closest('[data-lock]')) lock();
  else if (e.target.closest('[data-signout]')) signOut(me?.kind === 'owner' ? 'owner' : 'staff');
  else if (e.target.closest('[data-pal]')) openPal();
});

export async function refreshMe() {
  if (me?.kind !== 'staff') return;
  Object.assign(me, await rpc('admin_me'));
  if ($('#rail')) drawRail(cur.key, cur.shop);
}

// ------------------------------------------------------------ small pages --
const loading = () => ({ top: false, html: '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6B6B72;font-size:12px">Loading…</div>' });
const failed = (e) => `<div style="padding:40px 28px;display:flex;flex-direction:column;gap:8px;max-width:640px">
  <span style="font-size:15px;font-weight:700">This page didn't load</span>
  <span style="font-size:12.5px;color:#9A9CA3;line-height:1.55">${esc(e.message)}</span>
  <span data-go="${esc(location.pathname + location.search)}" style="font-size:12px;font-weight:700;color:#E8442E">Try again</span></div>`;

// §1: "Nothing lives at {path}". Owners also see "Your account only sees {shop}."
function missing(path) {
  const owner = me.kind === 'owner';
  const note = owner ? `Your account only sees ${me.shops.map((s) => s.name).join(', ')}.` : 'Check the address, or search with ⌘K.';
  return { top: true, html: `
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px;text-align:center">
      <span style="font-size:56px;font-weight:800;color:#26262B;letter-spacing:-.02em">404</span>
      <span style="font-size:15px;font-weight:700">Nothing lives at ${esc(path)}</span>
      <span style="font-size:12.5px;color:#9A9CA3;max-width:420px;line-height:1.55">${esc(note)}</span>
      <a href="${home()}" style="margin-top:6px;font-size:12px;font-weight:700">Back to ${owner ? 'Today' : 'Overview'}</a>
    </div>` };
}

// the design's stub, for pages this site doesn't draw yet
function notBuilt(key, owner) {
  const held = key === 'coupons';
  const [fg, bg] = held ? TONE.grey : TONE.amber;
  const label = (owner ? OWNER_NAV : STAFF_NAV).find((x) => x.key === key)?.label || key;
  const lede = held
    ? 'Coupons & passes are held from v1. Their screens stay as the spec for later; the campaign desk that exists today is switched on with STERNCUT_FLAGS.coupons in config.js.'
    : 'This page isn’t on the website yet. Everything on it is in the Sterncut app today — Profile → Salon management.';
  return { top: true, html: `
    <div style="height:100%;overflow:auto"><div style="max-width:920px;padding:26px 28px 48px;display:flex;flex-direction:column;gap:18px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span style="font-size:22px;font-weight:800;letter-spacing:-.01em">${esc(label)}</span>
        <span style="font-size:9.5px;letter-spacing:.14em;font-weight:700;border-radius:999px;padding:4px 9px;color:${fg};background:${bg}">${held ? 'HELD FROM V1' : 'NOT BUILT YET'}</span>
      </div>
      <span style="font-size:13px;line-height:1.6;color:#9A9CA3;max-width:640px">${esc(lede)}</span>
    </div></div>` };
}

// ------------------------------------------------- the old console, framed --
// Path → the legacy hash route that draws it. Replaced section by section.
const LEGACY = [
  [/^\/wallets/, 'wallets'],
  [/^\/finance\/statements/, 'finance/statement'], [/^\/finance\/corrections/, 'finance/corrections'],
  [/^\/finance\/calls/, 'finance/calls'], [/^\/finance\/float\/transfers/, 'finance/handovers'],
  [/^\/finance\/float/, 'finance/float'], [/^\/finance/, 'finance'],
  [/^\/coupons/, 'coupons'],
  [/^\/settings\/deposit-bounds/, 'reliability/deposit'], [/^\/settings/, 'reliability'],
];
const LEGACY_SECTION = { appeals: 'reviews', reliability: 'settings', desk: 'support', invites: 'salons', salon: 'salons', booking: 'bookings' };
export function framed(path) { return { frame: (LEGACY.find(([re]) => re.test(path)) || [, 'overview'])[1] }; }

// the frame reports where it went, asks it hit, and a session it lost
addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data?.sterncut) return;
  const d = e.data;
  if (d.sterncut === 'signed-out') return signOut();
  if (d.sterncut === 'route') {
    const r = String(d.route || '');
    const key = LEGACY_SECTION[r.split('/')[0]] || r.split('/')[0];
    // a frame that walks into a section rebuilt here hands over to the native page
    if (me?.kind === 'staff' && NATIVE[key]) return go('/' + key);
    if (me?.kind === 'staff' && STAFF_NAV.some((x) => x.key === key) && location.pathname.split('/')[1] !== key) {
      history.replaceState(null, '', '/' + key);
      cur.key = key;
      drawRail(key);
    }
  }
  if (d.sterncut === 'gate') gateAnswer(d.message, d.rpc, d.args).catch(() => {});
});

// ------------------------------------------------------------------- toast --
// §6: white, bottom-centre, 2.2 s — "Downloaded" / "Copied" / "Sent to the printer"
export function toast(msg, ok = true) {
  const t = $('#toast') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'toast' }));
  t.innerHTML = `<div style="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:9px;background:#fff;color:#0D0D0F;border-radius:10px;padding:10px 14px;font:700 12px Inter,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.45);pointer-events:none;white-space:nowrap">
    ${ok ? icon('M5 12.5l4.5 4.5L19 7.5', 14, 2.6, '#0D0D0F') : icon('M12 8v5M12 16.5h.01M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 14, 2.4, '#E8442E')}${esc(msg)}</div>`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.innerHTML = ''; }, 2200);
}

// ------------------------------------------------------------------ dialog --
// A phone bottom sheet becomes a centred dialog (max-width 560, radius 20).
// A section passes `onClose` that returns to its parent URL (§3: every modal has one).
let dialogClose = null;
export function dialog(html, { onClose, width = 560 } = {}) {
  const o = $('#overlay');
  dialogClose = onClose || null;
  o.innerHTML = `<div data-dlg-bg="1" style="position:fixed;inset:0;z-index:25;background:rgba(5,5,6,.6);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box">
    <div id="dlg" style="width:100%;max-width:${width}px;max-height:100%;overflow:auto;background:#17171A;border:1px solid #26262B;border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.55);box-sizing:border-box">${html}</div></div>`;
  return $('#dlg');
}
export function closeDialog() {
  $('#overlay').innerHTML = '';
  const f = dialogClose; dialogClose = null; f?.();
}
document.addEventListener('mousedown', (e) => { if (e.target.dataset?.dlgBg) closeDialog(); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-dlg-close]')) closeDialog(); });

// ------------------------------------------------------------- the gate --
// SET-03: "Permissions change actions, not pages." A section calls act() for
// every gated write; above your role the database answers ask:<key> and nothing
// has changed. The ask carries your reasoning and the page you were on.
export async function act(fn, args = {}, opts = {}) {
  try { return await rpc(fn, args); } catch (e) {
    if (await gateAnswer(e.message, fn, args, opts)) throw Object.assign(e, { handled: true });
    throw e;
  }
}
async function gateAnswer(message, fn, args, opts = {}) {
  const m = /^(ask|deny):(\w+)/.exec(message || '');
  if (!m) return false;
  const a = ACTIONS[m[2]] || { label: 'This action' };
  if (m[1] === 'deny') { toast(`${ROLE_LABEL[me.role]} can’t do this: ${a.label[0].toLowerCase() + a.label.slice(1)}`, false); return true; }
  askDialog(fn, args, m[2], opts);
  return true;
}
const SHOP_KEYS = ['suspend_shop', 'refuse_shop', 'verify_licence'];
function askDialog(fn, args, key, { title, place, reason } = {}) {
  const a = ACTIONS[key] || { label: 'This action' };
  const what = title || a.label;
  const shop = SHOP_KEYS.includes(key);
  const d = dialog(`
    <div style="padding:20px;display:flex;flex-direction:column;gap:13px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:32px;height:32px;border-radius:9px;background:rgba(232,161,0,.14);display:flex;align-items:center;justify-content:center;flex:none"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E8A100" stroke-width="1.9"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg></span>
        <span style="flex:1;display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:700">${esc(head())} has to agree</span><span style="font-size:10.5px;color:#9A9CA3">${esc(what)}</span></span>
      </div>
      <span style="font-size:11.5px;line-height:1.5;color:#9A9CA3;border-top:1px solid #26262B;padding-top:12px">Your reasoning goes to ${esc(head())}, not the action. ${esc(head())} sees exactly the screen you were on.</span>
      <div style="background:#111113;border:1px solid #26262B;border-radius:11px;padding:12px 13px;display:flex;flex-direction:column;gap:7px">
        <span style="font-size:10px;letter-spacing:.13em;font-weight:700;color:#6B6B72">${shop ? 'WHY THIS SHOP, TODAY' : 'WHY, AND WHY TODAY'}</span>
        <textarea id="ask-why" rows="3" style="background:transparent;border:0;outline:0;resize:vertical;color:#fff;font-size:11.5px;line-height:1.5;padding:0">${esc(reason || '')}</textarea>
      </div>
      <span id="ask-err" style="font-size:11.5px;color:#F87171;display:none"></span>
      <span id="ask-send" style="height:42px;border-radius:999px;background:#E8442E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;letter-spacing:.06em;cursor:pointer">SEND TO ${esc(head().toUpperCase())}</span>
      <span style="font-size:10.5px;line-height:1.45;color:#6B6B72;text-align:center">Nothing happens${shop ? ' to the shop' : ''} until ${esc(head())} decides.</span>
    </div>`, { width: 420 });
  const why = $('#ask-why', d);
  why.focus();
  $('#ask-send', d).onclick = async () => {
    const err = $('#ask-err', d);
    if (!why.value.trim()) { err.textContent = 'Say why — the reasoning is what gets decided.'; err.style.display = 'block'; return; }
    try {
      const section = STAFF_NAV.find((x) => x.key === location.pathname.split('/')[1]);
      await rpc('admin_ask', { p_rpc: fn, p_args: args, p_title: what, p_reason: why.value.trim(),
        p_place: place || section?.label || null, p_path: location.pathname + location.search });
      closeDialog();
      toast(`Sent to ${head()} — nothing has happened yet`);
      refreshMe();
    } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
  };
}

// ?ask=<id> on any staff page: the ask this page is about. The Head decides
// here, on the screen the asker was on; everyone else sees it is waiting.
async function askBar() {
  const bar = $('#askbar');
  const id = new URLSearchParams(location.search).get('ask');
  if (!id || me?.kind !== 'staff') { bar.innerHTML = ''; return; }
  const r = await rpc('admin_requests').catch(() => null);
  const a = r && [...r.waiting, ...r.decided].find((x) => x.id === id);
  if (!a) { bar.innerHTML = ''; return; }
  const waiting = r.waiting.includes(a);
  const canDecide = waiting && me.role === 'head' && !a.mine;
  bar.innerHTML = `<div style="display:flex;align-items:center;gap:12px;padding:11px 24px;background:rgba(232,161,0,.08);border-bottom:1px solid rgba(232,161,0,.25)">
    ${icon(IC.requests, 15, 1.9, '#E8A100')}
    <span style="flex:1;min-width:0;font-size:12px;line-height:1.5"><b>${esc(a.mine ? 'You' : a.asked_by)} asked:</b> ${esc(a.title)} <span style="color:#9A9CA3">— “${esc(a.reason)}”</span></span>
    ${canDecide ? `<span data-decide="no" class="btn-s" style="height:32px;padding:0 14px;border-radius:9px;background:#212125;border:1px solid #3A3A40;display:flex;align-items:center;font-size:11px;font-weight:700;letter-spacing:.08em;cursor:pointer">REFUSE</span>
      <span data-decide="yes" class="btn-p" style="height:32px;padding:0 14px;border-radius:9px;background:#E8442E;display:flex;align-items:center;font-size:11px;font-weight:700;letter-spacing:.08em;cursor:pointer">DO IT</span>`
      : `<span style="font-size:11px;font-weight:700;color:#9A9CA3">${waiting ? `With ${esc(head())}` : a.state === 'done' ? 'Done' : a.state === 'refused' ? 'Refused' : 'Withdrawn'}</span>`}
  </div>`;
  if ($('#legacy').style.display === 'block') $('#legacy').style.top = bar.offsetHeight + 'px';
  bar.onclick = async (e) => {
    const b = e.target.closest('[data-decide]');
    if (!b) return;
    const yes = b.dataset.decide === 'yes';
    const note = yes ? null : prompt(`Refuse “${a.title}”. A line for ${a.asked_by} (optional):`);
    if (!yes && note === null) return;
    try {
      await rpc('admin_decide_ask', { p_ask: id, p_approve: yes, p_note: note });
      toast(yes ? 'Done' : 'Refused — nothing changed');
      await refreshMe();
      const u = new URL(location.href); u.searchParams.delete('ask');
      if (frame) frame.contentWindow.location.reload();
      go(u.pathname + u.search, { replace: true });
    } catch (err) { toast(err.message, false); }
  };
}

// ------------------------------------------------------------------ sign-in --
// §1: two tabs, a code step with six boxes that submits on the sixth digit.
// Not as drawn (see BACKLOG): owners sign in with their app email + password —
// app accounts have no verified phone and there is no SMS rail; staff give a
// password before the code — Supabase's authenticator is a second factor.
let counts = null;
function signInPage(error) {
  if (error) si.error = error;
  const staff = si.mode === 'staff';
  if (!counts) rpc('site_numbers').then((c) => { counts = c; const el = $('#si-counts'); if (el) el.textContent = countLine(); }).catch(() => {});
  const field = (id, label, type, ph, val, ac) => `
    <div style="display:flex;flex-direction:column;gap:8px">
      <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">${label}</span>
      <input id="${id}" type="${type}" value="${esc(val)}" placeholder="${ph}" autocomplete="${ac}" style="width:100%;height:46px;box-sizing:border-box;border-radius:10px;background:#17171A;border:1px solid ${si.error ? '#F87171' : '#26262B'};padding:0 14px;color:#fff;font-size:14px;outline:none">
    </div>`;
  return `
  <div style="position:fixed;inset:0;display:flex;overflow:auto">
    <div style="flex:1;min-width:380px;display:flex;align-items:center;justify-content:center;padding:48px 40px;box-sizing:border-box">
      <form id="si" style="width:100%;max-width:360px;display:flex;flex-direction:column;gap:24px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="width:32px;height:32px;border-radius:9px;background:#E8442E;display:flex;align-items:center;justify-content:center;flex:none">${LOGO}</span>
          <span style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;letter-spacing:.14em;text-transform:uppercase">Sterncut</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <span style="font-size:26px;font-weight:800;letter-spacing:-.01em">Sign in</span>
          <span style="font-size:13px;line-height:1.55;color:#9A9CA3">${staff
            ? 'Staff only — @sterncut.ma addresses. There is no sign-up and no password reset; the Head of Ops adds people on the team page.'
            : 'The same account as the Sterncut app on your phone — the same email and password.'}</span>
        </div>
        <div style="display:flex;gap:4px;padding:4px;background:#141416;border:1px solid #1E1E22;border-radius:11px">
          <span data-mode="staff" style="flex:1;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;cursor:pointer;background:${staff ? '#212125' : 'transparent'};color:${staff ? '#fff' : '#9A9CA3'}">Sterncut staff</span>
          <span data-mode="owner" style="flex:1;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;cursor:pointer;background:${staff ? 'transparent' : '#212125'};color:${staff ? '#9A9CA3' : '#fff'}">Shop owner</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${field('si-email', staff ? 'WORK EMAIL' : 'EMAIL', 'email', staff ? 'you@sterncut.ma' : 'you@example.com', si.email, 'username')}
          ${field('si-pw', 'PASSWORD', 'password', '', si.pw, 'current-password')}
          ${si.error ? `<span style="font-size:12px;line-height:1.5;color:#F87171">${esc(si.error)}</span>` : ''}
        </div>
        <button class="btn-p" style="height:46px;border:0;border-radius:10px;background:#E8442E;color:#fff;font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;opacity:${si.busy ? '.6' : '1'}">${si.busy ? 'One moment…' : staff ? 'Continue' : 'Sign in'}</button>
        ${staff ? `<div style="display:flex;gap:11px;align-items:flex-start;background:#141416;border:1px solid #1E1E22;border-radius:12px;padding:13px 14px">
          ${icon(IC.shield, 16, 2, '#E8A100')}
          <span style="font-size:11.5px;line-height:1.55;color:#9A9CA3">This console can read every customer’s phone number and move money. Sessions lock after 30 minutes idle.</span>
        </div>` : ''}
      </form>
    </div>
    <div style="width:42%;max-width:620px;min-width:320px;flex:none;background:#111113;border-left:1px solid #1E1E22;display:flex;flex-direction:column;justify-content:flex-end;gap:18px;padding:56px;box-sizing:border-box">
      <span id="si-counts" class="num" style="font-size:10px;letter-spacing:.18em;font-weight:700;color:#6B6B72">${countLine()}</span>
      <span style="font-family:'Playfair Display',serif;font-size:34px;line-height:1.22;font-weight:700;max-width:460px">Every number in here belongs to someone who trusted a barber with an afternoon.</span>
    </div>
  </div>`;
}
const countLine = () => (counts ? `${num(counts.salons)} SALON${counts.salons === 1 ? '' : 'S'} · ${num(counts.barbers)} COIFFEUR${counts.barbers === 1 ? '' : 'S'}` : '');

function bindSignIn() {
  document.querySelectorAll('[data-mode]').forEach((el) => { el.onclick = () => { si = { ...si, mode: el.dataset.mode, error: '' }; route(); }; });
  const form = $('#si');
  if (form) form.onsubmit = (e) => { e.preventDefault(); continueSignIn(); };
  const code = $('#code');
  if (code) {
    code.focus();
    code.oninput = () => {
      code.value = code.value.replace(/\D/g, '').slice(0, 6);
      drawBoxes(code.value);
      clearTimeout(bindSignIn.t);
      if (code.value.length === 6) bindSignIn.t = setTimeout(submitCode, 350);
    };
    code.onkeydown = (e) => { if (e.key === 'Enter') submitCode(); };
    $('#code-go').onclick = submitCode;
    $('#code-back').onclick = async () => { pending = null; await signOut('staff'); };
  }
}

async function continueSignIn() {
  const staff = si.mode === 'staff';
  si.email = $('#si-email').value.trim().toLowerCase();
  si.pw = $('#si-pw').value;
  const say = (m) => { si = { ...si, error: m, busy: false }; route(); };
  if (!si.email) return say(staff ? 'Enter your work email.' : 'Enter the email you use in the Sterncut app.');
  // no domain check before the password: the database's rule has an allowlist (0135)
  if (!staff && isStaffEmail(si.email)) return say('That’s a staff address — use the Sterncut staff tab.');
  if (!si.pw) return say('Enter your password.');
  si = { ...si, busy: true, error: '' }; route();
  try { await signInPassword(si.email, si.pw); } catch (e) {
    return say(/invalid/i.test(e.message) ? 'That email and password don’t match.' : e.message);
  }
  si.pw = '';
  try {
    if (!staff) {
      await whoami();
      if (!me) { forget(); return say('No shop is registered to that account. Owners sign in with the account they use in the app.'); }
      return finish();
    }
    // staff: an invite is claimed here, then the role is checked before the code step
    await rpc('admin_claim_invite').catch(() => false);
    const prof = await rest(`profiles?select=role&id=eq.${claims().sub}`);
    if (prof[0]?.role !== 'admin') {
      forget();
      return say(isStaffEmail(si.email) ? 'Nobody on the team uses that address. The Head of Ops adds people on the team page.'
        : 'Only @sterncut.ma addresses sign in here. Shop owners use the Shop owner tab.');
    }
    const fs = await totpFactors();
    const ok = fs.find((f) => f.status === 'verified');
    if (ok) pending = { factorId: ok.id };
    else {
      // a set-up that was started and never finished is thrown away first
      for (const f of fs) await api(`/auth/v1/factors/${f.id}`, { method: 'DELETE' }).catch(() => {});
      const en = await api('/auth/v1/factors', { method: 'POST', body: JSON.stringify({ factor_type: 'totp', friendly_name: 'Sterncut admin' }) });
      pending = { factorId: en.id, enroll: { qr: en.totp.qr_code, secret: en.totp.secret } };
    }
    si.busy = false;
    go('/sign-in/code');
  } catch (e) { say(e.message); }
}

function codePage(error) {
  const email = claims().email || si.email;
  const en = pending?.enroll;
  return `
  <div style="position:fixed;inset:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:48px 24px;box-sizing:border-box">
    <div style="width:100%;max-width:380px;display:flex;flex-direction:column;gap:24px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="width:32px;height:32px;border-radius:9px;background:#E8442E;display:flex;align-items:center;justify-content:center;flex:none">${LOGO}</span>
        <span style="font-family:'Playfair Display',serif;font-weight:700;font-size:16px;letter-spacing:.14em;text-transform:uppercase">Sterncut</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <span style="font-size:26px;font-weight:800;letter-spacing:-.01em">${en ? 'Set up your authenticator' : 'Six digits from your app'}</span>
        <span style="font-size:13px;color:#9A9CA3;line-height:1.55">${en ? 'Once, on this sign-in. Scan the code with Google Authenticator, 1Password or Authy, then type the six digits it shows.' : `Signing in as ${esc(email)}`}</span>
      </div>
      ${en ? `<div style="display:flex;gap:16px;align-items:center;background:#141416;border:1px solid #1E1E22;border-radius:14px;padding:14px">
        <img src="${esc(en.qr)}" alt="QR code for your authenticator" width="132" height="132" style="background:#fff;border-radius:8px;padding:6px;flex:none">
        <span style="display:flex;flex-direction:column;gap:6px;min-width:0"><span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72">OR TYPE THIS KEY</span>
          <span style="font-family:ui-monospace,Menlo,monospace;font-size:11.5px;word-break:break-all;color:#C9CAD0">${esc(en.secret)}</span></span>
      </div>` : ''}
      <div style="position:relative;display:flex;gap:9px" id="boxes">${boxes('')}</div>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" aria-label="Six-digit code" style="position:absolute;opacity:0;width:1px;height:1px;border:0;padding:0">
      ${error ? `<span style="font-size:12px;color:#F87171;margin-top:-12px">${esc(error)}</span>` : ''}
      <span id="code-go" class="btn-p" style="height:46px;border-radius:10px;background:#E8442E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">Sign in</span>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:11.5px;line-height:1.55;color:#9A9CA3"><span style="font-weight:700;color:#fff">Lost your phone?</span><span>The Head of Ops re-enrols you in person. There are no backup codes by email — an emailed code is a stolen inbox away from every customer’s number.</span></div>
      <span id="code-back" style="align-self:flex-start;font-size:12px;font-weight:600;color:#9A9CA3;cursor:pointer">← Use a different address</span>
    </div>
  </div>`;
}
const boxes = (v, big = true) => [0, 1, 2, 3, 4, 5].map((i) => `<span style="flex:1;height:${big ? 54 : 50}px;border-radius:${big ? 12 : 11}px;background:${big ? '#141416' : '#111113'};border:1.5px solid ${i === Math.min(v.length, 5) ? '#E8442E' : v[i] ? '#3A3A40' : '#26262B'};box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:${big ? 22 : 20}px;font-weight:700;font-variant-numeric:tabular-nums;cursor:text" data-focus-code="1">${v[i] || ''}</span>`).join('');
function drawBoxes(v, big = true) { const b = $('#boxes'); if (b) b.innerHTML = boxes(v, big); }
document.addEventListener('click', (e) => { if (e.target.closest('[data-focus-code]')) $('#code')?.focus(); });

async function submitCode() {
  const code = $('#code')?.value || '';
  if (code.length !== 6) return;
  try {
    await verifyCode(pending.factorId, code);
  } catch (e) {
    root.innerHTML = codePage(/invalid|expired/i.test(e.message) ? 'That code didn’t match. Codes change every 30 seconds.' : e.message);
    return bindSignIn();
  }
  pending = null;
  await whoami();
  if (!me) { forget(); si.error = 'That account isn’t on the team.'; return go('/sign-in', { replace: true }); }
  finish();
}
function finish() {
  const next = sessionStorage.getItem('sc_next');
  sessionStorage.removeItem('sc_next');
  root.innerHTML = '';
  go(next || home(), { replace: true });
  if (me.kind === 'staff') armIdle();
}

// ------------------------------------------------------------------- lock --
// OVW-05: after 30 min idle, or from the account menu. The page underneath is
// untouched; the code is a real second-factor check, not a screen saver.
function lock() {
  if (me?.kind !== 'staff') return;
  localStorage.setItem('sc_locked', '1');
  const label = document.title.split(' · ')[0];
  $('#acct-menu') && ($('#acct-menu').hidden = true);
  closePal();
  const o = document.createElement('div');
  o.id = 'lock';
  o.innerHTML = `<div style="position:fixed;inset:0;z-index:30;background:rgba(13,13,15,.8);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box">
    <div style="width:100%;max-width:380px;background:#17171A;border:1px solid #26262B;border-radius:18px;padding:28px;box-sizing:border-box;display:flex;flex-direction:column;gap:20px;box-shadow:0 30px 80px rgba(0,0,0,.55)">
      <span style="width:44px;height:44px;border-radius:999px;background:rgba(232,68,46,.14);display:flex;align-items:center;justify-content:center;color:#E8442E">${icon(IC.lock, 20, 2)}</span>
      <div style="display:flex;flex-direction:column;gap:7px">
        <span style="font-size:19px;font-weight:800">Locked after 30 minutes</span>
        <span style="font-size:12.5px;line-height:1.55;color:#9A9CA3">Nothing was lost — whatever you were typing on ${esc(label || 'this page')} is still there, exactly as you left it.</span>
      </div>
      <div style="display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:12px;background:#111113;border:1px solid #1E1E22">
        <span style="width:32px;height:32px;border-radius:999px;background:${me.role === 'head' ? '#E8442E' : '#212125'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex:none">${esc(initials(me.name))}</span>
        <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:12.5px;font-weight:700">${esc(me.name)}</span><span style="font-size:11px;color:#9A9CA3">${esc(me.email)}</span></span>
      </div>
      <div style="position:relative;display:flex;gap:8px" id="boxes">${boxes('', false)}</div>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" aria-label="Six-digit code" style="position:absolute;opacity:0;width:1px;height:1px;border:0;padding:0">
      <span id="lock-err" style="font-size:12px;color:#F87171;display:none;margin-top:-10px"></span>
      <span id="unlock" class="btn-p" style="height:46px;border-radius:10px;background:#E8442E;color:#fff;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer">Unlock with your code</span>
      <span id="lock-out" style="align-self:center;font-size:12px;font-weight:600;color:#9A9CA3;cursor:pointer">Sign out instead</span>
    </div></div>`;
  document.body.appendChild(o);
  const code = $('#code', o);
  code.focus();
  const unlock = async () => {
    if (code.value.length !== 6) return;
    try {
      const f = (await totpFactors()).find((x) => x.status === 'verified');
      await verifyCode(f.id, code.value);
      localStorage.removeItem('sc_locked');
      o.remove(); armIdle();
    } catch {
      code.value = ''; drawBoxes('', false);
      const err = $('#lock-err', o); err.textContent = 'That code didn’t match. Codes change every 30 seconds.'; err.style.display = 'block';
    }
  };
  code.oninput = () => {
    code.value = code.value.replace(/\D/g, '').slice(0, 6);
    drawBoxes(code.value, false);
    clearTimeout(lock.t);
    if (code.value.length === 6) lock.t = setTimeout(unlock, 350);
  };
  $('#unlock', o).onclick = unlock;
  $('#lock-out', o).onclick = () => { o.remove(); signOut('staff'); };
}
let idleT = null;
function armIdle() {
  clearTimeout(idleT);
  if (me?.kind === 'staff' && !$('#lock')) idleT = setTimeout(lock, IDLE_MS);
}
['mousemove', 'keydown', 'mousedown', 'wheel'].forEach((ev) => addEventListener(ev, () => { if (idleT) armIdle(); }, { passive: true }));

// -------------------------------------------------------------------- ⌘K --
// OVW-06: grouped results, ↑↓ / ↵ / Esc. A phone number (6+ digits) is looked
// up through admin_find, which writes the lookup to the audit trail.
let pal = null;
function openPal() {
  if (!me || $('#lock')) return;
  pal = { q: '', sel: 0, groups: [], flat: [], logged: false };
  const o = $('#overlay');
  o.innerHTML = `<div id="pal-bg" style="position:fixed;inset:0;z-index:20;background:rgba(5,5,6,.6);display:flex;justify-content:center;align-items:flex-start;padding:72px 24px 24px;box-sizing:border-box">
    <div style="width:100%;max-width:620px;max-height:100%;background:#141416;border:1px solid #2A2A30;border-radius:16px;box-shadow:0 30px 90px rgba(0,0,0,.6);overflow:hidden;display:flex;flex-direction:column">
      <div style="height:54px;flex:none;display:flex;align-items:center;gap:12px;padding:0 16px 0 18px;border-bottom:1px solid #1E1E22">
        ${icon(IC.search, 16, 2, '#9A9CA3')}
        <input id="pal-q" autocomplete="off" placeholder="${me.kind === 'owner' ? 'Search your pages…' : 'Search shops, barbers, a customer’s phone…'}" style="flex:1;min-width:0;height:100%;background:transparent;border:0;outline:0;color:#fff;font-size:15px">
        <span style="flex:none;font-family:ui-monospace,Menlo,monospace;font-size:10px;background:#26262B;border-radius:4px;padding:3px 6px;color:#9A9CA3">ESC</span>
      </div>
      <div id="pal-log"></div>
      <div id="pal-list" style="flex:1;min-height:0;overflow:auto;padding:4px 8px 10px;display:flex;flex-direction:column"></div>
      <div style="flex:none;display:flex;align-items:center;gap:14px;padding:10px 18px;border-top:1px solid #1E1E22;font-size:10.5px;color:#6B6B72">
        <span style="display:flex;align-items:center;gap:6px"><span style="font-family:ui-monospace,Menlo,monospace;background:#26262B;border-radius:4px;padding:2px 5px;color:#9A9CA3">↵</span>open</span>
        <span style="display:flex;align-items:center;gap:6px"><span style="font-family:ui-monospace,Menlo,monospace;background:#26262B;border-radius:4px;padding:2px 5px;color:#9A9CA3">↑↓</span>move</span>
        <span style="flex:1"></span><span>${me.kind === 'owner' ? `Only ${esc(me.shops.map((s) => s.name).join(', '))}` : 'Phone searches are logged'}</span>
      </div>
    </div></div>`;
  const inp = $('#pal-q');
  inp.focus();
  inp.oninput = () => { pal.q = inp.value; pal.sel = 0; searchPal(); };
  inp.onkeydown = (e) => {
    const n = pal.flat.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); pal.sel = n ? (pal.sel + 1) % n : 0; drawPal(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); pal.sel = n ? (pal.sel - 1 + n) % n : 0; drawPal(); }
    else if (e.key === 'Enter') { const it = pal.flat[pal.sel]; if (it) go(it.to); }
  };
  $('#pal-bg').onmousedown = (e) => { if (e.target.id === 'pal-bg') closePal(); };
  searchPal();
}
function closePal() { if (pal) { pal = null; $('#overlay') && ($('#overlay').innerHTML = ''); } }
function pages(nq) {
  const owner = me.kind === 'owner', shop = cur.shop || me.shops?.[0];
  return (owner ? OWNER_NAV : STAFF_NAV).filter((x) => !nq || x.label.toLowerCase().includes(nq)).map((x) => ({
    title: x.label, sub: owner ? shop.name : 'Page', icon: IC[x.ic || x.key],
    to: owner ? `/${shop.slug}/${x.key}` : `/${x.key}` }));
}
async function searchPal() {
  const q = pal.q.trim(), nq = q.toLowerCase();
  if (!q) { pal.groups = [{ label: 'JUMP TO', items: pages('') }]; pal.logged = false; return drawPal(); }
  if (me.kind === 'owner') {
    const p = pages(nq); pal.groups = p.length ? [{ label: 'PAGES', items: p }] : []; return drawPal();
  }
  clearTimeout(searchPal.t);
  searchPal.t = setTimeout(async () => {
    const mine = pal;
    const r = q.length < 2 ? null : await rpc('admin_find', { p_q: q }).catch(() => null);
    if (mine !== pal) return;          // closed or retyped meanwhile
    const tag = (s) => ({ live: null, pending: ['PENDING', 'amber'], suspended: ['SUSPENDED', 'red'], rejected: ['REFUSED', 'grey'], closed: ['CLOSED', 'grey'] }[s]);
    const g = [];
    const logged = r?.logged ? { tag: 'LOGGED', tone: 'amber' } : {};
    const cust = (r?.people || []).filter((p) => p.role === 'customer');
    if (cust.length) g.push({ label: 'CUSTOMERS', items: cust.map((p) => ({ title: p.name, sub: [p.phone, 'Bookings, wallet and cases'].filter(Boolean).join(' · '), initials: initials(p.name), to: `/customers/${p.id}`, ...logged })) });
    if (r?.salons.length) g.push({ label: 'SALONS', items: r.salons.map((s) => ({ title: s.name, sub: [s.district || s.address, s.owner].filter(Boolean).join(' · '), initials: initials(s.name), square: true, to: `/salons/${s.slug}`, ...(tag(s.status) ? { tag: tag(s.status)[0], tone: tag(s.status)[1] } : {}) })) });
    const one = r?.salons.length === 1 ? r.salons[0] : null;
    const bs = (r?.barbers || []).filter((b) => (one ? b.salon_slug === one.slug : b.name.toLowerCase().includes(nq)))
      .map((b) => ({ title: b.name, sub: [b.salon, b.is_owner ? 'owner' : null].filter(Boolean).join(' · '), initials: initials(b.name), to: `/barbers/${b.id}` }));
    // a barber found by phone is a barber, not a customer; staff never show here
    for (const p of (r?.people || []).filter((x) => x.role === 'barber')) {
      if (!bs.some((b) => b.to.endsWith(p.id))) bs.push({ title: p.name, sub: p.phone, initials: initials(p.name), to: `/barbers/${p.id}`, ...logged });
    }
    if (bs.length) g.push({ label: one ? `BARBERS AT THAT SHOP · ${bs.length}` : 'BARBERS', items: bs });
    const p = pages(nq);
    if (p.length) g.push({ label: 'PAGES', items: p });
    pal.groups = g; pal.logged = !!r?.logged;
    drawPal();
  }, 180);
}
function drawPal() {
  if (!pal) return;
  let i = 0;
  pal.flat = [];
  $('#pal-log').innerHTML = pal.logged ? `<div style="flex:none;display:flex;align-items:center;gap:9px;padding:9px 18px;background:rgba(232,161,0,.08);border-bottom:1px solid rgba(232,161,0,.2);font-size:11.5px;color:#E8A100">
    ${icon('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 14, 2)}Looking up a phone number is written to the audit trail, with your name.</div>` : '';
  $('#pal-list').innerHTML = pal.groups.length ? pal.groups.map((g) => `
    <div style="display:flex;flex-direction:column;gap:1px;padding-top:6px">
      <span style="font-size:9.5px;letter-spacing:.15em;font-weight:700;color:#6B6B72;padding:6px 10px 5px">${esc(g.label)}</span>
      ${g.items.map((it) => {
        const idx = i++; pal.flat.push(it);
        const sel = idx === pal.sel, [fg, bg] = TONE[it.tone || 'grey'];
        return `<div data-pal-i="${idx}" style="display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:10px;cursor:pointer;background:${sel ? '#212125' : 'transparent'}">
          <span style="width:30px;height:30px;border-radius:${it.square ? '8px' : '999px'};background:#212125;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#C9CAD0;flex:none">${it.initials ? esc(it.initials) : icon(it.icon, 14, 1.9)}</span>
          <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.title)}</span><span style="font-size:11px;color:#9A9CA3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.sub || '')}</span></span>
          ${it.tag ? `<span style="flex:none;font-size:9px;letter-spacing:.12em;font-weight:700;border-radius:6px;padding:4px 7px;color:${fg};background:${bg}">${esc(it.tag)}</span>` : ''}
          ${sel ? '<span style="flex:none;font-size:12px;color:#6B6B72">↵</span>' : ''}
        </div>`;
      }).join('')}
    </div>`).join('') : '<div style="padding:28px 12px;text-align:center;font-size:12.5px;color:#6B6B72">Nothing matches that. Try a shop, a barber or a phone number.</div>';
  $('#pal-list').onclick = (e) => { const el = e.target.closest('[data-pal-i]'); if (el) go(pal.flat[+el.dataset.palI].to); };
  $('#pal-list').onmousemove = (e) => { const el = e.target.closest('[data-pal-i]'); if (el && +el.dataset.palI !== pal.sel) { pal.sel = +el.dataset.palI; drawPal(); } };
}
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    if (me && !$('#lock')) { e.preventDefault(); pal ? closePal() : openPal(); }
  } else if (e.key === 'Escape') {
    if (pal) closePal();
    else if ($('#overlay')?.innerHTML) closeDialog();
    else if ($('#acct-menu') && !$('#acct-menu').hidden) $('#acct-menu').hidden = true;
  }
});

// ------------------------------------------------------------------- boot --
(async () => {
  try { await whoami(); } catch { forget(); }
  if (!me && sess && isStaffEmail(claims().email) && claims().aal !== 'aal2') {
    // came back mid sign-in: straight to the code step
    const f = await totpFactors().catch(() => []);
    const ok = f.find((x) => x.status === 'verified');
    if (ok) { pending = { factorId: ok.id }; history.replaceState(null, '', '/sign-in/code'); }
    else forget();
  }
  await route();
  if (me?.kind === 'staff') { if (localStorage.getItem('sc_locked')) lock(); else armIdle(); }
})();
