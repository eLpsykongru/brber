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
