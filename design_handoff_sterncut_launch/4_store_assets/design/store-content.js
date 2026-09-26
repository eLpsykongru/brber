// Sterncut store assets: strings for the 6 store screenshots, the feature graphic, and the listing copy (FR / AR / EN).
// People, shops and prices are fictional. In Arabic, money inside a sentence sits in an LTR isolate (\u2066…\u2069).
window.STERNCUT_STORE = {
langs: {
fr: {
  name: "Français", eyebrowC: "POUR LES CLIENTS", eyebrowB: "POUR LES COIFFEURS",
  cap: ["Voyez qui est libre près de vous", "Prix, photos et avis avant de réserver", "Réservez en trois taps", "Suivez votre place dans la file, en direct", "Votre journée d'un coup d'œil", "Vos clients et votre caisse, au même endroit"],
  s1: { hello: "Bonjour Amine", me: "A", loc: "Kasbah, Tanger", search: "Coupe, barbe, salon…", freeNow: "LIBRES MAINTENANT", tab: "Accueil",
    rows: [
      { ini: "YA", name: "Youssef A.", shop: "Le Fade Tanger", dist: "350 m", rate: "4,9", slot: "11:00", price: "dès 60 DH" },
      { ini: "HT", name: "Hamza T.", shop: "Salon Marshan", dist: "600 m", rate: "4,8", slot: "11:30", price: "dès 50 DH" },
      { ini: "IM", name: "Ilyas M.", shop: "Studio Iberia", dist: "1,2 km", rate: "4,7", slot: "12:15", price: "dès 70 DH" },
      { ini: "OR", name: "Othmane R.", shop: "Barber Club Malabata", dist: "2,1 km", rate: "4,9", slot: "14:00", price: "dès 55 DH" },
      { ini: "AK", name: "Ayoub K.", shop: "Salon Val Fleuri", dist: "2,4 km", rate: "4,6", slot: "14:30", price: "dès 45 DH" }
    ] },
  s2: { ini: "YA", name: "Youssef A.", shop: "Le Fade Tanger · Kasbah", rate: "4,9", reviews: "212 avis", spec: "Spécialiste du dégradé", workL: "RÉALISATIONS", servicesL: "PRESTATIONS",
    services: [{ n: "Dégradé", d: "30 min", p: "60 DH" }, { n: "Coupe + barbe", d: "45 min", p: "90 DH" }, { n: "Barbe", d: "20 min", p: "40 DH" }, { n: "Coupe enfant", d: "30 min", p: "45 DH" }],
    nextL: "Prochain créneau", next: "Auj. · 11:00", cta: "RÉSERVER" },
  s3: { title: "Réserver", barber: "Youssef A. · Le Fade Tanger", steps: ["Prestation", "Horaire", "Confirmer"], service: "Coupe + barbe", dur: "45 min", price: "90 DH",
    days: [{ d: "Auj.", n: "26" }, { d: "Dim.", n: "27" }, { d: "Lun.", n: "28" }, { d: "Mar.", n: "29" }, { d: "Mer.", n: "30" }],
    am: "MATIN", pm: "APRÈS-MIDI", pay: "Vous payez au salon.", cta: "CONFIRMER · 11:00" },
  s4: { top: "FILE SANS RENDEZ-VOUS", shop: "Le Fade Tanger", area: "Kasbah · 350 m", label: "VOTRE PLACE", num: "2", suf: "e", ahead: "1 personne devant vous", live: "En direct", leave: "QUITTER LA FILE" },
  s5: { date: "Samedi 26 septembre", title: "Aujourd'hui", stats: [{ v: "8", l: "rendez-vous" }, { v: "3", l: "dans la file" }], queue: "File sans rendez-vous", queueSub: "3 personnes attendent", queueCta: "VOIR LA FILE", planL: "PROGRAMME", tab: "Journée",
    rows: [
      { t: "10:00", n: "Anas B.", s: "Dégradé", st: "Terminé", k: "done" },
      { t: "10:30", n: "Karim E.", s: "Coupe + barbe", st: "En cours", k: "now" },
      { t: "11:15", n: "Sans rendez-vous", s: "Barbe", st: "File", k: "walk" },
      { t: "12:00", n: "Omar M.", s: "Dégradé", st: "À venir", k: "next" },
      { t: "14:00", n: "Yassine R.", s: "Coupe enfant", st: "À venir", k: "next" }
    ] },
  s6: { title: "Portefeuille", cashL: "ENCAISSÉ AUJOURD'HUI", cash: "1 240 DH", cashSub: "En espèces · 11 clients", weekly: "Relevé de la semaine", actL: "ACTIVITÉ", tab: "Portefeuille",
    rows: [
      { ini: "YR", n: "Yassine R.", s: "Coupe enfant", t: "14:30", a: "45 DH" },
      { ini: "OM", n: "Omar M.", s: "Dégradé", t: "12:30", a: "60 DH" },
      { ini: "", n: "Sans rendez-vous", s: "Barbe", t: "11:40", a: "40 DH" },
      { ini: "KE", n: "Karim E.", s: "Coupe + barbe", t: "11:05", a: "90 DH" },
      { ini: "AB", n: "Anas B.", s: "Dégradé", t: "10:20", a: "60 DH" }
    ] },
  feature: { tagline: "Le coiffeur, à votre heure.", ticketL: "VOTRE PLACE", num: "2", suf: "e", live: "En direct", ahead: "1 personne devant vous", booked: "Confirmé", when: "Auj. · 11:00", line: "Youssef A. · Coupe + barbe" }
},
ar: {
  name: "العربية", eyebrowC: "للزبائن", eyebrowB: "للحلاقين",
  cap: ["شاهد من هو متاح بالقرب منك", "الأثمنة والصور والتقييمات قبل الحجز", "احجز في ثلاث نقرات", "تابع دورك في الطابور مباشرة", "يومك في لمحة", "زبائنك وصندوقك في مكان واحد"],
  s1: { hello: "مرحباً أمين", me: "أ", loc: "القصبة، طنجة", search: "قصّة، لحية، صالون…", freeNow: "متاحون الآن", tab: "الرئيسية",
    rows: [
      { ini: "ي", name: "يوسف أ.", shop: "Le Fade Tanger", dist: "350 م", rate: "4.9", slot: "11:00", price: "من \u206660 DH\u2069" },
      { ini: "ح", name: "حمزة ت.", shop: "Salon Marshan", dist: "600 م", rate: "4.8", slot: "11:30", price: "من \u206650 DH\u2069" },
      { ini: "إ", name: "إلياس م.", shop: "Studio Iberia", dist: "1.2 كلم", rate: "4.7", slot: "12:15", price: "من \u206670 DH\u2069" },
      { ini: "ع", name: "عثمان ر.", shop: "Barber Club Malabata", dist: "2.1 كلم", rate: "4.9", slot: "14:00", price: "من \u206655 DH\u2069" },
      { ini: "أ", name: "أيوب ك.", shop: "Salon Val Fleuri", dist: "2.4 كلم", rate: "4.6", slot: "14:30", price: "من \u206645 DH\u2069" }
    ] },
  s2: { ini: "ي", name: "يوسف أ.", shop: "Le Fade Tanger · القصبة", rate: "4.9", reviews: "212 تقييماً", spec: "متخصص في التدرّج", workL: "الأعمال", servicesL: "الخدمات",
    services: [{ n: "تدرّج", d: "30 دقيقة", p: "60 DH" }, { n: "قصّة + لحية", d: "45 دقيقة", p: "90 DH" }, { n: "لحية", d: "20 دقيقة", p: "40 DH" }, { n: "قصّة أطفال", d: "30 دقيقة", p: "45 DH" }],
    nextL: "أقرب موعد", next: "اليوم · 11:00", cta: "احجز" },
  s3: { title: "حجز", barber: "يوسف أ. · Le Fade Tanger", steps: ["الخدمة", "الموعد", "التأكيد"], service: "قصّة + لحية", dur: "45 دقيقة", price: "90 DH",
    days: [{ d: "اليوم", n: "26" }, { d: "الأحد", n: "27" }, { d: "الإثنين", n: "28" }, { d: "الثلاثاء", n: "29" }, { d: "الأربعاء", n: "30" }],
    am: "صباحاً", pm: "بعد الزوال", pay: "تؤدّي الثمن في الصالون.", cta: "تأكيد · 11:00" },
  s4: { top: "طابور بدون موعد", shop: "Le Fade Tanger", area: "القصبة · 350 م", label: "دورك", num: "2", suf: "", ahead: "شخص واحد قبلك", live: "مباشر", leave: "مغادرة الطابور" },
  s5: { date: "السبت 26 شتنبر", title: "اليوم", stats: [{ v: "8", l: "مواعيد" }, { v: "3", l: "في الطابور" }], queue: "طابور بدون موعد", queueSub: "3 أشخاص ينتظرون", queueCta: "عرض الطابور", planL: "البرنامج", tab: "اليوم",
    rows: [
      { t: "10:00", n: "أنس ب.", s: "تدرّج", st: "انتهى", k: "done" },
      { t: "10:30", n: "كريم إ.", s: "قصّة + لحية", st: "جارٍ", k: "now" },
      { t: "11:15", n: "بدون موعد", s: "لحية", st: "طابور", k: "walk" },
      { t: "12:00", n: "عمر م.", s: "تدرّج", st: "قادم", k: "next" },
      { t: "14:00", n: "ياسين ر.", s: "قصّة أطفال", st: "قادم", k: "next" }
    ] },
  s6: { title: "المحفظة", cashL: "المحصّل اليوم", cash: "1 240 DH", cashSub: "نقداً · 11 زبوناً", weekly: "كشف الأسبوع", actL: "النشاط", tab: "المحفظة",
    rows: [
      { ini: "ي", n: "ياسين ر.", s: "قصّة أطفال", t: "14:30", a: "45 DH" },
      { ini: "ع", n: "عمر م.", s: "تدرّج", t: "12:30", a: "60 DH" },
      { ini: "", n: "بدون موعد", s: "لحية", t: "11:40", a: "40 DH" },
      { ini: "ك", n: "كريم إ.", s: "قصّة + لحية", t: "11:05", a: "90 DH" },
      { ini: "أ", n: "أنس ب.", s: "تدرّج", t: "10:20", a: "60 DH" }
    ] },
  feature: { tagline: "حلاقك، في وقتك.", ticketL: "دورك", num: "2", suf: "", live: "مباشر", ahead: "شخص واحد قبلك", booked: "مؤكَّد", when: "اليوم · 11:00", line: "يوسف أ. · قصّة + لحية" }
},
en: {
  name: "English", eyebrowC: "FOR CLIENTS", eyebrowB: "FOR BARBERS",
  cap: ["See who's free near you", "Prices, photos and reviews before you book", "Book in three taps", "Follow your place in line, live", "Your day at a glance", "Your clients and your cash, in one place"],
  s1: { hello: "Hi Amine", me: "A", loc: "Kasbah, Tangier", search: "Cut, beard, shop…", freeNow: "FREE NOW", tab: "Home",
    rows: [
      { ini: "YA", name: "Youssef A.", shop: "Le Fade Tanger", dist: "350 m", rate: "4.9", slot: "11:00", price: "from 60 DH" },
      { ini: "HT", name: "Hamza T.", shop: "Salon Marshan", dist: "600 m", rate: "4.8", slot: "11:30", price: "from 50 DH" },
      { ini: "IM", name: "Ilyas M.", shop: "Studio Iberia", dist: "1.2 km", rate: "4.7", slot: "12:15", price: "from 70 DH" },
      { ini: "OR", name: "Othmane R.", shop: "Barber Club Malabata", dist: "2.1 km", rate: "4.9", slot: "14:00", price: "from 55 DH" },
      { ini: "AK", name: "Ayoub K.", shop: "Salon Val Fleuri", dist: "2.4 km", rate: "4.6", slot: "14:30", price: "from 45 DH" }
    ] },
  s2: { ini: "YA", name: "Youssef A.", shop: "Le Fade Tanger · Kasbah", rate: "4.9", reviews: "212 reviews", spec: "Fade specialist", workL: "PORTFOLIO", servicesL: "SERVICES",
    services: [{ n: "Fade", d: "30 min", p: "60 DH" }, { n: "Cut + beard", d: "45 min", p: "90 DH" }, { n: "Beard", d: "20 min", p: "40 DH" }, { n: "Kids' cut", d: "30 min", p: "45 DH" }],
    nextL: "Next free", next: "Today · 11:00", cta: "BOOK" },
  s3: { title: "Book", barber: "Youssef A. · Le Fade Tanger", steps: ["Service", "Time", "Confirm"], service: "Cut + beard", dur: "45 min", price: "90 DH",
    days: [{ d: "Today", n: "26" }, { d: "Sun", n: "27" }, { d: "Mon", n: "28" }, { d: "Tue", n: "29" }, { d: "Wed", n: "30" }],
    am: "MORNING", pm: "AFTERNOON", pay: "You pay at the shop.", cta: "CONFIRM · 11:00" },
  s4: { top: "WALK-IN LINE", shop: "Le Fade Tanger", area: "Kasbah · 350 m", label: "YOUR PLACE", num: "2", suf: "nd", ahead: "1 person ahead of you", live: "Live", leave: "LEAVE THE LINE" },
  s5: { date: "Saturday 26 September", title: "Today", stats: [{ v: "8", l: "bookings" }, { v: "3", l: "in line" }], queue: "Walk-in line", queueSub: "3 people waiting", queueCta: "SEE THE LINE", planL: "SCHEDULE", tab: "Today",
    rows: [
      { t: "10:00", n: "Anas B.", s: "Fade", st: "Done", k: "done" },
      { t: "10:30", n: "Karim E.", s: "Cut + beard", st: "Now", k: "now" },
      { t: "11:15", n: "Walk-in", s: "Beard", st: "In line", k: "walk" },
      { t: "12:00", n: "Omar M.", s: "Fade", st: "Next", k: "next" },
      { t: "14:00", n: "Yassine R.", s: "Kids' cut", st: "Next", k: "next" }
    ] },
  s6: { title: "Wallet", cashL: "TAKEN TODAY", cash: "1,240 DH", cashSub: "Cash · 11 clients", weekly: "This week's statement", actL: "ACTIVITY", tab: "Wallet",
    rows: [
      { ini: "YR", n: "Yassine R.", s: "Kids' cut", t: "14:30", a: "45 DH" },
      { ini: "OM", n: "Omar M.", s: "Fade", t: "12:30", a: "60 DH" },
      { ini: "", n: "Walk-in", s: "Beard", t: "11:40", a: "40 DH" },
      { ini: "KE", n: "Karim E.", s: "Cut + beard", t: "11:05", a: "90 DH" },
      { ini: "AB", n: "Anas B.", s: "Fade", t: "10:20", a: "60 DH" }
    ] },
  feature: { tagline: "Your barber, on your time.", ticketL: "YOUR PLACE", num: "2", suf: "nd", live: "Live", ahead: "1 person ahead of you", booked: "Confirmed", when: "Today · 11:00", line: "Youssef A. · Cut + beard" }
}
},
listing: {
fr: {
  name: "Sterncut – Coiffeur à Tanger",
  subtitle: "Réservez ou suivez la file",
  short: "Trouvez un coiffeur libre à Tanger, réservez ou suivez la file en direct.",
  keywords: "barbier,salon,coiffure,rendez-vous,réservation,dégradé,barbe,attente,queue,maroc,homme,coupe,tanja",
  full: "Sterncut, c'est la façon simple de trouver un coiffeur à Tanger et d'y aller au bon moment.\n\nPOUR LES CLIENTS\n• Voyez qui est libre maintenant près de vous, salon par salon.\n• Consultez la page de chaque coiffeur : prestations et prix en dirhams, photos de réalisations, avis de clients.\n• Réservez en trois taps : la prestation, l'horaire, la confirmation.\n• Pas envie de réserver ? Prenez une place dans la file d'un salon et suivez-la en direct depuis votre téléphone.\n• Écrivez à votre coiffeur et envoyez une photo de la coupe voulue.\n• Vous payez au salon. Certains salons demandent un acompte : son montant et la limite d'annulation gratuite sont affichés avant de réserver.\n• Rechargez votre portefeuille Sterncut en espèces dans un salon pour régler vos acomptes. Aucune carte bancaire.\n\nPOUR LES COIFFEURS ET LES SALONS\n• Votre journée d'un coup d'œil : rendez-vous, clients sans rendez-vous et file d'attente.\n• Vos clients : historique des visites et absences.\n• Votre caisse : l'argent encaissé, votre relevé de la semaine et ce qui est dû entre vous et Sterncut.\n• Propriétaires : l'équipe, les rapports du salon et l'abonnement, dans la même application.\n\nSterncut est disponible à Tanger. L'application est en français, en arabe et en anglais."
},
ar: {
  name: "Sterncut – حلاق في طنجة",
  subtitle: "احجز أو تابع دورك في الطابور",
  short: "اعثر على حلاق متاح في طنجة، واحجز أو تابع دورك في الطابور مباشرة.",
  keywords: "حلاقة,صالون,موعد,حجز,لحية,قصة شعر,تدرج,طابور,انتظار,المغرب,رجال,تسريحة,طنجه",
  full: "Sterncut هو الطريقة البسيطة لإيجاد حلاق في طنجة والذهاب إليه في الوقت المناسب.\n\nللزبائن\n• شاهد من هو متاح الآن بالقرب منك، صالوناً بصالون.\n• اطّلع على صفحة كل حلاق: الخدمات وأثمنتها بالدرهم، وصور الأعمال، وتقييمات الزبائن.\n• احجز في ثلاث نقرات: الخدمة، ثم الموعد، ثم التأكيد.\n• لا تريد الحجز؟ خذ مكاناً في طابور الصالون وتابع دورك مباشرة من هاتفك.\n• راسل حلاقك وأرسل صورة القصّة التي تريدها.\n• تؤدّي الثمن في الصالون. بعض الصالونات تطلب عربوناً: يظهر مبلغه وآخر أجل للإلغاء المجاني قبل الحجز.\n• اشحن محفظة Sterncut نقداً في صالون لأداء العرابين. بدون بطاقة بنكية.\n\nللحلاقين والصالونات\n• يومك في لمحة: المواعيد، والزبائن بدون موعد، والطابور.\n• زبائنك: سجل الزيارات وحالات الغياب.\n• صندوقك: المبالغ المحصّلة، وكشفك الأسبوعي، وما بينك وبين Sterncut.\n• لأصحاب الصالونات: الفريق، وتقارير الصالون، والاشتراك، في التطبيق نفسه.\n\nSterncut متوفر في طنجة. التطبيق بالعربية والفرنسية والإنجليزية."
},
en: {
  name: "Sterncut – Barbers in Tangier",
  subtitle: "Book or follow the line live",
  short: "Find a free barber in Tangier, then book or follow the shop's line live.",
  keywords: "barbershop,haircut,fade,beard,booking,appointment,queue,salon,morocco,men,grooming,tanger,tanja",
  full: "Sterncut is the simple way to find a barber in Tangier and get there at the right time.\n\nFOR CLIENTS\n• See who's free right now near you, shop by shop.\n• Check each barber's page: services and prices in dirhams, portfolio photos and client reviews.\n• Book in three taps: the service, the time, confirm.\n• Don't want to book? Take a place in a shop's line and follow it live from your phone.\n• Message your barber and send a photo of the cut you want.\n• You pay at the shop. Some shops ask for a deposit: the amount and the free-cancellation deadline are shown before you book.\n• Top up your Sterncut wallet in cash at a shop to pay deposits. No bank card needed.\n\nFOR BARBERS AND SHOPS\n• Your day at a glance: bookings, walk-ins and the line.\n• Your clients: visit history and no-shows.\n• Your cash: what you've taken, your weekly statement, and what's owed between you and Sterncut.\n• Owners: the team, shop reports and the subscription, in the same app.\n\nSterncut is available in Tangier. The app is in French, Arabic and English."
}
}
};
