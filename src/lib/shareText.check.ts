// Self-check for what the queue link's texts say and cost. Runs with the rest:
//
//     npm run check
//
// A character outside the GSM alphabet doubles what every text costs, and
// nothing on screen would show it.

import { shareMessage, smsLength } from './shareText';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failures++;
  console.error(`FAIL  ${label} → ${e}  (got ${a})`);
}

const URL = 'https://sterncut.ma/q/LF7K2M?b=Y4SF';
const youssef = { name: 'Youssef E.', waiting: 3, waitMin: 40 };

const chair = shareMessage({ shop: 'Le Fade Tanger', url: URL, chair: youssef });
eq('BTD-11, his chair — the wait first, the link second (qlink)', chair,
  'Sterncut: Le Fade Tanger, 3 ahead, about 40 min. Take your place with Youssef: https://sterncut.ma/q/LF7K2M?b=Y4SF');
eq('…is one send', smsLength(chair), { chars: 114, limit: 160, sends: 1 });
eq('the design\'s "~" would cost an extra place', smsLength(chair.replace('about ', '~')).chars, 110);
eq('the whole shop names whoever is soonest',
  shareMessage({ shop: 'Le Fade Tanger', url: 'https://sterncut.ma/q/LF7K2M', soonest: { name: 'Hamza B.', waiting: 0, waitMin: 5 } }),
  'Sterncut: Le Fade Tanger, Hamza is free in about 5 min. Take your place: https://sterncut.ma/q/LF7K2M');
eq('a shop with nobody taking still gets the link',
  shareMessage({ shop: 'Le Fade Tanger', url: 'https://sterncut.ma/q/LF7K2M' }),
  'Sterncut: Le Fade Tanger. See the wait: https://sterncut.ma/q/LF7K2M');
eq('A2 · "no app needed" is false now and is never sent', /no app/i.test(chair), false);

// 0118's confirm text and 0113's next text, as queued
eq('the confirm text is one send',
  smsLength('Sterncut: Ticket 07 at Le Fade Tanger with Youssef, about 40 min. Confirm with one tap: https://sterncut.ma/c/0123456789ab'),
  { chars: 122, limit: 160, sends: 1 });
eq('…and Messages Out\'s "Nº" would make it two',
  smsLength('Sterncut: Nº 07 at Le Fade Tanger with Youssef, about 40 min. Confirm with one tap: https://sterncut.ma/c/0123456789ab').sends, 2);
eq('the you\'re-next text is one send',
  smsLength("You're next at Le Fade Tanger. Youssef is finishing up - come to the chair now. 14 Rue de la Kasbah. Ticket 07.").sends, 1);
eq('a brace takes two places', smsLength('{}'), { chars: 4, limit: 160, sends: 1 });
eq('a long plain text splits at 153', smsLength('a'.repeat(161)).sends, 2);

if (failures) throw new Error(`shareText: ${failures} check${failures === 1 ? '' : 's'} failed`);
console.log('shareText: all checks pass');
