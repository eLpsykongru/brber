# Handoff: Sterncut — the ops agent's collection screens

Read this with `../design_handoff_slice2_settlement/README.md` open. That document owns the settlement model — the run, the statement, the period, the correction, the tables. **This one adds only the agent's phone**: the surface where a released run actually becomes cash moving across a counter.

Nothing in the money model is repeated here. If a rule about amounts, weeks or immutability is missing from this file, it is in the settlement README and it still applies.

## About the design files

`design/*.dc.html` are **design references created in HTML** — prototypes of intended look and behaviour, not production code to copy. Recreate them in this codebase's existing environment and patterns.

**Fidelity: high.** Final colours, type, spacing and copy. The **copy is exact and load-bearing** — several sentences exist so an agent can repeat them to an owner verbatim ("the 466 DH stays on this week's line and comes back on next Friday's statement"). Do not paraphrase them.

Open `design/Ops Agent - Collection.dc.html` in a browser and search for a screen id (`id="AGT-01"`).

## 1. Why this is not `BCF-04`

`BCF-04` (in `design/Barber - Float.dc.html`) takes a **float off a barber**: one person, one amount, no counterparty who could disagree. Do not extend it. A settlement is a different act:

- the counterparty is a **shop**, not a person;
- the number **points either way** — Collect or Hand over;
- the amount **can be partial**, and a partial is normal rather than an error;
- there is a **receipt**, and in one direction a **signature**;
- it is **immutable once recorded** — no undo, ever.

There is no bank, no card, no transfer, and no fee, commission, RIB or IBAN field anywhere on this surface. The agent never types a number that isn't cash he can see.

## 2. The five decisions this design makes

**2.1 Direction is a word, never a sign or a colour alone.** `Collect` and `Hand over` appear as words on every row, every header and every button. The agent reads this list on a scooter in the sun; colour is the first thing that goes. Green/amber/accent only reinforce.

**2.2 The round is ordered by age of money, not by geography.** The oldest uncollected dirham is what the 14-day promise is measured against (settlement README §2.6), so day 9 sits above day 4 even if it is across town. Route optimisation would quietly re-sort the list against the only deadline the business has. If you add distance sorting later it must be a visible, non-default choice.

**2.3 Hand-over rows have no age, and that is shown rather than faked.** Age measures how long a shop has held *our* money. When we owe them, nothing of ours is late — so the row reads `No age — they hold nothing of ours` and shows how long **they** have been waiting instead. Same list, two clocks, both named. Do not compute a fake age to fill the column.

**2.4 The bag is on the screen.** The agent walks around with cash and the amount is his personal risk: it is stated at the top, split into *collected today* and *still to hand over*, against a cap, with the drop-off. This is the number that makes him go to the office before the last visit. It is a real running total, not a nicety.

**2.5 A hand-over is never partial.** All of it or close the visit and let ops put it on another round. Partial only makes sense in the direction where the counterparty's till is the constraint. `AGT-02`'s keypad path does not exist on `AGT-05`.

## 3. What stops him recording a collection he didn't make

**Both mechanisms exist, split by direction. This is the core security decision of the surface.**

**Collect → the owner's 4-digit code.** The existing shop-side code survives and belongs here. The owner reads it out of his own app; it is tied to that visit and that amount and rotates per visit. It proves the agent was standing in the shop with a consenting owner — which is precisely the fraud in that direction: an agent inventing a collection from his scooter. A signature cannot do this job, because a signature captured on the agent's own phone is drawn by whoever is holding the phone.

**Hand over → the owner's signature, plus a *received* confirmation in his app.** A code proves nothing worth having here; the owner's presence was never in question, the money reaching him is. So no code is requested in this direction, and asking a man who has just handed over his cash to also sign for it (the reverse) is theatre that would make the real proof look optional.

Neither mechanism covers both directions. That is why both exist. **Do not unify them.**

### Gaps I did not design — do not invent them

- **No phone, no signal, no code.** An owner without his phone cannot read out four digits. The honest fallback is an ops call, which needs `verified_by: code | ops_call` on the receipt and a person answering the phone on a Friday evening. Not drawn.
- **Offline collection.** A device can queue a settlement but cannot verify a code it has never seen. A queued collection is therefore **unverified until it syncs**, and that state has to be visible to the Head of Ops on `FIN-15`. Not drawn.

## 4. Screens

| id | Screen | File |
| --- | --- | --- |
| `AGT-01` | His round — visits left today, oldest money first | `design/Ops Agent - Collection.dc.html` |
| `AGT-02` | Collecting — counting it with the owner | same |
| `AGT-03` | The confirm — his code, and no undo after it | same |
| `AGT-04` | The receipt — a partial, and what happens to the rest | same |
| `AGT-05` | Handing over — the owner counts it and signs | same |

422×894 dark iOS frame, 58px top padding, 18px gutters.

### 4.1 `AGT-01` — the round

Title block (`Your round` in Playfair 24px / `Friday 4 September · week 36 · 4 visits left`), then:

**The bag strip.** `IN YOUR BAG NOW 9 700 DH` (Playfair 30px) with `Cap 12 000 DH` right-aligned, an amber fill bar at 81%, two sunken tiles (`Collected today 6 130 DH` / `Still to hand over 3 570 DH`), and a live warning: *"One more collection puts you over the cap. Drop at the office on rue de Fès first — open until 20:00."*

**`NEXT VISITS` / `Oldest money first`**, then visit cards. Each card: shop name, address and distance, direction as an uppercase word above the amount, then a footer row separated by a hairline carrying the age. Card treatment escalates with age, not with size:

- day 9 of 14 → red border, red bar at 64%, `Do this one first`
- day 6 of 14 → plain border, amber bar at 43%, owner's name
- hand over → green-tinted border, `No age — they hold nothing of ours` + `Waiting 3 days`
- a later-day visit (Monday) → sunken, dimmed, no bar; it is on the round but not today

Footer: a green-ticked strip summarising what's done today, naming the partial (`Kasbah Classics was 300 of 780 DH`).

### 4.2 `AGT-02` — counting

Header row: back, shop name + owner name, `COLLECT` chip.

Then `HE OWES THIS WEEK 1 566 DH` (Playfair 32px) with `Week 36 / Day 6 of 14` right-aligned; the instruction label `COUNT IT WITH HIM, THEN TYPE WHAT YOU HAVE`; an accent-bordered amount field showing the typed figure with a caret; two chips — `Full amount · 1 566 DH` and `Clear`; a 3×4 keypad (`00`, `0`, backspace on the last row).

**The partial panel is the whole point.** When the typed amount is under the full number, an amber panel appears — `466 DH short — that is fine` — with the sentence the agent reads aloud: the shortfall stays on this week's line and comes back on next Friday's statement, nothing is added for being short, and nobody will call him about it. **This is not an error state**: no red, no blocked button, no confirmation dialog. The button label tracks the typed amount (`TAKE 1 100 DH`).

### 4.3 `AGT-03` — the immutable moment

A bottom sheet over a dimmed round, with a grab handle. Headline in Playfair: *"You are recording cash you have already counted."*

**Summary block** — four rows: amount and shop, `Direction · Collect`, `Stays on the line for next week · 466 DH`, `Into your bag · 7 230 DH`. The bag arithmetic is shown *before* the tap, not after.

**Code block** — `Ask Youssef for the 4 digits on his phone`, four 56px boxes (three filled, the fourth showing an accent caret), and the explanation: his app shows it under this week's statement, it changes every visit, and it is what proves the agent was in the shop.

**The no-undo panel** — padlock icon, accent-tinted: *"There is no undo. The moment you tap, this is on his statement and in our books. A wrong number can only be fixed by a new line next week — so count it twice, not once."*

Two actions: the accent `RECORD 1 100 DH COLLECTED` (enabled only with four digits), and `Go back and count again`. **The friction lives here and nowhere else** — no long-press, no second dialog, no typed confirmation. The code *is* the friction, and it does real work.

### 4.4 `AGT-04` — the receipt

Centred success mark, the amount in Playfair 30px, `Collected from Le Fade Tanger · 17:42`.

A four-row fact table: `Receipt SR-1184`, `Confirmed by Youssef's code · 4192`, `Taken by Hicham Rami`, `Week 36 · line 014`. The verification method is on the receipt because that is what makes it evidence.

An amber panel for the remainder: `466 DH still with the shop`, `Day 6 of 14`, and what happens — stays on week 36's line, moves onto next Friday's statement as its own line at day 14, *"you do not need to come back for it — the run will put it on someone's round."*

Two notes: the owner already has the receipt in his app and the line now reads `1 100 DH` paid, so the agent sends nothing; and a dashed grey panel saying a wrong number **cannot be changed here** — tell ops, they add a correcting line to next week's statement and **it will say your name** — linking to the support case that starts it.

Actions: `NEXT VISIT` (accent) and `Print slip`.

### 4.5 `AGT-05` — handing over

Header with a green `HAND OVER` chip. Then `COUNT OUT OF YOUR BAG AND GIVE HIM 3 570 DH` in a green-bordered card, with §2.5 stated in words: *"All of it, or nothing. A hand-over is not partial — if you are short, close the visit and ops puts it on another round."* Two tiles: `In your bag 7 230 DH` / `After this 3 660 DH`.

**The signature block** is a two-step checklist: step 1 ticked green (`He counted it himself · 10:11`), step 2 current (`Hand him the phone to sign`), then the pad itself — a 132px dark panel with a baseline hairline, the captured signature as a stroke, a `Clear` pill, and beneath it `Ahmed Ouazzani · on this phone · 10:12`. Under the pad: the signature is saved with the time, the phone's id and the location, **and no code is asked for here** — a code proves he was present, and that was never the question.

Then the no-undo panel in this direction's language: tapping says the cash left your hand; his app shows *received* within a minute; **if it does not, do not tap again, call ops.**

One green action: `RECORD 3 570 DH HANDED OVER`. Green, not accent — this is the giving direction.

## 5. Data — what the backend does not have

- **`settlement_visit`** — line, agent, direction, window (`from`, `to`), state (`planned | open | closed`), address snapshot. **The round is a query over this, not over `settlement_line`**, because one line can take two visits (a partial, then a return).
- **`settlement_receipt`** — visit, `ref` (`SR-1184`), amount, `recorded_at`, `device_id`, `geo`, `verified_by` (`code | signature | ops_call`), and `code_ref` or `signature_blob`. Immutable. One row per movement of cash, not one per visit.
- **`agent_bag`** — running held total per agent, split collected / to-hand-over, plus `cap` and drop events. `AGT-01`'s bag strip and `AGT-03`'s `Into your bag` row both read it, and they must agree.
- **`visit_code`** — per-visit rotating 4-digit code, bound to visit and amount, with an expiry and a used-at. It must be generated on the **shop side** and only verified on the agent side.

**Invariants worth tests:** the sum of a line's receipts never exceeds the line amount; a hand-over receipt's amount always equals the line amount exactly; no receipt may be written without a `verified_by`; a receipt is never updated or deleted; `agent_bag` equals the sum of that agent's receipts since his last drop.

## 6. Formatting — not negotiable

- Money reads `3 240 DH`: thin space separator, space before `DH`, **no centimes**, `tabular-nums` on every amount including keypad digits and the code boxes.
- Direction is a **word** — `Collect`, `Hand over` — in rows, chips and button labels. Never a sign.
- Age reads `Day 9 of 14`. Never a bare date, never "9 days ago".
- Button labels carry the amount: `TAKE 1 100 DH`, `RECORD 3 570 DH HANDED OVER`. A generic `Confirm` on an immutable action is a bug.
- Times read `17:42`. Dates read `Friday 4 September`.

## 7. Tokens

Ground `#0D0D0F`, card `#17171A`, sunken `#141416`, raised `#212125`, hairline `#1E1E22`, border `#26262B`, muted border `#3A3A40`. Text `#fff`, secondary `#D8D8DC`, tertiary `#9A9CA3`, quiet `#6B6B72`. Accent `#E8442E` = collect, the caret, no-undo. Green `#4ADE80` = hand over, done. Amber `#E8A100` = partial, age, bag cap. Red `#F87171` = the oldest-money row. Radii 12–18px cards, 26px sheet top, 999px buttons. Playfair Display 700 for amounts only; Inter 400–800 elsewhere. Buttons 54–56px tall (never under 44px), keypad keys 46px.

## 8. Build order

1. `settlement_visit` + `settlement_receipt` + `visit_code`, append-only, with §5's invariants as tests. The shop-side code generator comes first, because nothing can be verified without it.
2. `AGT-01` from a real released run — bag total, both direction words, age from `oldest_uncollected_at`.
3. `AGT-02` → `AGT-03` → `AGT-04` as one flow, partial-first: build the partial case before the full-amount case, so full is the special case of partial rather than the reverse.
4. `AGT-05` and signature capture.
5. Then, and only then, come back to me about the offline and no-code fallbacks in §3.

## 9. Files

```
design/Ops Agent - Collection.dc.html    AGT-01 … AGT-05
design/Barber - Float.dc.html            BCF-04 — the float pickup this is NOT (see §1)
design/Sterncut Ops - Finance.dc.html    FIN-15 — the released run these visits come from
design/Owner - Shop.dc.html              OSH-17 — the owner's side of the collect direction
design/ios-frame.jsx                     iOS device frame
design/browser-window.jsx                browser chrome for the ops screens
design/support.js                        runtime for the .dc.html files — not product code
```

The design file carries a **turn note** at `A1` stating these decisions in the designer's own words, including what was rejected. Worth reading before you argue with §2 or §3.

**Not built, owner-side:** the 4-digit code on the owner's own statement screen, and the *received* confirmation `AGT-05` waits for. Both are needed for this surface to work end to end and neither exists yet — flag it when you get there.
