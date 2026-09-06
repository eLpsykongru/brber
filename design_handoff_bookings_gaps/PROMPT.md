# Paste this into Claude Code

> Drop this folder at the repo root, then paste this.
> Or just type: `Read design_handoff_bookings_gaps/PROMPT.md and follow it.`

---

Thirteen screens for the customer's **My Bookings**, all of them states that **already exist in the code** and were never drawn. Nothing here is a new feature, a new table or a new rule: it is `MyBookingsScreen.tsx`, `MyBookingScreen.tsx`, `SupportScreens.tsx` and `Failures.tsx` finally having pictures for their own branches. Read at `a45ba537eeb5`.

`design_handoff_bookings_gaps/README.md` is the spec — **read it fully before writing any code.** The `design/` files are references, not production code; recreate them with this codebase's own components (`Display`, `Row`, `Pill`, `Eyebrow`, `SalonCard`, `Payment`, the `s` stylesheets). **The copy is exact** — several strings exist so a customer reading a receipt a year later can tell what happened to his money, and one of them (§1) exists so the screen can never contradict `cancel_booking`.

## Where the risk actually is

**§1 — the free-cancellation deadline.** `booking_free_until` (0078) is an RPC on purpose. If you compute "is it still free" on the client anywhere — in `Payment`, in `CancelSheet`, in a helper — the screen will eventually promise a refund the server refuses. Render the server's answer; never derive it.

**§2 — the cancel receipt.** `refunded` is read off `deposit_holds` *after* the cancel. Do not recompute it from the rule to decide what to print. The receipt's job is to state what the ledger did.

Both are one-line temptations that quietly turn a truthful screen into a lying one.

## Before you write anything

1. **Is `booking_free_until` live at this commit, and what does it return when `deposit_cents = 0`?** The five footnote states in §1 assume it is null-safe. If it isn't, say so.
2. **Does `deposit_holds` let a screen read the outcome of a cancel synchronously**, or does `cancel_booking` need to return it? `CancelledScreen` takes `refunded` as a prop and cannot guess.
3. **`nextFreeSlots` already exists** in `MyBookingScreen.tsx` — is it fast enough to run on render of a declined card, or should §4's fallback be gated behind a tap? I'd rather change the design than ship a slow screen.
4. **What does `status` actually contain for a no-show** (§5), and who writes it — the barber's app or a job? The chip is only honest if a person set it.
5. **Where does the `⋯` sheet live** (§9)? It is currently a native `Alert`; if you'd rather it became a real sheet, that's a bigger change than this slice and I want to know before you start.
6. **Your plan**, in §11's order, mapped onto files you'd actually touch.

Then wait for me. Don't start until I confirm.

## What to build

**The thirteen ids in the README (`BKG-32`–`BKG-44`), and nothing else.**

**§11's order, and steps 1–3 ship together.** They are the same question — what happens to the deposit — answered before the decision, at the decision, and after it. Shipping the lapsed-window sheet without the refunded receipt means warning someone about a charge and then showing them a receipt that can't say whether it happened.

**Steps 4–5 are the cheap ones** (per-tab empty, the full-screen `Receipt`, the `no_show` chip) and they close visible dead ends. If the slice has to be cut, cut from the bottom: 8 and 9 before anything else.

**Do not add a countdown timer** anywhere near §1. The deadline is a clock time with a day word. A ticking number invites people to wait it out and turns a fairness rule into a game.

## Non-negotiables

- **The deadline is a moment, server-computed.** `15:30 today` / `09:00 tomorrow` / `09:00 on Monday`. Never a duration, never "2 hours before", never a countdown.
- **The receipt reports the ledger.** `refunded` from `deposit_holds`, not from re-testing the rule.
- **A withdrawn request has no money story** — different copy, no "Changed your mind?" card, wallet before and after shown identical on purpose.
- **`MovedScreen` shows once**, on the next open, via `moved_seen_<request.id>`, and names when he answered.
- **A scanned slot is never dressed as an offer** — `NEXT FREE WITH X` + ASK when `alt_starts` is empty, `X SUGGESTS` + ACCEPT when it isn't.
- **Under review is additive.** The strip never replaces the booking card and never disables the footer. A shop hidden from search is not a booking that vanished.
- **The empty state names its own tab.**
- **Reporting changes nothing about the booking**, the barber isn't told, and the screen says both.
- **Reason is optional for the customer and required for the barber.** That asymmetry is intentional; don't harmonise it.
- **No QR on the receipt** until a check-in flow exists.
- Money `24 DH`, `tabular-nums`, no centimes. Skin per §10 — `#F2F0EB` canvas, `#101010` ink, `#E8442E` accent, Playfair Display uppercase for every `Display`.

## How I want you to work

1. Reconnaissance and plan first. Wait for me.
2. §11 order; 1–3 as one unit.
3. Exact copy from the designs, including every footnote in §1's table.
4. Codebase wins on mechanism, the designs win on appearance, the README wins over both on money and truthfulness. Genuinely unspecified? Ask.
5. Reuse the existing numbers so I can check your fixtures by eye: `60 DH` service, `24 DH` deposit (40%), `36 DH` due at the shop, free until `15:30`, lapsed at `13:30`, ticket `Nº 07` → `Nº 04`, case `#R-4907`, booking `#B7C41D02`.
6. Don't refactor `MyBookingScreen.tsx`'s overlay machinery while you're in there.

## The two things I care about most

**That no screen can promise money the server won't pay.** Everything in §1 and §2 exists for that one reason. A refund line that is right 99% of the time is worse than one that is dull and always right, because the 1% arrives as an argument in a barbershop.

**That the states which aren't the customer's fault don't read like accusations.** A declined reschedule, a shop under review, a no-show he disputes, a barber who accepted at 21:40 — in every one of these the app is delivering someone else's decision, and the copy should sound like a messenger, not a judge. The one state that *is* about him — cancelling after the free window — is the only place the tone sharpens, and even there it names the cheaper alternative in the same breath.

Start with the reconnaissance answers, especially `booking_free_until`'s null behaviour and whether `deposit_holds` is readable right after a cancel. No application code until I confirm.
