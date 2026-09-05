# Paste this into Claude Code

> Drop this folder into the same project as `design_handoff_slice1/`, `design_handoff_slice2/` and `design_handoff_slice2_settlement/`, then paste this.
> Or just type: `Read design_handoff_agent_collection/PROMPT.md and follow it.`

---

This is the ops agent's phone — the surface where a released settlement run becomes cash moving across a counter. `design_handoff_slice2_settlement/README.md` built the run, the statement and the period; it dispatched agent visits and then had nowhere to send them.

`design_handoff_agent_collection/README.md` is the spec. **Read it in full before writing any code**, with the settlement README open beside it. It does not repeat the money model.

The `design/*.dc.html` files are design references, not production code. Recreate them with this codebase's existing patterns. **The copy is exact and load-bearing** — several sentences exist so an agent can repeat them to an owner word for word.

## Read §1 first: this is not `BCF-04`

`BCF-04` takes a float off a barber: one person, one amount, no counterparty who could disagree. **Do not extend it.** A settlement has a shop rather than a person, a number that points either way, an amount that can be partial, a receipt, sometimes a signature, and no undo. If your plan starts with "generalise the float screen", start again.

## The security decision, because it shapes the data model

**Both proofs exist and they are split by direction.** Read §3 properly.

**Collect** takes the owner's rotating **4-digit code**, read out of his own app. It proves the agent was standing in the shop with a consenting owner — the actual fraud in that direction is an agent inventing a collection from his scooter. A signature can't prove that, because a signature on the agent's phone is drawn by whoever holds the phone.

**Hand over** takes the owner's **signature** plus a *received* confirmation in his app, and asks for no code. His presence was never in question; the money reaching him is.

Neither covers both directions. **Do not unify them into one "confirmation" abstraction** — that is the single most likely way to get this wrong.

## Before you write anything

1. **Does the shop side have anything that could generate a per-visit code today?** Bound to a visit and an amount, rotating, with an expiry. Everything in the collect direction depends on it and I do not believe it exists. If it doesn't, that is step 1 of the build, not a detail.
2. **Can a receipt be made genuinely immutable in this stack** — a real write barrier, not a state column plus discipline? If you can only give me discipline, say so now and tell me what you'd guard it with.
3. **Where does the agent's bag total live**, and can `AGT-01`'s strip and `AGT-03`'s "into your bag" row be guaranteed to agree? If they can drift, they will, and he'll trust neither.
4. **What you'd refuse to build the way I've described it.** Read §2 and §3 and push back.
5. **Your plan** in §8's order, mapped onto files you'd actually touch.

Then wait for me. Do not start until I confirm.

## What to build

**The five screen ids in §4, and nothing else.**

**Build the partial path first.** `AGT-02` with a shortfall is the normal case; the full amount is the special case of it. Doing it the other way round produces a partial that feels like an error, which is exactly what this design is trying to prevent — no red, no blocked button, no extra dialog when the number is short. One amber panel and a changed sentence.

**Do not implement the offline or no-code fallbacks** (§3). An owner with no phone can't read out four digits, and a device can't verify a code it's never seen. Both need `verified_by: code | ops_call` and a state Karima can see on `FIN-15`. I haven't designed either. Flag them and stop.

**Two owner-side screens don't exist** and this surface can't work end to end without them: the 4-digit code on the owner's own statement, and the *received* confirmation `AGT-05` waits for. Tell me when you reach them; don't stub them.

## Non-negotiables

- **Direction is a word.** `Collect` / `Hand over`, on rows, chips and buttons. Never a sign, never colour alone.
- **The round is ordered by age of money**, not distance. Day 9 above day 4 even across town.
- **Hand-over rows have no age.** Show that they don't, don't compute a fake one.
- **A hand-over is never partial.** All of it or close the visit.
- **A partial collection is not an error state.** The shortfall stays on the line and returns next week; the screen says so in words the agent can repeat.
- **No undo, and the design must not imply one.** Immutable on tap. A mistake becomes a correcting line on next week's statement, and it carries the agent's name.
- **Button labels carry the amount.** A generic `Confirm` on an immutable cash action is a bug.
- **The bag is real.** A running total against a cap, with the drop-off. It's his personal risk.
- **No fee, no commission, no bank field, no RIB, no card, no transfer.** The agent never types a number that isn't cash he can see.
- Money reads `3 240 DH`. `tabular-nums` everywhere, including keypad digits and code boxes. No centimes. Age reads `Day 9 of 14`.

## How I want you to work

1. Reconnaissance and plan first. Wait for me.
2. §8 order. Code generation and immutable receipts before any UI.
3. Exact copy from the designs.
4. Codebase wins on mechanism, designs win on appearance, the two READMEs win over both on money and proof rules. Genuinely unspecified? Ask.
5. Use the numbers in the designs — `1 566 DH` owed, `1 100 DH` taken, `466 DH` short, `3 570 DH` handed over, bag `9 700 DH` — so I can check your fixture against the screens by eye.
6. Don't refactor the earlier slices while you're in here.

## The one thing I care about most

This screen is held by a man carrying other people's cash, standing in a shop, in a hurry, in the sun. He has to be able to tell at a glance which direction this visit is, how much, and how late it is — and when he taps the last button he has to understand that nothing can take it back. Every decision in §2 and §3 exists for one of those two things: **legibility at arm's length, and a confirm that earns its irreversibility.**

Start with the four reconnaissance answers, especially whether a per-visit code can exist at all. No application code until I confirm.
