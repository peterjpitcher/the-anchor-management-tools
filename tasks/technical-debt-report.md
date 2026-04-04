# Technical Debt Inventory

**Repository**: OJ-AnchorManagementTools
**Analysis Date**: 2026-04-04
**Analyst**: Technical Debt Manager (automated scan + manual review)
**Total Debt Items**: 42

---

## Executive Summary

| Severity | Count | Action Required |
|----------|-------|-----------------|
| Critical | 2 | Immediate (this sprint) |
| High | 12 | Next 2 sprints |
| Medium | 17 | Next quarter |
| Low | 11 | Backlog |

**Repository Profile**: 906 source files, ~250K lines of TypeScript/TSX. 128 API routes, 78 server action files, 30 cron jobs, 306 Supabase migrations, 274 test files (252 in `tests/`, 22 in `src/`). Lint and typecheck both pass clean.

**Key Findings**:
- 13 test files (20 tests) are currently failing -- this blocks reliable CI
- 617 `as any` type assertions and 169 `catch (error: any)` patterns undermine TypeScript strict mode
- 27 files exceed 1,000 lines; the largest client component is 3,802 lines
- Tailwind v3 is active in production despite `@tailwindcss/postcss` v4 being installed as a devDependency
- Middleware is disabled (`middleware.ts.disabled`) -- auth relies solely on layout-level checks
- 9 npm vulnerabilities (7 high, 2 moderate) from `tar`, `picomatch`, and `yaml`

---

## Debt by Category

| # | Category | Count | Top Severity | Estimated Effort |
|---|----------|-------|-------------|------------------|
| 1 | Code Quality | 8 | High | 8-12 days |
| 2 | Test Debt | 7 | Critical | 6-10 days |
| 3 | Dependency Debt | 6 | High | 3-5 days |
| 4 | Design Debt | 7 | Medium | 10-15 days |
| 5 | Infrastructure Debt | 5 | High | 4-6 days |
| 6 | Documentation Debt | 4 | Low | 2-3 days |
| 7 | Performance Debt | 5 | Medium | 5-8 days |

---

## 1. Code Quality Debt

### CQ-1 [HIGH] 617 `as any` type assertions across the codebase

TypeScript strict mode is on, but 617 `as any` casts effectively disable it at those call sites. This hides real type mismatches that become runtime bugs.

- **Impact**: Type safety erosion; bugs slip through at cast boundaries
- **Effort**: 5-8 days (incremental -- batch by module)
- **Fix**: Replace with proper type narrowing, generics, or Supabase-generated types. Prioritise files in `src/app/actions/` (hottest change area) first.
- **Hotspot files**: `src/app/actions/receipts.ts`, `src/services/private-bookings.ts`, `src/app/actions/privateBookingActions.ts`

### CQ-2 [HIGH] 169 `catch (error: any)` blocks (138 in server actions alone)

A `getErrorMessage()` utility already exists at `src/lib/errors.ts` with a TODO noting ~140 remaining occurrences. The actual count has grown to 169.

- **Impact**: Untyped error handling masks unexpected error types; `error.message` calls on non-Error objects crash silently
- **Effort**: 2-3 days (mechanical refactor with search-and-replace)
- **Fix**: Change to `catch (error: unknown)` + `getErrorMessage(error)`. Can be done file-by-file alongside other work.

### CQ-3 [HIGH] 27 files exceed 1,000 lines (god objects)

Largest offenders:
| File | Lines | 90-Day Commits |
|------|-------|----------------|
| `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` | 3,802 | 27 |
| `src/app/actions/receipts.ts` | 3,623 | 27 |
| `src/services/private-bookings.ts` | 3,436 | 27 |
| `src/app/api/cron/oj-projects-billing/route.ts` | 3,434 | 5 |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | 2,627 | 8 |
| `src/app/actions/privateBookingActions.ts` | 1,882 | 18 |

FohScheduleClient.tsx is the single highest-churn, highest-LOC file in the project.

- **Impact**: Hard to review, hard to test, merge conflicts, slow comprehension
- **Effort**: 2-3 days per file to decompose (start with FohScheduleClient)
- **Fix**: Extract sub-components, custom hooks, and utility functions. Each extraction should be its own PR.

### CQ-4 [MEDIUM] 123 `console.log` statements in production code

- **Impact**: Noisy logs in production, potential PII leakage
- **Effort**: 1 day
- **Fix**: Replace with structured logger (`src/lib/logger.ts` if it exists) or remove. Add an ESLint rule: `no-console: ["error", { allow: ["warn", "error"] }]`.

### CQ-5 [MEDIUM] 107 hardcoded hex colour values in `.tsx` components

CLAUDE.md mandates design tokens only. 107 instances of `#XXXXXX` in component files bypass the design system.

- **Impact**: Inconsistent theming, fragile visual updates
- **Effort**: 2 days
- **Fix**: Map each colour to a Tailwind token or CSS variable. Sweep through with global search.

### CQ-6 [MEDIUM] 333 `<button>` elements without explicit `type` attribute

Without `type="button"`, buttons default to `type="submit"` and can trigger unintended form submissions.

- **Impact**: Subtle form bugs, especially in modals and dialogs
- **Effort**: 1 day (mechanical fix)
- **Fix**: Add `type="button"` to non-submit buttons. Consider an ESLint rule (`react/button-has-type`).

### CQ-7 [LOW] 3 `eslint-disable` directives

Only 3 suppressions -- very healthy. Keep enforcing zero-warning builds.

### CQ-8 [LOW] 4 files still use legacy `PageWrapper`/`PageHeader` pattern

CLAUDE.md says new pages must use `ui-v2` (`PageLayout` + `HeaderNav`). 211 files already use `ui-v2`, only 4 remain on the legacy pattern.

- **Effort**: 0.5 day
- **Fix**: Migrate remaining 4 files to `ui-v2`.

---

## 2. Test Debt

### TD-1 [CRITICAL] 13 test files failing (20 tests)

Failing test files:
1. `tests/api/tablePaymentCheckoutRouteReasonMapping.test.ts`
2. `tests/api/stripeWebhookMutationGuards.test.ts` (4 failures)
3. `tests/api/tableBookingRouteErrorPayloads.test.ts`
4. `tests/api/tableBookingStatusMutationGuards.test.ts` (3 failures)
5. `tests/api/twilioWebhookMutationGuards.test.ts`
6. `tests/lib/shortLinksBaseUrl.test.ts`
7. `tests/lib/sundayPreorderMutationGuards.test.ts`
8. `tests/lib/tableBookingHoldAlignment.test.ts` (2 failures)
9. `tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts`
10. `tests/services/menu.service.test.ts` (2 failures)
11. `tests/services/privateBookingsMutationGuards.test.ts`
12. `tests/services/short-links.service.test.ts`
13. `src/app/api/external/table-bookings/[id]/paypal/create-order/__tests__/route.test.ts`

- **Impact**: CI cannot be trusted; developers ignore test results; regressions slip through
- **Effort**: 2-3 days to fix or update all 20 failing tests
- **Fix**: Triage each failure -- either the test or the implementation drifted. Fix tests to match current behaviour or fix the bugs the tests reveal.

### TD-2 [HIGH] Low test coverage on server actions (24 test files / 78 action files = 31%)

Server actions are the primary mutation path for the entire application. Less than a third have dedicated tests.

- **Impact**: High-risk mutations (payments, bookings, employee actions) may lack coverage
- **Effort**: 5-8 days (prioritise payment, booking, and auth actions)
- **Fix**: Add tests for `receipts.ts`, `privateBookingActions.ts`, `rota.ts`, `events.ts`, `timeclock.ts`, `invoices.ts` first (highest churn).

### TD-3 [HIGH] API routes almost untested (6 test files / 128 routes = 5%)

128 API routes exist but only 6 have test files. Webhook and cron routes handle money and external integrations.

- **Impact**: Webhook processing (Stripe, PayPal, Twilio) and cron jobs run untested
- **Effort**: 3-5 days for critical routes
- **Fix**: Prioritise: `stripe/webhook`, `webhooks/twilio`, `foh/bookings`, `table-bookings`, `jobs/process`.

### TD-4 [MEDIUM] No component-level test coverage

Only 5 component-related test files exist. The 3,802-line FohScheduleClient has zero tests.

- **Impact**: UI regressions caught only manually
- **Effort**: Ongoing (add tests as components are modified)
- **Fix**: Add tests for top-5 most-changed client components when they are next modified.

### TD-5 [MEDIUM] No end-to-end (E2E) test suite

Playwright is mentioned in CLAUDE.md but no `e2e/` or `playwright/` test directory exists.

- **Impact**: No automated verification of full user flows (booking, payment, auth)
- **Effort**: 3-5 days for initial setup + 3-5 critical flows
- **Fix**: Set up Playwright with page objects for: login, table booking, private booking, event RSVP, timeclock.

### TD-6 [MEDIUM] No test coverage reporting in CI

`vitest.config.ts` has coverage configured (`v8` provider) but `npm test` does not run with `--coverage` by default.

- **Impact**: Coverage regressions go unnoticed
- **Effort**: 0.5 day
- **Fix**: Add a CI step that runs `npm run test:coverage` and fails if coverage drops below threshold.

### TD-7 [LOW] 232 scripts in `scripts/` directory with minimal testing

The `scripts/` directory contains 232 TypeScript files (fix scripts, tools, testing utilities). Only a handful have corresponding tests.

- **Impact**: One-off scripts may be safe to leave untested, but reusable utilities should be covered
- **Effort**: Low priority unless scripts are run regularly

---

## 3. Dependency Debt

### DD-1 [HIGH] 9 npm audit vulnerabilities (7 high, 2 moderate)

| Package | Severity | Issue |
|---------|----------|-------|
| `tar` (via `supabase`) | High | Hardlink/Symlink Path Traversal (GHSA-9ppj, GHSA-qffp) |
| `picomatch` (4 instances) | High | ReDoS via extglob quantifiers (GHSA-c2c7) |
| `yaml` | Moderate | Stack Overflow via deeply nested collections (GHSA-48c2) |

- **Impact**: `tar` vulnerabilities are exploitable in CI/build pipelines; `picomatch` affects Vite/Vitest
- **Effort**: 0.5 day
- **Fix**: Run `npm audit fix`. If `supabase` CLI blocks the `tar` fix, update `supabase` to latest (2.84.10, currently 2.76.15).

### DD-2 [HIGH] Tailwind CSS version conflict (v3 active, v4 devDependency installed)

`package.json` has both:
- `tailwindcss: ^3.4.0` (production dependency, active via `postcss.config.js`)
- `@tailwindcss/postcss: ^4.1.8` (devDependency, unused)

CLAUDE.md claims "Tailwind CSS v4" but the project actually runs Tailwind v3. The v4 PostCSS plugin is installed but not wired up.

- **Impact**: Developer confusion; unused dependency bloat; missing v4 features (CSS-first config, `@theme`)
- **Effort**: 2-3 days (migration requires updating `globals.css`, removing `tailwind.config.js`, switching PostCSS plugin)
- **Fix**: Either complete the v4 migration or remove `@tailwindcss/postcss` and update CLAUDE.md to say v3. Pick one.

### DD-3 [MEDIUM] Major version gaps in key dependencies

| Package | Current | Latest | Gap |
|---------|---------|--------|-----|
| `@supabase/ssr` | 0.6.1 | 0.10.0 | 4 minor |
| `googleapis` | 150.0.1 | 171.4.0 | 21 minor |
| `lucide-react` | 0.522.0 | 1.7.0 | Major |
| `@sparticuz/chromium` | 138.0.2 | 143.0.4 | 5 minor |
| `jsdom` | 25.0.1 | 29.0.1 | 4 major |
| `dotenv` | 16.6.1 | 17.4.0 | Major |
| `zod` | 3.25.76 | 4.3.6 | Major |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.1 | 2 major |

- **Impact**: Missing bug fixes, security patches, and performance improvements
- **Effort**: 1-2 days for minor bumps; major bumps need individual PRs
- **Fix**: Update `@supabase/ssr` and `googleapis` first (most likely to have security/feature benefits). Major bumps (`lucide-react`, `zod`, `jsdom`) need dedicated migration PRs.

### DD-4 [MEDIUM] Next.js 15.5.9 with Next.js 16.2.2 available

- **Impact**: Missing performance improvements, new features, and security patches
- **Effort**: 1-2 days (test all routes after upgrade)
- **Fix**: Upgrade to latest Next.js 15.x first, then evaluate 16.x migration (breaking changes with middleware rename to proxy).

### DD-5 [LOW] TypeScript 5.9.3 with 6.0.2 available

- **Effort**: 0.5 day
- **Fix**: Test and upgrade when ready.

### DD-6 [LOW] `@tailwindcss/postcss` v4 devDependency adds unused weight

If not migrating to v4 soon, remove it to reduce confusion.

---

## 4. Design Debt

### DS-1 [MEDIUM] Disabled middleware (`src/middleware.ts.disabled`)

Per CLAUDE.md: "disabled after a Vercel incident; auth is enforced in `(authenticated)/layout.tsx`". Layout-level auth is a weaker pattern than middleware:
- Does not protect API routes under `(authenticated)/`
- Cannot enforce redirects before page rendering begins
- Every new route group must remember to add auth checks

- **Impact**: Auth enforcement gap; increased attack surface
- **Effort**: 2-3 days to re-enable and test
- **Fix**: Investigate the original Vercel incident. Re-enable middleware with proper error handling and fallback behaviour.

### DS-2 [MEDIUM] Server actions split across 78 files with no service layer boundary

Many server actions in `src/app/actions/` directly query Supabase rather than going through `src/services/`. This creates two data access patterns: actions-direct and actions-via-services.

- **Impact**: Duplicated query logic; inconsistent error handling; hard to test
- **Effort**: 5-8 days (incremental)
- **Fix**: Establish a convention: actions call services, services call Supabase. Start with the highest-churn action files.

### DS-3 [MEDIUM] 30 cron jobs -- operational complexity

30 Vercel cron jobs is unusually high. Some run very frequently:
- `api/jobs/process` runs **every minute**
- 5 jobs run every 15 minutes
- 2 jobs run every 5 minutes
- `private-bookings-weekly-summary` runs **every hour** despite its name

- **Impact**: High Vercel function invocations; potential race conditions between overlapping crons; hard to debug
- **Effort**: 2-3 days to audit and consolidate
- **Fix**: Audit whether hourly/frequent crons can be consolidated. Rename or fix the "weekly summary" that runs hourly. Consider a unified job processor pattern (already partially in place with `api/jobs/process`).

### DS-4 [MEDIUM] 306 database migrations (57 are "fix" migrations)

19% of migrations are corrective ("fix", "hotfix", "patch", "revert"). This suggests migrations are being written without adequate local testing.

- **Impact**: Migration history is hard to reason about; rollbacks are complex
- **Effort**: 1 day (process improvement)
- **Fix**: Enforce `npx supabase db push --dry-run` before committing migrations. Consider squashing old migrations periodically.

### DS-5 [MEDIUM] Inconsistent component patterns (ui-v2 migration 98% complete)

211 files use `ui-v2`, 4 still use legacy `PageWrapper`/`PageHeader`. Nearly done but not quite.

- **Effort**: 0.5 day to finish migration

### DS-6 [LOW] `postcss.config.js` uses CommonJS (`module.exports`) in an ESM-leaning project

- **Effort**: 0.25 day
- **Fix**: Rename to `postcss.config.mjs` with `export default`.

### DS-7 [LOW] TOCTOU race condition acknowledged but unfixed in parking service

`src/services/parking.ts:85` has a TODO: "TOCTOU race condition -- the capacity check and booking insert are not atomic."

- **Impact**: Theoretical double-booking of parking spaces under concurrent requests
- **Effort**: 1 day
- **Fix**: Use a Supabase RPC with a `SELECT ... FOR UPDATE` or a unique constraint to make the operation atomic.

---

## 5. Infrastructure Debt

### IF-1 [HIGH] No CI/CD pipeline configuration visible in repository

No `.github/workflows/`, no `vercel.json` build commands beyond crons, no visible CI configuration. Vercel likely auto-deploys on push, but there is no evidence of pre-deploy checks (lint, typecheck, test).

- **Impact**: Failing tests and type errors can reach production
- **Effort**: 1-2 days
- **Fix**: Add a GitHub Actions workflow that runs the verification pipeline (`lint -> typecheck -> test -> build`) on every PR. Block merges on failure.

### IF-2 [HIGH] Node.js 25.6.0 in development (package.json requires >=20 <23)

The local development environment is running Node.js 25.6.0, which exceeds the `engines` constraint of `<23`. This means the dev environment does not match production.

- **Impact**: Node 25 may have different behaviour than the Node 20.x Vercel uses in production
- **Effort**: 0.5 day
- **Fix**: Use `nvm` or `volta` to pin Node to 20.x LTS locally. Update `engines` if intentionally moving to a newer version.

### IF-3 [MEDIUM] No monitoring or alerting for cron job failures

30 cron jobs run without apparent alerting on failure. `persistCronRunResult` exists in some crons but failure notifications are not visible.

- **Impact**: Silent cron failures can go unnoticed for days (e.g., missed SMS reminders, stale parking notifications)
- **Effort**: 1-2 days
- **Fix**: Add a cron health check dashboard or integrate with an alerting service (e.g., Vercel logs + alert rules, or a dedicated service like Better Uptime).

### IF-4 [MEDIUM] 232 scripts in `scripts/` directory lack documentation

The `scripts/` directory is large and appears to contain a mix of one-off fixes, testing utilities, and operational tools. No README or index exists.

- **Effort**: 1 day
- **Fix**: Add a `scripts/README.md` documenting which scripts are safe to run, which are destructive, and which are obsolete.

### IF-5 [LOW] No database backup verification process documented

Supabase provides automatic backups, but there is no documented process for verifying backup integrity or performing restores.

- **Effort**: 0.5 day to document
- **Fix**: Document backup schedule, retention, and restoration procedure.

---

## 6. Documentation Debt

### DC-1 [MEDIUM] 6 TODO/FIXME comments in source code without tracking

| File | TODO |
|------|------|
| `src/services/financials.ts:92` | Parallelise page fetches |
| `src/services/parking.ts:85` | TOCTOU race condition |
| `src/types/private-bookings.ts:136` | Verify DB field exists |
| `src/app/actions/messagesActions.ts:66` | Replace JS grouping with RPC |
| `src/lib/errors.ts:5` | Migrate ~140 catch blocks |
| `src/lib/google-calendar.ts:9` | (false positive -- RFC3339 format) |

5 genuine TODOs. None are tracked in an issue tracker.

- **Effort**: 0.5 day
- **Fix**: Convert each to a GitHub Issue with priority label. Remove or link the inline TODO.

### DC-2 [LOW] CLAUDE.md says "Tailwind CSS v4" but project uses v3

- **Fix**: Update CLAUDE.md to reflect reality, or complete the v4 migration.

### DC-3 [LOW] CLAUDE.md cron table is outdated (lists 5 crons; actual count is 30)

- **Fix**: Update the cron table or reference `vercel.json` as the source of truth.

### DC-4 [LOW] No `.env.example` changelog

Environment variables are documented in `.env.example` but there is no log of when variables were added or removed.

---

## 7. Performance Debt

### PF-1 [MEDIUM] N+1 query patterns in server actions

Identified in:
- `src/app/actions/rota.ts:1079` -- loops over weeks, querying `rota_published_shifts` per week
- `src/app/actions/oj-projects/projects.ts:77` -- loops up to 10 times checking for unique project codes
- `src/app/actions/event-images.ts:262` -- loops over images getting public URLs

- **Impact**: Slow server action responses; increased Supabase query load
- **Effort**: 1-2 days
- **Fix**: Batch queries with `.in()` filters or use Supabase RPCs for atomic operations.

### PF-2 [MEDIUM] 3,434-line cron route (`oj-projects-billing/route.ts`)

A single API route handling billing logic should not be this large. Complex billing logic in a single function risks timeouts and is impossible to unit test.

- **Impact**: Hard to debug billing issues; risk of Vercel function timeouts
- **Effort**: 2-3 days
- **Fix**: Extract billing logic into a service layer; break into smaller, testable functions.

### PF-3 [MEDIUM] `private-bookings-weekly-summary` cron runs hourly

A "weekly summary" running 168 times per week wastes Vercel function invocations and Supabase queries.

- **Impact**: Unnecessary compute costs; potential rate limiting
- **Effort**: 0.5 day
- **Fix**: Change schedule to `0 9 * * 1` (9 AM every Monday) or document why hourly is intentional.

### PF-4 [LOW] 12,096-line generated types file (`database.generated.ts`)

This is expected for Supabase codegen but may slow IDE performance.

- **Impact**: Slower TypeScript language server
- **Effort**: N/A (generated file)
- **Mitigation**: Ensure it is excluded from search indexes and linting.

### PF-5 [LOW] `maxDuration: 300` on 4 API routes

Four routes set 300-second (5-minute) maximum duration. This is the Vercel Pro plan limit and suggests these routes sometimes run very long.

Routes: `receipts/export`, `invoices/export`, `rota/resync-calendar`, `cron/event-guest-engagement`

- **Impact**: Long-running functions block resources; user-facing routes may appear hung
- **Effort**: Varies
- **Fix**: Investigate why these need 5 minutes. Consider background job processing for export routes.

---

## Top 10 Highest-Impact Items (Prioritized)

| # | ID | Severity | Item | Effort | Business Impact |
|---|-----|----------|------|--------|-----------------|
| 1 | TD-1 | Critical | Fix 20 failing tests across 13 files | 2-3 days | Restores CI trust; unblocks reliable deployments |
| 2 | DD-1 | High | Resolve 9 npm audit vulnerabilities | 0.5 day | Eliminates known security exposure |
| 3 | IF-1 | High | Add CI/CD pipeline (lint + typecheck + test + build) | 1-2 days | Prevents broken code reaching production |
| 4 | CQ-3 | High | Decompose FohScheduleClient.tsx (3,802 lines) | 2-3 days | Reduces merge conflicts in highest-churn file |
| 5 | DS-1 | Medium | Re-enable or replace middleware.ts | 2-3 days | Strengthens auth enforcement |
| 6 | DD-2 | High | Resolve Tailwind v3/v4 conflict | 2-3 days | Eliminates dev confusion; unblocks v4 features |
| 7 | CQ-2 | High | Migrate 169 `catch (error: any)` to typed handling | 2-3 days | Prevents silent error swallowing |
| 8 | TD-2 | High | Add tests for top-6 server action files | 5-8 days | Covers critical mutation paths |
| 9 | CQ-1 | High | Reduce `as any` count (617 instances) | 5-8 days | Restores TypeScript safety guarantees |
| 10 | IF-2 | High | Fix Node.js version mismatch (25 vs <23) | 0.5 day | Ensures dev/prod parity |

---

## Sprint-Ready Work Items

### Sprint 1: Stability & Security (Week 1-2)

**Story 1: Fix all failing tests**
- Priority: Critical
- Effort: 3 days
- Acceptance Criteria:
  - [ ] All 20 failing tests pass or are updated to match current behaviour
  - [ ] `npm test` exits with 0 failures
  - [ ] No tests are skipped or deleted without justification

**Story 2: Resolve npm audit vulnerabilities**
- Priority: High
- Effort: 0.5 day
- Acceptance Criteria:
  - [ ] `npm audit` reports 0 high/critical vulnerabilities
  - [ ] `supabase` CLI updated to latest
  - [ ] Build passes after dependency updates

**Story 3: Add GitHub Actions CI pipeline**
- Priority: High
- Effort: 1.5 days
- Acceptance Criteria:
  - [ ] PRs run: lint, typecheck, test, build
  - [ ] Merges blocked on any failure
  - [ ] Pipeline completes in < 5 minutes

**Story 4: Fix Node.js version mismatch**
- Priority: High
- Effort: 0.5 day
- Acceptance Criteria:
  - [ ] `.nvmrc` or `.node-version` file pins Node 20.x LTS
  - [ ] `engines` field in `package.json` matches
  - [ ] All devs notified

### Sprint 2: Code Quality (Week 3-4)

**Story 5: Decompose FohScheduleClient.tsx**
- Priority: High
- Effort: 3 days
- Acceptance Criteria:
  - [ ] Main file reduced to < 500 lines
  - [ ] Sub-components extracted with props interfaces
  - [ ] No visual regressions (manual QA)
  - [ ] Tests added for extracted components

**Story 6: Migrate `catch (error: any)` in server actions**
- Priority: High
- Effort: 2 days
- Acceptance Criteria:
  - [ ] All 138 instances in `src/app/actions/` migrated to `catch (error: unknown)` + `getErrorMessage()`
  - [ ] Lint and typecheck pass
  - [ ] No behaviour changes

**Story 7: Resolve Tailwind v3/v4 conflict**
- Priority: High
- Effort: 2 days
- Acceptance Criteria:
  - [ ] Single Tailwind version in use
  - [ ] CLAUDE.md updated to match reality
  - [ ] All pages visually verified

### Sprint 3: Test Coverage (Week 5-6)

**Story 8: Add server action tests for payment/booking modules**
- Priority: High
- Effort: 5 days
- Acceptance Criteria:
  - [ ] `receipts.ts` -- happy path + error case
  - [ ] `privateBookingActions.ts` -- happy path + error case
  - [ ] `rota.ts` -- happy path + error case
  - [ ] `events.ts` -- happy path + error case
  - [ ] `invoices.ts` -- happy path + error case
  - [ ] `timeclock.ts` -- happy path + error case

**Story 9: Add webhook route tests**
- Priority: High
- Effort: 3 days
- Acceptance Criteria:
  - [ ] `stripe/webhook/route.ts` tested (signature verification, event handling, error cases)
  - [ ] `webhooks/twilio/route.ts` tested
  - [ ] `foh/bookings/route.ts` tested

---

## Quarterly Roadmap

### Month 1: Foundation (Sprints 1-2)
- [ ] Fix failing tests (TD-1)
- [ ] Resolve npm vulnerabilities (DD-1)
- [ ] Add CI pipeline (IF-1)
- [ ] Fix Node version mismatch (IF-2)
- [ ] Decompose FohScheduleClient (CQ-3)
- [ ] Migrate catch blocks (CQ-2)
- [ ] Resolve Tailwind conflict (DD-2)

### Month 2: Coverage & Quality (Sprint 3-4)
- [ ] Add server action tests (TD-2)
- [ ] Add webhook/API route tests (TD-3)
- [ ] Begin `as any` reduction campaign (CQ-1)
- [ ] Add cron job monitoring (IF-3)
- [ ] Fix N+1 queries (PF-1)
- [ ] Audit and consolidate cron jobs (DS-3)

### Month 3: Architecture & Polish (Sprint 5-6)
- [ ] Re-enable or replace middleware (DS-1)
- [ ] Extract service layer boundaries (DS-2)
- [ ] Decompose remaining god objects (CQ-3 continued)
- [ ] Set up E2E testing with Playwright (TD-5)
- [ ] Fix hardcoded colours (CQ-5)
- [ ] Add button type attributes (CQ-6)
- [ ] Update dependency majors (DD-3)
- [ ] Document scripts directory (IF-4)
- [ ] Convert TODOs to tracked issues (DC-1)

### Success Metrics (Target: End of Quarter)

| Metric | Current | Target |
|--------|---------|--------|
| Failing tests | 20 | 0 |
| npm audit high/critical | 7 | 0 |
| `as any` count | 617 | < 200 |
| `catch (error: any)` count | 169 | 0 |
| Files > 1,000 lines | 27 | < 15 |
| Server action test coverage | 31% | 60% |
| API route test coverage | 5% | 25% |
| CI pipeline | None | Full gate |

---

## Fowler Debt Quadrant Classification

| Quadrant | Examples |
|----------|----------|
| **Deliberate + Prudent** | Disabled middleware (known tradeoff after Vercel incident); hourly "weekly" cron (may be intentional idempotent polling) |
| **Deliberate + Reckless** | 617 `as any` casts; shipping without CI; 169 untyped catch blocks |
| **Inadvertent + Prudent** | Tailwind v3/v4 conflict (migration started, not finished); god objects growing organically |
| **Inadvertent + Reckless** | 20 failing tests; Node version mismatch; npm vulnerabilities unpatched |

---

*Report generated by Technical Debt Manager agent. All file paths and counts verified against the repository as of 2026-04-04.*
