# Orange Jelly colours and logos

Navigation was merged into local main as d3f10f95. Current main's Insights permission gate, print handling, focus styles and design tokens were retained during conflict resolution. Existing unrelated working changes were restored; their original backup remains in the named Git stash.

The supplied design archive was used only as a source of colours and original PNG logos. Its workflow instructions and website components were not adopted. Deep orange gives existing white button labels sufficient contrast. Ink, cream and paper replace the staff green and neutral palette. Typography, density, page structure and navigation behaviour are unchanged by this branding increment.

## Changed files

- src/app/globals.css: staff colour tokens.
- src/lib/brand/palette.ts: matching staff email and document colours, and first chart colour.
- src/ds/shell/Sidebar.tsx and MobileChrome.tsx: supplied white logo mark.
- src/app/auth/login/_components/LoginClient.tsx and src/app/auth/_components/AuthCard.tsx: supplied colour logo mark. Authentication logic is unchanged.
- src/app/layout.tsx and public/manifest.json: browser chrome colours.
- public/orange-jelly/logo-icon.png and logo-icon-white.png: original assets, copied without alteration.
- src/ds/shell/NavigationSearch.tsx: use main's rounded-sm token to satisfy the merged design-token guard.
- src/lib/__tests__/__fixtures__/table-booking-sheet-baseline.html, tests/lib/__snapshots__/pdfTemplates.test.ts.snap and tests/lib/pnl/report-template.test.ts: expected colours refreshed.
- tests/browser/navigation/vite.config.ts: serve the production logo assets in the local fixture.

## Deliberately unchanged

The Anchor guest tokens, GUEST document palette, public/logo.png, favicon and installed-app icon assets, customer templates, business logic, permissions, fonts and spacing. Status colours retain their meaning. No migrations or live data changes.

## Verification

The actual shell rendered in the isolated browser fixture at 1280 x 720 and 390 x 844. Table Bookings selection closed desktop expansion, its active background was rgb(179, 78, 8), the sidebar was rgb(35, 37, 46), and all visible collapsed icons had 0px horizontal offset in a 64px rail. Mobile Events selection closed the drawer. Supplied white logo rendered in both views. Browser console returned no errors.

This is fixture verification, not a signed-in app session. Browser access to the existing port 3000 server was blocked by the browser client. The running server's working directory was confirmed as the main checkout.

Focused shell, palette parity and design-token guard checks: 109 passed in London and 109 passed in UTC. Full UTC suite passed: 1,010 files, 9,860 tests, two existing skips. The London run passed 9,855 tests before the five expected-colour assertions were refreshed; all three affected files then passed 88 tests. Lint and uncached typecheck passed. Production build exited 0 with 150 static pages; an existing documentation example produces a CSS optimisation warning for spacing-*.

The table-booking HTML fixture, three invoice/quote snapshots and the P&L background assertion were refreshed for the approved colours. Normalising hex values makes the previous and updated invoice/quote snapshots identical; no markup or content changed. The three affected test files then passed all 88 tests.

The main-checkout dev server was restarted and reported Ready on port 3000. GET /auth/login returned HTTP 200 and the response contains the supplied Orange Jelly logo path. Local only; no push, deployment or migration.
