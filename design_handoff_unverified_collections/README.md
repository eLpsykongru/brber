# Unverified collections — spec

The two cases `design_handoff_agent_collection/README.md` deliberately flagged and stopped at:

1. **The owner cannot produce his 4-digit code.** Phone dead, owner absent and his barber is there, app won't open. The agent is in the shop with cash in his hand and the visit can't close.
2. **No signal.** A device cannot verify a code it has never seen, so a collection recorded offline is *recorded but unchecked*.

Both produce the same new idea: **a collection whose money is settled and whose proof is not.** Everything below exists to keep those two facts separate, in the data model and in every screen that shows them.

Designs: `design/Ops Agent - Collection.dc.html`, turns **A2** (ids `AGT-06`–`AGT-12`) and **A3** (ids `AGT-13`–`AGT-20`). The copy is exact and load-bearing.

---

## §1 The model

```
verified_by:   code | ops_call
verification:  verified | queued | failed
```

Two orthogonal fields. `verified_by` is *which kind of proof was used*; `verification` is *whether the check has run and passed*. A code collection taken offline is `verified_by: code, verification: queued`. When it syncs it becomes `verified` or `failed` — never silently `verified`.

Additional fields:

| field | on | meaning |
|---|---|---|
| `code_captured_at` | queued collects | when the agent typed the digits, offline |
| `synced_at` | queued collects | when the check actually ran |
| `queued_age_h` | derived | **from `code_captured_at`, not from first sync attempt** |
| `ops_call.owner_reached` | `ops_call` | bool — the grade of the fallback |
| `ops_call.call_ref` | `ops_call` | `CALL-8841`; both numbers dialled, both figures typed |
| `ops_call.duty_user` | `ops_call` | the duty officer's name, on the receipt |
| `dispute_window_expires_at` | `ops_call` where `owner_reached: false` | 72 h |
| `incident_ref` | either | set on escalation; never cleared |
| `visit_attempt` | visits | visit, agent, time, geo, reason, `closed: false` |

**Money is unaffected by `verification`.** A queued or failed collection still counts against the shop's week. Reversal is only ever a correcting line on the next statement, carrying the agent's name — as in the base spec.

---

## §2 No code: the ladder (`AGT-06`)

Not an error screen. Three rungs the agent works alone, in cost order, then the call:

1. **Wrong screen** — four digits, top right of *This week's statement*, not the receipts list.
2. **Any other phone** — `shop.sterncut.ma`, *he* types his own number, log him out after.
3. **Ring the owner** — a barber cannot stand in for him.

**Rung 3 refuses a code read down the phone, and this is the load-bearing rule.** A code spoken over a phone proves the owner agreed; it does not prove the agent is in the shop. Accepting it would mean every code in the system asserts only the weaker of the two facts. So when the owner answers, the flow routes into the ops call — where the conversation is captured — rather than accepting digits through the agent's ear.

**Friction is a number about himself, not a delay.** No timer (a timer teaches agents to wait it out). His own ops-call rate against the team's — `2 in 30 days · team 0.4` — sits on the screen before he taps, and it is the number the Head of Ops sorts by.

Entry reasons, recorded: `owner_unreachable` | `app_no_code` | `code_rejected_3x`.

---

## §3 Leaving without closing (`AGT-07`)

**Allowed — but only before cash has moved.** An agent who cannot leave will invent a close or stand arguing with a barber. So walking away is a recorded act, not a null one: reason, name, time, geo, and a line the owner sees (*"Hicham came Friday 18:40 and could not close"*), never a blank.

Four brakes, all in the design:

- The money doesn't go away — `day 6 of 14` keeps counting and the visit returns **tomorrow, at the top of his own round**. Abandoning buys a second trip.
- His abandon rate is shown against the team's at the moment of tapping.
- **Second abandon takes the shop off him** — third visit routes to another agent and ops phones the owner.
- **Holding cash removes the option.** First question on the sheet is whether he has counted money; "yes" leads only to the ops call. This is the one place the product refuses him an exit.

---

## §4 The ops call (`AGT-08`)

**Ops does not authorise the agent. Ops reaches the owner.** The duty officer:

1. Tells the agent to stay in the shop and **not** say the amount yet.
2. Calls the owner on **the number on file** — never a number the agent reads out.
3. Asks the owner the amount **first**, types it.
4. Asks the agent the amount, types it.

Both figures must match on screen before a code can be issued; a mismatch issues nothing and opens a discrepancy. The duty screen also shows the agent's device distance from the shop's registered address and last sync age, his bag total against cap, and his ops-call rate with 12-week sparkline.

**The authorisation is 6 digits, not 4**, bound to that visit and that amount, valid 10 minutes, read aloud only. Six so nothing downstream can confuse it with an owner code.

**Two grades:**

- `owner_reached: true` — receipt reads *proved by ops call · owner reached*. The owner vouched; ops was the channel and the witness.
- `owner_reached: false` — the agent is the sole voucher. Visibly thinner: the owner's statement shows the line **unconfirmed** and asks him directly, with a 72 h window. Still issuable, because the alternative is an agent leaving with unrecorded cash — but counted and reviewed.

---

## §5 Offline (`AGT-13`–`AGT-16`)

**Signal is shown as a consequence, not a bar.** Never a reception icon. Each shop on the round carries words — *codes checked here* / *codes checked later* — derived from the last three visits to that shop, not the current bar count. `Rue Mendoubia has never once had signal` is a routing fact, and the round is orderable around it.

**He still asks for the code** (`AGT-14`). Dropping it offline would be fatal: a code nobody ever asks for is a code that never existed. He types the digits; they are stored; the screen says plainly *I can't tell you yet whether these are right*.

**The confirm (`AGT-15`) keeps two separate promises on one screen:**

- *This is still final.* Offline changes nothing about immutability — the receipt exists on tap and can only be answered by a correcting line.
- *And I can't check 8830 until we have signal.* The money is recorded; the proof waits.

The words "there is no undo" from the base spec are **not** replaced — they are joined by the second sentence. Do not merge them into one softer sentence.

**Receipt (`AGT-16`) is provisional, not wrong.** Dashed amber border, `RECORDED · HIS CODE NOT CHECKED YET`, no red — red is for failure and he hasn't failed. Rows split the two facts: *The money — in your bag, counted, done* / *His code 8830 — waiting to be checked*. Carries a tally: `3 of 5 · 4 120 DH`, pinned to the top of his round until it clears.

**Ceilings:** max **5** unchecked collections or **6 000 DH** of them per agent. At the ceiling the app will not open another collect — he can still hand over, and he can still call ops, but he cannot keep stacking unchecked cash.

---

## §6 The sync landing (`AGT-17`–`AGT-19`)

**Match** is quiet. A one-line settling per receipt — *confirmed with the owner's code* — no celebration, and the receipt from then on reads exactly like any other.

**Mismatch (`AGT-18`)** has to work when he is 30 km away with the cash in his bag, and must not read as an accusation — the likeliest cause is a stale code on the owner's screen.

- The money is **not** reversed; the owner's line is **not** silently altered.
- The receipt becomes `verification: failed` permanently. It cannot become clean.
- It asks for the one thing only he has: *what he saw* — owner read it off his own phone / barber read it / **I mistyped it**. Mistype is offered plainly and is the commonest answer.
- Then **ops rings the owner, not the agent.** He does not phone and does not drive back.
- His round is paused until the statement is sent.

**Owner side (`AGT-19`)**, same moment: the line stops saying *waiting to be checked* and becomes a direct question with his own money in it — *Did you hand Hicham 1 100 DH on Friday evening?* — with the explanation (his app had been closed six days), the reassurance that nothing on his account has changed, and both answers' consequences spelled out. A footer that appears on every statement: *a line only says confirmed with your code when you typed those four digits and they matched.*

**Hard rule:** the owner must never see *confirmed by your code* for a collection whose code did not run or did not match. There is no path in the product that produces that sentence from a `queued` or `failed` record.

---

## §7 The clock, and who is told

Age runs from **collection**, not from first sync attempt.

| age | state | who is told |
|---|---|---|
| < 12 h | queue, routine | nobody — the agent's own tally only |
| 24 h | queue, duty desk | duty desk + one-tap *make him sync* push. Owner sees nothing new. |
| **72 h**, or the moment a week is **released** with it still queued — whichever first | **incident** | agent (next round blocked until his queue is empty), Head of Ops by name on the Monday list, Finance if a released run is affected, **and the owner** — *we still haven't been able to check this*, with amount and agent name |
| any age | `verification: failed` | **incident immediately.** Never a queue item. |

Rationale for 72 h: three days is longer than any round, so the failure is no longer plausibly technical. Rationale for telling the owner: at three days he has a right to know money marked against him rests on nobody's word but the agent's. Rationale for silence under 12 h: a queue that pages someone every evening is a queue people learn to ignore.

---

## §8 Ops views

**`AGT-20` — queued-unverified as a column on the run.** `COLLECTED, UNCHECKED · 6 420 DH` sits beside `PROVED BY OWNER CODE` and `PROVED BY OPS CALL` on week 36, **through release**, and appears on the release confirmation and in the closing pack. Release is allowed — the money moved and 312 shops shouldn't wait on one dead phone — but a week may never close *quietly*. Per-row state: `INCIDENT`, `CODE DIDN'T MATCH`, `QUEUE · DUTY DESK`, `QUEUE · ROUTINE`.

**No one in ops can mark a queued receipt verified.** Only the stored code meeting the real one does that, or an ops call replacing the proof outright.

**`AGT-12` — ops-call receipts reviewed as a set.** By agent, as a **rate** (`6 of 41 · 14.6% · 7× the fleet`) with a 12-week sparkline and a *shape of it* column: which shops, what time of day, owner reached or not, disputes. Threshold, written on the page: **3 ops-call collections from one agent in 7 rolling days, or 4 *owner not reached* in 30**, opens a review by itself. Below that nobody is watched. Rows for agents with zero are shown deliberately — it is possible to work a round without ever needing this.

Actions offered, in the order they're usually right: ring the six owners yourself · move his late shops to a morning window · send someone out with him for a day · suspend (needs a second approver). The middle one is usually the answer: *a round that can't be closed at 19:30 is a routing fault before it is an agent fault.*

---

## §9 Non-negotiables (in addition to the base spec's)

- **Immutable still means immutable offline.** The receipt exists on tap, with no network.
- **A queued collection must never silently become verified.** State transitions are `queued → verified` only on a real code comparison, `queued → failed` otherwise, and both are visible to the owner in his own words.
- **The owner never sees *confirmed by your code* for an unchecked or failed collection.**
- **`ops_call` receipts must be visually and textually distinct** from code receipts everywhere they appear — agent receipt, owner statement, run, audit. Amber band, six digits, duty officer's name where the owner's code would be. A year later, either statement must still say which kind of proof it was.
- **A failed code is never a queue item.** Incident on the spot.
- **Direction stays a word.** `Collect` / `Hand over`. Never a sign.
- Money reads `3 240 DH`, `tabular-nums`, no centimes. No bank, card, RIB, transfer or fee anywhere on either path.

---

## §10 Build order

1. `verification` + `verified_by` on the collection record, with the transition guard. No UI.
2. Offline capture and the queue, incl. the 5 / 6 000 DH ceiling. Agent tally only.
3. The sync check: match, and `failed` as a terminal proof state. `AGT-17`.
4. `AGT-18` / `AGT-19` — the mismatch pair. **Build these two together or not at all**; a mismatch that only exists on the agent's side is worse than nothing.
5. The clock and escalation (§7), incl. the release-time trigger.
6. `AGT-20` column, release confirmation, closing pack.
7. The ladder `AGT-06` and abandon `AGT-07` (`visit_attempt`).
8. Ops duty call `AGT-08`, the 6-digit authorisation, both grades.
9. `AGT-12` audit.

Steps 4 and 5 are where this spec is actually cashed. If the schedule slips, cut 9 before 4.
