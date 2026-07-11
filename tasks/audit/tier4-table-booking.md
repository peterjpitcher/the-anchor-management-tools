# Table booking (public)

## Summary

All four routes in this section are pure server-side redirect stubs — none of them render any JSX/UI in this codebase. Each `page.tsx` is a one-line `redirect()` to an external page on the marketing site (`the-anchor.pub`). There are no companion components, no `*Client.tsx`, no `loading.tsx`, no `error.tsx` in any of the four route directories. Confirmed via `ls -la` on each directory — `page.tsx` is the only file present in every case.

Since the public table-booking flow has been migrated entirely to the website, this app has no mobile-rendering surface to audit here. Nothing to check against the rubric (no body markup, no forms, no tables, no modals).

## /table-booking

- Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/table-booking/page.tsx`
- Content: `redirect('https://www.the-anchor.pub/book-table')` (line 4) — no JSX rendered.

PASS (no mobile issues found) — route renders nothing; it is a server-side redirect to the marketing site, which is out of scope for this codebase's audit.

## /table-booking/[reference]

- Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/table-booking/[reference]/page.tsx`
- Content: `redirect('https://www.the-anchor.pub/whats-on')` (line 4) — no JSX rendered.

PASS (no mobile issues found) — route renders nothing; server-side redirect to the marketing site.

## /table-booking/[reference]/payment

- Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/table-booking/[reference]/payment/page.tsx`
- Content: `redirect('https://www.the-anchor.pub/whats-on')` (line 4) — no JSX rendered.

PASS (no mobile issues found) — route renders nothing; server-side redirect to the marketing site.

## /table-booking/success

- Live file: `/Users/peterpitcher/Cursor/OJ-AMS-mobile/src/app/table-booking/success/page.tsx`
- Content: `redirect('https://www.the-anchor.pub/book-table')` (line 4) — no JSX rendered.

PASS (no mobile issues found) — route renders nothing; server-side redirect to the marketing site.

## Note

If the actual public table-booking mobile UI needs auditing, it now lives on the website repo (`the-anchor.pub` / `OJ-The-Anchor.pub`), not in `OJ-AnchorManagementTools`. This audit is scoped to the AMS worktree only, per instructions, so that repo was not inspected.
