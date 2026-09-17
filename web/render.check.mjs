// Self-check for the queue page, run with the rest of `npm run check`.
//
// What only this file would notice, under ADDENDUM-app-first (turn Q3): A6's
// sentences changing by a word; the page implying a place is held, or offering a
// join control of any kind before QL-23; a name reaching the public line; the
// page printing undefined or NaN at somebody standing in a shop; a name breaking
// out of the markup; the confirm link being reachable from the ticket page, or
// confirmed by a link-preview fetcher; the four digits coming back.
import { fixtureRpc } from './fixtures/rpc.js';
import { handle } from './src/handler.js';

let failures = 0;
function ok(label, cond, got) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 200)})`}`);
}

const quiet = () => {};
const rpc = fixtureRpc({ print: quiet });
// texts "go out" here, so QL-23 is on; the page without them is checked below
const LIVE_SMS = { SMS_SENDS: '1' };
async function send(request, deps, env = LIVE_SMS) {
  const res = await handle(request, env, { onError: quiet, clientIp: () => '10.0.0.1', rpc, ...deps });
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    location: res.headers.get('location'),
    body: await res.text(),
  };
}
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 12; SM-A125F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const get = (path, deps, headers = { 'user-agent': PHONE_UA }) =>
  send(new Request(`http://queue.test${path}`, { headers }), deps);
const post = (path, fields, deps) =>
  send(new Request(`http://queue.test${path}`, { method: 'POST', body: new URLSearchParams(fields) }), deps);
const has = (page, s) => page.body.includes(s);
const visible = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');
const refuse = { rpc: () => { throw new Error('looked up something that is not a code'); } };
const clean = (name, page) => {
  const words = visible(page.body);
  ok(`${name} prints no undefined, NaN or null`, !/\b(undefined|NaN|null)\b/.test(words),
    words.match(/\b(undefined|NaN|null)\b/)?.[0]);
  ok(`${name} stays small for 3G`, page.body.length < 20_000, page.body.length);
  ok(`${name} never mentions a code to type`, !/four digits|your code|send me the code/i.test(words));
};

// ---- QL-18 · poster scanned · the line, read-only ------------------------------------
const shop = await get('/q/LF7K2M');
ok('a poster link answers', shop.status === 200, shop.status);
ok('…as HTML', shop.type.startsWith('text/html'), shop.type);
ok('QL-18 shop and hours', has(shop, 'Le Fade Tanger') && has(shop, '14 Rue de la Kasbah · open until 21:00'));
ok('A6 · 2, word for word', has(shop, 'in the line right now. Nothing on this page holds a place for you.'));
ok('QL-18 counts every ticket in the line', has(shop, '9 in the line right now.'));
ok('QL-18 wait is the soonest chair', has(shop, '<span class="big">~5 min</span>'));
ok('QL-18 draws the line by number', has(shop, 'THE LINE') && has(shop, 'Nº 04') && has(shop, 'Nº 06'));
ok('QL-18 says who is in the chair and who is next', has(shop, 'In the chair · Youssef') && has(shop, 'Next · Youssef')
  && has(shop, 'Waiting · Anas'));
ok('the line carries no customer name', !/Mehdi|Rachid|Karim|Anas B\./.test(visible(shop.body)));
ok('QL-18 chairs today', has(shop, 'CHAIRS TODAY') && has(shop, '<b>Hamza</b>') && has(shop, '<small class="soon">~5 min</small>'));
ok('a full chair is shown, dimmed, not taking', /chair dim"><span class="av">AM<\/span><b>Anas<\/b><small>Not taking/.test(shop.body));
ok('a barber off today is not shown', !has(shop, 'Karim'));
ok('A6 · 1, the in-shop path', has(shop, '<strong>Standing in the shop?</strong> Just tell us your name — we&#39;ll put it on the line for you.'));
ok('QL-18 CTA is the app', has(shop, 'GET STERNCUT TO HOLD A PLACE') && has(shop, 'href="/q/LF7K2M/app"'));
ok('the remote fallback is a text link, not a button',
  /<a class="textlink" href="\/q\/LF7K2M\/name\?src=code">Not at the shop\? Put your name on the line<\/a>/.test(shop.body));
ok('QL-18 has no join control of any kind',
  !/<form|<input|TAKE TICKET|type="submit"/.test(shop.body));
ok('the preview card carries the wait in its text', has(shop, 'content="9 in the line · ~5 min · open until 21:00"'));
ok('QL-18 polls a short signature', has(shop, '"url":"/q/LF7K2M?sig=1"'));

const chair = await get('/q/LF7K2M?b=Y4SF');
ok('a barber link answers', chair.status === 200, chair.status);
ok('…highlights his chair', /chair on"><span class="av">YE/.test(chair.body));
ok('…quotes his wait', has(chair, '<span class="big">~40 min</span>'));
ok('…and the preview names him', has(chair, 'content="3 waiting with Youssef · ~40 min · open until 21:00"'));
ok('…and the store and the form both keep his chair',
  has(chair, 'href="/q/LF7K2M/app?b=Y4SF"') && has(chair, 'href="/q/LF7K2M/name?b=Y4SF&amp;src=link"'));
ok('a code is not case-sensitive', (await get('/q/lf7k2m?b=y4sf')).status === 200);
const sig = await get('/q/LF7K2M?sig=1');
ok('the poll answers with a few characters', sig.status === 200 && sig.type.startsWith('text/plain') && sig.body.length < 16, sig.body);
ok('…the same the page was drawn with', has(shop, `"sig":"${sig.body}"`));

// ---- QL-26 · closed ------------------------------------------------------------------
const shut = await get('/q/LF5T8W');
ok('QL-26 · a closed shop answers', shut.status === 200, shut.status);
ok('QL-26 · badge and heading', has(shut, 'CLOSED') && has(shut, 'No line right now'));
ok('QL-26 · when it closed and who opens next',
  has(shut, 'The shop closed at 21:00. Youssef, Hamza and Sami open again tomorrow at 09:00 — the line starts filling then.'));
ok('QL-26 · three days of hours, tomorrow first', has(shut, '>Tomorrow<') && (shut.body.match(/class="hrow"/g) ?? []).length === 3);
ok('QL-26 · no join link, not even the remote one', !has(shut, '/name') && !has(shut, 'Put your name'));
ok('QL-26 · BOOK A TIME goes to the app', has(shut, 'BOOK A TIME INSTEAD') && has(shut, 'href="/q/LF5T8W/app"'));
ok('QL-26 · never says it paused', !has(shut, 'paused'));

// ---- QL-09 · the shop closed the line (kept until the owner picks) ----------------------
const paused = await get('/q/LF9P3C');
ok('QL-09 still answers', paused.status === 200 && has(paused, 'No walk-ins<br>right now'), paused.status);
ok('QL-09 offers no way in', !has(paused, '/name') && !has(paused, 'class="cta"'));

for (const [name, page] of [['QL-18', shop], ['QL-18 chair', chair], ['QL-26', shut], ['QL-09', paused]]) clean(name, page);

const hostileName = '</script><img src=x onerror=alert(1)>';
const hostile = {
  rpc: async (name, args) => {
    const d = await rpc(name, args);
    if (name === 'public_queue' && d.found) {
      d.name = hostileName;
      d.chairs[0].name = `${hostileName} E.`;
    }
    return d;
  },
};
ok('a name cannot break out of the markup', !(await get('/q/LF7K2M?b=Y4SF', hostile)).body.includes('<img src=x'));
ok('…nor out of the closed page', !(await get('/q/LF5T8W', hostile)).body.includes('<img src=x'));
ok('…nor out of the form', !(await get('/q/LF7K2M/name?b=Y4SF', hostile)).body.includes('<img src=x'));

// ---- addresses that are not a shop ------------------------------------------------------
ok('an unknown code is a 404', (await get('/q/ZZZZZZ')).status === 404);
ok('junk is a 404 without a lookup', (await get('/q/hello', refuse)).status === 404);
ok('an ambiguous character never reaches the database', (await get('/q/LF0K2M', refuse)).status === 404);
ok('anything outside /q/ and /c/ is a 404', (await get('/', refuse)).status === 404);
ok('the app-link files are 404 until the host knows the app', (await get('/.well-known/assetlinks.json', refuse)).status === 404);
let asked = null;
await get('/q/0F8FAD5B-D9CB-469F-A165-70867728950E', { rpc: async (_name, a) => { asked = a.p_shop; return { found: false }; } });
ok('a poster printed before 0110 (a uuid) is still looked up', asked === '0F8FAD5B-D9CB-469F-A165-70867728950E', asked);
ok('…but every step past the landing takes the code alone',
  (await get('/q/0f8fad5b-d9cb-469f-a165-70867728950e/name', refuse)).status === 404);
ok('a ticket that is not a token is a 404 without a lookup', (await get('/q/LF7K2M/t/nope', refuse)).status === 404);
ok('a database that is down is a 503, not a crash',
  (await get('/q/LF7K2M', { rpc: async () => { throw new Error('down'); } })).status === 503);
ok('POST to the line is refused', (await post('/q/LF7K2M', {})).status === 405);
for (const gone of ['join', 'code/abcdef012345', 't/abcdef012345/rejoin', 't/abcdef012345/coming', 't/abcdef012345/wait']) {
  const r = await post(`/q/LF7K2M/${gone}`, {}, refuse);
  ok(`the deleted step /${gone} is not served`, r.status === 404, r.status);
}

// ---- QL-20 · the store, with the shop carried across ---------------------------------------
const android = await get('/q/LF7K2M/app?b=Y4SF', refuse);
ok('Android goes to Google Play without a database call', android.status === 302, android.status);
ok('…with the shop and the chair in the install referrer',
  android.location === 'https://play.google.com/store/apps/details?id=com.sterncut.app'
    + `&referrer=${encodeURIComponent('sterncut_shop=LF7K2M&sterncut_barber=Y4SF')}`, android.location);
const iphoneUa = { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' };
const iphone = await get('/q/LF7K2M/app', refuse, iphoneUa);
ok('an iPhone with no App Store id set is told so, not bounced', iphone.status === 200 && has(iphone, 'app store yet'));
const listed = await handle(new Request('http://queue.test/q/LF7K2M/app', { headers: iphoneUa }), { IOS_APP_STORE_ID: '123456' }, refuse);
ok('…and goes to the App Store once it is', listed.headers.get('location') === 'https://apps.apple.com/app/id123456');

// ---- no SMS account yet: QL-23 is not offered ------------------------------------------------
const noSms = await send(new Request('http://queue.test/q/LF7K2M'), {}, {});
ok('without texts, the line offers the app and no remote form', noSms.status === 200
  && has(noSms, 'GET STERNCUT TO HOLD A PLACE') && !has(noSms, '/name') && !has(noSms, 'Not at the shop'));
const noSmsForm = await send(new Request('http://queue.test/q/LF7K2M/name?b=Y4SF'), refuse, {});
ok('…and the form goes back to the line without a lookup', noSmsForm.status === 303 && noSmsForm.location === '/q/LF7K2M?b=Y4SF', noSmsForm);
const noSmsPost = await send(new Request('http://queue.test/q/LF7K2M/name', { method: 'POST', body: new URLSearchParams({ b: 'Y4SF' }) }), refuse, {});
ok('…nor can a post put a name on', noSmsPost.status === 303, noSmsPost.status);

// ---- QL-23 → QL-24 → the tap → QL-25 --------------------------------------------------------
const live = fixtureRpc({ print: quiet });
const as = { rpc: live };
const form = await get('/q/LF7K2M/name', as);
ok('QL-23 answers', form.status === 200, form.status);
ok('QL-23 heading and its argument against itself', has(form, 'Put your name<br>on the line')
  && has(form, 'In the shop? Ask the barber instead — it&#39;s faster.'));
ok('A6 · 3, word for word', has(form, '<strong>No code to type.</strong> We text you once — tap the link in that text and the place is confirmed.'));
ok('QL-23 names the soonest chair when none was picked', has(form, 'PUT ME ON Nº 01') && has(form, 'name="b" value="H7MB"'));
ok('A6 · 4, word for word', has(form, 'Until you confirm, Hamza may call past your number'));
ok('QL-23 asks two things and nothing else', (form.body.match(/<input class="input"/g) ?? []).length === 2);
clean('QL-23', form);

const forChair = await get('/q/LF7K2M/name?b=Y4SF&src=link', as);
ok('QL-23 from a barber link names his chair', has(forChair, 'PUT ME ON Nº 07') && has(forChair, 'Youssef may call past')
  && has(forChair, 'name="src" value="link"'));
const notTaking = await get('/q/LF7K2M/name?b=A2NM', as);
ok('QL-23 for a chair not taking anyone goes back to the line', notTaking.status === 303 && notTaking.location === '/q/LF7K2M?b=A2NM', notTaking);
ok('QL-23 on a closed shop goes back to the line', (await get('/q/LF5T8W/name', as)).location === '/q/LF5T8W');

const service = (await live('public_queue', { p_shop: 'LF7K2M' })).chairs[0].services[0].id;
const fields = { b: 'Y4SF', s: service, src: 'link', first_name: 'Karim', phone: '0612345678' };
const noName = await post('/q/LF7K2M/name', { ...fields, first_name: '  ' }, as);
ok('a blank name is refused on the form', noName.status === 422 && has(noName, 'Type a first name.'), noName.status);
const badPhone = await post('/q/LF7K2M/name', { ...fields, phone: '0539123456' }, as);
ok('a landline is refused, the name kept', badPhone.status === 422 && has(badPhone, 'That is not a Moroccan mobile number.')
  && has(badPhone, 'value="Karim"'), badPhone.status);

const joined = await post('/q/LF7K2M/name', fields, as);
ok('a name goes on the line and lands on its ticket', joined.status === 303 && /^\/q\/LF7K2M\/t\/[0-9a-f]{12}$/.test(joined.location ?? ''), joined);
const ticket = joined.location.split('/').pop();
const texts = await live('fixture_outbox');
ok('one text went out, with the link and no code', texts.length === 1 && /Confirm with one tap: http:\/\/queue\.test\/c\/[0-9a-f]{12}$/.test(texts[0].body)
  && !/\b\d{4}\b(?!\/)/.test(texts[0].body.replace(/c\/[0-9a-f]+/, '')), texts[0]?.body);
ok('the text is ASCII, so one send', /^[ -~]+$/.test(texts[0].body) && texts[0].body.length <= 160, texts[0].body.length);

const held = await get(`/q/LF7K2M/t/${ticket}`, as);
ok('QL-24 answers', held.status === 200, held.status);
ok('QL-24 says it is not confirmed', has(held, 'NOT CONFIRMED YET') && has(held, 'KARIM · LE FADE TANGER') && has(held, 'Nº 07'));
ok('QL-24 ahead and wait', has(held, '3 ahead with Youssef · ~40 min'));
ok('A6 · 5, word for word', visible(held.body).includes('Youssef sees Nº 07 greyed on his board and may call past it.'));
ok('QL-24 quotes the text, and the text quotes the same wait',
  has(held, 'WE JUST TEXTED YOU') && has(held, 'Sterncut: Ticket 07 at Le Fade Tanger with Youssef, about 40 min.'));
const token = await live('fixture_confirm_token', { ticket });
ok('QL-24 never carries the confirm link', !held.body.includes(token) && has(held, '/c/…'));
ok('QL-24 has nothing to press', !has(held, '<form') && has(held, 'Nothing to do here — open the text'));
clean('QL-24', held);

const again = await post('/q/LF7K2M/name', fields, as);
ok('the same number again replaces its unconfirmed name', again.status === 303 && again.location !== joined.location);
ok('…and the old ticket is gone', (await get(joined.location, as)).status === 404);
const ticket2 = again.location.split('/').pop();
const token2 = await live('fixture_confirm_token', { ticket: ticket2 });

const bot = await get(`/c/${token2}`, as, { 'user-agent': 'WhatsApp/2.23.20.0 A' });
ok('a link-preview fetcher confirms nothing', bot.status === 200 && has(bot, 'Open this link on your phone'));
const head = await send(new Request(`http://queue.test/c/${token2}`, { method: 'HEAD' }), as);
ok('…nor does a HEAD', head.status === 200);
ok('…the ticket is still unconfirmed', has(await get(again.location, as), 'NOT CONFIRMED YET'));

const tapped = await get(`/c/${token2}`, as);
ok('the tap renders QL-25', tapped.status === 200 && has(tapped, 'CONFIRMED') && !has(tapped, 'NOT CONFIRMED'), tapped.status);
ok('QL-25 name, barber and number', has(tapped, 'KARIM · WITH YOUSSEF') && has(tapped, 'Nº 07'));
ok('QL-25 ahead and wait', has(tapped, 'AHEAD OF YOU') && has(tapped, '>3<') && has(tapped, '40 min'));
ok('A6 · 6, word for word', has(tapped, '<strong>One more text, then nothing.</strong> You&#39;ll hear from us when you&#39;re next — this page won&#39;t ping you, so don&#39;t sit watching it.'));
ok('QL-25 offers the app', has(tapped, 'GET THE APP') && has(tapped, 'href="/q/LF7K2M/app"'));
ok('QL-25 does not poll', !has(tapped, 'q-poll') && !has(tapped, 'setInterval'));
clean('QL-25', tapped);
ok('a second tap reads the same ticket', has(await get(`/c/${token2}`, as), 'KARIM · WITH YOUSSEF'));
ok('the ticket address shows QL-25 now', has(await get(again.location, as), 'KARIM · WITH YOUSSEF'));

const second = await post('/q/LF7K2M/name', fields, as);
ok('one line at a time: a confirmed number is refused', second.status === 409 && has(second, 'already holds a place'), second.status);

await live('fixture_set', { ticket: ticket2, day: 'yesterday' });
const tooLate = fixtureRpc({ print: quiet });
const late = await post('/q/LF7K2M/name', { ...fields, phone: '0698765432' }, { rpc: tooLate });
const lateToken = await tooLate('fixture_confirm_token', { ticket: late.location.split('/').pop() });
await tooLate('fixture_set', { ticket: late.location.split('/').pop(), day: 'yesterday' });
const ranOut = await get(`/c/${lateToken}`, { rpc: tooLate });
ok('a link that ran out shows the line, not an error page', ranOut.status === 200
  && has(ranOut, 'That link has run out') && has(ranOut, 'THE LINE'), ranOut.status);
ok('an unknown link says so', (await get('/c/0123456789ab', as)).status === 404);

const left = await post(`/q/LF7K2M/t/${ticket2}/leave`, {}, as);
ok('giving up the place goes back to the ticket', left.status === 303 && left.location === `/q/LF7K2M/t/${ticket2}`);
ok('…which says so', has(await get(left.location, as), 'You gave up your place'));

// the barber called him and started the cut
const started = await post('/q/LF7K2M/name', { ...fields, phone: '0611111111' }, as);
const startedTicket = started.location.split('/').pop();
await live('fixture_set', { ticket: startedTicket, confirmed: true, stage: 'in_chair' });
ok('a ticket in the chair says the cut started', has(await get(started.location, as), 'Your cut has already started'));

// ---- limits --------------------------------------------------------------------------------
const flood = fixtureRpc({ print: quiet });
let last;
for (let i = 0; i < 4; i++) last = await post('/q/LF7K2M/name', { ...fields, phone: '0622222222' }, { rpc: flood });
ok('a fourth text to one number in fifteen minutes waits', last.status === 429 && has(last, 'Too many texts'), last.status);

if (failures) {
  console.error(`\n${failures} queue page check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('queue page: all checks pass');
