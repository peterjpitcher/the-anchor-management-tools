# Technical Debt Remediation Plan (Revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematically eliminate 42 technical debt items across 7 categories, restoring CI trust, strengthening type safety, improving test coverage, and cleaning up architectural issues.

**Architecture:** Seven phases executed sequentially. Each phase is independently deployable and produces measurable improvements. Phases ordered by risk: stability first, then coverage (tests before refactoring), then quality, then architecture.

**Tech Stack:** Next.js 15.5.9, React 19, TypeScript (strict), Vitest, Tailwind CSS 3.4, Supabase, Vercel

**Source Report:** `tasks/technical-debt-report.md` (42 items, analysed 2026-04-04)
**QA Review:** `tasks/codex-qa-review/2026-04-04-tech-debt-plan-codex-qa-report.md` (28 findings from 5 specialists)

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-04-04 | Initial plan |
| v2 | 2026-04-04 | Full revision based on dual-engine QA review (5 critical, 9 high findings addressed) |

### Key Changes in v2
- **Swapped Phase 3 (decomposition) and Phase 4 (tests)** — tests now come before refactoring
- **Added Phase 7** for explicitly deferred/missing items
- **Rewrote Tasks 2.1, 5.4, 6.1, 6.2, 6.3** based on actual codebase verification
- **Added complexity scores and PR strategy** to every task
- **Added full verification pipeline** to every task
- **Added DoD checkpoint** at every phase boundary
- **Restored IF-2** as genuine item (`.nvmrc` exists but local dev runs Node 25)
- **Removed false N+1s** (event-images, projects.ts)
- **Removed weekly summary schedule "fix"** — documented as intentional

---

## Corrections to Debt Report

| Report Claim | Reality | Action |
|---|---|---|
| IF-1: No CI/CD pipeline | `.github/workflows/ci.yml` exists with lint + typecheck + build (but no tests) | Partial correction — CI exists but needs tests added |
| IF-2: Node engines mismatch | `.nvmrc` exists and pins Node 20, but local dev runs Node 25.6.0 | **Still a genuine issue** — dev/prod parity gap remains |

Adjusted item count: **41 genuine items** (1 partial false positive on IF-1).

---

## PR Strategy

Each task maps to one or more PRs. Target: 300-500 lines per PR.

| Phase | Estimated PRs | Strategy |
|-------|--------------|----------|
| 1: Stability | 4 PRs | One per task (tests, audit, CI, Node) |
| 2: Error Handling | 6-8 PRs | Batch catch-block migration by module (5-10 files per PR) |
| 3: Test Coverage | 8-10 PRs | One PR per test file or test group |
| 4: Component Decomposition | 12-15 PRs | One PR per extracted component/hook/module |
| 5: Dependencies & Infra | 6 PRs | One per task |
| 6: Architecture & Perf | 5-6 PRs | One per task |
| 7: Deferred Items | N/A | Tracked as backlog |
| **Total** | **~41-49 PRs** | |

All PRs follow the template in `.claude/rules/pr-and-git-standards.md`.

---

## Phase 1: Stability & Security (Critical + Quick Wins)

**Goal:** Green test suite, npm audit vulnerabilities resolved where possible, tests running in CI, dev/prod Node parity.

**Items addressed:** TD-1, DD-1, IF-1 (partial), IF-2, CQ-7 (already healthy)

### Task 1.1: Triage and Fix Failing Tests

**Complexity:** 3 (M) — 13 test files, moderate logic, no schema changes
**PR:** Single PR — all test fixes together for atomic CI restoration

**Files:**
- Modify: `tests/api/tablePaymentCheckoutRouteReasonMapping.test.ts`
- Modify: `tests/api/stripeWebhookMutationGuards.test.ts`
- Modify: `tests/api/tableBookingRouteErrorPayloads.test.ts`
- Modify: `tests/api/tableBookingStatusMutationGuards.test.ts`
- Modify: `tests/api/twilioWebhookMutationGuards.test.ts`
- Modify: `tests/lib/shortLinksBaseUrl.test.ts`
- Modify: `tests/lib/sundayPreorderMutationGuards.test.ts`
- Modify: `tests/lib/tableBookingHoldAlignment.test.ts`
- Modify: `tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts`
- Modify: `tests/services/menu.service.test.ts`
- Modify: `tests/services/privateBookingsMutationGuards.test.ts`
- Modify: `tests/services/short-links.service.test.ts`
- Modify: `src/app/api/external/table-bookings/[id]/paypal/create-order/__tests__/route.test.ts`

- [ ] **Step 1: Run the full test suite and capture exact failures**

```bash
npm test 2>&1 | tail -100
```

Expected: 20 failures across 13 files. Record each failure message and root cause.

- [ ] **Step 2: Categorise each failure**

For each failing test file, determine:
- **Test drift**: Test expects old behaviour, implementation has changed correctly -> update the test
- **Bug revealed**: Test expects correct behaviour, implementation is wrong -> fix the implementation
- **Import/mock issue**: Test infrastructure problem -> fix the mock/import

Document the categorisation in a comment at the top of each fixed test.

- [ ] **Step 3: Fix each test file one at a time**

For each file:
1. Read the test file and the source file it tests
2. Determine category (test drift / bug / mock issue)
3. Apply the fix
4. Run just that test file: `npx vitest run <path-to-test-file>`
5. Verify it passes before moving on

- [ ] **Step 4: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Expected: 0 failures, all checks pass.

- [ ] **Step 5: Commit**

```bash
git add -A tests/ src/
git commit -m "fix: resolve 20 failing tests across 13 test files

Triaged each failure as test-drift, revealed-bug, or mock-issue.
Restores CI trust — full test suite now passes.

Addresses: TD-1 from technical debt report"
```

### Task 1.2: Resolve npm Audit Vulnerabilities

**Complexity:** 2 (S) — dependency updates only, no logic changes
**PR:** Single PR

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Run npm audit to get current state**

```bash
npm audit --json 2>&1 | head -100
```

Note: The original report said 9 vulnerabilities but the current count may be higher (14 high, 40 moderate as of QA review). Record the actual numbers.

- [ ] **Step 2: Attempt automated fix**

```bash
npm audit fix
```

- [ ] **Step 3: If tar vulnerabilities persist, update supabase CLI**

```bash
npm install supabase@latest --save-dev
```

- [ ] **Step 4: Run `supabase db push --dry-run` to verify CLI update doesn't break migrations**

```bash
npx supabase db push --dry-run
```

- [ ] **Step 5: Re-run audit and document remaining vulnerabilities**

```bash
npm audit
```

Some transitive vulnerabilities may be unfixable without major version bumps. Document any remaining as accepted risk with justification.

- [ ] **Step 6: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: resolve npm audit vulnerabilities

Addresses fixable vulnerabilities via npm audit fix and supabase CLI update.
Remaining transitive vulnerabilities documented as accepted risk.

Addresses: DD-1 from technical debt report"
```

### Task 1.3: Add Test Step to CI Pipeline

**Complexity:** 1 (XS) — single file change
**PR:** Single PR

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add test step to CI workflow in correct order**

Add a test step between Typecheck and Build in `.github/workflows/ci.yml` (matching the project's `verification-pipeline.md` ordering: lint -> typecheck -> test -> build):

```yaml
      - name: Test
        run: npm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test step to CI pipeline

Tests now run on every PR between typecheck and build steps,
matching the ordering in verification-pipeline.md.

Addresses: IF-1 (partial) from technical debt report"
```

Note: Branch protection rules to block merges on failure must be configured in GitHub settings separately.

### Task 1.4: Fix Node.js Version Mismatch

**Complexity:** 1 (XS)
**PR:** Combined with Task 1.3 or standalone

- [ ] **Step 1: Document the Node version requirement in CLAUDE.md**

Add a note to the project's CLAUDE.md under Commands:

```markdown
**Node version:** Use Node 20 LTS (as pinned in `.nvmrc`). Run `nvm use` before development.
The `engines` field in `package.json` enforces `>=20 <23`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document Node 20 LTS requirement and nvm usage

Local dev environments should run nvm use to match .nvmrc.
Addresses: IF-2 from technical debt report"
```

### Phase 1 DoD Checkpoint

- [ ] `npm run lint` — zero errors, zero warnings
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm test` — all pass, zero failures
- [ ] `npm run build` — success
- [ ] `npm audit` — zero high/critical (or documented accepted risk)
- [ ] CI pipeline runs lint, typecheck, test, build on PR

---

## Phase 2: Code Quality — Error Handling & Type Safety

**Goal:** Eliminate all `catch (error: any)` blocks with context-aware migration. Determine authoritative ESLint config.

**Items addressed:** CQ-2, CQ-4 (partial — establish lint rule after cleanup)

### Task 2.0: Determine Authoritative ESLint Config

**Complexity:** 1 (XS)
**PR:** Standalone or combined with Task 2.1 batch 1

The repo has both `.eslintrc.json` and `eslint.config.js`. ESLint 9+ uses flat config (`eslint.config.js`).

- [ ] **Step 1: Check which ESLint version is installed**

```bash
npx eslint --version
```

- [ ] **Step 2: Determine which config is active**

If ESLint 9+: `eslint.config.js` is authoritative; `.eslintrc.json` is ignored.
If ESLint 8: `.eslintrc.json` is authoritative.

- [ ] **Step 3: Remove or archive the inactive config**

If `eslint.config.js` is active, rename `.eslintrc.json` to `.eslintrc.json.archived` with a comment explaining why.

- [ ] **Step 4: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add .eslintrc* eslint.config*
git commit -m "chore: resolve dual ESLint config — establish eslint.config.js as source of truth

Addresses: dual-config ambiguity found in QA review"
```

### Task 2.1: Migrate `catch (error: any)` to Typed Error Handling

**Complexity:** 4 (L) — 109 files, requires context-aware changes
**PRs:** 5-8 PRs, batched by module (10-15 files each)

**Files:**
- Modify: All files in `src/` containing `catch (error: any)` (169 instances)
- Possibly modify: `src/lib/errors.ts` (extend utility if needed)
- Reference: `src/lib/errors.ts` (existing `getErrorMessage()`)

**IMPORTANT — This is NOT a mechanical sweep.** The QA review found that:
1. Some catch blocks branch on `error.code` (e.g., Postgres `23505` duplicate key)
2. Some use `error.message || 'fallback'` patterns that behave differently from `getErrorMessage()`
3. Error response shapes visible to the frontend could change

**Migration approach per catch block:**

**Simple case** (majority) — handler only uses `error.message`:
```typescript
// Before:
} catch (error: any) {
  return { error: error.message || 'Something failed' };
}
// After:
} catch (error: unknown) {
  return { error: getErrorMessage(error) };
}
```

**Code-branching case** — handler checks `error.code` or other properties:
```typescript
// Before:
} catch (error: any) {
  if (error.code === '23505') return { error: 'Already exists' };
  return { error: error.message };
}
// After:
} catch (error: unknown) {
  if (error instanceof Error && 'code' in error && (error as { code: string }).code === '23505') {
    return { error: 'Already exists' };
  }
  return { error: getErrorMessage(error) };
}
```

**Client-facing case** — handler returns error to API response:
```typescript
// Audit: does the current error.message leak internal details?
// If yes, use a generic message for the client response and log the real error.
```

- [ ] **Step 1: Get the full list of files and categorise**

```bash
grep -rn "catch (error: any)" src/ --include="*.ts" --include="*.tsx" | sort
```

For each file, note whether catch blocks:
- (A) Only use `error.message` → simple migration
- (B) Branch on `error.code` or other properties → needs type narrowing
- (C) Return error to client responses → needs security audit

- [ ] **Step 2: Extend `getErrorMessage` if needed**

If many blocks need `.code` access, add a helper:

```typescript
export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error) {
    return (error as { code: string }).code;
  }
  return undefined;
}
```

- [ ] **Step 3: Migrate batch 1 — `src/app/actions/` (A-G files)**

For each file:
1. Categorise each catch block (A/B/C)
2. Apply the appropriate pattern
3. Add `import { getErrorMessage } from '@/lib/errors'` if not present
4. Run: `npx tsc --noEmit`

- [ ] **Step 4: Run full verification and commit batch 1**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add src/app/actions/ src/lib/errors.ts
git commit -m "refactor: migrate catch (error: any) to typed handling in actions (A-G)

Context-aware migration preserving error.code branching and response shapes.

Addresses: CQ-2 from technical debt report (batch 1/N)"
```

- [ ] **Step 5-8: Continue with remaining batches**

Batch by module, ~10-15 files per PR:
- `src/app/actions/` (H-P)
- `src/app/actions/` (Q-Z)
- `src/services/`
- `src/app/api/` + `src/lib/`

Each batch: migrate -> verify -> commit.

- [ ] **Step 9: Verify zero instances remain**

```bash
grep -r "catch (error: any)" src/ --include="*.ts" --include="*.tsx" | wc -l
```

Expected: 0

- [ ] **Step 10: Remove the TODO from errors.ts**

Edit `src/lib/errors.ts` to remove the TODO comment on lines 5-7.

- [ ] **Step 11: Run full verification pipeline and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git add src/lib/errors.ts
git commit -m "chore: remove completed TODO from errors.ts"
```

### Task 2.2: Clean Up console.log Statements and Add ESLint Rule

**Complexity:** 3 (M) — 123 files, mechanical but must be done before enabling the rule
**PRs:** 2-3 PRs (cleanup batches, then rule enablement)

**IMPORTANT:** The lint script uses `--max-warnings=0`. Adding `no-console: "warn"` without first removing existing `console.log` statements would instantly break the build (123 warnings = build failure).

- [ ] **Step 1: Find all console.log statements**

```bash
grep -rn "console\.log" src/ --include="*.ts" --include="*.tsx" | wc -l
```

- [ ] **Step 2: Batch remove/replace console.log statements**

For each file:
- **Debug logging** (`console.log('debug:', ...)`) → remove entirely
- **Error logging** (`console.log('Error:', ...)`) → change to `console.error(...)`
- **Operational logging** (meaningful for production) → change to `console.warn(...)` or `console.error(...)`

Work in batches by directory.

- [ ] **Step 3: Verify and commit cleanup**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "chore: remove console.log statements from production code (batch N)

Replaces debug logs with console.error/warn where appropriate.
Removes pure debug logging entirely.

Addresses: CQ-4 from technical debt report (batch N/M)"
```

- [ ] **Step 4: Once all console.logs are removed, add ESLint rule**

Add to the **active** ESLint config (determined in Task 2.0):

```javascript
"no-console": ["error", { "allow": ["warn", "error"] }]
```

Using `"error"` not `"warn"` since all existing violations are now cleaned up.

- [ ] **Step 5: Verify and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "chore: add no-console ESLint rule at error level

All existing console.log statements already cleaned up.
Rule prevents future debug logging in production code.

Addresses: CQ-4 from technical debt report"
```

### Phase 2 DoD Checkpoint

- [ ] `grep -r "catch (error: any)" src/` returns 0 results
- [ ] `grep -rn "console\.log" src/ --include="*.ts" --include="*.tsx"` returns 0 results
- [ ] `npm run lint` — zero errors, zero warnings (including new no-console rule)
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm test` — all pass
- [ ] `npm run build` — success
- [ ] Single authoritative ESLint config identified and documented

---

## Phase 3: Test Coverage (BEFORE decomposition)

**Goal:** Add test coverage to the files that will be decomposed in Phase 4, plus critical server actions and webhooks.

**Items addressed:** TD-2, TD-3, TD-6

**Rationale for ordering:** The QA review identified that decomposing large files (Phase 4) without test coverage creates high regression risk. Adding tests first provides a safety net for the refactoring.

### Task 3.1: Add Coverage Thresholds to Vitest Config

**Complexity:** 1 (XS)
**PR:** Standalone

**Files:**
- Modify: `vitest.config.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add coverage thresholds to vitest.config.ts**

Add thresholds to the existing coverage configuration:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'html', 'lcov'],
  exclude: ['node_modules/', '.next/', 'tests/', '**/*.config.*'],
  thresholds: {
    lines: 30,    // Start low, increase as coverage improves
    branches: 25,
    functions: 30,
  },
},
```

- [ ] **Step 2: Update CI to run with coverage**

Change the test step in `.github/workflows/ci.yml`:

```yaml
      - name: Test
        run: npm run test:coverage
```

- [ ] **Step 3: Verify thresholds don't fail current suite**

```bash
npm run test:coverage
```

If current coverage is below the thresholds, lower them to match current state (the point is to prevent regression, not to fail now).

- [ ] **Step 4: Run full verification and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "ci: add coverage thresholds and reporting to CI

Thresholds set at current baseline to prevent regression.
Will be increased as coverage improves through Phase 3.

Addresses: TD-6 from technical debt report"
```

### Task 3.2: Add Server Action Tests — Receipts

**Complexity:** 3 (M)
**PR:** Single PR

**Files:**
- Create: `tests/actions/receipts.test.ts`
- Reference: `src/app/actions/receipts.ts`

- [ ] **Step 1: Read the receipts actions file and identify exported functions**

Focus on the highest-risk functions: payment recording, receipt creation, export.

- [ ] **Step 2: Write tests for the top 5 most critical functions**

Each function gets:
- Happy path test
- Auth failure test (no user → returns error)
- Permission check test
- At least 1 error/edge case

Mock Supabase client (never hit real DB). Follow existing test patterns in `tests/`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('receipts actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error when user is not authenticated', async () => {
    // Mock getUser to return null
    // Call the action
    // Assert error response
  });

  // ... more tests
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/actions/receipts.test.ts
```

- [ ] **Step 4: Run full verification and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "test: add server action tests for receipts module

Covers happy path, auth, permissions, and error cases for top 5 functions.
Provides safety net before Phase 4 decomposition.

Addresses: TD-2 from technical debt report"
```

### Task 3.3: Add Server Action Tests — Private Bookings

**Complexity:** 3 (M)
**PR:** Single PR

**Files:**
- Create: `tests/actions/privateBookingActions.test.ts`
- Reference: `src/app/actions/privateBookingActions.ts`

Focus on:
- Booking creation with deposit rules (7+ guests = deposit required)
- Amendment handling (payment state tracking)
- Cancellation flow
- Contract generation trigger

- [ ] **Steps 1-4: Same pattern as Task 3.2**

### Task 3.4: Add Server Action Tests — Rota, Events, Timeclock, Invoices

**Complexity:** 3 (M) per module
**PRs:** One PR per module (4 PRs)

**Files:**
- Create: `tests/actions/rota.test.ts`
- Create: `tests/actions/events.test.ts`
- Create: `tests/actions/timeclock.test.ts`
- Create: `tests/actions/invoices.test.ts`

Each module: read actions file, identify critical functions, write happy path + error cases.

- [ ] **Steps 1-4: Same pattern as Task 3.2 for each module**

### Task 3.5: Add Webhook Route Tests — Stripe

**Complexity:** 3 (M)
**PR:** Single PR

**Files:**
- Create: `tests/api/stripe-webhook.test.ts`
- Reference: Stripe webhook route (find exact path)

- [ ] **Step 1: Read the Stripe webhook route**

- [ ] **Step 2: Write tests covering:**
- Signature verification (valid + invalid)
- `checkout.session.completed` event handling
- `payment_intent.succeeded` event handling
- Unknown event type (ignored gracefully)
- Malformed payload

- [ ] **Step 3: Run and commit (with full verification pipeline)**

### Task 3.6: Add Webhook Route Tests — Twilio

**Complexity:** 2 (S)
**PR:** Single PR

Same pattern as Task 3.5. Cover: signature validation, inbound SMS handling, status callbacks.

### Task 3.7: Add FohScheduleClient Render Smoke Tests

**Complexity:** 3 (M)
**PR:** Single PR

**Files:**
- Create: `tests/components/FohScheduleClient.test.tsx`
- Reference: `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`

This component has 43 `useState` hooks, 15+ `useMemo`/`useCallback`, and 8 realtime channel subscriptions. Before decomposing in Phase 4, establish baseline tests.

- [ ] **Step 1: Write render smoke tests**

Test that the component renders without crashing with mocked data. Don't test every interaction — just establish a baseline.

- [ ] **Step 2: Write realtime subscription tests**

Verify that Supabase realtime channels are created and cleaned up correctly.

- [ ] **Step 3: Run and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "test: add FohScheduleClient render and realtime smoke tests

Baseline tests before Phase 4 decomposition.
Addresses: TD-4 (partial) from technical debt report"
```

### Phase 3 DoD Checkpoint

- [ ] `npm run test:coverage` — all pass, coverage thresholds met
- [ ] Server action test coverage improved (target: 50%+)
- [ ] Webhook routes have test coverage
- [ ] FohScheduleClient has baseline render tests
- [ ] Full verification pipeline passes

---

## Phase 4: Component Decomposition

**Goal:** Break down the largest, highest-churn files into maintainable units. Tests from Phase 3 provide safety net.

**Items addressed:** CQ-3 (top 3 files), CQ-5 (partial), CQ-6, CQ-8

### Task 4.1: Decompose FohScheduleClient.tsx (3,802 lines)

**Complexity:** 5 (XL) — highest-churn file, realtime subscriptions, drag-and-drop
**PRs:** 5-6 PRs (one per extraction step)

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
- Create: `src/app/(authenticated)/table-bookings/foh/components/FohHeader.tsx`
- Create: `src/app/(authenticated)/table-bookings/foh/components/FohTimeline.tsx`
- Create: `src/app/(authenticated)/table-bookings/foh/components/FohBookingModal.tsx`
- Create: `src/app/(authenticated)/table-bookings/foh/components/FohBookingCard.tsx`
- Create: `src/app/(authenticated)/table-bookings/foh/components/FohStatusBar.tsx`
- Create: `src/app/(authenticated)/table-bookings/foh/hooks/useFohBookings.ts`
- Create: `src/app/(authenticated)/table-bookings/foh/hooks/useFohRealtime.ts`
- Create: `src/app/(authenticated)/table-bookings/foh/types.ts`

**Critical considerations from QA review:**
- 43 `useState` hooks, 15+ `useMemo`/`useCallback`, 8 realtime channels
- Ref-based drag suppression tightly coupled to realtime updates
- All extracted components MUST use `React.memo` to prevent render cascades
- Realtime subscriptions MUST stay in a single hook — do NOT split across components
- Run FohScheduleClient render tests after EVERY extraction step

- [ ] **Step 1: Read the entire file and map its internal structure**

Identify:
- State variables and which UI sections use them
- Event handlers and which components they belong to
- Render sections (header, timeline, modals, status bar)
- Realtime channel subscriptions (keep these together)

Document the component map before extracting anything.

- [ ] **Step 2: Extract shared types to `types.ts`** (PR 1)

Move `FohBooking`, `FohLane`, `ServiceWindow`, `FohScheduleResponse`, and other type definitions.

```bash
npx tsc --noEmit && npx vitest run tests/components/FohScheduleClient.test.tsx
git commit -m "refactor: extract FoH schedule types to dedicated types.ts

Addresses: CQ-3 (step 1/6)"
```

- [ ] **Step 3: Extract realtime hook `useFohRealtime`** (PR 2)

Move ALL Supabase realtime channel subscriptions into a single hook. This hook manages channel lifecycle and returns reactive data. Do NOT split subscriptions across multiple hooks.

```bash
npx tsc --noEmit && npx vitest run tests/components/FohScheduleClient.test.tsx
git commit -m "refactor: extract useFohRealtime hook (8 channels in single hook)

Keeps all realtime subscriptions together to prevent lifecycle issues.
Addresses: CQ-3 (step 2/6)"
```

- [ ] **Step 4: Extract data fetching hook `useFohBookings`** (PR 3)

Move data fetching logic. The main component calls this hook and receives clean data.

- [ ] **Step 5: Extract sub-components one at a time** (PRs 4-6)

Extract in order: FohHeader, FohStatusBar, FohBookingCard, FohTimeline, FohBookingModal.

For each extraction:
1. Move the JSX and its handlers to the new component
2. Define a props interface
3. **Wrap with `React.memo`** to prevent unnecessary re-renders
4. Update the parent to render the new component
5. Run `npx tsc --noEmit`
6. Run `npx vitest run tests/components/FohScheduleClient.test.tsx`
7. **Test drag-and-drop manually in the browser**
8. Commit

- [ ] **Step 6: Verify the main file is under 500 lines**

```bash
wc -l src/app/\(authenticated\)/table-bookings/foh/FohScheduleClient.tsx
```

- [ ] **Step 7: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

### Task 4.2: Decompose receipts.ts (3,623 lines)

**Complexity:** 4 (L) — 7+ files, service layer extraction
**PRs:** 3-4 PRs

**Files:**
- Modify: `src/app/actions/receipts.ts`
- Create: `src/services/receipts/receiptQueries.ts`
- Create: `src/services/receipts/receiptMutations.ts`
- Create: `src/services/receipts/receiptExport.ts`
- Create: `src/services/receipts/types.ts`

**IMPORTANT (from QA review):** When extracting mutation logic to service modules, ensure every extracted function either:
1. Takes an auth context parameter (user ID, permission check result), or
2. Is explicitly documented as requiring caller-side auth verification

Do NOT create service functions that call `createAdminClient()` without any auth boundary.

- [ ] **Step 1: Read and map the file structure**

Identify all exported functions, group by responsibility.

- [ ] **Step 2: Extract types** (PR 1)
- [ ] **Step 3: Extract read-only queries to `receiptQueries.ts`** (PR 2)
- [ ] **Step 4: Extract mutation logic to `receiptMutations.ts`** (PR 2 continued)

Each mutation function must accept `userId` and verify permissions internally, or document that the caller is responsible.

- [ ] **Step 5: Extract export/PDF logic to `receiptExport.ts`** (PR 3)
- [ ] **Step 6: Run Phase 3 receipt tests to verify no regressions**

```bash
npx vitest run tests/actions/receipts.test.ts
```

- [ ] **Step 7: Run full verification and commit**

### Task 4.3: Decompose private-bookings.ts (3,436 lines)

**Complexity:** 4 (L)
**PRs:** 3-4 PRs

Same decomposition pattern as Task 4.2. Same auth boundary requirement.

### Task 4.4: Add Button Type Attributes

**Complexity:** 3 (M) — many files, but mechanical
**PRs:** 2-3 PRs batched by directory

**IMPORTANT (from QA review):** Do NOT use grep-and-replace. Buttons can be multiline, and some legitimately need `type="submit"`. Use manual review or AST tooling.

- [ ] **Step 1: Find all buttons missing type attribute**

Use a multiline search approach, not line-based grep:

```bash
grep -rn "<button" src/ --include="*.tsx" | grep -v "type="
```

Then manually verify each — is it inside a `<form>`? Does it trigger form submission?

- [ ] **Step 2: For each button, determine the correct type**

- Inside a form AND is the submit action → `type="submit"`
- Everything else → `type="button"`

- [ ] **Step 3: Apply in batches by directory, verify, commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "fix: add explicit type attribute to button elements (batch N)

Addresses: CQ-6 from technical debt report"
```

### Task 4.5: Verify and Complete Legacy PageWrapper Migration

**Complexity:** 1 (XS)
**PR:** Single PR (if any files remain)

**IMPORTANT (from QA review):** The grep pattern `PageWrapper|PageHeader` hits component definitions, not just consumers. There may be 0 actual legacy consumer pages remaining.

- [ ] **Step 1: Find actual consumer imports (not definitions)**

```bash
grep -rn "import.*PageWrapper\|import.*PageHeader" src/ --include="*.tsx" | grep -v "components/ui-v2"
```

- [ ] **Step 2: If consumers found, migrate each to ui-v2 pattern**

- [ ] **Step 3: If no consumers found, mark CQ-8 as already resolved**

### Task 4.6: Replace Hardcoded Hex Colours (Styling Only)

**Complexity:** 3 (M)
**PRs:** 2-3 PRs

**IMPORTANT (from QA review):** Not all hex values are Tailwind-swappable. Some are:
- Canvas/chart drawing colours (runtime data, not CSS)
- Persisted customer-label colours (stored in DB)
- Inline event colours (data-driven)

These must NOT be converted to Tailwind tokens.

- [ ] **Step 1: Find and categorise all hardcoded colours**

```bash
grep -rn "#[0-9A-Fa-f]\{3,8\}" src/ --include="*.tsx"
```

Categorise each as:
- **Styling** (className, style prop for layout) → convert to Tailwind token
- **Data/Runtime** (canvas, chart, DB-driven colour) → leave as-is

- [ ] **Step 2: Replace only styling colours in batches**

- [ ] **Step 3: Verify and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "refactor: replace hardcoded hex styling colours with Tailwind tokens

Only styling colours replaced; runtime/data colours preserved.
Addresses: CQ-5 from technical debt report"
```

### Phase 4 DoD Checkpoint

- [ ] FohScheduleClient.tsx < 500 lines
- [ ] receipts.ts decomposed into service modules
- [ ] private-bookings.ts decomposed into service modules
- [ ] All Phase 3 tests still pass (no regressions from decomposition)
- [ ] All extracted service functions have auth boundary documentation
- [ ] Buttons have explicit `type` attributes
- [ ] Full verification pipeline passes

---

## Phase 5: Dependencies & Infrastructure

**Goal:** Resolve version conflicts, update dependencies, improve cron job hygiene.

**Items addressed:** DD-2, DD-3, DD-6, DS-3, DS-4, DS-6, IF-3, DC-2, DC-3

### Task 5.1: Resolve Tailwind v3/v4 Conflict

**Complexity:** 2 (S)
**PR:** Single PR

- [ ] **Step 1: Remove unused `@tailwindcss/postcss` v4 dependency**

```bash
npm uninstall @tailwindcss/postcss
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Update CLAUDE.md**

Change `styling: Tailwind CSS v4` to `styling: Tailwind CSS v3`.

- [ ] **Step 4: Run full verification and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "chore: resolve Tailwind v3/v4 conflict — stay on v3, remove unused v4 dep

CLAUDE.md updated to reflect actual version.
Addresses: DD-2, DD-6, DC-2 from technical debt report"
```

### Task 5.2: Update Minor/Patch Dependencies

**Complexity:** 2 (S)
**PR:** Single PR

- [ ] **Step 1: Update dependencies using explicit install (not npm update)**

`npm update` respects semver ranges and won't reach the target versions. Use explicit installs:

```bash
npm install @supabase/ssr@latest googleapis@latest @sparticuz/chromium@latest
```

- [ ] **Step 2: Run full verification**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: update @supabase/ssr, googleapis, chromium to latest

Addresses: DD-3 from technical debt report (minor/patch bumps)"
```

### Task 5.3: Update CLAUDE.md Cron Table

**Complexity:** 1 (XS)
**PR:** Combined with other CLAUDE.md changes

- [ ] **Step 1: Read vercel.json for current cron list**

- [ ] **Step 2: Update CLAUDE.md cron section**

Replace the 5-row table with a note: "See `vercel.json` for the complete list of 30 scheduled jobs" and list only the top 5 most critical.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md cron table to reference vercel.json (30 jobs)

Addresses: DC-3 from technical debt report"
```

### Task 5.4: Document Weekly Summary Cron as Intentional

**Complexity:** 1 (XS)
**PR:** Combined with Task 5.3

**IMPORTANT (from QA review):** The `private-bookings-weekly-summary` route self-gates to Monday and the configured London digest hour, with idempotency protection. The hourly schedule is an intentional safe polling pattern, NOT a bug.

- [ ] **Step 1: Add documentation comment to the cron route**

Add a comment at the top of the route file explaining the intentional hourly schedule:

```typescript
/**
 * This cron runs hourly but self-gates to Monday at the configured digest hour.
 * The hourly schedule is intentional: it provides a safe polling window so the
 * digest is sent even if the exact Monday-morning cron invocation is missed.
 * The route is idempotent — duplicate runs within the same week are no-ops.
 */
```

- [ ] **Step 2: Commit**

```bash
git commit -m "docs: document intentional hourly polling for weekly summary cron

The schedule is not a bug — it provides fault-tolerant weekly delivery.
Addresses: PF-3, DS-3 (partial) from technical debt report"
```

### Task 5.5: Convert PostCSS Config to ESM

**Complexity:** 1 (XS)
**PR:** Standalone

- [ ] **Step 1: Create ESM config**

Create `postcss.config.mjs`:

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 2: Remove old file and stage both changes**

```bash
git rm postcss.config.js
```

- [ ] **Step 3: Verify build and commit**

```bash
npm run build
git add postcss.config.mjs
git commit -m "chore: convert postcss.config.js to ESM (postcss.config.mjs)

Addresses: DS-6 from technical debt report"
```

### Task 5.6: Add Cron Job Failure Alerting

**Complexity:** 3 (M)
**PR:** Single PR

**IMPORTANT (from QA review):**
- The `sendEmail` API takes an options object, not positional args
- Error context can contain PII (customer phone numbers, emails) — must redact
- HTML-escape all interpolated values to prevent injection
- Build on existing `persistCronRunResult` utility, don't create a parallel system

**Files:**
- Create: `src/lib/cron/alerting.ts`
- Reference: `src/lib/cron-run-results.ts` (existing utility)
- Reference: `src/lib/email/emailService.ts` (correct API signature)
- Modify: Top 5 most critical cron routes

- [ ] **Step 1: Read the existing cron utilities**

```bash
cat src/lib/cron-run-results.ts
cat src/lib/email/emailService.ts | head -40
```

Understand the existing patterns before adding new ones.

- [ ] **Step 2: Create alerting utility**

```typescript
// src/lib/cron/alerting.ts
import { sendEmail } from '@/lib/email/emailService';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function redactPii(obj: unknown): string {
  const str = JSON.stringify(obj, null, 2);
  // Redact phone numbers and email addresses
  return str
    .replace(/\+?\d{10,15}/g, '[REDACTED_PHONE]')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[REDACTED_EMAIL]');
}

export async function reportCronFailure(
  cronName: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`[CRON FAILURE] ${cronName}:`, message);

  try {
    const safeContext = context ? redactPii(context) : '';
    await sendEmail({
      to: process.env.CRON_ALERT_EMAIL || process.env.MICROSOFT_USER_EMAIL || '',
      subject: `[CRON FAILURE] ${cronName}`,
      html: `<h2>Cron Job Failure</h2>
        <p><strong>Job:</strong> ${escapeHtml(cronName)}</p>
        <p><strong>Error:</strong> ${escapeHtml(message)}</p>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        ${safeContext ? `<p><strong>Context:</strong> <pre>${escapeHtml(safeContext)}</pre></p>` : ''}`,
    });
  } catch (emailError) {
    console.error('[CRON ALERT] Failed to send failure email:', emailError);
  }
}
```

- [ ] **Step 3: Add `CRON_ALERT_EMAIL` to `.env.example`**

- [ ] **Step 4: Integrate with top 5 most critical cron jobs**

Wrap the main logic of each cron in a try/catch that calls `reportCronFailure()`.

- [ ] **Step 5: Run full verification and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "feat: add failure alerting for critical cron jobs

Uses existing sendEmail API. Redacts PII from context.
HTML-escapes all interpolated values. Applied to top 5 crons.
New env var: CRON_ALERT_EMAIL (documented in .env.example).

Addresses: IF-3 from technical debt report"
```

### Task 5.7: Improve Migration Discipline

**Complexity:** 1 (XS)

- [ ] **Step 1: Add migration discipline note to CLAUDE.md**

```markdown
**Migration discipline:** Always run `npx supabase db push --dry-run` before committing any migration.
The project has a 19% corrective migration rate (57/306) — this must decrease.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reinforce migration dry-run discipline in CLAUDE.md

Addresses: DS-4 from technical debt report"
```

### Phase 5 DoD Checkpoint

- [ ] Single Tailwind version in use (v3)
- [ ] CLAUDE.md reflects actual Tailwind version
- [ ] CLAUDE.md cron table updated
- [ ] PostCSS config converted to ESM
- [ ] Cron alerting utility created and integrated
- [ ] `.env.example` updated with `CRON_ALERT_EMAIL`
- [ ] Full verification pipeline passes

---

## Phase 6: Architecture & Performance

**Goal:** Address remaining design debt, fix the genuine N+1 query, enable lint guards against `as any` regression.

**Items addressed:** DS-1, DS-7, PF-1 (rota only), CQ-1, DC-1

### Task 6.1: Investigate and Re-enable Middleware

**Complexity:** 4 (L) — highest-risk task in the entire plan
**PRs:** 2 PRs (investigation + restoration, then verification)

**IMPORTANT (from QA review):** The disabled middleware does far more than auth redirects:
1. Short-link host bypass routing
2. Supabase cookie/session refresh
3. `post_login_redirect` cookie sanitisation
4. `X-Robots-Tag` header for non-primary domains
5. Public path allowlisting

The plan's original "write a minimal middleware" approach would break short links and session refresh. Instead: **restore the existing middleware exactly as-is** with careful testing.

- [ ] **Step 1: Read the full disabled middleware**

```bash
cat src/middleware.ts.disabled
```

Document every responsibility it handles.

- [ ] **Step 2: Research the original incident**

```bash
git log --all --oneline -- src/middleware.ts src/middleware.ts.disabled | head -20
git log --all --oneline --grep="middleware" | head -20
```

Understand what broke and whether the root cause has been fixed.

- [ ] **Step 3: Restore the middleware**

```bash
cp src/middleware.ts.disabled src/middleware.ts
```

Do NOT modify it — restore it exactly as it was before disabling.

- [ ] **Step 4: Test locally**

```bash
npm run dev
```

Test:
- Authenticated routes redirect to login when not authenticated
- Public routes (`/timeclock`, `/table-booking`, `/parking/guest`) work without auth
- Short links work on `l.the-anchor.pub` domain (test with host header override if needed)
- Session refresh works (check Supabase cookies are being set)

- [ ] **Step 5: Verify layout auth checks remain as defence-in-depth**

Read `src/app/(authenticated)/layout.tsx` and confirm it still has `getUser()` check. The layout auth should remain even after middleware is restored — belt and braces.

- [ ] **Step 6: Deploy to Vercel preview and test**

This MUST be tested on a Vercel preview deployment before merging. Test all the flows from Step 4 on the actual Vercel infrastructure.

- [ ] **Step 7: Run full verification and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "feat: re-enable middleware (restored from middleware.ts.disabled)

Restores the full middleware that was disabled after a Vercel incident.
All original functionality preserved: auth, short links, session refresh,
redirect sanitisation, X-Robots-Tag headers.
Layout-level auth checks remain as defence-in-depth.
Tested on Vercel preview deployment.

Addresses: DS-1 from technical debt report"
```

**Note on API route protection:** The current middleware exempts `/api` as a public path. This is a separate, pre-existing issue. Addressing API route auth is a new feature, not part of the "re-enable middleware" debt item. Track it as a follow-up if desired.

### Task 6.2: Fix N+1 Query in Rota Actions

**Complexity:** 2 (S)
**PR:** Single PR

**Files:**
- Modify: `src/app/actions/rota.ts` (line ~1079)

**IMPORTANT (from QA review):**
- The event-images "N+1" is a **false positive** — `getPublicUrl()` is synchronous URL construction
- The projects.ts unique code loop is negligible (max 10 iterations, near-zero collision probability)
- Only the rota.ts N+1 is a genuine performance issue

- [ ] **Step 1: Read the rota N+1 pattern**

Read `src/app/actions/rota.ts` around line 1079. Understand the loop that queries `rota_published_shifts` per week.

- [ ] **Step 2: Replace with a batched query**

Replace the per-week loop with a single query using `.gte().lte()` for the full date range, then group results in JavaScript.

- [ ] **Step 3: Run full verification and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "perf: fix N+1 query pattern in rota actions

Replaces per-week loop with single batched query + JS grouping.

Addresses: PF-1 (rota) from technical debt report"
```

### Task 6.3: Fix Parking TOCTOU Race Condition

**Complexity:** 3 (M) — requires understanding the real data model
**PR:** Single PR (migration + service update)

**IMPORTANT (from QA review):** The original plan's SQL sketch was wrong in every dimension:
- Wrong column names (`booking_date` vs `start_at/end_at`)
- Wrong table references (`parking_config` vs `parking_rates`)
- `SELECT COUNT(*) ... FOR UPDATE` doesn't lock aggregates
- Omitted `SECURITY INVOKER` and RLS considerations

**The correct approach:**

- [ ] **Step 1: Read the actual parking data model**

Read these files to understand the real schema:
- `src/services/parking.ts` (especially around line 85)
- `src/lib/parking/capacity.ts`
- `src/lib/parking/repository.ts`
- Relevant migration files for parking tables

Document: actual column names, actual capacity calculation logic, actual RLS policies.

- [ ] **Step 2: Design the atomic operation**

Based on the actual data model (overlapping `start_at`/`end_at` windows, capacity from `parking_rates`), choose the right approach:

**Option A: Advisory lock** — Use `pg_advisory_xact_lock()` on a hash of the date range to serialise concurrent bookings for overlapping windows.

**Option B: Unique constraint** — Add a unique constraint that prevents double-booking the same slot, letting the DB enforce atomicity.

**Option C: Serialisable transaction** — Use `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE` in an RPC.

The choice depends on the actual concurrency patterns. Read the code first.

- [ ] **Step 3: Write the RPC with `SECURITY INVOKER`**

The RPC must:
- Use `SECURITY INVOKER` to preserve RLS
- Use the actual column names from the schema
- Preserve all required fields (`created_by`, `updated_by`, `capacity_override`)
- Handle the zero-rows case (advisory lock works here; `FOR UPDATE` does not)

- [ ] **Step 4: Update the parking service to use the RPC**

- [ ] **Step 5: Remove the TODO comment from `src/services/parking.ts:85`**

- [ ] **Step 6: Run full verification and commit**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "fix: resolve TOCTOU race condition in parking space booking

Uses atomic Supabase RPC with SECURITY INVOKER to preserve RLS.
Addresses: DS-7 from technical debt report"
```

### Task 6.4: Begin `as any` Reduction Campaign with Lint Guard

**Complexity:** 4 (L) — 617 instances, incremental
**PRs:** Multiple PRs (5-10 files per PR)

- [ ] **Step 1: Enable `@typescript-eslint/no-explicit-any` at warn level**

Add to the active ESLint config:

```javascript
'@typescript-eslint/no-explicit-any': 'warn',
```

Since `--max-warnings=0` is enforced, this would break the build. Instead, use an override that only applies to new/modified files, OR set a high warning threshold temporarily.

Alternative: add the rule but configure it with `"off"` initially, and use a pre-commit hook to check new files only. Decide based on ESLint version and config capabilities.

- [ ] **Step 2: Find the files with the most `as any` casts**

```bash
grep -r "as any" src/ --include="*.ts" --include="*.tsx" -c | sort -t: -k2 -rn | head -20
```

- [ ] **Step 3: Work through the top 10 files**

For each file, replace `as any` with:
- Proper Supabase generated types (for DB results)
- Generic type parameters
- Type narrowing (`instanceof`, `typeof`, `in`)
- Type assertions to specific types (`as SpecificType`)

- [ ] **Step 4: Commit in batches of 5-10 files**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
git commit -m "refactor: replace as any casts with proper types (batch N)

Reduces as any count from X to Y.
Addresses: CQ-1 from technical debt report"
```

- [ ] **Step 5: Repeat until under 200 instances**

### Task 6.5: Convert TODOs to GitHub Issues

**Complexity:** 1 (XS)
**PR:** Single PR

| File | TODO | Status |
|------|------|--------|
| `src/services/financials.ts:92` | Parallelise page fetches | Create issue |
| `src/services/parking.ts:85` | TOCTOU race condition | Resolved in Task 6.3 |
| `src/types/private-bookings.ts:136` | Verify DB field exists | Create issue |
| `src/app/actions/messagesActions.ts:66` | Replace JS grouping with RPC | Create issue |
| `src/lib/errors.ts:5` | Migrate catch blocks | Resolved in Phase 2 |

- [ ] **Step 1: Create GitHub Issues for the 3 remaining TODOs**

- [ ] **Step 2: Update each TODO to reference the issue number**

```typescript
// TODO(#123): Parallelise page fetches for better performance
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: convert inline TODOs to tracked GitHub Issues

3 remaining TODOs linked to issues. 2 already resolved in this remediation.
Addresses: DC-1 from technical debt report"
```

### Phase 6 DoD Checkpoint

- [ ] Middleware re-enabled and tested on Vercel preview
- [ ] Layout auth checks remain as defence-in-depth
- [ ] Rota N+1 query fixed
- [ ] Parking TOCTOU race condition resolved with atomic RPC
- [ ] `as any` count reduced to < 200
- [ ] All TODOs tracked as GitHub Issues
- [ ] Full verification pipeline passes

---

## Phase 7: Explicitly Deferred & Missing Items

Items that are tracked but intentionally not addressed in this plan.

### Deferred to Separate Projects

| Item | What | Why Deferred |
|------|------|-------------|
| DD-4 | Next.js 15 -> 16 | Breaking changes (middleware -> proxy rename); needs its own migration plan |
| DD-3 (majors) | zod 3->4, lucide-react 0->1, jsdom 25->29 | Each major bump has breaking changes; needs individual PRs |
| DD-5 | TypeScript 5->6 | Wait for ecosystem compatibility |
| TD-5 | Playwright E2E setup | Separate project — requires page objects, CI integration, auth fixtures |
| DS-2 | Service layer boundaries | Ongoing architectural refactor; do incrementally with each feature |

### Explicitly Deferred (Low Priority)

These items from the original report are acknowledged but deferred to backlog:

| Item | What | Why Deferred |
|------|------|-------------|
| TD-4 | Component test coverage | Partially addressed by Task 3.7 (FoH smoke tests). Full component testing is ongoing — add tests when components are modified. |
| TD-7 | Scripts directory testing | 232 scripts are mostly one-off; test only reusable utilities when they're modified |
| IF-5 | Database backup verification | Supabase handles automatic backups; document restoration procedure when next needed |
| DC-4 | `.env.example` changelog | Low value; env vars are documented in `.env.example` itself |
| PF-2 | Billing cron decomposition (3,434 lines) | Complex financial logic; needs its own dedicated plan with careful testing |
| PF-4 | Generated types file (12K lines) | Expected for Supabase codegen; ensure excluded from search indexes |
| PF-5 | 300s timeout route investigation | Investigate when next modifying these routes; may be necessary for export operations |

### Items Resolved During Plan Review

| Item | Resolution |
|------|-----------|
| CQ-7 | Already healthy (only 3 eslint-disable directives) |
| PF-3 | Documented as intentional (hourly cron with day-gate and idempotency) |
| PF-1 (event-images) | False positive — `getPublicUrl()` is synchronous URL construction |
| PF-1 (projects.ts) | Negligible — max 10 iterations with near-zero collision probability |

---

## Success Metrics

| Metric | Before | After Phase 1 | After Phase 3 | After Phase 4 | After Phase 6 | Target |
|--------|--------|--------------|---------------|---------------|---------------|--------|
| Failing tests | 20 | 0 | 0 | 0 | 0 | 0 |
| npm audit high/critical | 14+ | Minimised | — | — | — | Documented |
| `catch (error: any)` | 169 | 169 | 169 | 169 | 0 | 0 |
| `as any` count | 617 | 617 | 617 | 617 | <200 | <200 |
| Files > 1,000 lines | 27 | 27 | 27 | <20 | <15 | <15 |
| Server action test coverage | 31% | 31% | 60%+ | 60%+ | 60%+ | 60% |
| API route test coverage | 5% | 5% | 25%+ | 25%+ | 25%+ | 25% |
| CI pipeline | No tests | Tests added | Coverage thresholds | — | — | Full gate |
| Buttons without type | 333 | 333 | 333 | 0 | 0 | 0 |
| console.log statements | 123 | 123 | 123 | 123 | 0 | 0 |
| Middleware | Disabled | Disabled | Disabled | Disabled | Enabled | Enabled |

Note: Metrics are tracked in `tasks/technical-debt-progress.md` (not in the original report, to preserve the audit baseline).

---

## Estimated Total Effort

| Phase | Days | Priority | PRs |
|-------|------|----------|-----|
| Phase 1: Stability & Security | 3-4 | Critical | 4 |
| Phase 2: Error Handling | 4-6 | High | 6-8 |
| Phase 3: Test Coverage | 8-12 | High | 8-10 |
| Phase 4: Component Decomposition | 10-15 | High | 12-15 |
| Phase 5: Dependencies & Infrastructure | 4-6 | Medium | 6 |
| Phase 6: Architecture & Performance | 8-12 | Medium | 5-6 |
| Phase 7: Deferred | N/A | Backlog | N/A |
| **Total** | **37-55 days** | | **~41-49 PRs** |

Phases 1-2 should be completed within the first 2 weeks. Phase 3 must complete before Phase 4. Phases 5-6 are lower urgency and can be spread across the quarter.
