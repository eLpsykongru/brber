// sterncut.ma itself — "Public - Website" (WEB-01 … WEB-06, WEB-11 … WEB-13) and
// "Public - List Your Shop" (PUB-01), server-rendered like the queue page: one HTML
// response, no framework, no bundle.
//
// App-first, decided with the owner 2026-09-19: the website explains, prices and
// sends people to the app, where booking, the shop application (PUB-02/03 are the
// app's onboarding and ApplicationScreen) and every account already live. So:
//   · no web search box — "INSCRIRE MON SALON" and the home page open the app;
//   · no web sign-in (WEB-07 … WEB-10) — nothing on the web needs an account;
//   · WEB-11 (new password) IS here, because a reset link opened in a browser
//     has nowhere else to land.
//
// What the designs printed and this does not, on purpose:
//   · fixture numbers ("42 SALONS · 168 COIFFEURS", "1,4 j") — read from
//     `site_numbers` (0126) and left out when there is no honest value;
//   · "40 DH par coiffeur" (PUB-01) — the price is 55 DH monthly or 40 DH yearly,
//     so the floor is "dès 40 DH"; every price comes from the same row the
//     billing rail snapshots for a new shop;
//   · "8% à partir de demain" (PUB-04) — there is no commission;
//   · the SMS price — unconfirmed (billing README §8.3), so none is printed;
//   · WEB-06's "prélevé à part, jamais sur votre caisse" — the subscription is
//     netted off the Friday deposits (OSB-03); and its "Ce n'est pas une
//     simulation" over invented numbers, which is labelled an example instead;
//   · owners' names and faces, live "libres maintenant" cards and photos nobody
//     has supplied. A photo box shows `/img/<name>.jpg` once it exists.

const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800'
  + '&family=Playfair+Display:wght@700;800&family=Noto+Kufi+Arabic:wght@400;500;700&display=swap';

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ENTITIES[c]);
/** 192000 → "1 920 DH" (cents in). A thin space groups thousands, as the designs print. */
export const dh = (cents) => `${Math.round(Math.abs(cents) / 100).toLocaleString('en-US').replace(/,/g, ' ')} DH`;
const dhWhole = (cents) => Math.round(cents / 100);
/** 103 → "1,03" */
const comma = (cents) => (cents / 100).toFixed(2).replace('.', ',');
const WORDS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];
const word = (n) => WORDS[n] ?? String(n);
const ORDINAL = ['', 'premier', 'deuxième', 'troisième', 'quatrième', 'cinquième', 'sixième', 'septième',
  'huitième', 'neuvième', 'dixième', 'onzième'];

// the list price today, when the database cannot be asked — the same numbers
// 0123 put in platform_settings, so a page with no database still tells the truth
export const LIST = { monthly_cents: 5500, yearly_cents: 4000, cap: 4, sms_included: 200, sms_unit_cents: null };

/** The plan's arithmetic, rounded DOWN like the app's (billing README §4). */
export function priceOf(p) {
  const year = { monthly: p.monthly_cents * 12, yearly: p.yearly_cents * 12 };
  return {
    monthsFree: Math.floor(12 - year.yearly / p.monthly_cents),
    pct: Math.floor((1 - p.yearly_cents / p.monthly_cents) * 100),
    /** what n chairs cost: only the first `cap` are billed */
    month: (n) => Math.min(n, p.cap) * p.monthly_cents,
    year: (n) => Math.min(n, p.cap) * year.yearly,
  };
}

const svg = (size, stroke, width, paths) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${width}" aria-hidden="true">${paths}</svg>`;
const ICON = {
  logo: svg(15, '#fff', 2, '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8.2 7.5 20 20M8.2 16.5 20 4"/>'),
  tick: svg(15, '#E8442E', 2.4, '<path d="M4 12.5 9.5 18 20 6.5"/>'),
  tickGreen: svg(16, '#16A34A', 2.2, '<path d="M4 12.5 9.5 18 20 6.5"/>'),
  info: svg(15, '#8A8A85', 1.9, '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8.5h.01"/>'),
  arrow: svg(16, '#111', 2, '<path d="M9 6l6 6-6 6"/>'),
  shield: svg(17, '#15803D', 2.2, '<path d="M12 3 4 6.5v5c0 4.6 3.3 8.4 8 9.5 4.7-1.1 8-4.9 8-9.5v-5z"/>'),
  doc: svg(16, '#111', 1.9, '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 8h8M8 12h8M8 16h4"/>'),
  lock: svg(20, '#111', 1.9, '<rect x="4" y="10" width="16" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  phone: svg(15, 'currentColor', 2, '<path d="M5 4h4l2 5-2.5 1.5a12 12 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 6.2 2 2 0 0 1 5 4z"/>'),
  handset: svg(15, '#fff', 2, '<rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18.5h2"/>'),
  house: svg(26, '#B9B6AD', 1.7, '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/>'),
  wrench: svg(26, '#E8442E', 1.7, '<path d="M14.5 3.5a5 5 0 0 0-6.6 6.2L3 14.6 6.4 18l4.9-4.9a5 5 0 0 0 6.2-6.6l-3 3-2.1-2.1z"/>'),
  apple: '<svg width="17" height="17" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M16.4 12.8c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.9-3-.8c-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .8 1.1 1.6 2.3 2.8 2.2 1.1 0 1.6-.7 2.9-.7s1.7.7 2.9.7 2-1.1 2.7-2.2c.9-1.2 1.2-2.4 1.3-2.5-.1 0-2.4-.9-2.4-3.6zM14.2 5.9c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z"/></svg>',
  play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M4 3.2v17.6c0 .5.3.8.6.9l9.3-9.7L4.6 2.3c-.3.2-.6.5-.6.9z"/><path d="m16.6 9.1-2.3-1.3-2.6 2.7 2.6 2.7 2.3-1.3c.9-.5.9-1.9 0-2.4z" opacity=".85"/><path d="m5.4 21.7 8.3-4.7-2.4-2.5-5.9 6.2c-.1.5 0 .9 0 1z" opacity=".7"/></svg>',
};

// ---- the frame -----------------------------------------------------------------------
function shell({ title, description, body, lang = 'fr', dir = 'ltr', index = true, dark = false, head = '', script = '' }) {
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${index ? '' : '<meta name="robots" content="noindex">\n'}<meta name="theme-color" content="${dark ? '#101010' : '#EBE8E1'}">
<meta property="og:site_name" content="Sterncut">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#E8442E"/><g fill="none" stroke="#fff" stroke-width="2"><circle cx="7" cy="7" r="2.3"/><circle cx="7" cy="17" r="2.3"/><path d="M9 8.5 19 19M9 15.5 19 5"/></g></svg>')}">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}" media="print" onload="this.media='all'">
<style>${SITE_CSS}</style>${head}
</head>
<body${dark ? ' class="dark"' : ''}${dir === 'rtl' ? ' dir="rtl"' : ''}>
${body}
${script}
</body>
</html>`;
}

const brand = (href = '/') => `<a class="brand" href="${href}"><span class="logo">${ICON.logo}</span><span class="wordmark">Sterncut</span></a>`;

function nav(on) {
  const link = (href, key, label) => `<a href="${href}"${on === key ? ' class="on" aria-current="page"' : ''}>${label}</a>`;
  return `<header class="top">${brand()}
<nav class="nav" aria-label="Sterncut">${link('/', 'clients', 'Pour les clients')}${link('/pour-les-salons', 'salons', 'Pour les salons')}${link('/tarifs', 'tarifs', 'Tarifs')}<a href="/ar/salons" lang="ar" dir="rtl" class="ar">العربية</a></nav>
<a class="pill" href="/app">OUVRIR L'APP</a></header>`;
}

/** A thin header for the pages under /tarifs and the utility pages. */
const back = (href, label) => `<header class="top thin">${brand()}<span class="grow"></span><a class="backlink" href="${href}">← ${label}</a></header>`;

// the App Store badge only once there is an App Store listing (IOS_APP_STORE_ID)
function stores(ctx) {
  return `<div class="stores">${ctx.appStore ? `<a class="store" href="${esc(ctx.appStore)}">${ICON.apple}<span><small>Télécharger sur</small>App Store</span></a>` : ''}`
    + `<a class="store" href="${esc(ctx.playStore)}">${ICON.play}<span><small>Disponible sur</small>Google Play</span></a></div>`;
}

// A photo is a file in web/public/img/ — clients.jpg (WEB-01) and salons.jpg (the
// pitch), landscape, ~1400×1000, under 250 KB, and only ones Sterncut may use.
// Until one is there the box is plain #DAD6CC, which is how the designs draw it.
const photo = (name, label) => `<div class="photo" role="img" aria-label="${esc(label)}" style="background-image:url(/img/${name}.jpg)"></div>`;

const talk = (ctx, label, cls = 'ghost') => (ctx.phone
  ? `<a class="${cls}" href="tel:${esc(ctx.phone.replace(/\s/g, ''))}">${ICON.phone}${label}</a>` : '');

// ---- WEB-01 · the chair, today, near you ------------------------------------------------
function home(ctx) {
  const n = ctx.numbers;
  const count = n && n.salons > 0
    ? `TANGER · ${n.salons} SALON${n.salons > 1 ? 'S' : ''}${n.barbers > 0 ? ` · ${n.barbers} COIFFEUR${n.barbers > 1 ? 'S' : ''}` : ''}`
    : 'TANGER';
  return shell({
    title: 'Sterncut · une place aujourd\'hui, à Tanger',
    description: 'Voyez qui est libre maintenant, réservez en trois taps, et arrivez à l\'heure de votre créneau.',
    body: `${nav('clients')}
<main class="split">
<section class="copy">
<p class="eyebrow">${count}</p>
<h1 class="display">Une place<br>aujourd'hui</h1>
<p class="lede">Voyez qui est libre maintenant, réservez en trois taps, et arrivez à l'heure de votre créneau. Pas de file, pas d'appel.</p>
<p class="label">L'APPLICATION</p>
${stores(ctx)}
</section>
<section class="media">${photo('clients', 'Un salon de coiffure à Tanger')}</section>
</main>`,
  });
}

// ---- PUB-01 (desktop) / WEB-02 (phone) · the pitch, one number, one button ---------------
function salons(ctx) {
  const n = ctx.numbers;
  const reply = n?.reply_days != null ? String(n.reply_days).replace('.', ',') : null;
  return shell({
    title: 'Sterncut pour les salons · votre fauteuil, toujours plein',
    description: `Les clients réservent, paient un acompte, et se présentent. Dès ${dhWhole(ctx.price.yearly_cents)} DH par coiffeur et par mois, sans commission.`,
    body: `${nav('salons')}
<main class="split">
<section class="copy">
<p class="eyebrow">${n && n.salons > 0 ? `TANGER · ${n.salons} SALON${n.salons > 1 ? 'S' : ''}` : 'TANGER'}</p>
<h1 class="display">Votre fauteuil,<br>toujours plein</h1>
<p class="lede">Les clients réservent, paient un acompte, et se présentent. Vous gardez votre caisse, vos prix et vos habitudes.</p>
<div class="actions"><a class="cta" href="/app">INSCRIRE MON SALON</a>${talk(ctx, 'PARLER À QUELQU\'UN')}</div>
<p class="fine">Le dossier du salon se remplit dans l'application : cinq questions, cinq minutes.</p>
<div class="stats">
<span><b class="num">dès ${dhWhole(ctx.price.yearly_cents)} DH</b><small>par coiffeur, par mois</small></span>
<span><b class="num">0</b><small>commission sur vos réservations</small></span>
${reply ? `<span><b class="num">${reply} j</b><small>délai moyen de réponse</small></span>` : ''}
</div>
</section>
<section class="media">${photo('salons', 'La devanture d\'un salon')}
<div class="changes"><p class="label dim">CE QUE ÇA CHANGE</p>
<p>${ICON.tick}<span>Un acompte payé d'avance : moins de fauteuils vides</span></p>
<p>${ICON.tick}<span>Vos prix restent les vôtres</span></p>
<p>${ICON.tick}<span>Le cash reste du cash</span></p></div>
</section>
</main>`,
  });
}

// ---- WEB-03 · العربية --------------------------------------------------------------------
function salonsAr(ctx) {
  const n = ctx.numbers;
  const reply = n?.reply_days != null ? String(n.reply_days).replace('.', ',') : null;
  return shell({
    lang: 'ar',
    dir: 'rtl',
    title: 'Sterncut للصالونات · كرسيك، دائماً ممتلئ',
    description: 'الزبناء يحجزون، يدفعون تسبيقاً، ويحضرون في الوقت. بدون عمولة.',
    body: `<header class="top">${brand()}
<nav class="nav" aria-label="Sterncut"><a href="/">للزبائن</a><a href="/ar/salons" class="on" aria-current="page">للصالونات</a><a href="/tarifs">الأثمنة</a><a href="/pour-les-salons" lang="fr" dir="ltr">Français</a></nav>
<a class="pill" href="/app">دخول</a></header>
<main class="split">
<section class="copy">
<p class="eyebrow">${n && n.salons > 0 ? `طنجة · ${n.salons} صالون` : 'طنجة'}</p>
<h1 class="display-ar">كرسيك، دائماً ممتلئ</h1>
<p class="lede">الزبناء يحجزون، يدفعون تسبيقاً، ويحضرون في الوقت. تبقى لك صندوقك، وأثمنتك، وطريقة عملك كما هي.</p>
<div class="actions"><a class="cta" href="/app">سجّل صالوني</a>${talk(ctx, 'تكلم مع أحدنا')}</div>
<p class="fine">يُملأ ملف الصالون داخل التطبيق: خمسة أسئلة، خمس دقائق.</p>
<div class="stats">
<span><b class="num" dir="ltr">من ${dhWhole(ctx.price.yearly_cents)} DH</b><small>لكل حلاق، في الشهر</small></span>
<span><b class="num" dir="ltr">0</b><small>عمولة على الحجوزات</small></span>
${reply ? `<span><b class="num" dir="ltr">${reply}</b><small>يوم للجواب</small></span>` : ''}
</div>
</section>
<section class="media">${photo('salons', 'واجهة صالون')}
<div class="changes"><p class="label dim">ما الذي يتغير</p>
<p>${ICON.tick}<span>تسبيق مدفوع مسبقاً: كراسي فارغة أقل</span></p>
<p>${ICON.tick}<span>أثمنتك تبقى أثمنتك</span></p>
<p>${ICON.tick}<span>النقد يبقى نقداً، لا يمر من عندنا</span></p></div>
</section>
</main>`,
  });
}

// ---- WEB-04 · un abonnement, et c'est tout ------------------------------------------------
const STEP_START = 6;

function tarifs(ctx) {
  const p = ctx.price;
  const m = priceOf(p);
  const month = dhWhole(p.monthly_cents);
  const year = dhWhole(p.yearly_cents);
  const next = ORDINAL[p.cap + 1] ?? `${p.cap + 1}e`;
  const smsLine = p.sms_unit_cents
    ? `La seule ligne qu'on facture en plus : les SMS aux clients qui n'ont pas l'app — ${p.sms_included} par mois inclus, puis ${comma(p.sms_unit_cents)} DH. Les notifications dans l'app sont gratuites.`
    : `La seule ligne qui pourra s'ajouter : les SMS aux clients qui n'ont pas l'app, au-delà de ${p.sms_included} par mois inclus — le prix vous sera annoncé avant d'être appliqué. Les notifications dans l'app sont gratuites.`;
  return shell({
    title: `Tarifs Sterncut · ${month} DH au mois, ${year} DH à l'année`,
    description: `Un prix par coiffeur, plafonné à ${p.cap} fauteuils. Sans commission, sans frais d'installation, sans engagement.`,
    body: `${nav('tarifs')}
<main class="wide">
<div class="headrow">
<div class="grow"><h1 class="display sm">Un prix. Par coiffeur.</h1>
<p class="lede">Vous payez pour les fauteuils qui travaillent. ${month} DH au mois, ${year} DH si vous prenez l'année — et plafonné à ${word(p.cap)} fauteuils. Le ${next} coiffeur est gratuit, et le dixième aussi.</p></div>
<p class="badge">${ICON.tickGreen}<span>Le cash ne passe jamais par nous. Vous encaissez comme avant.</span></p>
</div>
<div class="two">
<section class="plan">
<p class="label dim">L'ABONNEMENT SALON</p>
<div class="tiers">
<div><p class="label dim">AU MOIS</p><p class="big"><b>${month}</b> DH / coiffeur</p><small>Sans engagement</small></div>
<div class="year"><p class="label coral">À L'ANNÉE</p><p class="big"><b class="coral">${year}</b> DH / coiffeur</p><small>Payé une fois — ${word(m.monthsFree)} mois offerts</small></div>
</div>
<div class="stepper" id="stepper" data-month="${p.monthly_cents}" data-year="${p.yearly_cents * 12}" data-cap="${p.cap}">
<button type="button" data-d="-1" aria-label="Un coiffeur de moins">−</button>
<span class="count"><b id="st-n">${STEP_START}</b><small id="st-w">coiffeurs</small></span>
<button type="button" data-d="1" aria-label="Un coiffeur de plus">+</button>
<span class="rule"></span>
<span class="total"><b id="st-t">${dh(m.month(STEP_START))}</b><small id="st-s">${stepSub(STEP_START, p, m)}</small></span>
</div>
<ul class="ticks">
<li>${ICON.tick}Réservations illimitées — 10 ou 400, c'est le même prix</li>
<li>${ICON.tick}Plafonné à ${p.cap} fauteuils — agrandissez sans payer plus</li>
<li>${ICON.tick}L'agenda, l'équipe, la liste d'attente, les messages</li>
<li>${ICON.tick}Votre page, votre affiche QR, votre lien de réservation</li>
<li>${ICON.tick}Arrêtez quand vous voulez — le mois entamé est le dernier</li>
</ul>
</section>
<section class="card nots">
<p class="label">CE QU'ON NE PREND PAS</p>
<p class="nrow"><span>Commission sur vos réservations</span><b>0</b></p>
<p class="nrow"><span>Commission sur le cash</span><b>0</b></p>
<p class="nrow"><span>Pourcentage sur les nouveaux clients</span><b>0</b></p>
<p class="nrow"><span>Frais d'installation</span><b>0</b></p>
<p class="nrow"><span>Durée d'engagement</span><b>0</b></p>
<p class="fine">Un client qui vient chez vous est à vous. On ne se paie pas dessus, ni la première fois, ni jamais. ${smsLine}</p>
</section>
</div>
<div class="two links">
<a class="link" href="/tarifs/qui-compte"><span class="dot">${ICON.info}</span><span class="grow"><b>Qui compte comme coiffeur ?</b><small>Les chaises vides, les apprentis, celui qui part le 12 — cas par cas</small></span>${ICON.arrow}</a>
<a class="link" href="/tarifs/exemple"><span class="dot">${ICON.doc}</span><span class="grow"><b>Un mois, facture en main</b><small>214 réservations, ${word(p.cap)} fauteuils → ${dh(m.month(p.cap))}</small></span>${ICON.arrow}</a>
</div>
</main>`,
    script: `<script>${STEPPER}</script>`,
  });
}

function stepSub(n, p, m) {
  return n > p.cap
    ? `plafonné à ${p.cap} fauteuils · ou ${dh(m.year(n))} l'année`
    : `${n} × ${dhWhole(p.monthly_cents)} DH · ou ${dh(m.year(n))} l'année`;
}

// the stepper: WEB-04's one control, the same arithmetic as priceOf, no dependency
const STEPPER = `(function(){var s=document.getElementById('stepper');if(!s)return;
var M=+s.dataset.month,Y=+s.dataset.year,C=+s.dataset.cap,n=${STEP_START};
function dh(c){return String(Math.round(c/100)).replace(/\\B(?=(\\d{3})+(?!\\d))/g,'\\u202f')+' DH'}
function draw(){var b=Math.min(n,C);document.getElementById('st-n').textContent=n;
document.getElementById('st-w').textContent=n>1?'coiffeurs':'coiffeur';
document.getElementById('st-t').textContent=dh(b*M);
document.getElementById('st-s').textContent=(n>C?'plafonné à '+C+' fauteuils':n+' × '+Math.round(M/100)+' DH')+' · ou '+dh(b*Y)+" l'année"}
s.addEventListener('click',function(e){var d=e.target.closest('button');if(!d)return;n=Math.max(1,Math.min(30,n+(+d.dataset.d)));draw()})})();`;

// ---- WEB-05 · who counts as a barber, case by case ------------------------------------------
function quiCompte(ctx) {
  const p = ctx.price;
  const pay = `${dhWhole(p.monthly_cents)} DH`;
  const row = (text, chip, billed) => `<p class="case${billed ? ' billed' : ''}"><span>${text}</span><b>${chip}</b></p>`;
  return shell({
    title: 'Qui compte comme coiffeur · Tarifs Sterncut',
    description: 'On compte, le 1er du mois, les coiffeurs qu\'un client peut réserver. Huit situations, telles qu\'elles arrivent.',
    body: `${back('/tarifs', 'Tarifs')}
<main class="wide two top-aligned">
<section class="col">
<h1 class="display sm">Qui compte</h1>
<p class="lede">On facture des personnes qui prennent des rendez-vous, pas des chaises. Huit situations, telles qu'elles arrivent.</p>
<div class="cases">
${row('Un coiffeur salarié, sur la page du salon, qui accepte les rendez-vous', pay, true)}
${row('Vous, le patron, si vous coupez aussi', pay, true)}
${row('Un coiffeur à temps partiel, deux jours par semaine', pay, true)}
${row('Le patron qui ne touche plus aux ciseaux et gère seulement', '0 DH')}
${row('Une chaise libre en attendant de recruter', '0 DH')}
${row('Un apprenti qui assiste et ne prend pas de rendez-vous', '0 DH')}
${row('Quelqu\'un qui arrive le 12 du mois', '0 DH CE MOIS')}
${row('Le salon ferme un mois entier — congés, travaux, Ramadan', '0 DH')}
</div>
</section>
<section class="col pad-top">
<div class="rule-card"><p class="label dim">LA RÈGLE EN UNE PHRASE</p>
<p class="serif-line">On compte, le 1<sup>er</sup> du mois, les coiffeurs qu'un client peut réserver.</p>
<p class="dimtext">C'est la liste qui s'affiche sur votre page. Si quelqu'un n'y est pas, il n'est pas sur la facture — vous n'avez rien à nous déclarer.</p></div>
<div class="card"><p class="cardhead"><span class="dot green">${ICON.shield}</span><b>En cas de doute, il ne compte pas</b></p>
<p class="fine">Au-delà de ${word(p.cap)} fauteuils la question ne se pose plus : le ${ORDINAL[p.cap + 1] ?? `${p.cap + 1}e`} et les suivants ne sont jamais facturés. Un coiffeur qui rejoint le salon en cours de mois est gratuit jusqu'au 1<sup>er</sup> suivant. Un mois sans un seul rendez-vous n'est pas facturé, même si tout le monde est encore inscrit.</p></div>
<p class="note">${ICON.info}<span>Vous retirez un coiffeur de votre équipe dans l'application, et il disparaît de la facture suivante. Rien à nous demander, rien à signer.</span></p>
</section>
</main>`,
  });
}

// ---- WEB-06 · a month, bill in hand ---------------------------------------------------------
// The design called this "a real August bill" and "not a simulation" over fixture
// numbers. It is an example, labelled as one. And the subscription is netted off the
// Friday deposits (OSB-03), not "prélevé à part, jamais sur votre caisse".
function exemple(ctx) {
  const p = ctx.price;
  const m = priceOf(p);
  const chairs = p.cap;
  const total = m.month(chairs);
  const yearMonth = Math.min(chairs, p.cap) * p.yearly_cents;
  const bookings = 214;
  const line = (dot, title, sub, qty, amount, green) => `<div class="bline"><i class="${dot}"></i><span class="grow"><b>${title}</b><small>${sub}</small></span><span class="qty">${qty}</span><span class="amt${green ? ' green' : ''}">${amount}</span></div>`;
  return shell({
    title: 'Un mois, facture en main · Tarifs Sterncut',
    description: `${bookings} réservations, ${chairs} fauteuils, ${dh(total)}. Sans commission.`,
    body: `${back('/tarifs', 'Tarifs')}
<main class="narrow">
<div class="headrow"><div class="grow"><p class="eyebrow">EXEMPLE</p><h1 class="display sm">Un mois d'août</h1>
<p class="lede">Un salon de ${word(chairs)} fauteuils, à la Kasbah. Les chiffres sont un exemple ; le calcul est celui de chaque facture.</p></div>
<span class="mono">01–31 AOÛT</span></div>
<div class="bill">
<div class="bline head"><span class="grow"><b>Coiffeurs actifs au 1<sup>er</sup> août</b></span><span class="amt">${chairs}</span></div>
${line('coral', 'Abonnement', `${word(chairs)} coiffeurs · ${dhWhole(p.monthly_cents)} DH chacun`, `${chairs} × ${dhWhole(p.monthly_cents)}`, `${comma(total)} DH`)}
${line('green', 'Commission sur les réservations', `${bookings} réservations honorées · 12 840 DH de coupes`, String(bookings), '0,00 DH', true)}
${line('green', 'SMS aux clients sans l\'app', `162 sur ${p.sms_included} inclus · le reste en notification gratuite`, '162', '0,00 DH', true)}
${line('green', 'Nouveaux clients amenés par Sterncut', '27 personnes qui n\'étaient pas venues avant', '27', '0,00 DH', true)}
<div class="bline sum"><span class="grow serif-total">Total du mois</span><span class="serif-total">${comma(total)} DH</span></div>
</div>
<div class="two tight">
<div class="dark-card"><p class="label dim">CE QUE ÇA FAIT PAR RÉSERVATION</p><p class="bignum">${comma(Math.round(total / bookings))} DH</p>
<p class="dimtext">${dh(total)} divisés par ${bookings} réservations. Sur l'abonnement annuel le même mois tombe à ${comma(Math.round(yearMonth / bookings))} DH. Une commission, elle, aurait monté avec vous.</p></div>
<div class="card"><p class="label">L'ABONNEMENT, SUR VOS ACOMPTES</p><p class="bignum ink">3 240 DH</p>
<p class="fine">Les acomptes encaissés pour vous en août. L'abonnement est retenu dessus un vendredi, sur le même relevé — pas de carte, pas de RIB, pas de virement. Le cash de votre caisse ne passe jamais par nous.</p></div>
</div>
<p class="note bare">${ICON.info}<span>Un coiffeur part le 30 septembre ? La facture d'octobre passe à <strong>${dh(m.month(chairs - 1))}</strong> toute seule, dès que vous le retirez de l'équipe.</span></p>
</main>`,
  });
}

// ---- WEB-11 · the reset page the app's e-mail can land on ------------------------------------
// Supabase's recovery link arrives with the session in the URL fragment
// (#access_token=…&type=recovery), which never reaches this server. The page
// finishes the job in the browser: set the password, then sign out everywhere —
// which is what "vous serez déconnecté de tous vos appareils" promises.
function reset(ctx) {
  const cfg = ctx.env.SUPABASE_URL && ctx.env.SUPABASE_ANON_KEY
    ? JSON.stringify({ url: ctx.env.SUPABASE_URL, key: ctx.env.SUPABASE_ANON_KEY }).replace(/</g, '\\u003c')
    : 'null';
  return shell({
    title: 'Nouveau mot de passe · Sterncut',
    description: 'Choisissez un nouveau mot de passe Sterncut.',
    index: false,
    body: `<header class="top thin">${brand()}<span class="grow"></span><span class="muted">Lien valable 1 heure</span></header>
<main class="wide two top-aligned reset">
<section class="col form">
<span class="tile">${ICON.lock}</span>
<h1 class="display sm">Nouveau mot de passe</h1>
<p class="lede" id="for" hidden>Pour <strong id="email"></strong></p>
<form id="pw" hidden>
<label class="field-label" for="password">NOUVEAU MOT DE PASSE</label>
<input class="field" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
<p class="rule-row" id="r-len">${ICON.tickGreen}Au moins 8 caractères</p>
<p class="rule-row" id="r-dig">${ICON.tickGreen}Un chiffre au minimum</p>
<button class="cta dark" type="submit" id="save">ENREGISTRER</button>
<p class="note">${ICON.info}<span>Vous serez déconnecté de tous vos appareils, y compris l'application.</span></p>
</form>
<div id="done" class="state" hidden><p class="lede"><strong>Mot de passe changé.</strong> Revenez dans l'application et connectez-vous avec le nouveau.</p></div>
<div id="dead" class="state" hidden><p class="lede"><strong>Ce lien ne marche plus.</strong> Il a expiré ou a déjà servi. Demandez-en un nouveau depuis l'application, avec « Mot de passe oublié ».</p></div>
<div id="failed" class="state" hidden><p class="lede"><strong>Ça n'a pas marché.</strong> Le lien a peut-être expiré entre-temps. Demandez-en un nouveau depuis l'application.</p></div>
</section>
<section class="col">
<div class="dark-card"><p class="label dim">VOUS VENEZ DE L'APPLICATION ?</p>
<p class="dimtext">C'est normal d'atterrir dans le navigateur : le lien de réinitialisation ouvre cette page. Une fois le mot de passe changé, revenez dans l'application et connectez-vous.</p>
<a class="cta" href="brber://">${ICON.handset}ROUVRIR L'APPLICATION</a></div>
</section>
</main>`,
    script: `<script type="application/json" id="cfg">${cfg}</script><script>${RESET_JS}</script>`,
  });
}

const RESET_JS = `(function(){var cfg=JSON.parse(document.getElementById('cfg').textContent);
function $(i){return document.getElementById(i)}function show(i){['pw','done','dead','failed'].forEach(function(k){$(k).hidden=k!==i})}
var h=new URLSearchParams(location.hash.slice(1)),token=h.get('access_token');
var bad=h.get('error')||h.get('error_description')||new URLSearchParams(location.search).get('error');
if(location.hash)history.replaceState(null,'',location.pathname);
if(!cfg||bad||!token||h.get('type')!=='recovery'){show('dead');return}
try{var p=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(p.email){$('email').textContent=p.email;$('for').hidden=false}}catch(e){}
show('pw');var pw=$('password');
function ok(){var v=pw.value;$('r-len').classList.toggle('met',v.length>=8);$('r-dig').classList.toggle('met',/\\d/.test(v));return v.length>=8&&/\\d/.test(v)}
pw.addEventListener('input',ok);
$('pw').addEventListener('submit',function(e){e.preventDefault();if(!ok()){pw.focus();return}$('save').disabled=true;
var H={apikey:cfg.key,authorization:'Bearer '+token,'content-type':'application/json'};
fetch(cfg.url+'/auth/v1/user',{method:'PUT',headers:H,body:JSON.stringify({password:pw.value})})
.then(function(r){if(!r.ok)throw r;return fetch(cfg.url+'/auth/v1/logout?scope=global',{method:'POST',headers:H})})
.then(function(){show('done')}).catch(function(){show('failed')})})})();`;

// ---- WEB-13 · maintenance — degrades to what still stands ----------------------------------
// Switched on with MAINTENANCE=1; MAINTENANCE_UNTIL ("14:30") and MAINTENANCE_AT
// (when the note was last written, ISO) are printed when set. The drawn "your
// appointment at 15:30" card needs the database that is down, so it is the general
// sentence instead — which is the part that matters.
export function renderMaintenance(env = {}) {
  const until = env.MAINTENANCE_UNTIL && /^\d{1,2}:\d{2}$/.test(env.MAINTENANCE_UNTIL) ? env.MAINTENANCE_UNTIL : null;
  const at = env.MAINTENANCE_AT ? new Date(env.MAINTENANCE_AT) : null;
  const ago = at && !Number.isNaN(at.getTime())
    ? Math.max(0, Math.round((Date.now() - at.getTime()) / 60000)) : null;
  const facts = [
    until ? `<span><small>RETOUR PRÉVU</small><b class="serif-num">${esc(until)}</b></span>` : '',
    ago != null ? `<span><small>DERNIÈRE INFO</small><b>${ago < 1 ? 'à l\'instant' : `il y a ${ago} minute${ago > 1 ? 's' : ''}`}</b></span>` : '',
  ].filter(Boolean);
  return shell({
    title: 'Maintenance en cours · Sterncut',
    description: 'Les réservations sont suspendues un moment. Rien n\'est perdu.',
    index: false,
    dark: true,
    head: '\n<meta http-equiv="refresh" content="60">',
    body: `<header class="top thin">${brand()}<span class="grow"></span><span class="live"><i></i>MAINTENANCE EN COURS</span></header>
<main class="wide two top-aligned">
<section class="col">
<span class="tile dark">${ICON.wrench}</span>
<h1 class="display sm">On répare<br>quelque chose</h1>
<p class="lede">Les réservations sont suspendues pendant un moment. Rien n'est perdu — ni votre compte, ni vos rendez-vous, ni votre solde.</p>
${facts.length ? `<div class="facts">${facts.join('<i></i>')}</div>` : ''}
<p class="fine">Cette page se met à jour toute seule. Si l'heure passe sans changement, c'est qu'on a sous-estimé — on l'écrira ici plutôt que de la repousser en silence.</p>
</section>
<section class="col">
<div class="card"><p class="cardhead"><span class="dot green">${ICON.tickGreen}</span><b>Vous avez rendez-vous aujourd'hui ?</b></p>
<p class="fine">Il tient. Le salon vous attend à l'heure prévue — la panne est de notre côté, pas du sien. Présentez-vous normalement. Pour annuler ou déplacer, appelez le salon : on ne peut pas le faire pour vous tant que c'est en panne.</p></div>
<div class="dark-card soft"><p class="label dim">POUR LES SALONS</p><p class="dimtext">Votre journée reste consultable hors connexion dans l'application. Les encaissements en espèces se font normalement.</p></div>
</section>
</main>`,
  });
}

// ---- WEB-12's frame, for a page that is not there ------------------------------------------
// WEB-12 was drawn for a dead shop link. A shop's link here is /q/<code>, which
// the queue page answers; so this is the site's own "not found", in the same frame.
export function renderSiteMissing(ctx) {
  return shell({
    title: 'Page introuvable · Sterncut',
    description: 'Cette page n\'existe pas sur sterncut.ma.',
    index: false,
    body: `${nav(null)}
<main class="narrow">
<div class="missing"><span class="tile">${ICON.house}</span><div class="grow">
<p class="eyebrow">ERREUR 404</p>
<h1 class="display sm">Cette page<br>n'existe pas</h1>
<p class="lede">Le lien que vous avez suivi ne mène nulle part. Si c'était le lien d'un salon, il n'est peut-être plus référencé — ce qui ne veut pas dire qu'il est fermé.</p></div></div>
<div class="two links">
<a class="link" href="/"><span class="grow"><b>Trouver une place aujourd'hui</b><small>Les salons de Tanger, dans l'application</small></span>${ICON.arrow}</a>
<a class="link" href="/pour-les-salons"><span class="grow"><b>Vous êtes un salon ?</b><small>Ce que Sterncut change, et ce que ça coûte</small></span>${ICON.arrow}</a>
</div>
<p class="note">${ICON.info}<span>C'est votre salon et vous voulez revenir ? Ouvrez l'application — votre page et vos avis sont gardés.</span></p>
${stores(ctx)}
</main>`,
  });
}

// ---- /app · the store, for whoever tapped ---------------------------------------------------
export function renderGetApp(ctx, { ios = false } = {}) {
  return shell({
    title: 'Sterncut sur votre téléphone',
    description: 'Sterncut est une application pour téléphone.',
    index: false,
    body: `${nav(null)}
<main class="narrow center">
<h1 class="display sm">${ios ? 'Pas encore<br>sur l\'App Store' : 'Sterncut se passe<br>sur le téléphone'}</h1>
<p class="lede">${ios
    ? 'L\'application arrive bientôt sur iPhone. Elle est déjà disponible sur Android.'
    : 'Réserver, inscrire son salon, suivre ses comptes : tout se fait dans l\'application. Ouvrez cette page sur votre téléphone, ou téléchargez-la ici.'}</p>
${stores(ctx)}
</main>`,
  });
}

// ---- routing -------------------------------------------------------------------------------
/** What every page reads: the store links, the phone, and 0126's numbers (null when unread). */
export function siteContext(env, numbers) {
  const read = numbers && Number(numbers.monthly_cents) > 0 && Number(numbers.cap) > 0;
  const pkg = env.ANDROID_PACKAGE || 'com.sterncut.app';
  return {
    env,
    numbers: read ? numbers : null,
    price: read ? { ...LIST, ...pick(numbers, Object.keys(LIST)) } : LIST,
    phone: env.SUPPORT_PHONE || null,
    playStore: `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`,
    appStore: env.IOS_APP_STORE_ID ? `https://apps.apple.com/app/id${encodeURIComponent(env.IOS_APP_STORE_ID)}` : null,
  };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** The pages that print a count or a price, and so read 0126 first. */
export const READS_NUMBERS = new Set(['', 'pour-les-salons', 'ar/salons', 'tarifs', 'tarifs/qui-compte', 'tarifs/exemple']);

const PAGES = {
  '': home,
  'pour-les-salons': salons,
  'ar/salons': salonsAr,
  tarifs,
  'tarifs/qui-compte': quiCompte,
  'tarifs/exemple': exemple,
  'nouveau-mot-de-passe': reset,
};

/** The page for a path, or null — `/tarifs/`, `/tarifs` and `/Tarifs` are one page. */
export function sitePage(pathname) {
  const key = siteKey(pathname);
  return Object.prototype.hasOwnProperty.call(PAGES, key) ? PAGES[key] : null;
}
export const siteKey = (pathname) => pathname.replace(/^\/+|\/+$/g, '').toLowerCase();

// ---- the stylesheet ---------------------------------------------------------------------------
// The designs' light surfaces: canvas #EBE8E1, ink #101010, sub #5C5C58, faint
// #8A8A85, coral #E8442E only for the one action and the money. Desktop is the
// drawn 1400px frame; under 900px it is WEB-02's phone column.
const SITE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;background:#EBE8E1}
body{color:#111;font:400 15px/1.5 Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:lining-nums;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
body[dir=rtl]{font-family:"Noto Kufi Arabic",Inter,system-ui,sans-serif}
body.dark{background:#101010;color:#fff}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer}
:focus-visible{outline:2px solid #E8442E;outline-offset:2px}
p,h1{margin:0}
sup{font-size:.6em}
.grow{flex:1;min-width:0}
.top{display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:15px 40px;border-bottom:1px solid rgba(0,0,0,.08)}
.dark .top{border-color:#26262B}
.top.thin{gap:14px}
.brand{display:flex;align-items:center;gap:9px}
.logo{width:28px;height:28px;border-radius:8px;background:#E8442E;display:flex;align-items:center;justify-content:center;flex:none}
.wordmark{font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:15px;letter-spacing:.14em;text-transform:uppercase}
.nav{display:flex;align-items:center;gap:22px;margin-inline-start:auto}
.nav a{font-size:12.5px;font-weight:600;color:#5C5C58;white-space:nowrap}
.nav a.on{font-weight:700;color:#111}
.nav .ar{font-family:"Noto Kufi Arabic",sans-serif}
.pill{height:36px;border-radius:999px;background:#101010;color:#fff;display:inline-flex;align-items:center;padding:0 18px;font-size:12px;font-weight:700;letter-spacing:.04em;white-space:nowrap}
.backlink{font-size:12px;font-weight:600;color:#5C5C58}
.muted{font-size:11.5px;color:#8A8A85}
.split{display:flex;gap:34px;padding:52px 40px 40px;max-width:1400px;margin:0 auto}
.copy{flex:1.1;min-width:0;display:flex;flex-direction:column;gap:20px}
.media{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px}
.eyebrow{font-size:11px;letter-spacing:.16em;font-weight:700;color:#8A8A85}
.display{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:52px;line-height:1.02;letter-spacing:.01em;text-transform:uppercase;max-width:480px}
.display.sm{font-size:40px;max-width:none}
.display-ar{font-weight:700;font-size:44px;line-height:1.35}
.lede{font-size:15px;line-height:1.6;color:#5C5C58;max-width:470px;text-wrap:pretty}
.dark .lede{color:#9A9A95}
.lede strong{color:#111}
.dark .lede strong{color:#fff}
.label{font-size:10.5px;letter-spacing:.15em;font-weight:700;color:#8A8A85}
.label.coral,.coral{color:#FF7A66}
.fine{font-size:12.5px;line-height:1.6;color:#5C5C58;text-wrap:pretty}
.dark .fine{color:#9A9A95}
.actions{display:flex;flex-wrap:wrap;gap:10px}
.cta{min-height:54px;border-radius:999px;background:#E8442E;color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:0 28px;font-size:12.5px;font-weight:700;letter-spacing:.07em;text-align:center}
.cta.dark{background:#101010;width:100%}
.cta[disabled]{opacity:.5}
.ghost{min-height:54px;border-radius:999px;border:1.5px solid rgba(0,0,0,.15);display:inline-flex;align-items:center;gap:8px;padding:0 24px;font-size:12.5px;font-weight:700;letter-spacing:.07em;color:#111}
.stats{display:flex;flex-wrap:wrap;gap:26px;padding-top:22px;border-top:1px solid rgba(0,0,0,.08)}
.stats span{display:flex;flex-direction:column;gap:4px}
.num{font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:26px;line-height:1.1}
.stats small{font-size:11px;line-height:1.4;color:#8A8A85;max-width:130px}
.stores{display:flex;flex-wrap:wrap;gap:9px}
.store{height:46px;border-radius:12px;background:#101010;color:#fff;display:inline-flex;align-items:center;gap:10px;padding:0 18px;font-size:12.5px;font-weight:700;line-height:1.15}
.store span{display:flex;flex-direction:column}
.store small{font-size:8.5px;font-weight:400;color:#9A9A95}
.photo{flex:1;min-height:320px;border-radius:22px;background:#DAD6CC center/cover no-repeat}
.changes{background:#101010;color:#fff;border-radius:20px;padding:18px 20px;display:flex;flex-direction:column;gap:11px}
.changes p{display:flex;gap:11px;align-items:flex-start;font-size:13px;line-height:1.5}
.changes svg,.ticks svg,.note svg,.badge svg{flex:none;margin-top:3px}
.label.dim,.dark-card .label{color:#8A8A85}
.wide{max-width:1400px;margin:0 auto;padding:38px 40px 40px;display:flex;flex-direction:column;gap:22px}
.narrow{max-width:780px;margin:0 auto;padding:40px 24px 48px;display:flex;flex-direction:column;gap:18px}
.narrow.center{align-items:center;text-align:center}
.headrow{display:flex;align-items:flex-end;gap:24px;flex-wrap:wrap}
.headrow .lede{max-width:620px;margin-top:10px}
.badge{display:flex;align-items:center;gap:9px;background:#fff;border-radius:14px;padding:12px 16px;box-shadow:0 4px 14px rgba(0,0,0,.05);font-size:12px;line-height:1.45;max-width:260px}
.two{display:flex;gap:20px}
.two>*{flex:1;min-width:0}
.two.top-aligned{align-items:flex-start}
.wide.two{flex-direction:row}
.col{display:flex;flex-direction:column;gap:13px}
.pad-top{padding-top:56px}
.plan{flex:1.15;background:#101010;color:#fff;border-radius:24px;padding:26px 30px;display:flex;flex-direction:column;gap:18px}
.tiers{display:flex;gap:14px}
.tiers>div{flex:1;display:flex;flex-direction:column;gap:5px}
.tiers>div:first-child{padding-inline-end:14px;border-inline-end:1px solid #26262B}
.big{font-size:13px;font-weight:700;display:flex;align-items:baseline;gap:7px}
.big b{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:56px;line-height:.9}
.tiers small{font-size:11.5px;color:#8A8A85}
.stepper{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.06);border-radius:16px;padding:15px 18px}
.stepper button{width:32px;height:32px;border-radius:999px;border:1.5px solid #3A3A3E;color:#fff;font-size:16px;font-weight:600;flex:none}
.count{display:flex;flex-direction:column;align-items:center;min-width:74px}
.count b{font-family:"Playfair Display",Georgia,serif;font-size:24px}
.count small,.total small{font-size:10.5px;color:#8A8A85}
.stepper .rule{flex:1;height:1px;background:#26262B}
.total{display:flex;flex-direction:column;align-items:flex-end;text-align:end}
.total b{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:28px;white-space:nowrap;font-variant-numeric:lining-nums tabular-nums}
.ticks{list-style:none;margin:0;padding:16px 0 0;border-top:1px solid #26262B;display:flex;flex-direction:column;gap:10px}
.ticks li{display:flex;gap:10px;font-size:13px;line-height:1.5}
.card{background:#fff;border-radius:22px;padding:22px 24px;display:flex;flex-direction:column;gap:12px;box-shadow:0 6px 20px rgba(0,0,0,.05);color:#111}
.nots .nrow{display:flex;align-items:baseline;gap:12px;padding:11px 0;border-bottom:1px solid #EFECE4;font-size:13.5px}
.nots .nrow:last-of-type{border-bottom:0}
.nots .nrow span{flex:1}
.nots .nrow b{font-family:"Playfair Display",Georgia,serif;font-size:19px;color:#15803D}
.links{gap:18px}
.link{display:flex;align-items:center;gap:14px;background:rgba(0,0,0,.05);border-radius:18px;padding:16px 20px}
.link b{display:block;font-size:13.5px}
.link small{display:block;font-size:11.5px;color:#8A8A85;margin-top:3px}
.dot{width:36px;height:36px;border-radius:999px;background:#fff;display:flex;align-items:center;justify-content:center;flex:none}
.dot.green{background:rgba(22,163,74,.13)}
.cases{display:flex;flex-direction:column;gap:7px}
.case{display:flex;align-items:center;gap:14px;background:#fff;border-radius:14px;padding:12px 16px;font-size:13px;line-height:1.45}
.case span{flex:1}
.case b{flex:none;border-radius:999px;background:rgba(22,163,74,.13);color:#15803D;padding:5px 12px;font-size:11px;white-space:nowrap}
.case.billed{background:#101010;color:#fff}
.case.billed b{background:rgba(232,68,46,.2);color:#FF7A66}
.rule-card,.dark-card{background:#101010;color:#fff;border-radius:22px;padding:24px;display:flex;flex-direction:column;gap:13px}
.dark-card.soft,.dark .card+.dark-card{background:rgba(255,255,255,.06)}
.serif-line{font-family:"Playfair Display",Georgia,serif;font-weight:700;font-size:23px;line-height:1.28}
.dimtext{font-size:12.5px;line-height:1.6;color:#9A9A95}
.cardhead{display:flex;align-items:center;gap:11px;font-size:14px}
.note{display:flex;align-items:flex-start;gap:11px;background:rgba(0,0,0,.05);border-radius:16px;padding:14px 16px;font-size:11.5px;line-height:1.55;color:#5C5C58}
.note.bare{background:none;padding:2px 4px}
.note strong{color:#111}
.mono{font:700 11.5px ui-monospace,Menlo,monospace;color:#8A8A85}
.bill{background:#fff;border-radius:22px;padding:22px 26px;box-shadow:0 6px 20px rgba(0,0,0,.06)}
.bline{display:flex;align-items:center;gap:14px;padding:13px 0;border-top:1px solid #EFECE4}
.bline.head{border-top:0;padding-top:0}
.bline i{width:8px;height:8px;border-radius:999px;flex:none}
.bline i.coral{background:#E8442E}
.bline i.green{background:#16A34A}
.bline b{display:block;font-size:13.5px;font-weight:600}
.bline small{display:block;font-size:11.5px;color:#8A8A85;margin-top:3px}
.qty{width:60px;text-align:end;font-size:13px;color:#8A8A85;font-variant-numeric:lining-nums tabular-nums}
.amt{width:100px;text-align:end;font-size:15px;font-weight:800;font-variant-numeric:lining-nums tabular-nums}
.amt.green{color:#15803D}
.bline.sum{border-top:1.5px solid #111;padding-top:14px}
.serif-total{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:22px;text-transform:uppercase;letter-spacing:.02em}
.bignum{font-family:"Playfair Display",Georgia,serif;font-weight:800;font-size:32px;font-variant-numeric:lining-nums tabular-nums}
.two.tight{gap:14px}
.tile{width:52px;height:52px;border-radius:15px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.06)}
.tile.dark{background:rgba(255,255,255,.07);box-shadow:none}
.reset .form{max-width:420px}
.reset .col+.col{max-width:520px}
.field-label{font-size:11px;letter-spacing:.1em;font-weight:700;color:#8A8A85;margin-top:6px}
.field{height:50px;border-radius:13px;background:#fff;border:1.5px solid rgba(0,0,0,.12);padding:0 15px;font:inherit;font-size:15px;width:100%}
.field:focus{border-color:#111;outline:none}
form{display:flex;flex-direction:column;gap:10px}
.rule-row{display:flex;align-items:center;gap:9px;font-size:12px;color:#8A8A85}
.rule-row svg{opacity:.25}
.rule-row.met{color:#111}
.rule-row.met svg{opacity:1}
.state{padding:6px 0}
.live{display:inline-flex;align-items:center;gap:8px;background:rgba(232,68,46,.16);border-radius:999px;padding:7px 14px;font-size:11px;letter-spacing:.08em;font-weight:700;color:#FF7A66}
.live i{width:7px;height:7px;border-radius:999px;background:#E8442E}
.facts{display:flex;align-items:center;gap:18px;background:rgba(255,255,255,.06);border-radius:18px;padding:16px 20px;max-width:440px}
.facts>i{width:1px;align-self:stretch;background:#26262B}
.facts span{flex:1;display:flex;flex-direction:column;gap:4px}
.facts small{font-size:10.5px;letter-spacing:.14em;font-weight:700;color:#8A8A85}
.serif-num{font-family:"Playfair Display",Georgia,serif;font-size:26px}
.missing{display:flex;align-items:flex-start;gap:18px}
@media (max-width:900px){
.top{padding:14px 20px;gap:12px}
.nav{order:3;width:100%;margin:0;gap:18px;overflow-x:auto;padding-bottom:2px}
.pill{margin-inline-start:auto}
.split{flex-direction:column;padding:26px 20px 32px;gap:22px}
.display{font-size:36px}
.display.sm{font-size:30px}
.display-ar{font-size:32px}
.photo{min-height:220px}
.wide{padding:26px 20px 32px}
.two,.two.links,.wide.two{flex-direction:column}
.tiers{flex-direction:column}
.tiers>div:first-child{border:0;padding:0 0 14px;border-bottom:1px solid #26262B}
.plan{padding:22px 20px}
.pad-top{padding-top:0}
.headrow{flex-direction:column;align-items:stretch;gap:14px}
.headrow .grow{flex:none}
.badge{max-width:none}
.stepper{gap:10px;padding:14px}
.stepper .rule{display:none}
.total{flex:1}
.qty{display:none}
.missing{flex-direction:column}
}
`;
