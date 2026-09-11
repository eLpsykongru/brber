# Deferred features (UI built, backend pending)

Screens ship with the full mockup UI; items below are placeholders wired to
real data *later*. Each names the file + what to replace. Grep `TODO(backlog)`.

## Location & maps  → Explore tab — DONE 2026-07-15
Real map (`react-native-maps` — works in Expo Go, the old "needs a dev build"
note was wrong), pin picker at onboarding + Profile edit (owner), haversine
distances, locate-me FAB, navigate-to-salon. Still open:
- **Android production build needs a Google Maps API key** in app.json — only
  when we ship a store build; Expo Go needs nothing.
- **Walking ETA is straight-line × 12 min/km** — a routing API if it bites.
- **Legacy salons have no pin** until the owner sets one in Profile → Your
  profile; they show in the carousel but not on the map.

## Wishlist  → heart button on Explore cards
- Toggling does nothing yet. Needs a `wishlists (customer_id, salon_id)` table +
  RLS, and a Wishlist tab (mockup shows one; we kept Bookings in the 5-tab slot).

## Promotions  → "5% OFF" badge on Explore cards
- Hardcoded label. Needs a `promotions` table (salon_id, percent, validity) and
  application to the deposit/price once a payment rail exists.

## Filters  → filter button next to search — PARTIAL 2026-07-15
- Rating / distance / starting-price filters are live (bottom sheet).
  Still out: gender + category — those fields don't exist on services/barbers yet.

## Reminders  → "Remind me" toggle on booking cards (My Bookings)
- Removed for now; belongs with **push notifications** (Expo push tokens + a DB
  webhook on booking/message insert). Whole push increment is still TODO.
- **URGENCY UP (2026-07-15):** bookings now need barber approval (0015 reversed
  0005's instant-confirm — customer requests start 'pending'; barber accepts /
  declines / reschedules). Without push, barbers only see requests when they
  open the app and customers wait blind. Push should be the next increment.
  Pending requests hold the slot and die silently at start time (rendered as
  expired; no cron). Per-barber "instant book" toggle deferred until asked for.
- **URGENCY UP (2026-07-18):** Calendar drag-and-drop + Reschedule (barber side,
  `CalendarScreen.tsx`) let a barber move a client's appointment in two taps.
  `reschedule_booking` updates the same row the customer reads (`MyBookingsScreen`
  reloads on tab-remount, so the new time isn't stale) and auto-inserts a chat
  message ("Your booking was moved to …") — but that's silent right now: no push,
  and `ChatsScreen.tsx` has no unread badge yet (`TODO(backlog): real unread —
  nothing marked unread yet`). A customer only learns their appointment moved by
  opening My Bookings or Chat on their own. Minimum fix once push lands: send a
  push on every `reschedule_booking` call (same webhook as the pending-request
  case above) — the chat message can stay as the in-app record. Until push
  exists, the honest floor is the chat message; do not skip it or move a booking
  without one.

## Barber dashboard  → `src/screens/BookingsScreen.tsx` (dark mockup, 2026-07-15)
Built to the provided dark dashboard mockup. Real: daily earnings + 7-day bars
(booked value of confirmed bookings — a proxy until money actually moves in-app),
today/capacity + walk-ins tiles, Clock Out (= today day-off toggle), bell → pending
requests, avatar → Profile (now also hosts My Services / My Work). Placeholders:
- **Tips tile** — no tips concept; needs the wallet/payment rail (Phase 2).
- **Inventory chip** — product stock (pomade/blades) tracking; whole feature TODO.
- **"Start" button / check-in flow** — DONE 2026-07-17 (0018): full lifecycle on
  the schedule cards (Confirm → Check in → Start → Complete) via
  `checked_in_at/started_at/completed_at` timestamps + `advance_booking` RPC;
  status stays 'confirmed' so nothing else changed. Completion opens a review-ask
  sheet (chat + SMS composer). Still open: an elapsed-service timer on the
  "In chair" card, and the **one-tap review link** — needs the `brber.ma` web
  surface (adoption bet #1); until then the ask is a chat/SMS message pointing
  at My Bookings → Rate.
- **LIVE badge** — decorative; becomes real with Supabase Realtime on bookings.
- The swipe request-deck was replaced by the bell → requests sheet (mockup has no
  inline deck). Re-add if barbers miss it.
- **Clients tab** — client book v1 shipped (visits/no-shows/stars/last-visit from
  booking history; walk-ins grouped by name). Still TODO from the bet: preferences
  notes + informal debt ledger ("owes me 50 DH").

## Schedule editor  → `src/screens/AvailabilityScreen.tsx` (dark mockup, 2026-07-16)
Lives in **Profile → Schedule settings** (moved off the Calendar tab 2026-07-18).
The editor = accepting-bookings switch, weekly hours, time-off blocks. The
**Calendar tab is now a read-only day/week view** of the books (`CalendarScreen`,
2026-07-18); the walk-in day timeline stays in `DayScheduleScreen` (tab-bar +
FAB, dashboard). Backend: 0016 (`barbers.accepting_bookings`, `days_off.label`,
`time_blocks`).
Still open:
- **Calendar tab filters** — show/hide Appointments / Breaks / Time-off DONE
  2026-07-18 (funnel toggles a chip row; applies to the day timeline). Filtering
  *by service or by booking status* is still open.
- **Appointment NOTES** — the mockup's per-appointment note ("Prefers a #2
  guard…") needs a `bookings.notes` column; part of the client-book bet. The
  Calendar appointment sheet marks a TODO where the NOTES card goes.
- **Editing a break from the Calendar sheet** sends you to Schedule settings;
  inline time-block editing would need an edit sheet on the Calendar tab.
- **Vacations are stored as one `days_off` row per day** — the list shows them
  individually, not grouped as one "Vacation Jul 21–28" row. Group when it annoys.
- **Breaks recur every day** (not per-weekday like the mockup's "Every weekday");
  add a weekday mask to `time_blocks` if a barber asks.
- **SlotPicker stays light-themed** inside the dark reschedule sheet.
- **WalletScreen still light** — shared with the customer side; darken with the
  wallet increment.

## Owner: salon management  → `src/screens/SalonScreen.tsx` — REAL 2026-07-20 (0025)
Owner-only. Lives in **Profile → Salon management** (a menu row gated on
`ownsSalon`) — *not* a bottom tab, so Clients stays in the bar. TEAM / SERVICES /
SETTINGS segments over a shared shop-header. Backend = migration 0025:
`barbers.{salon_role, salon_status, pay_model, commission_pct, rent_cents,
chair_label}` + `salons.{cash_agent_id, default_commission, accepting_bookings}`,
owner-only RPCs (`salon_team`, `salon_stats`, `salon_set_terms`,
`salon_approve_member`, `salon_remove_member`, `salon_set_cash_agent`).
**Done & wired:**
- **Staff** — team list; **approve / decline** pending join requests; remove
  member; set pay terms (rent/commission + split); **cash-agent 👑** picker. The
  join-approval **hole is closed**: a BEFORE UPDATE trigger forces `salon_status =
  'pending'` when a barber sets `salon_id` to a salon they don't own, and the three
  public salon queries (Explore/Discover/Preview) now filter `salon_status =
  'approved'`, so pending joiners don't show under your reviews.
- **Stats** — `salon_stats()` returns shop-level aggregates only; `salon_team()`
  returns per-barber revenue **only for commission barbers** (rent → NULL), so the
  privacy rule is enforced server-side, not in the UI. Presence (in_service) is
  derived from today's bookings; on-floor = approved members accepting bookings.
- **Services** — real per-barber `services` (live toggle inline; Manage → Profile →
  My Services for add/edit). Default commission (Settings) writes `default_commission`.
- **Chairs** (0026) — real `chairs` table (`salon_id, label, barber_id?, sort`), one
  barber per chair (partial unique). CHAIRS tab = at-a-glance availability grid
  (open / in-service / off / empty, derived) + assign/rename/delete via owner RPCs
  (`salon_chairs`, `salon_add_chair`, `salon_rename_chair`, `salon_delete_chair`,
  `salon_assign_chair`). Chairs are now the source of truth for the chair label —
  `salon_team()` reads it off this table, so `barbers.chair_label` (0025) is vestigial.
- **Opening hours envelope** (0028) — Settings → Opening hours sets
  `salons.{open_min, close_min}`; a trigger on `availability` rejects any barber
  weekly-hours row outside it (so shop 09:00–23:00 → a co-barber can pick 10:00–21:00
  but not 08:00). AvailabilityScreen shows the window, clamps the +/- steppers, and
  validates on save. **Default is all-day (0–1440) = no limit** so existing one-man
  salons aren't retro-clamped; narrowing later doesn't trim rows already saved wider
  (applies on next edit). Not enforced in the booking path directly — availability is
  the gate, and it's now envelope-bound at write time.
- **Shop open/closed** — header power button writes `salons.accepting_bookings`.
  NOTE: nothing **enforces** it in the booking flow yet (like the per-barber
  `accepting_bookings`) — wire the check when the request path is next touched.
**Still blocked / deferred (can't build now, not laziness):**
- **Saved-gap alerts have no sender** (EXPL-28 §6) — `push_saved_gap` (0065) is
  written by SavedScreen and read by `my_wishlist`, and *nothing sends a
  notification that reads it*. The ask card was cut and the switch's "about one
  a week" line with it, so the app no longer quantifies a promise nobody keeps.
  Two ways out, both real: fold saved-barber customers into
  `offer_candidates` (0049) — cheap, but the promise becomes "a barber can
  offer you his gap", not "you'll be told about gaps" — or build an
  automatic same-day cancellation fan-out. **Trigger:** either path ships →
  restore the ask, and flip the column's default to `false` with it.
- **Nothing ever un-suspends a salon** (EXPL-26 §3) — `salons.status` is set to
  `'suspended'` in 0058 and 0061 and *never back to `'live'` by any function*,
  so "TELL ME IF IT REOPENS" was cut: there is no event to hang it on.
  `reopen_shop` (0064) is the owner's own `accepting_bookings` pause, a
  different switch. Note also that `waitlist_requests.day` is `not null` and
  `reopen_shop` filters `day >= today`, so a reopen-ask has no honest day to
  carry. **Trigger:** an ops un-suspend path exists → the ask can ship on it.
- **Saved never says "next free Fri 14:00"** (§4) — `barber_next_free_today`
  scans today only, on purpose (0065 says why). `LATER THIS WEEK` therefore
  shows static facts, not a forward-looking time, and no salon claims a slot
  count. **Trigger:** someone wants the multi-day scan → price it before
  redrawing the section.
- **Packages** — Services tab shows a placeholder; needs the `packages` /
  `package_items` tables + the pending booking-mapping decision (Salon screen §).
- **Invite by phone / share link** — the sheet is UI-only; real self-onboarding
  needs the `brber.ma` web surface (adoption bet #1). Today's real path: barber
  signs up → picks the salon at onboarding → appears here as pending → owner approves.
- **Barber earnings statement** (0027, REAL) — member sheet → "Earnings & payouts"
  opens a per-barber weekly **commission accrual** derived from bookings
  (`salon_barber_earnings`): gross → barber share → shop cut, with total
  **outstanding/unsettled** up top. Rent barbers show **rent due**, no revenue
  (privacy). This is an accrual, **not** a settlement — deliberately no "paid"
  state, no invoice record, no `payouts` table.
- **Settlements / invoices / paid status** — the blocked half of payouts. Needs
  real money movement (Phase 2 settlement rail) before any payout can be marked
  paid or an invoice generated; the earnings screen shows an honest empty state.
- **Payouts & taxes (salon-level), Reports, Roles & permissions** — Settings rows
  still Alert. Payout schedule/tax config need the rail; reports/permissions post-launch.
- **Cash agent ≠ top-up rights yet** — `salon_set_cash_agent` records the choice,
  but `agent_cash_topup` (0022) + the Wallet tab are still owner-only. Honor
  `cash_agent_id` there when a co-barber agent is actually needed.
- Removing a member sets `salon_id = null` (unlinked), not a fresh solo salon —
  give them one back if that edge bites.

## Agent wallet (salon till)  → `src/screens/AgentWalletScreen.tsx` — REAL 2026-07-19 (0022)
Owner-only — the barber **Wallet tab**, which only appears for the salon owner
(gated on `salons.owner_id`; owner = the v1 cash agent). Co-barbers see just
Home / Calendar / Clients — no Wallet tab (decided 2026-07-19; their personal
wallet has no home yet — revisit when barbers can hold a balance). UI = Float
Balance + Activity + Top-up (trimmed from the "Blade" shots; localized to DH).
**Real since 0022:** `wallet_transactions` ledger (RLS: customer sees own rows,
agent sees his till; no direct writes) + `agent_cash_topup` RPC (owner-only,
phone lookup on trailing 9 digits, flat 5,000 DH per-top-up cap). Float =
sum of the till's top-ups; activity = real rows; receipts (`expo-print`, per-row
+ offered after each top-up) carry the real transaction ref. Customer side:
`WalletScreen` balance + transactions read the same ledger; its fake Add-Money
flow was deleted (button → "top up with cash at your barber" until the card
rail). **DECIDED: commission = 0%** — instant liquidity is the agent's reward;
tier/bonus/commission UI removed. The fake "Insured by brber Agent Guarantee"
and "SMS confirmation" copy was deleted too.
Still open:
- **Settlement / netting / the float cap — DONE 2026-08-06 (0042, 0044)**, from the
  admin side: `float_settlements` + `salon_{float,owed,net,gap}_cents()` +
  `admin_settle_float()` (both directions), and `salons.float_cap_cents` now caps
  **outstanding net** instead of each top-up — the swap 0022's comment asked for.
  See "Admin console" for what each number means and what is still deliberately out
  (forfeited deposits are not counted as owed to the shop).
- **Card rail** (YouCan Pay) → customer Add-Money returns then.
- **Spending the balance** — bookings can't be paid from the wallet yet; that's
  the deposit/coupon unlock in the Payments bet.
- **Scan-QR tab is still mock** — needs `expo-camera` + a customer-side QR.
- **Cash-out** stays cut (top-up-only; would need customer withdrawal codes).
- **Other-than-owner agent** = `salons.cash_agent_id` picker (Salon-management
  plan); don't widen the gate ad hoc. Aggregate/paginate the till query when a
  till has thousands of rows (client sums today).

## Salon screen  → `src/screens/SalonDetailScreen.tsx`
- **Packages → BUNDLES, REAL 2026-08-07 (0047)** — see "Bundles" below. The
  DECISION PENDING ("how a package books against one barber + calendar slot") is
  closed: turn 34 answers it — one booking, one barber, one sitting, n services.
- **Intro video** — hero play button is a placeholder; needs a `video_url` on salons + `expo-av`.
- **Website / Direction / Message actions** — Website opens `salons.website` if set (added
  in 0013); Direction opens the device maps app (done 2026-07-15); Message needs a
  booking-scoped chat entry.
- **Distance/ETA** — real when opened from Explore; hidden when unknown (no user
  location, no salon pin, or opened from Home which doesn't pass a distance).
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

## Sterncut auth & onboarding  → `AuthScreen.tsx`, `IntroScreen.tsx`, `OtpScreen.tsx` (2026-07-22)
Customer design doc (claude.ai/design "Customer App") implemented: app renamed
**Sterncut** (app.json name; slug stays `brber`), first-run intro carousel, welcome
with social sign-in, email sign-in, register. Email/password and OAuth are both real.
- **Google / Apple sign-in** — REAL 2026-09-08 (`src/lib/oauth.ts`). Supabase
  `signInWithOAuth` + `expo-web-browser` auth session, redirecting back into the
  app via `Linking.createURL("/auth")` (`scheme: sterncut` in app.json); the
  tokens come off the fragment into `setSession`. The same call signs up a
  first-timer — the 0010 trigger gives them a profile. **Dashboard config is
  required before it works:** enable Google and Apple under Auth → Providers, and
  allowlist `sterncut://**` plus the Expo Go URL (`exp://<LAN-IP>:8081/**`) under
  Auth → URL Configuration. Still open:
  - **The Apple client secret expires every 6 months.** Supabase's "Secret Key"
    is a JWT signed with the `.p8`, not the key itself; when it lapses Apple
    sign-in fails silently. Trigger: 6 months after the provider goes live —
    regenerate from the stored `.p8` (Team ID + Key ID + Services ID
    `com.sterncut.app.web`) and paste it back in.
  - **Provider users have no phone.** Google/Apple hand over a name and an email,
    never a number, so the profile lands with `phone` null and the barber has
    nothing to call. Trigger: the first booking made by an OAuth account — ask
    for a phone after first sign-in, or block booking until there is one.
  - **Apple is the web flow, not native.** Acceptable for App Store review, but
    iOS gets a browser sheet instead of the Face ID sheet. Trigger: shipping to
    the App Store — `expo-apple-authentication` + `signInWithIdToken`, dev build
    only (never Expo Go).
  - Implicit flow, not PKCE: pkce would turn the emailed password-reset link into
    a code only the requesting device can exchange. Trigger: the in-app reset
    deep link below — do both at once.
- **Phone OTP** (`OtpScreen.tsx`) — full UI, NOT wired into register: Supabase
  phone OTP needs an SMS provider (Twilio) first. Register keeps email/password;
  the "we'll text a code" design copy was softened until this is real.
- **Forgot password** — sends the Supabase reset email; no in-app deep-link
  reset flow yet (link lands on the site URL).
- **Register keeps a discreet "Join as a barber" link** — the design dropped the
  role picker (customer-only doc) but barbers still need to sign up in-app until
  the `brber.ma` web surface (adoption bet #1) exists.

## Admin console  → `admin/index.html` — REAL 2026-08-06 (0041–0043)
Design doc "Admin Dashboard.dc.html". A static web desk, **not** part of the Expo app
— plain HTML/CSS/JS opened in a browser (`npx serve .` → `/admin/`), because the
design is a 1400px browser console and the app has no web target (no
`react-native-web`/`react-dom` installed). All 9 screens: Overview (1a), Salons (1b),
Bookings (1c), Wallets & float (1d), Support (1e), Salon approval (1f), Reviews +
flagged review + removal dialog (2b/2a/2c). Hash routes (`#/salons` …), sidebar and
drill-downs are real, and **every figure comes from Supabase** — no fixtures left.
Sign-in is email/password against the same project; copy `admin/config.example.js` to
`admin/config.js` (gitignored) for the URL + anon key. **Only the anon key** — every
query is gated on `profiles.role = 'admin'` inside the DB, so a service-role key in a
browser is never needed and must never be pasted there.
**Making an admin:** the role has existed since 0001 and cannot be self-assigned
(`handle_new_user` only writes customer/barber). From the SQL editor:
`update public.profiles set role = 'admin' where id = '<uuid>';`
**Backend (0041 enum value · 0042 writes + schema · 0043 the 9 read RPCs):**
- **Reviews moderation** — `reviews.{state, removal_reason, customer_note,
  moderated_at, moderated_by}` + a `review_actions` audit row per decision.
  `review_flag` (0031) now parks a review in `state='held'` instead of only
  date-stamping it; `admin_review_decide()` keeps or removes it, **refuses a removal
  without a policy reason** (2c's rule, enforced in the DB), and notifies both sides.
  Removed reviews drop out of `reviews_select` for everyone but their author and us,
  so every rating average excludes them for free.
- **Platform shop approval** — `salons.{status, submitted_at, reviewed_at,
  reviewed_by, review_note}`. **BEHAVIOUR CHANGE: a newly created salon is now
  `pending` and invisible in Explore until an admin approves it** (existing shops were
  grandfathered `live`). `admin_salon_decide()` enforces 1f's "approve is locked until
  the map pin is confirmed". The 5-item checklist is derived, never stored.
- **Agent float settlement** — **TRIGGER PULLED** on the Agent wallet item below
  ("Settlement/netting … first thing to build when real cash volume appears").
  `float_settlements` + `salon_float_cents()` (= cash_topups at that till − collected)
  + `admin_settle_float()`, capped at what the shop is actually holding. Bookkeeping,
  not a payment rail — same nature as 0022's top-ups, nothing debits. This is the
  **platform↔agent** half; 0031's `salon_settlements` (owner↔barber commission) is
  untouched and unrelated.
- **Support console** — 0038 said "replies and resolutions come from the service role
  until support volume earns a UI". `admin_support_reply()` /
  `admin_support_resolve()` are that UI's backend; the refund credits the customer's
  wallet for real. `wallet_transactions.created_by` was repointed from `barbers` to
  `profiles` so an admin can issue one.
**Netting, the cap and the count — 0044:**
- **Netting** — a settlement met only cash collected, never what we *owe* the shop.
  `salon_owed_cents()` = deposits customers paid us for cuts the shop has already
  delivered, less refunds, less payouts; `salon_net_cents()` = float − owed is the
  one number a settlement run is about. `admin_settle_float()` now points both ways:
  a **negative** amount is a payout to the shop (same trick as 0035's negative wallet
  rows — one table, sum is the truth). **Forfeited deposits (no-show, customer
  cancellation) are deliberately excluded from "owed"** — who keeps those is an open
  product decision and a settlement function must not make it by accident.
- **The float cap is real** — `salons.float_cap_cents` (default 5 000 DH, per shop)
  caps **outstanding net**, not each top-up, which is what 0022's comment promised.
  `agent_cash_topup` refuses the top-up that would cross it and says how much to
  settle. No UI to raise a shop's cap yet: it's a column, set it in SQL.
- **The declared drawer** — `float_settlements.{expected_cents, declared_cents}`.
  The console asks one number, the one the admin actually has: *what did you count*.
  Short of the books → the difference is recorded as the gap, and "UNRECONCILED"
  finally means the design's "logged 3 200, declared 2 880". Expected subtracts the
  gap already known, so a missing 320 DH is not counted short again at every
  settlement. A count with nothing collected is a valid row — that's how an empty
  drawer gets on the record.
Still open here:
- **Barbers / Customers / Coupons** — sidebar rows with no screen in the doc; left
  inert rather than faked. Coupons data exists (0038), the admin view doesn't.
- **Search, filters, export and paging are client-side** (0044): the three search
  boxes, the salon/booking filter chips, the Today↔30-days toggle, salon paging, and
  CSV export of salons / reviews / the ledger all run over the rows already fetched.
  Right at a city's scale; when one fetch stops holding a list, push `q`/`page` into
  the RPC — the render functions already take whatever the fetch hands them.
  Still static chrome: the ⌘K global search, date-range pickers, bulk select.
- **Median wait (1a) = minutes until your slot**, not how late the barber is running —
  same honest limit as the queue ETA. Lateness data (`started_at` vs `starts_at`) is
  accruing; switch when it's worth it.
- **No realtime.** The desk loads on navigation; a settlement or a decision reloads
  its own screen. Poll or subscribe when two admins work the same queue.
- **Sidebar counts** (Barbers, Customers) are the design's numbers on screens that
  don't fetch them; Salons/Support/Reviews are live.
Deviations from the doc, on purpose: the browser-window chrome is dropped (a real
browser provides it), 1f's four `<image-slot>` photo wells became the application's
**services** (a shop photo bucket exists per salon, but nothing uploads to it at
signup yet), screens are `100vh` instead of a fixed 852px, and 2c's blurred backdrop
is the actual 2a screen behind a blur instead of a painted stand-in.

## Support consoles + review appeals — REAL 2026-08-06 (0045)
Customer turns 30–32 of "Customer App 3.dc.html" and barber turns 5–6 of
"Barber App.dc.html" — the two ends of the desk 0042/0043 built. The whole chain
now runs: ops removes a review → the customer is told and appeals once → a second
reviewer decides → the barber is told the outcome → he answers in public → the
reply shows on his page.
- **Support console, both apps** — `SupportHomeScreen` (30a, warm) and
  `BarberSupportScreen` (5a, dark) live on **Profile → Help & support**; the old
  FAQ screen is one tap deeper. `my_support_cases()` returns the list with a real
  unread count (`support_cases.user_read_at`), `file_support_case` now accepts the
  **barber** of a booking as well as its customer, and `admin_open_case()` lets ops
  start a thread — 5b is a case Youssef never filed. Barber reasons (booking /
  money / client / app) joined the customer's five.
- **Appeals (31)** — `review_appeals`, one per review, author-only, only on a
  removed one. `ReviewTakedownScreen` is 31a/31c/31d in one screen driven by the
  row's state, `AppealScreen` is 31b. **The barber never sees that an appeal
  happened** — RLS on `review_appeals` excludes him and `admin_decide_appeal()`
  only tells him the outcome. That asymmetry is the point of the turn.
- **Public reply (6c → 32a)** — the composer posts through `review_reply()`
  (0031, already there); `BarberDetailScreen`'s Review tab renders it under the
  review it answers. Removed reviews never reach the tab — `reviews_select` (0042)
  hides them from everyone but their author.
- **Deciding an appeal** ships with it, because an appeal nobody can decide leaves
  31c waiting forever: a bar above the admin console's Reviews list. That is
  **beyond the admin design**, which predates appeals — replace it with a real
  screen when appeals are more than a couple a week.
Still open here:
- **Help articles are stubs.** The five rows in 30a/5a alert; the real FAQ content
  is in `HelpCenterScreen`. Wire the rows to it (or to a `help_articles` table)
  when someone writes the articles.
- **CALL US / CALL OPS dial a placeholder number** (`SUPPORT_PHONE` / `OPS_PHONE`).
- **Photo attachments on the barber's report (5c)** — the sheet says the check-in
  log is attached, which is true (ops reads it off the booking); an actual image
  upload is customer-side only for now.
- **6a's action card closes (0046)** — `review_appeals.action_done_at`, ticked off
  by the shop itself (`complete_review_action`, barber-only). Overdue turns the
  card red, and the admin console lists every outstanding ask above the Reviews
  table so "move the poster" stops being a sentence in a notification nobody
  chases. No reminders on it: ops sees the list, that is the whole mechanism.
- **31d's "late-arrival flag cleared" is real (0046)** — see "Late-arrival marks".
- **Tag filtering on the reviews tab (32b)** — the doc says it needs a tags column
  the schema deliberately doesn't have. Search over text/barber/customer is live.
- **No push on any of it.** `moderation` notification rows are written (0041) and
  land in the in-app inbox; the banner needs the dev build like everything else.

## Late-arrival marks — REAL 2026-08-06 (0046)
**BACKLOG TRIGGER PULLED (partly):** Phase 1 said "fight no-shows with
*reputation*, not deposits — strike system, reliable-client badge, booking
priority". 31d's "your late-arrival flag is cleared — deposits back to 40%"
needed the first rung of that ladder, so here it is — **one rung, not the ladder**.
- `customer_marks` — a platform-level mark, one per booking. Raised by a trigger
  when a check-in lands **more than 15 minutes** after the slot (the same
  `checked_in_at` the moderation desk reads, so the mark and the evidence can
  never disagree). `client_flags` (0030) was the wrong home: that table is
  private to the barber forever and this one is shown to its owner.
- The consequence is one number: `customer_deposit_pct()` returns **100 instead
  of 40** while an uncleared mark is under 90 days old, and `fill_booking`'s floor
  reads it. The refusal names the date and the day it expires rather than quoting
  a percentage at someone who has no idea where it came from.
- An **upheld appeal withdraws the mark** on that booking (0046's
  `admin_decide_appeal`) and the notification says so.
Still open:
- **90 days and 15 minutes are guesses.** Nothing has tuned them against real
  arrivals; they are two constants in `customer_deposit_pct` and
  `mark_late_arrival`.
- **The rest of the ladder is still unbuilt**: no strikes, no reliable-client
  badge, no booking priority, no no-show mark (a no-show is already a booking
  status; whether it should also cost the customer is undecided).
- **Nothing surfaces the mark before it bites.** A marked customer learns about it
  when the booking sheet refuses a 40% deposit. A line on the profile — "full
  payment until Oct 12" — is the honest fix.
- **`client_flags.require_full_payment` (0030) is still display-only.** The
  barber's own "pay up front" flag does not reach `fill_booking`; only the
  platform mark does. Wire it the same way if a barber asks.

## Bundles  → `src/components/Bundles.tsx` — REAL 2026-08-07 (0047)
Turn 34 of "Customer App 3.dc.html". Turn 33 drew option (b), the prepaid pass;
the call was **(a), the one-visit bundle**: n services, one barber, one sitting.
- **Schema** — `bundles` / `bundle_services` / `booking_services`, plus
  `bookings.{bundle_id, duration_min, settled_at}`. `service_id` stays NOT NULL as
  the **anchor** (first service) so every existing consumer — queue, calendar,
  earnings, receipts, admin — keeps working untouched.
- **34a** Bundles tab on the salon page (featured dark card + list + "Build your
  own"). **34b/34c/34d** a three-step sheet: tick services → find a slot that
  holds the whole sitting → overview + deposit. **34e** the My Bookings card
  renders the running order with per-service start times. **34f** the barber
  ticks off what he did; a half-taken bundle reprices to its parts and loses the
  saving (`settle_booking_services`).
- **"Build your own" is an ad-hoc bundle** (`bundles.is_adhoc`) priced at the sum
  of its parts — one booking path, not a second rail.
- **The ordinary booking sheet is multi-select now (2026-08-11, 0067).** Picking
  several services was only reachable through the salon page's Bundles tab; the
  main sheet let you pick exactly one cut. `BookingSheet`'s first step is a tick
  list, and **the backend needed almost nothing** — n services in one sitting is
  what `book_custom` (0047) has always done, so the sheet routes to it above one
  service and keeps the plain insert at one, rather than minting a one-item
  bundle for every booking in the app.
  - **The barber step now requires the WHOLE sitting.** A barber who does two of
    the three ticked services is not a shortlist candidate, so
    `offeringBarbers` switched from `some` to `every`, and the step says so when
    nobody in the shop can take the combination.
  - **0067 exists because `book_custom` carried neither the note nor the
    coupon.** Ticking a second service would have silently dropped the note the
    customer had just written in 39d — the exact bug class barber 11 and
    customer 39 were about. Both functions were **dropped and recreated** rather
    than given defaulted arguments: 0057 is the standing lesson that a second
    signature makes PostgREST refuse the call outright.
  - **The Services/Packages chips are deleted.** "Packages are coming soon" had
    been false since 0047, and ticking several services *is* what that chip was
    promising. Priced bundles stay on the salon page, where a real saving can be
    shown against the sum of the parts.
  Still open:
  - **The summary shows the sitting as "Fade + Beard", not a priced breakdown.**
    Per-service lines with start times already exist on the My Bookings card
    (34e), so the customer sees the running order once it is booked.
- **34c needed no backend**: `daySlots()` already takes a duration, so "N fit"
  and the three-in-a-row grid are pure client math (`lib/slots.ts`).
- **Bundle editor (barber turn 7), REAL 2026-08-07 (0048)** —
  `src/screens/BundleEditorScreen.tsx`, on **Profile → My Bundles**, next to My
  Services because a bundle is made of them. 7a the list (live/hidden toggles,
  reorder, the "same services as your own X DH service" warning), 7b the editor
  (service picker, price with the **% off he is choosing to pay**, giving-away
  and chair-time breakdown), 7c **"Before you publish"** — a full day of bundles
  against a full day of single cuts, computed from his own hours and buffer.
  7c's two brakes are real columns enforced in `fill_booking`:
  `bundles.{max_per_day, morning_only}` — a cap only the editor honours would
  still lose the race to the customer's booking sheet.
Still open:
- **Only the dashboard raises 34f.** Completing from the Calendar or the day
  timeline defaults to "everything was done" (a trigger stamps `done_at`), which
  is right for the common case but never offers the reprice. Wire the sheet into
  those two if barbers complete from there and clients skip services.
- **34e's "There's one on Monday"** is not built — naming the next day that fits
  needs a slot scan the card doesn't load. It says how big a gap is needed.
- **Reorder is tap-⇅, not drag** (7a says "drag to reorder"). A real drag list is
  a new dependency for a list two or three rows long; the on-screen label says
  what it actually does. Swap if a barber ever has ten bundles.
- **7c can't name the window.** The design says "09:30 – 19:00"; `my_bundles()`
  returns the longest window's *length*, so the sheet says how much chair time
  instead. Return `start_min` too if the edges matter.
- **0047 + 0048 are applied (2026-08-07) and verified live** — all 12 objects
  answer over PostgREST, and applying them means their `do $$ assert $$` blocks
  passed (0047's bundle/deposit money maths, 0048's 7c day maths). The JS half is
  checked too: `npm run check` runs `src/lib/slots.check.ts` (no framework, no new
  dep) and pins 7c's day maths and 34c's three-in-a-row rule to the drawn numbers.
  **Not yet exercised end to end:** the probe ran as anon, so the triggers
  (`fill_booking`'s bundle branch, `fill_booking_services`,
  `default_settle_on_complete`) and the authenticated RLS paths still want one
  real booking through the app.

## Cancellations — customer turn 35 + barber turn 8, REAL 2026-08-07 (0049)
Two ends of one story: the customer cancels (35), Youssef is left with a hole (8).
- **35 is complete** (`MyBookingScreen.tsx`). The picker was already there (10a);
  what was missing was everything round it. **35a** gives "Other" a free-text box
  with the barber named and a 140-char counter, and a Skip that clears it — an
  "Other" with no words is sent as no reason at all. **35b** is the *withdraw*
  variant for a still-pending request: calm grey instead of the accent warning,
  "Nothing was charged", wallet before/after, ink CTA. **35c** is the receipt —
  cancelling used to pop straight back to the list with no record.
  The reason stays **optional chips** on both, deliberately asymmetric with the
  barber's required radio rows: nobody owes a shop an explanation.
- **Turn 8's rail (0049), under all of 8a–8i.** `waitlist_requests`
  ("asked about today" — 8d's green ASKED badge; the other three candidate kinds
  derive from the book), `slot_offers` + `slot_offer_targets`, and
  `offer_candidates` / `create_slot_offer` / `claim_slot_offer` /
  `decline_slot_offer` / `my_slot_offers` / `cancellation_stats`.
  An offer **never holds the slot** — 8d's "first to tap it gets it, nobody else
  is charged or held" — so the claim goes through the ordinary booking insert and
  `no_double_booking` (0001) is what actually settles the race.
- **Turn 8's UI is built too (2026-08-07).**
  - **8a** — `cancel_booking` never told the barber anything: the `cancellation`
    kind existed since 0032 with nothing inserting it. An AFTER UPDATE trigger
    (`notify_customer_cancel`) now writes it, his words first, then what it costs
    the day. `push_dispatch` maps it to `BOOKING_CANCELLED`, whose Reply / Offer
    the slot buttons both open the app — neither can be resolved from a banner.
  - **8b/8f** — `components/CancelledGap.tsx`, rendered inside **My day**
    (`DayScheduleScreen`). One component, two states: the hole (his words in a
    quote box, the deposit that stays, the dashed freed slot with OFFER IT /
    TAKE A BREAK, the waiting-list row) and, once taken, 8f's green banner plus
    the booked-today / kept-deposit pair. TAKE A BREAK writes a `time_blocks` row
    so the slot stops being offered at all.
  - **8c** — `screens/CancellationsScreen.tsx`, on **Profile → Cancellations**.
    30-day counts, the reason histogram (bars relative to the top reason, "Other"
    ringed amber), and WORTH A LOOK over the written-in answers with a sheet that
    shows them verbatim.
  - **8d** — the offer sheet, in `CancelledGap.tsx`. Opens with the people who
    actually asked pre-ticked; anyone with 2+ no-shows is dimmed and cannot be
    selected, as the design draws.
  - **8e** — `components/SlotOfferSheet.tsx`, mounted in `App.tsx` above every
    customer screen because the countdown doesn't care what screen you're on.
- **The ask — customer turn 36 + barber 8g/8h/8i, REAL 2026-08-07 (0050).**
  This closes the hole 0049 left: 8d ranked candidates by evidence of wanting the
  slot and put a green ASKED at the top, but nothing ever recorded an ask.
  - **36a** is the **full-day state of the slot picker** (`SlotPicker` gained a
    `renderFull` prop, so the ask lives exactly where the design puts it — the
    moment you want a day and can't have it). Earliest-time chips, an
    "any barber at &lt;shop&gt;" toggle, and copy that never implies a queue place.
  - **36b** says back what was recorded, including when it expires and the honest
    part: a freed slot can go to several people at once.
  - **36c** is the ASKS section under My Bookings → Upcoming, with cancel and an
    expired state.
  - **8g** "Nobody took it" — the offer ran out and the slot is still his problem:
    open it to everyone, ask someone else, or make it a break.
  - **8h/8i** `screens/WaitingListScreen.tsx` on **Profile → Waiting list**: day
    chips, asks grouped by day, and an OFFER button that only appears when a slot
    is actually free *and* clears that person's earliest-time. 8i's empty state
    explains that asks only happen on days with nothing left.
  - 0050 also **teaches `offer_candidates` the real shape** — it keyed on
    (barber, day) and knew nothing about `earliest_min`, any-barber asks, or
    `status`, all three of which change who legitimately shows up as ASKED.
Still open here:
- **8b's "he messaged you and you didn't reply" nudge is not built.** It needs a
  median-reply-time read over `messages`, which no RPC exposes yet.
- **8c's insight text is generic.** The design reads "3 of the 4 Other answers
  mention a message you didn't reply to" — matching *why* they cancelled against
  chat history. Ours says how many wrote in and points at them, which is honest
  without pretending to have done the correlation.
Both closed (2026-08-08), with 0051:
- **Asks now expire.** `expire_stale_asks()` flips a past-day `waiting` row to
  `expired`. It is scheduled hourly when pg_cron exists (same conditional shape
  as 0037's reminders) *and* called from `ask_for_day`, so the sweep happens on
  this project whether or not the extension is ever enabled. Nothing on screen
  changes — every read path already ignored past-day asks; what it fixes is a
  status nothing ever left and the indexes that only cover live asks.
- **8b's "Tell your waiting list" card now opens 8h**, carrying the freed slot
  with it. That slot is what makes each row's OFFER button mean anything —
  `create_slot_offer` is anchored to a booking somebody walked away from, so
  without one in hand the button had nothing to send. Arriving with a slot also
  fixes a label that would have lied: 8h sized OFFER from the day's *first* free
  time, which is rarely the cancelled one. The chosen person lands pre-ticked in
  8d rather than the sheet opening blank.
- Same commit fixed the card's own counter: it read `waitlist_requests` directly
  on `(barber_id, day)`, which after 0050 both misses any-barber asks and counts
  cancelled ones. It calls `barber_waitlist()` now.
- **Making room — barber 8j/8k/8l, REAL 2026-08-09 (0052).** The design answered
  the question the previous entry left open, and answered it bigger: 8j names the
  rule every offer screen had been assuming. **An offer anchors to a real gap in
  the day.** A full day has no gap, so on one there is nothing to offer and the
  only honest move is to make one.
  - **One concept carries all of it.** A `time_blocks` row with `kind = 'open'` is
    a block turned inside out: instead of taking time away it gives it back, on
    one date, outranking the weekly hours, the breaks *and* the buffers — he
    weighed all three when he chose to make room. The one thing it never outranks
    is a booking: room he made can still only be taken once. That single row
    covers all three of 8k's sources, which is why 8k can promise "your usual
    hours don't change" — nothing recurring is edited.
  - `fill_booking` carries the same exemption and `daySlots` reads the same rows
    the same way, so the phone and the trigger agree on what is bookable. Picking
    `time_blocks` for this was the whole trick: **every** slot computation in the
    app already loads that table, so a made slot appears in the customer's picker,
    the calendar, the day screen and the owner view with no new plumbing.
  - **8j** is the Waiting list with nothing to give anyone: day cards headed
    `FULL · CLOSES 19:00`, two named asks and the rest on one line, and either
    MAKE ROOM or — when every source has already passed — "Too late to open
    anything today" with a message button. 8h's chips are dropped there: with
    nothing free anywhere, filtering to one day changes nothing.
  - **8k** is `makeRoomOptions()` in `lib/slots.ts`, so the arithmetic behind
    "3 can take it" is checkable and checked. The cleaning-time source is derived
    rather than guessed: it is the first slot that is free at buffer 0 and full at
    the real buffer, which is exactly what dropping the buffer would reveal.
  - **8l** is the offer sheet in made-slot mode — green strip saying what the day
    gave up, public toggle **off** by default (room made by hand is aimed at
    someone), and no "take the break instead", because the alternative to offering
    a slot he just made is not a break, it's nothing.
  - **`create_open_offer`** is the missing half of `create_slot_offer`: an offer
    with no cancellation behind it. It re-runs `fill_booking`'s checks minus the
    money, because an offer that cannot be claimed is worse than no offer.
    0052 also gives `offer_candidates` wording that reads right on a day that
    isn't today, and `barber_waitlist` a `last_booking` so 8j's message button
    has a thread to open.
  - This closes the previous entry's open item outright: **8h reached from Profile
    is now fully live** — it offers a day's own free slot when there is one, and
    makes one when there isn't.
- **Where admin actions land in the shop — barber turn 9, REAL 2026-08-09 (0053).**
  Turn 9's premise is that ops issues obligations and then counts the silence as
  non-compliance, because the barber never had a surface. Three flows:
  - **9a/9b** `screens/ShopTasksScreen.tsx` on **Profile → To do**. The turn note
    claims "same records, no new tables — a task is a row ops already writes",
    and that part was **wrong**: nothing in 0001–0052 wrote an obligation, so
    `shop_tasks` is new. Admin 5a writes to it rather than inventing a second one.
    A task always says what happens if it's ignored and when, and the barber can
    **answer** but never close one — a self-closing obligation is decoration.
    9b's proof carries the shop's location, because a poster photo without a
    place is a photo of a poster. Bucket `task-proof`, folder-name authorisation,
    same shape as 0007's chat-images.
  - **9c/9d** `screens/ApplicationScreen.tsx` on **Profile → Your shop**, the
    applicant's side of admin 1f. **Deliberate deviation:** the canvas draws four
    checklist items; this shows the same **five** `admin_approvals` (0043)
    actually approves against. Showing an applicant a list that isn't the one
    gating him would have him tick every box and still be refused. Only the pin
    row has a control — it's the only item he can satisfy from that screen — and
    it's a real `react-native-maps` pin, draggable, with "I'm at the shop".
  - **9e/9f** `screens/SettleFloatScreen.tsx` on **Profile → Settle up**, and the
    collector's round for `role = 'admin'`. The float rail already existed
    (0042/0044); what it could not do was let the two people in the shop agree a
    handover happened — the console just asserted a collection. One 12-hour code
    fixes it: he reads four digits out, she types them in, `agent_collect_float`
    refuses without them. Neither side can record a handover alone, and the code
    is what closes any open `float` task.
- **When it breaks in the shop — barber turn 10, REAL 2026-08-09 (0054).**
  The turn's rule is one line: **an error must never stop the queue moving.** He
  is mid-cut, one-handed, with someone in the chair, so none of these six is a
  modal that blocks the day and every one says what still works before what
  doesn't.
  - **The offline queue is the turn.** `lib/outbox.ts` is the pure half (types,
    the cash/retry arithmetic, conflict detection) with its own runnable checks
    in `npm run check`; `lib/sync.ts` is the half that touches AsyncStorage,
    NetInfo and Supabase. Marking a cut done and adding a walk-in both go through
    it, so neither waits on a round trip.
    *ponytail: one key, whole array, rewritten on change — a bad morning is three
    rows, not three thousand. SQLite when it outgrows a screenful.*
  - **10a** `components/Trouble.tsx` — the bar, the two counters, and the honest
    footer naming the only two things that genuinely need a signal. The day's
    timeline merges queued work so "TODAY · FROM MEMORY" is literally true: a
    walk-in he added offline is a row, a cut he finished is marked done.
  - **10b** is what `no_double_booking` (0001) feels like from the chair. The
    default is not "whoever I added" but **whoever paid**, said out loud at the
    bottom. A refused walk-in raises a bar on the day screen rather than sitting
    silently in the outbox — somebody is standing in the shop expecting that time.
  - **10c** hangs off the real `agent_cash_topup` failure path in
    `AgentWalletScreen`. Its whole job is "nothing was taken twice". The balance
    row is **omitted** when the call failed before we learned it — a confident
    `0 DH` next to the word "unchanged" would be worse than no row.
  - **10d/10e** need one fact nothing recorded: **when the licence runs out.**
    `id_document_path` said a licence had been seen, never until when, so nothing
    could count down and ops had no date. 0054 adds `barbers.licence_expires_at`
    and `my_standing()`, which both screens share because they are the same fact
    at two distances from the deadline. `submit_licence()` deliberately **does
    not un-hide the shop** — a barber who can lift his own suspension by
    uploading a photo has no suspension. Hiding stays with `admin_salon_decide`.
  - **10f** `screens/OutboxScreen.tsx`, reached from the offline bar. Only a job
    that can *never* send offers a Drop; dropping a retryable one is how work
    disappears silently.
- **Where the coupon lands — customer turn 37, REAL 2026-08-09 (0055).** 0038
  could claim and list coupons and nothing could **spend** one — no booking ever
  knew about a discount. Turn 37 is the missing half, and it carries an
  accounting decision rather than a label: *"comes off what you pay from your
  wallet — your barber still gets the full price."*
  - **`price_cents` does not move.** It is the barber's money, what Earnings
    totals and what settlements compute from. `bookings.discount_cents` is a
    second column that reduces what the **customer** owes; the platform absorbs
    it. A barber who thinks the app is quietly cutting his prices is the fastest
    way to lose a shop, which is why this is a column and not a smaller number.
  - The knock-on the canvas draws out loud: **the deposit floor follows
    `payable`, not price** — 37b reads "40% of 40 DH", not of 60. Otherwise a
    coupon would quietly raise his deposit share. Every figure under the service
    line in `BookingSheet` computes from payable now, and 0055's assertions pin
    the drawn numbers (60 − 20 = 40, floor 16, 24 at the shop).
  - **One booking per coupon**, via a partial unique index — the direction
    "one coupon per booking, they can't be stacked" leaves implied.
  - **A trigger, not three edits.** `coupon_follows_booking` returns the coupon
    on cancel/no-show and spends it on completion, because the rule is about the
    booking's *state*, not about which function changed it.
  - `my_coupons(salon, price)` answers eligibility per shop, so 37a's greyed
    "Le Fade doesn't take this one" is a real answer about the booking in front
    of you rather than a flag on the coupon.
- **The rest of the failures — customer turn 38, PARTLY REAL 2026-08-09.**
  `components/Failures.tsx`, built to the turn's own rule: *every error names
  what still works and offers the one action that actually helps.* A screen whose
  only button is "Try again" has given up on the customer's behalf.
  - All eight are built; 38c/38e/38g/38h share one `FullStop` frame because what
    differs between them is copy, not structure.
  - **Wired: 38a, 38b, 38d, 38f.**
    - **38a** — Explore's sort silently degraded to fetch order without a
      location (every distance `Infinity`), which looks arbitrary. It now sorts
      A–Z and says why, with the fix on the banner.
    - **38b** — a blocked camera opens the typed-code path instead of parking the
      customer in front of a dead viewfinder with the way through as a footnote.
    - **38d** — a short wallet offers the no-deposit request rather than hiding
      the payment block.
    - **38f** — `MyBookingScreen` now selects `salons.status`; a shop hidden from
      search shows the strip rather than letting it read as a booking gone.
  - **Deliberately not wired: 38g and 38h**, because both need a decision this
    turn does not contain and inventing one silently would be worse:
    - **38g** needs a source for "the minimum version we still talk to" — a
      deploy/config question, not a screen. The component takes `version` and
      `minimum` and is ready for it.
    - **38h shipped with admin turn 3 (0056)**, as planned — the suspension and
      the surface that lifts it landed together. Raised from `App.tsx` off
      `my_account_state()`; `refuse_suspended_customer` is a separate BEFORE
      INSERT trigger rather than a sixth re-emit of `fill_booking`, because it is
      one rule about one column with nothing to say about price or slots.
    - **38e** (server down) is built and unraised: it wants an app-shell health
      check, which is the same shape of decision as 38g.
- **Appeals & trust flags — admin turn 3, BACKEND REAL 2026-08-10 (0056).**
  0045/0046 already restored a review, cleared the late mark and told both sides.
  What they never had is the thing turn 3 is actually about:
  > "The rule is enforced in the UI, not just in copy."
  - **A second review by the first reviewer is not a second review**, and that now
    lives in `admin_decide_appeal`, not only in the console. A desk rule enforced
    in JavaScript is a desk rule until someone opens the network tab.
    `admin_reassign_appeal` is the way out when it is your own.
  - **The third knock-on became real.** 0046 could only write the sentence
    "poster outside by Aug 15" into a free-text `barber_action`; 0053 gave it a
    table, so an upheld appeal now inserts a genuine `shop_tasks` row that lands
    in the barber's To do (9a) and can be answered with a photo.
  - `admin_appeals()` carries the queue, the month's overturn rate (the design
    prints it back at the desk on purpose) and 3a's evidence panel — slot, scan,
    chair, and whether the shop's poster is outside yet.
  - **3b scores the barber, not just the customer**: `admin_flagged_customers`
    returns, per flag, how many clients that barber has flagged and how many of
    his removals were overturned. That is the only way to catch punitive flagging.
  - **Two things the canvas assumed that don't exist**, so I read them the honest
    way rather than inventing columns: `support_cases` has no `salon_id` and no
    assignee, so "no open case with Le Fade" resolves through the case's booking;
    and the appeal deadline is derived from `created_at + 3 days`.
  - **The console screens are built** (2026-08-10): `#/appeals` (3a) and
    `#/customers` (3b) in `admin/index.html`, bringing it to 10 screens. The
    sidebar is lifted from an existing screen rather than retyped — the file
    repeats it per screen by design, but copying 23 lines of SVG twice is how
    they drift. The Customers nav row finally has somewhere to go.
  - 3a shows the conflict **before** he types: on his own removal the decision
    buttons are replaced by REASSIGN, which is the design's "hers to look at, not
    to press". The database refuses it too, so neither is load-bearing alone.
  - **0057 fixes a collision 0056 caused.** `admin_appeals()` has existed since
    0045 and the Reviews screen calls it; 0056 added
    `admin_appeals(p_appeal uuid default null)`, and because the new argument has
    a default, a no-argument call matched **both** — PostgREST answers that with
    "Could not choose the best candidate function", which would have broken the
    Reviews screen the moment anyone opened it. The desk is now
    `admin_appeal_desk()` and the overload is dropped.
- **Compliance follow-ups — admin turn 5, REAL 2026-08-10 (0058).** 0053 gave a
  task a due date and nothing ever happened when it passed. Turn 5's rule is that
  this *is* the point: *"consequences are automatic and stated up front, so ops
  never has to argue."*
  - **Two columns and one scheduled function carry it.** `shop_tasks.on_overdue`
    (`none` / `hide_shop` / `block_topups`) and `consequence`, the sentence the
    barber reads at the same moment he reads the ask. `enforce_overdue_tasks()`
    rides the hourly job 0051 already created — one sweep now does the asks, the
    made room and the obligations.
  - **This closes a loop across four turns already built:** admin 5a sets the
    obligation and its consequence → barber 9a counts down to it → nobody acts →
    the shop is hidden → **barber 10e** is the screen that explains why and how to
    get back. Nothing new was needed on the phone.
  - `admin_issue_task()` is the writer 9a has been reading since 0053 — until now
    the only thing that produced a task was an upheld appeal. It **refuses a
    consequence with no sentence and no date**: an unstated consequence is a
    surprise, which is the one thing turn 5 says it must not be.
  - `block_topups` is enforced by a trigger on `wallet_transactions` rather than a
    re-emit of `agent_cash_topup` — one rule about one shop's standing, and it
    catches any other path that ever writes a cash row.
  - Console screen at **`#/compliance`** (11 screens now). The sidebar grew a
    tenth row, so `NAV` is applied by length: screens built before turn 5 keep the
    nine-item map, 5a gets the ten-item one.
- **Coupon campaigns — admin turn 6, REAL 2026-08-10 (0059).** The sidebar has
  had a Coupons item since 1a and the customer app has had My coupons since turn
  16, with nothing between them. 0055 made a coupon spendable; this issues one.
  - **The builder is organised around one question: who pays.** A platform
    campaign needs no new money path at all — 0055 already encodes it exactly
    (`price_cents` untouched, `discount_cents` absorbed by us) — it only needs a
    budget to spend against. Shop-funded is opt-in and `admin_send_campaign`
    **refuses to send it before the 14 days' notice is up**, because the design
    says shops get notice and a sentence nobody enforces is not notice.
  - **The audience count and the send list come from one function**
    (`campaign_targets`), so what 6a promises and what 6a does cannot disagree.
  - **The exclusion is the interesting half.** "Not sent to shops already full
    most days — a coupon there just makes the waitlist longer" is applied to
    *people*: if the last place you went is one nobody can get into, a coupon is
    not the help you need. *ponytail: "full" is read off turn 36's asks rather
    than replaying every calendar — a shop people are asking about IS a shop with
    nothing free. Swap for a real occupancy pass if the number looks wrong.*
  - **The budget stops issuing, it never revokes.** "Codes already in a wallet
    still work" falls straight out of that. A percentage coupon is reserved at
    the most it can cost (against the min spend), so the cap cannot be overrun by
    a generous redemption. The console's "400 cuts" estimate divides by the same
    number the send loop uses, so it cannot flatter the desk.
  - Console screen at **`#/coupons`** (12 screens).
- **Waitlist demand map — admin turn 4, REAL 2026-08-10 (0060).** The read side
  of `waitlist_requests` at platform scale. Customer 36a writes a row when a day
  is full; barber 8h reads them one shop at a time; neither can see the thing
  that decides what ops does next.
  - **The whole turn is one computable distinction**: an ask whose
    `earliest_min` (0050) falls outside the shop's `availability` for that
    weekday is an **hours** problem — the chairs exist, they're shut. An ask for
    a time the shop is open and full is a **supply** problem. Recruit in one,
    nudge in the other, and the desk never has to guess which.
  - The hour histogram makes it visible: amber bars are hours when the shop
    asked about was closed. The action cards then say "RECRUIT HERE" or
    "NUDGE N SHOPS" — different verbs because they are different phone calls.
  - **One new column, and it is honest about why**: `salons.district`. Grouping
    demand by area needs an area, and the free-text address is not something a
    query can split truthfully. Ops names it (`admin_set_district`); unnamed
    shops group under "Unassigned" rather than being guessed at.
  - **One card from the canvas is deliberately not built.** 4a's third action is
    "Beni Makada · no shop yet — these are searches that found nothing". An ask
    is always made *against a salon whose day is full*, so a district with no
    shop can produce none. Building that card would need a search log we do not
    keep, and faking it from waitlist rows would put a number next to a sentence
    that isn't true. It needs a `searches` table if it is wanted.
    **TRIGGER PULLED 2026-08-31 (0074)** — the table exists and the customer app
    writes to it (see "Search screen" below). The admin card itself is still
    unbuilt: `admin_demand` does not read `searches` yet.
  - Console screen at **`#/demand`** (13 screens). The sidebar is now eleven rows
    on the newest screens, so `NAV` is chosen by length: 9, 10 or 11.
- **When the desk breaks — admin turn 7, REAL 2026-08-10 (0061).** Ops errors are
  a different shape: Nadia isn't blocked from a haircut, she's blocked from
  *helping people who are*. Two rules, both enforced rather than written.
  - **"Never let a stale desk act on stale data."** `platform_incidents` carries
    a `money` lock, and it fires on **`wallet_transactions` and
    `float_settlements`** — the two tables money can enter through — rather than
    on the six functions that write them. A desk that can still settle a float
    during a wallet incident is a desk with a lock *drawn* on it.
  - **"Never hide the scale of what's broken."** The banner rides above every
    screen and refreshes on every navigation, because an incident that only shows
    on its own page is one the desk walks past. Every figure is counted, and the
    **zero is printed on purpose** — "nothing taken twice" is the most reassuring
    line there, so it is a counted fact rather than a hope.
  - **7b is real concurrency control**, not a screen. Two operators opening the
    same case and both deciding is how a review gets restored and removed in the
    same minute. `admin_task_action` now refuses a task another desk already
    closed *and says what they did*; `appeal_conflict()` returns who decided,
    when and which way, so the second operator sees the other decision instead of
    a bare error. Hiding a shop that is already hidden is refused too — 5a's
    HIDE SHOP and 3a's knock-on can both fire on one shop within a minute.
  - **0061 ships no assert block, deliberately.** Everything it adds is
    behavioural — a lock that fires, a guard that refuses a stale write — and
    `assert 0 = 0` would look like verification while checking nothing.

- **Admin roles & permissions — MODEL ONLY 2026-08-10 (0062).** Lands the
  "Roles & permissions" item deferred under *Salon management* above, scoped to
  the ops desk rather than the salon. The desk had grown to 34 `admin_*` RPCs
  behind a single bit, so a support hire could also settle a float.
  - **`is_admin()` is deliberately untouched.** It is called from 70 places
    across 17 migrations — RLS on profiles, barbers, reviews, bookings, storage,
    plus the guard clause of nearly every admin RPC. Narrowing it would rewrite
    all 70 and could lock the desk out of its own console. `admin_can(cap)` is
    the new finer question and sits *beside* it.
  - **This migration changes no behaviour, on purpose.** `profiles.admin_caps`
    backfills every existing admin to `'{*}'`, so the desk works exactly as it
    did the minute before. `admin_capabilities` is the catalogue (support,
    moderation, shops, money, growth, incidents, plus `'*'`), `admin_cap_grants`
    is the audit trail, `admin_set_caps()` is superadmin-only and refuses both
    self-edits and removing the last `'*'` holder. `admin_staff()` is the read.
  - **Trigger for the next step:** nothing calls `admin_can()` yet. Wiring it
    into the write RPCs is what actually enforces the tiers, and it should go
    domain by domain — money first (`admin_settle_float`), then moderation
    (`admin_review_decide`, `admin_decide_appeal`, `admin_set_suspension`) —
    each a visible change rather than a silent narrowing. Until then the tiers
    are recorded but not enforced, and the console has no Roles screen.
  - **Applied 2026-08-11.** Probed as anon: `admin_can` returns false (which also
    proves the `admin_caps` column landed), `admin_staff` returns `[]`, and
    `admin_set_caps` refuses — so all three internal guards hold for an
    unauthenticated caller. Still *unexercised*: every authenticated path. The
    `admin_set_caps` success path, the last-superadmin refusal, the self-edit
    refusal and the `admin_caps_valid` trigger have never fired.
  - **The backfill only covers admins who existed when it ran.** Anyone promoted
    to `role = 'admin'` afterwards gets the column default `'{}'` — harmless
    while nothing calls `admin_can()`, but they hold no capabilities, and if no
    one holds `'*'` then `admin_set_caps` locks everybody out of granting and the
    only way back is the SQL editor. Check `admin_caps` after every promotion.

**All 7 admin turns, all 3 barber turns and both customer turns are now built.**
- **Everything through 0061 is applied (2026-08-10).** Still *unexercised*: the
  authenticated paths. 0047/0048 were probed as anon, so `fill_booking`'s bundle
  branch, `fill_booking_services` and `default_settle_on_complete` have never
  actually fired — and nothing above 0050 has been through the app at all. One
  real booking, one real task, one real settlement is what's left to trust them.
- **Nothing notifies a barber that a task was issued.** 9a is a pulled inbox. A
  push would need a new `notifications.kind`, which needs its own migration
  (enum ADD VALUE can't share a transaction with its use). Do it with admin 5a,
  which is the turn that creates tasks in the first place.
- **9e's "pay it in at the bank" is inert** and says so on screen. It needs a
  slip upload and a clearing step; the code path covers the launch case.

## Switches that were pretending — barber 11 · customer 39 · admin 8
Three turns, one theme: **columns the code writes that nothing reads.** Every
item below was already named in this file as a deferred trigger, which is why
they landed together. Migrations 0063–0066, all written 2026-08-11, **none
applied yet**.

- **Barber 11 — two switches (0063 enum · 0064).**
  - `salons.accepting_bookings` has existed since 0025 and **no booking path
    ever read it**. Six re-emits of `fill_booking` between 0016 and 0055 each
    check the *barber's* switch; none checked the shop's. An owner closed his
    shop, watched the button go grey, and requests kept landing on his barbers.
    This entry's own line 131 said "wire the check when the request path is next
    touched" — 0052 and 0055 both touched it and didn't.
  - The enforcement is a **separate BEFORE INSERT trigger** (`refuse_closed_shop`),
    not a seventh re-emit — the same call 0056 made for
    `refuse_suspended_customer`. It catches `join_queue` for free, which is 11a's
    "the walk-in QR stops working".
  - Closing gained an **end**: `salons.closed_until`, and openness is *derived*
    (`salon_open()`) rather than swept, so "rest of today" reopens because the
    date passed and not because a cron woke up. `close_shop` / `reopen_shop` are
    owner-only because "only you can reopen it" is printed on the sheet.
  - **11c/11d** put `float_cap_cents` (0044) on screen for the first time. The
    meter appears from 70% and a refused top-up opens its own sheet — nothing
    was recorded, hand the cash back, and here is the nearest till with room.
  - `agent_round()` re-emitted so ops actually sees `collection_requested_at`;
    a collection clears it by trigger.
  Still open:
  - **"Pick dates" is not built** — the third period chip alerts. The two that
    matter (rest of today / until I reopen) are real; a range needs a calendar
    the sheet doesn't have.
  - **11d can't name the customer.** The cap check in `agent_cash_topup` runs
    *before* the phone lookup, so at refusal time the server has never resolved
    a name. The masked phone is shown instead of inventing one.
  - **"Nadia has been told automatically" is sent by the app, not the DB** — the
    cap refusal is an exception, so anything the function wrote would roll back
    with it. `request_float_collection()` is called from the catch.
  - **`agents_with_room` rounds a rival shop's headroom down to 100 DH.** The
    design prints an exact figure; an exact figure tells any owner in the city
    how much of our cash a competitor is holding.

- **Customer 39 — four things the app already half-had (0065).** All four are
  BACKLOG triggers being pulled at once.
  - **39a** is the customer end of 11a: `salon_closure()` reads the same
    `salon_open()` the trigger does, so the page can never offer what the insert
    will refuse. The pinned Book CTA goes grey; "TELL ME IF THEY REOPEN" is a
    `waitlist_requests` row, because `reopen_shop` already pings every live ask.
  - **39b** closes *"Nothing surfaces the mark before it bites"*. It also adds a
    rule 0046 never had — **three visits on time in a row clears a mark**, so a
    marked customer has something to do besides wait ninety days.
  - **39c** closes *"Wishlist → toggling does nothing yet"*. One `wishlists`
    table for barbers and salons. **"Nobody is told you saved them" is the RLS
    policy**, not a reassuring sentence.
  - **39d** closes *"Appointment NOTES → needs a `bookings.notes` column"*. The
    note travels with the insert, so a booking never exists without it, and it
    renders on the barber's booking panel — the design parks that as "try next",
    but a note nobody reads is the exact bug this turn is about.
  Still open:
  - **39a's "THESE BARBERS WORK ELSEWHERE TOO" is not built and cannot be.**
    `barbers.salon_id` is a single column; a barber works at one shop. The
    design's "Saturdays at Marina Barber Club" needs a barber↔salon join table.
    Omitted rather than faked.
  - **"Next free" is today only** (`barber_next_free_today`, 30-min steps,
    ignoring service duration). The design's "Next free Fri 14:00" is a
    multi-day scan per saved barber, which is not worth it on a list screen.
  - **Disputing a mark opens a support case**, not a dedicated flow. 14 days is
    the window, and it is another untuned guess.

- **Admin 8 — the rules, the Barbers row, presence (0066).** Console at
  **`#/reliability`**, **`#/barbers`** and **`#/desk`** (16 screens).
  - **8a makes 0046's two guesses into settings.** `platform_settings` is one
    row with three named columns — not a key/value bag, where a typo invents a
    setting nobody reads. `customer_deposit_pct`, `customer_on_time_streak` and
    `mark_late_arrival` all read it now. Every figure on the screen is
    **counted against the last 90 days of real arrivals**, and
    `settings_changes` is the "logged with who made it".
  - **The 39b toggle defaults ON**, which is a deliberate deviation: the canvas
    shows it off, but 0065 shipped a customer screen that counts to three, and a
    ladder climbing towards nothing is the failure both turns exist to end.
  - **8b fills the Barbers row**, inert in every sidebar since 1a — it was the
    literal `null` in `NAV`, `NAV10` and `NAV11`. "WHY IT'S FLAGGED" is one
    derived sentence, ordered money → cancellations → silence.
  - **8b needed a column too**: nothing recorded *when* a booking was cancelled,
    only that it had been. `bookings.cancelled_at` + a trigger, so "9 inside 2
    hours" is countable. Historical rows have none and the clause is omitted
    rather than guessed at.
  - **8c is 7b answered a step earlier.** 0061 could only tell the second
    operator that somebody had already decided; `desk_presence` says so before
    she starts. The 15-minute release is **read at query time, not swept** — a
    lock nobody is behind stops existing the moment somebody looks.
  Still open:
  - **8b's "cutting under the owner's login" row cannot be derived.** A person
    with no account has no `barbers` row, so the list that would flag them is
    the one place they are invisible.
  - **8a's "TRY IT ON ONE DISTRICT"** is not wired — `salons.district` (0060)
    exists, but a per-district rule needs the settings row to stop being one row.
  - **8a's two NOT BUILT consequences stay not built**, as the canvas labels
    them: barbers refusing a booking outright, and reliable clients getting
    first refusal on freed slots.
  - **Presence only updates on the `#/desk` route** — no polling, same "no
    realtime" limit as the rest of the console.
  - **None of the new admin RPCs call `admin_can()`.** They use `is_admin()`
    like the other 34. That matches 0062's own note that wiring capabilities
    should go domain by domain as a visible change — but `admin_save_reliability`
    changes a platform-wide rule and is a good candidate for the first one.

**Two dead ends fixed with them (2026-08-11).** Not from any turn — found by
auditing every full-screen push in the app:
- **The barber's Profile had no back control at all.** `BarberProfile` drew a
  bare centred "Profile" title and was never handed `onBack`, while the
  dashboard avatar that opens it calls `onChromeHidden(true)` and hides the tab
  bar. There was no way out of that screen. It uses the dark kit's `TopBar` now.
- **Profile → My Bookings was the same trap on the customer side.**
  `MyBookingsScreen` is a bottom tab *and* a profile row, and had no `onBack`
  prop at all. It takes an optional one and swaps the plain title for a
  `ScreenHeader` only when it is opened from Profile.
An audit script over every `return <Screen …/>` push now reports a back control
on all of them; run it again after adding a screen.

**Android hardware back — REAL 2026-08-11 (`src/lib/back.ts`).** Nothing had ever
registered a `BackHandler`, so the system back button quit the app from any
screen, however deep. There is still no navigator and this does not add one.
- **`BackHandler` is already the stack.** Subscriptions fire
  last-registered-first and the first to return true ends the chain; containers
  mount parent-before-child, so the deepest screen showing is the one that
  answers. `useAndroidBack(handler | null)` is the whole library — passing null
  falls through to the next container up, and finally to Android, which
  backgrounds the app the way a tab root should.
- **Registered at the 18 places that own navigation state**, never on the leaf
  screens: a child holding only an `onBack` prop cannot know what "back" means.
  Each handler mirrors, in order, the early returns its own container renders.
- **Modals are deliberately excluded.** React Native routes back on an open
  `<Modal>` to its `onRequestClose`, which every sheet already wires to close.
- `ProfileScreen` keeps a small `trail` of visited views so back retraces the
  way in — `faq` returns to `help`, `appeal` to `takedown` — instead of always
  dumping you at the menu.
- From a non-first tab, back lands on the first tab before it will exit.
- Two screens deliberately refuse it: 28a/28b's you-are-next takeover and 13a's
  "moved" acknowledgement are alarms, not screens you back out of.
- The audit script also checks the hook is never called after an early return
  (it caught two); re-run both after adding a container.

**0063–0066 are applied (2026-08-11)**, so their `do $$ assert $$` blocks passed.
`npx tsc --noEmit` is clean, `npm run check` passes, and the console's own
slot/screen self-check resolves all 126 ids. Still *unexercised*: every
authenticated path — `close_shop`/`reopen_shop`, the cap refusal, `claim_case`,
`admin_save_reliability`, and the `refuse_closed_shop` / `stamp_cancelled_at`
triggers have not been fired by a real session.

## Placeholder screens (UI built, not wired to backend)
These exist as visual shells to implement later:
- **WalletScreen** — REAL 2026-07-19 (0022): balance + transactions read the
  `wallet_transactions` ledger. Add-Money (card) still needs the payment rail;
  the fake Add Money / Top-Up Success screens were deleted.
- **CouponsScreen** — REAL since 0038 (design 16a + 17c). There is no "Copy code"
  button: the screen is a `claim_coupon` input plus active/used/expired cards.
  Still missing is an **issuing/admin surface** — templates go in server-side.
- **HelpCenterScreen** — REAL (design 16b + 22b). FAQ accordion + Contact Us are
  built; what's missing is **article content**, not wiring. See "Support consoles".
- **CancelReasonScreen** — GONE, and the feature shipped. It was barber design
  **1r**, absorbed by the 3a–3e reliability turn that deleted the file (119ad26).
  Live path: reason picker in `CalendarScreen.tsx` → `bookings.cancel_reason` →
  rendered on the customer's card in `MyBookingsScreen.tsx`.
- **LeaveReviewScreen** — ORPHAN, safe to delete. It is customer turn **4a**,
  which **turn 5 superseded** by re-cutting the review as a sheet over the
  Completed tab (that sheet is what ships, in `MyBookingsScreen.tsx`). Nothing
  imports the file. Its only unique ideas are 4a's **specialist picker** and
  **photo attach**, neither of which is in the shipped sheet — keep those two
  here if they're still wanted, then delete the file.
- **PermissionScreen** (+ Notification/Location presets) — onboarding prompts; wire to
  expo-notifications / expo-location in the first-run flow. Also unrouted today.
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
   *Seed exists (2026-07-15): walk-in bookings carry a `walk_in_name`; the client
   book can grow out of recurring walk-in names + booking history.*
   *Seed grew (2026-07-17): Quick add → existing client derives habits from history
   (most-booked service + median arrival) and pre-fills the booking with them.*
4. **Booking invite → client confirms** — today "Book existing client" (Quick add)
   creates a named walk-in row (`customer_id = barber_id`, `walk_in_name` = their
   name), same as any walk-in. It does NOT link to the client's actual account:
   `bookings_insert` RLS requires `customer_id = auth.uid()`, on purpose — a
   barber must never be able to write into a client's history unconsented (fake
   no-shows would poison their reliability stars). Consequence: the client sees
   nothing in My Bookings, gets no chat thread, no reminder, can't cancel it, and
   can't leave a review, and their reliability stars don't accrue on it — it's
   invisible to them. Proper fix: barber creates a *proposal*, client gets a
   notification and accepts it himself (satisfies the RLS check, links chat/
   reminders/reviews/reputation for real). **Trigger:** with the push-notifications
   increment — a proposal nobody sees is worse than today's walk-in row.
5. **Flash discounts on dead hours** (11h–16h chairs are empty) — doubles as our
   client-acquisition engine. **Trigger:** with the `promotions` table.
6. **Verified badge / "Top rated in Tangier"** — barbers are competitive and
   image-driven; costs nothing, we already have reviews + ID verification.
7. **Zero commission on their own clients, stated loudly.** Monetize only
   marketplace-sourced clients + payment fees later. **Trigger:** pricing page.

### QUEUE MODE — the one bet that puts us ahead
Most Moroccan barbershops are **walk-in, not appointment**. An appointment-only app
fights the culture. Queue mode *is* the culture minus the bench: client takes a
virtual ticket, sees "3 ahead, ~40 min"; barber sees the queue on his phone.
Works with **zero payment rail**. No competitor (Booksy/Fresha clones) has this.
**Trigger:** right after bookings are solid — before packages, before maps.
**STARTED 2026-07-22 (0029) — real, and simpler than the original sketch.**
DECIDED: the queue is **not a separate rail** — it's a live view over the
barber's confirmed day. Customer books → barber confirms → the live ticket card
pops up on Home (design 1a) for today's confirmed booking, opening the full
queue view (`QueueScreen.tsx`, design 1b). "Who's ahead" = the barber's
confirmed bookings today (walk-ins the barber Quick-adds are bookings, so they
slot in automatically); "in the chair" = `started_at` set (0018 lifecycle:
Confirm → Check in → Start → Complete — the barber already runs the queue from
his dashboard, no new barber UI). Backend = one RPC, `barber_day_queue(barber)`
(0029): today's confirmed bookings with server-side-trimmed names ("Mehdi K."),
gated to people who are themselves in that barber's day (or the barber).
Ticket Nº = position in the day's book. The first-cut `queue_tickets` table was
dropped in the same migration (0029 is idempotent over both states).
Still open:
- **Polling, not Realtime** — other customers' booking rows are RLS-hidden, so
  their change events never reach a subscriber; card + screen poll every 20s
  (`QUEUE_POLL_MS`). Realtime broadcast (or a push ping) when it matters.
- **Push ping when you're next** — the "we'll notify you" line; lands with the
  push increment. Until then positions update only while the app is open.
- **ETA = minutes until your slot** — honest for appointments, but doesn't model
  the barber running late. Shift to sum-of-remaining-durations-ahead when
  lateness data exists (started_at vs starts_at gives it for free).
- **Pure walk-in ticket (no appointment)** — the dropped self-join rail; re-add
  as "join today's queue" *creating a walk-in booking at the end of the day's
  book* if barbers ask for bench-less walk-ins from the app.
- **Salon-level (multi-chair) queue** — later, with salon management.

### Payments — phased, since Stripe is out (see 0005_no_deposits)
- **Phase 1 (now): no money through us.** Pay at shop. Fight no-shows with
  *reputation*, not deposits: strike system (2 no-shows → must phone-confirm /
  lose booking priority), "reliable client" badge, barber marks no-show.
  **Trigger:** first real no-show complaint from a barber.
  *Partial (2026-07-15, trigger pulled early on request): barber can mark
  no-show from the Schedule timeline (`mark_no_show` RPC, 0014). The strike
  system / badge / booking-priority consequences are still TODO.*
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
    **DECISION (v1): one cash agent per salon, default = owner — not every chair.**
    Netting is per-person (collected cash cancels only against *that* collector's
    unpaid earnings), so a low-earning barber who takes a big top-up flips into
    owing *us* — reverse of the advantage + float risk. Keep it to whoever has a
    big, reliable payout: one float cap + one till to reconcile per salon. Add
    per-barber agents later only if a high-volume barber asks and his payouts
    cover the float.
    *STARTED 2026-07-19 (0022): `wallet_transactions` + `agent_cash_topup` are
    live — cash top-up works end to end (agent till + customer balance), no
    commission (decided: 0%). Still missing: settlement/netting, card rail,
    spending the balance. See "Agent wallet (salon till)".*
  **Trigger:** once wallets have balance, **deposits** and **coupons** finally have
  something to attach to — that unblocks 4 items above.
- **Phase 3: direct m-wallets** (Orange Money, inwi money, Cash Plus API) only when
  volume justifies the partnership overhead. **Trigger:** not before real volume.

### Localisation
**Darija/Arabic + French UI, WhatsApp-first sharing.** Cheap for us, and the
difference between "an app" and "our app". Booksy will never do this well.
**Trigger:** before any paid client acquisition.

## Profile menu rows  → `src/screens/ProfileScreen.tsx` (customer)
- **Payment Methods** — needs a payment rail (no Stripe in Morocco; pay at shop
  for now). **My Wallet** is real since 0022 (cash top-ups at the salon); card
  top-ups + spending the balance still need the rail.
- **My Coupons** — needs the same `promotions`/coupons table as Explore badges.
- **Settings** — placeholder. Likely: notification prefs (push), password change
  (`supabase.auth.updateUser`), language (ar/fr/en).
- **Help Center** — placeholder. Static FAQ + contact links (WhatsApp/phone).

## SMS rail — BLOCKED, needed by admin turn 11 (0072)
Admin 11a's **"CREATE & SEND THE INVITE"** is the first thing in the product that
has to reach somebody who has **no account yet**, so push (0037) cannot carry it:
Expo push tokens key on `user_id`, and an invited shop owner has no user row
until he opens the link. It has to be SMS.

**Nothing sends today, and 0072 does not pretend to.** `admin_create_salon()` and
`admin_invite_action()` return the exact message and the `sterncut.ma/c/<token>`
link, and the console copies it to the clipboard for ops to send by hand
(WhatsApp or the phone's own SMS app). `salons.invite_sent_at` records *that ops
sent it*, which is true — it does not claim the platform did.

**What a real rail needs:**
- A Moroccan-reachable provider. Twilio bills MAD fine but the sender ID has to
  be registered with the ANRT to avoid being filtered; the local resellers
  (Mobiblanc, Cynoia) are cheaper per segment and already ANRT-registered.
- The same `pg_net` extension push is waiting on, or an Edge Function — the
  send has to happen server-side so the token is never handed to a browser.
- A `sms_outbox` table for retries and delivery state. An invite that silently
  failed looks identical to one the owner ignored, and 11b's "never opened the
  link · 23 days" column would be lying about which of the two happened.
- Darija copy, not the English placeholder in 11a's preview.

**Trigger:** the first time ops adds a shop it did not recruit in person — i.e.
when somebody is expected to receive the link without Nadia standing next to
them. Until then hand-sending is honest and costs nothing.

**Second caller, once it exists:** OTP at signup (`OtpScreen.tsx`) is still on
Supabase's own provider; a single owned SMS rail would serve both.

## Search screen — EXPL-13/14/15, REAL 2026-08-31 (0074)
`src/screens/SearchScreen.tsx`, from the Sterncut slice-1 handoff
(`design_handoff_slice1/`). The search field on Home and Explore had been an
inline filter over the list already on screen; it is now a button that opens a
real search, and the three designed states are one screen because they are one
moment — you tap, you type, and either something comes back or nothing does.
- **The whole point is the empty result.** Handoff §7.4: "a failed search is the
  most valuable event in the app." `searches` (0074) is the table 0060 said it
  would need, and the write happens **when the result comes back empty**, not
  when the customer taps NOTIFY ME — a miss nobody acts on is still the signal.
  `set_search_notify` is a second call precisely so the first one is unconditional.
- **Not `waitlist_requests`.** That row needs a barber and a day (0049); a search
  that found nothing has neither, and widening it to nullable would make every
  existing waitlist read lie. The handoff calls the table `SearchMiss`; the name
  here is the one 0060 asked for.
- **A district is only ever named if a salon already carries it** (`salons.district`,
  0060). Splitting a free-text query into a place name would put a real district
  next to an invented number — the same rule 0060 set when it refused to guess.
- Salons/specialists in **one list, not tabs**: in Tangier people search a
  barber's name as often as a shop's, and tabs make them guess which they meant.
Still open:
- **The admin end.** `admin_demand` doesn't read `searches`, so 4a's "no shop
  yet" card is still missing — the data is accruing but nothing shows it. That
  is the next thing worth building here, and it is now ~10 lines.
- **EXPL-14's availability badge** ("Free at 15:30" / "Next: tomorrow") is not
  built: it needs a `daySlots` pass per salon in the result list, which is a
  per-barber availability + bookings + time_blocks load per row. Wrong trade on
  3G for a launch-size list. Revisit with a cached next-free-slot column.
- **EXPL-14's chip row** (Nearest / Filters / Open now) is dropped. Filters
  already exist on Explore's sheet, and duplicating them in search would be two
  places to change one thing. Sort is nearest-first when a location is known.
- **EXPL-13's "BUSY NEAR YOU" says "Suggested"** and sorts by rating. Nothing
  measures how busy a shop is; README §3 calls the strip "suggested" anyway.
- **Recent searches are per-device** (AsyncStorage), not synced. A `searches`
  row exists for misses only, deliberately — logging every successful search
  would be a tracking table nobody asked for.
- **0074 applied 2026-08-31.** `log_search_miss` / `set_search_notify` are live.
  Not yet exercised end to end: the misses accrue, but no admin surface reads
  them (see the demand-map item above).

## "Anyone free" — BOOK-21, REAL 2026-08-31
The booking sheet's barber step made you choose a person before you could see a
time. The handoff names the fix as the design decision of that screen: **"Anyone
free" is the default**, because the option with the most times in it is the one
that fills a shop's day, and making the customer pick a face first is what
empties it.
- **It is not a booking against nobody.** `SlotPicker.barberId` now takes a list
  as well as an id; with several it lays every chair's day over itself and
  `onSelect` says *who* was free at the time tapped. That resolves `barber` to a
  real specialist before the summary, so price, terms, deposit and `confirm`
  run on one code path with no "any" branch anywhere near the money.
- **The merge is in `lib/slots.ts`** (`mergeSlots`), not in the component, so
  `npm run check` pins it: a free chair beats busy ones, the earliest chair in
  the list wins a tie, and `full` beats `past` when chairs disagree — a time
  somebody booked is better described as taken than as gone by.
- Existing single-barber callers were not touched: `string` still satisfies
  `string | string[]`, and a handler ignoring the second argument still fits.
Still open:
- **The grid uses the LONGEST chair's duration** for the sitting, so a slot
  offered always fits whoever takes it. It can hide a slot only a faster barber
  could have done. Per-chair durations if a shop's timings really diverge.
- **"Free at 15:30 today" is built (2026-08-31).** `nextFree()` in `lib/slots.ts`
  scans 7 days per offering chair when the barber step opens, and is pinned in
  `npm run check`. Undefined prints nothing while it loads; null says "Nothing
  free this week" — neither invents a time. Costs N×5 small queries on that step
  only; fold into one RPC if a shop ever gets big enough to notice.
- **`renderFull` (36a's ask) anchors to the first offering chair** when nobody
  is chosen. The ask sheet's own "any barber at <shop>" toggle covers the rest.
- **BOOK-01 keeps its multi-select ticks.** The handoff draws single-select with
  a chevron; 0067 made the sitting n services on purpose, and reverting it would
  be a regression, not a redesign.

## Loading skeleton — SYS-01, REAL 2026-08-31
`HomeSkeleton` in `components/ui.tsx` (no new file — it belongs with `Empty` and
the other shared primitives), raised by `DiscoverScreen` on first load only.
The handoff's §3 reason is the whole point: *"Poor 3G is the normal case, not
the edge"*, so the first paint is the shape of the screen rather than a blank
canvas or a spinner that says nothing about what is coming.
- **First load only.** A reload with rows already on screen keeps them —
  replacing real content with grey blocks is a downgrade, not a loading state.
- Two new tokens, both measured off the design: `colors.skeleton` (#E3E0D8) and
  `colors.skeletonSoft` (#E9E6DE).
Still open:
- **Static, exactly as drawn.** If grey blocks ever read as a broken render
  rather than a loading one, the fix is one `Animated.loop` on the wrapper's
  opacity — not a per-block animation.
- **Only Home has one.** Explore, the salon page and My Bookings still go from
  empty to full. Home was the screen the design drew; the others want the same
  treatment if 3G testing shows the gap.

## Slice-1 handoff — what the customer redesign actually needed
Closing note on `design_handoff_slice1/`, so the next person doesn't re-audit it.
**The design files are a recreation of this repo** — they say so in every turn
note ("faithful recreation of every customer screen in the repo"). So most of
the 16 customer screens were already built to them. Verified, not changed:
`HOME-01` (DiscoverScreen), `BOOK-01/02/03/04` (BookingSheet + SlotPicker),
`BKG-03/07/16` (MyBookings + MyBooking's 35c), `SYS-05` (Offline.NoConnection),
`SYS-06` (26a), `AUTH-05/06/07/09` (AuthScreen + OtpScreen).
Genuinely new: the search screen + `searches` (0074), `BOOK-21`'s "Anyone free"
and its "Free at…" line, and `SYS-01`.
**Where README.md and the designs disagree, the designs won**, because the
README describes a greenfield cash-only slice this app is years past:
- §3 "hide the queue card" — queue mode is shipped; hiding it is a regression.
- §5 "no money tables" / `BOOK-03` cash-only — deposits are real and enforced in
  `fill_booking`, so the screen keeps the deposit block. **Decided by the repo
  owner**, 2026-08-31.
- §7.1/§7.7 `BKG-16` "counts against you for nothing" — false once a deposit can
  be forfeited. The design's own BKG-16 is deposit-aware and that is what is built.
- §7.3 "no password field, no reset, no email" — contradicted by the design's own
  `AUTH-06` (email+password) and `AUTH-11` (set a password).
- §3 `BOOK-01` "single select" — 0067 made a sitting n services deliberately.
**Still genuinely missing from the handoff, and all of it blocked on one thing:**
French/Arabic copy with RTL, the four SMS templates, and phone-OTP as the auth
rail. `AUTH-07` has no "STEP 2 OF 3" and no "we'll text a code" precisely because
there is no step 3 until an SMS provider exists. **Trigger: an SMS account.**

## Slice 2 step 1 — the ledger (0075, 2026-08-31)
`design_handoff_slice2` §9 step 1. No UI.
- **The ledger was single-entry.** A deposit was one negative row on the customer
  and nothing anywhere else; the shop's claim was derived (`salon_owed_cents`).
  So a *held* deposit sat in neither position and "who holds this" needed logic,
  not a row. `deposit_holds` posts the missing side — **one table, no rewrite**:
  every existing read (0022/0035/0043/0044/0061/0069) is untouched, and the
  nightly check asserts posted and derived agree.
- **Idempotency was a live bug**, not a slice-2 feature: `agent_cash_topup` had
  no key, so a double-tap credited real money twice. Key minted per attempt in
  `AgentWalletScreen`, reused by 10c's retry. Replay is answered *before* the cap
  so a retry returns the original receipt instead of a refusal the first tap caused.
- **Append-only is a trigger now**, not just withheld grants (0024 deleted ledger
  rows once). `float_settlements` got the same lock (§6.7).
- `ledger_check()`: `cash_in + platform_credits = balances + held + to_shops`.
  Referral credits (0038) count as money entering — they are platform-funded with
  no cash behind them. Scheduled 02:30 on the conditional pg_cron shape (0037/0051).
Still open:
- **0075 is NOT APPLIED.** Its assertions are the test — the drift check runs
  against real rows at apply time and fails the migration if the backfill is wrong.
- **The free-cancellation window does not exist** (§6.4). `resolve_deposit_hold`
  encodes today's shipped behaviour: customer cancels → forfeit, whatever the
  timing. Step 4 splits that branch; it is the only edit needed there.
- **Deposit policy is on the wrong axis for §5.** `customer_deposit_pct` (0046) is
  a *customer* late-arrival penalty (40/100), not a shop policy. Both must live:
  the floor is `max(shop %, customer %)`, or a shop setting 0% silently disables
  the only anti-no-show mechanism in the product.
- **Blocked on unbuilt designs (§4):** G3/G4 gate the deposit-policy UI (step 3),
  G2 the short-wallet exit (`LowWalletBlock` in Failures.tsx is close but was
  drawn for 38d), G5 cash-out has nothing. The four §7 SMS need the same provider
  still blocking slice 1's RTL and OTP.

## Slice 2 step 2 — cash in (2026-08-31)
Almost entirely already built. `BCF-01`/`BCF-02` are `AgentWalletScreen`,
`BCF-03`/`BCF-04` the 4-digit handover (0053), `BCF-05` `TopUpFailedSheet` (10c),
`BCF-06` `FloatCapMeter` (warns from 70%), `BCF-07` `CapHitSheet` — and the cap
already refuses rather than warns (0044/0069). §6.2's atomicity holds trivially:
cash-in is ONE row, read as the customer's credit and the shop's float liability
from the same place. Step 1 added the missing key.
- **`WAL-01` needs nothing removed** — the customer wallet never had a card row.
- **`WAL-03` already says how to put money in** ("top up with cash at your barber").
- **One false promise deleted:** ADD MONEY said "card top-ups are coming soon".
  §1/§8 say there is no processor and won't be one this slice, so that was a
  promise the product has decided not to keep.
Still open:
- **G1 is that button's real destination** ("Pay at a Sterncut shop" — where and
  how). Not invented; the alert now names the one path that actually works.

## Slice 2 step 3 — BLOCKED
Deposit policy. The model can land without UI (§9 step 3 says so), but the
screens need **G3** (owner sets the deposit, on `Owner - Shop`) and **G4**
(platform floor/ceiling on ops `SET-01`), both still being designed.
Also unresolved before the model is safe to write: §5's shop percentage and
`customer_deposit_pct` (0046) are different axes and both must survive —
floor = `max(shop %, customer %)`.

## Slice 2 step 3 — the shop's own deposit (0076, 2026-08-31)
Owner · Shop **turn 6 · OSH-11/12/13**, gap G3. `src/screens/DepositScreen.tsx`
on **Salon management → Deposit**. G3 is no longer blocked; **G4 still is**.
- **The floor moved from the platform to the shop.** It was 40% hardcoded in
  `fill_booking` and again in `BookingSheet`. Now `shop_deposit_policies` is
  append-only and versioned, so OSH-12's "23 keep their 40%" is a counted fact:
  a booking keeps the number it was taken under.
- **Composition, decided with the owner:** `customer_deposit_pct` (0046) is a
  *late-arrival penalty*, not a baseline — its 40 was the platform number that
  is now the shop's job. So `booking_deposit_pct = greatest(shop, customer)`,
  **except a shop at 0, which stays 0 even for a marked customer**. Forcing 100%
  at a shop that declined deposits is the platform protecting someone who asked
  not to be. §5's "behaves exactly like slice 1" only holds that way.
- **Enforced by a separate trigger, not a seventh re-emit of `fill_booking`** —
  0056's precedent for `refuse_suspended_customer`. `before_booking_shop_floor`
  sorts after `before_booking_insert`, so it sees the price, discount and deposit
  fill_booking already settled, and applies the floor to **payable** (37b's rule:
  a coupon must never raise the deposit share).
- **G4's bounds are data with no UI** — `platform_settings`, defaulting to the
  drawn 20%/60%. Ops sets them in SQL, exactly as `float_cap_cents` did (0044).
- Amber everywhere on the shop's side, per the turn note: a deposit is **held**,
  not earned. Green would say the money is already his.
Still open:
- **0076 is NOT APPLIED.** Its assertions pin OSH-11's drawn arithmetic
  (50% of 60 = 30; a 45 DH kids cut rounds UP to 23 held, 22 cash).
- **G4 — the ops screen** for the floor and ceiling. Until it exists nobody can
  change 20/60 from a UI.
- **A shop at 0% cannot take a voluntary partial deposit.** `fill_booking` still
  refuses anything under 40% when a deposit is offered at all, and the new
  trigger can only tighten, never loosen. The sheet hides the block entirely at
  a 0% shop so the case can't be reached — fix properly when fill_booking is next
  re-emitted for step 4.
- **The preset chips are five taps, not a drag.** A gesture dependency for a
  control with five legal values isn't worth it.

## G4 — deposit floor & ceiling (0077, 2026-08-31)
Sterncut Ops · Settings turn **S2 · SET-11/12/13**. Console screen `s12a` at
`#/reliability/deposit`, reached from the Settings screen's header. 0076 shipped
the two integers with no screen and no history; this is the desk for them.
- **Narrowing strands, it never clamps.** Nothing here touches a shop's saved
  percentage — the bounds are checked only when an owner saves (0076), so a
  stranded shop keeps its number until its next edit. The design is explicit
  that there is **no "clamp all"**: silently moving a shop's number changes what
  a customer is asked for tomorrow without the owner knowing.
- **A reason is mandatory when either bound narrows, optional when it widens**,
  and that rule is in `admin_set_deposit_bounds`, not only in the console — the
  same lesson 0056 wrote down about desk rules living in JavaScript.
- **The audit is 0066's `settings_changes`, not a new table** — it was built for
  this exact settings row and already promised "every change is logged with who
  made it". Bounds go in as typed JSON: before {floor, ceiling}, after adds the
  count outside **at that moment** (frozen — the answer drifts as shops edit) and
  how many owners were told; `note` is the reason. 0077 also gives it 0075's
  append-only trigger, so its immutability is a rule and not a habit.
- **A shop at 0% is never "outside".** The bounds do not touch that choice (§5).
- The histogram's 0% column is hatched grey, not coral: it is a choice, not the
  bottom of a scale.
Still open:
- **0077 is NOT APPLIED.** Its assertions pin SET-11's card arithmetic (12 DH at
  20%, 36 at 60%, 54 on cut and beard) and SET-12/13's drawn cohorts.
- **"Tell the owners" is an in-app notification, not the SMS the design draws** —
  the SMS rail is the same one blocking slice 1's OTP and RTL. The audience query
  is the part that matters and it is already right; swap the insert for a send.
- **Five of the six Settings sub-tabs are inert** (Team & roles, Permissions,
  Audit log, Message templates, Districts). Those are turns B3/B7, not G4. Left
  visible-but-dead rather than removed, as the console did for Barbers/Customers.
- **The dials step in fives.** The design draws −/+ buttons without naming a
  step; five matches the presets OSH-11 offers an owner.
- **0076/0077 first apply failed and was fixed, not worked around (2026-08-31).**
  `platform_settings` already existed — 0066 created it for the reliability rules
  — so `create table if not exists` silently did nothing and the two bound
  columns were never added. 0076 now ALTERs that table instead of trying to own
  it, and 0077 writes to its existing `settings_changes` audit. Neither file had
  applied (the failure rolled the whole script back), so editing them rather than
  adding 0078 keeps the rule intact: **an applied migration is never edited.**
  Both are idempotent, so re-running is safe either way.

## Slice 2 step 4 — the deposit resolves on a deadline (0078, 2026-08-31)
§6.3 lists four outcomes; the repo only ever had two. `cancel_booking` (0035)
refunded when the **barber** cancelled and forfeited every time the customer did,
whatever the timing. 0078 splits that: a customer who cancels **inside the free
window** gets the hold back. This is a behaviour change to shipped money code.
- **One predicate, two callers.** `cancel_is_free(starts_at)` is read by both
  `cancel_booking` and 0075's `resolve_deposit_hold`, so the refund row and the
  hold's state can never disagree about whether a cancellation was free.
- **§6.4 is rendered as a TIME.** `booking_free_until()` returns the moment;
  BKG-07 prints "Free to cancel until 13:30 today", and once it has passed it
  says so rather than going quiet — that is the sentence the customer is about
  to make a decision against. The subtraction happens once, on the server.
- **35c stopped lying.** The receipt hardcoded "Refunded to wallet · 0 DH",
  which was true only while every customer cancellation forfeited. It now reads
  `deposit_holds.state` after the cancel — what the ledger did, not what the
  screen thinks the rule was — and "rebooking doesn't bring it back" is
  suppressed when it already came back.
Still open:
- **DEVIATION: the window is platform-wide, not per shop.** §6.4 says it must
  come from the shop's policy. Nothing designed can set that — G3 (OSH-11) is
  only about the percentage, and §4's seven gaps don't include a window screen.
  It sits on `platform_settings.free_cancel_min` (120, the value ops SET-01
  draws) until a surface exists. **This wants a decision.**
- **`fill_booking` still refuses a deposit under 40%**, so a shop at 0% cannot
  take a voluntary partial one. The sheet hides the block entirely at a 0% shop
  so the case is unreachable; the real fix is the re-emit, still deferred.
- **BKG-16 (§3: "rewrite from slice 1") is step 5**, not done here.

## Slice 2 step 5 — the deposit resolves (2026-08-31)
`BTD-03` mark-done routing. No migration: the numbers were all there, the panel
just wasn't reading them.
- **A real money bug, found by building it.** `BookingPanels` said
  "Collect in cash · **{full price}**" and the CTA read "MARK DONE · COLLECT 60 DH"
  — it never looked at `deposit_cents`. A barber reading that aloud takes 60 when
  24 is already out of the customer's wallet, so the customer pays 84 for a 60 DH
  cut. Now: a "Deposit paid" row, and `collect = price − deposit` behind both the
  figure and the button, which is exactly what BTD-03 draws.
- **The same bug was on the dashboard's next-up card** (`BookingsScreen`), fixed
  with it. `SettleBundleSheet` (34f, 0047) already had it right — bundles were
  the only path that subtracted the deposit.
- **BKG-16 needed no rewrite.** Slice 2's design file is byte-identical to slice
  1's and draws only the forfeit case; §3's "rewrite from slice 1" is aimed at
  slice 1's *README* §7.1 ("cancelling costs nothing"), which the design never
  followed. Step 4 already made the receipt read the hold, so both outcomes are
  now true — the drawn state is still exactly what renders on a forfeit.
Still open:
- **BKG-21 ("Your visit") is NOT built.** It needs the booked-vs-actual chair
  time (`started_at` / `completed_at` exist since 0018) and a new one-tap
  duration verdict — too long / right / rushed — which is a table nothing has:
  the design is explicit that it "goes to the shop as a number, not as a review".
  Left for its own increment rather than half-built.
- **G6 blocks the no-show forfeit receipt.** §4: "BKG-21 is close but is written
  for a completed cut." Still being designed.
- **The four §7 messages stay unwritten** — copy is not mine to draft.

## Slice 2 step 6 — ops can see it (0079, 2026-08-31)
Reads only; nothing in this file moves a dirham.
- **BKN-02 gains custody.** The money block already had service / deposit / cash
  / coupon. What it could not say is **who holds the deposit right now** — the
  question the desk opens the page to settle. `admin_booking_hold` reads 0075's
  hold: NOBODY / SHOP / CUSTOMER, with 0078's reason beside it.
- **BKN-04 is a new screen** at `#/bookings/refunds`, linked from Bookings.
  §6.3's rule is the whole design: "who bore it" is derived from which
  resolution fired, so the screen has no dropdown and nothing typed. Three
  causes — shop cancelled, cancelled inside the free window, ops override — and
  only the third costs Sterncut anything.
- **OVW-02's two rows** ride `admin_money_alerts`: shops over the float cap
  (unshifted to the top — §6.6 calls these the fastest way to lose real money)
  and shops unsettled past one cycle. The hold limit is **7 days because §6.7
  settles weekly**; the design names no number.
- **SAL-10** gained deposits earned / still held / days since settled. Float cap
  and last settlement were already there from 0069.
Still open — and one of these is a real hole:
- **Recovering a refund from a shop does not exist.** BKN-04 draws a fourth row:
  "refunded in the hour, recovered from the shop eleven days later on Friday".
  Nothing here can claw money back once a shop has been settled —
  `salon_owed_cents` (0044) has no deduction term. So every refund the ledger
  can show cost either nobody or Sterncut. The screen **says so** rather than
  printing a zero that reads as good news. **This wants building before a shop
  ever shuts with no notice.**
- **BKN-06's "money stuck until a person decides" has no state.** The screen
  itself is BKN-02 with a linked case, which the console already renders, and
  its actions (refund the deposit, open a case) were built in 0069. But a hold
  resolves on completion whatever the customer says — there is no disputed state
  that parks the money. Needs a decision before it needs code.
- **OVW-02's rows are appended client-side**, not part of `admin_overview`.
  Fold them in whenever that function is next re-emitted.

## Slice 2 step 7 — the settlement number was wrong (0080, 2026-09-02)
Two bugs in `salon_owed_cents` (0044) were moving real money, both found by
reading BKN-05 and FIN-01 against the repo.
- **Forfeits were missing.** It counted deposits only `where completed_at is not
  null`, and its own comment called that "an open product decision". §6.3 and
  0075 had since decided it — no-show and cancel-after-window both resolve
  `to_shop` — so every forfeit a shop earned was missing from what we settled.
  We were **under-paying**.
- **Refunds were subtracted that were never added.** It subtracted every
  `deposit_refund` for the salon unconditionally, but a refund only happens on a
  booking that did NOT complete, whose deposit was never in the sum. Each one
  pushed `owed` down and `net` up, so we **over-collected** by the refund. 0078
  made in-window refunds routine, so this had started firing in normal use.
- **The fix is one source, not two more terms.** `deposit_holds` already records
  §6.3's outcome for every deposit ever taken, so `owed` is now "the holds that
  resolved the shop's way". Forfeits are in and refunds are out by construction,
  and `salon_owed_cents`, `admin_salon_money.earned_cents` and `ledger_check`
  now agree — they were three answers to one question.
- **`admin_settle_all` had never run.** It called the 3-argument
  `admin_settle_float` that 0044:183 dropped, so "Run settlement" raised
  "function does not exist" on the first shop. It also iterated the gross
  drawer, ignoring the netting §6.7 is about. Both fixed; the console's preview
  now shows the same net the round takes.
- **The owner's settle screen contradicted itself**: it drew "We owe you for
  finished cuts −X" and then "You hand over {gross float}". Both ends now read
  `net_cents`, and a negative renders as "WE OWE YOU" per §6.7.

## Slice 2 step 7 — SAL-21, raising a cap (0080)
§3 and §6.6 both say a cap raise needs a reason. Nothing enforced it: one chip
click wrote the column, with no reason, no audit row and no word to the owner.
- **A reason is mandatory in the risk-increasing direction.** 0077 made it
  mandatory on *narrowing* the deposit bounds; here it is mandatory on
  *raising* a cap. Not an inconsistency — what makes a reason mandatory is the
  direction that increases exposure, not the direction of travel.
- **The audit is 0066's `settings_changes` again**, with the shop inside the
  JSON since that table has no `salon_id`, plus `admin_cap_history` to read it
  back. A log nothing can read is not a log.
- **The percentage was measured against the wrong thing.** The console printed
  `float / cap`; `agent_cash_topup` refuses on `net + topup > cap`. Since
  net = float − owed, the display read *higher* than reality, so any raise
  argued off it over-provisioned. Both the panel and the dialog now use net.
- **`float_hold_days`** (default 14) is a real setting now. "the cap is 14" had
  existed only as a literal inside an assertion and in one line of copy.
- **`float_refusals`** finally makes "top-ups the cap turned away" countable.
  The refusal is a `raise exception`, so nothing written inside it survives —
  the row is written client-side from `CapHitSheet`, the same place
  `request_float_collection` already rides. Undercounts if the app dies between
  the refusal and the log.
Deviations from the drawn card, deliberate:
- **"SETTLE FIRST, THEN RAISE" settles; it does not queue a raise.** The card's
  copy ("Collect Thursday, then raise it") implies a pending conditional cap
  change. No such table exists and it is settlement-run-shaped work — it belongs
  with FIN-01, not bolted on here. The button collects and says so.
- **"Busiest shop in the Kasbah" is not drawn.** Nothing ranks a shop by volume
  within its district. The subtitle says what the repo can prove: bookings in 30
  days, and the current cap.
- **The owner's settle screen still hardcodes "the cap is 14"** in copy;
  `my_float` does not return `float_hold_days`. One line, next time it moves.
Still open:
- **`fill_booking` still refuses deposits under 40%**, so a 0%-deposit shop
  cannot take a voluntary partial. Unchanged since 0076.
- **The free-cancel window is platform-wide** (0078) though §6.4 says per shop.
  Still no screen that could set it.

## Trigger: slice 2 step 7 is only half done
T3 of the step-7 report is unbuilt and needs design before code:
- **No settlement period.** `float_settlements` has `covers_to` and nothing
  else — no period start, no week key, no `unique (salon_id, week)`. §6.7's
  "one settlement per shop per week" is unenforceable and BKN-05's
  `/settlements/2026-W48` address resolves to nothing.
- **No settlement lines.** Nothing links a resolved hold, a refund or a top-up
  to the settlement that discharged it, so "tap any line to see it", "a
  deduction must be traceable to a booking reference", and "corrections are new
  lines in the next one" have no join to stand on.
- **No settlement run and no release.** FIN-01 needs a `settlement_runs` entity,
  an idempotency key (a double-tapped Release writes the run twice today and the
  append-only trigger makes the duplicate permanent), a per-shop exclusion state
  with a reason, and a `finance` route — `NAV_ROUTE` has no `finance` key at all.
- **Paying a shop is not in any round.** `admin_settle_all` collects only;
  shops we owe are counted and reported, not paid.
Three drawn things contradict the spec and were NOT built:
- **"Sterncut fee · 8%"** — §1 says zero commission, §8 puts fees in slice 3.
- **BKN-05's −1 056 DH pass-cut hold** — prepaid passes were declined at 0047
  and cut from v1 in §8.
- **FIN-01's RIB / bank batch release** — §1: "No money moves through a bank, a
  gateway or a border in slice 2."
And BKN-05's own arithmetic does not close: the header chip says 1 566 DH, the
itemisation totals 1 514 DH. One of the two is wrong; the build needs telling
which before it can be drawn.

## Settlement step 1 — the period exists (0081, 2026-09-04)
`design_handoff_slice2_settlement/` §4's three tables, plus exclusions.
- **A run is a row because it is a draft first** (§2.1). A run that assembles
  itself as agents collect has no pay-out total until Thursday, and that total
  is Friday's whole question.
- **The week key is the Friday 21:00 cut**, Africa/Casablanca. The ISO week of
  that instant is the number the screens print — Fri 4 Sep 2026 is W36 and Fri
  28 Aug is W35, exactly as FIN-14 and OSH-16 are labelled — so the label is
  derived and there is no second week column to disagree with it.
- **§2.4 is enforced at two grains.** Per line, `hold − earned + carried =
  amount` is a CHECK constraint. Per statement, `settlement_run_imbalance`
  names any shop whose items do not sum to its line, and release will refuse.
  A difference with no line under it cannot reach an owner.
- **Append-only is a trigger, not a habit.** `statement_items` refuse update and
  delete outright and refuse insert against a non-draft run. `settlement_lines`
  freeze their money columns on write while leaving the visit columns movable —
  freezing the whole row would make FIN-15 impossible, freezing nothing would
  make a released week editable. Runs go draft → released → closed and never
  back, and their window cannot be moved.
- **Exclusion reasons are a typed enum with the sentence in SQL** (§2.2/§4), so
  the console and the owner's surface cannot render two versions of why a shop
  is out.
- **`float_settlements` is NOT duplicated.** It already records "we collected X
  from shop Y", and a second writer of that truth is the "second ledger is a
  second truth" failure §3.2 warns about. Step 4's release writes it *from* the
  settlement line, in one function.
Two of the four exclusion reasons cannot be derived and are ops-declared:
- **`unreachable`** — there is no route or agent-assignment table anywhere.
- **`wallet_open`** — an agent's cash has no open/closed session in 81
  migrations. Both were left declarable rather than invented.

## Settlement step 2 — "on time" was measured from the wrong moment (0082)
§2.6 says the clock runs from the oldest uncollected dirham. **Three shipped
functions already asked that question and all three answered it wrong.**
- `my_float().held_days`, `my_float().topups` and `agent_round().stops[]` all
  used a **timestamp cut line**: the oldest top-up after `max(covers_to)`. That
  is only correct if every settlement collected everything.
- It doesn't. `covers_to` is `default now()` and **nothing has ever set it** —
  0044's insert does not list the column — while `admin_settle_float` has always
  accepted an amount below expected. So a part collection stamps
  `covers_to = now()` and **resets the shop's float age to zero with our cash
  still in the till**, and the round then de-prioritises the shop it should be
  visiting. Step 7 makes partials routine, so this goes from latent to constant.
- Replaced with **FIFO by amount**: consume the shop's top-ups oldest-first with
  what we actually collected; the first one not fully consumed is the answer.
  This reproduces FIN-16's worked case exactly — Le Fade's clock starts Sat 29
  Aug 11:20, day 6 of 14 on Friday, not day 0.
- **A shortfall keeps ageing.** FIFO consumes on what the agent took, so
  `salon_gap_cents` is never consumed. Deliberate: it is still our money and it
  is still missing. The alternative makes a shop look current because we failed
  to find its cash.
- `my_float` now returns `hold_limit_days` — the owner's screen had been
  hardcoding "the cap is 14" while 0080 made it a real setting.

## Trigger: FIN-16 and slice 2 §6.3 disagree about who bears a refund
**Blocking step 3.** FIN-16's earned section reads `1 456 DH` for 38 cuts marked
done, then `Refund · deposit returned to the customer · STC-5140 · + 60 DH`,
totalling `1 396 DH`. STC-5140 is inside the range STC-5102 → 5188, so it is one
of the 38: the cut was done, the deposit was earned, and **the shop then loses
it**. Slice 2 §6.3 says the opposite — a completed cut's deposit is the shop's,
and "Sterncut bears a refund only when ops overrides in the customer's favour"
(`admin_refund_ledger`'s `ops_override` bucket, 0079:96, calls it "the honest
cost of support"). Both cannot be true and `earned_cents` on every line depends
on which is. Needs a decision before the draft run can be built.

## Settlement step 2b/3 — refunds, references, and the draft run (0083, 0084)
### The refund question, decided
FIN-16 and slice 2 §6.3 disagreed about who bears a refund on a cut that was
already marked done. **The screen won, narrowly scoped**: a refund is subtracted
from what the shop is owed only when that booking's hold resolved `to_shop` — so
it reverses an earning the shop actually had, while a refund on a booking that
never completed still takes nothing off it (0080's second bug stays fixed, and
this is emphatically not 0044's "subtract every refund").
- **Consequence worth naming: a support decision now costs the shop, not us.**
  0079's `admin_refund_ledger` still buckets an override as borne by Sterncut,
  which is now only true of refunds against bookings that never completed. That
  screen's copy is a step-6 problem; the money is right.
- **§6.8's nightly identity had the same hole and it predates all of this**: an
  ops refund on a completed booking credits a wallet without touching the hold,
  so `balances` rose while `to_shops` did not and the books drifted by exactly
  the refund. Only visible on an override, which is why nobody hit it.
  `ledger_check` now subtracts reversals from `to_shops`.

### References
`bookings.ref` (`STC-5102`) and `wallet_transactions.ref` (`WLT-8841`), sequence
backed, house pattern from 0038's `case_no`. §3.3's whole thesis is that a line
is defensible because it carries a reference and a time, and a uuid is not a
reference. Backfilled in `created_at` order via `row_number()` — a sequence read
through a subquery is not consumed in the subquery's order, and an out-of-order
`STC-5102 → 5188` range is worse than none. **The wallet backfill drops the
append-only trigger for the length of the migration and puts it back**, asserted;
writing the update so it slipped past the barrier would have been worse.

### The draft run (FIN-14)
`admin_cut_run` builds the week, `admin_run` reads it, `admin_exclude_shop`
handles the two reasons nothing can derive. New `finance` route, and the
**Finance row had to be appended to the rail** — no design turn ever drew it, so
the clone-the-fullest-sidebar trick could not find it.
- **The one thing §2 does not spell out**: a refund whose earning belongs to an
  already-released week. §2.8 makes it a carried line and FIN-17 draws ops
  choosing the week — but if that hand-run screen is the *only* path, a refund
  nobody processes vanishes from every statement while `salon_owed_cents` has
  already dropped by it, and the running total drifts from the sum of the weeks
  permanently. So **the cut writes the carried line automatically**; FIN-17
  moves one to a different week rather than creating it.
- **§2.3 read narrowly**: a suspended shop is excluded only when we OWE it.
  A suspended shop holding our cash stays in the run — suspending a shop is not
  a reason to leave our float in its till. Only the owed case is drawn.
- **§2.5 deviation**: a no-show and a cancel-after-window have no "marked done"
  moment, so a forfeit's week is stamped from `deposit_holds.resolved_at` — when
  the outcome was recorded. That is the fragility §2.5 exists to avoid, and the
  alternative is leaving forfeits out of every statement.
- **The first run covers one week**, so float older than the first cut stays on
  the pre-period `admin_settle_float` path. A migration-day artifact, not a
  model gap, but it means the first week's statements will look thin.
- `settlement_items_for` is **not granted** to authenticated — it reads any
  shop's movements and is called only from functions that check admin first.

## Settlement step 4 — release, and the two records become one (0085)
`admin_release_run` is the single act §2.1 asks for, and `admin_settle_line`
closes one visit.
- **§2.4 is a refusal at the gate, not a warning.** Release recomputes
  `settlement_run_imbalance` and raises with the shop's NAME if any statement
  disagrees with its own items. A run of 38 with an unnamed mismatch is a search,
  not a fix.
- **`float_settlements` now has one writer.** `admin_settle_line` closes the
  visit and calls `admin_settle_float` — where the money rules have always lived
  (refuses to collect more than the drawer holds, refuses to pay more than we
  owe, subtracts the known gap so a shortfall is not counted short twice). This
  is 0081's promise kept: the settlement line is the record, the float row is
  written from it.
- **The sign is the line's, never the caller's.** `admin_settle_line` takes a
  positive magnitude and derives the direction from the line, so a handover
  cannot be recorded as a collection by a caller getting a sign backwards.
- **A part payment stays on its line** — `visit = 'part'`, `collected_cents`
  accumulating, remainder rendered as "480 DH open". It never moves to a
  separate debt ledger. Step 7 carries what is still open at day 14.
- **A nil line is left at `pending` and reads "Closed" off its direction.**
  Marking it collected would be a small lie in the data, and adding a `closed`
  visit state would be an enum ADD VALUE needing its own migration for one word
  the UI can derive.
- The release audit rides in `settings_changes` again, subject in the JSON,
  read back by `admin_run_history` — same shape as 0080's cap change.

**Deliberately not built: the agent's collection screen.** §5 says `BCF-04`
collects a float from a *barber*, not a settlement from a *shop*, and the
difference is a receipt, a signature and the possibility of a partial. The
dispatch is the run's open lines, which `admin_run` already returns; ops records
the visit from the console for now. **Stop here and ask before drawing it.**

Still to build: step 5 (`FIN-16` + `OSH-16`/`OSH-17` from one fixture), step 6
(`FIN-17` → `OSH-18`), step 7 (the day-14 carry).

## Settlement step 5 — one statement, three surfaces (0086)
§3's own test: "FIN-16, OSH-17 and OSH-18 are the same statement on two
surfaces. They must agree line for line; a fixture that renders all three from
one row set is the right test."
- **There is exactly one builder.** `statement_json(line)` assembles it;
  `admin_statement` and `my_statement` differ only in who they let in and
  neither assembles anything. If the two screens ever disagree it is a rendering
  bug, because there is no second query to disagree through. The builder is
  revoked from `authenticated` — it carries no authorisation of its own.
- **§2.4 in the shape of the return value.** `total_cents` is what crosses the
  counter. `subtotal_cents` is returned always but **rendered only when a
  carried line follows it** — on both surfaces. No carry, no subtotal, and the
  statement is one number with its lines under it. A bare smaller number above
  the total is the failure mode every decision in §2 exists to prevent.
- **§2.7: the owing direction is a different screen, not a minus sign.** Both
  surfaces branch on `direction` and print an unsigned amount. The owner's
  owing screen carries the `This is not a bill` panel the paid one does not
  need, and reverses the section order — the earning line first and largest
  when we owe him, our float first when he owes us.
- **§2.3 lands on the owner's own statement**: `my_statement` returns the
  suspension exclusion with the amount, the unlock date and the contact, so a
  held balance is visible while he waits. A held balance he cannot see is
  indistinguishable from a confiscated one.
- A draft is **not** readable by the owner: it can still change, and §2.1 is
  that a run is read whole and released as one act.
- New: `src/screens/StatementScreen.tsx` (Profile → Weekly statement) and
  console screen `s14b` at `#/finance/statement`, reached by clicking a run
  line. The run table's rows now carry the LINE id — a statement is the thing
  that has to be checkable, so a row opens its statement rather than the shop.

Still to build: step 6 (`FIN-17` → `OSH-18`, ops moving a carried line to a
different week) and step 7 (the day-14 carry of a part payment).

## Settlement step 6 — the correction (0087)
§2.8: a refund that arrives after a week was settled becomes its own line on the
next statement. The released week is never edited, and **the amount is read off
the refund record, never typed** — ops chooses the week and nothing else.
- **The freeze moved from insert to release.** 0081 froze a line's money the
  moment it was written; FIN-17's whole action is putting a line onto a week
  that has not gone out yet, and a draft that cannot be corrected is not a
  draft. Everything §2 actually promises — "the released week is never edited",
  "immutable once confirmed" — is about the released week, so that is where the
  barrier belongs. A draft line can now also be deleted; a released one cannot.
- **The two paths cannot double-write.** 0084's cut picks up carried refunds
  automatically and ops can now place one by hand, so both branches skip a
  refund whose booking reference already appears on a carried item.
- **`admin_carry_correction` moves the line with it.** §2.4 means the header is
  the sum of the lines, so adding a carried item has to move `carried_cents`,
  `amount_cents` and possibly `direction` — a big enough correction turns a
  pay-out week into a collection and the word follows the money. Only possible
  because the run is a draft.
- The timeline on FIN-17 is **joined, not narrated**: the cut being marked done,
  the week closing, the cash actually changing hands, and the refund. The fourth
  is why the other three are a problem.
- New console screen `s14c` at `#/finance/corrections`, with a Corrections tab
  on the run screen. "Edit week 35" is drawn struck-through and dashed — refused,
  and **not offered as a permission**.
- **OSH-18** is a sub-view of the owner's statement: tapping a carried row opens
  the facts, why it is on this week and not the last one, and the earlier week
  marked UNCHANGED. `THIS ISN'T RIGHT` files a support case and says on screen
  that that is all it does — §5's "no dispute state anywhere in the product",
  drawn honestly rather than as a flow that does not exist.
  - It files with `p_booking: null`: `file_support_case` checks the caller is
    the booking's customer or barber, and a shop owner is usually neither, so
    the reference rides in the detail.

Left: step 7 — a part payment's remainder carrying onto the next run at day 14.

## Settlement step 7 — the part payment and day 14 (0088)
§3.2's rail says a remainder "carries onto week 37 as its own line"; the brief
says it carries "at day 14". **Those are the two ends of one rule**: the
remainder stays on its own line while the visit is live, and carries onto the
week being cut once its own week is `float_hold_days` old.
- **Why it has to carry at all**, which the brief leaves implicit: if the agent
  takes 300 of a 780 line, the other 480 is still physically in the till and
  therefore still inside `salon_float_cents`. Leave it on a closed line and the
  shop's running total and the sum of its statements diverge by 480 DH forever
  — the same drift the refund carry exists to stop, arriving by another door.
- **Day 14 runs from the week closing**, not from the shop's float age. Both are
  defensible, but the week's closing date is already printed on the statement
  the owner is holding, and a second clock would be one more thing to argue about.
- **`statement_items.source_line`**, plus a unique partial index, so a remainder
  can be carried exactly once. The line's printed reference (`2026-W36-014`) is
  a row_number over salon NAME and would move if a shop were renamed — not an
  identity to hang money on, though it is still what the owner reads back.
- A pay-out we never delivered carries the same way with its sign intact: we
  still owe it, and it should appear on the week it is finally handed over.
- `admin_open_lines` feeds a rail panel on the run screen so a remainder is seen
  walking towards day 14 rather than met as a surprise line on next Friday's run.

**§9's seven steps are done.** What is deliberately not built, and why:
- **The agent's collection screen** (§5). `BCF-04` collects a float from a
  barber, not a settlement from a shop — different receipt, different signature,
  a partial is possible. Ops records every visit from the console until this is
  drawn. This is the one thing blocking a real Friday round.
- **A dispute state** (§5). `THIS ISN'T RIGHT` opens a support case and says so.
- **`FIN-01` / `FIN-02`** (§6) are still in the design file with an 8% fee
  column, a bank batch and a missing-RIB exclusion. Superseded, never read.

## The agent's phone — role split, visits, receipts (0089–0091)
`design_handoff_agent_collection/`. Built after the settlement period, which had
dispatched agent visits and then had nowhere to send them.

### 0089 — a field agent is not the head of ops
Before the screen, the permission it runs under. Every field verb checked
`is_admin()`, and so did every rule-changing one: **the same credential that let
a man collect 1 100 DH from a till also let him suspend a shop, move the
platform-wide deposit floor and release a settlement run** — on a phone carried
round Tangier with a bag of cash. The split is by CONSEQUENCE:
- moves cash a released run already decided → `is_agent()`
- changes a rule, a policy or a shop's standing → `is_admin()`
`is_agent()` is true for admins, so every shipped ops login keeps working.
`admin_settle_float` stays admin-only: an agent reaches it only THROUGH
`admin_settle_line`, which is security definer, so the money rules apply but he
cannot call it directly with an amount of his choosing against any shop.
The role CHECK is dropped by **what it checks, not its name** — an inline column
check gets an auto-generated name, and guessing wrong would have left the old
three-role constraint rejecting every agent while the migration reported success.

### 0090 — visits, receipts, codes
- **The round is a query over visits, not lines** (§5): one line can take two
  visits — a partial, then a return — and 0085 put the visit state ON the line.
- **§3's two proofs are not unified, by design.** Collect takes the owner's
  4-digit code (a signature drawn on the agent's phone is drawn by whoever holds
  the phone, so it cannot prove he was in the shop — which is the fraud in that
  direction). Hand over takes the signature and asks for no code. A CHECK makes
  each `verified_by` carry its own evidence.
- **A receipt carries the LINE as well as the visit** — not in the spec, but
  §5's "sum of a line's receipts never exceeds the line amount" has to be
  enforceable in one place and a visit is not it. That and "a hand-over is never
  partial" are triggers, not tests.
- **The bag is derived, never stored.** AGT-01's strip and AGT-03's "into your
  bag" row call one function over receipts since the last drop, so they cannot
  drift. §6.1's "no balance column anyone updates", applied to his own risk.
- The code uses `random()`, not pgcrypto: `gen_random_bytes` lives in the
  extensions schema and `search_path` is empty in these functions. Four digits,
  read aloud, single use, two-hour expiry, bound to one visit AND one amount,
  spent on use — guessing is not the attack.

### 0091 + `src/screens/AgentRoundScreen.tsx`
- **The code's amount binding is a CEILING, not an equality.** The owner reads
  it out for what he owes and a partial is normal, so exact binding would make
  every short payment fail. As a maximum it still stops a replay for more than
  he ever saw.
- **A partial closes the visit.** The shortfall rides on the LINE and returns on
  a later statement (0088); a visit left open would be a second place the same
  debt lived.
- The round sorts by **day first, then age of money** — a Monday visit stays
  below today's even when its money is older, which is why AGT-01 draws it
  sunken. Distance is not returned at all (§2.2).
- **The cap warning is about the round, not the next tap**: the collections
  still ahead of the next hand-over, taken together. `bag + next visit` would
  stay quiet until he was already over — 9 700 + 1 240 fits, 9 700 + 1 240 +
  1 566 does not.
- Signature capture is `PanResponder` + `react-native-svg` (already installed).
- Profile now shows **Your round** for `agent` or `admin`; the old float pickup
  (BCF-04) stays, relabelled, because it is a different act.

**Blocking, owner-side, not built (§3 says flag and stop):**
- **The 4-digit code on the owner's own statement.** `my_visit_code()` exists
  and returns it; nothing renders it. Until it does, an agent cannot complete a
  collection — this is the one thing stopping the surface working end to end.
- **The *received* confirmation** AGT-05 promises ("his app shows it as received
  within a minute").
- **Offline and no-code fallbacks** (§3). Both need `verified_by: ops_call` —
  the enum value exists and nothing writes it — and a state visible on FIN-15.

## The owner's half of the visit (0092)
The two things the agent handoff said were missing and blocking. Both are on his
existing statement screen rather than new ones — he opens the week, and the
proof of the week is on it.
- **The 4-digit code.** `my_visit_code()` existed and nothing rendered it, so an
  agent literally could not complete a collection. It now appears under this
  week's statement when there is an open collect visit, with the agent's name
  and the amount he is coming for.
  - **The mint and the read are separate functions on purpose.** `my_visit_code`
    is volatile (it writes); `my_visit_status` is stable. Opening the statement
    asks the stable one first, so the screen never rotates the digits while the
    agent is standing there copying them down.
- **The received confirmation.** AGT-05 tells the agent to say "his app shows it
  as received within a minute — if it does not, do not tap again, call ops."
  That was not true. `agent_hand_over` now writes the owner a notification and
  the receipt shows on his statement with the agent, the time and how it was
  proved. A promise the agent reads aloud has to be one the product keeps, and
  it is the only reason he has not to tap twice when unsure.
- `agent_collect` notifies too — AGT-04 tells him "he already has the receipt in
  his app", which was also not true.

**Still not built, deliberately (§3 says flag, don't invent):**
- **No phone / no code fallback.** Needs `verified_by: 'ops_call'` — the enum
  value exists and nothing writes it — plus a person answering on a Friday
  evening and a state Karima can see on FIN-15.
- **Offline collection.** A device can queue a settlement but cannot verify a
  code it has never seen, so a queued collection is unverified until it syncs,
  and that state has to be visible to ops. Undesigned.

## Wiring the round (0093)
The three things that existed in SQL and had no surface.
- **Ops plans the round.** `admin_plan_visits` had shipped in 0091 with nothing
  calling it, so every agent's phone was empty and all of AGT-01…05 was
  unreachable. The released run screen now has PLAN N VISITS, an agent picker
  showing **what each one is already carrying**, and an optional time window.
  §2.4 again: nobody is sent out on a round that breaches his cap before he
  starts, so the picker warns when `already carrying + this round > cap`.
- **The agent's drop.** `agent_drop` existed with no button, so the bag only
  ever grew and the cap warning could never clear. A keypad sheet, not an
  all-or-nothing button — he may leave part of it and keep what the hand-overs
  still on his round need.
  - Not `Alert.prompt`: it is iOS-only, and because it returns void a
    `?? Alert.alert(...)` fallback fires **both** dialogs on iOS.
- **Ops sees the proof.** FIN-15 read the line's `visit` column, which says
  "collected" and nothing else. Each row now carries its receipts with
  `verified_by` — code, signed, or by ops call — because that is what makes a
  receipt evidence rather than a note, and it is the screen a dispute is settled
  on. Rows also say whose round an unvisited line is on.

Two prompts written for Claude Design, for the §3 gaps that must not be
invented: the **no-phone/no-code fallback** (`verified_by: 'ops_call'`, which
exists in the enum and nothing writes) and **offline collection** (a queued
collection is unverified until it syncs, and that state has to reach FIN-15).

## Unverified collections — the model and the queue (0094, 0095)
`design_handoff_unverified_collections/`. Money settled, proof not.

### 0094 — the two fields, and both §9 rules as barriers
- `verified_by` (which proof) and `verification` (whether it ran) are separate
  columns. Collapsing them was the failure the whole spec exists to prevent.
- **No function anywhere sets `verification = 'verified'`.** The only writer is
  `verify_queued_receipt`, which compares the stored digits against the real
  code; the trigger refuses the transition unless a session GUC set *inside*
  that function is live. §8's "no one in ops can mark a queued receipt verified"
  therefore survives someone writing a second function later.
- **"Confirmed with your code" is generated in exactly one place** —
  `my_visit_status` — and now reads `verification` first. Queued reads *waiting
  to be checked*, failed reads *the code did not match*.
- The guard is a **whitelist** (`verification`, `synced_at`, `incident_ref`) via
  `to_jsonb(new) - ...`: a blacklist stops protecting each new column somebody
  adds, and these are the columns a dispute is settled with.
- **A code the owner's app never issued is a mismatch, not an error** — §6 says
  the likeliest cause is a stale code, and a rotated-away code is exactly that.
  Treating it as an error would leave the receipt queued for ever.
- **Only a `code` receipt can be queued**, by CHECK: a signature is captured in
  the room and an ops call is proved by the call itself.

### 0095 — the queue
- **Two calls, not one.** The receipt is written `queued` with its real
  `code_captured_at`; the comparison is a separate call. Collapsing them would
  write a receipt that had always been verified and lose the gap — which is the
  only evidence a shop's money sat unchecked for three days.
- **DECISION the spec leaves open: the ceiling is client-enforced, and the
  server records a breach rather than refusing it.** The server cannot refuse a
  collect it has not heard of, and by sync the cash is already in his bag — a
  refusal would destroy the only record of real money. So it writes the receipt
  and notifies ops that his app should have stopped him.
- Offline capture rides the existing outbox (`src/lib/sync.ts`), which already
  survives force-quit and retries. The device names the receipt (`client_ref`,
  unique index) so a replay returns the first write instead of writing twice —
  the one part of offline immutability that is a barrier, not discipline.
- §5's two sentences on AGT-15 are kept **separate**: "there is no undo" is not
  softened by "I can't check these digits yet"; both are on the screen.
- The provisional receipt is amber and dashed, never red — he did nothing wrong.

Left, in §10 order: the sync check UI (AGT-17), the mismatch pair
(AGT-18/AGT-19, together or not at all), the clock and escalation **with both
feeds** — queued receipts and visits that went quiet, because a queue that never
syncs is invisible to the server — then AGT-20, the ladder, the duty call, audit.

## The sync landing and the mismatch pair (0096)
§10 steps 3 and 4, in one migration because step 4 says they ship together or
not at all: a failed check that exists only on the agent's phone leaves a number
on the owner's statement that nobody has questioned.
- **AGT-17 is quiet.** `agent_sync_queue` runs the comparison over his queued
  receipts and returns only what failed. A match changes nothing visible; from
  then on the receipt reads like any other.
- **AGT-18 takes the whole screen, not a sheet.** §6 pauses his round, and a
  dismissible modal would let him keep driving. He is asked for the one thing
  only he has, and **`I mistyped it` is offered first** — it is the commonest
  answer and burying it as a confession is how agents learn to avoid the queue.
  He does not phone and does not drive back; ops rings the owner.
- **AGT-19 is a question with his own money in it**, above everything else on
  his statement, with both answers' consequences on screen before he picks. It
  explains why his app was probably showing an old number and says plainly that
  nothing has changed.
- **The pause is on HIS answer, not the owner's.** Waiting on somebody else's
  phone would strand a whole round; answering unpauses him, and the outcome of
  the question does not.
- **Every answer is write-once**, enforced by the guard: neither party revises
  what they said, because a dispute is settled on what they said at the time.
- The guard's whitelist grew by four columns and each is write-once — a
  whitelist that grows without that rule is a blacklist with extra steps.
- §6's footer is now on every statement: *a line only says confirmed with your
  code when you typed those four digits and they matched.* It is what makes the
  phrase mean anything on the statements that do carry it.

Left: §7's clock and escalation with **both feeds** (queued receipts, and visits
that went quiet — a queue that never syncs is invisible to the server), the
release-time trigger, then AGT-20, the ladder, the duty call, the audit.

## The clock, and unchecked on the run (0097, 0098)
### 0097 — §7, and the hole in it
- **The escalation is one function called from two places** — the hourly sweep
  and `admin_release_run` — because §7's "whichever first" only means anything
  if both paths reach the same state.
- **THE HOLE, and the second feed.** The clock runs from `code_captured_at`,
  which the server only learns AT SYNC. A phone that never comes back is a queue
  the server cannot see, so the 72-hour rung could never fire on the exact case
  §7 was written for — "what happens when the app is never opened" was: nothing,
  silently. So the sweep also watches **visits that went quiet**: planned, past
  their window by three days, never closed, no receipt at all. It cannot know
  whether cash moved and does not need to; the alternative was silence.
- The 24-hour rung tells the duty desk **once** (`duty_notified_at`,
  write-once). §7's own reasoning: a queue that pages someone every evening is a
  queue people learn to ignore.
- `blocked` is not `at_ceiling`: the ceiling is how much unchecked cash he
  holds, blocked is how long he has held it.
- pg_cron on the repo's conditional pattern, and the notice says the
  release-time half still works without it because it is synchronous.

### 0098 — AGT-20
- **Three siblings, not a footnote.** `PROVED BY OWNER CODE`, `PROVED BY OPS
  CALL` and `COLLECTED, UNCHECKED` sit side by side on the run, on a draft too —
  saying `0 DH` is the point, so the column is not something that only appears
  when there is bad news.
- **`receipt_state` is derived server-side**, so the run, the release
  confirmation and anything built later cannot disagree about what a row is.
  Precedence: INCIDENT outranks everything, because it is the one a person is
  already working on.
- **Release still does not block** (§8: the money moved and 312 shops should not
  wait on one dead phone) — the confirmation just spells out what releasing will
  turn into incidents, and the audit note carries the count.
- `receipt_state` is `stable`, not `immutable`: it reads `now()` for the 24-hour
  rung, and a wrong volatility label comes back as a cached plan returning
  yesterday's answer.

**Tooling:** `sqlcheck.js` in the session scratchpad now runs dollar-quote
pairing, per-segment paren balance and arithmetic assertions over a migration
before it is handed over. Three apply-time failures in this session came from
`node -e` inside a double-quoted shell string eating a `$`; anything touching
`$$` goes through Edit or a script file now, never `node -e`.

## The ladder and walking away (0099)
§10 step 7. Two screens, one table (`visit_attempts`).
- **The third rung refuses a code read down the phone**, and that is the rule
  the whole mechanism rests on: a spoken code proves the owner agreed, not that
  the agent is in the shop. Accept it once and every code in the system asserts
  only the weaker of the two facts. When the owner answers, the flow routes into
  the ops call, where the conversation is captured.
- **The friction is a number about himself, not a delay.** His own ops-call rate
  against the team's, on screen before he taps — §2's reasoning is that a timer
  just teaches agents to wait it out. `agent_rates` serves both that screen and
  the Head of Ops' sort, so the two cannot differ.
- **Walking away is a recorded act**: name, time, geo, reason, and a line the
  owner sees, never a blank. An agent who cannot leave will invent a close or
  stand arguing with a barber.
- **Except while holding counted cash.** The server's half of that brake is a
  receipt existing on the visit; the app's half is having typed an amount. It is
  the one place the product refuses him an exit.
- **The second abandon takes the shop off him** — the visit is *unassigned*
  rather than reassigned, because who goes instead is ops' call, not a rota's.
- `visit_attempts` has **no `closed` column** despite §1 listing one: an attempt
  is by definition a visit that did not close, and a boolean that can only hold
  one value is a field somebody eventually sets to true.
- **The sweep's feed 2 now excludes visits with a recent attempt.** A visit he
  walked away from came back with a reason, so it is not silence; one nobody has
  touched still is. That is the "no abandon record" clause 0097 could not write
  because the row did not exist yet.

Left: the duty call (AGT-08, the 6-digit authorisation and both grades) and the
AGT-12 audit. §10 says cut 9 before 4 if the schedule slips — 4 shipped, so the
tail is all optional-order now.

## The duty call (0100)
§10 step 8. §4's first line is the design: **ops does not authorise the agent,
ops reaches the owner.** The duty officer is not deciding whether to trust the
man in the shop — they are the channel the owner vouches through, and the
witness to it.
- **The order is the security property, so it is two functions.**
  `admin_ops_call_agent_amount` REFUSES to run until the owner's figure is
  recorded. Taking the agent's number first puts it in the duty officer's head
  before they ring the owner, and *"is it 1 566?"* is a different question from
  *"how much did you hand over?"*. Neither figure can be retyped.
- **Six digits, ten minutes, read aloud.** Different length, different table,
  different function, different rendering from an owner code — §4's reason is
  that a four-digit authorisation would eventually be read as a code somebody's
  app issued.
- **The agent cannot read the digits.** RLS on `ops_calls` is admin-only: he is
  told them aloud, which is the whole mechanism.
- **The thinner grade still issues.** `owner_reached: false` means there is no
  owner figure to match and the agent stands alone; it carries a 72-hour dispute
  window and says so to the owner in his own notification. It issues because the
  alternative is an agent leaving a shop with unrecorded cash.
- A mismatch **issues nothing** and opens a discrepancy for a person.
- **`record_collection` is shared, and `agent_collect` was re-emitted to use
  it.** §3 says the two proofs are not one abstraction with a parameter and they
  are not — two functions, two verifications. But the money is the same money,
  and introducing a shared path while leaving the main caller writing its own
  copy would have made the drift worse: two paths, one of them *looking* unified.
- `km_from_shop` is haversine over `salons.lat/lng` and the geo on the ladder
  attempt that opened the call — §4 wants the distance beside the decision.

Left: the AGT-12 audit (ops-call receipts reviewed as a rate, with the two
thresholds written on the page). That is §10 step 9, the one it says to cut
first if the schedule slips.

## The audit (0101) — §10 step 9, and the last of it
AGT-12. §8's rules here are all about not turning a tool into a surveillance
list, and each one is in the shape of the code:
- **A rate, not a count.** `6 of 41 · 14.6% · 7× the fleet`. Six calls means
  nothing without the forty-one rounds they came out of, and `vs_fleet` is his
  share against everybody's, not his count against theirs.
- **Both thresholds are printed on the page** — 3 in 7 rolling days, 4 *owner
  not reached* in 30 — because a threshold people cannot see is one they cannot
  argue with. The same numbers are evaluated in SQL, so the rule and the page
  cannot drift.
- **Agents with zero are rows, not absences.** A list containing only people
  with a number on them reads as a list of suspects, and it is possible to work
  a round without ever needing the call. Their shape column says "never needed
  it".
- **Sorted by threshold then rate, never by raw count** — a busy agent would sit
  at the top for ever and the list would stop being read.
- **Only three of §8's four actions are offered.** Suspending "needs a second
  approver" and this product has no two-person approval anywhere; a one-tap
  suspend with that phrase in the copy would be a lie. The screen says what is
  missing instead. `morning_window` is the only one that changes the round
  rather than the man, and it is the one flagged as usually right.

**The unverified-collections spec is now built end to end** (0094–0101), except
the ops-call and audit CONSOLE screens' duty-call flow: `admin_ops_call_open` /
`_owner_amount` / `_agent_amount` exist and are correct, but the duty desk still
drives them by RPC — AGT-08's screen itself is not drawn. That is the last gap,
and it is the one that will change once a real duty officer uses it.

## AGT-08 — the duty desk's own screen (0102)
The last gap. `admin_ops_call_open` / `_owner_amount` / `_agent_amount` shipped
in 0100 and were drivable only by RPC; this is the page that walks a duty
officer through them, plus `admin_duty_queue` — who is standing in a shop right
now waiting for someone to ring an owner.
- **The queue sits ABOVE the audit** on `#/finance/calls`, because somebody is
  waiting and the audit is a thing to read on a Monday. It shows how long he has
  been standing there, in minutes.
- **The four steps are numbered and each unlocks the next**, mirroring the
  server's own refusal to take the agent's figure before the owner's. Step 1 is
  a button that does nothing but make him say "he is staying put", which is the
  point: §4's first instruction is to the agent, not to the system.
- **The owner's number is a `tel:` link from the record**, and when there is no
  number on file the step says so in red rather than leaving a blank the officer
  fills from the agent.
- **The six digits are shown once, large**, with "aloud, on the call — do not
  send them", the ten-minute life and the amount they are good for.
- **A discrepancy says the agent should not leave with the cash.** Nothing is
  issued and the screen says what each of them claimed.
- The panel beside it is §4's three: distance from the shop, bag against cap,
  unchecked queue, and his call rate against the team's — context for the
  officer, not evidence against him.

**The unverified-collections spec (0094–0102) is now complete**: model, queue,
sync, mismatch pair, clock with both feeds, release column, ladder, abandon,
duty call, audit, and the desk's own screen.

## The dry run (scripts/dryrun-settlement.mjs)
Twenty-three migrations of money code were applied without a single week ever
being pushed through them. This drives one, in the order the money moves, and
prints what each RPC actually returned — so what gets checked is output rather
than five surfaces.

`npm run dryrun -- --confirm`, with `SB_URL`, `SB_ANON_KEY` and three logins
(`DRY_ADMIN_*`, `DRY_AGENT_*`, `DRY_OWNER_*`). Three, because the whole design
is about three people who do not take each other's word: only the owner can see
the code, only the agent can collect, only ops can cut and release.

- **It refuses to start without `--confirm`.** Settlements and receipts are
  append-only by trigger, so nothing it writes can be deleted afterwards — by
  anyone. That is a feature everywhere except on a database you meant to keep
  clean.
- **It asserts the one rule that matters**: if a receipt whose `verification` is
  not `verified` ever reads as *confirmed with your code*, the script exits
  non-zero and says so. That is the phrase §6 says would quietly destroy the
  meaning of every code in the system.
- **It checks that AGT-18 shipped with AGT-19**: after forcing a mismatch it
  reads the owner's side, and calls it out by name if the question is not there.
- It captures the offline receipt **26 hours ago**, so the queued row lands
  already past §7's duty-desk rung rather than needing a wait.

Three things it deliberately cannot do, and says so in its own output:
- **the 24 h / 72 h escalation** — `unchecked_sweep()` is revoked from
  `authenticated` on purpose; run it as the owner in the SQL editor.
- **the day-14 carry** — needs a run whose `covers_to` is a fortnight old, and
  0081's guard forbids moving a run's window once it exists. Seed or wait.
- **the ops call** — drivable end to end, but it is two people on a phone, so it
  is worth doing on the screen rather than in a script.

## Notification routing + barber profile handoff (2026-09-11)
The Claude Design handoff "Notification routing + barber profile (T4)". Several
of its screens state rules the schema does not back, so this records what
shipped and every line that was changed or left out, with why.

Shipped:
- **G1 · BDY-14/15** — `RescheduleAskScreen`. A reschedule notification opens
  the ask with its cost to the day (fit against hours, breaks, buffers and
  bookings; waitlist asks for both days; notice on the slot it empties) and,
  after a yes, the day with that slot and OFFER IT TO THE WAITLIST. No migration.
- **G2 · BRV-08/09** — `BarberReviewsScreen`: breakdown, filters, one review
  with reply (`PublicReplyScreen`) and report (`review_flag`). From Profile and
  from a review notification.
- **G3 · BNT-05** — `HeldBackScreen` plus a dashboard card once per finished
  cut. 0108 adds the one exception, `notification_prefs.cancel_breaks_silence`.
- **G3 · NTF-10** — `PushOff` replaces the customer settings header when the
  phone denies push; the switches stay, greyed and out of force.
- **T4 · BPR-06/07/08** — `BarberProfileEditScreen` replaces the light editor
  (the owner's map pin moved with it); preview opens the barber's own page with
  booking dead; 0109 adds `barbers.languages` and a server-side name lock with a
  thirty-day "formerly".
- Fixed on the way: the barber inbox threw on `moderation`/`shop_status` rows,
  and the dashboard bell filtered on `barber_id`, which 0037 renamed.

Changed from the mock, deliberately:
- Copy about customers is pronoun-free ("GIVE ANAS 16:00", not "GIVE HIM").
- BDY-14 has no customer quote (0034 stores none); demand reads "asked for that
  day" (asks are per day, 0050); "already paid" only when a deposit covers it.
- BDY-15 drops "the two who wanted 16:00 have been told" and "no second move
  today" — neither happens.
- BRV-08 drops "the 4.9 is the last twelve months" (every rating in the app is
  all-time) and tags (never stored). BRV-09's "yes or no, in writing" became what
  happens: a removal is notified, a keep is not.
- BNT-05: requests die at their start time (0015), not "in 2 h"; the switch's
  "no sound" is dropped, because the push still carries sound.
- NTF-10 counts pushes the server never tried, plus those sent after the phone
  was first seen denied. Nothing earlier is claimed.
- BPR-06 shows the phone without "verified" and no licence name; BPR-07 has no
  "98% kept" or "30′" tiles, because it is the real customer page.

Still open:
- **Push-tap deep links.** The routing table's promise (a tap lands on the thing)
  holds only inside the in-app inbox; `onBannerAction` ignores a plain tap.
  **Trigger:** the first build that delivers push to barbers.
- **Requests expire in 2 h** (the handoff's contract) instead of at start time.
  **Trigger:** a product decision — it changes what customers wait on.
- **Waitlist asks for a time**, which would let BDY-14 say "asked for 16:00" and
  tell those people it went. **Trigger:** the ask sheet grows a time.
- **A message on a reschedule ask.** **Trigger:** BOOK-08 gains a note field.
- **Owner consent for a name containing a shop's name, and the licence-name
  check (BPR-08).** **Trigger:** an owner-side design, or the first barber who
  renames after a shop.
- **Review tags; a twelve-month rating window.** **Trigger:** LeaveReviewScreen
  collects tags / ops decides ratings age out (then apply it in one place).
- **Held back is derived from the cut, not queued.** One push at mark-done would
  need a trigger on `bookings.completed_at`. **Trigger:** barbers miss the card.

Apply 0108 and 0109 before shipping this build: Explore, Discover and the barber
editor select the new columns and fail without them.
