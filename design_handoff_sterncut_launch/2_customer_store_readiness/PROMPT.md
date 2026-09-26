# Paste this into Claude Code

> Drop this folder into the project, open `README.md`, and build the customer app's store-readiness slice: DEL-04 to DEL-06, MSG-04 to MSG-08, SGN-01 and SGN-02.
>
> The design is in `design/Customer - Store Readiness.dc.html`. Every screen ID is an anchor. Match it to the customer kit, and take every string from the README tables into the EN, FR and AR locale files. Don't write copy that isn't in the tables.
>
> These rules override everything else:
> 1. If a feature isn't built, don't draw it. A row with missing data is removed, not disabled. No "coming soon".
> 2. Copy about barbers and customers uses no pronouns.
> 3. Arabic: `dir="rtl"`, no letter-spacing or uppercase, Western digits, money as `40 DH` in an LTR isolate.
>
> Work order:
> 1. **Delete account.** Change the server from wiping to anonymising, as the README describes. Add `GET /account/deletion-check`. `POST /account/delete` must refuse while a deposit booking is live, require `confirm: "DELETE"`, and require `acceptWalletLoss` when the balance is above 0. Record the forfeited balance in the ledger. Show "Former customer" on kept reviews and bookings, on the barber side too. Then replace the PRO-09 sheet with the DEL-04 to DEL-06 screens.
> 2. **Chat.** Add per-thread `last_read_at`. Build the thread counts, the tab badge, the Unread filter with its empty state, and the New divider. Remove every presence dot, "Online", the mic, the emoji and paperclip buttons, and "Call the shop". The ⋮ sheet has two rows.
> 3. **Consent.** Put the one-line consent under the welcome buttons, under CONTINUE on register, and under the Google/Apple row on sign-in. Both links open sterncut.ma in the in-app browser.
>
> Answer the open questions at the end of the README, or flag them to me.
