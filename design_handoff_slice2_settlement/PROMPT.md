# Paste this into Claude Code

> Drop this folder into the same project as `design_handoff_slice1/` and `design_handoff_slice2/`, then paste this.
> Or just type: `Read design_handoff_slice2_settlement/PROMPT.md and follow it.`

---

This is the rest of slice 2. `design_handoff_slice2/README.md` designed the money loop — cash in over a counter, deposits held, deposits resolved, netting — and then stopped short of the thing that makes it operable: **the period**. Nothing grouped money into "this week", so there was no statement to show an owner and no run to release.

`design_handoff_slice2_settlement/README.md` is the spec. **Read it in full before writing any code**, with slice 2's README open beside it. It does not repeat the loop, the tokens or the seed data.

The `design/*.dc.html` files are design references, not production code. Recreate them with this codebase's existing patterns. **The copy is exact and load-bearing** — most of those sentences exist to stop an owner concluding he is being charged a fee or robbed of a held balance.

## The three sentences that shape everything

**One number per shop per week: float we are owed − deposits the shop earned. It can be negative.** Positive, an agent takes cash out of the till. Negative, the agent hands cash over. Nothing else crosses.

**There is no bank.** No RIB, no IBAN, no account-name matching, no batch payment file. Releasing a run dispatches agent visits. If you find yourself building a payment instruction, stop — you have drifted.

**Append-only.** A mistake is corrected by a new line on a later week, never an edit to a released one. This is not a preference; §2.8 and the whole of `FIN-17` are about the one case where a naive implementation would edit.

## Before you write anything

1. **What slice 2 actually landed.** Specifically: is there a float movement row with a real timestamp on it, and can you answer *when was this shop's oldest unsettled dirham taken* from the rows alone? §2.6 and three separate screens read that number. If you cannot, say so before anything else.
2. **Where the period should live.** Whether a released run can be made genuinely immutable in this stack — a state column plus discipline is not the same thing as a write barrier. If you can only give me discipline, tell me now and tell me what you would guard it with.
3. **What you'd refuse to build the way I've described it.** Read §2 and push back. I would rather argue this week than hand an owner a statement whose header disagrees with its lines.
4. **Your plan**, in the build order in §9, mapped onto the files you'd actually touch — with step 1 broken down properly. The three tables and their invariants are the slice; the screens are views onto them.

Then wait for me. Do not start until I confirm.

## What to build

**The seven screen ids in §3, and nothing else.**

`FIN-16`, `OSH-17` and `OSH-18` are **the same statement** on two surfaces. Render all three from one fixture. If they can disagree, that is the bug I care most about.

**Do not implement a dispute state** (§5). `OSH-18`'s "this isn't right" opens a support case and nothing more. That is deliberate, and drawn honestly instead of inventing a flow. If you think the slice needs a real one, argue for it — don't build it.

**Do not read `FIN-01` or `FIN-02`** (§6). They are older screens in the same file and they contradict this spec: an 8% fee column, a bank batch, a missing-RIB exclusion. They are superseded. If you find a third screen that disagrees with §2, tell me rather than picking one.

**The agent's collection screen does not exist yet.** `BCF-04` collects a float from a *barber*, not a settlement from a *shop* — different receipt, different signature, and a partial amount is possible. When you reach it, stop and tell me; do not stub it with a form you made up.

## Non-negotiables

- **The header equals the sum of the lines.** Every statement, every time. Write the test before the screen. A difference with no line under it is a bug, not a rounding.
- **A run is a draft, then released as one act.** Both totals exist before anyone presses anything. No run that assembles itself as agents collect.
- **Exclusions are typed reasons with rendered sentences.** Never a nullable string, never just a count. A shop excluded because we owe it money carries the amount, the unlock date and the name of the person telling the owner.
- **Held is not kept.** A suspended shop's balance stays visible to its owner with the date it unlocks.
- **Coverage is stamped from the moment the thing happened** — the barber's mark-done tap, or the moment he took the cash. Not the appointment time. A late tap moves money a week, and we accept that rather than reopen a released week.
- **"On time" runs from the oldest uncollected dirham**, never from the previous collection.
- **No commission, no fee, no VAT line anywhere.** v1 charges nothing and the screens depend on that being visibly true. No prepaid passes.
- **Direction is a word, not a sign.** `Collect` / `Pay out` / `Nil`. The owing direction is a different screen, not the paid layout with a minus.
- **A part payment stays on its line** and carries onto the next week at day 14. It never moves into a separate debt ledger — a second ledger is a second truth.
- Money reads `3 240 DH`. `tabular-nums` on every amount. `−` not `-`. No centimes.

## How I want you to work

1. Reconnaissance and plan first. Wait for me.
2. §9 order. The three tables and their invariants before any UI.
3. Exact copy from the designs.
4. Codebase wins on mechanism, designs win on appearance, README wins over both on money rules. Genuinely unspecified? Ask.
5. No invented numbers. Use the ones in the designs — `1 566 DH` collect, `1 720 DH` pay, `2 910 DH` float, the `+ 52 DH` carried line — so I can check your fixture against the screens by eye.
6. Don't refactor slices 1 or 2 while you're in here. If something is in the way, propose it separately.

## The one thing I care about most

An owner has to be able to sit in his shop with this statement and check any line on it against his own day — the barber's name, the minute the cash was taken, the booking. The number at the top is only trustworthy because the lines under it are checkable and because they add up to it. **A smaller number at the top with no explanation is the failure mode**, and every decision in §2 exists to prevent it.

Start with the four reconnaissance answers, especially the oldest-uncollected-dirham question. No application code until I confirm.
