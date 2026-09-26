# Handoff: Sterncut — launch readiness (everything from this session)

## Overview
Sterncut is a barbershop booking app launching in Tangier, Morocco. One binary serves two roles:
- **Clients** find a barber, book, and follow their live place in a shop's line.
- **Barbers and owners** run their day, their clients and their cash drawer.

This session got the product ready for the App Store and Google Play in four parts. Each part has its own folder with a detailed README (screen by screen, exact copy in FR / AR / EN), a PROMPT.md to paste into Claude Code, and the design files.

| # | Folder | What it covers | Screen IDs |
|---|---|---|---|
| 1 | `1_barber_store_readiness/` | Barber app (dark kit): Settings, sign-in & security, log out, delete account, client chat, PDF export, cash top-up redraw, help article | BST-00…06, DEL-01…03, MSG-01…03, EXP-01…03, BCF-02b, HLP-01 |
| 2 | `2_customer_store_readiness/` | Client app (light kit): delete account under the new rule, chat with real unread tracking, consent line at sign-up | DEL-04…06, MSG-04…08, SGN-01…02 |
| 3 | `3_legal_pages/` | sterncut.ma legal pages: privacy policy, terms of use, delete-your-account page (required by Google Play), plus a new site footer | WEB-14…16 |
| 4 | `4_store_assets/` | App icon, Android adaptive, monochrome and notification icons, splash, store screenshots, feature graphics, listing copy | ICN, AND, SPL, SHOT, FEAT, COPY |

## About the design files
Every `.dc.html` file is a **design reference built in HTML**: it shows the intended look, copy and behaviour. It is not production code. Recreate the screens in the app's real stack (React Native / Expo) and the website's stack, using their existing components and patterns. Open a `.dc.html` in a browser to view it; every screen ID is an anchor (`…dc.html#DEL-05`).

**Production-ready files, not references:**
- `4_store_assets/store-assets/*.png` are final exports at exact store sizes.
- `3_legal_pages/design/legal-content.js` holds the legal text in all three languages.
- `4_store_assets/design/store-content.js` holds the listing copy.

## Fidelity
**High fidelity.** Final colours, type, spacing and copy. Match them exactly, using the codebase's own components.

## Suggested build order
1. **Server rule: delete account anonymises instead of wiping.** Parts 1 and 2 depend on it. Removed: name, phone, email, photo, date of birth, bio, ID document, portfolio photos, chat messages and photos, coupons. Kept without a name: bookings, reviews (shown as "Former customer" / "Former barber"), and money records (kept 10 years by law). A wallet balance is forfeited because it can't be cashed out. The confirm word is the Latin `DELETE` in every language, and the server checks it too.
2. **Chat unread tracking:** store `last_read_at` per participant, then show a count per thread, a tab badge (capped 99+), a real "Unread" filter and a "New" divider in the thread. Remove every presence dot, "Online" label, mic and emoji button, plus "Call the shop" on the client side.
3. **Barber Settings and the rest of part 1:** BST, EXP, BCF-02b, HLP.
4. **Client screens:** DEL-04…06 and SGN.
5. **Legal pages on sterncut.ma**, the new footer on every page, and 301 redirects from `/{lang}/terms` and `/{lang}/privacy`. Register `https://sterncut.ma/supprimer-mon-compte` in Play Console.
6. **Store assets:** swap Expo's placeholder icon and splash, update app.json (snippet in part 4), and upload the listing.

## Rules that apply everywhere
1. **Nothing promises what the product doesn't do.** If a feature isn't built, its control isn't drawn. No "coming soon", no greyed-out teasers. A row with missing data (no phone, no linked booking, empty wallet) is removed, not disabled.
2. **Copy about barbers and customers is pronoun-free.** Name them ("Call Anas"), or say "barbers' books", "Former customer".
3. **Barber screens are read between two cuts:** one decision per screen, every tap target at least 44 px, list rows 64 px.
4. **Arabic:** `dir="rtl"`, mirrored layout, and directional icons flip. No uppercase and no letter-spacing on Arabic. Western digits. Money is written `340 DH` inside an LTR isolate. The DELETE field is `dir="ltr"`.
5. **Every string exists in French, Arabic and English.** The tables in each README are the source; don't write new copy.

## Design tokens
**Client app (light):** canvas `#F2F0EB` · cards `#FFFFFF` (radius 20, shadow `0 4px 12px rgba(0,0,0,.05)`) · ink `#101010` for hero surfaces, dark headers and primary buttons · text `#111111` · sub `#8A8A85` · body on canvas `#5C5C58` · hairline `#E5E2DB` · accent `#E8442E` on small things only · amber warning `#E8A33D`.

**Barber app (dark):** canvas `#0D0D0F` · card `#17171A` · sheet `#151517` · border `#26262B` · text `#FFFFFF` · sub `#9A9CA3` · accent `#E8442E` · green `#4ADE80` · amber `#E8A100` · red `#F87171`.

**Type:** Playfair Display (uppercase, spaced) for display titles · Inter for UI · Noto Kufi Arabic for Arabic display text and the website · IBM Plex Sans Arabic for Arabic UI text in the app.

**Components:** pill buttons 54 px (13 px / 700 / letter-spacing .1em / uppercase) · bottom sheets with a grabber, 28 px top radius, scrim `rgba(0,0,0,.52)`.

**Brand mark:** a Playfair Display Black "S" with a coral cut through its spine (see part 4, `Sterncut Mark.dc.html`).

## Open questions (collected)
- **SMS:** the store brief says the app sends no SMS. But the register screen says "We'll text a verification code", and the terms draft (WEB-15 §2) and the delete-account page (WEB-16) mention SMS. Decide, then align the app copy and the legal text.
- **Legal (part 3):** the whole text is a draft for a Moroccan lawyer. 36 sentences are flagged ⚑; the most important are the wallet under Bank Al-Maghrib rules (loi 103-12) and the reliability rating possibly counting as profiling (loi 09-08, art. 11). These are still [bracketed] and need filling: legal entity, address, RC, ICE, contact email, support phone, CNDP declaration number.
- **Deposits:** confirm how deposits flow, the refund when a shop cancels, and whether a deposit comes off the price at the shop.
- **Barber (part 1):** access-token lifetime (the copy says "within the hour"), the anonymised name "Former barber", and whether Apple / Google account linking is enabled.
- **Client (part 2):** ledger entry for a forfeited wallet balance; whether chat search exists; whether ops threads belong in the Unread filter.
- **Store (part 4):** screenshot 2 needs three real portfolio photos before export. The bottom tabs in screenshots 1, 5 and 6 are illustrative. Confirm that the barber Wallet shows a per-client activity list.
- **Website:** the sign-in session cookie and Cloudflare logs aren't in the privacy inventory yet.

## Files
Each part folder contains its own `README.md`, `PROMPT.md` and `design/` folder. Part 4 also has `store-assets/`, the final PNGs.
