// Self-check for reading a shop code. Runs with the rest:
//
//     npm run check
//
// A code that parses wrong sends a walk-in to the wrong shop, or tells him a
// real poster "is not one of ours" — and nothing else in the app would notice.

import { isUuid, parseShopCode, queueLanding } from './shopCode';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.error(`FAIL  ${label} → ${e}  (got ${a})`);
}

const SALON = '0f8fad5b-d9cb-469f-a165-70867728950e';
const BARBER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

eq('the poster link', parseShopCode('https://sterncut.ma/q/LF7K2M'), { shop: 'LF7K2M' });
eq('a barber link', parseShopCode('sterncut.ma/q/LF7K2M?b=Y4SF'), { shop: 'LF7K2M', barber: 'Y4SF' });
eq('lower case, as a phone keyboard types it', parseShopCode('sterncut.ma/q/lf7k2m?b=y4sf'), { shop: 'LF7K2M', barber: 'Y4SF' });
eq('typed with a space', parseShopCode('LF7 K2M'), { shop: 'LF7K2M' });
eq('typed with a dash', parseShopCode(' lf7-k2m '), { shop: 'LF7K2M' });
eq('a link ending a sentence', parseShopCode('Take a place here: sterncut.ma/q/LF7K2M.'), { shop: 'LF7K2M' });
eq('the whole WhatsApp message',
  parseShopCode("Youssef at Le Fade Tanger. 3 waiting, about 40 min. Take a place in today's line here — no app needed: sterncut.ma/q/LF7K2M?b=Y4SF"),
  { shop: 'LF7K2M', barber: 'Y4SF' });
eq('served from another host', parseShopCode('https://sterncut-q.pages.dev/q/LF7K2M'), { shop: 'LF7K2M' });
eq('a poster printed before 0110', parseShopCode(`https://sterncut.ma/q/${SALON}`), { shop: SALON });
eq('…with a barber uuid', parseShopCode(`https://sterncut.ma/q/${SALON.toUpperCase()}?b=${BARBER}`), { shop: SALON, barber: BARBER });
eq('a bare uuid', parseShopCode(SALON), { shop: SALON });
eq('a bad barber is dropped, the shop kept', parseShopCode('sterncut.ma/q/LF7K2M?b=ZZ'), { shop: 'LF7K2M' });
eq('0 is not in the alphabet', parseShopCode('LF0K2M'), null);
eq('O is not in the alphabet', parseShopCode('LFOK2M'), null);
eq('seven characters is not a code', parseShopCode('LF7K2MX'), null);
eq('words are not a code', parseShopCode('hello there'), null);
eq('an empty scan', parseShopCode('   '), null);
eq('isUuid', [isUuid(SALON), isUuid('LF7K2M'), isUuid(`${SALON}x`)], [true, false, false]);

// option (b): only a landing opens the check-in in the app
eq('a barber link opens the app', queueLanding('https://sterncut.ma/q/LF7K2M?b=Y4SF'), { shop: 'LF7K2M', barber: 'Y4SF' });
eq('the poster opens the app', queueLanding('https://sterncut-q.pages.dev/q/LF7K2M'), { shop: 'LF7K2M' });
eq('an old poster opens the app', queueLanding(`https://sterncut.ma/q/${SALON}`), { shop: SALON });
eq('a web ticket is not a landing', queueLanding('https://sterncut.ma/q/LF7K2M/t/0123456789ab'), null);
eq('the join step is not a landing', queueLanding(`https://sterncut.ma/q/LF7K2M/join?b=Y4SF&s=${SALON}`), null);
eq('the sign-in return is not a landing', queueLanding('sterncut://auth#access_token=x'), null);
eq('a code typed by hand is not a link', queueLanding('LF7K2M'), null);

if (failures) throw new Error(`shopCode: ${failures} check${failures === 1 ? '' : 's'} failed`);
console.log('shopCode: all checks pass');
