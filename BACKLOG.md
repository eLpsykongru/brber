# Deferred features (UI built, backend pending)

Screens ship with the full mockup UI; items below are placeholders wired to
real data *later*. Each names the file + what to replace. Grep `TODO(backlog)`.

## Location & maps  → Explore tab
- **Real map** — `src/screens/ExploreScreen.tsx` renders a styled placeholder.
  Needs: lat/lng on `salons` (Google Places autocomplete at onboarding) + a map
  lib (`react-native-maps`, requires an EAS dev build — no map in Expo Go).
- **Distances ("8.8 Km", "3.5 Miles • 15 Min")** — currently a stable pseudo value
  per salon. Real value = haversine(user location, salon lat/lng) once both exist.
- **"Locate me" FAB / user pin** — needs `expo-location` permission + position.
- **"Navigate" button on cards** — open the device maps app to salon coords.

## Wishlist  → heart button on Explore cards
- Toggling does nothing yet. Needs a `wishlists (customer_id, salon_id)` table +
  RLS, and a Wishlist tab (mockup shows one; we kept Bookings in the 5-tab slot).

## Promotions  → "5% OFF" badge on Explore cards
- Hardcoded label. Needs a `promotions` table (salon_id, percent, validity) and
  application to the deposit/price once a payment rail exists.

## Filters  → filter button next to search
- Opens a "coming soon" note. Mockup filter screen: gender, category, rating,
  distance, price range. Build when categories + lat/lng + price filters are real.

## Reminders  → "Remind me" toggle on booking cards (My Bookings)
- Removed for now; belongs with **push notifications** (Expo push tokens + a DB
  webhook on booking/message insert). Whole push increment is still TODO.

## Salon screen  → `src/screens/SalonDetailScreen.tsx`
- **Packages tab + "Packages" step in the booking sheet** — needs a `packages` table
  (salon-level, name, price, "saved" amount) + `package_items` (services in it), and a
  booking mapping (add nullable `package_id` to `bookings`, make `service_id` nullable,
  trigger computes duration = sum of items / price = package price). DECISION PENDING:
  how a package books against one barber + calendar slot.
- **Intro video** — hero play button is a placeholder; needs a `video_url` on salons + `expo-av`.
- **Website / Direction / Message actions** — Website opens `salons.website` if set (added
  in 0013); Direction needs lat/lng + maps; Message needs a booking-scoped chat entry.
- **Distance/ETA ("12 Min • 1.5 Miles")** — placeholder; see the Explore/maps item.
- **"add review" on the Review tab** — reviews still come only from a completed booking
  (My Bookings → Rate). No arbitrary review entry from the salon screen.

## Chat  → `src/screens/ChatsScreen.tsx` + `src/screens/ChatScreen.tsx`
- **Online/presence status** — the green dot + "Online" are decorative. Needs
  Supabase Realtime Presence (track online users per channel).
- **Unread tracking** — "Unread" tab, per-row unread badges, and read receipts
  (✓✓). Needs a `chat_reads (booking_id, user_id, last_read_at)` table; unread =
  messages newer than last_read_at not sent by me.
- **Voice notes** — mic button in the composer. Needs `expo-av` record + upload to
  a `voice` bucket + a waveform/play message type.
- **Emoji picker** — emoji button is a placeholder (system keyboard has emoji).
- **Chat search** — search icon filters the conversation list (basic filter is live;
  full-text over message bodies is TODO).

## Placeholder screens (UI built, not wired to backend)
These exist as visual shells to implement later:
- **WalletScreen** (My Wallet / Add Money / Top-Up Success) — static balance + fake
  transactions. Needs a payment rail + `wallet_transactions` ledger.
- **CouponsScreen** — static coupon cards; "Copy code" just alerts. Needs promotions table.
- **HelpCenterScreen** — FAQ accordion + Contact Us; content is placeholder. Wire real links.
- **CancelReasonScreen** — reason picker; created, NOT wired into My Bookings cancel yet.
  To wire: add `bookings.cancel_reason`, pass through `cancel_booking()`.
- **LeaveReviewScreen** — richer review form; real review submit still lives in My Bookings
  → Rate. Needs specialist picker binding + photo attach to reviews.
- **PermissionScreen** (+ Notification/Location presets) — onboarding prompts; wire to
  expo-notifications / expo-location in the first-run flow.
Wired now: My Wallet, My Coupons, Help Center (from the Profile menu).

## Strategy — differentiators (nothing built, decided 2026-07-13)

Not "deferred UI" like the rest of this file — these are the bets that decide
whether barbers adopt us and whether money can move. Each names its **trigger**:
raise it when we hit that point, not before.

### Barber adoption (the app is a free tool first, a marketplace second)
Barbers will not adopt on the promise of new clients (we have none at launch).
They adopt on tools that fix today's business. Priority order:
1. **Shareable booking link** — `brber.ma/<barber>` for the Instagram bio / WhatsApp
   status. Barbers already run on IG DMs; this lets them bring their *own* clients
   and self-onboard. **Trigger:** as soon as booking is stable + any web surface exists.
2. **Automatic client reminders** — the felt pain is no-shows, not discovery.
   **Trigger:** with the push-notifications increment (see Reminders above).
3. **Client book + informal debt ledger** — regulars' preferences + "owes me 50 DH",
   which barbers today keep in their head. No foreign competitor models this.
   **Trigger:** once a barber has repeat customers (needs `bookings` history only).
4. **Flash discounts on dead hours** (11h–16h chairs are empty) — doubles as our
   client-acquisition engine. **Trigger:** with the `promotions` table.
5. **Verified badge / "Top rated in Tangier"** — barbers are competitive and
   image-driven; costs nothing, we already have reviews + ID verification.
6. **Zero commission on their own clients, stated loudly.** Monetize only
   marketplace-sourced clients + payment fees later. **Trigger:** pricing page.

### QUEUE MODE — the one bet that puts us ahead
Most Moroccan barbershops are **walk-in, not appointment**. An appointment-only app
fights the culture. Queue mode *is* the culture minus the bench: client takes a
virtual ticket, sees "3 ahead, ~40 min"; barber sees the queue on his phone.
Works with **zero payment rail**. No competitor (Booksy/Fresha clones) has this.
**Trigger:** right after bookings are solid — before packages, before maps.
Needs: `queue_tickets (barber_id, customer_id, joined_at, position, status)` +
Realtime for live position; ETA = sum of avg service durations ahead of you.

### Payments — phased, since Stripe is out (see 0005_no_deposits)
- **Phase 1 (now): no money through us.** Pay at shop. Fight no-shows with
  *reputation*, not deposits: strike system (2 no-shows → must phone-confirm /
  lose booking priority), "reliable client" badge, barber marks no-show.
  **Trigger:** first real no-show complaint from a barber.
- **Phase 2: in-app wallet** (`WalletScreen` becomes real) = a ledger *we* own,
  with pluggable top-up rails:
  - **Card** via **YouCan Pay** (Moroccan, sits on CMI) — verify current fees/API
    before committing; do NOT assume Stripe-like DX.
  - **Cash top-up at the barbershop** ← *the unfair advantage.* Client hands the
    barber 100 DH, barber credits the wallet from his app, we net it against what
    we owe the barber. **Barbers become our agent network** (the M-Pesa bootstrap)
    — no Cash Plus partnership needed, and trust is easy because it's *their* barber.
    Needs: float limit per barber, daily netting, and a check on Bank Al-Maghrib
    payment-agent rules once real money moves.
  **Trigger:** once wallets have balance, **deposits** and **coupons** finally have
  something to attach to — that unblocks 4 items above.
- **Phase 3: direct m-wallets** (Orange Money, inwi money, Cash Plus API) only when
  volume justifies the partnership overhead. **Trigger:** not before real volume.

### Localisation
**Darija/Arabic + French UI, WhatsApp-first sharing.** Cheap for us, and the
difference between "an app" and "our app". Booksy will never do this well.
**Trigger:** before any paid client acquisition.

## Profile menu rows  → `src/screens/ProfileScreen.tsx` (customer)
- **Payment Methods / My Wallet** — need a payment rail (no Stripe in Morocco; pay
  at shop for now). Wallet also needs a `wallet_transactions` ledger table.
- **My Coupons** — needs the same `promotions`/coupons table as Explore badges.
- **Settings** — placeholder. Likely: notification prefs (push), password change
  (`supabase.auth.updateUser`), language (ar/fr/en).
- **Help Center** — placeholder. Static FAQ + contact links (WhatsApp/phone).
