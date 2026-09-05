# Claude Design prompt — slice 2, T3 (settlement runs)

Paste everything below the line into Claude Design, in the same project as
`Sterncut Ops - Settings.dc.html`.

---

Sterncut is a barber-booking product in Tangier. Three surfaces on one Postgres
backend: a customer app, a barber/owner app, and an ops console (dark, 216px
sidebar, #0D0D0F ground, #E8442E accent, Playfair Display headings over Inter).

I need the **settlement** surfaces. Slice 2's money rail is built and correct —
what is missing is the *period*: nothing groups money into "this week's
settlement", so there is no statement to show and no run to release.

## What already exists, and is not up for redesign

- No money moves through a bank, a gateway or a border. An **ops agent visits
  the shop and takes cash out of the till**, or hands cash over when we owe.
- Every figure is derived from an append-only ledger. There is no balance column
  anyone updates; a mistake is corrected by a reversing entry, never an edit.
- One number per shop per week: `float we're owed − deposits the shop earned`.
  It can be **negative** — that means Sterncut hands cash over instead.
- A deposit's fate is derived, never typed: cut done → shop, no-show → shop,
  customer cancelled outside the free window → shop, customer cancelled inside
  it or the shop cancelled → back to the customer's wallet.
- Money is written `3 240 DH` — space thousands separator, space before DH,
  tabular-nums, rounded to the dirham, never a centime.
- A settlement is immutable once written. There is currently **no draft state**.

## Three things I need you NOT to draw

An earlier pass drew these and they contradict the spec. Please leave them out
and, if a layout needs something in that slot, tell me rather than inventing it:

1. **A Sterncut commission or platform fee.** Sterncut takes zero commission in
   v1. Fees and VAT are slice 3.
2. **Prepaid passes** — a hold against "55 pass cuts owed", a release forecast,
   any pack of cuts bought up front. Passes are cut from v1.
3. **Bank details** — RIB, IBAN, account-name matching, a batch payment file.
   There is no bank rail in this slice. Payment is an agent with cash.

## Screens to draw

### 1 · FIN-01 — the settlement run (ops console, new Finance section)
A weekly run across every shop. Some lines we **collect**, some we **pay**.
It has to answer, before anyone presses anything:
- how many shops are in the run, and the two totals (in and out) side by side;
- which shops are **excluded and why** — each one with its own sentence, not a
  count. A suspended shop's money is held; say what happens to it and when it is
  released, and say who tells the owner.
- what pressing Release actually does, given it cannot be partially undone.
Draw the run in at least two states: before release, and after.
I need to know from your layout: is a run a **draft that gets released**, or is
it built shop-by-shop as agents collect during the week? Pick one and say why —
that answer becomes a table, so I'd rather have your reasoning than a guess.

### 2 · BKN-05 — one shop's statement (both surfaces)
What the owner receives, and what ops sees. The earning line, then the
deductions, then the total. **Every deduction must carry a booking reference and
a time** — that's what makes it defensible rather than a smaller number at the
top with no explanation.
Draw it **twice**: once where the shop is paid, and once where the shop owes us.
The negative direction has never been designed and it is not a minus sign on the
same layout — the sentence is different and so is the action.
Also: the coverage window. If a statement is named for a week, what decides
whether a Thursday-night cut is in this one or next week's? Draw the boundary.

### 3 · The correction
A refund issued after a shop was already settled. Today nothing can recover it —
that money is simply lost, and I want to close it. §6.7 says "corrections are
new lines in the next one", so a recovery should be a **deduction line on next
week's statement**, not an edit to last week's.
Draw the line as the owner sees it, and draw whatever ops does to create it.
If the owner disagrees with a deduction, what happens? There is no dispute state
anywhere in the product yet, so if your answer needs one, say so plainly.

## Two decisions I need from you, in the note

1. **A statement's arithmetic must close.** An earlier version had a header
   total of 1 566 DH over an itemisation that summed to 1 514 DH. Which is the
   number the owner trusts — the one at the top, or the one the lines add to —
   and what is the other one for?
2. **What does "collected on time" mean?** We hold a shop's cash for at most 14
   days. Is a settlement "on time" measured from the previous collection, or
   from the oldest uncollected dirham? These give different answers for a shop
   that tops up daily.

## House style for the note

Write the turn note the way the previous ones read: name the decisions the
layout makes, say which alternatives you rejected and why, and flag anything you
drew that the backend would have to grow a table for. If a card can't be built
honestly with what I've told you exists, say that instead of drawing it.
