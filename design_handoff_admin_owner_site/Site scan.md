# Sterncut Site — scan for missing screens

## Status after the fix pass
- **Done:** the two owner links; Karima's name; option chips now select; 42 utility buttons show a "Downloaded / Copied" note; the 13 missing pages (section B) are built; list filters on Bookings, Support, Customers, Settings audit log, Reviews tags and Karim's cancellations now filter the drawn rows, with an empty state; about 45 action buttons show a result note.
- **Also done since:** Owner's view preview on the Finance statement; Agent sheets page for week 36; Tangier city menu (Tétouan opens its demand page); Karim's day; Change the plan; Remove from shop asks first; Call and Chat respond; "By agent" opens agent rates.
- **Left as drawn, on purpose:** the period pickers (Finance weeks and months, Reports "Month"). Every other period is the same screen with different numbers, so there is nothing new to design.
- **Name clashes, fixed:** Salon Atlas's owner is now Driss Ouali, and Kasbah Cuts' owner is now Adil Chakir.

I checked every menu item, page, tab, pop-up and button in the admin and owner site, for all 7 accounts (Nadia, Hicham, Salma, Karima, Youssef, Karim, Nabil), and followed every wired button to where it lands.

**Short version:** every menu item opens a real page. The gaps are *inside* pages: 13 linked pages that were never drawn, about 40 tabs and filters where only one state exists, and about 60 buttons whose result was never designed.

---

## A. Menu items — all fine
All 14 staff menu items and all 8 owner menu items open a designed page, for every account. Support opens the live queue (SUP-04), Compliance opens the follow-ups list (CMP-01).
If a tab looks empty to you, it is almost always one of the in-page tabs in section C below.

---

## B. Pages that are linked but were never drawn — 13
Clicking these shows "No screen is designed for this yet".

**Shop pages** (only Le Fade, Marina and Tétouan are drawn)
- Kasbah Cuts — from the Salons list rows, the Live tab, multi-select, ⌘K
- Salon Atlas — same places
- Marina Bay Cuts — same places
- Rif Gentlemen — from the payout run row (FIN-01) and ⌘K
- Medina Cuts — from ⌘K

**Barber files** (only Karim Idrissi, Hamza Sabri, Zakaria Boukhris and Bilal Sekkat are drawn)
- Youssef Alami, Hamza Bennani, Salim Alaoui — from Le Fade's shop page team rows (SAL-10) and ⌘K
- Tarik Lamrani — from ⌘K
- Mehdi Tazi (licence expired) — from ⌘K

**Other**
- Customer file · Yassine Berrada — "His file" on DMD-04
- Demand district · Branes — Overview, "Where demand has no supply"
- Owner · Salim's chair — Youssef's ⌘K

---

## C. Tabs and filters where only one state is drawn — about 40
The tab is there, but clicking it has nothing to show.

**Staff**
- **Bookings** (BKN-01): Today · Pending · Upcoming · Completed · Cancelled — only "All" is drawn. Also the Salon and Source dropdowns.
- **Support**: Bookings 2 (SUP-06) · Mine 1 · Waiting 24h+ 3 (SUP-05) · Assigned to me · Waiting 3 · Closed (SUP-01 case list) · the "Oldest first" sort.
- **Customers** (CUS-02): Pay-up-front flag · 14 · Lapsed 60 days · 1 840 · Wallet over 200 DH · 312.
- **Barbers**: "Suspended · 0" tab · on Karim's cancellations (BRB-05): Under 2 hours · Never came back · Complained.
- **Reviews** (RVW-05): tags "price wrong · 11" and "not the barber booked · 6" — only "waited · 34" is drawn.
- **Settings**: Message templates — Money · Sanctions · Untranslated (SET-05) · Audit log filters — Money · Suspensions · Refused asks · Rule changes · Who: anyone (SET-04).
- **Finance**: Agent sheets · 38 (FIN-15) · Owner's view (FIN-16) · the month and week pickers.
- **Wallets & float**: "By agent" (AGT-12).
- **City picker** "Tangier" on every Salons and Barbers list — no other city is drawn.

**Owner**
- Reports: the "Month" period switch (ORP-01).
- Karim's Chairs: the week range (BRB-30).

---

## D. Buttons whose result was never designed — about 60
The button is drawn, but its confirm, sent state or next page is not.

**Staff**
- **Finance**: Release 39 payouts (FIN-01) · Message Youssef (FIN-16) · Carry / Schedule / Pay the 40 DH ourselves.
- **Wallets & float**: Hold payouts (SAL-03).
- **Salons**: Chase both invites · Tell the 34 when it opens (SAL-27) · Drop Atlas (SAL-18) · "Open the shop's page" — the public listing preview (SAL-04, 09, 10).
- **Barbers**: See his day, for Karim (BRB-03) — only Zakaria's day is drawn.
- **Support**: Snooze · Send, the case reply (SUP-01) · Open the engineering thread (SUP-02).
- **Demand**: Tell the seventeen something.
- **Settings**: Resend, a team invite · Require now (SET-02).
- **Reviews**: Send this to Coiffure Rif's owner (RVW-05).
- **Bookings**: See Coiffure Rif's week (BKN-03).
- **Compliance**: Add the day-two rule to suspensions.
- **Coupons**: Top up · Let it run out · Open · Send to me first · Clear the expired triggers.

**Youssef (owner)**
- Chairs: Yes, I'll run it / No thanks (standing in, OBR-04) · Call · Chat · Remove from shop · Share the code · Change the number.
- Services: Save and "The Groom" (OSV-02) · Send it and set 6 October (OSV-06).
- Reviews: Flag (ORV-01) · Reports: Mark settled in cash (ORP-01).
- Your shop: Save the listing (OSH-04) · I already sent it (OSH-08).
- Subscription: Change the plan (OSB-01) · Payouts: This isn't right.

**Karim (owner)**
- Look for a barber for chair 4 · Open later, close later (BRB-30) · Change them again (BRB-32) · Challenge the 70 DH (BKN-05).

**Nabil (owner)**
- Saturdays at 35 minutes / Try 30 first (RVW-08) · Keep at 35 / Go back to 25 (RVW-09) · Keep at 21 for now / Go to 28 on 1 March (RVW-12).

---

## E. Choice chips that don't select — no screen needed, they just need to toggle
Suspension and cap lengths (30 days, 3 months, Until we lift it, 14 days, Off — BRB-04, 07, 08, SAL-07) · message starters (BRB-14) · how the shop came to us (SAL-05) · hand-over length (OBR-03) · poster size A5 / Sticker (OSH-05) · pause length (OSH-09) · 2 a day (OSV-03).

## F. Utility buttons — 42, need only a small "Downloaded" or "Copied" note
About 30 × Export CSV · Download PDF · Copy the numbers · Copy ID · Print agent sheets · Send me a test · Download the 41 references · See it live.

## G. Other things the scan caught
- "Karima Benali" on AGT-20 — she is "Karima Bennis" everywhere else.
- Some buttons point to screens that already exist but aren't wired: Karim's "Open later, close later" → his opening hours (BRB-32), Nabil's "Saturdays at 35 minutes" → the six-weeks-on result (RVW-09) → chair 4 (RVW-12).

---

## Suggested order
1. **Quick wiring, no design needed:** the links in G, the chips in E, a small confirmation note for F, and the Karima name.
2. **The 13 missing pages in B:** reuse the drawn templates (shop page SAL-10, barber file BRB-03, customer file CUS-03, district DMD-03) with each one's data.
3. **The missing tab states in C:** Bookings, Support, Customers, Reviews tags and Settings filters first.
4. **The missing results in D:** confirm dialogs and "done" states, section by section.
