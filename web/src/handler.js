// The queue page's one entry point: a plain Request in, a Response out, so it
// runs on any host that speaks fetch. `functions/q/[[path]].js` and
// `functions/c/[[path]].js` are the Cloudflare Pages adapters, `dev.mjs` the local one.
//
// ADDENDUM-app-first (turn Q3) — anonymous eyes on the web, named places in the
// app or from the barber's board:
//
//   GET  /q/:shop                QL-18 the line (?b= highlights a chair), QL-26 closed, QL-09 paused
//   GET  /q/:shop?sig=1          what QL-18's 20 s poll compares
//   GET  /q/:shop/app            the store, with the shop remembered across the install
//   GET  /q/:shop/name           QL-23, not at the shop       POST → a name on the line, a text
//   GET  /q/:shop/t/:ticket      QL-24 unconfirmed, QL-25 confirmed
//   POST /q/:shop/t/:ticket/leave  QL-25's "Give up my place"
//   GET  /c/:token               the tap in the text → QL-25
//   GET  /.well-known/…          the app-link files
//
// Every step re-reads the database: a quote is never trusted across a step.

import { en } from './copy.js';
import { renderConfirmed, renderEnded, renderName, renderUnconfirmed } from './guest.js';
import {
  clock, renderDown, renderLinkPreview, renderMissing, renderNoStore, renderQueue, renderUnknownLink,
  signature, taking, waitOf,
} from './render.js';

// 0110's alphabet — no I, O, 0 or 1 — six characters for a shop, four for a
// barber. A uuid still opens a shop's page: every poster printed before 0110
// carries one. Everything past the landing takes the code alone.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHOP = new RegExp(`^([A-HJ-NP-Z2-9]{6}|${UUID})$`, 'i');
const SHOP_CODE = /^[A-HJ-NP-Z2-9]{6}$/i;
const BARBER = new RegExp(`^([A-HJ-NP-Z2-9]{4}|${UUID})$`, 'i');
const BARBER_CODE = /^[A-HJ-NP-Z2-9]{4}$/i;
const SERVICE = new RegExp(`^${UUID}$`, 'i');
const TOKEN = /^[0-9a-f]{12}$/;
// Link-preview fetchers open a link without anybody tapping it. A confirm link
// is a promise that somebody tapped, so they are shown a page and change nothing.
const PREVIEWER = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord|skype|embedly|vkshare|pinterest|google-?read|headless/i;

const ROUTES = {
  'GET ': shopPage,
  'GET app': store,
  'GET name': nameForm,
  'POST name': join,
  'GET t': ticketPage,
  'POST t/leave': giveUp,
};

/**
 * `env` carries SUPABASE_URL, SUPABASE_ANON_KEY and, for the walk-in's steps,
 * SUPABASE_SERVICE_ROLE_KEY; for the store, ANDROID_PACKAGE and IOS_APP_STORE_ID;
 * PUBLIC_ORIGIN when the host serves under another name than the texts should
 * link to. SMS_SENDS turns QL-23 on: until texts really go out, a name put on from
 * the web could never be confirmed, and the page would say "we just texted you"
 * about a text that sits in sms_outbox — so the link is not offered at all. `deps.rpc` replaces the database (the preview and the checks),
 * `deps.clientIp` says who is asking, `deps.onError` where a failure is reported.
 */
export async function handle(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/.well-known/')) return appLinks(url.pathname, env);
  const call = deps.rpc ?? ((name, args) => rpc(env, name, args));
  const report = deps.onError ?? console.error;
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(1);

  if (parts[0] === 'c') {
    if (parts.length !== 2 || !TOKEN.test(parts[1] ?? '')) return page(renderMissing(), 404);
    if (method !== 'GET') return new Response('Method not allowed', { status: 405 });
    try {
      return await confirm({ request, url, env, call, token: parts[1] });
    } catch (err) {
      report(`queue page: ${err?.message ?? err}`);
      return page(renderDown(), 503);
    }
  }

  const [root, shopRaw, ...rest] = parts;
  if (root !== 'q' || !shopRaw || !SHOP.test(shopRaw)) return page(renderMissing(), 404);

  const withToken = rest[0] === 't';
  const key = [rest[0], ...rest.slice(withToken ? 2 : 1)].filter(Boolean).join('/');
  const route = ROUTES[`${method} ${key}`];
  if (!route) {
    const known = Object.keys(ROUTES).some((r) => r.slice(r.indexOf(' ') + 1) === key);
    return known ? new Response('Method not allowed', { status: 405 }) : page(renderMissing(), 404);
  }
  if (key && !SHOP_CODE.test(shopRaw)) return page(renderMissing(), 404);
  if (withToken && !TOKEN.test(rest[1] ?? '')) return page(renderMissing(), 404);

  const ctx = {
    request,
    url,
    env,
    call,
    shop: key ? shopRaw.toUpperCase() : shopRaw,
    token: rest[1],
    ip: deps.clientIp ? deps.clientIp(request) : request.headers.get('cf-connecting-ip'),
  };
  try {
    return await route(ctx);
  } catch (err) {
    report(`queue page: ${err?.message ?? err}`);
    return page(renderDown(), 503);
  }
}

const barberParam = (url) => {
  const b = url.searchParams.get('b');
  return b && BARBER.test(b) ? b : null;
};
const sourceOf = (value) => (value === 'link' ? 'link' : 'code');
const lineOf = (shop, barber) => `/q/${shop}${barber ? `?b=${barber}` : ''}`;
/** QL-23 is offered only once its confirm text can really be sent (see handle's note). */
const remoteOn = (env) => ['1', 'true', 'on'].includes(String(env.SMS_SENDS ?? '').toLowerCase());

// ---- QL-18 / QL-26 / QL-09 ---------------------------------------------------------
async function shopPage({ url, env, call, shop }) {
  const barber = barberParam(url);
  const data = await call('public_queue', { p_shop: shop, p_barber: barber });
  if (url.searchParams.has('sig')) {
    return new Response(data?.found ? signature(data) : '', {
      status: data?.found ? 200 : 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  if (!data?.found) return page(renderMissing(), 404);
  // a barber's text carries ?b=; the poster never does (A1)
  return page(renderQueue(data, { url, src: barber ? 'link' : 'code', remote: remoteOn(env) }), 200);
}

// ---- QL-18 → QL-20: the store, with the shop carried across the install ----------------
// Android: Google Play hands `referrer` to the app on its first open
// (expo-application's getInstallReferrerAsync), so QL-21 opens on this shop.
// iOS has no such thing; the App Store opens plain. With the app already
// installed, the app-link files claim this address and the store never shows.
function store({ request, url, env, shop }) {
  const b = url.searchParams.get('b');
  const barber = b && BARBER_CODE.test(b) ? b.toUpperCase() : null;
  const ua = request.headers.get('user-agent') ?? '';
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return env.IOS_APP_STORE_ID
      ? redirect(`https://apps.apple.com/app/id${encodeURIComponent(env.IOS_APP_STORE_ID)}`, 302)
      : page(renderNoStore(shop), 200);
  }
  const referrer = `sterncut_shop=${shop}${barber ? `&sterncut_barber=${barber}` : ''}`;
  const pkg = env.ANDROID_PACKAGE || 'com.sterncut.app';
  return redirect(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`
    + `&referrer=${encodeURIComponent(referrer)}`, 302);
}

// ---- QL-23 --------------------------------------------------------------------------
/** The chair QL-23 names and the service it writes, read fresh. Null when there is none to offer. */
function pickChair(data, code) {
  if (!data?.found || !data.open || data.shut) return null;
  const open = data.chairs.filter(taking);
  const chair = code
    ? open.find((c) => c.code === code.toUpperCase())
    : [...open].sort((a, b) => waitOf(a) - waitOf(b))[0];
  const service = chair?.services.find((s) => s.wait_min != null);
  return chair && service ? { chair, service } : null;
}

async function nameForm({ url, env, call, shop }) {
  const b = url.searchParams.get('b');
  const barber = b && BARBER_CODE.test(b) ? b : null;
  if (!remoteOn(env)) return redirect(lineOf(shop, barber));
  const data = await call('public_queue', { p_shop: shop, p_barber: barber });
  if (!data?.found) return page(renderMissing(), 404);
  const pick = pickChair(data, barber);
  // closed, paused, or the chair stopped taking anyone: the line says which
  if (!pick) return redirect(lineOf(shop, barber));
  return page(renderName(data, pick.chair, pick.service, { src: sourceOf(url.searchParams.get('src')) }), 200);
}

async function join({ request, url, env, call, shop, ip }) {
  const form = await request.formData();
  const b = String(form.get('b') ?? '');
  const s = String(form.get('s') ?? '');
  const src = sourceOf(form.get('src'));
  const values = { first_name: String(form.get('first_name') ?? ''), phone: String(form.get('phone') ?? '') };
  if (!remoteOn(env) || !BARBER_CODE.test(b)) return redirect(lineOf(shop, null));

  const r = await call('guest_join', {
    p_shop: shop, p_barber: b, p_service: SERVICE.test(s) ? s : null,
    p_first_name: values.first_name, p_phone: values.phone, p_ip: ip, p_source: src,
    p_base: env.PUBLIC_ORIGIN || url.origin,
  });
  if (r.state === 'joined') return redirect(`/q/${r.shop || shop}/t/${r.ticket}`);

  const refusal = r.state === 'invalid' ? [{ field: r.field }, 422]
    : r.state === 'limited' ? [{ limited: clock(new Date(r.retry_at)) }, 429]
      : r.state === 'already' ? [{ already: true }, 409]
        : null;
  if (refusal) {
    const data = await call('public_queue', { p_shop: shop, p_barber: b });
    const pick = pickChair(data, b);
    if (pick) return page(renderName(data, pick.chair, pick.service, { src, values, error: refusal[0] }), refusal[1]);
  }
  return redirect(lineOf(shop, b));
}

// ---- QL-24 · QL-25 ------------------------------------------------------------------
function ticketResponse(tk, token) {
  switch (tk.stage) {
    case 'held': return page(renderUnconfirmed(tk), 200);
    case 'waiting':
    case 'called': return page(renderConfirmed(tk, { token }), 200);
    case 'in_chair': return page(renderEnded('started', { shop: tk.shop_code }), 200);
    case 'done': return page(renderEnded('done', { shop: tk.shop_code }), 200);
    case 'left': return page(renderEnded('left', { shop: tk.shop_code }), 200);
    default: return page(renderEnded('gone', { shop: tk.shop_code }), 200);
  }
}

async function ticketPage({ call, token }) {
  const tk = await call('guest_ticket', { p_token: token });
  if (!tk?.found) return page(renderMissing(), 404);
  return ticketResponse(tk, token);
}

async function giveUp({ call, shop, token }) {
  await call('guest_give_up', { p_ticket: token });
  // the ticket page says what happened: left, started, or gone
  return redirect(`/q/${shop}/t/${token}`);
}

// ---- /c/:token · the tap in the text -------------------------------------------------
async function confirm({ request, url, env, call, token }) {
  // a HEAD, or a preview fetcher, never confirms: only a person opening the link does
  if (request.method === 'HEAD' || PREVIEWER.test(request.headers.get('user-agent') ?? '')) {
    return page(renderLinkPreview(), 200);
  }
  const r = await call('guest_confirm', { p_token: token });
  if (r.state === 'confirmed') {
    const tk = await call('guest_ticket', { p_token: r.ticket });
    if (tk?.found) return ticketResponse(tk, r.ticket);
  }
  if ((r.state === 'expired' || r.state === 'gone') && r.shop) {
    // not an error page: the line as it is now, and why the link did nothing
    const data = await call('public_queue', { p_shop: r.shop, p_barber: null });
    if (data?.found) {
      const notice = r.state === 'expired' ? en.linkRanOut : en.linkGone;
      return page(renderQueue(data, { url: new URL(`/q/${data.code}`, url), notice, remote: remoteOn(env) }), 200);
    }
  }
  return page(renderUnknownLink(), 404);
}

// ---- the app-link files: a shop's link opens the app when it is installed -----------
// The same shapes app.config.js claims: the landing, a pre-0110 poster's uuid, and
// the store hand-off (so an installed app opens instead of the store). Everything
// else stays in the browser. Served only when the host is given the app's identity —
// ANDROID_CERT_SHA256 (comma-separated) and IOS_APP_ID (TEAMID.com.sterncut.app).
const LANDINGS = ['/q/??????', '/q/????????-????-????-????-????????????', '/q/??????/app'];

function appLinks(pathname, env) {
  if (pathname === '/.well-known/assetlinks.json' && env.ANDROID_CERT_SHA256) {
    return jsonResponse([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: env.ANDROID_PACKAGE || 'com.sterncut.app',
        sha256_cert_fingerprints: env.ANDROID_CERT_SHA256.split(',').map((f) => f.trim()).filter(Boolean),
      },
    }], 200);
  }
  if (pathname === '/.well-known/apple-app-site-association' && env.IOS_APP_ID) {
    return jsonResponse({
      applinks: { details: [{ appIDs: [env.IOS_APP_ID], components: LANDINGS.map((p) => ({ '/': p })) }] },
    }, 200);
  }
  return page(renderMissing(), 404);
}

// ---- plumbing ------------------------------------------------------------------------
function page(html, status) {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // live numbers: a cached page is a wrong wait
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      // a confirm address must not travel to the font host in a Referer
      'referrer-policy': 'no-referrer',
    },
  });
}

function redirect(location, status = 303) {
  return new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function rpc(env, name, args) {
  // the walk-in's calls are the server's alone: 0111 and 0118 grant them to service_role
  const service = name.startsWith('guest_');
  const key = service ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  if (!env.SUPABASE_URL || !key) {
    throw new Error(`SUPABASE_URL and ${service ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_ANON_KEY'} must be set`);
  }
  const headers = { apikey: key, 'content-type': 'application/json' };
  // a legacy JWT key goes in Authorization as well; the newer sb_ keys must not
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}
