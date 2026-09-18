// Does the translation machinery actually answer in each language?
import { loc, setLang, tr, trn, trRich, weekdayName, weekdayDate } from './i18n';

let bad = 0;
const eq = (what: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${JSON.stringify(got)}${ok ? '' : ` — wanted ${JSON.stringify(want)}`}`);
};

eq('en falls through', tr('Book'), 'Book');
setLang('fr');
eq('fr word', tr('Book'), 'Réserver');
eq('fr fills vars', tr('Free at {at} today', { at: '15:30' }), 'Libre à 15:30 aujourd\'hui');
eq('fr singular', trn(1, '{n} visit', '{n} visits'), '1 visite');
eq('fr plural', trn(4, '{n} visit', '{n} visits'), '4 visites');
eq('fr zero is singular', trn(0, '{n} visit', '{n} visits'), '0 visite');
eq('fr locale', loc('en-US'), 'fr-MA');
eq('fr weekday', weekdayName(1), 'Lundi');
setLang('ar');
eq('ar word', tr('Book'), 'احجز');
eq('ar one', trn(1, '{n} visit', '{n} visits'), 'زيارة واحدة');
eq('ar two', trn(2, '{n} visit', '{n} visits'), 'زيارتان');
eq('ar few', trn(5, '{n} visit', '{n} visits'), '5 زيارات');
eq('ar many', trn(30, '{n} visit', '{n} visits'), '30 زيارة');
eq('ar zero takes the few form', trn(0, '{n} visit', '{n} visits'), '0 زيارات');
eq('ar locale', loc('en-US'), 'ar-MA');
eq('ar keeps western digits in a date', /[0-9]/.test(weekdayDate(new Date(2026, 8, 18))), true);
const parts = trRich('Your {rating}, your reviews and your cancellations are not here — they are not yours to edit. They sit on <a>your reviews</a> and <b>your cancellations</b>, with how each was counted.',
  { a: (t) => `[A:${t}]`, b: (t) => `[B:${t}]` }, { rating: '4.8' });
eq('rich keeps both tags', parts.filter((p) => typeof p === 'string' && p.startsWith('[')).length, 2);
eq('rich fills a var', parts.join('').includes('4.8'), true);
eq('an untranslated sentence still shows', tr('Sentence nobody wrote'), 'Sentence nobody wrote');
setLang('en');
eq('back to English', tr('Book'), 'Book');
console.log(bad ? `${bad} FAILED` : 'i18n runtime: all checks pass');
process.exit(bad ? 1 : 0);
