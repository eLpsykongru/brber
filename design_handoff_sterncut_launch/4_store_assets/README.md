# Handoff: Sterncut — app icon, splash and store listing

**Design file:** `design/Store - Icon & Listing.dc.html` (sections ICN, AND, SPL, SHOT, FEAT, COPY). The mark is one component, `design/Sterncut Mark.dc.html`.
**Exported files:** `store-assets/`, all PNG at the exact store sizes.

## The mark
A Playfair Display Black **S** with a coral cut through its spine: a band 5 % of the glyph size, at 24°, only across the spine. Colours: ink #101010, canvas #F2F0EB, coral #E8442E. It was chosen over the website's scissors tile (ICN-B) and a barber's pole (ICN-C); the reasons are on the page. There's no text beyond the single letter.

## Files → app.json (Expo)
| File | Size | Use |
|---|---|---|
| icon.png | 1024×1024, opaque | `expo.icon` (iOS, and the Play Store 512 icon, scaled down) |
| adaptive-foreground.png | 512×512, transparent | `android.adaptiveIcon.foregroundImage` (the S sits inside the 66 dp safe zone) |
| adaptive-background.png | 512×512, #101010 | `android.adaptiveIcon.backgroundImage` (or `backgroundColor: "#101010"`) |
| adaptive-monochrome.png | 512×512, white on transparent | `android.adaptiveIcon.monochromeImage` (Android 13+ themed icons) |
| notification-icon.png | 96×96, white on transparent | `expo-notifications` plugin `icon`, with `color: "#E8442E"` |
| splash-icon-dark.png | 1024×1024, transparent | splash on ink |
| splash-icon-light.png | 1024×1024, transparent | splash on canvas |
| feature-graphic-{fr,ar,en}.png | 1024×500 | Play feature graphic, per listing language |
| screenshots/{ios,android}/{fr,ar,en}/0N.png | 1320×2868 / 1080×1920 | store screenshots, upload in order 01→06 |

```json
{
  "expo": {
    "icon": "./assets/icon.png",
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-foreground.png",
        "backgroundImage": "./assets/adaptive-background.png",
        "monochromeImage": "./assets/adaptive-monochrome.png"
      }
    },
    "plugins": [
      ["expo-notifications", { "icon": "./assets/notification-icon.png", "color": "#E8442E" }],
      ["expo-splash-screen", {
        "image": "./assets/splash-icon-dark.png", "imageWidth": 200, "backgroundColor": "#101010",
        "dark": { "image": "./assets/splash-icon-dark.png", "backgroundColor": "#101010" }
      }]
    ]
  }
}
```
The splash is ink by default, as briefed. The customer app is light, so opening it flashes from dark to light. If you'd rather the splash follow the phone's appearance, set the root to `splash-icon-light.png` + `#F2F0EB` and keep ink under `dark`. Each splash image keeps the S inside a centred circle two-thirds wide, so Android 12's round splash mask doesn't clip it.

## Screenshots
Six per platform per language, the same set on both platforms. Screens 1–4 show the client app on canvas; 5–6 show the barber app on ink. The Arabic set is fully right-to-left, with Western digits and money as `60 DH`. Names are first name + initial and are invented. Shop names are invented too; check them against real Tangier shops before publishing.

| # | Screen | FR | AR | EN |
|---|---|---|---|---|
| 1 | Client · free barbers near you | Voyez qui est libre près de vous | شاهد من هو متاح بالقرب منك | See who's free near you |
| 2 | Client · barber page | Prix, photos et avis avant de réserver | الأثمنة والصور والتقييمات قبل الحجز | Prices, photos and reviews before you book |
| 3 | Client · booking, step 3 | Réservez en trois taps | احجز في ثلاث نقرات | Book in three taps |
| 4 | Client · live place in line | Suivez votre place dans la file, en direct | تابع دورك في الطابور مباشرة | Follow your place in line, live |
| 5 | Barber · today | Votre journée d'un coup d'œil | يومك في لمحة | Your day at a glance |
| 6 | Barber · wallet | Vos clients et votre caisse, au même endroit | زبائنك وصندوقك في مكان واحد | Your clients and your cash, in one place |

Eyebrows: 1–4 "POUR LES CLIENTS" / "للزبائن" / "FOR CLIENTS" · 5–6 "POUR LES COIFFEURS" / "للحلاقين" / "FOR BARBERS".

**Screen 2 isn't exported yet.** Its three portfolio thumbnails are image slots for real photos from a partner shop (with the shop's consent, and no identifiable customers' faces). Drop the photos in and ask for a re-export of `02.png` in all six sets.

## Listing copy (character counts checked)
### App name (max 30)

- **Français** (28): Sterncut – Coiffeur à Tanger
- **العربية** (23): Sterncut – حلاق في طنجة
- **English** (29): Sterncut – Barbers in Tangier

### iOS subtitle (max 30)

- **Français** (26): Réservez ou suivez la file
- **العربية** (28): احجز أو تابع دورك في الطابور
- **English** (28): Book or follow the line live

### Play short description (max 80)

- **Français** (73): Trouvez un coiffeur libre à Tanger, réservez ou suivez la file en direct.
- **العربية** (65): اعثر على حلاق متاح في طنجة، واحجز أو تابع دورك في الطابور مباشرة.
- **English** (72): Find a free barber in Tangier, then book or follow the shop's line live.

### iOS keywords (max 100)

- **Français** (98): barbier,salon,coiffure,rendez-vous,réservation,dégradé,barbe,attente,queue,maroc,homme,coupe,tanja
- **العربية** (75): حلاقة,صالون,موعد,حجز,لحية,قصة شعر,تدرج,طابور,انتظار,المغرب,رجال,تسريحة,طنجه
- **English** (95): barbershop,haircut,fade,beard,booking,appointment,queue,salon,morocco,men,grooming,tanger,tanja

### Full description (max 4000)

**Français** — 1259 chars

```
Sterncut, c'est la façon simple de trouver un coiffeur à Tanger et d'y aller au bon moment.

POUR LES CLIENTS
• Voyez qui est libre maintenant près de vous, salon par salon.
• Consultez la page de chaque coiffeur : prestations et prix en dirhams, photos de réalisations, avis de clients.
• Réservez en trois taps : la prestation, l'horaire, la confirmation.
• Pas envie de réserver ? Prenez une place dans la file d'un salon et suivez-la en direct depuis votre téléphone.
• Écrivez à votre coiffeur et envoyez une photo de la coupe voulue.
• Vous payez au salon. Certains salons demandent un acompte : son montant et la limite d'annulation gratuite sont affichés avant de réserver.
• Rechargez votre portefeuille Sterncut en espèces dans un salon pour régler vos acomptes. Aucune carte bancaire.

POUR LES COIFFEURS ET LES SALONS
• Votre journée d'un coup d'œil : rendez-vous, clients sans rendez-vous et file d'attente.
• Vos clients : historique des visites et absences.
• Votre caisse : l'argent encaissé, votre relevé de la semaine et ce qui est dû entre vous et Sterncut.
• Propriétaires : l'équipe, les rapports du salon et l'abonnement, dans la même application.

Sterncut est disponible à Tanger. L'application est en français, en arabe et en anglais.
```

**العربية** — 884 chars

```
Sterncut هو الطريقة البسيطة لإيجاد حلاق في طنجة والذهاب إليه في الوقت المناسب.

للزبائن
• شاهد من هو متاح الآن بالقرب منك، صالوناً بصالون.
• اطّلع على صفحة كل حلاق: الخدمات وأثمنتها بالدرهم، وصور الأعمال، وتقييمات الزبائن.
• احجز في ثلاث نقرات: الخدمة، ثم الموعد، ثم التأكيد.
• لا تريد الحجز؟ خذ مكاناً في طابور الصالون وتابع دورك مباشرة من هاتفك.
• راسل حلاقك وأرسل صورة القصّة التي تريدها.
• تؤدّي الثمن في الصالون. بعض الصالونات تطلب عربوناً: يظهر مبلغه وآخر أجل للإلغاء المجاني قبل الحجز.
• اشحن محفظة Sterncut نقداً في صالون لأداء العرابين. بدون بطاقة بنكية.

للحلاقين والصالونات
• يومك في لمحة: المواعيد، والزبائن بدون موعد، والطابور.
• زبائنك: سجل الزيارات وحالات الغياب.
• صندوقك: المبالغ المحصّلة، وكشفك الأسبوعي، وما بينك وبين Sterncut.
• لأصحاب الصالونات: الفريق، وتقارير الصالون، والاشتراك، في التطبيق نفسه.

Sterncut متوفر في طنجة. التطبيق بالعربية والفرنسية والإنجليزية.
```

**English** — 1032 chars

```
Sterncut is the simple way to find a barber in Tangier and get there at the right time.

FOR CLIENTS
• See who's free right now near you, shop by shop.
• Check each barber's page: services and prices in dirhams, portfolio photos and client reviews.
• Book in three taps: the service, the time, confirm.
• Don't want to book? Take a place in a shop's line and follow it live from your phone.
• Message your barber and send a photo of the cut you want.
• You pay at the shop. Some shops ask for a deposit: the amount and the free-cancellation deadline are shown before you book.
• Top up your Sterncut wallet in cash at a shop to pay deposits. No bank card needed.

FOR BARBERS AND SHOPS
• Your day at a glance: bookings, walk-ins and the line.
• Your clients: visit history and no-shows.
• Your cash: what you've taken, your weekly statement, and what's owed between you and Sterncut.
• Owners: the team, shop reports and the subscription, in the same app.

Sterncut is available in Tangier. The app is in French, Arabic and English.
```



## Deliberately not drawn
- A wordmark, loader or tagline on the splash.
- iOS 18 dark and tinted icon variants. Without them iOS uses icon.png, which is already dark.
- A promo video, tablet screenshots, or an Apple Watch or TV icon.
- Claims about card payments, SMS reminders, estimated wait times, ratings filters, or any city other than Tangier.
- Real WhatsApp or Instagram logos. The 29 px test uses flat stand-ins in their colours.

## Open questions
1. **SMS:** the brief says no SMS, but the register screen says "We'll text a verification code" and the terms draft (WEB-15 §2, WEB-16) mention SMS. Which is true?
2. **Tab bars:** the bottom tabs in screenshots 1, 5 and 6 are illustrative. Match them to the app's real tabs before exporting finals.
3. **Barber screen 6:** confirm that the Wallet shows today's cash and a per-client activity list, as drawn.
