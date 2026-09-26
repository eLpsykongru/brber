// Sterncut legal pages — draft content (FR / AR / EN). DRAFT: to be reviewed by a Moroccan lawyer before publishing.
// Markup inside strings: ⟦n|text⟧ = sentence flagged for review (note n in flags[page]); [text] = not decided yet; ⟪page|label⟫ = link to another legal page.
// Blocks: "string" = paragraph · [..] = bullet list · {h} = subheading · {ol:[..]} = numbered steps · {tmpl:[..]} = email template · {cta} = email button.
window.STERNCUT_LEGAL = {
flags: {
  privacy: {
    1: "Confirm whether a declaration is enough or CNDP authorisation is required (ID documents, transfers abroad), and fill in the number.",
    2: "A reliability rating that can decide whether a deposit is asked may count as profiling / a decision based on automated processing (loi 09-08, art. 11). Confirm the wording, the duty to inform and the right to contest.",
    3: "Processing copies of national ID cards: check CNDP requirements (possibly prior authorisation) and how long they may be kept.",
    4: "Legal bases (loi 09-08, art. 4): have the lawyer map each purpose to a basis.",
    5: "Confirm that shops can see a client's no-shows and reliability standing. The brief says the rating can decide a deposit, not who sees it.",
    6: "Confirm how a reviewer is named publicly (first name, initial or nothing).",
    7: "Transfers abroad (loi 09-08, art. 43–44): confirm each provider's hosting country and whether CNDP authorisation is required.",
    8: "Standard clause on disclosure to authorities. It isn't in the brief; confirm.",
    9: "10-year retention: confirm the legal basis (commercial and accounting rules) and that it covers wallet records and barber statements.",
    10: "Legal maximum response time to rights requests: confirm and fill in.",
    11: "Confirm staff access controls, and that chats are only read when reported or attached to a support case.",
    12: "No minimum age has been decided, and loi 09-08 sets none. Decide the policy and the parental-consent approach.",
    13: "Confirm how, and how far in advance, users are told about changes."
  },
  terms: {
    1: "Intermediary status and exclusion of responsibility for the service: check against loi 31-08 (consumer protection) and its unfair-terms rules.",
    2: "No minimum age has been decided.",
    3: "Confirm how deposits flow: paid from the wallet, and who holds wallet money and deposits until the visit.",
    4: "Refund when the shop cancels isn't in the brief; confirm the rule.",
    5: "Deducting the deposit from the price at the shop isn't in the brief; confirm.",
    6: "The reliability rating affects future deposits: same profiling question as privacy ⚑2 (loi 09-08, art. 11).",
    7: "No process for contesting a no-show is specified. Confirm what ops does with these emails.",
    8: "Confirm that a review can only be left after a completed visit.",
    9: "These moderation criteria are my draft. Align them with the ops takedown policy.",
    10: "Confirm the appeal channel (in the app) and what 'action against your account' covers.",
    11: "Content licence: confirm its scope, and that it survives account deletion (reviews stay, anonymised).",
    12: "Suspension grounds and notice are my draft. Confirm the list (e.g. whether repeated no-shows can lead to suspension) and the appeal route.",
    13: "Confirm whether the balance can only pay deposits, or can also pay for services at the shop.",
    14: "Critical: a prepaid, cash-funded wallet may fall under Bank Al-Maghrib rules on payment services and electronic money (loi 103-12). Confirm the product is compliant and how it may be described.",
    15: "Subscription payment method, renewal, late payment and cancellation aren't specified yet and need drafting. Also confirm that a subscription is required to be bookable.",
    16: "Owner's responsibility for staff and page content is my draft; confirm.",
    17: "Confirm Sterncut is not a party to commission or rent agreements between barbers and shops.",
    18: "Limitation of liability: review against loi 31-08.",
    19: "No notice period for changes has been decided.",
    20: "Jurisdiction: under loi 31-08 consumers may be entitled to sue where they live. Confirm this clause or remove it."
  },
  deletion: {
    1: "How email requests are verified hasn't been decided (a reply from the account's email, an SMS code to the account's phone…).",
    2: "Processing deadline and confirmation channel haven't been decided.",
    3: "10-year retention: same check as privacy ⚑9."
  }
},
langs: {

fr: {
  ui: {
    name: "Français",
    nav: ["Pour les clients", "Pour les salons", "Tarifs"],
    signin: "SE CONNECTER",
    draftTitle: "BROUILLON — à faire relire par un avocat marocain avant publication.",
    draftBody: "Les passages surlignés ⚑ sont à vérifier ; les [crochets] restent à compléter.",
    eyebrow: "Informations légales",
    updated: "Dernière mise à jour : [date de publication]",
    draftOf: "Brouillon du 26 septembre 2026",
    toc: "Sommaire", tocCount: "{n} parties", summary: "En bref",
    names: { privacy: "Politique de confidentialité", terms: "Conditions d'utilisation", deletion: "Supprimer votre compte" },
    slugs: { privacy: "sterncut.ma/confidentialite", terms: "sterncut.ma/conditions", deletion: "sterncut.ma/supprimer-mon-compte" },
    footer: { tagline: "Réservez votre coiffeur à Tanger.", site: "Sterncut", legal: "Légal", contact: "Contact", langs: "Langue",
      email: "[e-mail de contact]", phone: "[téléphone du support]",
      copy: "© 2026 [raison sociale] · RC [numéro RC] · ICE [numéro ICE] · [adresse]", cndp: "Déclaration CNDP n° [numéro de déclaration CNDP]" }
  },
  privacy: {
    title: "Politique de confidentialité",
    intro: "Cette politique explique quelles données Sterncut collecte quand vous utilisez l'application ou le site sterncut.ma, à quoi elles servent, avec qui elles sont partagées et comment exercer vos droits. Elle s'applique aux clients, aux invités de la file d'attente, aux coiffeurs et aux propriétaires de salon.",
    sections: [
      { id: "qui", t: "Qui sommes-nous", sum: "Sterncut est édité par [raison sociale], qui est responsable du traitement de vos données.", body: [
        "Le responsable du traitement est [raison sociale], [forme juridique], immatriculée au registre du commerce de [ville] sous le numéro [numéro RC], ICE [numéro ICE], dont le siège est situé [adresse].",
        "⟦1|Ce traitement a été déclaré à la Commission nationale de contrôle de la protection des données à caractère personnel (CNDP) sous le numéro [numéro de déclaration CNDP].⟧",
        "Pour toute question sur vos données : [e-mail de contact]."
      ]},
      { id: "donnees", t: "Les données que nous collectons", sum: "Uniquement ce qu'il faut pour réserver, faire la queue, échanger avec votre coiffeur et tenir votre portefeuille. Aucune carte bancaire.", body: [
        { h: "Votre compte" },
        ["Nom, numéro de téléphone et adresse e-mail.", "Mot de passe : il est enregistré sous forme hachée par notre prestataire de connexion ; personne chez Sterncut ne peut le lire.", "Identifiant de connexion Google ou Apple, si vous vous connectez avec l'un d'eux.", "Date de naissance (facultative), langue de l'application et photo de profil."],
        { h: "Votre position" },
        ["La position de votre téléphone, uniquement pendant que l'application est ouverte, pour classer les salons par distance. Elle n'est pas enregistrée.", "L'emplacement de chaque salon, sous la forme d'un point sur la carte.", "Quand un coiffeur envoie à notre équipe une photo de l'affiche de son salon, la photo est enregistrée avec le lieu où elle a été prise."],
        { h: "Vos réservations" },
        ["Les prestations, les horaires, les notes laissées au coiffeur, les annulations et leurs motifs, et les absences.", "⟦2|Après une visite, le coiffeur évalue la fiabilité du client. Cette évaluation peut décider si un salon demande un acompte.⟧"],
        { h: "Vos échanges" },
        ["Les conversations entre un client et un coiffeur (textes et photos).", "Les demandes d'assistance adressées à notre équipe.", "Les avis, qui sont publics, ainsi que les signalements et les contestations."],
        { h: "Votre portefeuille" },
        ["Les rechargements en espèces faits dans un salon, les acomptes, les remboursements, les coupons et les récompenses de parrainage. Aucune donnée de carte bancaire n'est collectée."],
        { h: "Vos recherches" },
        ["Les recherches faites dans l'application, y compris celles qui n'ont rien donné."],
        { h: "Sans compte : la file d'attente" },
        ["Si vous prenez une place dans la file d'un salon depuis sa page web, sans compte, nous enregistrons votre prénom et votre numéro de téléphone."],
        { h: "Coiffeurs et salons" },
        ["⟦3|Une pièce d'identité, pour vérifier l'identité du coiffeur.⟧", "La bio, la spécialité, les photos de réalisations et les horaires.", "Les gains, les conditions de commission ou de loyer, l'argent en espèces manipulé, les relevés hebdomadaires et les factures d'abonnement."],
        { h: "Notifications" },
        ["Le jeton qui permet d'envoyer des notifications à votre téléphone, et un journal des notifications envoyées."]
      ]},
      { id: "usages", t: "À quoi elles servent", sum: "À faire fonctionner le service, à respecter la loi et à savoir où recruter de nouveaux salons. Jamais à la publicité.", body: [
        ["Créer et sécuriser votre compte.", "Vous montrer les salons proches et leurs créneaux, enregistrer vos réservations et votre place dans la file.", "Permettre à un salon de décider s'il demande un acompte, à partir des absences et des évaluations de fiabilité.", "Transmettre vos messages et vos photos, et traiter vos demandes d'assistance.", "Publier les avis et traiter les signalements et les contestations.", "Tenir le portefeuille : rechargements, acomptes, remboursements, coupons et parrainage.", "Vérifier l'identité des coiffeurs, établir leurs relevés et les factures d'abonnement des salons.", "Vous envoyer des notifications sur vos réservations et vos messages.", "Étudier les recherches sans résultat pour choisir les quartiers où recruter des salons."],
        "⟦4|Nous nous appuyons sur l'exécution du service que vous avez demandé, sur nos obligations légales (notamment comptables), sur votre consentement (position, notifications) et sur notre intérêt légitime (recherches sans résultat, prévention des abus).⟧",
        "Nous n'affichons aucune publicité, n'utilisons aucun outil de mesure d'audience et ne vendons aucune donnée."
      ]},
      { id: "partage", t: "Avec qui nous les partageons", sum: "Avec le salon que vous choisissez et quelques prestataires techniques. Personne d'autre.", body: [
        "Le salon et le coiffeur que vous réservez voient votre nom, votre numéro de téléphone, votre réservation, vos notes et vos messages. ⟦5|Ils voient aussi vos absences et votre fiabilité.⟧",
        "⟦6|Les avis sont publics et affichés avec votre prénom.⟧",
        "Nos prestataires traitent les données pour notre compte et selon nos instructions :",
        ["Supabase — base de données, connexion et stockage des fichiers.", "Expo — envoi des notifications, par l'intermédiaire d'Apple et de Google.", "Google et Apple — connexion avec un compte Google ou Apple.", "Cloudflare — hébergement du site sterncut.ma.", "Apple Plans et Google Maps — affichage des cartes."],
        "⟦7|Ces prestataires peuvent traiter les données hors du Maroc, notamment en [pays d'hébergement]. Ces transferts sont effectués conformément à la loi n° 09-08 [référence de l'autorisation CNDP].⟧",
        "⟦8|Nous ne communiquons des données aux autorités que lorsque la loi nous y oblige.⟧"
      ]},
      { id: "duree", t: "Combien de temps nous les gardons", sum: "Tant que votre compte existe. Les relevés d'argent sont gardés 10 ans.", body: [
        ["Données du compte : tant que le compte existe.", "Position du téléphone : jamais enregistrée.", "⟦9|Relevés d'argent (portefeuille, acomptes, relevés des coiffeurs, factures) : 10 ans, comme la loi l'exige pour les documents comptables.⟧", "Prénom et téléphone des invités de la file d'attente : [durée].", "Recherches : [durée].", "Journal des notifications : [durée].", "Pièces d'identité des coiffeurs : [durée après vérification]."]
      ]},
      { id: "suppression", t: "Quand vous supprimez votre compte", sum: "Vos informations personnelles sont effacées. Vos réservations, vos avis et les relevés d'argent restent, sans votre nom.", body: [
        "La suppression rend le compte anonyme : votre nom, votre téléphone, votre e-mail, votre photo et vos autres informations personnelles sont effacés.",
        "Les réservations, les avis et les relevés d'argent sont conservés sans votre nom. Les avis restent publiés sous la mention « Ancien client ».",
        "Les relevés d'argent sont gardés 10 ans, puis supprimés.",
        "Le détail et la marche à suivre, avec ou sans l'application, sont sur la page ⟪deletion|Supprimer votre compte⟫."
      ]},
      { id: "droits", t: "Vos droits", sum: "Vous pouvez consulter vos données, les corriger, vous opposer à leur utilisation ou les faire supprimer — dans l'application ou par e-mail.", body: [
        ["Accès : savoir quelles données nous avons sur vous, y compris vos absences et votre fiabilité.", "Rectification : corriger une donnée inexacte. La plupart se corrigent directement dans l'application.", "Opposition : vous opposer, pour un motif légitime, à l'utilisation de vos données.", "Suppression : supprimer votre compte dans l'application, ou nous le demander."],
        "Écrivez à [e-mail de contact] depuis l'adresse e-mail de votre compte, ou en indiquant son numéro de téléphone. ⟦10|Nous répondons sous [délai].⟧",
        "Si notre réponse ne vous satisfait pas, vous pouvez adresser une plainte à la CNDP (www.cndp.ma)."
      ]},
      { id: "securite", t: "Sécurité", sum: "L'accès aux données est limité, et les mots de passe ne sont jamais conservés en clair.", body: [
        "⟦11|Seules les personnes de Sterncut qui en ont besoin pour faire fonctionner le service ont accès aux données. Notre équipe ne lit une conversation que si elle lui est signalée ou jointe à une demande d'assistance.⟧"
      ]},
      { id: "mineurs", t: "Mineurs", sum: "Il faut avoir au moins [âge minimum] ans pour créer un compte.", body: [
        "⟦12|Sterncut s'adresse aux personnes âgées d'au moins [âge minimum] ans.⟧ La date de naissance est facultative."
      ]},
      { id: "modifs", t: "Modifications", sum: "Si cette politique change de façon importante, nous vous prévenons dans l'application.", body: [
        "La date de dernière mise à jour figure en haut de cette page. ⟦13|En cas de changement important, nous vous prévenons dans l'application [délai] avant qu'il s'applique.⟧"
      ]},
      { id: "contact", t: "Nous contacter", sum: "[e-mail de contact] · [téléphone du support]", body: [
        "[raison sociale], [adresse]. E-mail : [e-mail de contact]. Téléphone : [téléphone du support]."
      ]}
    ]
  },
  terms: {
    title: "Conditions d'utilisation",
    intro: "Ces conditions s'appliquent à toute personne qui utilise l'application Sterncut ou le site sterncut.ma : clients, invités de la file d'attente, coiffeurs et propriétaires de salon. En créant un compte ou en réservant, vous les acceptez.",
    sections: [
      { id: "objet", t: "Ce qu'est Sterncut", sum: "Un outil de réservation. Les coiffeurs et les salons sont indépendants : ce sont eux qui réalisent la prestation et qui se font payer.", body: [
        "Sterncut est édité par [raison sociale], [forme juridique], RC [numéro RC], ICE [numéro ICE], dont le siège est situé [adresse].",
        "Sterncut permet de trouver un salon, de réserver un créneau, de prendre une place dans une file d'attente et d'échanger avec un coiffeur.",
        "⟦1|Les coiffeurs et les salons sont des professionnels indépendants. Ils fixent leurs prestations, leurs prix et leurs horaires, et sont seuls responsables de la prestation. Sterncut n'est pas partie au contrat entre vous et le salon.⟧"
      ]},
      { id: "compte", t: "Votre compte", sum: "Des informations exactes et un mot de passe gardé secret.", body: [
        "⟦2|Vous devez avoir au moins [âge minimum] ans pour créer un compte.⟧",
        "Les informations que vous donnez doivent être exactes. Votre numéro de téléphone est vérifié par SMS.",
        "Gardez votre mot de passe secret. Si vous pensez que quelqu'un d'autre l'utilise, changez-le et écrivez-nous à [e-mail de contact]."
      ]},
      { id: "reservations", t: "Réservations et paiement", sum: "Le prix est celui du salon, affiché avant de réserver. Vous payez au salon.", body: [
        "Les prestations, leur prix et leur durée sont fixés par le salon et affichés dans l'application avant que vous réserviez.",
        "⟦3|Le paiement de la prestation se fait au salon. En dehors des acomptes, Sterncut n'encaisse aucun paiement pour les prestations.⟧",
        "Vous pouvez annuler une réservation depuis l'application. Si le salon annule, vous êtes prévenu."
      ]},
      { id: "acomptes", t: "Acomptes", sum: "Certains salons demandent un acompte. Son montant et la limite d'annulation gratuite sont affichés avant de réserver. Après cette limite, l'acompte n'est pas remboursé.", body: [
        "Un salon peut demander un acompte pour confirmer une réservation. Le montant et la date limite d'annulation gratuite sont affichés dans l'application avant que vous confirmiez.",
        "⟦3|L'acompte est payé avec votre portefeuille Sterncut.⟧",
        ["Vous annulez avant la limite : l'acompte est remboursé sur votre portefeuille.", "Vous annulez après la limite, ou vous ne venez pas : l'acompte n'est pas remboursé.", "⟦4|Le salon annule : l'acompte est remboursé sur votre portefeuille.⟧", "⟦5|Vous venez : l'acompte est déduit du prix payé au salon.⟧"]
      ]},
      { id: "absences", t: "Absences et fiabilité", sum: "Ne pas venir sans avoir annulé compte comme une absence. Vos absences et les évaluations des coiffeurs peuvent amener un salon à demander un acompte.", body: [
        "Si vous ne venez pas à un rendez-vous sans l'avoir annulé, le salon peut le marquer comme absence.",
        "⟦6|Après chaque visite, le coiffeur évalue votre fiabilité. Vos absences et ces évaluations peuvent amener un salon à vous demander un acompte pour vos prochaines réservations.⟧",
        "⟦7|Si une absence a été marquée par erreur, écrivez-nous à [e-mail de contact].⟧"
      ]},
      { id: "avis", t: "Avis, signalements et contestations", sum: "Les avis sont publics. Nous retirons ceux qui ne respectent pas ces règles, et vous pouvez contester nos décisions.", body: [
        "⟦8|Après une visite, vous pouvez laisser un avis sur le salon et le coiffeur.⟧ Les avis sont publics.",
        "⟦9|Un avis doit porter sur votre visite. Nous retirons les avis injurieux, discriminatoires, sans rapport avec la visite ou qui contiennent des informations personnelles.⟧",
        "⟦10|Chacun peut signaler un avis, un message ou un profil. Si nous retirons votre contenu ou prenons une mesure contre votre compte, nous vous en donnons la raison, et vous pouvez contester la décision depuis l'application.⟧",
        "⟦11|Vous nous autorisez à afficher gratuitement, dans l'application et sur sterncut.ma, les avis et les photos que vous publiez. Les avis restent affichés sans votre nom si vous supprimez votre compte.⟧"
      ]},
      { id: "suspension", t: "Suspension du compte", sum: "Nous pouvons suspendre un compte en cas de fraude, d'abus ou de manquement grave. Nous vous disons pourquoi.", body: [
        "⟦12|Nous pouvons suspendre ou fermer un compte en cas de fraude, de harcèlement, de faux avis, d'usage abusif du portefeuille ou de manquements répétés à ces conditions.⟧",
        "⟦12|Sauf urgence, nous vous prévenons avant et vous en donnons la raison. Vous pouvez contester la décision en écrivant à [e-mail de contact].⟧"
      ]},
      { id: "portefeuille", t: "Portefeuille", sum: "Il se recharge en espèces dans un salon, et nulle part ailleurs. L'argent ne peut pas être retiré.", body: [
        "Le portefeuille Sterncut se recharge uniquement en espèces, dans un salon qui propose le rechargement. Aucune carte bancaire n'est acceptée.",
        "⟦13|Le solde sert à payer les acomptes.⟧ Les remboursements d'acomptes, les coupons et les récompenses de parrainage y sont crédités ; leurs conditions sont affichées dans l'application.",
        "Le solde ne peut être ni retiré ni remboursé en espèces. Il est perdu si vous supprimez votre compte.",
        "⟦14|Le portefeuille n'est pas un compte bancaire et ne produit pas d'intérêts.⟧"
      ]},
      { id: "abonnements", t: "Abonnements des salons", sum: "Les propriétaires de salon paient un abonnement par coiffeur, au mois ou à l'année. Le prix est affiché avant la souscription.", body: [
        "Un salon souscrit un abonnement pour être réservable sur Sterncut. Le prix est fixé par coiffeur, au mois ou à l'année, avec un nombre maximal de coiffeurs facturés. Il est affiché sur sterncut.ma/tarifs et dans l'application avant la souscription.",
        "Une facture est émise pour chaque période.",
        "⟦15|[Moyens de paiement, renouvellement, retard de paiement et résiliation de l'abonnement.]⟧",
        "⟦16|Le propriétaire est responsable des coiffeurs ajoutés à son salon et des informations affichées sur la page du salon.⟧",
        "⟦17|Les conditions de commission ou de loyer sont convenues entre le coiffeur et le salon. Sterncut les enregistre pour établir les relevés, sans être partie à cet accord.⟧"
      ]},
      { id: "responsabilite", t: "Responsabilité", sum: "Nous faisons en sorte que Sterncut fonctionne, mais nous ne répondons pas de la prestation du salon.", body: [
        "⟦18|Sterncut ne peut pas garantir un service sans interruption. Sterncut n'est pas responsable de la qualité des prestations, des retards ou des litiges entre un client et un salon, sauf faute de sa part.⟧"
      ]},
      { id: "changements", t: "Modification des conditions", sum: "Nous vous prévenons dans l'application avant tout changement important.", body: [
        "⟦19|Nous pouvons modifier ces conditions. En cas de changement important, nous vous prévenons dans l'application [délai] avant qu'il s'applique.⟧ Si vous n'êtes pas d'accord, vous pouvez supprimer votre compte à tout moment."
      ]},
      { id: "droit", t: "Droit applicable et litiges", sum: "Le droit marocain s'applique. En cas de désaccord, écrivez-nous d'abord.", body: [
        "Ces conditions sont régies par le droit marocain.",
        "En cas de désaccord, écrivez-nous d'abord à [e-mail de contact] pour chercher une solution amiable. ⟦20|À défaut, le litige sera porté devant les tribunaux compétents de [ville].⟧"
      ]},
      { id: "contact", t: "Contact", sum: "[e-mail de contact] · [téléphone du support]", body: [
        "[raison sociale], [adresse]. E-mail : [e-mail de contact]. Téléphone : [téléphone du support]."
      ]}
    ]
  },
  deletion: {
    title: "Supprimer votre compte",
    intro: "Cette page explique comment supprimer votre compte Sterncut — l'application Sterncut, éditée par [raison sociale] — avec ou sans l'application, et ce que deviennent vos données.",
    sections: [
      { id: "app", t: "Depuis l'application", sum: "Le plus rapide : Profil › Paramètres › Supprimer le compte.", body: [
        { ol: ["Ouvrez Sterncut et allez dans Profil.", "Touchez Paramètres, puis Supprimer le compte.", "Suivez les étapes, puis tapez DELETE pour confirmer."] },
        "Le chemin est le même pour les clients et les coiffeurs. La suppression est immédiate une fois confirmée."
      ]},
      { id: "email", t: "Sans l'application", sum: "Écrivez-nous à [e-mail de contact] en indiquant le numéro de téléphone de votre compte.", body: [
        "Si vous n'avez plus l'application, envoyez-nous un e-mail avec les informations ci-dessous. ⟦1|Avant de supprimer le compte, nous vérifions que la demande vient bien de son titulaire.⟧",
        { tmpl: ["Objet : Supprimer mon compte Sterncut", "Nom : …", "Téléphone du compte : …", "E-mail du compte (si vous en avez un) : …", "Je suis : client · coiffeur · propriétaire de salon"] },
        { cta: "Écrire à [e-mail de contact]" },
        "⟦2|Nous traitons la demande sous [délai] et vous confirmons la suppression par e-mail ou par SMS.⟧"
      ]},
      { id: "avant", t: "Avant de supprimer", sum: "Certaines situations doivent être réglées d'abord. L'application vous indique lesquelles.", body: [
        { h: "Clients" },
        ["Une réservation à venir avec un acompte payé : annulez-la ou attendez qu'elle soit passée. Les acomptes ne sont pas remboursés à la suppression du compte.", "Le solde de votre portefeuille ne peut pas être versé en espèces et sera perdu. Vous pouvez d'abord l'utiliser pour un acompte."],
        { h: "Coiffeurs et propriétaires" },
        ["Les réservations clients à venir doivent être annulées ou passées. Les clients sont prévenus de chaque annulation.", "Le solde entre vous et Sterncut doit être à zéro, dans un sens comme dans l'autre.", "Si vous détenez la caisse du salon, remettez-la d'abord.", "Si vous êtes propriétaire d'un salon qui compte d'autres coiffeurs ou une facture impayée, contactez-nous : un salon ne peut pas être transféré depuis l'application."]
      ]},
      { id: "efface", t: "Ce qui est effacé", sum: "Tout ce qui vous identifie.", body: [
        ["Nom, numéro de téléphone, e-mail et photo de profil.", "Date de naissance (clients) ; bio, pièce d'identité et photos de réalisations (coiffeurs).", "Messages et photos des conversations.", "Coupons et solde du portefeuille."]
      ]},
      { id: "garde", t: "Ce qui est conservé, sans votre nom", sum: "Les réservations, les avis et les relevés d'argent restent, rendus anonymes. Les relevés d'argent sont gardés 10 ans.", body: [
        ["Réservations : les carnets des salons en ont besoin.", "Avis : ils restent publiés sous la mention « Ancien client ».", "⟦3|Relevés d'argent (portefeuille, acomptes, relevés des coiffeurs, factures) : gardés 10 ans, comme la loi l'exige, puis supprimés.⟧"]
      ]},
      { id: "questions", t: "Questions", sum: "[e-mail de contact] · [téléphone du support]", body: [
        "Pour en savoir plus sur vos données, lisez notre ⟪privacy|Politique de confidentialité⟫, ou écrivez à [e-mail de contact]."
      ]}
    ]
  }
},

ar: {
  ui: {
    name: "العربية",
    nav: ["للزبائن", "للصالونات", "الأثمنة"],
    signin: "دخول",
    draftTitle: "مسودة — يجب أن يراجعها محامٍ مغربي قبل النشر.",
    draftBody: "المقاطع المظلّلة ⚑ تحتاج إلى تحقّق، وما بين [معقوفتين] لم يُحسم بعد.",
    eyebrow: "معلومات قانونية",
    updated: "آخر تحديث: [تاريخ النشر]",
    draftOf: "مسودة 26 شتنبر 2026",
    toc: "المحتويات", tocCount: "{n} أقسام", summary: "باختصار",
    names: { privacy: "سياسة الخصوصية", terms: "شروط الاستخدام", deletion: "حذف حسابك" },
    slugs: { privacy: "sterncut.ma/ar/confidentialite", terms: "sterncut.ma/ar/conditions", deletion: "sterncut.ma/ar/supprimer-mon-compte" },
    footer: { tagline: "احجز حلاقك في طنجة.", site: "Sterncut", legal: "قانوني", contact: "اتصل بنا", langs: "اللغة",
      email: "[البريد الإلكتروني للتواصل]", phone: "[هاتف الدعم]",
      copy: "© 2026 [الاسم القانوني للشركة] · السجل التجاري [رقم السجل التجاري] · ICE [رقم ICE] · [العنوان]", cndp: "تصريح CNDP رقم [رقم التصريح لدى CNDP]" }
  },
  privacy: {
    title: "سياسة الخصوصية",
    intro: "توضّح هذه السياسة المعطيات التي يجمعها Sterncut عند استعمالك للتطبيق أو لموقع sterncut.ma، والغرض منها، ومع من نشاركها، وكيف تمارس حقوقك. وهي تسري على الزبائن، وضيوف طابور الانتظار، والحلاقين، وأصحاب الصالونات.",
    sections: [
      { id: "qui", t: "من نحن", sum: "يصدر Sterncut عن [الاسم القانوني للشركة]، وهي المسؤولة عن معالجة معطياتك.", body: [
        "المسؤول عن المعالجة هو [الاسم القانوني للشركة]، [الشكل القانوني]، المسجّلة في السجل التجاري بـ[المدينة] تحت رقم [رقم السجل التجاري]، ICE [رقم ICE]، ومقرها [العنوان].",
        "⟦1|صُرِّح بهذه المعالجة لدى اللجنة الوطنية لمراقبة حماية المعطيات ذات الطابع الشخصي (CNDP) تحت رقم [رقم التصريح لدى CNDP].⟧",
        "لأي سؤال حول معطياتك: [البريد الإلكتروني للتواصل]."
      ]},
      { id: "donnees", t: "المعطيات التي نجمعها", sum: "فقط ما يلزم للحجز، والانتظار في الطابور، والتواصل مع حلاقك، وتسيير محفظتك. لا بطاقات بنكية.", body: [
        { h: "حسابك" },
        ["الاسم ورقم الهاتف والبريد الإلكتروني.", "كلمة المرور: يحفظها مزوّد خدمة الدخول بصيغة مُجزّأة (hash)، ولا يستطيع أحد في Sterncut قراءتها.", "معرّف الدخول عبر Google أو Apple، إذا دخلت بأحدهما.", "تاريخ الميلاد (اختياري)، ولغة التطبيق، وصورة الملف الشخصي."],
        { h: "موقعك" },
        ["موقع هاتفك، فقط أثناء فتح التطبيق، لترتيب الصالونات حسب المسافة. ولا يُحفظ.", "موقع كل صالون، على شكل نقطة في الخريطة.", "عندما يرسل حلاق إلى فريقنا صورة ملصق صالونه، تُحفظ الصورة مع المكان الذي التُقطت فيه."],
        { h: "حجوزاتك" },
        ["الخدمات، والمواعيد، والملاحظات الموجّهة إلى الحلاق، وحالات الإلغاء وأسبابها، وحالات عدم الحضور.", "⟦2|بعد كل زيارة، يقيّم الحلاق موثوقية الزبون. وقد يحدّد هذا التقييم ما إذا كان الصالون سيطلب عربوناً.⟧"],
        { h: "مراسلاتك" },
        ["المحادثات بين الزبون والحلاق (نصوص وصور).", "طلبات المساعدة الموجّهة إلى فريقنا.", "التقييمات، وهي علنية، وكذلك البلاغات والطعون."],
        { h: "محفظتك" },
        ["عمليات الشحن نقداً في صالون، والعرابين، والمبالغ المستردّة، والقسائم، ومكافآت الإحالة. لا نجمع أي معطيات عن البطاقات البنكية."],
        { h: "عمليات البحث" },
        ["عمليات البحث داخل التطبيق، بما فيها التي لم تُسفر عن أي نتيجة."],
        { h: "بدون حساب: طابور الانتظار" },
        ["إذا أخذت مكاناً في طابور صالون من صفحته على الويب دون حساب، نحفظ اسمك الشخصي ورقم هاتفك."],
        { h: "الحلاقون والصالونات" },
        ["⟦3|وثيقة هوية، للتحقق من هوية الحلاق.⟧", "النبذة، والتخصص، وصور الأعمال، وأوقات العمل.", "المداخيل، وشروط العمولة أو الكراء، والنقود المتداولة، والكشوف الأسبوعية، وفواتير الاشتراك."],
        { h: "الإشعارات" },
        ["الرمز الذي يتيح إرسال الإشعارات إلى هاتفك، وسجلّ الإشعارات المرسلة."]
      ]},
      { id: "usages", t: "فيمَ نستعملها", sum: "لتشغيل الخدمة، واحترام القانون، ومعرفة أين نستقطب صالونات جديدة. ولا نستعملها أبداً للإشهار.", body: [
        ["إنشاء حسابك وتأمينه.", "عرض الصالونات القريبة ومواعيدها المتاحة، وتسجيل حجوزاتك ومكانك في الطابور.", "تمكين الصالون من تقرير طلب عربون، بناءً على حالات عدم الحضور وتقييمات الموثوقية.", "نقل رسائلك وصورك، ومعالجة طلبات المساعدة.", "نشر التقييمات ومعالجة البلاغات والطعون.", "تسيير المحفظة: الشحن، والعرابين، والمبالغ المستردّة، والقسائم، والإحالة.", "التحقق من هوية الحلاقين، وإعداد كشوفهم وفواتير اشتراك الصالونات.", "إرسال إشعارات حول حجوزاتك ورسائلك.", "دراسة عمليات البحث التي لم تُسفر عن نتيجة لاختيار الأحياء التي نستقطب فيها صالونات."],
        "⟦4|نستند إلى تنفيذ الخدمة التي طلبتها، وإلى التزاماتنا القانونية (خاصة المحاسبية)، وإلى موافقتك (الموقع، الإشعارات)، وإلى مصلحتنا المشروعة (عمليات البحث بدون نتيجة، ومنع التجاوزات).⟧",
        "لا نعرض أي إشهار، ولا نستعمل أي أداة لقياس الجمهور، ولا نبيع أي معطيات."
      ]},
      { id: "partage", t: "مع من نشاركها", sum: "مع الصالون الذي تختاره وبعض مزوّدي الخدمات التقنية. لا أحد غيرهم.", body: [
        "يرى الصالون والحلاق الذي تحجز عنده اسمك ورقم هاتفك وحجزك وملاحظاتك ورسائلك. ⟦5|ويرون أيضاً حالات عدم حضورك ومستوى موثوقيتك.⟧",
        "⟦6|التقييمات علنية وتظهر باسمك الشخصي.⟧",
        "يعالج مزوّدونا المعطيات لحسابنا ووفق تعليماتنا:",
        ["Supabase — قاعدة البيانات، والدخول، وتخزين الملفات.", "Expo — إرسال الإشعارات عبر خدمات Apple وGoogle.", "Google وApple — الدخول بحساب Google أو Apple.", "Cloudflare — استضافة موقع sterncut.ma.", "Apple Maps وGoogle Maps — عرض الخرائط."],
        "⟦7|قد يعالج هؤلاء المزوّدون المعطيات خارج المغرب، لا سيما في [بلد الاستضافة]. وتتم هذه التحويلات وفق القانون رقم 09.08 [مرجع ترخيص CNDP].⟧",
        "⟦8|لا نُطلع السلطات على المعطيات إلا عندما يُلزمنا القانون بذلك.⟧"
      ]},
      { id: "duree", t: "مدة الاحتفاظ", sum: "ما دام حسابك قائماً. ونحتفظ بالسجلات المالية 10 سنوات.", body: [
        ["معطيات الحساب: ما دام الحساب قائماً.", "موقع الهاتف: لا يُحفظ أبداً.", "⟦9|السجلات المالية (المحفظة، العرابين، كشوف الحلاقين، الفواتير): 10 سنوات، كما يفرض القانون بالنسبة للوثائق المحاسبية.⟧", "الاسم الشخصي ورقم هاتف ضيوف طابور الانتظار: [المدة].", "عمليات البحث: [المدة].", "سجلّ الإشعارات: [المدة].", "وثائق هوية الحلاقين: [المدة بعد التحقق]."]
      ]},
      { id: "suppression", t: "عند حذف حسابك", sum: "تُمحى معلوماتك الشخصية. وتبقى حجوزاتك وتقييماتك والسجلات المالية من دون اسمك.", body: [
        "يجعل الحذفُ الحسابَ مجهول الهوية: يُمحى اسمك وهاتفك وبريدك الإلكتروني وصورتك وباقي معلوماتك الشخصية.",
        "نحتفظ بالحجوزات والتقييمات والسجلات المالية من دون اسمك. وتبقى التقييمات منشورة باسم «زبون سابق».",
        "نحتفظ بالسجلات المالية 10 سنوات، ثم نحذفها.",
        "التفاصيل وطريقة الحذف، بالتطبيق أو بدونه، في صفحة ⟪deletion|حذف حسابك⟫."
      ]},
      { id: "droits", t: "حقوقك", sum: "يمكنك الاطلاع على معطياتك وتصحيحها والاعتراض على استعمالها أو طلب حذفها، من التطبيق أو عبر البريد الإلكتروني.", body: [
        ["الولوج: معرفة المعطيات التي نحتفظ بها عنك، بما فيها حالات عدم الحضور ومستوى الموثوقية.", "التصحيح: تصحيح أي معطى غير دقيق. ويمكن تصحيح أغلبها مباشرة من التطبيق.", "الاعتراض: الاعتراض، لأسباب مشروعة، على استعمال معطياتك.", "الحذف: حذف حسابك من التطبيق، أو طلب ذلك منا."],
        "راسلنا على [البريد الإلكتروني للتواصل] من البريد الإلكتروني المرتبط بحسابك، أو مع ذكر رقم هاتفه. ⟦10|نردّ داخل أجل [المهلة].⟧",
        "إذا لم يُرضِك ردّنا، يمكنك تقديم شكاية إلى CNDP (www.cndp.ma)."
      ]},
      { id: "securite", t: "الأمان", sum: "الولوج إلى المعطيات محدود، ولا تُحفظ كلمات المرور أبداً بشكل مقروء.", body: [
        "⟦11|لا يطّلع على المعطيات في Sterncut إلا من يحتاجها لتشغيل الخدمة. ولا يقرأ فريقنا أي محادثة إلا إذا أُبلغ عنها أو أُرفقت بطلب مساعدة.⟧"
      ]},
      { id: "mineurs", t: "القاصرون", sum: "يجب ألا يقلّ عمرك عن [السن الأدنى] سنة لإنشاء حساب.", body: [
        "⟦12|Sterncut موجّه للأشخاص الذين لا يقلّ عمرهم عن [السن الأدنى] سنة.⟧ وتاريخ الميلاد اختياري."
      ]},
      { id: "modifs", t: "التعديلات", sum: "إذا تغيّرت هذه السياسة تغييراً مهماً، نخبرك داخل التطبيق.", body: [
        "يظهر تاريخ آخر تحديث أعلى هذه الصفحة. ⟦13|في حال تغيير مهم، نخبرك داخل التطبيق قبل [المهلة] من سريانه.⟧"
      ]},
      { id: "contact", t: "اتصل بنا", sum: "[البريد الإلكتروني للتواصل] · [هاتف الدعم]", body: [
        "[الاسم القانوني للشركة]، [العنوان]. البريد الإلكتروني: [البريد الإلكتروني للتواصل]. الهاتف: [هاتف الدعم]."
      ]}
    ]
  },
  terms: {
    title: "شروط الاستخدام",
    intro: "تسري هذه الشروط على كل من يستعمل تطبيق Sterncut أو موقع sterncut.ma: الزبائن، وضيوف طابور الانتظار، والحلاقين، وأصحاب الصالونات. وبإنشائك حساباً أو قيامك بحجز، فأنت توافق عليها.",
    sections: [
      { id: "objet", t: "ما هو Sterncut", sum: "أداة للحجز. الحلاقون والصالونات مستقلّون: هم من يقدّمون الخدمة ويتقاضون ثمنها.", body: [
        "يصدر Sterncut عن [الاسم القانوني للشركة]، [الشكل القانوني]، السجل التجاري [رقم السجل التجاري]، ICE [رقم ICE]، ومقرها [العنوان].",
        "يتيح Sterncut إيجاد صالون، وحجز موعد، وأخذ مكان في طابور الانتظار، والتواصل مع حلاق.",
        "⟦1|الحلاقون والصالونات مهنيّون مستقلّون. يحدّدون خدماتهم وأثمنتهم وأوقات عملهم، وهم وحدهم المسؤولون عن الخدمة المقدّمة. وSterncut ليس طرفاً في العقد بينك وبين الصالون.⟧"
      ]},
      { id: "compte", t: "حسابك", sum: "معلومات صحيحة، وكلمة مرور تبقى سرّية.", body: [
        "⟦2|يجب ألا يقلّ عمرك عن [السن الأدنى] سنة لإنشاء حساب.⟧",
        "يجب أن تكون المعلومات التي تقدّمها صحيحة. ويُتحقَّق من رقم هاتفك عبر رسالة قصيرة.",
        "احتفظ بكلمة مرورك سرّية. إذا ظننت أن شخصاً آخر يستعملها، غيّرها وراسلنا على [البريد الإلكتروني للتواصل]."
      ]},
      { id: "reservations", t: "الحجوزات والأداء", sum: "الثمن هو ثمن الصالون، ويظهر قبل الحجز. وتؤدّيه في الصالون.", body: [
        "يحدّد الصالون الخدمات وأثمنتها ومدّتها، وتظهر في التطبيق قبل أن تحجز.",
        "⟦3|يُؤدّى ثمن الخدمة في الصالون. وباستثناء العرابين، لا يستخلص Sterncut أي مبلغ مقابل الخدمات.⟧",
        "يمكنك إلغاء حجز من التطبيق. وإذا ألغى الصالون، يصلك إشعار بذلك."
      ]},
      { id: "acomptes", t: "العرابين", sum: "تطلب بعض الصالونات عربوناً. يظهر مبلغه وآخر أجل للإلغاء المجاني قبل الحجز. وبعد هذا الأجل، لا يُستردّ العربون.", body: [
        "قد يطلب الصالون عربوناً لتأكيد الحجز. ويظهر المبلغ وآخر أجل للإلغاء المجاني في التطبيق قبل أن تؤكّد.",
        "⟦3|يُؤدّى العربون من محفظتك في Sterncut.⟧",
        ["إذا ألغيت قبل الأجل: يُعاد العربون إلى محفظتك.", "إذا ألغيت بعد الأجل أو لم تحضر: لا يُستردّ العربون.", "⟦4|إذا ألغى الصالون: يُعاد العربون إلى محفظتك.⟧", "⟦5|إذا حضرت: يُخصم العربون من الثمن الذي تؤدّيه في الصالون.⟧"]
      ]},
      { id: "absences", t: "عدم الحضور والموثوقية", sum: "عدم الحضور دون إلغاء يُحتسب غياباً. وقد تدفع حالات غيابك وتقييمات الحلاقين الصالونَ إلى طلب عربون.", body: [
        "إذا لم تحضر إلى موعد دون أن تلغيه، يمكن للصالون تسجيله غياباً.",
        "⟦6|بعد كل زيارة، يقيّم الحلاق موثوقيتك. وقد تدفع حالات غيابك وهذه التقييمات الصالونَ إلى طلب عربون منك في حجوزاتك المقبلة.⟧",
        "⟦7|إذا سُجّل غياب عن طريق الخطأ، راسلنا على [البريد الإلكتروني للتواصل].⟧"
      ]},
      { id: "avis", t: "التقييمات والبلاغات والطعون", sum: "التقييمات علنية. نحذف ما يخالف هذه القواعد، ويمكنك الطعن في قراراتنا.", body: [
        "⟦8|بعد الزيارة، يمكنك ترك تقييم للصالون والحلاق.⟧ والتقييمات علنية.",
        "⟦9|يجب أن يتعلّق التقييم بزيارتك. نحذف التقييمات المسيئة أو التمييزية أو التي لا علاقة لها بالزيارة أو التي تتضمّن معلومات شخصية.⟧",
        "⟦10|يمكن لأي شخص الإبلاغ عن تقييم أو رسالة أو ملف. إذا حذفنا محتواك أو اتخذنا إجراءً ضد حسابك، نُطلعك على السبب، ويمكنك الطعن في القرار من التطبيق.⟧",
        "⟦11|تأذن لنا بعرض التقييمات والصور التي تنشرها مجاناً في التطبيق وعلى sterncut.ma. وتبقى التقييمات معروضة دون اسمك إذا حذفت حسابك.⟧"
      ]},
      { id: "suspension", t: "تعليق الحساب", sum: "يمكننا تعليق حساب في حالة الاحتيال أو التجاوز أو الإخلال الجسيم. ونخبرك بالسبب.", body: [
        "⟦12|يمكننا تعليق حساب أو إغلاقه في حالة الاحتيال، أو التحرّش، أو التقييمات الزائفة، أو سوء استعمال المحفظة، أو الإخلال المتكرّر بهذه الشروط.⟧",
        "⟦12|ما لم يكن الأمر مستعجلاً، نخبرك مسبقاً ونُطلعك على السبب. ويمكنك الطعن في القرار بمراسلتنا على [البريد الإلكتروني للتواصل].⟧"
      ]},
      { id: "portefeuille", t: "المحفظة", sum: "تُشحن نقداً في صالون فقط. ولا يمكن سحب المال منها.", body: [
        "تُشحن محفظة Sterncut نقداً فقط، في صالون يوفّر خدمة الشحن. ولا تُقبل البطاقات البنكية.",
        "⟦13|يُستعمل الرصيد لأداء العرابين.⟧ وتُضاف إليه المبالغ المستردّة من العرابين والقسائم ومكافآت الإحالة، وتظهر شروطها في التطبيق.",
        "لا يمكن سحب الرصيد ولا استرداده نقداً. ويضيع إذا حذفت حسابك.",
        "⟦14|المحفظة ليست حساباً بنكياً ولا تُدرّ فوائد.⟧"
      ]},
      { id: "abonnements", t: "اشتراكات الصالونات", sum: "يؤدّي أصحاب الصالونات اشتراكاً عن كل حلاق، شهرياً أو سنوياً. ويظهر الثمن قبل الاشتراك.", body: [
        "يشترك الصالون ليصبح متاحاً للحجز على Sterncut. ويُحدَّد الثمن عن كل حلاق، شهرياً أو سنوياً، مع حدّ أقصى لعدد الحلاقين المحتسبين، ويظهر على sterncut.ma/tarifs وفي التطبيق قبل الاشتراك.",
        "تصدر فاتورة عن كل فترة.",
        "⟦15|[طرق أداء الاشتراك، والتجديد، والتأخر في الأداء، والإنهاء.]⟧",
        "⟦16|صاحب الصالون مسؤول عن الحلاقين المضافين إلى صالونه وعن المعلومات المعروضة في صفحة الصالون.⟧",
        "⟦17|يتّفق الحلاق والصالون على شروط العمولة أو الكراء. ويسجّلها Sterncut لإعداد الكشوف، دون أن يكون طرفاً في هذا الاتفاق.⟧"
      ]},
      { id: "responsabilite", t: "المسؤولية", sum: "نحرص على أن يعمل Sterncut، لكننا لا نتحمّل مسؤولية الخدمة التي يقدّمها الصالون.", body: [
        "⟦18|لا يمكن لـSterncut ضمان خدمة دون انقطاع. ولا يتحمّل Sterncut مسؤولية جودة الخدمات أو التأخيرات أو النزاعات بين الزبون والصالون، إلا في حال خطأ من جانبه.⟧"
      ]},
      { id: "changements", t: "تعديل الشروط", sum: "نخبرك داخل التطبيق قبل أي تغيير مهم.", body: [
        "⟦19|يمكننا تعديل هذه الشروط. وفي حال تغيير مهم، نخبرك داخل التطبيق قبل [المهلة] من سريانه.⟧ وإذا لم توافق، يمكنك حذف حسابك في أي وقت."
      ]},
      { id: "droit", t: "القانون الواجب التطبيق والنزاعات", sum: "يسري القانون المغربي. وفي حال خلاف، راسلنا أولاً.", body: [
        "تخضع هذه الشروط للقانون المغربي.",
        "في حال خلاف، راسلنا أولاً على [البريد الإلكتروني للتواصل] للبحث عن حلّ ودّي. ⟦20|وإن تعذّر ذلك، يُعرض النزاع على المحاكم المختصة بـ[المدينة].⟧"
      ]},
      { id: "contact", t: "اتصل بنا", sum: "[البريد الإلكتروني للتواصل] · [هاتف الدعم]", body: [
        "[الاسم القانوني للشركة]، [العنوان]. البريد الإلكتروني: [البريد الإلكتروني للتواصل]. الهاتف: [هاتف الدعم]."
      ]}
    ]
  },
  deletion: {
    title: "حذف حسابك",
    intro: "توضّح هذه الصفحة كيف تحذف حسابك في Sterncut — تطبيق Sterncut الصادر عن [الاسم القانوني للشركة] — بالتطبيق أو بدونه، وماذا يحدث لمعطياتك.",
    sections: [
      { id: "app", t: "من التطبيق", sum: "الأسرع: الملف الشخصي › الإعدادات › حذف الحساب.", body: [
        { ol: ["افتح Sterncut وانتقل إلى الملف الشخصي.", "اضغط على الإعدادات، ثم على حذف الحساب.", "اتبع الخطوات، ثم اكتب DELETE للتأكيد."] },
        "الطريق نفسه للزبائن والحلاقين. ويتم الحذف فوراً بعد التأكيد."
      ]},
      { id: "email", t: "بدون التطبيق", sum: "راسلنا على [البريد الإلكتروني للتواصل] مع ذكر رقم الهاتف المرتبط بحسابك.", body: [
        "إذا لم يعد التطبيق لديك، أرسل إلينا بريداً إلكترونياً بالمعلومات أدناه. ⟦1|وقبل حذف الحساب، نتحقّق من أن الطلب صادر عن صاحبه.⟧",
        { tmpl: ["الموضوع: حذف حسابي في Sterncut", "الاسم: …", "هاتف الحساب: …", "البريد الإلكتروني للحساب (إن وُجد): …", "أنا: زبون · حلاق · صاحب صالون"] },
        { cta: "راسلنا على [البريد الإلكتروني للتواصل]" },
        "⟦2|نعالج الطلب داخل أجل [المهلة] ونؤكّد لك الحذف عبر البريد الإلكتروني أو رسالة قصيرة.⟧"
      ]},
      { id: "avant", t: "قبل الحذف", sum: "بعض الحالات يجب تسويتها أولاً، ويخبرك التطبيق بها.", body: [
        { h: "الزبائن" },
        ["حجز قادم بعربون مدفوع: ألغِه أو انتظر حتى يمرّ موعده. ولا تُستردّ العرابين عند حذف الحساب.", "لا يمكن صرف رصيد محفظتك نقداً، وسيضيع. يمكنك استعماله أولاً لأداء عربون."],
        { h: "الحلاقون وأصحاب الصالونات" },
        ["يجب إلغاء حجوزات الزبائن القادمة أو انتظار مرورها. ويُبلَّغ الزبائن بكل إلغاء.", "يجب أن يكون الرصيد بينك وبين Sterncut صفراً، في أي اتجاه كان.", "إذا كان صندوق نقود الصالون معك، سلّمه أولاً.", "إذا كنت صاحب صالون يعمل فيه حلاقون آخرون أو عليه فاتورة غير مؤدّاة، اتصل بنا: لا يمكن نقل الصالون من التطبيق."]
      ]},
      { id: "efface", t: "ما يُمحى", sum: "كل ما يدلّ على هويتك.", body: [
        ["الاسم، ورقم الهاتف، والبريد الإلكتروني، وصورة الملف الشخصي.", "تاريخ الميلاد (الزبائن)؛ النبذة، ووثيقة الهوية، وصور الأعمال (الحلاقون).", "رسائل المحادثات وصورها.", "القسائم ورصيد المحفظة."]
      ]},
      { id: "garde", t: "ما نحتفظ به، دون اسمك", sum: "تبقى الحجوزات والتقييمات والسجلات المالية مجهولة الهوية. ونحتفظ بالسجلات المالية 10 سنوات.", body: [
        ["الحجوزات: تحتاجها دفاتر الصالونات.", "التقييمات: تبقى منشورة باسم «زبون سابق».", "⟦3|السجلات المالية (المحفظة، العرابين، كشوف الحلاقين، الفواتير): نحتفظ بها 10 سنوات كما يفرض القانون، ثم نحذفها.⟧"]
      ]},
      { id: "questions", t: "أسئلة", sum: "[البريد الإلكتروني للتواصل] · [هاتف الدعم]", body: [
        "لمعرفة المزيد عن معطياتك، اقرأ ⟪privacy|سياسة الخصوصية⟫، أو راسلنا على [البريد الإلكتروني للتواصل]."
      ]}
    ]
  }
},

en: {
  ui: {
    name: "English",
    nav: ["For clients", "For shops", "Pricing"],
    signin: "SIGN IN",
    draftTitle: "DRAFT — to be reviewed by a Moroccan lawyer before publishing.",
    draftBody: "Highlighted passages ⚑ need checking; [brackets] are still to be decided.",
    eyebrow: "Legal",
    updated: "Last updated: [publication date]",
    draftOf: "Draft of 26 September 2026",
    toc: "Contents", tocCount: "{n} sections", summary: "In short",
    names: { privacy: "Privacy policy", terms: "Terms of use", deletion: "Delete your account" },
    slugs: { privacy: "sterncut.ma/en/privacy", terms: "sterncut.ma/en/terms", deletion: "sterncut.ma/en/delete-account" },
    footer: { tagline: "Book your barber in Tangier.", site: "Sterncut", legal: "Legal", contact: "Contact", langs: "Language",
      email: "[contact email]", phone: "[support phone]",
      copy: "© 2026 [legal entity] · RC [RC number] · ICE [ICE number] · [address]", cndp: "CNDP declaration no. [CNDP declaration number]" }
  },
  privacy: {
    title: "Privacy policy",
    intro: "This policy explains what data Sterncut collects when you use the app or the sterncut.ma website, what it's used for, who it's shared with and how to exercise your rights. It applies to clients, queue guests, barbers and shop owners.",
    sections: [
      { id: "qui", t: "Who we are", sum: "Sterncut is published by [legal entity], which is responsible for processing your data.", body: [
        "The data controller is [legal entity], [legal form], registered in the [city] commercial register under number [RC number], ICE [ICE number], with its registered office at [address].",
        "⟦1|This processing has been declared to the Commission nationale de contrôle de la protection des données à caractère personnel (CNDP) under number [CNDP declaration number].⟧",
        "For any question about your data: [contact email]."
      ]},
      { id: "donnees", t: "The data we collect", sum: "Only what's needed to book, queue, talk to your barber and run your wallet. No bank cards.", body: [
        { h: "Your account" },
        ["Name, phone number and email address.", "Password: stored hashed by our sign-in provider; nobody at Sterncut can read it.", "Your Google or Apple sign-in ID, if you sign in with one of them.", "Date of birth (optional), app language and profile photo."],
        { h: "Your location" },
        ["Your phone's location, only while the app is open, to sort shops by distance. It isn't stored.", "Each shop's location, as a pin on the map.", "When a barber sends our team a photo of the shop's poster, the photo is saved with the location where it was taken."],
        { h: "Your bookings" },
        ["Services, times, notes to the barber, cancellations and their reasons, and no-shows.", "⟦2|After a visit, the barber rates the client's reliability. That rating can decide whether a shop asks for a deposit.⟧"],
        { h: "Your conversations" },
        ["Chats between a client and a barber (text and photos).", "Support cases with our team.", "Reviews, which are public, plus reports and appeals."],
        { h: "Your wallet" },
        ["Cash top-ups made at a shop, deposits, refunds, coupons and referral rewards. No bank card data is collected."],
        { h: "Your searches" },
        ["Searches made in the app, including ones that found nothing."],
        { h: "Without an account: the queue" },
        ["If you take a place in a shop's queue from its web page without an account, we store your first name and phone number."],
        { h: "Barbers and shops" },
        ["⟦3|An ID document, to verify the barber's identity.⟧", "Bio, specialty, portfolio photos and working hours.", "Earnings, commission or rent terms, cash handled, weekly statements and subscription bills."],
        { h: "Notifications" },
        ["The token that lets us send notifications to your phone, and a log of notifications sent."]
      ]},
      { id: "usages", t: "What we use it for", sum: "To run the service, to comply with the law and to know where to recruit new shops. Never for advertising.", body: [
        ["Creating and securing your account.", "Showing nearby shops and their free times, and recording your bookings and your place in a queue.", "Letting a shop decide whether to ask for a deposit, based on no-shows and reliability ratings.", "Delivering your messages and photos, and handling support cases.", "Publishing reviews and handling reports and appeals.", "Running the wallet: top-ups, deposits, refunds, coupons and referrals.", "Verifying barbers' identity, and producing their statements and shops' subscription bills.", "Sending you notifications about your bookings and messages.", "Studying searches that found nothing, to choose the neighbourhoods where we recruit shops."],
        "⟦4|We rely on performing the service you asked for, on our legal obligations (accounting in particular), on your consent (location, notifications) and on our legitimate interest (searches with no result, preventing abuse).⟧",
        "We show no advertising, use no audience-measurement tools and sell no data."
      ]},
      { id: "partage", t: "Who we share it with", sum: "With the shop you choose and a few technical providers. No one else.", body: [
        "The shop and barber you book see your name, phone number, booking, notes and messages. ⟦5|They also see your no-shows and your reliability standing.⟧",
        "⟦6|Reviews are public and shown with your first name.⟧",
        "Our providers process data on our behalf and on our instructions:",
        ["Supabase — database, sign-in and file storage.", "Expo — sending notifications, through Apple and Google.", "Google and Apple — signing in with a Google or Apple account.", "Cloudflare — hosting the sterncut.ma website.", "Apple Maps and Google Maps — displaying maps."],
        "⟦7|These providers may process data outside Morocco, notably in [hosting country]. These transfers are made in accordance with law 09-08 [CNDP authorisation reference].⟧",
        "⟦8|We disclose data to authorities only when the law requires us to.⟧"
      ]},
      { id: "duree", t: "How long we keep it", sum: "As long as your account exists. Money records are kept for 10 years.", body: [
        ["Account data: as long as the account exists.", "Phone location: never stored.", "⟦9|Money records (wallet, deposits, barber statements, invoices): 10 years, as the law requires for accounting records.⟧", "Queue guests' first name and phone: [duration].", "Searches: [duration].", "Notification log: [duration].", "Barbers' ID documents: [duration after verification]."]
      ]},
      { id: "suppression", t: "When you delete your account", sum: "Your personal details are erased. Your bookings, reviews and money records stay, without your name.", body: [
        "Deleting makes the account anonymous: your name, phone, email, photo and other personal details are erased.",
        "Bookings, reviews and money records are kept without your name. Reviews stay published as “Former customer”.",
        "Money records are kept for 10 years, then deleted.",
        "The details, and how to delete with or without the app, are on the ⟪deletion|Delete your account⟫ page."
      ]},
      { id: "droits", t: "Your rights", sum: "You can see your data, correct it, object to its use or have it deleted — in the app or by email.", body: [
        ["Access: find out what data we hold about you, including your no-shows and reliability standing.", "Correction: fix inaccurate data. Most of it can be changed directly in the app.", "Objection: object, on legitimate grounds, to the use of your data.", "Deletion: delete your account in the app, or ask us to."],
        "Write to [contact email] from the email address on your account, or give its phone number. ⟦10|We reply within [deadline].⟧",
        "If you're not satisfied with our reply, you can complain to the CNDP (www.cndp.ma)."
      ]},
      { id: "securite", t: "Security", sum: "Access to data is limited, and passwords are never kept in readable form.", body: [
        "⟦11|Only the people at Sterncut who need it to run the service can access data. Our team reads a conversation only if it's reported or attached to a support case.⟧"
      ]},
      { id: "mineurs", t: "Minors", sum: "You must be at least [minimum age] to create an account.", body: [
        "⟦12|Sterncut is for people aged [minimum age] and over.⟧ Date of birth is optional."
      ]},
      { id: "modifs", t: "Changes", sum: "If this policy changes in an important way, we tell you in the app.", body: [
        "The last-updated date is at the top of this page. ⟦13|For an important change, we tell you in the app [notice period] before it applies.⟧"
      ]},
      { id: "contact", t: "Contact us", sum: "[contact email] · [support phone]", body: [
        "[legal entity], [address]. Email: [contact email]. Phone: [support phone]."
      ]}
    ]
  },
  terms: {
    title: "Terms of use",
    intro: "These terms apply to anyone who uses the Sterncut app or the sterncut.ma website: clients, queue guests, barbers and shop owners. By creating an account or making a booking, you accept them.",
    sections: [
      { id: "objet", t: "What Sterncut is", sum: "A booking tool. Barbers and shops are independent: they do the work and get paid for it.", body: [
        "Sterncut is published by [legal entity], [legal form], RC [RC number], ICE [ICE number], with its registered office at [address].",
        "Sterncut lets you find a shop, book a time, take a place in a queue and message a barber.",
        "⟦1|Barbers and shops are independent professionals. They set their services, prices and hours, and they alone are responsible for the service. Sterncut is not a party to the contract between you and the shop.⟧"
      ]},
      { id: "compte", t: "Your account", sum: "Accurate details and a password you keep to yourself.", body: [
        "⟦2|You must be at least [minimum age] to create an account.⟧",
        "The details you give must be accurate. Your phone number is verified by SMS.",
        "Keep your password secret. If you think someone else is using it, change it and write to us at [contact email]."
      ]},
      { id: "reservations", t: "Bookings and payment", sum: "The price is the shop's, shown before you book. You pay at the shop.", body: [
        "Services, prices and durations are set by the shop and shown in the app before you book.",
        "⟦3|You pay for the service at the shop. Apart from deposits, Sterncut takes no payment for services.⟧",
        "You can cancel a booking in the app. If the shop cancels, you're notified."
      ]},
      { id: "acomptes", t: "Deposits", sum: "Some shops ask for a deposit. The amount and the free-cancellation deadline are shown before you book. After that deadline, the deposit isn't refunded.", body: [
        "A shop can ask for a deposit to confirm a booking. The amount and the free-cancellation deadline are shown in the app before you confirm.",
        "⟦3|The deposit is paid from your Sterncut wallet.⟧",
        ["You cancel before the deadline: the deposit goes back to your wallet.", "You cancel after the deadline, or don't come: the deposit isn't refunded.", "⟦4|The shop cancels: the deposit goes back to your wallet.⟧", "⟦5|You come: the deposit is taken off the price you pay at the shop.⟧"]
      ]},
      { id: "absences", t: "No-shows and reliability", sum: "Not coming without cancelling counts as a no-show. Your no-shows and barbers' ratings can lead a shop to ask for a deposit.", body: [
        "If you don't come to a booking and haven't cancelled it, the shop can mark it as a no-show.",
        "⟦6|After each visit, the barber rates your reliability. Your no-shows and these ratings can lead a shop to ask you for a deposit on future bookings.⟧",
        "⟦7|If a no-show was marked by mistake, write to us at [contact email].⟧"
      ]},
      { id: "avis", t: "Reviews, reports and appeals", sum: "Reviews are public. We remove those that break these rules, and you can appeal our decisions.", body: [
        "⟦8|After a visit, you can leave a review of the shop and the barber.⟧ Reviews are public.",
        "⟦9|A review must be about your visit. We remove reviews that are insulting, discriminatory, unrelated to the visit or that contain personal information.⟧",
        "⟦10|Anyone can report a review, a message or a profile. If we remove your content or take action against your account, we tell you why, and you can appeal the decision in the app.⟧",
        "⟦11|You allow us to display the reviews and photos you publish, free of charge, in the app and on sterncut.ma. Reviews stay displayed without your name if you delete your account.⟧"
      ]},
      { id: "suspension", t: "Account suspension", sum: "We can suspend an account for fraud, abuse or a serious breach. We tell you why.", body: [
        "⟦12|We can suspend or close an account for fraud, harassment, fake reviews, misuse of the wallet or repeated breaches of these terms.⟧",
        "⟦12|Unless it's urgent, we warn you first and tell you why. You can appeal by writing to [contact email].⟧"
      ]},
      { id: "portefeuille", t: "Wallet", sum: "Topped up in cash at a shop, and nowhere else. The money can't be withdrawn.", body: [
        "The Sterncut wallet is topped up only in cash, at a shop that offers top-ups. Bank cards aren't accepted.",
        "⟦13|The balance is used to pay deposits.⟧ Deposit refunds, coupons and referral rewards are credited to it; their conditions are shown in the app.",
        "The balance can't be withdrawn or refunded in cash. It's lost if you delete your account.",
        "⟦14|The wallet is not a bank account and earns no interest.⟧"
      ]},
      { id: "abonnements", t: "Shop subscriptions", sum: "Shop owners pay a subscription per barber, monthly or yearly. The price is shown before subscribing.", body: [
        "A shop subscribes to be bookable on Sterncut. The price is set per barber, monthly or yearly, with a maximum number of barbers billed, and is shown on sterncut.ma/tarifs and in the app before subscribing.",
        "An invoice is issued for each period.",
        "⟦15|[Subscription payment methods, renewal, late payment and cancellation.]⟧",
        "⟦16|The owner is responsible for the barbers added to the shop and for the information shown on the shop's page.⟧",
        "⟦17|Commission or rent terms are agreed between the barber and the shop. Sterncut records them to produce statements, without being a party to that agreement.⟧"
      ]},
      { id: "responsabilite", t: "Liability", sum: "We work to keep Sterncut running, but we don't answer for the shop's service.", body: [
        "⟦18|Sterncut can't guarantee uninterrupted service. Sterncut isn't responsible for the quality of services, delays or disputes between a client and a shop, unless it is at fault.⟧"
      ]},
      { id: "changements", t: "Changes to these terms", sum: "We tell you in the app before any important change.", body: [
        "⟦19|We may change these terms. For an important change, we tell you in the app [notice period] before it applies.⟧ If you don't agree, you can delete your account at any time."
      ]},
      { id: "droit", t: "Governing law and disputes", sum: "Moroccan law applies. If there's a disagreement, write to us first.", body: [
        "These terms are governed by Moroccan law.",
        "If there's a disagreement, write to us first at [contact email] so we can look for an amicable solution. ⟦20|Failing that, the dispute will go before the competent courts of [city].⟧"
      ]},
      { id: "contact", t: "Contact", sum: "[contact email] · [support phone]", body: [
        "[legal entity], [address]. Email: [contact email]. Phone: [support phone]."
      ]}
    ]
  },
  deletion: {
    title: "Delete your account",
    intro: "This page explains how to delete your Sterncut account — the Sterncut app, published by [legal entity] — with or without the app, and what happens to your data.",
    sections: [
      { id: "app", t: "In the app", sum: "Quickest: Profile › Settings › Delete account.", body: [
        { ol: ["Open Sterncut and go to Profile.", "Tap Settings, then Delete account.", "Follow the steps, then type DELETE to confirm."] },
        "The path is the same for clients and barbers. Deletion is immediate once confirmed."
      ]},
      { id: "email", t: "Without the app", sum: "Write to [contact email] and give the phone number on your account.", body: [
        "If you no longer have the app, email us with the details below. ⟦1|Before deleting the account, we check that the request comes from its holder.⟧",
        { tmpl: ["Subject: Delete my Sterncut account", "Name: …", "Account phone number: …", "Account email (if you have one): …", "I am a: client · barber · shop owner"] },
        { cta: "Write to [contact email]" },
        "⟦2|We handle the request within [deadline] and confirm the deletion by email or SMS.⟧"
      ]},
      { id: "avant", t: "Before you delete", sum: "Some things have to be settled first. The app tells you which.", body: [
        { h: "Clients" },
        ["An upcoming booking with a paid deposit: cancel it or wait until it has passed. Deposits aren't refunded when an account is deleted.", "Your wallet balance can't be paid out in cash and will be lost. You can use it on a deposit first."],
        { h: "Barbers and owners" },
        ["Upcoming client bookings must be cancelled or passed. Clients are told about each cancellation.", "The balance between you and Sterncut must be at zero, whichever way it runs.", "If you hold the shop's cash drawer, hand it over first.", "If you own a shop with other barbers or an unpaid bill, contact us: a shop can't be transferred from the app."]
      ]},
      { id: "efface", t: "What is erased", sum: "Everything that identifies you.", body: [
        ["Name, phone number, email and profile photo.", "Date of birth (clients); bio, ID document and portfolio photos (barbers).", "Chat messages and photos.", "Coupons and wallet balance."]
      ]},
      { id: "garde", t: "What is kept, without your name", sum: "Bookings, reviews and money records stay, made anonymous. Money records are kept for 10 years.", body: [
        ["Bookings: shops' books need them.", "Reviews: they stay published as “Former customer”.", "⟦3|Money records (wallet, deposits, barber statements, invoices): kept for 10 years as the law requires, then deleted.⟧"]
      ]},
      { id: "questions", t: "Questions", sum: "[contact email] · [support phone]", body: [
        "To learn more about your data, read our ⟪privacy|Privacy policy⟫, or write to [contact email]."
      ]}
    ]
  }
}
}
};
