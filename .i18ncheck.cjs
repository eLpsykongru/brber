// French and Arabic coverage: every English sentence the app passes to tr(), trn(),
// trRich() or en() must have both translations in src/lib/i18n.dict.ts, with the
// same {placeholders} and <tags> as the English. A missing one still shows — in
// English — so this is the only place a gap is visible.
//
//   npm run i18n              report, exit 1 on a gap
//   npm run i18n -- --missing print the missing keys as JSON, for translating
//   npm run i18n -- --keys    every key in use, as JSON
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const files = ['App.tsx'];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p) && !/\.check\.ts$|i18n\.dict\.ts$/.test(p)) files.push(p);
  }
})('src');

const used = new Map();       // key -> first place it is used
const literals = new Set();   // every string literal, so data kept in English (a Verb, a stored tag) counts as used
let dynamic = 0;
const dynamicAt = [];
const plurals = new Set();
const texts = (n) => {
  if (ts.isParenthesizedExpression(n)) return texts(n.expression);
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return [n.text];
  if (ts.isConditionalExpression(n)) {
    const a = texts(n.whenTrue), b = texts(n.whenFalse);
    return a && b ? [...a, ...b] : null;
  }
  return null;
};
for (const file of files) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (n) => `${file.replace(/\\/g, '/')}:${src.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const add = (k, n) => { if (!used.has(k)) used.set(k, at(n)); };
  const visit = (n) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) literals.add(n.text);
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const fn = n.expression.text;
      if (['tr', 'trRich', 'en'].includes(fn) && n.arguments[0]) {
        const t = texts(n.arguments[0]);
        if (t) t.forEach((k) => add(k, n)); else { dynamic++; dynamicAt.push(at(n) + '  ' + n.getText().slice(0, 70)); }
      } else if (fn === 'trn' && n.arguments[2]) {
        const one = texts(n.arguments[1]), other = texts(n.arguments[2]);
        if (one?.length === 1 && other?.length === 1) { add(`${one[0]}|${other[0]}`, n); plurals.add(`${one[0]}|${other[0]}`); } else dynamic++;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
}

// English kept as data and translated where it shows — tr(verb), tr(label) — so no
// literal sits at the call. Add to this list when a new tr(variable) appears.
const DATA_KEYS = {
  'lib/line.ts verbOf': ['CALL HIM', "HE'S HERE", 'SEAT HIM'],
  'CustomerNotificationsScreen buckets': ['TODAY', 'YESTERDAY', 'EARLIER'],
  'lib/slots.ts DayState': ['closed', 'empty', 'partial', 'full'],
  'HeldBackScreen outcomes': ['Accepted', 'Declined', 'Offered — the first to tap it gets it'],
  '0042 removal_reason, underscores as spaces': ['no visit', 'abusive', 'personal details', 'off service', 'spam', 'duplicate', 'policy'],
  "0107 saved_can_book's reason": ['No longer on Sterncut', 'No shop on Sterncut', 'His shop is under review',
    'Not approved at this shop', 'Not taking bookings', 'Pulled from search'],
  'SettingsScreen appearance': ['Light', 'Dark', 'System'],
  'ShopScreens poster sizes': ['A4', 'A5', 'Sticker'],
};
for (const [where, keys] of Object.entries(DATA_KEYS)) for (const k of keys) if (!used.has(k)) used.set(k, where);

// the dictionary, read as data rather than run
const dictFile = 'src/lib/i18n.dict.ts';
const dictSrc = ts.createSourceFile(dictFile, fs.readFileSync(dictFile, 'utf8'), ts.ScriptTarget.Latest, true);
const dict = new Map();
const dupes = [];
(function find(n) {
  if (ts.isObjectLiteralExpression(n)) {
    for (const p of n.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isArrayLiteralExpression(p.initializer)) continue;
      const key = ts.isStringLiteral(p.name) || ts.isNoSubstitutionTemplateLiteral(p.name) ? p.name.text : p.name.getText();
      const [fr, ar] = p.initializer.elements.map((e) => (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : null));
      if (dict.has(key)) dupes.push(key);
      dict.set(key, [fr, ar]);
    }
    return;
  }
  ts.forEachChild(n, find);
})(dictSrc);

const holes = (s) => [...s.matchAll(/\{(\w+)\}|<\/?(\w+)>/g)].map((m) => m[0]).sort().join(' ');
const missing = [], wrong = [];
for (const [key, where] of used) {
  const row = dict.get(key);
  if (!row || !row[0] || !row[1]) { missing.push({ key, where }); continue; }
  const plural = plurals.has(key);
  const enForms = key.split('|');
  const want = holes(enForms[enForms.length - 1]);
  row.forEach((t, i) => {
    const forms = plural ? t.split('|') : [t];
    const lang = i ? 'ar' : 'fr';
    if (plural && lang === 'fr' && forms.length !== 2) wrong.push(`${key}\n    fr needs one|other, has ${forms.length} forms`);
    if (plural && lang === 'ar' && (forms.length < 1 || forms.length > 4)) wrong.push(`${key}\n    ar needs up to one|two|few|many, has ${forms.length}`);
    for (const f of forms) {
      // A count's form may leave a hole out — Arabic says "one cancellation", not
      // "{n} cancellation" — so there only an unknown hole is wrong. Anywhere else
      // a dropped {name} is a dropped name, and the holes must match exactly.
      const got = holes(f);
      const bad = plural
        ? got.split(' ').filter((h) => h && !want.includes(h)).join(' ')
        : (got === want ? '' : got || '(none)');
      if (bad) wrong.push(`${key}\n    ${lang}: "${f}" has [${got}], English has [${want}]`);
    }
  });
}
const stale = [...dict.keys()].filter((k) => !used.has(k) && !literals.has(k));

if (process.argv.includes('--dynamic')) { console.log(dynamicAt.join('\n')); process.exit(0); }
if (process.argv.includes('--keys')) { process.stdout.write(JSON.stringify([...used.keys()])); process.exit(0); }
if (process.argv.includes('--missing')) {
  process.stdout.write(JSON.stringify(missing.map((m) => m.key), null, 1));
  process.exit(0);
}
console.log(`${used.size} sentences in use, ${dict.size} translated, ${dynamic} dynamic calls (keys kept as data)`);
if (dupes.length) console.log(`\nDUPLICATE KEYS (${dupes.length}):\n  ` + dupes.join('\n  '));
if (missing.length) console.log(`\nMISSING (${missing.length}):\n` + missing.slice(0, 40).map((m) => `  ${m.where}  ${JSON.stringify(m.key)}`).join('\n') + (missing.length > 40 ? '\n  …' : ''));
if (wrong.length) console.log(`\nPLACEHOLDERS DIFFER (${wrong.length}):\n  ` + wrong.join('\n  '));
if (stale.length) console.log(`\nNOT USED ANY MORE (${stale.length}):\n  ` + stale.map((k) => JSON.stringify(k)).join('\n  '));
if (missing.length || wrong.length || dupes.length) process.exit(1);
console.log('i18n: every sentence has French and Arabic');
