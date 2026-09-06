# Paste this into Claude Code

> Drop this folder next to `design_handoff_agent_collection/`, then paste this.
> Or just type: `Read design_handoff_unverified_collections/PROMPT.md and follow it.`

---

This closes the two holes `design_handoff_agent_collection/README.md` flagged and refused to guess at: **the owner who can't produce his 4-digit code**, and **a collection recorded with no signal**. Read that README first — this one does not repeat the money model, the round, the bag, or the immutability rules.

`design_handoff_unverified_collections/README.md` is the spec. **Read it in full before writing any code.** The `design/*.dc.html` files are design references, not production code — recreate them with this codebase's patterns. **The copy is exact and load-bearing**: several sentences exist so an agent can repeat them to an owner word for word, and several exist so an owner reading a statement a year later can still tell what proved it.

## The one idea, and it is a schema change

**A collection whose money is settled and whose proof is not.** Two orthogonal fields, `verified_by: code | ops_call` and `verification: verified | queued | failed`. Read §1 before anything else.

If your plan collapses these into one enum, or adds `verification: pending` to the existing status column, stop. The money state and the proof state are independent and both are shown to owners. `verified_by` is *which kind of proof*; `verification` is *whether it has been checked*.

## The two rules most likely to get broken by accident

1. **A queued collection must never silently become verified.** `queued → verified` only on a real comparison of the stored digits against the real code. Not on sync success. Not on a nightly job that clears old rows. Not by any human in ops — §8 says no one in the admin can mark a queued receipt verified, and that has to be enforced, not documented.
2. **The owner must never see *confirmed by your code* for a collection that wasn't.** Grep the codebase for wherever that string (or its equivalent) is generated, and make it unreachable from a `queued` or `failed` record. This is a one-line phrase that would quietly destroy the entire mechanism's meaning.

## Before you write anything

1. **Can a receipt be created client-side, offline, and be genuinely immutable** — a real write barrier, not a status column plus discipline? The base spec asked this; offline capture makes it unavoidable. If you can only give me discipline, say so now and tell me what you'd guard it with.
2. **Where does the code comparison actually run**, and can the phone hold the typed digits in a form that survives a force-quit but can't be edited? If the queue is losable, the whole third state is theatre.
3. **Is there a per-shop signal history** (last three visits) or would `AGT-13`'s *codes checked later* have to read live bars? If it's live bars, say so — I'd rather change the design than ship a lie about the network.
4. **What fires the 72 h escalation and the release-time trigger** in §7 — a scheduler, a queue, a cron you don't trust? And what happens to the clock when the app is never opened. Age runs from collection, deliberately.
5. **What you'd refuse to build the way I've described it.** Read §2 (the ladder refusing a spoken code) and §6 (mismatch not reversing the money) and push back if you think either is wrong.
6. **Your plan** in §10's order, mapped onto files you'd actually touch.

Then wait for me. Do not start until I confirm.

## What to build

**The fifteen screen ids in the README (`AGT-06`–`AGT-20`), and nothing else.**

**§10 order, and steps 4 and 5 are the spec.** `AGT-18` and `AGT-19` — the mismatch, agent side and owner side — **ship together or not at all.** A failed check that only exists on the agent's phone is worse than no check: the owner's statement then carries a number nobody has questioned.

**Build the queue before the fallback.** The offline path (§5) is the common case and it is mostly mechanical; the ops call (§4) is rarer, involves a second human, and will change once the duty desk uses it. Doing the call first means building the schema around the exception.

**Do not build a "retry verification" button anywhere.** Not for the agent, not for ops. Sync is automatic; a manual retry is the affordance that eventually becomes a manual override.

## Non-negotiables

- **Immutable offline too.** The receipt exists on tap, with no network, and `AGT-15` says *this is still final* **and** *I can't check these digits yet* — two sentences, both kept. Do not merge them into one softer one.
- **The provisional receipt is not an error.** Dashed amber, no red, `RECORDED · HIS CODE NOT CHECKED YET`. He did nothing wrong.
- **A failed code is an incident immediately**, at any age. It never sits in a queue.
- **A mismatch reverses nothing.** Money stands, owner's line stands, proof is marked failed permanently, and the owner is asked a direct question.
- **`ops_call` receipts must look and read differently from code receipts everywhere** — agent receipt, owner statement, run, audit. Amber, six digits not four, duty officer's name where the owner's code would be.
- **The ladder refuses a code read down the phone.** §2. This is not a UX nicety; it is why codes mean anything.
- **Ops reaches the owner; ops does not authorise the agent.** Owner's amount typed before the agent's, both must match, number on file only.
- **Ceilings enforced**: 5 unchecked or 6 000 DH, then no new collect. Hand-over and the ops call stay available.
- **No one in ops can mark a queued receipt verified.**
- **Signal is words, per shop, from history** — never a reception icon, never a blocking banner.
- **Direction is a word.** `Collect` / `Hand over`, never a sign. Money `3 240 DH`, `tabular-nums`, no centimes. No bank, card, RIB, transfer or fee on either path.

## How I want you to work

1. Reconnaissance and plan first. Wait for me.
2. §10 order. Schema and the transition guard before any UI.
3. Exact copy from the designs, including the owner-facing sentences.
4. Codebase wins on mechanism, designs win on appearance, the two READMEs win over both on money and proof rules. Genuinely unspecified? Ask.
5. Use the numbers in the designs — `1 566 DH` owed, `1 100 DH` collected offline, code `8830` failing, `2 240 DH` and `780 DH` matching, queue `3 of 5 · 4 120 DH`, run `6 420 DH` unchecked, `CALL-8841`, auth `418 209` — so I can check your fixtures against the screens by eye.
6. Don't refactor the earlier slices while you're in here.

## The two things I care about most

**That the third state stays visible until it resolves.** Not a spinner, not a toast, not a field only the schema knows about. It's on the agent's round, on the owner's statement in his own words, and on a released week's totals. The failure mode this design exists to prevent is somebody reconciling a week believing it is settled when part of it was never checked.

**That nobody is called a thief by a screen.** Every honest cause here is boring — a dead phone, a stale code, a mistyped digit, a shop with no signal. The agent's mismatch screen offers *I mistyped it* as a first-class answer, the owner's screen explains why his app was probably showing the wrong code, and the ops audit shows the agents with zero alongside the ones with six. The moment either screen reads as an accusation, agents start avoiding the queue and the fraud you'd actually catch goes underground.

Start with the reconnaissance answers, especially offline immutability and where the comparison runs. No application code until I confirm.
