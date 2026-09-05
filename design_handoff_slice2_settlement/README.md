# Handoff: Sterncut — Slice 2, the settlement period

Read this with `../design_handoff_slice2/README.md` open, and slice 1's beside it. Slice 1 owns the product overview, seed data, tokens and type scale. Slice 2 owns the money loop: cash in over a counter, deposits held, deposits resolved, netting. **None of that is repeated here.**

This document adds one thing slice 2 described but never designed: **the period**. The money rail existed and nothing grouped it into "this week", so there was no statement to show an owner and no run to release.

## About the design files

`design/*.dc.html` are **design references created in HTML** — prototypes of intended look and behaviour, not production code to copy. Recreate them in this codebase's existing environment and patterns (or, if none exists yet, pick the right framework and implement there).

**Fidelity: high.** Final colours, type, spacing and copy. Recreate the UI closely, using the codebase's existing libraries. The **copy is exact and load-bearing** — most of these sentences exist to stop an owner concluding he is being charged a fee or robbed of a held balance. Do not paraphrase them.

Open a file in a browser and search for the screen id (`id="FIN-14"`) to find a screen.

## 1. The model in one paragraph

One number per shop per week: **float we are owed − deposits the shop earned**. It can be negative. Positive means an ops agent takes cash out of the shop's till; negative means the agent hands cash over. There is no bank and no gateway in this slice: no RIB, no IBAN, no account-name matching, no batch payment file. Releasing a run dispatches **agent visits**, not a payment instruction.

**Sterncut charges nothing.** There is no commission line, no platform fee and no VAT line on any screen in this bundle. Commission and fees are slice 3 and must not be introduced here — the credibility of both statement screens depends on the owner being able to see that no third number is skimmed on the way past. Prepaid passes are cut from v1 and appear nowhere.

**Append-only.** A mistake is corrected by a new line on a later week, never by an edit to a released one.

## 2. The eight decisions this design makes

Implement these; they are the spec, not preferences.

**2.1 A run is a draft that gets released.** It is cut at Friday 21:00, read whole, then released as one act. Agents do **not** build it as they collect through the week. Rejected because the pay-out total would not exist until Thursday, and that total is the only thing that answers Friday's question: is Sterncut collecting this week or paying? Consequence: a shop that goes live mid-week gets **no line at all** and must be named in words (`FIN-14`, Nord Barbier), not left as a missing row.

**2.2 Exclusions get sentences, not a count.** "38 of 42" is the number that gets a run released by mistake. Each excluded shop carries its own sentence naming the reason, and where money is involved, the amount.

**2.3 Held is not kept.** A suspended shop's money is ours to hand over and still theirs. Its exclusion sentence carries the amount, the date it unlocks, and the name of the person who tells the owner — and the amount plus that date appear on the owner's own statement while he waits.

**2.4 The total is the sum of the lines.** The header equals the lines beneath it. `1 566 DH` is what crosses the counter and is the only number the owner is asked to trust. `1 514 DH` survives only as a *named* subtotal ("this week"), and only because a carried line follows it. **A difference with no line under it is a bug, not a rounding** — worth a failing test.

**2.5 Coverage is stamped from the moment the thing happened.** A line lands in the week containing the moment it happened: for a cut, the moment the barber **marked it done**; for float, the moment the barber **took the cash**. Cut-off Friday 21:00. So a chair at Thu 21:40 marked done Fri 09:10 is this week, and a chair at Fri 20:50 marked done Sat 08:02 is next week. A late tap moves money a week and that is the accepted price — stamping the line with the appointment time instead would mean reopening a released week, which append-only forbids.

**2.6 "On time" runs from the oldest uncollected dirham.** Not from the previous collection. We hold a shop's cash 14 days maximum; the age of a shop's float is the age of its oldest unsettled movement. Measuring from the last collection would restart the clock at every top-up, and a daily-top-up shop could hold our money forever and never be late.

**2.7 The owing direction is a different screen, not a minus sign.** Different sentence, different colour, different action: nothing to receive and sign for, but an amount to have ready in the till before Friday evening. It also carries a sentence the paid screen does not need — *this is not a bill* — because the money going back is our own float that his barbers took over the counter.

**2.8 A refund after settlement carries forward.** It becomes its own line on the next statement, with the old booking's reference and both times on it. The released week is never edited. The amount is **taken from the refund record**, never typed by ops — ops chooses only which week the line lands in, so nobody can invent an amount against a shop.

## 3. Screens

| id | Screen | Surface | File |
| --- | --- | --- | --- |
| `FIN-14` | Settlement run · week 36, draft | Ops console, 1400×852 in browser chrome | `design/Sterncut Ops - Finance.dc.html` |
| `FIN-15` | The same run, released | Ops console | same |
| `FIN-16` | One shop's statement, ops side | Ops console | same |
| `FIN-17` | The correction — refund after settlement | Ops console | same |
| `OSH-16` | Week 35 — Sterncut hands him cash | Owner, iOS | `design/Owner - Shop.dc.html` |
| `OSH-17` | Week 36 — he hands the cash back | Owner, iOS | same |
| `OSH-18` | The 52 DH from a week already paid | Owner, iOS | same |

`FIN-16`, `OSH-17` and `OSH-18` are **the same statement** (Le Fade Tanger, week 36) on two surfaces. They must agree line for line; a fixture that renders all three from one row set is the right test.

### 3.1 `FIN-14` — the run before release

Three-part chrome: 216px sidebar (`design/Ops Chrome.dc.html`), 62px header, 46px tab strip (Settlement runs · Statements · Corrections), then a two-column body — fluid left, 308px right rail.

Header: `Settlement run · week 36` / `Draft · covers Fri 28 Aug 21:00 → Fri 4 Sep 21:00`, then `Print agent sheets` (secondary) and `Release 38 statements` (accent).

Left column, in order:
1. **Three stat cards.** `IN THE RUN 38 shops` (with `4 excluded · named below` in amber), `TO COLLECT — AGENT TAKES CASH OUT 21 480 DH / from 26 shops`, `TO PAY OUT — AGENT HANDS CASH OVER 9 340 DH / to 12 shops`. Both totals are visible **before** anything is pressed; this is the point of the screen.
2. **Net strip.** `Net across the city this week · 12 140 DH in`, with the definition of the number on the right.
3. **Lines table.** Columns: SHOP 190px · THEY HOLD 100px right · THEY EARNED 100px right · CARRIED 78px right · ONE NUMBER 115px right · VISIT fluid. Every row satisfies `hold − earned + carried = one number`. Direction is a word (`Collect` accent / `Pay out` green / `No visit` grey), never a sign. A `0 DH` row stays in the run and still gets a statement — *"a nil week is a fact, not a gap"*.

Right rail: the four exclusion sentences in a red-bordered card, then `A run is a draft, then released` (2.1) and `Nothing is skimmed on the way past` (no fee column, v1 charges nothing).

The four exclusions, verbatim in intent — four unrelated mechanisms, deliberately:
- **suspended** → we owe them 2 180 DH, held not kept, releases when the suspension lifts (review 18 September), Nadia Alaoui tells the owner today, and the amount and date sit on his own statement;
- **went live mid-week** → first covered week opens tonight, no full week to state;
- **unreachable** → the only agent on that route is off; their 1 240 DH stays with them and the clock keeps running, day 9 of 14;
- **agent wallet still open** → until it closes the float is a guess, and a guess cannot go on a statement.

### 3.2 `FIN-15` — the same run, released

Header becomes `Released Fri 4 Sep 21:04 by Karima Bennis` plus a `Locked · append only` pill with a padlock; the accent release button is gone.

Stat cards become progress: `COLLECTED 8 940 DH` of 21 480, 11 of 26 visits (green bar, 42%); `PAID OUT 9 340 DH`, all 12 shops (green, 100%); `STILL WITH THE SHOPS 12 540 DH`, 15 shops, `oldest dirham day 9 of 14` (amber card and bar, 58%). `8 940 + 12 540 = 21 480`.

Table columns: SHOP 200 · ONE NUMBER 120 right · DIRECTION 96 centre · WHAT HAPPENED fluid. Per-line states with who and when: `Collected` (agent, time, receipt id), `Handed over` (agent, time, owner signed), `Open` (next visit + oldest-dirham age), `Part paid` (`300 DH taken Fri 19:05 · 480 DH open`), `Closed` for the nil line. The collected row carries a `Statement` button to `FIN-16`.

Rail: what release actually did (38 statements out, 26 collections and 12 handovers on agents' phones, lines locked, **no payment file, because there is nothing to write it to**); the partial collection and where the remainder goes (carries onto week 37 as its own line, **not** into a separate debt ledger — "a second ledger is a second truth"); nothing can be edited (audit rows at `SET-04`, no partial undo); and the held balance, day 3.

### 3.3 `FIN-16` — one statement, ops side

Left column: a hero block (`TO COLLECT FROM THIS SHOP`, `1 566 DH` in Playfair 38px, and who counted it, when, and the receipt id), then the statement body as **section headers with lines under them**:

```
OUR FLOAT SITTING IN THEIR TILL                       2 910 DH
  Cash top-up taken by Youssef  WLT-8841  Sat 29 Aug 11:20     400 DH
  Cash top-up taken by Karim    WLT-8877  Mon 31 Aug 16:05   1 200 DH
  Cash top-up taken by Youssef  WLT-8902  Wed 2 Sep 09:48      810 DH
  Cash top-up taken by Anas     WLT-8930  Thu 3 Sep 20:11      500 DH
DEPOSITS THE SHOP EARNED                            − 1 396 DH
  38 cuts marked done in the window  STC-5102 → 5188      − 1 456 DH
  Refund · deposit returned          STC-5140  Tue 1 Sep 18:20   + 60 DH
This week's movement                                  1 514 DH
  Carried from week 35 · refund after settlement  STC-4471       + 52 DH
  (cut Thu 27 Aug 18:20 · refunded Tue 1 Sep 14:06 · case SUP-3312)
To collect                                            1 566 DH
```

Every line carries a **reference and a time** — that is what makes the number defensible. Line column widths: description fluid, reference 118px, time 150px, amount 96px right.

Below: a `LAST WEEK` strip — week 35, we handed this shop 1 720 DH, *closed and untouched by the 52 DH above*.

Rail: `Where the week ends` (2.5, with both worked examples in small bordered boxes, green for in-week and amber for next-week), `Two numbers, one of them trusted` (2.4), `On time, from the oldest dirham` (2.6, day 6 of 14 for this shop).

### 3.4 `FIN-17` — creating the correction

Left column, top to bottom:
1. **What happened, in order** — a five-step timeline with a 118px time gutter and a 1px connector: cut done and 52 DH released → week 35 closed and statement released → agent handed over 1 720 DH (*"week 35 is now cash in someone's hand"*) → refund issued Tue 1 Sep 14:06 on case SUP-3312.
2. **Two ways out, side by side.** `Edit week 35` is a dashed grey card with a struck-through affordance: refused, **and not offered as a permission**. `Carry it onto week 36` is the accent-bordered chosen card.
3. **The line this will create** — an exact preview of the row as it will render on both surfaces, plus two notes: the owner is told **once, when week 36 is cut** (a mid-week message about 52 DH is a fright, not a service), and the amount is not typed (2.8).

Rail: **there is no dispute state** (see §5), both directions use the same line with the opposite sign and it never becomes a separate debt, and what happens if the shop leaves before the week is cut (under 100 DH nothing is chased and nothing is suspended — same rule as the charge run).

### 3.5 `OSH-16` / `OSH-17` / `OSH-18` — the owner, iOS

422×894 dark frame, 60px top padding, 20px gutters, back-title-spacer header row.

**`OSH-16`, paid direction.** Green-bordered hero: `WEEK 35 · WE OWE YOU`, `PAID` chip, `1 720 DH` in Playfair 46px, then who brought it, when, that he counted and signed, the receipt id, and the coverage window. Then `HOW IT ADDS UP`: the **earning line first and largest** (`Deposits you earned 3 240 DH`, 41 cuts, id range), then each deduction as its own row with reference and time — three cash top-ups by barber name (300 / 560 / 600 DH) and a refund (60 DH, cut time and refund time) — then `We handed you 1 720 DH`. Closing note: the top-ups are our money the barbers took over the counter, and **Sterncut takes no fee from either side**.

**`OSH-17`, owing direction.** Accent-bordered hero: `WEEK 36 · YOU ARE HOLDING OURS`, `DUE FRIDAY` chip, `1 566 DH`, then the action — *have it ready in the till, Hicham comes Friday between 17:00 and 20:00, counts it with you and leaves a receipt* — and the coverage window. Immediately under the hero, before any lines, a tinted **`This is not a bill`** panel explaining that the 2 910 DH his barbers took is customers' wallet money, ours, sitting in his till. Then the lines: our cash in your till 2 910 DH → deposits you earned − 1 456 DH → refund + 60 DH → **`This week` 1 514 DH** → a tappable amber row `From last week · a refund + 52 DH` with the booking and both times → `You put on the counter 1 566 DH`.

**`OSH-18`, the carried line.** Amber hero: `ON WEEK 36 · CARRIED FROM WEEK 35`, `+ 52 DH`, one sentence of plain cause. A four-row fact table (booking, the cut with barber and time, the refund time, why — with the case id). Then **why it is on this week and not last week**: week 35 is closed, the 1 720 DH he counted was right when he counted it, we do not change a week he has already been paid for or he would be holding a receipt that no longer matches. A tappable strip back to `OSH-16` marked `unchanged`. Finally `THIS ISN'T RIGHT` with a caption saying exactly what it does (§5).

## 4. Data — what the backend does not have

- **`settlement_run`** — week, `state` draft | released | closed, `covers_from`, `covers_to`, `released_at`, `released_by`. The run being a *draft first* (2.1) is what makes this a row rather than a query.
- **`settlement_line`** — run, shop, direction, amount, visit state (pending | collected | part | paid | open), `settled_at`, `agent_id`, `receipt_ref`, `collected_amount`. Part-payment needs the collected amount on the line; the remainder carries at day 14.
- **`statement_item`** — line, kind (float_movement | deposit_earned | refund | carried), `booking_ref`, `occurred_at`, `amount`, `source_week`. **Append-only.** `source_week` is what lets a carried line name where it came from (`OSH-18`); without it the correction is indistinguishable from this week's money.
- **`oldest_uncollected_at`** per shop (2.6) — derivable from float movements but not answerable by any current table; the `STILL WITH THE SHOPS` card and every "day n of 14" on these screens read it.
- **Exclusion reasons** need to be a typed enum with a rendered sentence per case, not a nullable string — the sentence is product copy, not a log message.

**Invariants worth tests:** `sum(statement_item.amount) == settlement_line.amount` for every line; `sum(collect) − sum(pay) == run.net`; no `statement_item` may be written against a run whose state is not `draft`; a released run is immutable.

## 5. Missing state — say so, don't invent it

There is **no dispute state anywhere in the product**. `OSH-18`'s `THIS ISN'T RIGHT` opens a **support case** and nothing more; the case can only end in another line on another week. That is drawn honestly rather than as a dispute flow that does not exist. If a real one is wanted it needs a state on the statement line, a rule about who decides, and a message when it closes — **do not implement one from this bundle.**

Also unbuilt: **the agent's own collection screen.** `BCF-04` collects a float from a *barber*, not a settlement from a *shop*, and the difference matters (a receipt, a signature, a partial amount). When you reach it, stop and say so.

## 6. Standing contradictions in the design files

`FIN-01` and `FIN-02` are older screens in the same file and **contradict this spec**: an `8%` "our fee" column, a bank batch, a missing-RIB exclusion, commission pricing. They are superseded by `FIN-14`–`FIN-17`. **Do not read them as a source and do not implement them.** `FIN-03` (VAT at 0 DH) and `FIN-11`–`FIN-13` belong to slice 3.

## 7. Formatting — not negotiable

- Money reads `3 240 DH`: thin space as thousands separator, space before `DH`, **no centimes**, `font-variant-numeric: tabular-nums` on every amount.
- Signed amounts use `−` (U+2212) and `+`, never a hyphen, and only where a line's direction genuinely differs from its section.
- Direction is a **word** (`Collect`, `Pay out`, `Nil`), never a sign, in tables and headers.
- Times read `Fri 4 Sep 21:04`. Coverage windows read `Fri 28 Aug 21:00 → Fri 4 Sep 21:00`.
- Numbers stay LTR inside Arabic lines (slice 1 rule, still true).

## 8. Tokens used here

Ground `#0D0D0F`, panel `#17171A`, sunken `#141416`, raised `#212125`, hairline `#1E1E22`, border `#26262B`, muted border `#3A3A40`. Text `#fff`, secondary `#D8D8DC`, tertiary `#9A9CA3`, quiet `#6B6B72`. Accent `#E8442E` (collect, due, the one destructive-ish action), green `#4ADE80` (pay out, done, in-week), amber `#E8A100` (carried, open, held, warnings), red `#F87171` (exclusions, missing state). Radii: 10–14px ops panels, 18–22px owner cards, 999px owner buttons. Type: Playfair Display 700 for hero amounts only; Inter 400–800 everywhere else. Ops body 11–13px, labels 9.5–10px at `.13em` tracking; owner body 11.5–12.5px, hero 46px, section labels 10px at `.15em`.

## 9. Build order

1. `settlement_run` + `settlement_line` + `statement_item`, append-only, with the invariants in §4 as tests. Nothing renders before this.
2. The period itself: coverage stamping (2.5) and `oldest_uncollected_at` (2.6).
3. `FIN-14` — draft run, both totals, typed exclusions. This is the screen that proves the model.
4. Release as one act → `FIN-15`, plus agent visit dispatch and the audit rows.
5. `FIN-16`, then `OSH-16` and `OSH-17` from the same fixture.
6. Corrections: `FIN-17` → `OSH-18`.
7. Part payments and the day-14 carry.

## 10. Files

```
design/Sterncut Ops - Finance.dc.html    FIN-14 … FIN-17 (and older, superseded FIN-01/02 — see §6)
design/Owner - Shop.dc.html              OSH-16 … OSH-18
design/Ops Chrome.dc.html                the 216px ops sidebar, shared by the four ops screens
design/browser-window.jsx                browser chrome wrapper for ops screens
design/ios-frame.jsx                     iOS device frame for owner screens
design/support.js                        runtime for the .dc.html files — not product code
```

Each file also carries a **turn note** at the top of its newest section (`F4` in Finance, `T8` in Owner · Shop) stating the decisions in the designer's own words, what was rejected and why. Worth reading before you argue with §2.
