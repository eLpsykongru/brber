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

## Profile menu rows  → `src/screens/ProfileScreen.tsx` (customer)
- **Payment Methods / My Wallet** — need a payment rail (no Stripe in Morocco; pay
  at shop for now). Wallet also needs a `wallet_transactions` ledger table.
- **My Coupons** — needs the same `promotions`/coupons table as Explore badges.
- **Settings** — placeholder. Likely: notification prefs (push), password change
  (`supabase.auth.updateUser`), language (ar/fr/en).
- **Help Center** — placeholder. Static FAQ + contact links (WhatsApp/phone).
