// Find every hook called after a conditional return, using TypeScript's own
// parser rather than regexes. The regex version missed indentation styles and
// arrow components, which is how the AgentRoundScreen bug survived one pass.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.tsx')) files.push(p);
  }
})('src');

const isHookCall = (n) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^use[A-Z]/.test(n.expression.text);

let bad = 0, checked = 0;

for (const file of files) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = (n) => src.getLineAndCharacterOfPosition(n.getStart()).line + 1;

  const checkBody = (body, name) => {
    if (!body || !ts.isBlock(body)) return;
    checked++;
    // the first statement that can return early: an `if` containing a return,
    // or a bare return that is not the last statement
    let firstExit = null;
    for (const st of body.statements) {
      if (firstExit) break;
      if (ts.isIfStatement(st)) {
        let has = false;
        const look = (n) => { if (ts.isReturnStatement(n)) has = true; else ts.forEachChild(n, look); };
        look(st);
        if (has) firstExit = st;
      } else if (ts.isReturnStatement(st) && st !== body.statements[body.statements.length - 1]) {
        firstExit = st;
      }
    }
    if (!firstExit) return;

    // any hook call in a statement that comes after it, at this function's own
    // level (nested functions have their own hook order and are fine)
    const after = body.statements.filter((st) => st.pos > firstExit.pos);
    for (const st of after) {
      const seen = [];
      const look = (n) => {
        // do not descend into nested function bodies
        if (n !== st && (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n))) return;
        if (isHookCall(n)) seen.push(n);
        ts.forEachChild(n, look);
      };
      look(st);
      for (const h of seen) {
        bad++;
        console.log(`${file}:${line(h)}  ${name}()  calls ${h.expression.text} after a conditional return on line ${line(firstExit)}`);
      }
    }
  };

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) checkBody(node.body, node.name.text);
    else if (ts.isVariableDeclaration(node) && node.name && node.initializer
             && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      checkBody(node.initializer.body, node.name.getText());
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

console.log(`\n${checked} function bodies with an early return checked · ${bad} hook-order violation(s)`);
process.exit(bad ? 1 : 0);
