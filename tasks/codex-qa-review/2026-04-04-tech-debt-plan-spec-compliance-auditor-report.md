**Findings**
SPEC-001 [Critical] The plan is not fully compliant with the 42-item spec. Only 18/42 items are fully covered or explicitly deferred; 16 are only partially handled; 7 are missing entirely; 1 is incorrectly closed. The plan’s “39 genuine items” reduction at [2026-04-04-technical-debt-remediation.md:15](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L15) is not supportable.

SPEC-002 [High] The claimed “3 false positives” are not accurate. The IF-1 correction is valid because [ci.yml:1](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.github/workflows/ci.yml#L1) already exists. The two IF-2 corrections are not: the report never claimed “no `.nvmrc`”, and the live repo environment is still Node `v25.6.0`, so IF-2 remains real despite [.nvmrc:1](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/.nvmrc#L1) and [package.json:5](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/package.json#L5).

SPEC-003 [High] The middleware remediation does not solve the spec’s core DS-1 problem. [plan:1048](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L1048) says to reuse the existing public-path list, but that list marks `/api` public in [middleware.ts.disabled:7](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/middleware.ts.disabled#L7). The report explicitly called out API-route protection gaps; this plan restores page redirects while leaving API routes exempt.

SPEC-004 [High] The dependency-upgrade commands are technically wrong for DD-3, and the DD-1 acceptance criteria are stale. [plan:842](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L842) uses `npm update`, but current ranges in [package.json:29](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/package.json#L29), [package.json:30](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/package.json#L30), and [package.json:42](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/package.json#L42) will not reach the versions the report named. Separately, `npm audit --json` now reports 14 high and 40 moderate vulnerabilities, so [plan:105-139](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L105) cannot achieve “0 high/critical” with `npm audit fix` plus a Supabase bump alone.

SPEC-005 [High] The DS-7 parking fix is incompatible with the current codebase. The sample RPC in [plan:1129](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L1129) assumes `booking_date`, `vehicle_reg`, `guest_name`, and `parking_config.max_spaces`, but the live service uses `start_at`, `end_at`, `vehicle_registration`, `parking_rates`, and an existing capacity RPC in [parking.ts:44](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/parking.ts#L44), [capacity.ts:12](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/parking/capacity.ts#L12), and [repository.ts:11](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/parking/repository.ts#L11). The sample `COUNT(*) ... FOR UPDATE` is also not a viable row-locking design.

SPEC-006 [High] The IF-3 cron alerting sample will not compile as written. [plan:951](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L951) calls `sendEmail` with positional arguments, but [emailService.ts:24](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/email/emailService.ts#L24) exports `sendEmail(options)` with a single object parameter. The task also ignores the existing cron persistence utility in [cron-run-results.ts:14](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/cron-run-results.ts#L14).

SPEC-007 [High] The PF-3/DS-3 weekly-summary cron change is likely wrong. The route already self-gates to Monday and the configured London digest hour in [private-bookings-weekly-summary/route.ts:122](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-weekly-summary/route.ts#L122) and [private-bookings-weekly-summary/route.ts:133](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-weekly-summary/route.ts#L133), and it is idempotent in [private-bookings-weekly-summary/route.ts:150](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-weekly-summary/route.ts#L150). [plan:883](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L883) treats the schedule as suspect and biases toward hard-changing `vercel.json`, which would remove the current safe polling model and bypass env-based hour control.

SPEC-008 [Medium] The CQ-8/DS-5 discovery method is not actionable. [plan:569](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L569) tells workers to find four legacy files with `grep`, but that pattern currently hits definition files and a comment, not four consumer pages: [PageWrapper.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/layout/PageWrapper.tsx), [PageHeader.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/layout/PageHeader.tsx), [PageLayout.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/layout/PageLayout.tsx), and [AuthenticatedLayout.tsx:76](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/AuthenticatedLayout.tsx#L76). I could not find any live consumer imports/usages of `PageWrapper` or `PageHeader`.

SPEC-009 [Medium] The CI/coverage tasks do not meet their own acceptance criteria. [plan:153](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L153) can add tests to the already-existing workflow, but “block merges” is a branch-protection setting outside the repo. [plan:630](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L630) switches CI to `npm run test:coverage`, but [vitest.config.ts:12](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/vitest.config.ts#L12) defines no thresholds, so TD-6 is still only partially addressed.

SPEC-010 [Medium] PF-1’s proposed fixes are not technically sound. [plan:1096](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L1096) suggests a one-shot fetch of existing project codes, but the live logic in [projects.ts:77](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/oj-projects/projects.ts#L77) still needs conflict-safe retry/constraint handling under concurrency. For `event-images`, [event-images.ts:262](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/event-images.ts#L262) is looping over `getPublicUrl`, which is URL derivation rather than a database N+1 query, so “batch public URL generation” is not a meaningful fix.

SPEC-011 [Medium] The plan breaks traceability and contradicts its own sequencing. [plan:7](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L7) says phases are sequential, but [plan:1323](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L1323) says phases 3-4 can run in parallel even though both hit the same hotspots. [plan:775](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L775) also tells workers to edit the spec document itself, [technical-debt-report.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/technical-debt-report.md), which destroys the audit baseline.

SPEC-012 [Medium] CQ-4 is only partially handled and the proposed lint rule conflicts with repo policy. [plan:326](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/plans/2026-04-04-technical-debt-remediation.md#L326) suggests `no-console` at `warn` or `off`, but [package.json:13](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/package.json#L13) enforces `--max-warnings=0`, and the report asked for an `error` rule plus cleanup of existing `console.log`s.

Validation used for this audit: `npm test` still fails in exactly 13 files / 20 tests; `node -v` is `v25.6.0`; `npm audit --json` reports 14 high / 40 moderate vulnerabilities.

**Coverage Matrix**
Task refs below use the plan’s numbering (`T1.1` = Task 1.1, etc.). `Deferred` means the explicit deferred-items block.

| ID | Plan mapping | Status | Note |
|---|---|---|---|
| CQ-1 | T6.4 | Partial | Concrete task exists, but it ignores the report’s hotspot order and only targets `<200` remaining |
| CQ-2 | T2.1 | Covered | Directly addresses unknown-error migration |
| CQ-3 | T3.1-T3.3 | Partial | Only 3 of 27 oversized files have concrete tasks |
| CQ-4 | T2.2 | Partial | Rule only; existing `console.log`s not removed; wrong severity |
| CQ-5 | T3.6 | Covered | Hex-color sweep is defined |
| CQ-6 | T3.4 | Covered | Button-type sweep is defined |
| CQ-7 | Phase 1 note | Covered | Explicitly treated as already healthy/no-op |
| CQ-8 | T3.5 | Partial | Task exists, but discovery method is wrong and repo evidence is weak |
| TD-1 | T1.1 | Covered | Matches live failing suite |
| TD-2 | T4.2-T4.7 | Covered | Tests added for the six named action files |
| TD-3 | T4.8-T4.9 | Partial | Misses `table-bookings` and `jobs/process`; only Stripe/Twilio are concrete |
| TD-4 | None | Missing | No explicit component-testing task or deferral |
| TD-5 | Deferred | Deferred | Explicitly deferred as separate Playwright project |
| TD-6 | T4.1 | Partial | Coverage run added, but no threshold enforcement |
| TD-7 | None | Missing | No task or deferral for script-test debt |
| DD-1 | T1.2 | Partial | Concrete task exists, but current audit state makes acceptance inaccurate |
| DD-2 | T5.1 | Covered | Clear decision to stay on Tailwind v3 |
| DD-3 | T5.2 + Deferred | Partial | Minor-bump command is wrong; deferral list is incomplete |
| DD-4 | Deferred | Deferred | Explicitly deferred |
| DD-5 | Deferred | Deferred | Explicitly deferred |
| DD-6 | T5.1 | Covered | Removed with Tailwind v3 decision |
| DS-1 | T6.1 | Partial | Re-enables middleware, but proposed scope still leaves `/api` public |
| DS-2 | Deferred | Deferred | Explicitly deferred as ongoing architectural refactor |
| DS-3 | T5.4 + roadmap checkbox | Partial | One cron schedule addressed; no concrete 30-cron audit/consolidation task |
| DS-4 | T5.7 | Covered | Process guidance added |
| DS-5 | T3.5 | Partial | Same work as CQ-8; task discovery is unreliable |
| DS-6 | T5.5 | Covered | Explicit PostCSS ESM conversion task |
| DS-7 | T6.3 | Partial | Task exists, but proposed implementation mismatches live parking design |
| IF-1 | Correction block + T1.3 | Partial | CI exists already; task only adds tests and not merge gating |
| IF-2 | Correction block / Phase 1 close | Incorrect | Not a false positive; live env is still Node 25 |
| IF-3 | T5.6 | Partial | Task exists, but sample code is wrong and only covers top 5 crons |
| IF-4 | T6.6 | Covered | Scripts README task is explicit |
| IF-5 | None | Missing | No backup verification task or deferral |
| DC-1 | T6.5 | Covered | TODO-to-issue conversion task is explicit |
| DC-2 | T5.1 | Covered | CLAUDE Tailwind version update included |
| DC-3 | T5.3 | Covered | CLAUDE cron-table update included |
| DC-4 | None | Missing | No `.env.example` changelog task or deferral |
| PF-1 | T6.2 | Partial | Task exists, but one fix is non-query work and one remains concurrency-prone |
| PF-2 | None | Missing | Claimed by phase header, but no concrete task for `oj-projects-billing/route.ts` |
| PF-3 | T5.4 | Partial | Task exists, but current hourly schedule appears intentional/idempotent |
| PF-4 | None | Missing | No exclusion/mitigation task |
| PF-5 | None | Missing | No investigation/background-job task or deferral |

**Assumptions**
- I treated roadmap-only checkboxes as insufficient unless backed by a concrete task or an explicit deferral.
- I treated DS-5 as the same underlying work item as CQ-8, since both describe the same legacy `PageWrapper`/`PageHeader` cleanup.

The plan should not be executed as-is. It needs a revised false-positive section, concrete coverage for the seven missing items, and technical rewrites for DS-1, DD-1/DD-3, DS-7, IF-3, PF-1, and PF-3 before it can be considered spec-compliant.