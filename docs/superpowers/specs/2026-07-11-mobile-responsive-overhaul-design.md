# Mobile Responsive Overhaul — Design & Method

**Date:** 2026-07-11
**Branch:** `feat/mobile-responsive-overhaul` (worktree at `/Users/peterpitcher/Cursor/OJ-AMS-mobile`, off `main`)
**Status:** Approved by owner ("go") — proceeding continuously.

## Problem

Many of the app's pages are hard to use on mobile. The owner wants every page made usable on
a phone, with nothing missed. The app has **160 distinct routes** across 7 route groups.

## Success criteria

Every one of the 160 routes passes the mobile rubric below at 375px viewport width. The
data-heavy pages people actually use on a phone get purpose-built mobile layouts (not just
horizontal scroll). Work ships in independently-deployable, section-by-section chunks.

## Mobile rubric (applied to every route at 375px)

1. **No horizontal body scroll** — page content fits the viewport; only designated containers scroll.
2. **Tap targets ≥ 44px** and adequately spaced.
3. **Readable text** — no forced tiny fonts; respects user zoom.
4. **Usable forms** — full-width inputs, visible labels, correct input/keyboard types, reachable submit.
5. **Wide content handled** — tables/grids either stack to cards or scroll inside their own container
   without breaking the page; no critical column hidden with no access.
6. **Modals/drawers fit** — fit the screen, scroll internally, closeable.
7. **Primary actions reachable** without horizontal scroll; sticky bars don't cover content.
8. **Media scales** — `max-width: 100%`.

## What's already fine (do not churn)

The **navigation shell is already mobile-capable**: `MobileChrome` provides a sticky top bar,
bottom tab nav (with `env(safe-area-inset-bottom)`), and a left slide-in drawer; `Sidebar` is
`hidden md:flex`; `Modal` is a bottom-sheet on phones. Viewport meta is set in `layout.tsx`.
The nav shell is **verified, not rebuilt**.

## Where the pain is

- ~78% of `page.tsx` files use **zero** responsive prefixes.
- Hand-rolled wide `<table>` in ~30 files + `overflow-x-auto` (no table lib).
- Fixed `min-w-[720–1040px]` grids: `rota/RotaGrid`, `table-bookings/foh/FohTimeline`,
  `receipts/monthly/MonthlyCharts`, `receipts/vendors`, `invoices/[id]` detail, `oj-projects`.
- Fixed-width `<td className="min-w-[180–220px]">` cells.
- Hand-written mobile hacks in `globals.css` (several raw media queries + `min-width` overrides).

## Method (completeness guarantee)

1. **Inventory = checklist.** All 160 routes live in `tasks/todo.md`, each with audit/fix/verify boxes.
2. **Uniform rubric audit.** A parallel fan-out of agents applies the *same* rubric to every route,
   returning structured findings — so coverage is exhaustive, not memory-based.
3. **Live-file tracing.** This app has dead duplicate `*Client.tsx` files; every fix targets the file
   the route's `page.tsx` actually renders.
4. **Systemic-first.** Fix shared `src/ds` primitives + `globals.css` once, then per-page residue.
5. **Section-by-section commits**, each independently deployable.

## Fix depth

- **Baseline** for all 160 routes (rubric pass).
- **Mobile card/stacked redesigns** for the ~10 worst data-heavy pages.

## Order of work (all covered; this is sequence)

- **Tier 0 — Systemic:** `src/ds` primitives (Table/grid/container/Modal), `globals.css`, `min-w` offenders.
- **Tier 1 — Daily manager (owner's priority):** dashboard, messages, customers, events, private bookings.
- **Tier 2 — On-the-floor:** table bookings (FOH/BOH), timeclock, rota, staff portal.
- **Tier 3 — Money/admin:** invoices, quotes, receipts, cashing-up, expenses/mileage/MGD, menu, OJ projects,
  short links, employees/recruitment, settings, core (profile/users/roles/parking).
- **Tier 4 — Public/booking:** public + auth pages, booking flows, guest-token pages, feedback, onboarding.

## Verification

- Redesigned + high-risk pages: driven at 375px with before/after screenshots where reachable.
- Representative sample per section: same.
- Remainder: code-audited against the rubric.
- Every tier: `npx tsc --noEmit`, `npm run lint`, `npm run build` must pass before commit.

### Known constraint

Authenticated pages require a logged-in session to reach in a browser. Autonomous login is not
possible (entering credentials is prohibited and no test session is seeded). Browser proof is
therefore focused on **public routes** + component-level checks + the full build/typecheck/lint
gate; authenticated pages are proven by rigorous code-audit against the rubric and a clean build.
Full authenticated-page browser proof is flagged for the owner to spot-check on return.

## Safety / constraints

- Work isolated in a git worktree; the main working directory (active parallel session) is never touched.
- **No push, no merge to main, no production deploy** while the owner is away — the branch is left review-ready.
- Never stage the parallel session's parked files.
- Production app: each tier must be independently deployable with no broken intermediate state.
