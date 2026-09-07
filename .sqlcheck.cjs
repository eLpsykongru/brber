// Pre-apply checks for a migration. Run as a FILE, never via `node -e` in a
// double-quoted shell string — that is what ate a `$` out of 0093 and 0098.
const fs = require('fs');
const file = process.argv[2];
const raw = fs.readFileSync(file, 'utf8');
const D = '$' + '$';
let bad = 0;

// 1 · dollar-quote pairing, and no stray single `$` on its own
const marks = (raw.match(/\$\$/g) || []).length;
if (marks % 2) { bad++; console.log('UNPAIRED dollar-quotes:', marks); }
const stray = raw.split('\n').filter((l) => /^\s*\$;?\s*$/.test(l) || /\bas \$$/.test(l.trimEnd()));
if (stray.length) { bad++; console.log('STRAY single $ on:', stray); }

// 2 · paren balance inside and outside every dollar-quoted body
const stripped = raw.replace(/--[^\n]*/g, '').replace(/'(?:''|[^'])*'/g, "''");
stripped.split(/\$\$/).forEach((p, i) => {
  const o = (p.match(/\(/g) || []).length;
  const c = (p.match(/\)/g) || []).length;
  if (o !== c) { bad++; console.log(`SEGMENT ${i} unbalanced: ${o} open, ${c} close`); }
});

// 3 · assertions that are plain arithmetic, evaluated before Postgres sees them
const blk = raw.lastIndexOf('do ' + D);
const asserts = blk < 0 ? [] : [...raw.slice(blk).matchAll(/assert\s+([\s\S]*?),\s*'/g)];
let checked = 0;
for (const [, expr] of asserts) {
  const js = expr.replace(/\s+/g, ' ')
    .replace(/\bnot\b/g, '!').replace(/<>/g, '!==')
    .replace(/([^<>!=])=([^=])/g, '$1===$2');
  if (!/^[\s\d()!=<>+\-*/.&|a-z]+$/i.test(js)) continue;      // not plain arithmetic
  if (/[a-z_]{3,}/i.test(js.replace(/and|or|true|false|null/gi, ''))) continue;
  checked++;
  try {
    if (Function('return (' + js.replace(/\band\b/g, '&&').replace(/\bor\b/g, '||') + ')')() !== true) {
      bad++; console.log('ASSERTION FALSE:', expr.replace(/\s+/g, ' ').slice(0, 90));
    }
  } catch { /* not evaluable here */ }
}

console.log(`${file}: ${bad ? bad + ' PROBLEM(S)' : 'clean'} · ${marks} markers · ${checked} arithmetic assertions checked`);
process.exit(bad ? 1 : 0);
