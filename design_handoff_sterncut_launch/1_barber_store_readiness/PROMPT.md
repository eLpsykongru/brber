# Paste this into Claude Code

> Drop this folder into the project, open `README.md`, and build the barber app's store-readiness slice: screens BST-00 to BST-06, DEL-01 to DEL-03, MSG-01 to MSG-03, EXP-01 to EXP-03, BCF-02b and HLP-01.
>
> The design is in `design/Barber - Store Readiness.dc.html`. Open it in a browser; every screen ID is an anchor. Match layout, spacing and colours to the drawing. Take the copy from the README tables. Every string goes into the EN, FR and AR locale files. Don't write any string that isn't in the tables.
>
> Rules that override anything else:
> 1. If a feature isn't built, don't draw its control. Remove the row instead of disabling it. No "coming soon".
> 2. No pronouns in copy about customers. Use the client's name.
> 3. Every target is at least 44 px.
> 4. Arabic: `dir="rtl"` and mirror the layout. No letter-spacing or uppercase on Arabic text. Use Western digits (`ar-u-nu-latn`). Money is `340 DH`, wrapped in an LTR isolate.
>
> Work order:
> 1. **Settings.** Add the Profile row (BST-00) and move Language off Profile. Build BST-01 to BST-06. Notifications links to the existing BNT-03 screen; don't rebuild it. Log out and "sign out on every device" use the auth client's local and global sign-out.
> 2. **Delete account.** Add `GET /account/deletion-check`, which returns the four blockers. Add `POST /account/delete`: it re-checks the blockers, requires `confirm: "DELETE"`, and runs the anonymisation from the README (remove the listed fields, keep bookings, reviews and money records without a name). Then build DEL-01 to DEL-03. There is no shop transfer.
> 3. **Chat.** Add per-thread unread counts, the tab badge and the New divider. Hide Call when the client has no phone. The options sheet has exactly three rows. Remove the mic and emoji buttons from the composer.
> 4. **Export.** Build one sheet, used from both the Wallet activity and the Shop report. Render the PDF with the receipt renderer and hand it to the native share sheet. The PDF shows only what its screen shows.
> 5. **Cash top-up.** Delete the Scan QR tab and the segmented control, and apply the three fixes listed under BCF-02b.
> 6. **Help.** Replace the "coming soon" toast with HLP-01. Write each "Common for barbers" article from what the code actually does.
>
> Before shipping, answer the three open questions at the end of the README, or flag them to me.
