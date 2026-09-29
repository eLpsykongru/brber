# Paste this into Claude Code

> Drop this folder into the same project as the earlier `design_handoff_*` folders, then type:
> `Read design_handoff_admin_owner_site/PROMPT.md and follow it.`

---

The earlier handoffs gave you screens. This one gives you **the website they live in**: admin.sterncut.ma, one site where the account you sign in with decides what you see — staff get the ops console, shop owners get their own shop.

`design_handoff_admin_owner_site/README.md` is the spec. Read it in full. `site-map.json` lists every canvas screen id and the URL it lives at — treat it as your routing checklist. The `design/*.dc.html` files are design references. Open `design/Sterncut Site.dc.html` in a browser and switch accounts in its Tweaks panel to see each role. Recreate them with this codebase's patterns; don't ship the HTML.

## Rules that shape the build
- **One app, two audiences.** Staff sign in with a `@sterncut.ma` email plus an authenticator code; owners sign in with their phone plus an SMS code, using the same account as the mobile app. There is no sign-up and no password reset.
- **Permissions change actions, not pages.** Every staff member sees the same menu. An action above your role becomes an *ask* that lands in `/requests` and changes nothing until the Head of Ops decides.
- **Owners are scoped to their own shop slug.** Any other slug returns a 404 that says so.
- **Every modal or drawer has a URL**, as a query on its parent page. Closing it returns to the parent URL.
- **The earlier READMEs win on money and proof rules.** This one wins on navigation, access and page structure.
- **Copy is exact.** Money reads `3 240 DH`, and every number is set in tabular figures.

## Before you write anything
1. Map the README's URL tables and `site-map.json` onto your router. Tell me which routes clash with what exists.
2. Tell me how you'll enforce owner slug scoping and the staff-ask flow server-side, not just in the UI.
3. List the sections you'd build first. I suggest: shell + sign-in + roles, then Overview, Requests, Salons, Finance, then the rest.
4. Tell me what you'd refuse to build as described.

Then wait for me to confirm.

## Don't
- Build coupons or passes except behind a flag. They are held from v1.
- Invent the open items in README §10: other periods, other cities, and the owner pages that were never drawn for Karim's and Nabil's shops. Flag them.
- Refactor the earlier slices while you're in here.
