// Self-check for sterncut.ma (site.js), run with the rest of `npm run check`.
//
// What only this file would notice: a price the billing rail would not charge; a
// fixture count coming back ("42 SALONS"); the corrections to the designs undone
// (the 8%, "40 DH" without "dès", WEB-06's "jamais sur votre caisse", its 120 DH
// footnote); a page that dies with the database; the stepper and the server
// disagreeing; the new-password page leaking its session or being cached.
import { fixtureRpc } from './fixtures/rpc.js';
import { handle } from './src/handler.js';

let failures = 0;
function ok(label, cond, got) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 200)})`}`);
}

const quiet = () => {};
const LIST = { salons: 3, barbers: 11, reply_days: 1.4, monthly_cents: 5500, yearly_cents: 4000, cap: 4, sms_included: 200, sms_unit_cents: null };
const numbers = (over = {}) => ({ rpc: async (name) => (name === 'site_numbers' ? { ...LIST, ...over } : { found: false }) });
const down = { rpc: async () => { throw new Error('down'); } };
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon-key' };

async function get(path, deps = numbers(), env = ENV, headers = {}, method = 'GET') {
  const res = await handle(new Request(`http://site.test${path}`, { method, headers }), env, { onError: quiet, ...deps });
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    cache: res.headers.get('cache-control') ?? '',
    location: res.headers.get('location'),
    retry: res.headers.get('retry-after'),
    body: await res.text(),
  };
}
const visible = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'")
  .replace(/[ \t\r\n]+/g, ' '); // not \s: the thin space in "1 920 DH" is the design's
const has = (page, s) => visible(page.body).includes(s);
const clean = (name, page) => {
  const words = visible(page.body);
  ok(`${name} prints no undefined, NaN or null`, !/\b(undefined|NaN|null)\b/.test(words), words.match(/\b(undefined|NaN|null)\b/)?.[0]);
  ok(`${name} is one light page`, page.body.length < 40_000, page.body.length);
  ok(`${name} never promises a commission`, !/\d\s?%/.test(words), words.match(/.{30}\d\s?%.{10}/)?.[0]);
  ok(`${name} has one h1`, (page.body.match(/<h1/g) ?? []).length === 1);
};

// ---- every page answers, and reads nothing it does not print ------------------------------
const PAGES = ['/', '/pour-les-salons', '/ar/salons', '/tarifs', '/tarifs/qui-compte', '/tarifs/exemple', '/nouveau-mot-de-passe'];
for (const path of PAGES) {
  const p = await get(path);
  ok(`${path} answers`, p.status === 200 && p.type.startsWith('text/html'), p.status);
  clean(path, p);
  const d = await get(path, down);
  ok(`${path} still answers with the database down`, d.status === 200, d.status);
  clean(`${path} (database down)`, d);
}
ok('a trailing slash and capitals are the same page', (await get('/Tarifs/')).status === 200);
const reads = [];
await get('/nouveau-mot-de-passe', { rpc: async (n) => { reads.push(n); return {}; } });
ok('the new-password page never calls the database from the server', reads.length === 0, reads);

// ---- the numbers are the rows', or absent -----------------------------------------------
const home = await get('/');
ok('WEB-01 counts from site_numbers', has(home, 'TANGER · 3 SALONS · 11 COIFFEURS'));
ok('…and caches for five minutes, no more', home.cache === 'public, max-age=300', home.cache);
const homeDown = await get('/', down);
ok('…with no count to read, no count is printed', has(homeDown, 'TANGER') && !/SALONS?\b/.test(visible(homeDown.body)));
ok('one shop is not "1 SALONS"', has(await get('/', numbers({ salons: 1, barbers: 1 })), 'TANGER · 1 SALON · 1 COIFFEUR'));
ok('no shop yet: no "0 SALONS"', !/0 SALON/.test(visible((await get('/', numbers({ salons: 0, barbers: 0 }))).body)));
ok('the design\'s fixture counts are gone', !/42 SALONS|168 COIFFEURS/.test((await get('/pour-les-salons')).body));

const pitch = await get('/pour-les-salons');
ok('PUB-01 says "dès 40 DH", never a bare 40 DH', has(pitch, 'dès 40 DH') && !has(pitch, '>40 DH'));
ok('…"0 commission"', has(pitch, '0 commission sur vos réservations'));
ok('…the reply time is the median, in French', has(pitch, '1,4 j délai moyen de réponse'));
ok('…and is left out under five decisions', !has(await get('/pour-les-salons', numbers({ reply_days: null })), 'délai moyen'));
ok('…the shop application is the app\'s', pitch.body.includes('href="/app">INSCRIRE MON SALON'));
ok('…"PARLER À QUELQU\'UN" only once there is a phone', !has(pitch, 'PARLER')
  && has(await get('/pour-les-salons', numbers(), { ...ENV, SUPPORT_PHONE: '0539 00 00 00' }), 'PARLER À QUELQU\'UN'));
const phoneLink = await get('/pour-les-salons', numbers(), { ...ENV, SUPPORT_PHONE: '"><img src=x>' });
ok('…and a phone cannot break out of the markup', !phoneLink.body.includes('<img src=x'));
const slow = Date.now();
const hung = await get('/pour-les-salons', { rpc: () => new Promise(() => {}) });
ok('a database that never answers costs 2.5 s, not the page', hung.status === 200 && Date.now() - slow < 4000 && has(hung, 'dès 40 DH'));

const ar = await get('/ar/salons');
ok('WEB-03 is Arabic, right to left', ar.body.includes('<html lang="ar" dir="rtl">') && has(ar, 'كرسيك، دائماً ممتلئ'));
ok('…with the same floor price', has(ar, 'من 40 DH'));

// ---- WEB-04 · the price is 0123's, and the stepper agrees with the server -----------------------
const tarifs = await get('/tarifs');
ok('WEB-04 prints 55 and 40', has(tarifs, '55 DH / coiffeur') && has(tarifs, '40 DH / coiffeur'));
ok('…"trois mois offerts" (12 − 480/55, rounded down)', has(tarifs, 'trois mois offerts'));
ok('…capped at four', has(tarifs, 'plafonné à quatre fauteuils') && has(tarifs, 'Le cinquième coiffeur est gratuit'));
ok('…six chairs bill four: 220 DH, or 1 920 DH the year', has(tarifs, '220 DH') && has(tarifs, 'plafonné à 4 fauteuils · ou 1 920 DH l\'année'));
ok('…no SMS price while it is unconfirmed', !/SMS[^.]*\d,\d\d DH/.test(visible(tarifs.body)) && has(tarifs, 'le prix vous sera annoncé'));
ok('…and it once it is set', has(await get('/tarifs', numbers({ sms_unit_cents: 103 })), 'puis 1,03 DH'));
const raised = await get('/tarifs', numbers({ monthly_cents: 6000, yearly_cents: 4500, cap: 5 }));
ok('a new list price reaches every figure', has(raised, '60 DH au mois, 45 DH si vous prenez l\'année') && has(raised, 'plafonné à cinq fauteuils')
  && has(raised, '300 DH'), visible(raised.body).slice(0, 400));
ok('the database down still prints 0123\'s price', has(await get('/tarifs', down), '55 DH / coiffeur'));

// run the page's own stepper against a stand-in document
const script = tarifs.body.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
const nodes = {};
const node = (id) => (nodes[id] ??= { id, textContent: '' });
let onClick = null;
const stepper = { dataset: { month: '5500', year: '48000', cap: '4' }, addEventListener: (_t, f) => { onClick = f; } };
const document = { getElementById: (id) => (id === 'stepper' ? stepper : node(id)) };
new Function('document', script)(document);
const tap = (d, times = 1) => { for (let i = 0; i < times; i++) onClick({ target: { closest: () => ({ dataset: { d: String(d) } }) } }); };
tap(-1, 3);
ok('the stepper: three chairs are 165 DH, or 1 440 DH the year', nodes['st-n'].textContent === 3 && nodes['st-t'].textContent === '165 DH'
  && nodes['st-s'].textContent === '3 × 55 DH · ou 1 440 DH l\'année', Object.values(nodes).map((n) => n.textContent));
tap(-1, 5);
ok('…never under one chair, and one is "coiffeur"', nodes['st-n'].textContent === 1 && nodes['st-w'].textContent === 'coiffeur');
tap(1, 9);
ok('…ten chairs still bill four', nodes['st-t'].textContent === '220 DH' && nodes['st-s'].textContent.startsWith('plafonné à 4 fauteuils'));

// ---- WEB-05 · WEB-06 ------------------------------------------------------------------------
const qui = await get('/tarifs/qui-compte');
ok('WEB-05 is the page\'s rule, in one sentence', has(qui, 'On compte, le 1 er du mois, les coiffeurs qu\'un client peut réserver.'));
ok('…a month with no appointment is not billed', has(qui, 'Un mois sans un seul rendez-vous n\'est pas facturé'));

const ex = await get('/tarifs/exemple');
ok('WEB-06 is labelled an example', has(ex, 'EXEMPLE') && has(ex, 'Les chiffres sont un exemple') && !/pas une simulation|vraie facture/i.test(ex.body));
ok('…four chairs, 220,00 DH', has(ex, '4 × 55') && has(ex, 'Total du mois 220,00 DH'));
ok('…1,03 DH a booking, 0,75 DH on the year', has(ex, '1,03 DH') && has(ex, '0,75 DH'));
ok('…the subscription comes off the Friday deposits, as OSB-03 says',
  has(ex, 'L\'abonnement est retenu dessus un vendredi') && !/prélevé à part|INTÉGRALEMENT/i.test(ex.body));
ok('…and one barber fewer is 165 DH, not the design\'s 120', has(ex, '165 DH') && !has(ex, '120 DH'));

// ---- WEB-11 · the new password -----------------------------------------------------------------
const reset = await get('/nouveau-mot-de-passe');
ok('WEB-11 is never cached or indexed', reset.cache === 'no-store' && reset.body.includes('<meta name="robots" content="noindex">'));
ok('…carries only the public key', reset.body.includes('"key":"anon-key"') && !/service/i.test(reset.body.match(/id="cfg">([^<]*)/)?.[1] ?? ''));
ok('…with no database set, says the link cannot work', (await get('/nouveau-mot-de-passe', numbers(), {})).body.includes('id="cfg">null<'));
const hostile = await get('/nouveau-mot-de-passe', numbers(), { SUPABASE_URL: '</script><img src=x>', SUPABASE_ANON_KEY: 'k' });
ok('…and its settings cannot close the script', !hostile.body.includes('</script><img'));
for (const [i, src] of [...reset.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).entries()) {
  try { new Function(src); } catch (err) { ok(`WEB-11 script ${i} parses`, false, err.message); }
}
ok('…sets the password, then signs out everywhere', reset.body.includes("'/auth/v1/user',{method:'PUT'") && reset.body.includes('/auth/v1/logout?scope=global'));
ok('…and takes the token out of the address bar', reset.body.includes('history.replaceState'));

// ---- /app ----------------------------------------------------------------------------------------
const ANDROID = { 'user-agent': 'Mozilla/5.0 (Linux; Android 12; SM-A125F) Mobile Safari/537.36' };
const IPHONE = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' };
const android = await get('/app', down, ENV, ANDROID);
ok('/app on Android is Google Play', android.status === 302 && android.location === 'https://play.google.com/store/apps/details?id=com.sterncut.app', android.location);
ok('/app on an iPhone before the App Store says so', (await get('/app', down, ENV, IPHONE)).status === 200);
ok('…and goes there once it is listed', (await get('/app', down, { IOS_APP_STORE_ID: '42' }, IPHONE)).location === 'https://apps.apple.com/app/id42');
const desk = await get('/app', down);
ok('/app on a computer shows the stores, no App Store badge before the listing', desk.status === 200
  && desk.body.includes('play.google.com') && !desk.body.includes('App Store</span>'));

// ---- the rest ------------------------------------------------------------------------------------
const missing = await get('/nope', down);
ok('an unknown address is the site\'s 404', missing.status === 404 && has(missing, 'Cette page n\'existe pas'));
clean('404', missing);
ok('a shop link that is not a shop is still the queue page\'s 404', (await get('/q/ZZZZZZ', { rpc: fixtureRpc({ print: quiet }) })).body.includes('lang="en"'));
ok('POST to a page is refused', (await get('/tarifs', numbers(), ENV, {}, 'POST')).status === 405);
ok('HEAD is a GET', (await get('/tarifs', numbers(), ENV, {}, 'HEAD')).status === 200);

// ---- WEB-13 · maintenance --------------------------------------------------------------------------
const M = { ...ENV, MAINTENANCE: '1', MAINTENANCE_UNTIL: '14:30', MAINTENANCE_AT: new Date(Date.now() - 12 * 60000).toISOString() };
for (const path of ['/', '/tarifs', '/q/LF7K2M', '/c/0123456789ab', '/nope']) {
  const p = await get(path, down, M);
  ok(`maintenance answers ${path} with a 503`, p.status === 503 && p.retry === '120' && has(p, 'On répare'), p.status);
}
const m = await get('/', down, M);
clean('maintenance', m);
ok('…with the time back and the note\'s age', has(m, 'RETOUR PRÉVU 14:30') && has(m, 'il y a 12 minutes'));
ok('…refreshing itself', m.body.includes('<meta http-equiv="refresh" content="60">'));
ok('…and your appointment holds', has(m, 'Il tient.'));
const bare = await get('/', down, { MAINTENANCE: 'on', MAINTENANCE_UNTIL: '<b>soon</b>' });
ok('…a malformed time is left out, not printed', !bare.body.includes('soon') && !has(bare, 'RETOUR PRÉVU'));
ok('…and off is off', (await get('/', numbers(), { ...ENV, MAINTENANCE: '0' })).status === 200);

if (failures) {
  console.error(`\n${failures} website check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('website: all checks pass');
