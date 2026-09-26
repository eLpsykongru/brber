# Handoff: Sterncut barber app — store readiness

**The slice:** everything a store reviewer or a barber can tap that currently does nothing, promises something unbuilt, or is missing: Settings, account deletion, client chat, export, the cash top-up sheet and help articles.

**Design file:** `design/Barber - Store Readiness.dc.html` (20 screens). Open in a browser; every screen ID below is an anchor (`#BST-01`). Neighbouring pages are copied alongside so cross-links resolve.

**Kit:** canvas `#0D0D0F` · card `#17171A` · sheet `#151517` · border `#26262B` · inner fill `#212125` · text `#FFFFFF` · sub `#9A9CA3` · accent `#E8442E` (small things: primary pill, badges, toggles, cursor) · green `#4ADE80` · amber `#E8A100` · red `#F87171`. Inter for UI, Playfair Display for display titles. Bottom sheets: 26 px top radius, 40×4 grabber `#333`, scrim `rgba(0,0,0,.6)`. Buttons are pills.

## House rules (apply to every screen)
1. **Nothing promises what the product doesn't do.** If a feature isn't built, its control isn't drawn. No "coming soon", no greyed-out teasers. A row whose data is missing (no phone, no booking) is removed, not disabled.
2. **Copy about customers is pronoun-free.** Name the client ("Call Anas", "Amine's wallet after"), or say "the client/customer".
3. **Between two cuts:** one decision per screen, every target ≥ 44 px, list rows 64 px.

## Arabic / RTL rules
- Root gets `dir="rtl"`. Layout mirrors: back arrow points right, chevrons point left, icons sit on the right of their row, sheet close button on the left.
- Directional icons flip (back, chevron, logout, external-link, wallet). Non-directional icons don't (bell, calendar, lock, globe, shield, trash).
- **No letter-spacing and no `text-transform: uppercase` on Arabic.** Section labels that are spaced capitals in EN/FR are plain bold in AR.
- **Western digits everywhere** (`0-9`). Format with `ar-u-nu-latn`, never plain `ar`.
- **Money is `340 DH`**: amount, thin space group separator (`1 420`), space, `DH`. In Arabic, wrap every amount, time range, phone, email and Latin name in an LTR isolate (`<bdi>` / U+2066…U+2069) so it can't render as `DH 420 1`.
- Fonts: IBM Plex Sans Arabic for UI text, Noto Kufi Arabic in place of Playfair for display titles. Add ~0.15 line-height over the Latin values.
- Plurals: use ICU plural with Arabic's six forms (zero/one/two/few/many/other). Strings below give the `few` (3–10) form; the others are listed where the count varies.

Placeholders: `{name}` first name, `{fullName}`, `{amount}` formatted money, `{n}` a count, `{email}`, `{shop}`, `{date}`, `{time}`.

---

## BST-00 — Profile: Settings row
Bottom of the barber Profile list (BPR-01). **Settings** is new, between Help Center and Logout. **Language is removed** from this list (it moves into Settings). Logout stays on Profile and opens the same sheet as Settings › Log out (BST-05). Nothing else on Profile changes.

| Key | EN | FR | AR |
|---|---|---|---|
| row | Settings | Paramètres | الإعدادات |

## BST-01 — Settings
Header: back · title (Playfair, spaced caps; Noto Kufi in AR). Five groups, in this order: Language + Notifications · ACCOUNT · LEGAL · Log out · Delete account (red, last).
- **Notifications** opens the existing notification settings (BNT-03, the gear behind the bell). Not redrawn. The summary line is computed from BNT-03's state.
- **Terms of use / Privacy policy** open `https://sterncut.ma/{lang}/terms` and `/privacy` in the in-app browser (SFSafariViewController / Custom Tabs). External-link glyph at row end.

| Key | EN | FR | AR |
|---|---|---|---|
| title | Settings | Paramètres | الإعدادات |
| language | Language | Langue | اللغة |
| language.value | English | Français | العربية |
| notifications | Notifications | Notifications | الإشعارات |
| notif.summary | {n} of 4 alerts on · quiet {start}–{end} | {n} alertes sur 4 activées · silence {start}–{end} | {n} من 4 تنبيهات مفعّلة · صامت {start}–{end} |
| notif.summary.all | All alerts on · quiet {start}–{end} | Toutes les alertes activées · silence {start}–{end} | كل التنبيهات مفعّلة · صامت {start}–{end} |
| notif.summary.none | All alerts off | Toutes les alertes désactivées | كل التنبيهات متوقفة |
| (quiet hours off) | drop "· quiet …" | drop « · silence … » | drop «· صامت …» |
| section.account | ACCOUNT | COMPTE | الحساب |
| security | Sign-in & security | Connexion et sécurité | الدخول والأمان |
| security.sub | {email} | {email} | {email} |
| section.legal | LEGAL | JURIDIQUE | الوثائق القانونية |
| terms | Terms of use | Conditions d'utilisation | شروط الاستخدام |
| privacy | Privacy policy | Politique de confidentialité | سياسة الخصوصية |
| logout | Log out | Se déconnecter | تسجيل الخروج |
| logout.sub | This phone only | Ce téléphone uniquement | من هذا الهاتف فقط |
| delete | Delete account | Supprimer le compte | حذف الحساب |

Delete account → DEL-01 if any blocker is open, else DEL-02 (the client asks the server; see DEL).

## BST-01 · AR
Drawn to check mirroring; copy is the AR column above.

## BST-02 — Language (sheet)
Three rows, each language in its own script (autonym, never translated), its name in the current UI language underneath. The current language shows "Current language" as its sub-line. Picking another language selects it and reveals the restart button; the note is always shown.

| Key | EN | FR | AR |
|---|---|---|---|
| title | Language | Langue | اللغة |
| current | Current language | Langue actuelle | اللغة الحالية |
| name.en | English | Anglais | الإنجليزية |
| name.fr | French | Français | الفرنسية |
| name.ar | Arabic | Arabe | العربية |
| note | Arabic turns the app right-to-left. The app restarts to switch. | L'arabe passe l'application de droite à gauche. L'application redémarre pour changer de langue. | العربية تجعل التطبيق من اليمين إلى اليسار. يُعاد تشغيل التطبيق لتغيير اللغة. |
| cta.en | Restart in English | Redémarrer en anglais | إعادة التشغيل بالإنجليزية |
| cta.fr | Restart in French | Redémarrer en français | إعادة التشغيل بالفرنسية |
| cta.ar | Restart in Arabic | Redémarrer en arabe | إعادة التشغيل بالعربية |

Save the choice, then restart (`I18nManager.forceRTL` + reload on RN). After restart the user lands back on Settings.

## BST-03 — Sign-in & security
- **Email** read-only, lock glyph, no tap action.
- **Password:** "Change password" if the account has one; "Set a password" if the account only signs in with Google/Apple. Opens BST-04.
- **Linked accounts:** Google and Apple, each "Linked" (green tick) or "Not linked". The **Link** button is drawn only if manual identity linking is enabled on the auth project; otherwise "Not linked" has no button. No unlink control. Apple row is not drawn on Android if Apple sign-in isn't offered there.
- **App lock:** one toggle. Label is "Face ID" / "Touch ID" on iOS, "Fingerprint" on Android, from what the device reports. Not drawn if the phone has no biometrics enrolled. Turning it on asks for the biometric once.
- **Sign out on every device** → BST-06.

| Key | EN | FR | AR |
|---|---|---|---|
| title | Sign-in & security | Connexion et sécurité | الدخول والأمان |
| section.email | EMAIL | E-MAIL | البريد الإلكتروني |
| email.sub | Your sign-in email | Votre e-mail de connexion | بريدك لتسجيل الدخول |
| section.password | PASSWORD | MOT DE PASSE | كلمة المرور |
| password.change | Change password | Changer le mot de passe | تغيير كلمة المرور |
| password.set | Set a password | Définir un mot de passe | تعيين كلمة مرور |
| section.linked | LINKED ACCOUNTS | COMPTES LIÉS | الحسابات المرتبطة |
| linked | Linked | Lié | مرتبط |
| notLinked | Not linked | Non lié | غير مرتبط |
| link | Link | Lier | ربط |
| section.lock | APP LOCK | VERROUILLAGE | قفل التطبيق |
| lock.faceid | Face ID | Face ID | Face ID |
| lock.fingerprint | Fingerprint | Empreinte digitale | البصمة |
| lock.sub | Ask for it when Sterncut opens | Demandé à l'ouverture de Sterncut | يُطلب عند فتح Sterncut |
| signoutAll | Sign out on every device | Se déconnecter de tous les appareils | تسجيل الخروج من كل الأجهزة |
| signoutAll.sub | Including this phone | Y compris ce téléphone | بما فيها هذا الهاتف |

## BST-04 — Change / set password (sheet)
Current password (with "Forgot it?" link) + new password, show/hide eye on each. The rule line turns green when met. Save is disabled until the rule is met. "Set a password" variant drops the current-password field and link.
Wrong current password: field border red, error line under it, new password kept.

| Key | EN | FR | AR |
|---|---|---|---|
| title.change | Change password | Changer le mot de passe | تغيير كلمة المرور |
| title.set | Set a password | Définir un mot de passe | تعيين كلمة مرور |
| current | CURRENT PASSWORD | MOT DE PASSE ACTUEL | كلمة المرور الحالية |
| forgot | Forgot it? | Oublié ? | نسيتها؟ |
| forgot.link | Email me a reset link | Recevoir un lien par e-mail | أرسلوا لي رابطاً عبر البريد |
| new | NEW PASSWORD | NOUVEAU MOT DE PASSE | كلمة المرور الجديدة |
| rule | At least 8 characters | Au moins 8 caractères | 8 أحرف على الأقل |
| save | Save password | Enregistrer le mot de passe | حفظ كلمة المرور |
| err.current | That's not your current password | Ce n'est pas votre mot de passe actuel | هذه ليست كلمة مرورك الحالية |
| toast.saved | Password changed | Mot de passe modifié | تم تغيير كلمة المرور |
| toast.reset | Reset link sent to {email} | Lien envoyé à {email} | أرسلنا الرابط إلى {email} |

## BST-05 — Log out, this phone only (sheet)
Opened from Settings › Log out and from Profile › Logout. Log out clears the session and this device's push token, then shows sign-in.

| Key | EN | FR | AR |
|---|---|---|---|
| title | Log out of this phone? | Se déconnecter de ce téléphone ? | تسجيل الخروج من هذا الهاتف؟ |
| body | Your bookings, clients and messages stay. Booking alerts stop on this phone until you sign in again. | Vos réservations, clients et messages restent. Les alertes de réservation s'arrêtent sur ce téléphone jusqu'à votre prochaine connexion. | تبقى حجوزاتك وزبائنك ورسائلك. تتوقف تنبيهات الحجز على هذا الهاتف حتى تسجّل الدخول مجدداً. |
| confirm | Log out | Se déconnecter | تسجيل الخروج |
| cancel | Cancel | Annuler | إلغاء |

## BST-06 — Sign out on every device (sheet)
Revokes all refresh tokens (global sign-out). This phone signs out immediately; others stop at their next refresh. **"Within the hour" assumes a 3600 s access-token lifetime — change the copy if the project's JWT expiry differs.**

| Key | EN | FR | AR |
|---|---|---|---|
| title | Sign out on every device? | Se déconnecter de tous les appareils ? | تسجيل الخروج من كل الأجهزة؟ |
| body1 | Every phone signed in as {email} is signed out — this one now, the others within the hour. | Tous les téléphones connectés avec {email} sont déconnectés : celui-ci tout de suite, les autres dans l'heure. | كل هاتف مسجَّل بـ {email} سيُسجَّل خروجه: هذا الهاتف فوراً، والبقية خلال ساعة. |
| body2 | Use it if a phone is lost, or someone else knows your password. | Utile si un téléphone est perdu ou si quelqu'un d'autre connaît votre mot de passe. | استخدمه إذا ضاع هاتف أو عرف شخص آخر كلمة مرورك. |
| confirm | Sign out everywhere | Tout déconnecter | الخروج من كل الأجهزة |
| cancel | Cancel | Annuler | إلغاء |

---

## DEL — Delete account (barber)
**Server rule:** anonymise, don't wipe. Removed: name, phone, email, photo, bio, ID document, portfolio photos, chat messages and chat photos. Kept without a name: bookings, reviews, every money record (statements and invoices, 10 years by law). The auth user is deleted; the session ends.

The server is the authority: a `GET /account/deletion-check` returns the four blockers and their state; `POST /account/delete` re-checks them and refuses if any is open, and refuses unless the body carries `confirm: "DELETE"`.

**Needs a backend decision:** the anonymised display name on kept bookings/reviews. The design uses "Former barber" (FR « Ancien barbier », AR «حلاق سابق»).

## DEL-01 — Blocked
Heading counts the open blockers. Progress bar: four segments, cleared ones green. Rows keep a fixed order so the list never reshuffles; a cleared row stays in place, dimmed, with a green tick and "CLEAR". While any row is open, **no delete control is drawn**. Each open row has exactly one action.

Order and actions:
1. Upcoming client bookings (n > 0) → **Calendar** (BDY-02).
2. Balance with Sterncut ≠ 0, either direction → **You & Sterncut** (BAC-01).
3. Holds the shop's cash drawer → **Settle up** (barber) / **Who holds the cash** (owner, OBR-07).
4. Owns a shop with other barbers or an unpaid bill → **Talk to us** (BSP-02, prefilled "Delete my account — I own {shop}"). There is no ownership transfer; nothing else is drawn.

Rows 3 and 4 appear only for barbers they can apply to (row 4 only for owners). The count in the heading and the "of 4" become "of 3" for a non-owner.

| Key | EN | FR | AR |
|---|---|---|---|
| title | Delete account | Supprimer le compte | حذف الحساب |
| heading.4 | Four things first | Quatre choses d'abord | أربعة أمور أولاً |
| heading.3 | Three things first | Trois choses d'abord | ثلاثة أمور أولاً |
| heading.2 | Two things first | Deux choses d'abord | أمران أولاً |
| heading.1 | One thing first | Une chose d'abord | أمر واحد أولاً |
| sub | Clear each one and you can delete. Nothing has been deleted yet. | Réglez chacune et vous pourrez supprimer. Rien n'a encore été supprimé. | عالِج كل واحد منها ويصبح الحذف ممكناً. لم يُحذف أي شيء بعد. |
| progress | {n} OF {total} CLEAR | {n} SUR {total} RÉGLÉES | تمّ {n} من {total} |
| clear | CLEAR | RÉGLÉ | تمّ |
| bookings | {n} client bookings ahead | {n} réservations clients à venir | {n} حجوزات قادمة للزبائن |
| bookings (AR forms) | | | one: حجز واحد قادم · two: حجزان قادمان · many (11+): {n} حجزاً قادماً |
| bookings.sub | Cancel or finish each one. Clients are told when a booking is cancelled. | Annulez-les ou terminez-les. Les clients sont prévenus quand une réservation est annulée. | ألغِها أو أنجِزها. يُبلَّغ الزبائن عند إلغاء أي حجز. |
| bookings.cta | Calendar | Calendrier | التقويم |
| bookings.clear | No client bookings ahead | Aucune réservation à venir | لا حجوزات قادمة |
| money.owe | You owe Sterncut {amount} | Vous devez {amount} à Sterncut | عليك {amount} لـ Sterncut |
| money.owed | Sterncut owes you {amount} | Sterncut vous doit {amount} | لك {amount} عند Sterncut |
| money.sub | It has to reach zero, whichever way it runs. | Le solde doit revenir à zéro, dans un sens comme dans l'autre. | يجب أن يعود الحساب إلى الصفر، في أي اتجاه كان. |
| money.cta | You & Sterncut | Vous et Sterncut | أنت و Sterncut |
| money.clear | Nothing between you and Sterncut | Rien entre vous et Sterncut | لا شيء بينك وبين Sterncut |
| drawer.open | You hold the shop's cash · {amount} | Vous détenez la caisse du salon · {amount} | صندوق المحل معك · {amount} |
| drawer.sub | Hand it over before you go. | Remettez-la avant de partir. | سلِّمه قبل أن تغادر. |
| drawer.cta.barber | Settle up | Régler | تسوية |
| drawer.cta.owner | Who holds the cash | Qui détient la caisse | من يمسك النقود |
| drawer.clear | The shop's cash drawer | La caisse du salon | صندوق نقود المحل |
| drawer.clear.sub | {name} holds it, not you. | C'est {name} qui la détient, pas vous. | يمسكه {name}، لا أنت. |
| shop | You own {shop} | Vous êtes propriétaire de {shop} | أنت صاحب {shop} |
| shop.sub.barbers | {names} still work there, and a shop can't be handed over from the app. | {names} y travaillent encore, et un salon ne peut pas être cédé depuis l'application. | ما زال {names} يعملون هناك، ولا يمكن نقل المحل من التطبيق. (two: يعملان · one: يعمل) |
| shop.sub.bill | {shop} has an unpaid bill of {amount}. | {shop} a une facture impayée de {amount}. | على {shop} فاتورة غير مدفوعة بقيمة {amount}. |
| shop.cta | Talk to us | Nous contacter | تحدّث إلينا |

## DEL-01 · AR
Drawn to check mirroring. Every amount and the Latin shop name are LTR isolates.

## DEL-02 — Clear
Shown when all blockers are clear. The confirm field accepts only the Latin word `DELETE` in every language (case-insensitive, trimmed); the server checks it too. The red button renders at 40 % and is inert until the field matches. Counts are the barber's real counts.

| Key | EN | FR | AR |
|---|---|---|---|
| pill | All clear | Tout est réglé | كل شيء تمّ |
| heading | Nothing stands in the way | Plus rien ne bloque | لا شيء يمنع الحذف |
| sub | Your name comes off everything. The records stay, without it. | Votre nom disparaît de partout. Les historiques restent, sans lui. | يُزال اسمك من كل شيء. تبقى السجلات من دونه. |
| goes | WHAT GOES | CE QUI DISPARAÎT | ما سيُحذف |
| goes.1 | Name, phone and email | Nom, téléphone et e-mail | الاسم والهاتف والبريد الإلكتروني |
| goes.2 | Photo and bio | Photo et bio | الصورة والنبذة |
| goes.3 | ID document | Pièce d'identité | وثيقة الهوية |
| goes.4 | {n} portfolio photos | {n} photos de réalisations | {n} صور من أعمالك |
| goes.5 | Chat messages and photos | Messages et photos du chat | رسائل الدردشة وصورها |
| stays | WHAT STAYS, WITHOUT A NAME | CE QUI RESTE, SANS NOM | ما يبقى، من دون اسم |
| stays.bookings | {n} bookings | {n} réservations | {n} حجزاً |
| stays.bookings.sub | Clients see "Former barber" | Les clients voient « Ancien barbier » | يرى الزبائن «حلاق سابق» |
| stays.reviews | {n} reviews | {n} avis | {n} تقييماً |
| stays.money | Every money record | Tous les relevés d'argent | كل السجلات المالية |
| stays.money.sub | Statements and invoices are kept 10 years by law | La loi impose de conserver relevés et factures 10 ans | يفرض القانون الاحتفاظ بالكشوف والفواتير 10 سنوات |
| confirm.label | TYPE DELETE TO CONFIRM | TAPEZ DELETE POUR CONFIRMER | اكتب DELETE للتأكيد |
| confirm.note | This can't be undone. | Impossible à annuler. | لا يمكن التراجع عن هذا. |
| cta | Delete my account | Supprimer mon compte | حذف حسابي |
| keep | Keep my account | Garder mon compte | الإبقاء على حسابي |
| err.blocked | Something changed. Check the list again. | Quelque chose a changé. Revoyez la liste. | تغيّر شيء ما. راجع القائمة من جديد. |

`err.blocked`: if the server refuses because a blocker reopened, go back to DEL-01 with this toast.

## DEL-03 — Done
Rendered from local state after the server confirms; the session is already gone, nothing on this screen fetches. Done → sign-in.

| Key | EN | FR | AR |
|---|---|---|---|
| eyebrow | SIGNED OUT | DÉCONNECTÉ | تم تسجيل الخروج |
| title | Account deleted | Compte supprimé | تم حذف الحساب |
| body | Bookings, reviews and money records stay without your name — the law has us keep statements and invoices for 10 years. | Réservations, avis et relevés d'argent restent, sans votre nom : la loi nous oblige à garder relevés et factures 10 ans. | تبقى الحجوزات والتقييمات والسجلات المالية من دون اسمك، فالقانون يُلزمنا بالاحتفاظ بالكشوف والفواتير 10 سنوات. |
| done | Done | Terminé | تمّ |

---

## MSG — Chat (client threads)
Unread is the only status the product has. It shows in three places: per-thread count, Chat tab badge (sum of thread counts, capped `99+`), and a "New" divider in the thread. A thread's unread resets when it is opened; the divider stays until the thread is left.

## MSG-01 — Threads
Unread thread: bold name, white preview, accent time, accent count pill. Read thread: regular weight, grey preview and time. Last message sent by the barber is prefixed "You:". Photo-only message previews as "Photo".

| Key | EN | FR | AR |
|---|---|---|---|
| title | Chat | Messages | الدردشة |
| unread | {n} unread | {n} non lus | {n} غير مقروءة |
| preview.you | You: {text} | Vous : {text} | أنت: {text} |
| preview.photo | Photo | Photo | صورة |
| yesterday | Yesterday | Hier | أمس |

## MSG-02 — Thread
Header: back · avatar · client name + linked booking line · **Call** · **Options**. Call is not drawn for a walk-in with no phone (options moves into its place). Opens scrolled to the New divider. Sent messages carry no ticks. Composer: photo button · text field · send. Send is disabled until there's text or a photo. No mic, no emoji button.

| Key | EN | FR | AR |
|---|---|---|---|
| header.booking | {day} {date} · {time} · {service} | {day} {date} · {time} · {service} | {day} {date} · {time} · {service} |
| divider | NEW | NOUVEAU | جديد |
| composer | Message {name} | Message à {name} | رسالة إلى {name} |
| a11y.call | Call {name} | Appeler {name} | اتصل بـ{name} |
| a11y.options | Options | Options | خيارات |
| a11y.photo | Add a photo | Ajouter une photo | إضافة صورة |
| a11y.send | Send | Envoyer | إرسال |

## MSG-03 — Thread options (sheet)
Only three rows. Open the booking is not drawn if no booking is linked; Call is not drawn if there's no phone. Report to ops opens the existing support ticket form with the thread attached.

| Key | EN | FR | AR |
|---|---|---|---|
| booking | Open the booking | Ouvrir la réservation | فتح الحجز |
| call | Call {name} | Appeler {name} | اتصل بـ{name} |
| report | Report to ops | Signaler à l'équipe Sterncut | الإبلاغ لفريق Sterncut |
| cancel | Cancel | Annuler | إلغاء |

---

## EXP — Export (one sheet, two entry points)
Entry points: Wallet › Activity › Export (BCF-01) and Owner › Shop report › Export (ORP-01). Period → PDF preview → Share PDF → the phone's native share sheet. The PDF is generated with the same renderer as receipts, A4, in the app's current language (Arabic PDFs mirror; Western digits). Each PDF shows only figures its screen already shows.

## EXP-01 — Export sheet
Four period chips; default "This month". Pick dates opens the system date-range picker (max range 12 months). Preview card: first-page thumbnail + title, date range, page count, entry count; tapping it opens the full page. Empty period: "Nothing in this period", Share disabled.

| Key | EN | FR | AR |
|---|---|---|---|
| title.wallet | Export activity | Exporter l'activité | تصدير النشاط |
| title.shop | Export shop report | Exporter le rapport du salon | تصدير تقرير المحل |
| thisWeek | This week | Cette semaine | هذا الأسبوع |
| lastWeek | Last week | La semaine dernière | الأسبوع الماضي |
| thisMonth | This month | Ce mois-ci | هذا الشهر |
| pick | Pick dates | Choisir les dates | اختر التواريخ |
| preview.pages | {from} – {to} · {n} pages | {from} – {to} · {n} pages | {from} – {to} · {n} صفحات |
| preview.topups | {n} top-ups · PDF | {n} recharges · PDF | {n} عملية شحن · PDF |
| preview.open | See full page | Voir la page | عرض الصفحة كاملة |
| empty | Nothing in this period | Rien sur cette période | لا شيء في هذه الفترة |
| share | Share PDF | Partager le PDF | مشاركة PDF |
| file.wallet | sterncut-wallet-{from}-{to}.pdf | same | same |
| file.shop | sterncut-{shop-slug}-{from}-{to}.pdf | same | same |

## EXP-02 — PDF: wallet activity
Mirrors the BCF-01 Activity list: date/time, customer, masked phone, amount.

| Key | EN | FR | AR |
|---|---|---|---|
| generated | Generated {date}, {time} | Généré le {date} à {time} | أُنشئ في {date}، {time} |
| page | Page {n} of {m} | Page {n} sur {m} | صفحة {n} من {m} |
| title | Wallet activity | Activité du portefeuille | نشاط المحفظة |
| sub | Agent · {shop} · {from} – {to} | Agent · {shop} · {from} – {to} | وكيل · {shop} · {from} – {to} |
| topups | TOP-UPS | RECHARGES | عمليات الشحن |
| collected | CASH COLLECTED | ESPÈCES ENCAISSÉES | النقد المحصَّل |
| col.date | DATE | DATE | التاريخ |
| col.customer | CUSTOMER | CLIENT | الزبون |
| col.phone | PHONE | TÉLÉPHONE | الهاتف |
| col.amount | AMOUNT | MONTANT | المبلغ |
| more | {n} more top-ups | {n} autres recharges | {n} عملية شحن أخرى |
| footer | A record of activity in Sterncut. Not a tax invoice. sterncut.ma | Relevé d'activité Sterncut. Ce n'est pas une facture. sterncut.ma | سجل نشاط في Sterncut. ليس فاتورة ضريبية. sterncut.ma |

(`more` appears only in the thumbnail; the real PDF lists every row across pages.)

## EXP-03 — PDF: shop report
Same blocks as ORP-01, same order: shop take + bookings, by barber, commission / deposits / no-shows, settlement. The "vs last month" % is left off.

| Key | EN | FR | AR |
|---|---|---|---|
| title | Shop report | Rapport du salon | تقرير المحل |
| sub | {shop} · {from} – {to} | {shop} · {from} – {to} | {shop} · {from} – {to} |
| take | SHOP TAKE | RECETTE DU SALON | دخل المحل |
| bookings | {n} bookings | {n} réservations | {n} حجزاً |
| byBarber | BY BARBER | PAR BARBIER | حسب الحلاق |
| commission | COMMISSION | COMMISSION | العمولة |
| deposits | DEPOSITS | ACOMPTES | العرابين |
| noShows | NO-SHOWS | ABSENCES | حالات الغياب |
| settlement | SETTLEMENT · DUE {day} | RÈGLEMENT · AVANT {day} | التسوية · قبل {day} |
| total | Total to collect | Total à encaisser | المجموع المطلوب تحصيله |
| footer | as EXP-02 | as EXP-02 | as EXP-02 |

---

## BCF-02b — Cash top-up sheet (redraw of BCF-02)
**Only change:** the Phone / Scan QR segmented control is removed (no customer QR exists). The phone field sits directly under the title. Everything else is BCF-02 as it was, with three fixes: close button 44 px, amount chips 44 px tall, and "Their balance after" now names the customer. Confirm → BCF-03 as before.

| Key | EN | FR | AR |
|---|---|---|---|
| title | Cash top-up | Recharge en espèces | شحن نقدي |
| phone | CUSTOMER PHONE | TÉLÉPHONE DU CLIENT | هاتف الزبون |
| match.sub | Wallet {amount} · {n} visits with you | Portefeuille {amount} · {n} visites chez vous | المحفظة {amount} · {n} زيارات عندك |
| amount | AMOUNT (DH) | MONTANT (DH) | المبلغ (DH) |
| after | {name}'s wallet after | Portefeuille de {name} après | محفظة {name} بعد الشحن |
| confirm | Confirm cash received | Confirmer l'encaissement | تأكيد استلام النقد |
| note | Credited to the customer's wallet instantly | Crédité immédiatement sur le portefeuille du client | يُضاف فوراً إلى محفظة الزبون |

---

## HLP-01 — Help article
Every "Common for barbers" row on BSP-01 opens this screen (the "Help article coming soon" toast is removed). Title, body, sticky footer with one action. Body supports paragraphs and numbered steps only. Message ops opens the ops chat (BSP-02) with the article title as the first line. **The body text is placeholder** — write each article from what the app actually does; don't describe a feature that isn't built.

| Key | EN | FR | AR |
|---|---|---|---|
| header | Help Center | Centre d'aide | مركز المساعدة |
| eyebrow | COMMON FOR BARBERS | FRÉQUENT CHEZ LES BARBIERS | شائع لدى الحلاقين |
| example.title | Marking a client as a no-show | Marquer un client absent | تسجيل غياب زبون |
| stuck | Still stuck? | Toujours bloqué ? | ما زلت عالقاً؟ |
| cta | Message ops | Écrire à l'équipe | راسل الفريق |

---

## Deliberately not drawn
- "Coming soon", greyed-out or disabled teaser rows anywhere.
- Notification settings (BNT-03) — opened from Settings, not redrawn.
- Terms and Privacy content — sterncut.ma pages in the in-app browser.
- Changing the sign-in email; unlinking Google/Apple; a list of signed-in devices; two-step verification.
- A Link button for Google/Apple when identity linking isn't enabled on the project.
- Face ID / fingerprint row on a phone with no biometrics enrolled.
- Shop ownership transfer — an owner with barbers or an unpaid bill gets "Talk to us" only.
- A delete button of any kind while a blocker is open.
- "Download my data" before deleting; a grace period, undo or reactivation; a "why are you leaving" survey.
- Read receipts, delivery ticks, online dots, "typing…", last-seen.
- Voice notes (mic button), the emoji button, reactions, editing or deleting messages, blocking or muting a client, search in chat.
- Call button and Call row for a walk-in with no phone; Open the booking when no booking is linked.
- CSV or Excel export, "email it to me", scheduled exports.
- Scan QR, or any other way into cash top-up besides the phone number.
- "Was this helpful?", related articles, search inside an article.

## Open questions
1. Access-token lifetime: BST-06 says "within the hour" (3600 s).
2. Anonymised name on kept bookings and reviews: "Former barber"?
3. Is manual identity linking (Link Apple / Google) enabled?
