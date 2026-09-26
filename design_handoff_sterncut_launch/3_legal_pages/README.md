# Handoff: sterncut.ma — legal pages (WEB-14…16)

> **DRAFT — to be reviewed by a Moroccan lawyer before publishing.** Nothing here is legal advice. ⚑ marks every sentence I wasn't sure of (the reasons are listed below); [brackets] mark what isn't decided yet.

**Pages**
- WEB-14 Politique de confidentialité · سياسة الخصوصية · Privacy policy
- WEB-15 Conditions d'utilisation · شروط الاستخدام · Terms of use
- WEB-16 Supprimer votre compte · حذف حسابك · Delete your account (the page Google Play requires)

**Files**
- `design/Public - Legal.dc.html`: 13 artboards. Each page is drawn full length in FR, AR and EN, with phone views (WEB-14 FR collapsed and open; WEB-16 FR and AR). Open it in a browser.
- `design/legal-content.js`: **the single source of the text**, in all three languages. The design renders from it. Use it as the content source, or port it to your CMS or i18n files.
- `content/{fr,ar,en}/*.md`: the same text as Markdown, generated from the JS. Send these to the lawyer.

## URLs
| Page | FR (default) | AR | EN |
|---|---|---|---|
| Privacy | sterncut.ma/confidentialite | sterncut.ma/ar/confidentialite | sterncut.ma/en/privacy |
| Terms | sterncut.ma/conditions | sterncut.ma/ar/conditions | sterncut.ma/en/terms |
| Delete account | sterncut.ma/supprimer-mon-compte | sterncut.ma/ar/supprimer-mon-compte | sterncut.ma/en/delete-account |

- The app handoffs link to `sterncut.ma/{lang}/terms` and `/{lang}/privacy`. Add 301 redirects from those paths to the URLs above.
- Register `https://sterncut.ma/supprimer-mon-compte` in Play Console › App content › Data safety › "Delete account URL". It must open without signing in.
- Each page sets `hreflang` alternates for fr / ar / en.

## Layout
**Desktop (1280 wide, fluid down to tablet)**
- Header: the WEB-01 header unchanged (logo, three nav links, one language link, sign-in pill). Nothing is active.
- Draft banner under the header: `rgba(232,68,46,.09)` background, `#7d2517` text. **Remove it at publication.** The ⚑ highlights and bracket chips only exist while the draft is in review.
- Two-column grid: `250px` contents column + article (`max-width:720px`), gap 72, padding 56/64.
- Contents: `position: sticky; top: 24px`. It uses a numbered list with a 2 px inline-start rule, and the current section is dark and bold. Scroll-spy updates the current section. Each item is an anchor.
- Article: eyebrow → H1 (Playfair 46 uppercase; Noto Kufi 36 in Arabic) → "Last updated" + draft date + language switch (FR · ع · EN pills) → intro (18 px) → sections.
- Section: number + H2 (Playfair 24 uppercase / Noto Kufi 21) → **summary box** (white, r16; label "En bref / باختصار / In short" in accent; 15.5 px semibold) → body (15.5 px, line-height 1.7; Arabic 1.95).
- Body blocks: paragraph · bullet list · subheading (11.5 px spaced caps; Arabic 14 px, no spacing) · numbered steps (dark 28 px discs) · email template (dashed white box, monospace; Noto Kufi in Arabic) · email button (dark pill, `mailto:` with the subject prefilled).

**Phone**
- The contents become a native `<details>` disclosure under the language switch, showing the section count. Closed by default. Rows are 46 px.
- Every tap target is at least 44 px. The language switch uses 38 px pills inside a 44 px row.

**Arabic**
- `dir="rtl"` and `lang="ar"` on `<html>`. The grid mirrors, so the contents move to the right. Use logical properties (`padding-inline-start`, `border-inline-start`).
- Noto Kufi Arabic for everything. No uppercase and no letter-spacing.
- Western digits. Latin names (Supabase, Expo, ICE, CNDP, DELETE) stay as written.

## Footer (new, on every page of sterncut.ma)
None of WEB-01…13 had a footer, so this one is new. It goes at the bottom of every page, WEB-01…13 included.
- `#101010` background, four columns: logo + tagline · Sterncut (the three nav links) · Legal (the three legal pages, current one in bold white) · Contact ([email], [phone]) + Language (Français · العربية · English).
- Bottom line: © year · legal entity · RC · ICE · address · CNDP declaration number.
- On a phone the columns stack in the same order.

## Content model (`legal-content.js`)
- `langs.{fr|ar|en}.ui`: chrome strings, page names, URLs, footer.
- `langs.{lang}.{privacy|terms|deletion}`: `{ title, intro, sections: [{ id, t, sum, body }] }`.
- Inline markup: `⟦n|text⟧` = flagged sentence n · `[text]` = undecided · `⟪page|label⟫` = link to another legal page. At publication, strip the ⟦n| ⟧ wrappers once each flag is resolved, and replace every [bracket].
- Blocks: a string is a paragraph · an array is a bullet list · `{h}` is a subheading · `{ol}` is numbered steps · `{tmpl}` is an email template · `{cta}` is an email button.
- Flag numbers are shared across languages, so ⚑7 means the same sentence in FR, AR and EN.

## Undecided — [brackets] to fill
- **Français:** [raison sociale] · [forme juridique] · [ville] · [numéro RC] · [numéro ICE] · [adresse] · [numéro de déclaration CNDP] · [e-mail de contact] · [pays d'hébergement] · [référence de l'autorisation CNDP] · [durée] · [durée après vérification] · [délai] · [âge minimum] · [téléphone du support] · [date de publication] · [Moyens de paiement, renouvellement, retard de paiement et résiliation de l'abonnement.]
- **العربية:** [الاسم القانوني للشركة] · [الشكل القانوني] · [المدينة] · [رقم السجل التجاري] · [رقم ICE] · [العنوان] · [رقم التصريح لدى CNDP] · [البريد الإلكتروني للتواصل] · [بلد الاستضافة] · [مرجع ترخيص CNDP] · [المدة] · [المدة بعد التحقق] · [المهلة] · [السن الأدنى] · [هاتف الدعم] · [تاريخ النشر] · [طرق أداء الاشتراك، والتجديد، والتأخر في الأداء، والإنهاء.]
- **English:** [legal entity] · [legal form] · [city] · [RC number] · [ICE number] · [address] · [CNDP declaration number] · [contact email] · [hosting country] · [CNDP authorisation reference] · [duration] · [duration after verification] · [deadline] · [minimum age] · [notice period] · [support phone] · [publication date] · [Subscription payment methods, renewal, late payment and cancellation.]

## Sentences to verify
### WEB-14 — Privacy policy

- **⚑1** Confirm whether a declaration is enough or CNDP authorisation is required (ID documents, transfers abroad), and fill in the number.
- **⚑2** A reliability rating that can decide whether a deposit is asked may count as profiling / a decision based on automated processing (loi 09-08, art. 11). Confirm the wording, the duty to inform and the right to contest.
- **⚑3** Processing copies of national ID cards: check CNDP requirements (possibly prior authorisation) and how long they may be kept.
- **⚑4** Legal bases (loi 09-08, art. 4): have the lawyer map each purpose to a basis.
- **⚑5** Confirm that shops can see a client's no-shows and reliability standing. The brief says the rating can decide a deposit, not who sees it.
- **⚑6** Confirm how a reviewer is named publicly (first name, initial or nothing).
- **⚑7** Transfers abroad (loi 09-08, art. 43–44): confirm each provider's hosting country and whether CNDP authorisation is required.
- **⚑8** Standard clause on disclosure to authorities. It isn't in the brief; confirm.
- **⚑9** 10-year retention: confirm the legal basis (commercial and accounting rules) and that it covers wallet records and barber statements.
- **⚑10** Legal maximum response time to rights requests: confirm and fill in.
- **⚑11** Confirm staff access controls, and that chats are only read when reported or attached to a support case.
- **⚑12** No minimum age has been decided, and loi 09-08 sets none. Decide the policy and the parental-consent approach.
- **⚑13** Confirm how, and how far in advance, users are told about changes.

### WEB-15 — Terms of use

- **⚑1** Intermediary status and exclusion of responsibility for the service: check against loi 31-08 (consumer protection) and its unfair-terms rules.
- **⚑2** No minimum age has been decided.
- **⚑3** Confirm how deposits flow: paid from the wallet, and who holds wallet money and deposits until the visit.
- **⚑4** Refund when the shop cancels isn't in the brief; confirm the rule.
- **⚑5** Deducting the deposit from the price at the shop isn't in the brief; confirm.
- **⚑6** The reliability rating affects future deposits: same profiling question as privacy ⚑2 (loi 09-08, art. 11).
- **⚑7** No process for contesting a no-show is specified. Confirm what ops does with these emails.
- **⚑8** Confirm that a review can only be left after a completed visit.
- **⚑9** These moderation criteria are my draft. Align them with the ops takedown policy.
- **⚑10** Confirm the appeal channel (in the app) and what 'action against your account' covers.
- **⚑11** Content licence: confirm its scope, and that it survives account deletion (reviews stay, anonymised).
- **⚑12** Suspension grounds and notice are my draft. Confirm the list (e.g. whether repeated no-shows can lead to suspension) and the appeal route.
- **⚑13** Confirm whether the balance can only pay deposits, or can also pay for services at the shop.
- **⚑14** Critical: a prepaid, cash-funded wallet may fall under Bank Al-Maghrib rules on payment services and electronic money (loi 103-12). Confirm the product is compliant and how it may be described.
- **⚑15** Subscription payment method, renewal, late payment and cancellation aren't specified yet and need drafting. Also confirm that a subscription is required to be bookable.
- **⚑16** Owner's responsibility for staff and page content is my draft; confirm.
- **⚑17** Confirm Sterncut is not a party to commission or rent agreements between barbers and shops.
- **⚑18** Limitation of liability: review against loi 31-08.
- **⚑19** No notice period for changes has been decided.
- **⚑20** Jurisdiction: under loi 31-08 consumers may be entitled to sue where they live. Confirm this clause or remove it.

### WEB-16 — Delete your account

- **⚑1** How email requests are verified hasn't been decided (a reply from the account's email, an SMS code to the account's phone…).
- **⚑2** Processing deadline and confirmation channel haven't been decided.
- **⚑3** 10-year retention: same check as privacy ⚑9.

## Scope: what the text does and doesn't say
- **Data inventory:** exactly the list in the brief, nothing added or guessed. No IP addresses, device data, cookies or analytics are mentioned, because none were listed.
- **Processors:** Supabase, Expo (via Apple and Google), Google and Apple sign-in, Cloudflare, Apple Maps / Google Maps. No ads, no analytics, nothing sold.
- **Deletion:** anonymised. Personal details are removed; bookings, reviews and money records are kept without a name; money records are kept 10 years. The per-role lists match the app's delete-account screens (barber DEL-01…03, customer DEL-04…06).
- **Law:** Morocco, loi 09-08, CNDP. Rights: access, correction, objection, deletion, in the app or by email, plus a complaint to the CNDP.

## Deliberately not drawn
- A cookie banner. No cookies are declared (see question 1).
- A web form for deletion requests. The brief says by email, so the page offers a template and a mailto button.
- A contact form, a "Mentions légales" page, or a per-page PDF download.
- A "last updated" history or changelog.
- An "Accept" step on these pages. Consent is taken at sign-up (SGN-01/02).

## Open questions
1. The sterncut.ma sign-in (WEB-07) presumably sets a session cookie, and Cloudflare keeps request logs. Neither is in the inventory, so the policy says nothing about them. Confirm before publishing.
2. Does the developer name on Google Play match [raison sociale]? The deletion page names both the app and its publisher.
3. Should there be a separate "Mentions légales" page (entity, RC, ICE, host)? The footer carries those details for now.
