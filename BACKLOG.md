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
with social sign-in, email sign-in, register. Email/password is the real rail.
- **Google / Apple sign-in** — buttons alert "coming soon". Needs providers
  configured in the Supabase dashboard + `expo-auth-session` deep link. Do NOT
  fake it with a webview.
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
- **0047/0048 are unverified against a real Postgres** (no psql/CLI/docker on
  this machine). Run them against a branch before trusting the money paths.

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
