// Self-check for the queue page, run with the rest of `npm run check`.
//
// What only this file would notice: README §7's sentences changing by a word,
// the page printing undefined or NaN at somebody standing in a shop, a name
// breaking out of the markup, a closed shop offering a way in it does not have,
// the page and the server disagreeing about "Anyone" — from step 2, a walk-in's
// whole way through: the two fields, the code, the ticket, leaving, and one line
// at a time — and from the addendum, the states after the ticket exists.
import { fixtureRpc } from './fixtures/rpc.js';
import { handle } from './src/handler.js';
import { menuFor, resolvePick } from './src/pick.js';

let failures = 0;
function ok(label, cond, got) {
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}${got === undefined ? '' : `  (got ${JSON.stringify(got).slice(0, 200)})`}`);
}

const quiet = () => {};
const rpc = fixtureRpc({ print: quiet });
async function send(request, deps) {
  const res = await handle(request, {}, { onError: quiet, clientIp: () => '10.0.0.1', rpc, ...deps });
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    location: res.headers.get('location'),
    body: await res.text(),
  };
}
const get = (path, deps) => send(new Request(`http://queue.test${path}`), deps);
const post = (path, fields, deps) =>
  send(new Request(`http://queue.test${path}`, { method: 'POST', body: new URLSearchParams(fields) }), deps);
const has = (page, s) => page.body.includes(s);
const visible = (html) => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ')
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ');
const refuse = { rpc: () => { throw new Error('looked up something that is not a code'); } };
const clean = (name, page) => {
  const words = visible(page.body);
  ok(`${name} prints no undefined, NaN or null`, !/\b(undefined|NaN|null)\b/.test(words),
    words.match(/\b(undefined|NaN|null)\b/)?.[0]);
  ok(`${name} stays small for 3G`, page.body.length < 30_000, page.body.length);
};

// ---- QL-08 · the poster, salon-level ------------------------------------------
const shop = await get('/q/LF7K2M');
ok('a poster link answers', shop.status === 200, shop.status);
ok('…as HTML', shop.type.startsWith('text/html'), shop.type);
ok('QL-08 heading', has(shop, 'Take a ticket'));
ok('QL-08 sorts soonest first', shop.body.indexOf('Hamza B.') < shop.body.indexOf('Youssef E.'));
ok('QL-08 sends you to the soonest chair', has(shop, 'CONTINUE WITH HAMZA · Nº 01'));
ok('QL-08 rows read as drawn', has(shop, 'Nobody waiting · free now') && has(shop, '3 waiting · 4.9 ★ · 218 cuts'));
ok('QL-08 prints the code under the poster', has(shop, '<strong>LF7K2M</strong>'));
ok('a bare code says you are at the shop', has(shop, 'You&#39;re at the shop'));
ok('a full chair is shown, dimmed, not offered', has(shop, 'Booked solid until close') && has(shop, 'Not taking'));
ok('a barber off today is not listed', !has(shop, 'Karim'));
ok('…and not counted as working', has(shop, 'Le Fade Tanger · 3 barbers working today'));
ok('a chair picked off the poster remembers the poster', has(shop, 'href="/q/LF7K2M?b=H7MB&amp;src=code"'));

// ---- QL-03 · a barber's own link -----------------------------------------------
const chair = await get('/q/LF7K2M?b=Y4SF');
ok('a chair link answers', chair.status === 200, chair.status);
ok('README §7 · the QL-03 sentence, word for word', has(chair,
  'No deposit and no account — pay Youssef in cash at the chair. Be in the shop when your turn comes or you lose the place.'));
ok('QL-03 wait block', has(chair, '3 people ahead of you with Youssef · you&#39;d be ticket Nº 07') && has(chair, '~40 min'));
ok('QL-03 CTA', has(chair, 'TAKE TICKET Nº 07'));
ok('QL-03 address and hours', has(chair, '14 Rue de la Kasbah · open until 21:00'));
ok('QL-01 preview carries the wait in its text', has(chair, 'content="3 waiting with Youssef · ~40 min · open until 21:00"'));
ok('QL-03 CTA carries the chair, the service and how he came',
  /href="\/q\/LF7K2M\/join\?b=Y4SF&amp;s=[0-9a-f-]{36}&amp;src=link"/.test(chair.body));
ok('a barber link does not claim you are at the shop', !has(chair, 'the mirror'));

const typed = await get('/q/lf7k2m?b=y4sf');
ok('a code is not case-sensitive', typed.status === 200 && has(typed, 'TAKE TICKET Nº 07'));

const fullChair = await get('/q/LF7K2M?b=A2NM');
ok('a link to a chair that cannot take anyone still lands', fullChair.status === 200, fullChair.status);
ok('…shows him as not taking and offers the soonest chair',
  has(fullChair, 'Not taking') && has(fullChair, 'TAKE TICKET Nº 01'));

// ---- the picker, exactly as the page runs it ------------------------------------
const day = await rpc('public_queue', { p_shop: 'LF7K2M', p_barber: null });
const anyone = resolvePick(day.chairs, { chair: '*', service: null });
ok('"Anyone" is whoever starts soonest', anyone?.chair.code === 'H7MB', anyone?.chair.code);
const both = resolvePick(day.chairs, { chair: '*', service: 'Both' });
ok('"Anyone" for a service only one chair does is that chair', both?.chair.code === 'Y4SF', both?.chair.code);
const beard = resolvePick(day.chairs, { chair: 'Y4SF', service: 'Beard' });
ok('a chosen chair keeps the chosen service', beard?.chair.code === 'Y4SF' && beard.service.name === 'Beard');
const lacking = resolvePick(day.chairs, { chair: 'H7MB', service: 'Both' });
ok('a service the chair does not do falls back to his first', lacking?.service.name === 'Haircut', lacking?.service.name);
ok('"Anyone" lists each service once',
  menuFor(day.chairs, { chair: '*', service: null }).map((s) => s.name).join() === 'Haircut,Beard,Both');
ok('a full chair is never picked', resolvePick(day.chairs, { chair: 'A2NM', service: null })?.chair.code !== 'A2NM');

// ---- QL-09 · the shop closed the line ---------------------------------------------
const closed = await get('/q/LF9P3C');
ok('a closed shop answers', closed.status === 200, closed.status);
ok('QL-09 heading', has(closed, 'No walk-ins<br>right now'));
ok('QL-09 says when it closed', has(closed, 'Le Fade Tanger paused the line at 10:10'));
ok('QL-09 counts the tickets that stand', has(closed, 'Tickets already taken — Nº 01 to Nº 06 stand'));
ok('QL-09 says the code does not join', has(closed, 'Joining the line from this code'));
ok('QL-09 offers no booking it cannot finish', !/\bbook/i.test(visible(closed.body)), visible(closed.body).match(/\bbook\w*/i)?.[0]);
ok('QL-09 has no button at all', !has(closed, 'class="cta"'));

// ---- QL-17 · shut for the day, not paused ---------------------------------------------
const shut = await get('/q/LF5T8W');
ok('QL-17 · a shut shop answers', shut.status === 200, shut.status);
ok('QL-17 · says shut, and never that it paused',
  has(shut, 'Shut for<br>tonight') && !has(shut, 'paused the line') && !has(shut, 'No walk-ins'));
ok('QL-17 · says when walk-ins run again', has(shut, 'Walk-ins run while the doors are open — 09:00 tomorrow.'));
ok('QL-17 · the first chair tomorrow', has(shut, 'FIRST CHAIR TOMORROW') && has(shut, '<b>Youssef</b>'));
ok('QL-17 · the week, Monday first and folded',
  has(shut, 'Mon — Fri') && has(shut, '09:00 — 21:00') && has(shut, 'Saturday') && has(shut, '09:00 — 22:00')
  && has(shut, 'Sunday') && has(shut, '>Closed<'));
ok('QL-17 · an open shop nearby', has(shut, 'Kasbah Cuts is open till 23:00') && has(shut, '900 m · 2 in line · ~25 min'));
ok('ADDENDUM A6 · QL-17, word for word', has(shut, 'Or scan this code again in the morning — it never changes.'));
ok('QL-17 · offers no booking it cannot finish', !/\bbook/i.test(visible(shut.body)), visible(shut.body).match(/\bbook\w*/i)?.[0]);
ok('QL-17 · promises no last-walk-in rule nobody keeps', !/45 minutes/.test(shut.body));

for (const [name, page] of [['QL-08', shop], ['QL-03', chair], ['QL-09', closed], ['QL-17', shut]]) clean(name, page);

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
const x = await get('/q/LF7K2M?b=Y4SF', hostile);
ok('a name cannot break out of the markup', !x.body.includes('<img src=x'));
ok('…nor out of the page data', !x.body.includes('</script><img'));
ok('…nor out of the shut page', !(await get('/q/LF5T8W', hostile)).body.includes('<img src=x'));

// ---- addresses that are not a shop ------------------------------------------------
ok('an unknown code is a 404', (await get('/q/ZZZZZZ')).status === 404);
ok('junk is a 404 without a lookup', (await get('/q/hello', refuse)).status === 404);
ok('an ambiguous character never reaches the database', (await get('/q/LF0K2M', refuse)).status === 404);
ok('anything outside /q/ is a 404', (await get('/', refuse)).status === 404);
ok('the app-link files are 404 until the host knows the app', (await get('/.well-known/assetlinks.json', refuse)).status === 404);
let asked = null;
await get('/q/0F8FAD5B-D9CB-469F-A165-70867728950E', { rpc: async (_name, a) => { asked = a.p_shop; return { found: false }; } });
ok('a poster printed before 0110 (a uuid) is still looked up', asked === '0F8FAD5B-D9CB-469F-A165-70867728950E', asked);
ok('…but a walk-in\'s steps take the code alone',
  (await get('/q/0f8fad5b-d9cb-469f-a165-70867728950e/join?b=Y4SF', refuse)).status === 404);
ok('a token that is not one is a 404 without a lookup', (await get('/q/LF7K2M/code/nope', refuse)).status === 404);
ok('a database that is down is a 503, not a crash',
  (await get('/q/LF7K2M', { rpc: async () => { throw new Error('down'); } })).status === 503);
const polled = await get('/q/LF7K2M?b=Y4SF&json=1');
ok('QL-03 can poll its numbers as JSON', polled.type.startsWith('application/json') && JSON.parse(polled.body).found === true);
ok('POST to a page is refused', (await post('/q/LF7K2M', {})).status === 405);

// ---- step 2 · a walk-in's whole way through ----------------------------------------
// A fresh make-believe database, so the holds below start from the drawn day.
const live = fixtureRpc({ print: quiet });
const as = { rpc: live };
const lastText = () => live.outbox[live.outbox.length - 1];
const wrongFor = (code) => (code === '0000' ? '1111' : '0000');

// QL-04
const ql03 = await get('/q/LF7K2M?b=Y4SF', as);
const joinHref = ql03.body.match(/href="(\/q\/LF7K2M\/join\?[^"]+)"/)?.[1].replace(/&amp;/g, '&');
const form = await get(joinHref, as);
ok('QL-04 answers', form.status === 200, form.status);
ok('QL-04 asks only for a first name and a phone',
  has(form, 'name="first_name"') && has(form, 'name="phone"') && (form.body.match(/<input class="input"/g) ?? []).length === 2);
ok('README §7 · the QL-04 promise, word for word',
  has(form, 'One text when you&#39;re next, one if the shop closes the line. Nothing else, ever — and no marketing.'));
ok('QL-04 says who calls the name out', has(form, 'It&#39;s what Youssef will call out. No surname needed.'));
ok('QL-04 carries the ticket it would be', has(form, 'Nº 07') && has(form, 'Youssef · Haircut 60 DH · ~40 min from now'));
const field = (name) => form.body.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];
const fields = { b: field('b'), s: field('s'), src: field('src') };
ok('a barber link remembers it was his link', fields.b === 'Y4SF' && fields.src === 'link', fields);

const badPhone = await post('/q/LF7K2M/join', { ...fields, first_name: 'Rachid', phone: '0539123456' }, as);
ok('a landline is refused with the reason, and what he typed is kept',
  badPhone.status === 422 && badPhone.body.includes('That is not a Moroccan mobile number.') && badPhone.body.includes('value="0539123456"'));
const noName = await post('/q/LF7K2M/join', { ...fields, first_name: '  ', phone: '0661341290' }, as);
ok('a first name is needed', noName.status === 422 && noName.body.includes('Type a first name.'));
ok('a refused form sends no text', live.outbox.length === 0, live.outbox.length);

const sent = await post('/q/LF7K2M/join', { ...fields, first_name: 'Rachid', phone: '06 61 34 12 90' }, as);
ok('QL-04 texts a code and goes to QL-05', sent.status === 303 && /^\/q\/LF7K2M\/code\/[0-9a-f]{12}$/.test(sent.location ?? ''), sent.location);
ok('the text is Messages Out\'s French code, with no link',
  /^Sterncut : votre code est \d{4}\. Valable 5 min\./.test(lastText()?.body ?? '') && !/https?:|\.ma\//.test(lastText()?.body ?? ''));
ok('…with a straight apostrophe, so it is one send', lastText()?.body.includes("n'avez") && !lastText()?.body.includes('’'));
ok('the text goes to the whole number', lastText()?.to === '+212661341290', lastText()?.to);

// QL-05
const codePage = await get(sent.location, as);
ok('QL-05 answers', codePage.status === 200, codePage.status);
ok('QL-05 says where the code went',
  has(codePage, 'Texted to <strong>+212 6 61 34 12 90</strong>. It proves the number is yours, so nobody else can take your turn.'));
ok('QL-05 holds the place and counts it down',
  has(codePage, 'YOUR PLACE IS HELD WHILE YOU DO THIS') && /data-until="[^"]+">[45]:\d\d</.test(codePage.body));
ok('QL-05 makes a resend wait', has(codePage, 'data-resend hidden'));
ok('the hold is a real place: QL-03 now quotes the next number', has(await get('/q/LF7K2M?b=Y4SF', as), 'TAKE TICKET Nº 08'));
const early = await post(`${sent.location}/resend`, {}, as);
ok('a resend inside 30 s sends nothing', early.status === 303 && live.outbox.length === 1, live.outbox.length);

// QL-11
const code = lastText().code;
const wrong = await post(sent.location, { code: wrongFor(code) }, as);
ok('QL-11 · a wrong code says what failing again costs', wrong.status === 422
  && has(wrong, 'That&#39;s not the code. Two more tries, then we start over with a new number.'), wrong.status);
ok('QL-11 · the place is still held, and the code\'s age is said',
  has(wrong, 'STILL HOLDING') && has(wrong, 'Check the last message — codes older than 5 minutes stop working.'));
ok('QL-11 · the wrong digits stay on show', has(wrong, `data-bad="${wrongFor(code)}"`));
const right = await post(sent.location, { code }, as);
ok('the right code confirms the place and opens the ticket',
  right.status === 303 && /^\/q\/LF7K2M\/t\/[0-9a-f]{12}$/.test(right.location ?? ''), right.location);
ok('a used code page opens nothing again', (await get(sent.location, as)).status === 303);

// QL-06
const ticket = await get(right.location, as);
ok('QL-06 answers', ticket.status === 200, ticket.status);
ok('QL-06 heading', has(ticket, 'You&#39;re in, Rachid') && has(ticket, 'no account made'));
ok('QL-06 ticket card', has(ticket, 'WALK-IN TICKET') && has(ticket, 'Nº 07') && has(ticket, 'Youssef · Le Fade Tanger'));
ok('QL-06 names the number the texts go to', has(ticket, 'We text <strong>0661 34 12 90</strong> when one person is left.'));
ok('QL-06 shows who is in the chair, then you',
  has(ticket, 'Mehdi K.') && has(ticket, 'You · Rachid') && has(ticket, '2 more after Mehdi, then you'));
ok('QL-06 polls its line as JSON', (await get(`${right.location}?json=1`, as)).body.includes('"stage":"waiting"'));
ok('a ticket address nobody confirmed opens nothing', (await get('/q/LF7K2M/t/000000000000', as)).status === 404);

// QL-10 — the same number, from the poster, for another chair
const hamza = { b: 'H7MB', s: '8e41ad85-6f70-4b12-8d34-5e6f708192a3', src: 'code' };
const again = await post('/q/LF7K2M/join', { ...hamza, first_name: 'Rachid', phone: '0661341290' }, as);
ok('a number that holds a ticket still gets a code first', again.status === 303 && /\/code\//.test(again.location ?? ''), again.location);
const lookup = await get(again.location, as);
ok('…and nothing says it holds one until the code proves the number',
  !has(lookup, 'Nº 07') && !has(lookup, 'YOUR PLACE IS HELD'));
const oneLine = await post(again.location, { code: lastText().code }, as);
ok('README §7 · QL-10, word for word',
  has(oneLine, 'One line at<br>a time') && has(oneLine, 'This number already holds a ticket today. Two tickets means one empty chair somewhere'));
ok('QL-10 shows the ticket he has', has(oneLine, 'Le Fade Tanger · Youssef') && has(oneLine, 'KEEP Nº 07 · SEE THE LINE'));
ok('QL-10 offers the chair he asked for', has(oneLine, 'Want Hamza at Le Fade Tanger instead?') && has(oneLine, 'LEAVE IT AND JOIN HAMZA'));
const switchAt = oneLine.body.match(/action="([^"]+\/switch)"/)?.[1];
const switched = await post(switchAt, {}, as);
ok('leaving it and joining needs no second code',
  switched.status === 303 && /\/t\/[0-9a-f]{12}$/.test(switched.location ?? '') && live.outbox.length === 2, [switched.location, live.outbox.length]);
const hamzaTicket = await get(switched.location, as);
ok('…and the new ticket is with Hamza', has(hamzaTicket, 'Hamza · Le Fade Tanger') && has(hamzaTicket, 'Nº 01') && has(hamzaTicket, 'You&#39;re next'));
ok('the old ticket says he left', has(await get(right.location, as), 'You left the line'));

// leaving, with a fresh code
const leaveStart = await post(`${switched.location}/leave`, {}, as);
ok('leaving asks for a fresh code first', leaveStart.status === 303 && /\/code\//.test(leaveStart.location ?? ''), leaveStart.location);
const leavePage = await get(leaveStart.location, as);
ok('the leave code says what it protects',
  has(leavePage, 'nobody else can give up your turn') && has(leavePage, 'LEAVE THE LINE') && !has(leavePage, 'Wrong number'));
const left = await post(leaveStart.location, { code: lastText().code }, as);
ok('the right code takes him off the line', has(left, 'You left the line'));

// limits
const fourth = await post('/q/LF7K2M/join', { ...fields, first_name: 'Rachid', phone: '0661341290' }, as);
ok('a number gets three texts in fifteen minutes, not four',
  fourth.status === 429 && fourth.body.includes('Too many codes for this number right now'), fourth.status);

const anas = await post('/q/LF7K2M/join', { ...fields, first_name: 'Anas', phone: '0700000001' }, as);
const dropped = await post(`${anas.location}/drop`, {}, as);
ok('"wrong number" drops the hold and goes back to QL-04',
  dropped.status === 303 && (dropped.location ?? '').startsWith('/q/LF7K2M/join?b=Y4SF&s='), dropped.location);

// ---- the addendum · QL-11 twice, then QL-12 ------------------------------------------
const guesser = await post('/q/LF7K2M/join', { ...fields, first_name: 'Anas', phone: '0700000002' }, as);
const guessedNo = (await get(guesser.location, as)).body.match(/Nº (\d\d)/)?.[1];
await post(guesser.location, { code: wrongFor(lastText().code) }, as);
const miss2 = await post(guesser.location, { code: wrongFor(lastText().code) }, as);
ok('QL-11 · the second wrong code says one more', has(miss2, 'That&#39;s not the code. One more try, then we start over with a new number.'));
const miss3 = await post(guesser.location, { code: wrongFor(lastText().code) }, as);
ok('QL-12 · the third lets the place go', miss3.status === 200 && has(miss3, `We let<br>Nº ${guessedNo} go`), guessedNo);
ok('ADDENDUM A6 · QL-12, word for word', has(miss3,
  'Three wrong codes in a row usually means the number isn&#39;t the phone in your hand — and a held number nobody can confirm blocks the person behind it.'));
ok('QL-12 · the line moved on, and trying again is offered',
  has(miss3, 'THE LINE MOVED ON') && has(miss3, `TRY AGAIN FOR Nº ${guessedNo}`) && has(miss3, 'we block repeat attempts from this number'));
ok('QL-12 · standing in the shop, ask the barber', has(miss3, 'Ask Youssef to add you by name'));
ok('QL-12 · offers no booking it cannot finish', !/\bbook/i.test(visible(miss3.body)));
ok('QL-12 · the place really went', has(await get('/q/LF7K2M?b=Y4SF', as), `TAKE TICKET Nº ${guessedNo}`));
const blocked = await post('/q/LF7K2M/join', { ...fields, first_name: 'Anas', phone: '0700000002' }, as);
ok('QL-12 · the number waits fifteen minutes', blocked.status === 429, blocked.status);
ok('QL-12 · the old code page opens nothing', (await get(guesser.location, as)).status === 303);

// ---- the addendum · QL-15 frozen, then QL-14 missed -------------------------------------
const kenza = await post('/q/LF7K2M/join', { ...fields, first_name: 'Kenza', phone: '0700000003' }, as);
const kenzaIn = await post(kenza.location, { code: lastText().code }, as);
live.pause('LF7K2M', 'Y4SF', true);
const frozen = await get(kenzaIn.location, as);
ok('QL-15 · the ticket stands while the board is paused', has(frozen, 'WALK-IN TICKET · HELD') && has(frozen, 'Nº 07'));
ok('QL-15 · says who paused it, and when',
  /Youssef paused the board at \d\d:\d\d\. Your place is kept, the clock isn&#39;t running\./.test(frozen.body));
ok('ADDENDUM A6 · QL-15, word for word', has(frozen, 'Nobody new can join while it&#39;s paused, so you won&#39;t slip further back.'));
ok('QL-15 · the wait says paused and the clock counts the freeze', has(frozen, '>paused<') && has(frozen, 'FROZEN FOR'));
ok('QL-15 · promises no text when it restarts', !/restart/i.test(visible(frozen.body)));
ok('QL-15 · the poll knows it is paused', (await get(`${kenzaIn.location}?json=1`, as)).body.includes('"paused":true'));
live.pause('LF7K2M', 'Y4SF', false);
ok('…and the ticket is itself again when the board reopens', has(await get(kenzaIn.location, as), 'You&#39;re in, Kenza'));

// ---- the addendum · QL-13 called, and the eight-minute chair hold ----------------------
// Somebody joins behind her first, so the cost of letting the hold go is a real
// number on the page: Youssef takes Nº 08.
const omar = await post('/q/LF7K2M/join', { ...fields, first_name: 'Omar', phone: '0700000004' }, as);
const omarIn = await post(omar.location, { code: lastText().code }, as);
const kenzaToken = kenzaIn.location.split('/').pop();
live.call(kenzaToken, { texted: true });
const called = await get(kenzaIn.location, as);
ok('QL-13 · the page turns red on its own', has(called, '<body class="hot">') && has(called, 'Come in<br>now'));
ok('QL-13 · says who is ready, and for which ticket', has(called, 'Nº 07 · YOUSSEF IS READY'));
ok('QL-13 · the chair hold counts down from eight minutes',
  has(called, 'CHAIR HELD FOR') && /data-until="[^"]+">[78]:\d\d</.test(called.body));
ok('ADDENDUM A6 · QL-13, word for word',
  has(called, 'After that Youssef takes Nº 08 and you&#39;d rejoin at the back.'));
ok('QL-13 · where the shop is', has(called, 'Le Fade Tanger · 14 Rue de la Kasbah'));
ok('QL-13 · names the text that went out', has(called, 'We also texted <strong>0700 00 00 03</strong>'));
ok('QL-13 · claims no directions it cannot know', !/min walk|pharmacy/i.test(visible(called.body)));
ok('QL-13 · both taps', has(called, 'I&#39;M WALKING IN') && has(called, 'GIVE ME 5 MINUTES'));
ok('QL-13 · the poll knows it is called',
  (await get(`${kenzaIn.location}?json=1`, as)).body.includes('"stage":"called"'));

const untilOf = async () => JSON.parse((await get(`${kenzaIn.location}?json=1`, as)).body).called_until;
const held = await untilOf();
const walkingIn = await post(`${kenzaIn.location}/coming`, {}, as);
const onWay = await get(kenzaIn.location, as);
ok('QL-13 · "I\'m walking in" tells the barber and stops no clock',
  walkingIn.status === 303 && has(onWay, 'Youssef can see you are on the way. The chair is still counting down.')
  && !has(onWay, 'I&#39;M WALKING IN') && (await untilOf()) === held);
await post(`${kenzaIn.location}/wait`, {}, as);
const longer = await untilOf();
ok('QL-13 · five minutes is five more minutes on the hold',
  Date.parse(longer) - Date.parse(held) === 5 * 60_000, [held, longer]);
await post(`${kenzaIn.location}/wait`, {}, as);
ok('…and it can only be asked for once', (await untilOf()) === longer);
const fiveMore = await get(kenzaIn.location, as);
ok('QL-13 · the page says the five minutes were added',
  has(fiveMore, 'Five minutes added, once.') && !has(fiveMore, 'GIVE ME 5 MINUTES'));

// ---- the addendum · QL-14 missed ---------------------------------------------------------
live.miss(kenzaToken, { calledMinAgo: 9, sinceCall: 3 });
const missed = await get(kenzaIn.location, as);
ok('QL-14 · the missed ticket, struck, with both times',
  has(missed, 'class="serif strike">Nº 07') && /Called \d\d:\d\d · released \d\d:\d\d/.test(missed.body));
ok('ADDENDUM A6 · QL-14, word for word', has(missed, 'Nothing was charged and this doesn&#39;t count against you.'));
ok('QL-14 · quotes the hold he was given', has(missed, 'Eight minutes is the hold every chair gets.'));
ok('QL-14 · says who arrived while the chair sat empty',
  has(missed, 'Rejoining puts you behind the 3 people who arrived while the chair sat empty.'));
ok('QL-14 · rejoining needs no code',
  has(missed, 'No new code needed — this number is already confirmed today.') && has(missed, 'REJOIN AS Nº 08'));
ok('QL-14 · offers no booking it cannot finish', !/\bbook/i.test(visible(missed.body)));

// the hold really ends, with nothing tapped in the browser: Omar was called and never came
live.call(omarIn.location.split('/').pop(), { minAgo: 9 });
const lapsed = await get(omarIn.location, as);
ok('QL-13 → QL-14 · the hold ends on its own',
  !has(lapsed, 'Come in<br>now') && has(lapsed, 'Eight minutes is the hold every chair gets.'));
// …and a guest taken off the line was never given eight minutes to be told about
const bilal = await post('/q/LF7K2M/join', { ...fields, first_name: 'Bilal', phone: '0700000005' }, as);
const bilalIn = await post(bilal.location, { code: lastText().code }, as);
live.miss(bilalIn.location.split('/').pop());
ok('QL-14 · no eight-minute claim when he was never called',
  !/Eight minutes/.test((await get(bilalIn.location, as)).body));
const texts = live.outbox.length;
const rejoined = await post(`${kenzaIn.location}/rejoin`, {}, as);
ok('QL-14 · rejoining opens a new ticket and sends no text',
  rejoined.status === 303 && /\/t\/[0-9a-f]{12}$/.test(rejoined.location ?? '') && rejoined.location !== kenzaIn.location
  && live.outbox.length === texts, [rejoined.location, live.outbox.length]);
ok('…and the missed ticket leads to it', (await get(kenzaIn.location, as)).location === rejoined.location);
ok('…once', (await post(`${kenzaIn.location}/rejoin`, {}, as)).location === rejoined.location);

for (const [name, page] of [
  ['QL-04', form], ['QL-05', codePage], ['QL-06', ticket], ['QL-10', oneLine],
  ['QL-11', wrong], ['QL-12', miss3], ['QL-15', frozen], ['QL-13', called], ['QL-14', missed],
]) clean(name, page);

if (failures) {
  console.error(`queue page: ${failures} check${failures === 1 ? '' : 's'} failed`);
  process.exit(1);
}
console.log('queue page: all checks pass');
