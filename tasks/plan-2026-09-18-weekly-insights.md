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

- [ ] `types.ts`: the contracts in spec 4.1 plus `SectionDefinition`, `SectionBuildResult`, `InsightsReport`, `RankedAction`, `InsightsSummary`, `UpcomingItem`.
- [ ] `thresholds.ts`: floors, rule thresholds, deadlines, pool size, email budget, collection start dates, feedback keywords, maintenance area categories, short-link exclusions.
- [ ] `windows.ts`: `computeWindows(now)` and `londonDayStartIso(date)`, `londonRangeInstants(range)`.
- [ ] `compare.ts`: weekly average, change, notable, trend, minimum history, sentence helpers.
- [ ] `format.ts`: money, percent, day-date, plural, clip, days-between.
- [ ] `signals.ts`: `mergeSignals`, `worstRag`, `ragRank`, entity de-duplication, scoring.
- [ ] `engine.ts`: pool of 4, 8-second section deadline, 25-second build deadline, abort wiring, discard late results, structured failure log, status derivation.
- [ ] `summary.ts`, `actions.ts`: spec 4.6 and 4.7, from section objects only.
- [ ] `registry.ts`: the ordered list of 15 section definitions.
- [ ] Tests: windows (normal week, 25 Oct 2026, 28 Mar 2027, London and UTC), compare, engine (never-resolving builder, abort-aware builder, throwing builder, overall deadline, no unhandled rejection, same `now` to every builder), summary and actions (precedence, de-duplication, reds first, cap, green cap, win from a red section excluded).
- [ ] Guard test `tests/guards/insights-sections.test.ts`.
- [ ] Commit: `feat(insights): add the report engine, windows and comparison rules`.

## Wave 2: outputs (main agent)

- [ ] `src/lib/insights/email/render.ts`: exception-first email (spec 7), HTML and text; tests for lists, no backgrounds, links, budget, size, invalid values, every headline present, "N more", reds never silently dropped, footer.
- [ ] `src/lib/manager-report/schedule.ts`: 06:00 gate.
- [ ] `src/lib/manager-report/delivery.ts`: build the insights report; one report per Friday (old or new); new id namespace; not-checked before 09:00 means no freeze; 09:00 partial send alerts; legacy frozen reports finished first with source finalisation; recipient `MANAGER_EMAIL` validated.
- [ ] `src/app/api/cron/manager-weekly-report/route.ts`: `reportCronFailure` on total failure; tests.
- [ ] Update `tests/lib/manager-report/delivery.test.ts` and `route.test.ts`; add the cutover state-matrix tests.
- [ ] Page: `src/app/(authenticated)/insights/page.tsx` (+ `loading.tsx`, `_components/`), super-admin gate before engine, `force-dynamic`, summary, jump links, section cards, `<details>`, Print and Refresh, print styles; `print:hidden` on shell chrome.
- [ ] Nav item after Dashboard (`trendUp` icon, `superAdminOnly`); update nav tests.
- [ ] `/rota/leave` row anchors `leave-<id>`.
- [ ] Commit per logical piece.

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

- [ ] Each section: builder, fixture tests for every row of its signal table and every listed case, `emailSafe` set deliberately, links absolute via `ctx.link`.
- [ ] Main agent diffs every changed file against the owned list before committing.

## Wave 4: cutover (one agent)

- [ ] Spec 8.1 items 1 to 6 and 8, with their tests updated or removed (grep `tests/` for every deleted module).
- [ ] `scripts/insights/cutover-preflight.ts` (read-only, counts and ids only).
- [ ] `docs/manager-weekly-report.md` rewritten; `docs/agent-reference.md` cron list; `docs/README.md` if needed.

## Wave 5: review and fix

- [ ] Independent per-section verification against the spec and live schema (read-only aggregate queries), plus cross-cutting reviews: engine and delivery, email and page, cutover. Adversarially verify findings, then fix.

## Wave 6: gates and evidence

- [ ] `npm run lint`, `npx tsc --noEmit` (big heap), `npm test`, `npm run test:utc`, `npm run build` (env symlinked).
- [ ] Email preview from fixtures; read-only production preview to a local file; screenshot of the page harness (fixture report) including print media.
- [ ] Preflight run (read-only) and output recorded.
- [ ] Final `git status`, commit list, and the owner's local review instructions.

## Assumptions recorded

See spec section 2.2. Owner questions were not answered; recommended positions adopted.
