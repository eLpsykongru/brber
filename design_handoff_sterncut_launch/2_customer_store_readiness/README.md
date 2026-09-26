# Handoff: Sterncut customer app — store readiness

**The slice:** account deletion under the new anonymise-don't-wipe rule, chat with real unread tracking and no presence, and consent at sign-up.

**Design file:** `design/Customer - Store Readiness.dc.html` (11 screens). Every screen ID below is an anchor (`#DEL-05`). The customer Profile, Messages and Auth pages are copied alongside; the old screens are labelled with what replaces them.

**Kit:** canvas `#F2F0EB` · white cards (r20, shadow `0 4px 12px rgba(0,0,0,.05)`) · ink `#101010` for hero surfaces, dark headers and primary buttons · text `#111111` / sub `#8A8A85` · body on canvas `#5C5C58` · field labels `#B9B6AD` · hairline `#E5E2DB` · accent `#E8442E` on small things (counts, badges, divider, cursor) and on the destructive button · amber `#E8A33D` border / `#B0761E` icon for money warnings. Playfair Display uppercase for display titles, Inter for everything else. Primary buttons: 54 px pill, 13 px 700, letter-spacing .1em, uppercase. Sheets: `#F2F0EB`, 28 px top radius, grabber `#D8D4CA`, scrim `rgba(0,0,0,.52)`.

## House rules
1. **Nothing promises what the product doesn't do.** No "coming soon", no greyed teasers, no presence. A row whose data doesn't exist (no linked booking, no coupons, empty wallet) is not drawn.
2. **Copy about barbers and customers is pronoun-free.** Name them, or say "barbers' books", "Former customer".

## Arabic / RTL
Same rules as the barber handoff: `dir="rtl"`, mirrored layout, back arrow points right; no letter-spacing and no uppercase on Arabic; Western digits (`ar-u-nu-latn`); money `40 DH` inside an LTR isolate (`<bdi>`); the `DELETE` field is `dir="ltr"`. IBM Plex Sans Arabic for UI, Noto Kufi Arabic for display titles. Arabic plurals use ICU's six forms; the tables give the 3–10 form and list the others where they differ.

Placeholders: `{name}` first name · `{amount}` formatted money · `{n}` count · `{shop}` · `{time}`.

---

## DEL — Delete account (replaces PRO-09)
**Server rule, anonymise not wipe.**
- Removed: name, phone, email, photo, date of birth, chat messages and chat photos, coupons.
- Kept without a name: bookings (barbers' books need them), reviews (displayed as "Former customer" everywhere, barber side included), money records (10 years, by law).
- Wallet balance can't be paid out in cash. On deletion it's forfeited and written to the ledger.

`GET /account/deletion-check` returns `{ liveDepositBookings[], walletBalance, couponCount, bookingCount, reviewCount }`. `POST /account/delete` re-checks, refuses while a live deposit booking exists, requires `confirm: "DELETE"`, and requires `acceptWalletLoss: true` when the balance is above 0.

Entry: Profile › Settings (PRO-07) › Delete account → DEL-04 if any live deposit booking exists, else DEL-05. Pushed screens, not a sheet.

## DEL-04 — Blocked: live booking with a deposit
Today's rule and wording, kept. One card per booking: deposit chip, service, barber · shop, date and time. With one booking the bottom button opens it. With two or more, each card opens its own booking and the bottom button isn't drawn.

| Key | EN | FR | AR |
|---|---|---|---|
| header | DELETE ACCOUNT | SUPPRIMER LE COMPTE | حذف الحساب |
| heading.1 | One thing first. | Une chose d'abord. | أمر واحد أولاً. |
| heading.n | {n} bookings first. | {n} réservations d'abord. | {n} حجوزات أولاً. (two: حجزان أولاً) |
| sub | Nothing has been deleted yet. | Rien n'a encore été supprimé. | لم يُحذف أي شيء بعد. |
| chip | DEPOSIT PAID · {amount} | ACOMPTE PAYÉ · {amount} | عربون مدفوع · {amount} |
| when | When | Quand | الموعد |
| body | Cancel it or let it complete first — deposits aren't refunded on account deletion. | Annulez-la ou laissez-la se terminer d'abord : les acomptes ne sont pas remboursés quand un compte est supprimé. | ألغِ الحجز أو انتظر انتهاءه أولاً، فالعربون لا يُستردّ عند حذف الحساب. |
| cta | OPEN THE BOOKING | OUVRIR LA RÉSERVATION | فتح الحجز |

## DEL-05 — Clear
Counts are the customer's real counts. A row with a zero count isn't drawn. The wallet card and its tick appear only when the balance is above 0. **DELETE MY ACCOUNT** stays at 45 % opacity and does nothing until (a) the tick is on, when shown, and (b) the field reads `DELETE` (Latin, case-insensitive, trimmed, in every language). "Find a barber" opens Explore (EXPL-14) and leaves the flow.

| Key | EN | FR | AR |
|---|---|---|---|
| heading | WHAT GOES, WHAT STAYS | CE QUI PART, CE QUI RESTE | ما يُحذف وما يبقى |
| sub | Your name comes off everything. The records stay, without it. | Votre nom disparaît de partout. Les historiques restent, sans lui. | يُزال اسمك من كل شيء. تبقى السجلات من دونه. |
| goes | WHAT GOES | CE QUI PART | ما سيُحذف |
| goes.1 | Name, phone and email | Nom, téléphone et e-mail | الاسم والهاتف والبريد الإلكتروني |
| goes.2 | Photo and date of birth | Photo et date de naissance | الصورة وتاريخ الميلاد |
| goes.3 | Chat messages and photos | Messages et photos du chat | رسائل الدردشة وصورها |
| goes.4 | {n} coupons | {n} coupons | {n} قسائم (one: قسيمة واحدة · two: قسيمتان · 11+: {n} قسيمة) |
| stays | WHAT STAYS, WITHOUT A NAME | CE QUI RESTE, SANS NOM | ما يبقى، من دون اسم |
| stays.bookings | {n} bookings — barbers' books need them | {n} réservations — les carnets des barbiers en ont besoin | {n} حجزاً — دفاتر الحلاقين تحتاجها |
| stays.reviews | {n} reviews — shown as "Former customer" | {n} avis — affichés comme « Ancien client » | {n} تقييمات — باسم «زبون سابق» |
| stays.money | Money records — kept 10 years by law | Relevés d'argent — conservés 10 ans, la loi l'impose | السجلات المالية — 10 سنوات بحكم القانون |
| wallet.title | {amount} in your wallet will be lost | {amount} de votre portefeuille seront perdus | ستضيع {amount} من محفظتك |
| wallet.body | Wallet money can't be paid out in cash. Spend it on a booking deposit first. | L'argent du portefeuille ne peut pas être versé en espèces. Utilisez-le d'abord pour l'acompte d'une réservation. | لا يمكن صرف رصيد المحفظة نقداً. استعمله أولاً لدفع عربون حجز. |
| wallet.link | Find a barber | Trouver un barbier | ابحث عن حلاق |
| wallet.tick | I understand {amount} will be lost | Je comprends que {amount} seront perdus | أفهم أن {amount} ستضيع |
| confirm.label | TYPE DELETE TO CONFIRM | TAPEZ DELETE POUR CONFIRMER | اكتب DELETE للتأكيد |
| confirm.placeholder | DELETE | DELETE | DELETE |
| cta | DELETE MY ACCOUNT | SUPPRIMER MON COMPTE | حذف حسابي |
| keep | KEEP MY ACCOUNT | GARDER MON COMPTE | الإبقاء على حسابي |
| err.changed | Something changed. Check again. | Quelque chose a changé. Vérifiez à nouveau. | تغيّر شيء ما. تحقّق من جديد. |

`err.changed`: toast shown when the server refuses because a deposit booking appeared or the balance changed. Reload the check and show DEL-04 or DEL-05 with the new amount; the tick resets.

## DEL-05 · AR
Drawn to check the mirroring, in the unticked, empty-field state. Copy is the AR column above.

## DEL-06 — Done
Rendered from local state after the server confirms; the session is already gone. DONE → SGN-01.

| Key | EN | FR | AR |
|---|---|---|---|
| eyebrow | SIGNED OUT | DÉCONNECTÉ | تم تسجيل الخروج |
| title | ACCOUNT DELETED | COMPTE SUPPRIMÉ | تم حذف الحساب |
| body | Bookings, reviews and money records stay without your name — barbers' books need the bookings, and the law has us keep money records for 10 years. | Réservations, avis et relevés d'argent restent, sans votre nom : les carnets des barbiers ont besoin des réservations, et la loi nous oblige à garder les relevés d'argent 10 ans. | تبقى الحجوزات والتقييمات والسجلات المالية من دون اسمك: دفاتر الحلاقين تحتاج الحجوزات، والقانون يُلزمنا بحفظ السجلات المالية 10 سنوات. |
| done | DONE | TERMINÉ | تمّ |

---

## MSG — Chat (replaces CHT-04 list, CHT-01, CHT-02)
Unread is per thread, server-side (`last_read_at` per participant). It shows as:
- a count per thread (accent pill; accent time; dark preview);
- a badge on the Chat tab on every tab, equal to the sum of thread counts, capped at `99+`;
- the Unread filter, which lists real threads and has its own empty state;
- a **New** divider above the first unread message inside a thread.

Opening a thread marks it read. The divider stays until the thread is left.

Presence is removed everywhere: no avatar dots, no "Online" subtitle, no last-seen. The CHT-01 avatar row went with CHT-04 and doesn't come back.

## MSG-04 — Chats, All
The CHT-04 layout (HELP pinned: Support start row, Ops threads; then BARBERS), with the All / Unread filter under the header. The pinned support row's copy changes: "Rentra Support · Usually replies in 5 min" becomes "Sterncut Support · Message the Sterncut team". The brand is Sterncut, and nothing measures reply time.

| Key | EN | FR | AR |
|---|---|---|---|
| title | CHAT | MESSAGES | الدردشة |
| filter.all | All | Tous | الكل |
| filter.unread | Unread | Non lus | غير المقروءة |
| help | HELP | AIDE | المساعدة |
| support | Sterncut Support | Support Sterncut | دعم Sterncut |
| support.sub | Message the Sterncut team | Écrire à l'équipe Sterncut | راسل فريق Sterncut |
| support.start | START | DÉMARRER | ابدأ |
| barbers | BARBERS | BARBIERS | الحلاقون |
| preview.you | You: {text} | Vous : {text} | أنت: {text} |
| preview.photo | Photo | Photo | صورة |
| yesterday | YESTERDAY | HIER | أمس |

## MSG-05 — Unread filter
Only threads with unread messages (barbers and ops), newest first. The Support start row isn't a thread and isn't listed. This replaces the "Unread tracking coming soon" toast.

## MSG-06 — Unread filter, empty
With no chats at all, CHT-03 still applies.

| Key | EN | FR | AR |
|---|---|---|---|
| title | ALL CAUGHT UP | TOUT EST LU | لا جديد |
| body | Messages you haven't opened show up here. | Les messages que vous n'avez pas ouverts apparaissent ici. | تظهر هنا الرسائل التي لم تفتحها بعد. |
| cta | SEE ALL CHATS | VOIR TOUS LES MESSAGES | عرض كل المحادثات |

## MSG-07 — Thread
Header: back · avatar · barber name · "{shop} · Booking chat" · ⋮. Messages carry no ticks. Composer: photo button · text field · send. Send is disabled until there's text or a photo. The emoji, paperclip and mic buttons are removed.

| Key | EN | FR | AR |
|---|---|---|---|
| header.sub | {shop} · Booking chat | {shop} · Discussion de réservation | {shop} · محادثة الحجز |
| today | TODAY | AUJOURD'HUI | اليوم |
| meta.them | {name} · {time} | {name} · {time} | {name} · {time} |
| meta.you | You · {time} | Vous · {time} | أنت · {time} |
| divider | NEW | NOUVEAU | جديد |
| composer | Type a message here… | Écrivez votre message… | اكتب رسالتك هنا… |
| a11y.photo | Add a photo | Ajouter une photo | إضافة صورة |
| a11y.send | Send | Envoyer | إرسال |
| a11y.options | Options | Options | خيارات |

## MSG-08 — ⋮ options (sheet)
Two rows only. "Open the booking" isn't drawn when no booking is linked to the thread. "Report a problem" opens CHT-05 with the thread attached. There's no "Call the shop", because shops have no phone number yet.

| Key | EN | FR | AR |
|---|---|---|---|
| open | Open the booking | Ouvrir la réservation | فتح الحجز |
| open.sub | {day} {date} · {time} · {service} | same | same |
| report | Report a problem | Signaler un problème | الإبلاغ عن مشكلة |
| cancel | CANCEL | ANNULER | إلغاء |

---

## SGN — Consent at sign-up
One line wherever an account can be created. Both names are links to `https://sterncut.ma/{lang}/terms` and `/privacy`, opened in the in-app browser. Each link's hit area is padded to 44 px tall. Contrast: `rgba(255,255,255,.65)` with white links on ink; `#5C5C58` with `#111` links on canvas.

| Key | EN | FR | AR |
|---|---|---|---|
| consent | By continuing you agree to the {terms} and the {privacy} | En continuant, vous acceptez les {terms} et la {privacy} | بالمتابعة، أنت توافق على {terms} و{privacy} |
| terms | Terms of use | Conditions d'utilisation | شروط الاستخدام |
| privacy | Privacy policy | Politique de confidentialité | سياسة الخصوصية |

## SGN-01 — Welcome (replaces AUTH-05)
The line sits under the three buttons and covers all of them, because a first Google or Apple sign-in creates the account. It replaces the old "By continuing you agree to Sterncut's Terms & Privacy Policy", which wasn't tappable. Nothing else changes.

## SGN-02 — Register (replaces AUTH-07)
The line sits under CONTINUE, on both the social and the email path. Nothing else changes.

**Also apply (not drawn):** AUTH-06 (sign in) has Google and Apple buttons, and a first social sign-in there also creates an account. Put the same line under that row.

---

## Deliberately not drawn
- Any online dot, "Online" status, last seen, "typing…", read receipts or delivery ticks.
- "Call the shop", or any call action in chat (shops have no phone number yet).
- Mic / voice notes, the emoji button, file attachments (paperclip).
- The "Unread tracking coming soon" toast; mark as unread, mute, archive, delete a thread.
- A reply-time promise on the Support row.
- Cash payout, refund or transfer of the wallet balance on deletion; transferring coupons.
- A delete button of any kind while a deposit booking is live.
- "Download my data", a grace period, undo or reactivation, a "why are you leaving" survey.
- A separate consent checkbox at sign-up, or a marketing opt-in.

## Open questions
1. Ledger entry for a forfeited wallet balance: which account books it?
2. Chat search (the magnifier in the header) is kept from the existing screens. Confirm it's built; if not, remove it.
3. Should the Unread filter include ops threads? The design says yes.
