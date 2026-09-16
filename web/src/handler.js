// The queue page's one entry point: a plain Request in, a Response out, so it
// runs on any host that speaks fetch. `functions/q/[[path]].js` is the
// Cloudflare Pages adapter, `dev.mjs` the local one.
//
//   GET  /q/:shop                  QL-08, or QL-03 with ?b=, QL-09, or QL-17 when shut
//   GET  /q/:shop/join             QL-04      POST → a code is texted
//   GET  /q/:shop/code/:token      QL-05      POST → the four digits (QL-11, QL-12)
//   POST /q/:shop/code/:token/resend | drop | switch
//   GET  /q/:shop/t/:ticket        QL-06, QL-13 called, QL-15 frozen, QL-14 missed
//   POST /q/:shop/t/:ticket/leave  → a code first
//   POST /q/:shop/t/:ticket/rejoin → QL-14's way back, no code
//   POST /q/:shop/t/:ticket/coming QL-13's "I'm walking in"
//   POST /q/:shop/t/:ticket/wait   QL-13's "Give me 5 minutes", once
//   GET  /.well-known/…            option (b)'s app-link files
//
// Every step re-reads the database: a quote is never trusted across a step.

import { en, fill } from './copy.js';
import {
  renderCalled, renderCode, renderEnded, renderJoin, renderLetGo, renderMissed, renderOneLine,
  renderTicket, requote,
} from './guest.js';
import { clock, renderDown, renderMissing, renderQueue } from './render.js';

// 0110's alphabet — no I, O, 0 or 1 — six characters for a shop, four for a
// barber. A uuid still opens a shop's page: every poster printed before 0110
// carries one. The walk-in's own steps use the code alone.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHOP = new RegExp(`^([A-HJ-NP-Z2-9]{6}|${UUID})$`, 'i');
const SHOP_CODE = /^[A-HJ-NP-Z2-9]{6}$/i;
const BARBER = new RegExp(`^([A-HJ-NP-Z2-9]{4}|${UUID})$`, 'i');
const BARBER_CODE = /^[A-HJ-NP-Z2-9]{4}$/i;
const SERVICE = new RegExp(`^${UUID}$`, 'i');
const TOKEN = /^[0-9a-f]{12}$/;

const ROUTES = {
  'GET ': shopPage,
  'GET join': joinForm,
  'POST join': join,
  'GET code': codePage,
  'POST code': verify,
  'POST code/resend': resend,
  'POST code/drop': drop,
  'POST code/switch': switchLine,
  'GET t': ticketPage,
  'POST t/leave': leave,
  'POST t/rejoin': rejoin,
  'POST t/coming': coming,
  'POST t/wait': waitFive,
};

/**
 * `env` carries SUPABASE_URL, SUPABASE_ANON_KEY and, for the walk-in's steps,
 * SUPABASE_SERVICE_ROLE_KEY. `deps.rpc` replaces the database (the preview and
 * the checks), `deps.clientIp` says who is asking, `deps.onError` where a
 * failure is reported.
 */
export async function handle(request, env = {}, deps = {}) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/.well-known/')) return appLinks(url.pathname, env);
  const [root, shopRaw, ...rest] = url.pathname.replace(/\/+$/, '').split('/').slice(1);
  if (root !== 'q' || !shopRaw || !SHOP.test(shopRaw)) return page(renderMissing(), 404);

  const withToken = rest[0] === 'code' || rest[0] === 't';
  const key = [rest[0], ...rest.slice(withToken ? 2 : 1)].filter(Boolean).join('/');
  const method = request.method === 'HEAD' ? 'GET' : request.method;
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
    shop: key ? shopRaw.toUpperCase() : shopRaw,
    token: rest[1],
    ip: deps.clientIp ? deps.clientIp(request) : request.headers.get('cf-connecting-ip'),
    call: deps.rpc ?? ((name, args) => rpc(env, name, args)),
  };
  try {
    return await route(ctx);
  } catch (err) {
    (deps.onError ?? console.error)(`queue page: ${err?.message ?? err}`);
    return page(renderDown(), 503);
  }
}

// ---- QL-08 / QL-03 / QL-09 / QL-17 ------------------------------------------------------
async function shopPage({ url, call, shop }) {
  const b = url.searchParams.get('b');
  const barber = b && BARBER.test(b) ? b : null;
  const data = await call('public_queue', { p_shop: shop, p_barber: barber });
  // QL-03 refreshes its numbers from here every 20 s
  if (url.searchParams.has('json')) return jsonResponse(data, data?.found ? 200 : 404);
  if (!data?.found) return page(renderMissing(), 404);
  // The poster and the wall display print a bare code. A barber's link carries
  // ?b=, and a link from the share sheet (step 5) will carry ?s=.
  const fromCode = !barber && !url.searchParams.has('s');
  const src = url.searchParams.get('src') === 'code' ? 'code' : 'link';
  // QL-17's open shop nearby is a nicety: a failure to find one shows none
  const nearby = data.shut ? await call('nearby_open_shop', { p_shop: data.code }).catch(() => null) : null;
  return page(renderQueue(data, { url, fromCode, src, nearby }), 200);
}

/** The chair and service a step is about, read fresh. Null when the address is malformed. */
async function quote(call, shop, barber, serviceId) {
  if (!BARBER_CODE.test(barber ?? '') || !SERVICE.test(serviceId ?? '')) return null;
  const data = await call('public_queue', { p_shop: shop, p_barber: barber });
  if (!data?.found || !data.open || data.shut) return { data };
  const chair = data.chairs.find((c) => c.code === data.chosen && c.state === 'taking');
  const service = chair?.services.find((s) => s.id === serviceId && s.wait_min != null);
  return { data, chair, service };
}

const sourceOf = (value) => (value === 'code' ? 'code' : 'link');
const shopFallback = (shop, barber) => ({ shop, barber: BARBER_CODE.test(barber ?? '') ? barber.toUpperCase() : '' });

// ---- QL-04 ---------------------------------------------------------------------------
async function joinForm({ url, call, shop }) {
  const b = url.searchParams.get('b');
  const s = url.searchParams.get('s');
  const q = await quote(call, shop, b, s);
  if (q && !q.data?.found) return page(renderMissing(), 404);
  // the chair stopped taking anyone, or the service no longer fits: re-quote
  if (!q?.service) return redirect(requote(shopFallback(shop, b), shop));
  return page(renderJoin(q.data, q.chair, q.service, { src: sourceOf(url.searchParams.get('src')) }), 200);
}

async function join({ request, call, shop, ip }) {
  const form = await request.formData();
  const b = String(form.get('b') ?? '');
  const s = String(form.get('s') ?? '');
  const src = sourceOf(form.get('src'));
  const values = { first_name: String(form.get('first_name') ?? ''), phone: String(form.get('phone') ?? '') };
  const r = await call('guest_request', {
    p_shop: shop, p_barber: b, p_service: SERVICE.test(s) ? s : null,
    p_first_name: values.first_name, p_phone: values.phone, p_ip: ip, p_source: src,
  });
  if (r.state === 'code') return redirect(`/q/${shop}/code/${r.token}`);
  if (r.state === 'invalid' || r.state === 'limited') {
    const q = await quote(call, shop, b, s);
    if (q?.service) {
      const error = r.state === 'limited' ? { limited: r.retry_at } : { field: r.field };
      return page(renderJoin(q.data, q.chair, q.service, { src, values, error }), r.state === 'limited' ? 429 : 422);
    }
  }
  return redirect(requote(r.want ?? shopFallback(shop, b), shop));
}

// ---- QL-05 · QL-11 · QL-12 ---------------------------------------------------------------
async function codePage({ call, shop, token }) {
  const view = await call('guest_code_view', { p_token: token });
  if (!view?.found) return page(renderMissing(), 404);
  if (view.used || view.expired || view.locked) return redirect(requote(view.want, shop));
  return page(renderCode(view, { shop, token }), 200);
}

async function verify({ request, call, shop, token, ip }) {
  const form = await request.formData();
  const typed = String(form.get('code') ?? '');
  const r = await call('guest_verify', { p_token: token, p_code: typed, p_ip: ip });
  const want = r.want ?? {};
  const ended = (kind) => page(renderEnded(kind, { shop: want.shop || shop, barber: want.barber }), 200);
  switch (r.state) {
    case 'joined':
      return redirect(`/q/${r.shop || shop}/t/${r.ticket}`);
    case 'wrong': {
      const view = await call('guest_code_view', { p_token: token });
      if (!view?.found || view.expired) return redirect(requote(want, shop));
      const digits = typed.replace(/\D/g, '').slice(0, 4);
      return page(renderCode(view, { shop, token, error: { wrong: r.attempts_left, digits } }), 422);
    }
    case 'locked': {
      // QL-12 is for a place that was let go; leaving or proving a number just ends
      if (r.released_no == null || !BARBER_CODE.test(want.barber ?? '')) return ended('locked');
      const data = await call('public_queue', { p_shop: want.shop || shop, p_barber: want.barber });
      return page(renderLetGo(r, { shop, data }), 200);
    }
    case 'already': {
      const wantData = BARBER_CODE.test(want.barber ?? '')
        ? await call('public_queue', { p_shop: want.shop, p_barber: want.barber })
        : null;
      return page(renderOneLine(r, { session: token, wantData }), 200);
    }
    case 'left':
    case 'started':
      return ended(r.state);
    default:
      return redirect(requote(want, shop));
  }
}

async function resend({ call, shop, token, ip }) {
  const r = await call('guest_resend', { p_token: token, p_ip: ip });
  if (r.state === 'limited') {
    const view = await call('guest_code_view', { p_token: token });
    if (view?.found && !view.expired && !view.locked) {
      return page(renderCode(view, { shop, token, error: { limited: r.retry_at } }), 429);
    }
  }
  if (r.state === 'expired' || r.state === 'gone') return redirect(requote(r.want, shop));
  return redirect(`/q/${shop}/code/${token}`);
}

// "Wrong number — change it": back to QL-04 for the same chair and service
async function drop({ call, shop, token }) {
  const r = await call('guest_drop', { p_token: token });
  const w = r.want ?? {};
  if (r.state === 'dropped' && BARBER_CODE.test(w.barber ?? '') && SERVICE.test(w.service ?? '')) {
    return redirect(`/q/${w.shop || shop}/join?b=${w.barber}&s=${w.service}&src=${sourceOf(w.source)}`);
  }
  return redirect(requote(w, shop));
}

// QL-10's "Leave it and join"
async function switchLine({ call, shop, token, ip }) {
  const r = await call('guest_switch', { p_token: token, p_ip: ip });
  if (r.state === 'joined') return redirect(`/q/${r.shop || shop}/t/${r.ticket}`);
  if (r.state === 'started') return page(renderEnded('started', { shop: r.want?.shop || shop, barber: r.want?.barber }), 200);
  return redirect(requote(r.want, shop));
}

// ---- QL-06 · QL-15 · QL-14 --------------------------------------------------------------
async function ticketPage({ url, call, token }) {
  const tk = await call('guest_ticket', { p_token: token });
  if (url.searchParams.has('json')) return jsonResponse(tk, tk?.found ? 200 : 404);
  if (!tk?.found) return page(renderMissing(), 404);
  if (tk.stage === 'missed') {
    if (tk.rejoined) return redirect(`/q/${tk.shop_code}/t/${tk.rejoined}`);
    const data = await call('public_queue', { p_shop: tk.shop_code, p_barber: tk.barber_code });
    return page(renderMissed(tk, { token, data }), 200);
  }
  if (tk.stage === 'called') return page(renderCalled(tk, { token }), 200);
  if (tk.stage === 'left' || tk.stage === 'done' || tk.stage === 'cancelled') {
    const kind = tk.stage === 'cancelled' ? 'gone' : tk.stage;
    return page(renderEnded(kind, { shop: tk.shop_code, barber: tk.barber_code }), 200);
  }
  return page(renderTicket(tk, { token }), 200);
}

async function leave({ call, shop, token, ip }) {
  const r = await call('guest_leave', { p_ticket: token, p_ip: ip });
  if (r.state === 'code') return redirect(`/q/${shop}/code/${r.token}`);
  if (r.state === 'limited') {
    const tk = await call('guest_ticket', { p_token: token });
    if (tk?.found) {
      const error = fill(en.limited, { time: clock(new Date(r.retry_at)) });
      return page(renderTicket(tk, { token, error }), 429);
    }
  }
  // started or gone: the ticket page says which
  return redirect(`/q/${shop}/t/${token}`);
}

// QL-14's "REJOIN AS Nº 11": no code, once, today
async function rejoin({ call, shop, token, ip }) {
  const r = await call('guest_rejoin', { p_ticket: token, p_ip: ip });
  if (r.state === 'joined') return redirect(`/q/${r.shop || shop}/t/${r.ticket}`);
  return redirect(requote(r.want, shop));
}

// QL-13's two taps. Both answer with the ticket again, which is where the state
// they changed is drawn — and where a lapsed hold shows as QL-14 instead.
async function coming({ call, shop, token }) {
  await call('guest_coming', { p_ticket: token });
  return redirect(`/q/${shop}/t/${token}`);
}

async function waitFive({ call, shop, token }) {
  await call('guest_wait', { p_ticket: token });
  return redirect(`/q/${shop}/t/${token}`);
}

// ---- option (b): a shop's own link opens the app when it is installed -----------------
// The same two landing shapes app.config.js claims; everything past them stays in
// the browser. Served only when the host is given the app's identity —
// ANDROID_CERT_SHA256 (comma-separated) and IOS_APP_ID (TEAMID.com.sterncut.app).
const LANDINGS = ['/q/??????', '/q/????????-????-????-????-????????????'];

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
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function rpc(env, name, args) {
  // the walk-in's calls are the server's alone: 0111 grants them to service_role
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
