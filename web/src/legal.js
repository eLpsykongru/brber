// sterncut.ma's legal pages — WEB-14 privacy, WEB-15 terms, WEB-16 delete your account
// (design_handoff_sterncut_launch/3_legal_pages), and the footer every site page now
// carries. Rendered from legal-content.js, never retyped.
//
// DRAFT until a Moroccan lawyer has read it: the banner, the ⚑ highlights and the
// [bracket] chips stay on screen until every flag is resolved and every bracket
// filled. CONTACT_EMAIL and SUPPORT_PHONE fill their brackets as soon as they are set.

import { LEGAL } from './legal-content.js';

const SITE = 'https://sterncut.ma';
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** each page at its own address, per language (README "URLs") */
export const LEGAL_PATHS = {
  privacy: { fr: 'confidentialite', ar: 'ar/confidentialite', en: 'en/privacy' },
  terms: { fr: 'conditions', ar: 'ar/conditions', en: 'en/terms' },
  deletion: { fr: 'supprimer-mon-compte', ar: 'ar/supprimer-mon-compte', en: 'en/delete-account' },
};
/** the app links to /{lang}/terms and /{lang}/privacy; English already lives there */
export const LEGAL_REDIRECTS = {
  'fr/terms': '/conditions', 'fr/privacy': '/confidentialite',
  'ar/terms': '/ar/conditions', 'ar/privacy': '/ar/confidentialite',
};
/** path → [page, lang] */
export const LEGAL_ROUTES = Object.fromEntries(Object.entries(LEGAL_PATHS)
  .flatMap(([page, by]) => Object.entries(by).map(([lang, path]) => [path, [page, lang]])));

const NAV_HREF = { fr: ['/', '/pour-les-salons', '/tarifs'], ar: ['/', '/ar/salons', '/tarifs'], en: ['/', '/pour-les-salons', '/tarifs'] };
const OPEN_APP = { fr: "OUVRIR L'APP", ar: 'افتح التطبيق', en: 'OPEN THE APP' };
const LOGO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.5 20 20M8.2 16.5 20 4"/></svg>';
const MAIL = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
const brand = () => `<a class="lg-brand" href="/"><span class="lg-logo">${LOGO}</span><span class="lg-word">Sterncut</span></a>`;

// the brackets an environment variable can already answer
const FILL = {
  email: ['[e-mail de contact]', '[contact email]', '[البريد الإلكتروني للتواصل]'],
  phone: ['[téléphone du support]', '[support phone]', '[هاتف الدعم]'],
};
function fill(text, env) {
  let t = text;
  if (env.CONTACT_EMAIL) for (const b of FILL.email) t = t.split(b).join(env.CONTACT_EMAIL);
  if (env.SUPPORT_PHONE) for (const b of FILL.phone) t = t.split(b).join(env.SUPPORT_PHONE);
  return t;
}

/** ⟦n|flagged⟧ · ⟪page|link⟫ · [undecided] — escaped first, then marked up */
function segs(raw, lang, page, env) {
  const flags = LEGAL.flags[page] ?? {};
  return esc(fill(raw, env)).replace(/⟦(\d+)\|([^⟧]+)⟧|⟪(\w+)\|([^⟫]+)⟫|(\[[^\]]+\])/g, (m, n, flagged, to, label, bracket) => {
    if (n) return `<span class="lg-flag" title="${esc(flags[n] ?? '')}">${flagged}<sup>⚑${n}</sup></span>`;
    if (to) return `<a class="lg-link" href="/${LEGAL_PATHS[to]?.[lang] ?? ''}">${label}</a>`;
    return `<span class="lg-br">${bracket}</span>`;
  });
}

function block(b, lang, page, env) {
  const s = (x) => segs(x, lang, page, env);
  if (typeof b === 'string') return `<p>${s(b)}</p>`;
  if (Array.isArray(b)) return `<ul class="lg-ul">${b.map((x) => `<li>${s(x)}</li>`).join('')}</ul>`;
  if (b.h) return `<h3>${esc(b.h)}</h3>`;
  if (b.ol) return `<ol class="lg-ol">${b.ol.map((x, i) => `<li><span class="lg-disc">${i + 1}</span><span>${s(x)}</span></li>`).join('')}</ol>`;
  if (b.tmpl) return `<div class="lg-tmpl">${b.tmpl.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`;
  if (b.cta) {
    // the subject is the template's first line, after its label
    const tmpl = LEGAL.langs[lang][page].sections.flatMap((x) => x.body).find((y) => y && y.tmpl);
    const subject = tmpl ? tmpl.tmpl[0].replace(/^[^:：]*[:：]\s*/, '') : '';
    return `<a class="lg-cta" href="mailto:${esc(env.CONTACT_EMAIL ?? '')}?subject=${encodeURIComponent(subject)}">${MAIL}<span>${s(b.cta)}</span></a>`;
  }
  return '';
}

/** WEB-01's header, in the page's own language, with the app instead of a web sign-in (app-first) */
function header(lang, page) {
  const U = LEGAL.langs[lang].ui;
  const other = lang === 'fr' ? 'ar' : 'fr';
  return `<header class="lg-top">${brand()}<span class="lg-grow"></span>
<nav class="lg-nav" aria-label="Sterncut">${U.nav.map((t, i) => `<a href="${NAV_HREF[lang][i]}">${esc(t)}</a>`).join('')}</nav>
<a class="lg-other" lang="${other}" href="/${LEGAL_PATHS[page][other]}">${esc(LEGAL.langs[other].ui.name)}</a>
<a class="lg-pill" href="/app">${OPEN_APP[lang]}</a></header>`;
}

function langSwitch(lang, page) {
  return `<span class="lg-langs">${['fr', 'ar', 'en'].map((c) => `<a lang="${c}" href="/${LEGAL_PATHS[page][c]}"${c === lang ? ' class="on" aria-current="page"' : ''}>${esc(LEGAL.langs[c].ui.name)}</a>`).join('')}</span>`;
}

/** WEB-14 / 15 / 16 — the article, its contents, the draft banner; site.js frames it */
export function legalPage(page, lang, env = {}) {
  const U = LEGAL.langs[lang].ui;
  const P = LEGAL.langs[lang][page];
  const ar = lang === 'ar';
  const n = P.sections.length;
  const count = ar ? (n >= 11 ? `${n} قسماً` : `${n} أقسام`) : U.tocCount.replace('{n}', n);
  const toc = P.sections.map((x, i) => `<a href="#${x.id}" data-spy="${x.id}"${i === 0 ? ' class="on"' : ''}><span class="lg-num">${String(i + 1).padStart(2, '0')}</span><span>${esc(x.t)}</span></a>`).join('');
  const body = `${header(lang, page)}
<div class="lg-draft" role="note"><strong>${esc(U.draftTitle)}</strong> <span>${esc(U.draftBody)}</span></div>
<div class="lg-grid">
  <nav class="lg-toc" aria-label="${esc(U.toc)}"><span class="lg-label">${esc(U.toc)}</span>${toc}</nav>
  <article class="lg-article">
    <span class="lg-label">${esc(U.eyebrow)}</span>
    <h1>${esc(P.title)}</h1>
    <div class="lg-meta"><span class="lg-updated">${segs(U.updated, lang, page, env)}</span><span class="lg-faint">${esc(U.draftOf)}</span><span class="lg-grow"></span>${langSwitch(lang, page)}</div>
    <details class="lg-phone-toc"><summary><span>${esc(U.toc)}</span><span class="lg-faint">${esc(count)}</span></summary>${toc}</details>
    <p class="lg-intro">${segs(P.intro, lang, page, env)}</p>
    ${P.sections.map((x, i) => `<section id="${x.id}">
      <div class="lg-h2"><span class="lg-num">${String(i + 1).padStart(2, '0')}</span><h2>${esc(x.t)}</h2></div>
      <div class="lg-sum"><span class="lg-sum-label">${esc(U.summary)}</span><p>${segs(x.sum, lang, page, env)}</p></div>
      <div class="lg-body">${x.body.map((b) => block(b, lang, page, env)).join('\n')}</div>
    </section>`).join('\n')}
  </article>
</div>`;
  const alternates = ['fr', 'ar', 'en'].map((c) => `<link rel="alternate" hreflang="${c}" href="${SITE}/${LEGAL_PATHS[page][c]}">`).join('\n')
    + `\n<link rel="alternate" hreflang="x-default" href="${SITE}/${LEGAL_PATHS[page].fr}">`;
  return {
    title: `${P.title} · Sterncut`,
    description: P.intro.replace(/⟦\d+\||⟧|⟪\w+\||⟫/g, '').slice(0, 155),
    lang, dir: ar ? 'rtl' : 'ltr',
    head: `${alternates}\n<style>${LEGAL_CSS}</style>`,
    body,
    script: SPY,
    footerPage: page,
  };
}

/** The footer on every page of the site (new with WEB-14…16). `page` bolds the current legal page. */
export function siteFooter(lang = 'fr', page = null, env = {}) {
  const U = LEGAL.langs[lang].ui;
  const F = U.footer;
  const legal = ['privacy', 'terms', 'deletion'].map((k) => `<a href="/${LEGAL_PATHS[k][lang]}"${k === page ? ' class="on" aria-current="page"' : ''}>${esc(U.names[k])}</a>`).join('');
  // a legal page switches to itself in another language; elsewhere the site speaks French and, for salons, Arabic
  const langs = (page ? ['fr', 'ar', 'en'] : ['fr', 'ar']).map((c) => {
    const href = page ? `/${LEGAL_PATHS[page][c]}` : (c === 'ar' ? '/ar/salons' : '/');
    return `<a lang="${c}" href="${href}"${c === lang ? ' class="on"' : ''}>${esc(LEGAL.langs[c].ui.name)}</a>`;
  }).join('');
  const f = (t) => segs(t, lang, page ?? 'privacy', env);
  return `<footer class="lg-foot" lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><style>${FOOT_CSS}</style>
<div class="lg-foot-grid">
  <div class="lg-foot-brand">${brand()}<span>${esc(F.tagline)}</span></div>
  <div><span class="lg-foot-h">${esc(F.site)}</span>${U.nav.map((t, i) => `<a href="${NAV_HREF[lang][i]}">${esc(t)}</a>`).join('')}</div>
  <div><span class="lg-foot-h">${esc(F.legal)}</span>${legal}</div>
  <div><span class="lg-foot-h">${esc(F.contact)}</span><span>${f(F.email)}</span><span dir="ltr">${f(F.phone)}</span>
    <span class="lg-foot-h lg-foot-gap">${esc(F.langs)}</span><span class="lg-foot-langs">${langs}</span></div>
</div>
<div class="lg-foot-bottom">${f(`${F.copy}  ·  ${F.cndp}`)}</div>
</footer>`;
}

// scroll-spy: the section in view is the one the contents bolds
const SPY = `<script>(function(){var links=[].slice.call(document.querySelectorAll('.lg-toc [data-spy]'));if(!links.length||!('IntersectionObserver' in window))return;
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;links.forEach(function(a){a.classList.toggle('on',a.getAttribute('data-spy')===e.target.id)})})},{rootMargin:'-20% 0px -70% 0px'});
links.forEach(function(a){var s=document.getElementById(a.getAttribute('data-spy'));if(s)io.observe(s)})})();</script>`;

const LEGAL_CSS = `
.lg-grow{flex:1;min-width:0}
.lg-top{display:flex;align-items:center;gap:22px;flex-wrap:wrap;min-height:66px;padding:0 40px;border-bottom:1px solid rgba(0,0,0,.08)}
.lg-brand{display:flex;align-items:center;gap:9px;color:#111}
.lg-logo{width:28px;height:28px;border-radius:8px;background:#E8442E;display:flex;align-items:center;justify-content:center;flex:none}
.lg-word{font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:15px;letter-spacing:.14em;text-transform:uppercase}
.lg-nav{display:flex;gap:22px}
.lg-nav a,.lg-other{font-size:13px;font-weight:600;color:#5c5c58}
.lg-other:lang(ar){font-family:'Noto Kufi Arabic',sans-serif}
.lg-pill{height:36px;border-radius:999px;background:#101010;color:#fff;display:flex;align-items:center;padding:0 18px;font-size:12px;font-weight:700;letter-spacing:.04em}
[dir=rtl] .lg-pill{letter-spacing:0}
.lg-draft{background:rgba(232,68,46,.09);border-bottom:1px solid rgba(232,68,46,.22);padding:12px 40px;color:#7d2517;font-size:12.5px;line-height:1.5}
.lg-grid{display:grid;grid-template-columns:250px minmax(0,1fr);gap:72px;padding:56px 64px 96px;align-items:start;max-width:1280px;margin:0 auto}
.lg-toc{position:sticky;top:24px;display:flex;flex-direction:column}
.lg-label{font-size:10.5px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#8A8A85}
[dir=rtl] .lg-label,[dir=rtl] .lg-sum-label,[dir=rtl] h1,[dir=rtl] h2,[dir=rtl] h3{letter-spacing:0;text-transform:none}
.lg-toc .lg-label{margin-bottom:12px}
.lg-toc a,.lg-phone-toc a{display:flex;gap:10px;padding:8px 0;padding-inline-start:14px;border-inline-start:2px solid rgba(0,0,0,.12);font-size:13px;line-height:1.45;color:#5c5c58;font-weight:500}
.lg-toc a.on{border-inline-start-color:#111;color:#111;font-weight:700}
.lg-num{font-family:Inter,sans-serif;font-variant-numeric:tabular-nums;color:#8A8A85;font-size:12px;font-weight:700}
.lg-article{max-width:720px;display:flex;flex-direction:column}
.lg-article h1{margin:14px 0 0;font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:46px;line-height:1.05;letter-spacing:.01em;text-transform:uppercase;text-wrap:balance}
[dir=rtl] .lg-article h1{font-family:'Noto Kufi Arabic',sans-serif;font-size:36px;line-height:1.55}
.lg-meta{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-top:20px}
.lg-updated{font-size:13px;color:#5c5c58}
.lg-faint{font-size:12px;color:#8A8A85}
.lg-langs{display:flex;gap:2px;background:#E1DED6;border-radius:999px;padding:3px}
.lg-langs a{height:30px;border-radius:999px;display:flex;align-items:center;padding:0 13px;font-size:12px;font-weight:700;color:#5c5c58}
.lg-langs a:lang(ar){font-family:'Noto Kufi Arabic',sans-serif}
.lg-langs a.on{background:#101010;color:#fff}
.lg-intro{margin:30px 0 0;font-size:18px;line-height:1.6;color:#2b2b28;text-wrap:pretty}
.lg-article section{scroll-margin-top:24px;margin-top:52px;padding-top:28px;border-top:1px solid rgba(0,0,0,.1)}
.lg-h2{display:flex;align-items:baseline;gap:14px}
.lg-article h2{margin:0;font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:24px;line-height:1.2;letter-spacing:.01em;text-transform:uppercase}
[dir=rtl] .lg-article h2{font-family:'Noto Kufi Arabic',sans-serif;font-size:21px;line-height:1.6}
.lg-sum{margin-top:18px;background:#fff;border-radius:16px;padding:16px 20px;box-shadow:0 4px 14px rgba(0,0,0,.04)}
.lg-sum-label{display:block;font-size:10.5px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#E8442E}
.lg-sum p{margin:6px 0 0;font-size:15.5px;line-height:1.55;font-weight:600;text-wrap:pretty}
.lg-body{display:flex;flex-direction:column;gap:14px;margin-top:22px;font-size:15.5px;line-height:1.7;color:#2b2b28}
[dir=rtl] .lg-body{line-height:1.95}
.lg-body p{margin:0;text-wrap:pretty}
.lg-body h3{margin:10px 0 -4px;font-size:11.5px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#111}
[dir=rtl] .lg-body h3{font-size:14px}
.lg-ul,.lg-ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.lg-ul li{display:flex;gap:12px}
.lg-ul li::before{content:"";width:6px;height:6px;border-radius:999px;background:#8A8A85;flex:none;margin-top:10px}
[dir=rtl] .lg-ul li::before{margin-top:12px}
.lg-ol{gap:10px}
.lg-ol li{display:flex;gap:14px;align-items:flex-start}
.lg-disc{width:28px;height:28px;border-radius:999px;background:#101010;color:#fff;font-family:Inter,sans-serif;font-size:12.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}
.lg-ol li>span:last-child{padding-top:1px}
.lg-tmpl{background:#fff;border:1px dashed #C9C5BB;border-radius:14px;padding:16px 20px;display:flex;flex-direction:column;gap:4px;font-family:ui-monospace,Menlo,monospace;font-size:13.5px;line-height:1.6}
[dir=rtl] .lg-tmpl{font-family:'Noto Kufi Arabic',sans-serif}
.lg-cta{align-self:flex-start;min-height:50px;border-radius:999px;background:#101010;color:#fff;display:inline-flex;align-items:center;gap:10px;padding:0 24px;font-size:13.5px;font-weight:700}
.lg-flag{background:rgba(232,161,0,.17);box-shadow:inset 0 -1.5px 0 #C98A12;border-radius:3px;padding:0 2px;cursor:help}
.lg-flag sup{font-family:Inter,sans-serif;font-size:9.5px;font-weight:700;color:#8F5E14;margin-inline-start:3px}
.lg-br{background:rgba(140,137,128,.14);border:1px dashed rgba(140,137,128,.6);border-radius:5px;padding:0 4px;font-weight:600}
.lg-link{color:#111;font-weight:700;text-decoration:underline;text-underline-offset:3px}
.lg-phone-toc{display:none}
@media (max-width:900px){
  .lg-top{padding:4px 12px 8px 20px;gap:9px;min-height:0}
  .lg-nav,.lg-pill{display:none}
  .lg-other{min-height:44px;display:flex;align-items:center;padding:0 6px}
  .lg-draft{padding:12px 20px}
  .lg-grid{display:block;padding:28px 20px 64px}
  .lg-toc{display:none}
  .lg-article h1{font-size:30px}
  [dir=rtl] .lg-article h1{font-size:25px}
  .lg-article h2{font-size:19px}
  [dir=rtl] .lg-article h2{font-size:18px}
  .lg-langs{min-height:44px;align-items:center}
  .lg-langs a{height:38px}
  .lg-phone-toc{display:block;margin-top:18px;background:#fff;border-radius:16px;padding:0 16px}
  .lg-phone-toc summary{min-height:46px;display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:14px;cursor:pointer;list-style:none}
  .lg-phone-toc summary::-webkit-details-marker{display:none}
  .lg-phone-toc a{min-height:46px;align-items:center}
}`;

const FOOT_CSS = `
.lg-foot{background:#101010;color:#fff;padding:52px 64px 30px;font-family:Inter,system-ui,sans-serif}
.lg-foot[dir=rtl]{font-family:'Noto Kufi Arabic',Inter,sans-serif}
.lg-foot a{color:#BDBAB2}
.lg-foot a.on{color:#fff;font-weight:700}
.lg-foot-grid{display:grid;grid-template-columns:1.5fr 1fr 1.2fr 1.2fr;gap:40px;max-width:1280px;margin:0 auto}
.lg-foot-grid>div{display:flex;flex-direction:column;gap:10px;font-size:13px;color:#BDBAB2}
.lg-foot-brand{gap:12px!important}
.lg-foot .lg-brand{color:#fff}
.lg-foot .lg-logo{width:28px;height:28px;border-radius:8px;background:#E8442E;display:flex;align-items:center;justify-content:center}
.lg-foot .lg-word{font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:15px;letter-spacing:.14em;text-transform:uppercase}
.lg-foot-h{font-size:10.5px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#8A8A85;margin-bottom:2px}
.lg-foot[dir=rtl] .lg-foot-h{letter-spacing:0}
.lg-foot-gap{margin-top:10px}
.lg-foot-langs{display:flex;gap:14px}
.lg-foot-langs a:lang(ar){font-family:'Noto Kufi Arabic',sans-serif}
.lg-foot .lg-br{background:none;border:1px dashed rgba(255,255,255,.35);border-radius:5px;padding:0 4px;font-weight:400}
.lg-foot .lg-flag{background:none;box-shadow:none}
.lg-foot-bottom{max-width:1280px;margin:40px auto 0;padding-top:20px;border-top:1px solid rgba(255,255,255,.12);font-size:12px;line-height:1.7;color:#9A9A95}
@media (max-width:900px){
  .lg-foot{padding:40px 20px 28px}
  .lg-foot-grid{grid-template-columns:1fr;gap:28px}
  .lg-foot-grid a{min-height:44px;display:flex;align-items:center}
}`;
