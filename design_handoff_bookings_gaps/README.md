# My Bookings — the thirteen undrawn states

`Customer - My Bookings.dc.html` turns **T14** (`BKG-32`–`BKG-41`) and **T15** (`BKG-42`–`BKG-44`). Every one is a branch that already exists in `MyBookingsScreen.tsx` / `MyBookingScreen.tsx` / `SupportScreens.tsx` and had never been drawn — no new features, no new tables. Repo at `a45ba537eeb5`.

Designs: `design/Customer - My Bookings.dc.html` (whole page) and `design/T14-T15.fragment.html` (just these two turns).

---

## §1 The deposit deadline is a moment, not a duration — `BKG-32` / `BKG-33`

`booking_free_until` (0078) is an RPC, deliberately: **the screen and `cancel_booking` must never disagree about whether the window has passed**, so the server does the subtraction and the client only renders it.

Copy rule, from `freeAt()`: always a clock time with a day word — `15:30 today`, `09:00 tomorrow`, `09:00 on Monday`. **Never** "up to 2 hours before" or a countdown.

| state | PAYMENT card footnote |
|---|---|
| `dep > 0`, still free | *Free to cancel until 15:30 today — the deposit comes back to your wallet* (green) |
| `dep > 0`, lapsed | *Free cancellation ended at 13:30 today. Cancelling now leaves the deposit with the shop.* |
| `dep > 0`, RPC not back yet | *Deposit refunded to your wallet if the shop cancels* — the pre-0078 line, still correct |
| `pending` | *Nothing leaves your wallet until the barber accepts* |
| `dep === 0` | *No deposit is taken — you pay the full price at the shop* |

`BKG-33` is `CancelSheet` after the window closed: same sheet as `BKG-08`, one number different, and the primary reads **CANCEL AND LOSE 24 DH** rather than CANCEL BOOKING. The secondary is unchanged (`KEEP IT — RESCHEDULE INSTEAD`) and the sheet adds one line saying a reschedule carries the deposit over, because that is the cheaper door and the customer cannot be expected to know it. **Reason stays optional** — the deliberate asymmetry with the barber's required radio rows; nobody owes a shop an explanation.

## §2 The cancel receipt says what the ledger did — `BKG-34` / `BKG-35`

`CancelledScreen` takes `refunded: boolean` **read off `deposit_holds` after the cancel, never recomputed on the screen**. If the rule and the ledger ever diverge, the receipt must show the ledger. Don't reimplement the free-window test here to decide what to print.

- `refunded: true` → *Refunded to wallet* in green with the figure, plus *Changed your mind?* reading "Your 24 DH is back in your wallet to spend on it."
- `refunded: false` → the existing `BKG-16`, 0 DH in accent, "Rebooking it doesn't bring the 24 DH back."
- `withdrawn: true` (`BKG-35`) → title **Withdrawn**, "Your request is gone. Karim never saw it, and nothing was charged." Wallet before/after, both the same number, on purpose — the same proof-it-didn't-move pattern as `BKG-15`. **No "Changed your mind?" card** (`!withdrawn &&`), because there is no released slot to talk about.

## §3 `MovedScreen` fires on the next open — `BKG-36`

Guarded by `AsyncStorage` key `moved_seen_<request.id>`: the barber accepts while the app is closed, so the acknowledgement is owed on next open, not on the tap that caused it. It is **shown once** and `dismissMoved` is the only way out (deliberately excluded from the Android back handler).

Dark card, WAS struck through → NOW, then `NEW TICKET` + `DEPOSIT CARRIED` — or `SERVICE` + `DUE AT THE SHOP` when there is no queue row or no deposit. The screen says when he answered ("21:40 last night") so the delay reads as his, not as a bug.

## §4 Declined with nothing offered — `BKG-37`

`DeclinedCard` has two modes and the difference is honest, not cosmetic:

| `alt_starts` | eyebrow | button | meaning |
|---|---|---|---|
| non-empty | `KARIM SUGGESTS` | ACCEPT → `accept_reschedule_offer` | he named these; accepting is done |
| empty | `NEXT FREE WITH KARIM` | ASK → `request_reschedule` | we scanned his calendar; he still has to accept |

The fallback is `nextFreeSlots()` — a real forward scan of `availability` / `days_off` / `time_blocks` / buffers / `booked_ranges`, fourteen days, first two free. Never present a scanned slot as an offer.

Also on this screen: chip reads **STILL CONFIRMED**, the footer swaps to `PICK ANOTHER TIME` / `KEEP THU`, and the `⋯` puck is replaced by a spacer (`declined ? <headSpacer/>`). `KEEP THU` sets local `keptOriginal` and the card disappears — it does not write anything.

## §5 `no_show` — `BKG-38`

Third chip on the Cancelled tab, from `row.status === 'no_show'`, alongside `CANCELLED BY BARBER` (accent) and `YOU CANCELLED` (muted). Deposit kept by the shop. The card offers a way to contest it — a no-show is the one cancelled state the customer didn't cause and can't otherwise answer.

## §6 `UnderReviewStrip` on the detail — `BKG-39`

38f. Mounted when `salon.status !== 'live'` and the booking is neither cancelled nor completed. **A shop vanishing from search must never read as a booking vanishing** — same card as always, one strip added: amber `SHOP UNDER REVIEW` chip, "Your booking still stands and Youssef is expecting you", a refund promise if they can't open, and `CANCEL FREE` / `MESSAGE`. The detail's own footer stays exactly as it is.

## §7 The full-screen `Receipt` — `BKG-40`

Behind the Completed tab's RECEIPT button. Seven fixed lines (ID, salon, barber, service, date, time, duration), then deposit-from-wallet and *Paid at the shop* = `price - deposit`. **No QR** — barbers have no scanner; add one only when a check-in flow exists. The screen says so, so nobody looks for a code.

## §8 Per-tab empty — `BKG-41`

`ListEmptyComponent` interpolates the filter: *No upcoming / completed / cancelled bookings*. `BKG-02`'s copy is right only for Upcoming. Body text is shared. The review nudge (`N visits waiting for your review`) sits above the list on Completed when `awaitingReview > 0`, so it and this empty state are mutually exclusive — `BKG-41` shows it once, boxed off, only to place it.

## §9 ⋯ → Report a problem — `BKG-42`–`BKG-44`

The header `⋯` is an `Alert` with *Message the barber* / *Report a problem* / *Close*; the middle one calls `onReport(d.id)` into the same `ReportProblemScreen` (17a) Help Center opens. **`bookingId` is the entire difference:**

- Help Center (`PRO-14`) loads the last 20 visits `.not('completed_at','is',null)` and shows a picker with *Change*.
- From the booking, `visitId` is already set: card fixed, no *Change*, no picker rows. And because the picker filters on completed visits, **this is the only door to 17a for a booking that hasn't happened yet** — `BKG-43` is drawn on tomorrow's 11:00.

Reasons are `REASONS` verbatim, unchanged, radio-style: no-show / wrong amount (+hint) / wrong service / hygiene / something else. Selecting **wrong amount** sends `p_amount_cents = deposit_cents || price_cents`, which is why `BKG-44` can print *Amount in dispute · 24 DH* without asking for a figure.

`BKG-43` states plainly that the booking is unaffected and the barber isn't told. A report that reads like a cancellation is a report nobody files.

`BKG-44` differs from `PRO-03` by one row: `onBack` returns to the booking, so the button is **BACK TO MY BOOKING**, not DONE. *View case* still opens the thread (`PRO-13`). A lost photo must never lose the report (`up.error → path = null`, submit continues).

---

## §10 Non-negotiables

- **The deadline is a moment.** Server-computed, rendered as `HH:MM today/tomorrow/on <day>`. Never a duration, never a countdown, and the screen never decides it locally.
- **The receipt reports the ledger**, not the rule. `refunded` comes from `deposit_holds`.
- **A withdrawn request has no money story** and no released slot — different copy, fewer cards, not a re-skin of cancelled.
- **`MovedScreen` shows once**, on next open, and names when he actually answered.
- **A scanned slot is never dressed as an offer** — `NEXT FREE WITH` + ASK, not `SUGGESTS` + ACCEPT.
- **Under review ≠ gone.** The strip adds; it never replaces the booking card or disables the footer.
- **Empty state names its own tab.**
- **Reporting changes nothing about the booking**, and the screen says so.
- **Reason is optional for the customer**, required for the barber. Don't harmonise them.
- Money reads `24 DH`, `tabular-nums`, no centimes. Canvas `#F2F0EB`, cards `#fff` r24 + `0 4px 12px rgba(0,0,0,.05)`, ink `#101010`, accent `#E8442E`, muted `#8A8A85`, border `#E5E2DB`, sunk `#F7F5F1`, green `#4ADE80`/`#15803D`/`#16A34A`, review chip `#F0E7D8`/`#8A6D2F`. Playfair Display, uppercase, for every `Display`.

## §11 Build order

1. `booking_free_until` wired into `Payment` — all five footnote states (§1). Cheapest, and it is the one the customer sees on every confirmed booking.
2. `CancelSheet`'s lapsed variant + `refunded` on `CancelledScreen`, from `deposit_holds` (§1–§2).
3. `withdrawn` receipt (§2).
4. Per-tab empty + the full-screen `Receipt` (§7–§8). Trivial, and they close two visible dead ends.
5. `no_show` chip (§5).
6. `UnderReviewStrip` mount (§6).
7. `DeclinedCard` fallback + `nextFreeSlots` (§4).
8. `MovedScreen` + the `moved_seen_` guard (§3).
9. The `⋯` sheet → 17a with `bookingId` → 17b (§9).

1–3 are one body of work and should ship together: they are the same question (what happens to the deposit) answered before, during and after the decision.
