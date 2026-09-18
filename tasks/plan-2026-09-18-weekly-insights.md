# Weekly insights: implementation plan

> Spec: `tasks/spec-2026-09-18-weekly-insights-design.md` (v2). Review: `docs/reviews/2026-09-18-weekly-insights-spec-review.md`.
> Branch `feat/weekly-insights` in the isolated worktree `/Users/peterpitcher/Cursor/OJ-AMS-insights`, from `origin/main` 9ebaaff5.
> The primary checkout has another session's uncommitted work; nothing here touches it.

**Goal.** One rules engine feeding a super-admin `/insights` page and the Friday 06:00 manager email, replacing the queue-based report.

**Owner gates.** Nothing is pushed, deployed, migrated or sent. The owner reviews locally first. No production writes; production reads are read-only.

## Global constraints

- No migrations. No new tables. No em dashes anywhere (hook enforced).
- Every multi-row read uses `fetchAllRows` or a `count` query; the row-cap guard stays green.
- Sections never create a client. Each gets `ctx.db`, a per-section admin client whose every request carries the section's abort signal (`createAdminClient({ signal })`). A guard test forbids client imports and write calls inside `src/lib/insights/sections/`.
- Dates only through `src/lib/dateUtils.ts` and `src/lib/insights/windows.ts`. Tests pass under `npm test` (London) and `npm run test:utc`.
- Thresholds and keyword lists live only in `src/lib/insights/thresholds.ts`.
- Every signal declares `emailSafe`. Names of people who are not the person to act on stay page-only.
- Stage explicit files only when committing; `git diff --cached --name-only` before every commit.

## Wave 1: foundation (main agent)

Files: `src/lib/insights/{types,thresholds,windows,compare,format,signals,context,engine,summary,actions,registry}.ts`, `src/lib/supabase/admin.ts` (optional `signal`), tests under `tests/lib/insights/`.

- [x] `types.ts`: the contracts in spec 4.1 plus `SectionDefinition`, `SectionBuildResult`, `InsightsReport`, `RankedAction`, `InsightsSummary`, `UpcomingItem`.
- [x] `thresholds.ts`: floors, rule thresholds, deadlines, pool size, email budget, collection start dates, feedback keywords, maintenance area categories, short-link exclusions.
- [x] `windows.ts`: `computeWindows(now)` and `londonDayStartIso(date)`, `londonRangeInstants(range)`.
- [x] `compare.ts`: weekly average, change, notable, trend, minimum history, sentence helpers.
- [x] `format.ts`: money, percent, day-date, plural, clip, days-between.
- [x] `signals.ts`: `mergeSignals`, `worstRag`, `ragRank`, entity de-duplication, scoring.
- [x] `engine.ts`: pool of 4, 8-second section deadline, 25-second build deadline, abort wiring, discard late results, structured failure log, status derivation.
- [x] `summary.ts`, `actions.ts`: spec 4.6 and 4.7, from section objects only.
- [x] `registry.ts`: the ordered list of 15 section definitions.
- [x] Tests: windows (normal week, 25 Oct 2026, 28 Mar 2027, London and UTC), compare, engine (never-resolving builder, abort-aware builder, throwing builder, overall deadline, no unhandled rejection, same `now` to every builder), summary and actions (precedence, de-duplication, reds first, cap, green cap, win from a red section excluded).
- [x] Guard test `tests/guards/insights-sections.test.ts`.
- [x] Commit: `feat(insights): add the report engine, windows and comparison rules`.

## Wave 2: outputs (main agent)

- [x] `src/lib/insights/email/render.ts`: exception-first email (spec 7), HTML and text; tests for lists, no backgrounds, links, budget, size, invalid values, every headline present, "N more", reds never silently dropped, footer.
- [x] `src/lib/manager-report/schedule.ts`: 06:00 gate.
- [x] `src/lib/manager-report/delivery.ts`: build the insights report; one report per Friday (old or new); new id namespace; not-checked before 09:00 means no freeze; 09:00 partial send alerts; legacy frozen reports finished first with source finalisation; recipient `MANAGER_EMAIL` validated.
- [x] `src/app/api/cron/manager-weekly-report/route.ts`: `reportCronFailure` on total failure; tests.
- [x] Update `tests/lib/manager-report/delivery.test.ts` and `route.test.ts`; add the cutover state-matrix tests.
- [x] Page: `src/app/(authenticated)/insights/page.tsx` (+ `loading.tsx`, `_components/`), super-admin gate before engine, `force-dynamic`, summary, jump links, section cards, `<details>`, Print and Refresh, print styles; `print:hidden` on shell chrome.
- [x] Nav item after Dashboard (`trendUp` icon, `superAdminOnly`); update nav tests.
- [x] `/rota/leave` row anchors `leave-<id>`.
- [x] Commit per logical piece.

## Wave 3: sections (parallel agents, one per section)

Each agent owns `src/lib/insights/sections/<key>.ts` and `tests/lib/insights/sections/<key>.test.ts`, plus only the seam files listed. Section keys and seams:

| Key | Spec | Seam files the agent may edit |
|---|---|---|
| `events` | 5.1 | none |
| `customers` | 5.2 | none |
| `marketing` | 5.3 | `src/services/marketing-campaigns.ts` (extract a client-injected campaign statistics read; old export stays a wrapper) |
| `feedback` | 5.4 | none |
| `table_bookings` | 5.5 | none |
| `private_hire` | 5.6 | `src/lib/private-bookings/stale-outcomes.ts` (client-injected variant) |
| `parking` | 5.7 | none |
| `maintenance` | 5.8 | none |
| `employees` | 5.9 | none |
| `rota` | 5.10 | none |
| `checklists` | 5.11 | none |
| `invoices` | 5.12 | none |
| `cashing_up` | 5.13 | `src/lib/cashing-up/trading-days.ts` (new), `src/app/actions/missing-cashups.ts` (use it) |
| `short_links` | 5.14 | none |
| `recruitment` | 5.15 | none |

- [x] Each section: builder, fixture tests for every row of its signal table and every listed case, `emailSafe` set deliberately, links absolute via `ctx.link`.
- [x] Main agent diffs every changed file against the owned list before committing.

## Wave 4: cutover (one agent)

- [x] Spec 8.1 items 1 to 6 and 8, with their tests updated or removed (grep `tests/` for every deleted module).
- [x] `scripts/insights/cutover-preflight.ts` (read-only, counts and ids only).
- [x] `docs/manager-weekly-report.md` rewritten; `docs/agent-reference.md` cron list; `docs/README.md` if needed.

## Wave 5: review and fix

- [x] Independent per-section verification against the spec and live schema (read-only aggregate queries), plus cross-cutting reviews: engine and delivery, email and page, cutover. Adversarially verify findings, then fix.

## Wave 6: gates and evidence

- [x] `npm run lint`, `npx tsc --noEmit` (big heap), `npm test`, `npm run test:utc`, `npm run build` (env symlinked).
- [x] Email preview from fixtures; read-only production preview to a local file; screenshots of the page harness (fixture and live data, desktop and phone width).
- [ ] Print media check in a real browser print preview (not possible with the available tools; left for the owner's local review).
- [x] Preflight run (read-only) and output recorded.
- [x] Final `git status`, commit list, and the owner's local review instructions.

## Assumptions recorded

See spec section 2.2. Owner questions were not answered; recommended positions adopted.

## Verification record (18 September 2026)

- Branch `feat/weekly-insights`, merged with origin/main adfd7e65. Not pushed, not deployed, no migrations.
- `npm run lint` exit 0; `npx tsc --noEmit` exit 0; `npm test` and `npm run test:utc`: 978 files, 9,520 tests pass in each; cold `npm run build` passes (150 pages, `/insights` built).
- Live, read-only: `preview-report.ts --live` built the report from production in about 6 seconds with all 15 sections checked (8 action, 2 watch, 5 OK); the output was read line by line and three wording faults fixed.
- Browser: the page rendered from fixture and live data at desktop and 375px with no horizontal overflow and no console errors after the key fix; the email rendered from fixture data. Print styling was not visually verified (the browser tools cannot emulate print media); it rests on the print utility classes and the render tests.
- `cutover-preflight.ts` run read-only against production: PASS (2 old reports, both sent; nothing queued or held; nothing recorded for Fri 25 Sep).
- Independent reviews: each section reviewed and fixed; cutover reviewed by two lenses; final five-lens review with a sceptic per finding: 6 confirmed findings fixed.
