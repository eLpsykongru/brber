// Dead buttons: an optional `on*` handler that the component CALLS, but that
// some mount site never passes. `onRebook?.()` on a missing prop is silent —
// the button renders, the tap does nothing, and nothing typechecks wrong.
//
// Temporary tool; delete after use or keep as `npm run props`.
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

const parse = (f) =>
  ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const trees = new Map(files.map((f) => [f, parse(f)]));

// 1 · components -> their optional on* props that are actually invoked
const declared = new Map();   // componentName -> Set(propName)
for (const [file, src] of trees) {
  const visit = (node) => {
    let name = null, params = null, body = null;
    if (ts.isFunctionDeclaration(node) && node.name) { name = node.name.text; params = node.parameters; body = node.body; }
    else if (ts.isVariableDeclaration(node) && node.initializer
             && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      name = node.name.getText(); params = node.initializer.parameters; body = node.initializer.body;
    }
    if (name && /^[A-Z]/.test(name) && params && params.length === 1 && body) {
      const t = params[0].type;
      if (t && ts.isTypeLiteralNode(t)) {
        const text = body.getText();
        for (const m of t.members) {
          if (!ts.isPropertySignature(m) || !m.questionToken || !m.name) continue;
          const p = m.name.getText();
          if (!/^on[A-Z]/.test(p)) continue;
          // only care if the component actually calls it
          if (new RegExp('\\b' + p + '\\?\\.\\(').test(text) || new RegExp('\\b' + p + '\\s*&&').test(text)) {
            if (!declared.has(name)) declared.set(name, { file, props: new Set() });
            declared.get(name).props.add(p);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}


// Match by name ONLY when the name is actually in scope in that file: several
// files declare their own <Row>/<Tile>, and matching across them is noise.
const visibleCache = new Map();
function visible(file) {
  if (visibleCache.has(file)) return visibleCache.get(file);
  const src = trees.get(file);
  const set = new Set();
  const walkIt = (n) => {
    if (ts.isImportDeclaration(n) && n.importClause) {
      const c = n.importClause;
      if (c.name) set.add(c.name.text);
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) {
        for (const e of c.namedBindings.elements) set.add(e.name.text);
      }
    }
    if (ts.isFunctionDeclaration(n) && n.name) set.add(n.name.text);
    if (ts.isVariableDeclaration(n) && n.name && ts.isIdentifier(n.name)) set.add(n.name.text);
    ts.forEachChild(n, walkIt);
  };
  walkIt(src);
  visibleCache.set(file, set);
  return set;
}

// 2 · every JSX use of those components, and which of those props it omits
let found = 0;
for (const [file, src] of trees) {
  const visit = (node) => {
    const el = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
    if (el && ts.isIdentifier(el.tagName) && declared.has(el.tagName.text)
        && visible(file).has(el.tagName.text)) {
      const want = declared.get(el.tagName.text);
      const given = new Set(el.attributes.properties
        .filter((a) => ts.isJsxAttribute(a) && a.name).map((a) => a.name.getText()));
      const spread = el.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a));
      if (!spread) {
        const missing = [...want.props].filter((p) => !given.has(p));
        if (missing.length) {
          const ln = src.getLineAndCharacterOfPosition(el.getStart()).line + 1;
          console.log(`${file}:${ln}  <${el.tagName.text}> omits ${missing.join(', ')}  (declared in ${want.file})`);
          found += missing.length;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
}

console.log(`\n${declared.size} components with called-but-optional on* props · ${found} mount site(s) omitting one`);
