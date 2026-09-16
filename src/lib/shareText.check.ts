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
eq('BTD-11, his chair', chair,
  "Youssef at Le Fade Tanger. 3 waiting, about 40 min. Take a place in today's line here - no app needed: https://sterncut.ma/q/LF7K2M?b=Y4SF");
eq('…is one send', smsLength(chair), { chars: 138, limit: 160, sends: 1 });
eq('the design\'s em dash would make it three',
  smsLength(chair.replace(' - ', ' — ')).sends, 3);
eq('the whole shop names whoever is soonest',
  shareMessage({ shop: 'Le Fade Tanger', url: 'https://sterncut.ma/q/LF7K2M', soonest: { name: 'Hamza B.', waiting: 0, waitMin: 5 } }),
  "Le Fade Tanger. Hamza is free in about 5 min. Take a place in today's line here - no app needed: https://sterncut.ma/q/LF7K2M");
eq('a shop with nobody taking still gets the link',
  shareMessage({ shop: 'Le Fade Tanger', url: 'https://sterncut.ma/q/LF7K2M' }),
  "Le Fade Tanger. Take a place in today's line here - no app needed: https://sterncut.ma/q/LF7K2M");

// 0111's code text and 0113's next text, as queued
eq('the code text is one send',
  smsLength("Sterncut : votre code est 4417. Valable 5 min. Si vous n'avez rien demandé, ignorez ce message.").sends, 1);
const curly = smsLength('Sterncut : votre code est 4417. Valable 5 min. Si vous n’avez rien demandé, ignorez ce message.');
eq('…and with the curly apostrophe it was two', [curly.limit, curly.sends], [70, 2]);
eq('the you\'re-next text is one send',
  smsLength("You're next at Le Fade Tanger. Youssef is finishing up - come to the chair now. 14 Rue de la Kasbah. Ticket 07.").sends, 1);
eq('a brace takes two places', smsLength('{}'), { chars: 4, limit: 160, sends: 1 });
eq('a long plain text splits at 153', smsLength('a'.repeat(161)).sends, 2);

if (failures) throw new Error(`shareText: ${failures} check${failures === 1 ? '' : 's'} failed`);
console.log('shareText: all checks pass');
