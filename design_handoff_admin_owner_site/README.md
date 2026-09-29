# Handoff: Sterncut admin & owner website (admin.sterncut.ma)

## Overview
Previous handoffs (`slice1`, `slice2`, `slice2_settlement`, `agent_collection`, `unverified_collections`, …) shipped **canvases**: loose screens, each drawn in its own browser or phone frame, many with nothing linking to them. This handoff is the **one website** those canvases fold into. Every ops and owner screen now sits at a real URL, under a real menu item, for the role that is meant to see it.

- One site, **admin.sterncut.ma**. The account you sign in with decides what you see. Staff (`@sterncut.ma` email + authenticator code) get the ops console. Shop owners (phone + SMS code, the same account as the app) get their own shop.
- Of 242 canvas screens, **236 now have an address**. The 6 without one are app-only: the SMS in SAL-42, and customer/barber phone screens RVW-06, RVW-10, RVW-11, HOP-04 and OBR-09. `site-map.json` lists every screen id → section → URL → how it appears (page / tab / modal / drawer / state).
- The collection agent's phone app is a separate prototype (`Prototype - Agent App.dc.html`, AGT screens). It is not part of the website.

## About the design files
The files in `design/` are **design references built in HTML**. They show the intended look and behaviour; they are not production code to copy. Recreate them in the target codebase using its existing framework, router, auth and component library. If no environment exists yet, choose one (a React SPA with a file-based router fits the URL scheme below).

Open `design/Sterncut Site.dc.html` in a browser. It renders the whole site in a Chrome-style window:
- The address bar is live and editable, and back / forward / reload work.
- **Tweaks → Session** switches between the 7 accounts (or "Signed out").
- **Tweaks → Review → specIds** shows which canvas id you are looking at, bottom right.

Each section is its own file (`Site - <Section>.dc.html`), mounted by the shell and resolving its own sub-routes.

## Fidelity
**High-fidelity.** Colours, type, spacing and copy are final. Most section pages are the canvas screens themselves, with their links wired, so pixel values match the canvases and earlier READMEs. Where this README and an earlier handoff README disagree on **money or proof rules**, the earlier README wins. This handoff is about navigation, access and page structure.

---

## 1. The shell (`Sterncut Site.dc.html`)
- **Sidebar**: 216 px wide, `#111113`, right border `1px #1E1E22`, padding `20px 14px 14px`. From top to bottom:
  - Logo: a 28 px red tile `#E8442E`, then "STERNCUT" in Playfair Display 700, 14 px, letter-spacing .14em, with the sub-label ADMIN or OWNER.
  - Owners get a shop card (shop name + address).
  - Nav items: 38 px tall, radius 10, 13 px text. Active item: `#212125` background, weight 700, white. Idle item: `#9A9CA3`, hover background `#18181B`.
  - Count badges: amber `#E8A100` with dark text, or red `#E8442E` with white text.
  - Account card at the bottom. It opens a menu with **Lock screen** (staff only) and **Sign out**.
- **Top bar**: 62 px tall, bottom border `#1E1E22`. It shows the page heading (15 px, 700), a place line (`#6B6B72`), and a search pill with a ⌘K hint. Section files that draw their own header hide this bar (`shellTop` is false).
- **⌘K palette**:
  - Centred modal, max-width 620, `#141416`, radius 16.
  - Results are grouped: CUSTOMERS / SALONS / BARBERS AT THAT SHOP / ACTIONS / PAGES. ↑↓ moves, ↵ opens, Esc closes.
  - Typing a phone number (6+ digits) shows an amber strip: "Looking up a phone number is written to the audit trail, with your name."
  - Owners only search their own barbers and pages.
- **Lock screen**: comes up after 30 min idle or from the account menu. Blurred overlay, 6-digit code. Copy: "Nothing was lost — whatever you were typing on {page} is still there."
- **404**: "Nothing lives at {path}". Owners also see "Your account only sees {shop}."
- **Sign-in**:
  - Two tabs: *Sterncut staff* (work email; must end `@sterncut.ma`) and *Shop owner* (phone). Then a code step with 6 boxes that auto-submits on the 6th digit.
  - Staff get a "Trust this computer for 14 days" option.
  - There is no sign-up and no password reset (Karima adds people on the team page).
  - Error copy is in the file — use it exactly.

## 2. Roles and what each sees
| Account | Role | Home | Differences |
|---|---|---|---|
| Nadia Lahlou | Field ops, Tangier | `/overview` | can *ask* Karima (e.g. suspend) |
| Hicham Rami | Support | `/overview` | Requests shows his own ask, "With Karima" |
| Salma Amrani | Moderator | `/overview` | — |
| Karima Bennis | Head of Ops | `/overview` | Requests = "Waiting on you · 4", can decide |
| Youssef Alami | Owner, Le Fade Tanger | `/le-fade-tanger/today` | full owner web layouts |
| Karim Idrissi | Owner, Marina Barber Club | `/marina-barber-club/chairs` | shop suspended |
| Nabil Amrani | Owner, Coiffure Rif | `/coiffure-rif/shop/slots?day=sat` | Saturday slots story |

All staff see the same menu. **Permissions change actions, not pages**, following SET-03: an action above your role becomes an *ask* that lands in **Requests** and does nothing until Karima decides. Owners only ever see their own shop slug. Any other slug returns the 404.

## 3. Staff menu and URLs
Overview · Requests · Demand · Salons · Barbers · Customers · Bookings · Wallets & float · Finance · Support · Reviews · Compliance · Coupons (marked **Later**) · Settings

| Section | Main URL | Main sub-routes (see `site-map.json` for all) |
|---|---|---|
| Overview | `/overview` | every row links onward (see §5) |
| Requests | `/requests` | new page — Karima's inbox / everyone else's "With Karima" |
| Demand | `/demand` → **section home** | `?view=map`, `?view=list`, `/demand/tangier/{district}`, `/demand/tangier?filter=no-supply`, `/demand/tetouan`, `/salons/recruiting/asks`, `/salons/applications?filter=refused-fixable` |
| Salons | `/salons` | `?state=live\|pending\|suspended`, `?select=3&bulk=…`, `/salons/{slug}`, `/salons/pending/tetouan-barbershop?approve=1…`, `/salons/new` |
| Barbers | `/barbers` | `?filter=cancels\|rating\|queue`, `/barbers/{slug}`, `/barbers/karim-idrissi/{cancellations,cap-review,cap-proposal,notices,day}`, `/barbers/refusals`, `/barbers/settings/cancellation-reasons` |
| Customers | `/customers` | `/customers/{slug}`, `/customers/erasure`, `/customers/mehdi-sabri/sanction` |
| Bookings | `/bookings` | `?view=exceptions`, `/bookings/refunds`, `/bookings/{id}` |
| Wallets & float | `/wallets` | `/wallets/agents`, `/wallets/witnessed`, `/wallets/unchecked` |
| Finance | `/finance` | payouts, commission, VAT, charges, tips, `/finance/settlement/2026-W36` (draft ↔ released), `/…/agent-sheets`, statements (+ `?view=owner` preview), corrections, float, transfers |
| Support | `/support` → **section home** | `?view=cases`, `?about=money`, `?bell=1`, `/support/{case}`, `/support/incidents/INC-77`, `/support/threads/…`, `/support/tickets/PT-014` |
| Reviews | `/reviews` → **section home** | `?tag=waited`, `/reviews/flagged/RV-2291(?remove=1)`, `/reviews/appeals/{id}`, `/reviews/RV-2291` |
| Compliance | `/compliance` → **section home** | `?tab=follow-ups`, `/compliance/tasks/AUD-118`, `/compliance/overrides/OVR-004`, `/compliance/countersign/barbershop-nour`, `/compliance/applications/APP-338/refuse`, `/compliance/policy/{arabic,pass-withholding}` |
| Coupons | `/coupons` | held from v1; screens kept as spec, tagged LATER |
| Settings | `/settings` | `/settings/{team,permissions,audit,templates,districts,deposit-bounds,what-sterncut-takes,pricing,reliability}` |

**URL conventions**
- A modal or drawer is a query on its parent page (`?remove=1`, `?invite=1`).
- Closing it (Cancel, Close, clicking the dark backdrop) goes back to the parent URL.
- Tabs are `?view=`, `?state=` or `?filter=`.
- A breadcrumb root always links to the section's main URL.

## 4. Owner menu and URLs (prefix `/{shop-slug}`)
Today · Chairs · Services · Reviews · Payouts · Subscription · Reports · Your shop

- **Today** (`/today`) — a web layout that merges OSH-02, OSH-19 and OSH-03:
  - 4 KPI tiles (shop take 840 DH · occupancy 78% · waiting 4 · no-shows 1).
  - "The chairs · right now" table, with a 5-column grid.
  - Day-view timeline: one 42 px lane per barber, 09:30–15:30, with in chair / break / no-show legend.
  - Right column: Walk-ins card with a "Pause walk-ins, whole shop" ↔ "Resume" toggle, "Weekly settlement due 1 640 DH" card, and a "Needs a reply" card with 2 reviews.
- **Chairs** (`/chairs`, `/chairs/{barber}`, `?invite=1`, `/chairs/cash`, `/hand-over`, `/stand-in`):
  - Team list and barber detail.
  - Call and Chat give feedback (chat lives in the app).
  - "Remove from shop" asks first — "Remove Hamza from Le Fade?" with *Keep him* / *Remove him*, and copy about his 3 upcoming bookings.
- **Services** — side menu: Bundles · How long each takes · Too long or rushed · **Passes** (LATER, `/services/passes`).
- **Payouts** — `/payouts/2026-W35`, `/payouts/2026-W36` (`?late=52` state). "This isn't right" → "Sent to Sterncut — they reply within a day."
- **Subscription** — this month, plans, how it is paid, free month, August, October, if unpaid. The values are fixed at the canvas defaults: 4 chairs, 55 DH/month or 40 DH/year per chair, 148/200 SMS.
- **Your shop** — listing, poster (+ print / wall states), deposit (+ confirm dialog), hidden from search, pause.
- Owner pages drawn only as phone screens are shown in a centred column (max-width 640) with a row of section tabs. Phone bottom sheets become centred dialogs (max-width 560, radius 20) over their parent page.
- **Karim** sees his Chairs (BRB-30), hours (BRB-32) and payout (BKN-05). **Nabil** sees his Saturday slots (RVW-08/09) and chair 4 (RVW-12). Each owner's other pages show "The canvases only draw this page for one of the three shops."

## 5. New pages designed in this round (no canvas existed)
1. **Section homes** — Compliance, Reviews, Support, Demand (`Site - Section Home.dc.html`, prop `section`).
   - An intro line (12.5 px, `#9A9CA3`, max-width 640).
   - 4 clickable KPI tiles in an auto-fit grid (min 170): `#17171A`, border `#1E1E22`, radius 13; label 9 px/.14em/700 `#6B6B72`; value 22 px/800 tabular; note 10 px, coloured by tone.
   - Grouped cards in an auto-fill grid (min 300): each card has a 32 px icon tile, a 13 px/700 title, an optional tag, a 11 px sub-line and a chevron.
   - Tone borders: red `rgba(248,113,113,.3)`, amber `rgba(232,161,0,.28)`. All copy and targets are in the file's `D` object.
2. **Requests** (`/requests`):
   - Karima sees "WAITING ON YOU · 4" (Countersign Nour · OVR-004 · APP-338 · Suspend Le Fade), and each row opens the decision screen.
   - Everyone else sees the same rows marked "With Karima"; only Le Fade is clickable.
   - A "DECIDED" group holds the Arabic onboarding decision.
3. **Profiles** (`Site - Profiles.dc.html`) — one data-driven template (crumbs, pill, avatar, name, tag, 3 tiles, "call" panel with actions, sectioned rows) used for:
   - 5 shop pages: Kasbah Cuts, Salon Atlas, Marina Bay Cuts, Rif Gentlemen, Medina Cuts.
   - 5 barber files: Youssef, Hamza Bennani, Salim, Tarik, Mehdi Tazi.
   - Yassine Berrada's customer file.
   - The Branes district.
   - Karim's day (`/barbers/karim-idrissi/day`).
   - Week-36 agent sheets (`/finance/settlement/2026-W36/agent-sheets`), grouped by agent: Hicham, Yassine, not-yet-routed.
   - Salim's owner page.
4. **Owner's view preview** (`/finance/statements/2026-W36-014?view=owner`) — Youssef's payouts page, exactly as he sees it, under a 52 px amber bar:
   - A PREVIEW chip and the copy "Youssef's payouts page, exactly as he sees it. Nothing here can be changed from this view."
   - A "Back to the statement" button. Week 35/36 switching works inside the preview.
5. **Tangier city menu** on the Salons and Barbers lists: Tangier ✓ (42 shops live), Tétouan (1 shop applying · demand only → `/demand/tetouan`).
6. **Settings sub-nav** additions: Deposits · Take · Pricing · Reliability. Chip switches for models A/B/C and for Now/October.

## 6. Interaction rules applied across the site
- **List filters** (Bookings, Support, Customers, Settings audit/templates, Reviews tags, Barbers):
  - The filter hides the rows that don't match, and the header row never hides.
  - An empty result reads "None of the rows shown here are "{filter}"." It is phrased that way because the sample rows don't match the headline totals.
  - "All" or "Clear filters" restores every row and re-selects the original chip.
- **Choice chips** select (single choice per group): suspension and cap lengths, message starters, hand-over length, poster size, pause length.
- **Utility buttons** (Export CSV, Download PDF, Copy ID, Print agent sheets, Send me a test…) show a white toast, 2.2 s, bottom-centre: "Downloaded" / "Copied" / "Sent to the printer".
- **Action buttons with no drawn result** show a one-line result toast, or open the next page. The full list is in `Site scan.md` §D.
- **Stateful stories** (shell `world` state, persisted):
  - Marina: `hidden → suspended → lifted`, with Undo; Tweak "Marina starts" chooses the starting point.
  - Week-36 settlement: `draft ↔ released`.
- The shell persists the session, history and world in localStorage (`sterncut-site-v1`). In the real product that is simply the session plus server state.

## 7. Data made consistent across canvases
Apply these names everywhere (the canvases were updated to match):
- Le Fade Tanger's owner is **Youssef Alami**. Marina Barber Club's owner is **Karim Idrissi** (was Rachid Berrada).
- Marina's barbers are **Zakaria Boukhris** and **Tarik Lamrani**.
- Salon Atlas's owner is **Driss Ouali**; Kasbah Cuts' owner is **Adil Chakir**. This removes the clashes with Hamza Bennani and Omar Tazi.
- On the Refusals screen, Youssef Benali → Youssef Alami and Karim Ziani → Hamza Bennani.
- It is **Karima Bennis** everywhere.
- Le Fade is "suspension asked, waiting on Karima" everywhere. Nothing has happened to the shop.
- Known leftover: the finance screens say "Atlas Barbershop" and "Kasbah Classics" for Salon Atlas and Kasbah Cuts.

## 8. Design tokens (from the canvases — no external design system is attached)
- **Backgrounds**: page `#0D0D0F` · sidebar `#111113` · card `#17171A` · inset `#141416` · raised `#1B1B1E` · hover `#1C1C20` / `#18181B` · active `#212125` · chip `#26262B`.
- **Borders**: `#1E1E22` · `#26262B` · strong `#3A3A40` · hover `#34343A`.
- **Text**: `#FFFFFF` · secondary `#C9CAD0` · muted `#9A9CA3` · faint `#6B6B72`.
- **Brand / tone colours**:
  - Accent `#E8442E` (hover `#F0533D`, link hover `#FF6B57`).
  - Red `#F87171` on `rgba(248,113,113,.12)`.
  - Amber `#E8A100` on `rgba(232,161,0,.12)`.
  - Green `#4ADE80` on `rgba(74,222,128,.12)`.
  - Blue (Hamza lane) `#5B8DEF`.
- **Type**:
  - Inter 400–800 throughout; Playfair Display 700 for the logo wordmark only.
  - Scale: 9 / 9.5 / 10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 15 / 17–19 / 22 / 26 px.
  - Uppercase labels use letter-spacing .14–.15em at 700.
  - Every number is `font-variant-numeric: tabular-nums`. Money reads `3 240 DH`.
- **Radius**: 5–6 (tags) · 8–10 (buttons, inputs, nav) · 12–14 (cards) · 16–20 (modals) · 999 (avatars, pills).
- **Shadows**:
  - Menus: `0 16px 40px rgba(0,0,0,.5)`.
  - Modals: `0 30px 80px rgba(0,0,0,.55)`.
  - Toasts: `0 10px 30px rgba(0,0,0,.45)`.
- **Buttons**: primary 44–46 px tall, `#E8442E`, 12–12.5 px/700, letter-spacing .08–.1em, uppercase. Secondary `#212125` with a `#3A3A40` border.

## 9. Files
- `design/Sterncut Site.dc.html` — shell, sign-in, roles, routing, ⌘K, lock screen, world state. **Start here.**
- `design/Site - *.dc.html` — one per section. Each takes `path`, `go(path)`, `world`, `setWorld`, `openPal` and resolves its own sub-route.
- `design/Prototype - Agent App.dc.html` — the collection agent's phone app (AGT screens), separate from the site.
- `site-map.json` — every canvas id → section, URL and presentation. Use it as the routing checklist.
- `Site scan.md` — the gap audit and what was done about each item.
- `design/support.js`, `image-slot.js`, `ios-frame.jsx` — runtime for opening the references; not for production.

## 10. Still open (not designed; flag, don't invent)
- **Period pickers** (Finance weeks and months, Reports "Month"): other periods are the same screen with other numbers.
- **Other cities**: only Tangier has screens (Tétouan is demand-only).
- **App-only screens** SAL-42, RVW-06/10/11, HOP-04 and OBR-09 are not on the web.
- **Karim's and Nabil's Today** and the other owner pages were never drawn for their shops.
- **Coupons and passes** are held from v1. Their screens are spec only and must stay behind a flag.
