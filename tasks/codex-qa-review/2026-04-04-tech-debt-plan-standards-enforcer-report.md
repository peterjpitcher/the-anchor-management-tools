# Standards Enforcer Report: Technical Debt Remediation Plan

**Plan reviewed:** `docs/superpowers/plans/2026-04-04-technical-debt-remediation.md`
**Source report:** `tasks/technical-debt-report.md`
**Reviewer:** Standards Enforcement Specialist
**Date:** 2026-04-04

---

## Executive Summary

The plan is well-structured and addresses 39 genuine debt items across 6 phases. However, it has significant gaps in PR strategy, inconsistent verification pipeline usage, missing complexity scoring for large tasks, and does not follow the project's task tracking conventions. 17 findings identified, 3 critical, 7 high, 5 medium, 2 low.

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 7 |
| Medium | 5 |
| Low | 2 |

---

## 1. Git Conventions

### STD-001 [HIGH] Commit messages follow conventional commits but use `git add -A`

The plan's commit messages correctly use `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `ci:`, `docs:`, `perf:` prefixes. Messages explain "why" and reference debt report items. This is good.

However, Task 1.1 Step 5 uses `git add -A tests/ src/` which violates the workspace CLAUDE.md guidance: "prefer adding specific files by name rather than using `git add -A` or `git add .`". When fixing 13 test files, each should be staged individually or at minimum by explicit path. `git add -A` risks including unintended changes.

**Affected tasks:** 1.1 (Step 5)

**Recommendation:** Replace `git add -A tests/ src/` with explicit file listing or at minimum `git add tests/api/tablePaymentCheckoutRouteReasonMapping.test.ts tests/api/stripeWebhookMutationGuards.test.ts ...` etc.

### STD-002 [MEDIUM] Some commit messages miss the "why"

While most messages are good, several are purely descriptive without explaining business impact:
- Task 2.2 Step 4: "add no-console ESLint rule to prevent debug logging in production" -- good
- Task 5.5 Step 3: "convert postcss.config.js to ESM (postcss.config.mjs)" -- explains "what" not "why"
- Task 5.7 Step 2: "reinforce migration dry-run discipline in CLAUDE.md" -- explains "what" not "why"

**Recommendation:** Add a line explaining why: e.g., "Aligns with project's ESM-first module strategy" or "Reduces the 19% corrective migration rate".

### STD-003 [LOW] Multi-line commit messages not using HEREDOC format

The plan shows commit messages using `git commit -m "..."` with newlines inside the string. The project's commit guidance recommends HEREDOC format for multi-line messages to ensure proper formatting:

```bash
git commit -m "$(cat <<'EOF'
message here

Co-Authored-By: ...
EOF
)"
```

**Recommendation:** Update commit examples to use HEREDOC format, especially for messages with multiple paragraphs.

---

## 2. Verification Pipeline

### STD-004 [CRITICAL] Inconsistent verification pipeline coverage across tasks

The project's `verification-pipeline.md` mandates: `lint -> typecheck -> test -> build` before every push. The plan is inconsistent:

| Task | Pipeline Steps Included | Missing Steps |
|------|------------------------|---------------|
| 1.1 (Fix tests) | `npm test` | lint, typecheck, build |
| 1.2 (npm audit) | `npm test && npm run build` | lint, typecheck |
| 1.3 (CI) | None (just visual check) | All four |
| 2.1 (Error handling) | Full pipeline (Step 10) | -- |
| 2.2 (ESLint rule) | `npm run lint` only | typecheck, test, build |
| 3.1 (FohSchedule) | Full pipeline (Step 9) | -- |
| 3.2 (Receipts) | Full pipeline (Step 7) | -- |
| 3.4 (Buttons) | `lint && typecheck` | test, build |
| 3.5 (PageWrapper) | `lint && typecheck && build` | test |
| 3.6 (Hex colours) | `lint && typecheck && build` | test |
| 4.2-4.9 (Tests) | `vitest run <file>` only | lint, typecheck, build |
| 5.1 (Tailwind) | `npm run build` only | lint, typecheck, test |
| 5.2 (Deps) | Full pipeline | -- |
| 6.2 (N+1) | `npm test && tsc --noEmit` | lint, build |

Only 4 of ~20 tasks run the full 4-step pipeline. This is a systemic gap.

**Recommendation:** Add a standard verification step to every task before commit:
```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

### STD-005 [HIGH] Test tasks skip lint, typecheck, and build

Phase 4 tasks (4.2 through 4.9) only run the individual test file. New test files could introduce lint violations, type errors, or break the build (e.g., importing a server-only module incorrectly). The full pipeline must run before committing.

**Recommendation:** Add full pipeline verification as a final step in each test task, after the individual test run.

---

## 3. Complexity Scoring

### STD-006 [CRITICAL] No complexity scores assigned to any task

The `complexity-and-incremental-dev.md` rule states: "Assign a score before starting work. Record it in the PR description." The plan assigns effort estimates in days but never assigns complexity scores (1-5). This is a mandatory gate.

Several tasks clearly exceed the threshold:

| Task | Files Touched | Estimated Effort | Implied Score | Rule Trigger |
|------|--------------|-----------------|---------------|-------------|
| 2.1 (catch migration) | ~109 files | 2-3 days | 5 (XL) | MUST break into smaller PRs |
| 3.1 (FohSchedule) | 9+ files | 2-3 days | 4 (L) | MUST break into smaller PRs |
| 3.6 (Hex colours) | ~107 files | 2 days | 5 (XL) | MUST break into smaller PRs |
| 6.4 (as any reduction) | ~100+ files | 5-8 days | 5 (XL) | MUST break into smaller PRs |
| 3.4 (Button types) | ~333 instances, many files | 1 day | 4-5 (L/XL) | MUST break into smaller PRs |

**Recommendation:** Add explicit complexity scores to every task. For score >= 4, define the PR breakdown with dependencies mapped, per the rules.

### STD-007 [HIGH] Task 2.1 touches 109 files but only creates 3 commits

The `catch (error: any)` migration touches 78 action files + 31 other files = 109 files total. The complexity rule says score >= 4 must be broken into smaller PRs. Three commits (A-M, N-Z, rest) across 109 files is still too coarse-grained.

**Recommendation:** Break into PRs of 10-15 files each, grouped by module (e.g., "actions/booking-*", "actions/payment-*", "services/*"). Each PR independently deployable. Target 300-500 lines per PR.

---

## 4. Testing Conventions

### STD-008 [HIGH] Test file naming inconsistency

The project's testing rules say test files live alongside source (`src/**/*.test.ts`) or in a dedicated `tests/` directory. The plan creates new tests in `tests/actions/` (e.g., `tests/actions/receipts.test.ts`) which is consistent with existing convention (252 tests in `tests/`).

However, test naming should follow `it('should [expected behaviour] when [condition]')` pattern. The plan does not specify test naming -- it only says "happy path + error case". Without explicit naming guidance, test quality will vary.

**Recommendation:** Add a template for each test task:
```typescript
describe('createReceipt', () => {
  it('should create a receipt when user has permission', async () => {});
  it('should return unauthorized error when no user session', async () => {});
  it('should return permission error when user lacks receipts:create', async () => {});
});
```

### STD-009 [HIGH] Mock strategy not specified for new tests

The testing rules mandate: "Always mock Supabase client, never mock internal utility functions." Phase 4 mentions "Mock Supabase client, never hit real DB" in Task 4.2 but does not specify:
- How to mock the auth check (`supabase.auth.getUser()`)
- How to mock the permission check (`checkUserPermission`)
- Whether `getErrorMessage()` should be mocked (it should NOT -- it's an internal utility)
- Reset strategy (`beforeEach(() => { vi.clearAllMocks() })`)

**Recommendation:** Add a mock template to the plan that follows the existing test patterns:
```typescript
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServerClient: vi.fn(),
}));
```

### STD-010 [MEDIUM] No coverage thresholds defined for new tests

The testing rules specify: "Business logic and server actions: target 90%". The plan targets "60% server action coverage" overall which is below the 90% standard for individual modules. The plan should clarify: 60% of files covered, with 90% coverage within each tested file.

**Recommendation:** Clarify that each new test file should achieve >= 90% coverage of the functions it tests (happy path + error cases), while the 60% metric refers to file-level breadth.

---

## 5. Definition of Done

### STD-011 [CRITICAL] No DoD checklist attached to any phase

The `definition-of-done.md` requires all features to pass a comprehensive checklist covering: code quality, testing, security, accessibility, documentation, and deployment. The plan has no DoD gate at any phase boundary.

Specific DoD gaps per phase:

| Phase | DoD Gaps |
|-------|----------|
| Phase 1 | No "rollback plan documented" for test fixes; no mention of checking for debug statements |
| Phase 2 | No "server action return types explicitly typed" check after refactoring catch blocks |
| Phase 3 | No accessibility check after component decomposition (focus styles, keyboard nav) |
| Phase 4 | No "coverage meets project minimum" gate after adding tests |
| Phase 5 | No "README updated if new setup" check (new CRON_ALERT_EMAIL env var introduced in 5.6) |
| Phase 6 | No "rollback plan documented" for middleware re-enablement (highest-risk change) |

**Recommendation:** Add a DoD checklist review step at the end of each phase:
```markdown
- [ ] **Phase DoD Gate:** Review against definition-of-done.md checklist
```

### STD-012 [HIGH] New environment variable introduced without documentation

Task 5.6 introduces `CRON_ALERT_EMAIL` in the cron alerting utility but does not update `.env.example` or document the variable. The DoD requires: "Environment variables documented in `.env.example`".

**Recommendation:** Add a step to Task 5.6: "Update `.env.example` with `CRON_ALERT_EMAIL` and add to CLAUDE.md Key Environment Variables section."

---

## 6. PR Strategy

### STD-013 [HIGH] No PR strategy defined for a 39-item remediation

The plan defines commits but never discusses PR boundaries. For a 34-50 day effort, PRs must be explicitly planned. The `pr-and-git-standards.md` says: target 300-500 lines per PR.

The plan's 6 phases could map to PRs as follows, but this needs to be made explicit:

| Phase | Suggested PRs | Rationale |
|-------|--------------|-----------|
| Phase 1 | 3 PRs (one per task) | Each is independently deployable |
| Phase 2 | 4-6 PRs (batch catch migrations by module, ESLint rule separate) | 109 files is too many for one PR |
| Phase 3 | 8-10 PRs (one per decomposition target, buttons in 2-3 batches) | Each extraction is independently testable |
| Phase 4 | 8 PRs (one per test suite + coverage config) | Each test file is independent |
| Phase 5 | 7 PRs (one per task) | Each is independent |
| Phase 6 | 6-8 PRs (middleware separate, N+1 combined, as-any in batches) | Middleware needs isolated deployment |

**Total: ~36-42 PRs** for the full remediation.

**Recommendation:** Add a "PR Strategy" section to the plan header defining PR boundaries, reviewers, and merge order.

### STD-014 [MEDIUM] No branch naming convention specified

The `pr-and-git-standards.md` defines branch naming: `feat/`, `fix/`, `chore/`, etc. The plan never specifies branch names.

**Recommendation:** Define branch names for each phase:
- `fix/phase-1-stability`
- `refactor/phase-2-error-handling`
- `refactor/phase-3-foh-decomposition`
- etc.

Or better, per-PR branches: `fix/failing-tests`, `chore/npm-audit`, `ci/add-test-step`, etc.

---

## 7. Plan Structure & Task Tracking

### STD-015 [MEDIUM] Plan not linked to tasks/todo.md

The project's CLAUDE.md mandates: "Write plan to `tasks/todo.md` with checkable items before starting implementation." The plan lives in `docs/superpowers/plans/` which is fine for the detailed plan, but there should be a corresponding entry in `tasks/todo.md` for tracking.

**Recommendation:** Add a summary checklist to `tasks/todo.md`:
```markdown
## Technical Debt Remediation
- [ ] Phase 1: Stability & Security (TD-1, DD-1, IF-1)
- [ ] Phase 2: Error Handling (CQ-2, CQ-4)
- [ ] Phase 3: Component Decomposition (CQ-3, CQ-5, CQ-6, CQ-8)
- [ ] Phase 4: Test Coverage (TD-2, TD-3, TD-6)
- [ ] Phase 5: Dependencies & Infrastructure (DD-2, DD-3, DS-3, DS-6, IF-3)
- [ ] Phase 6: Architecture & Performance (DS-1, PF-1, DS-7, CQ-1, DC-1)
```

### STD-016 [MEDIUM] 3-Change Rule not applied

The `complexity-and-incremental-dev.md` defines the 3-Change Rule: "Make 1-3 atomic changes -> verify -> commit -> repeat." Several tasks bundle more than 3 changes before verification:

- Task 3.1 Step 6 extracts 5 sub-components before running verification
- Task 3.4 modifies 333 button instances across many files in batches
- Task 6.4 works through 10 files of `as any` before committing

**Recommendation:** Enforce the 3-Change Rule: extract one component, verify, commit. Repeat. This also makes rollback easier.

### STD-017 [LOW] Deferred items lack tracking mechanism

The "Dependency Upgrades Deferred" section lists 5 items but does not specify where they will be tracked. Without issue tracking, deferred items become forgotten debt.

**Recommendation:** Create GitHub Issues for each deferred item and link them in the plan.

---

## Summary of Recommendations

| ID | Severity | Action Required |
|----|----------|----------------|
| STD-004 | Critical | Add full verification pipeline (lint, typecheck, test, build) to every task |
| STD-006 | Critical | Add explicit complexity scores; break score >= 4 into smaller PRs |
| STD-011 | Critical | Add DoD checklist gate at each phase boundary |
| STD-001 | High | Replace `git add -A` with specific file staging |
| STD-005 | High | Add full pipeline to test-only tasks |
| STD-007 | High | Break 109-file migration into 10-15 file PRs |
| STD-008 | High | Add test naming templates |
| STD-009 | High | Add mock strategy templates for new tests |
| STD-012 | High | Document new CRON_ALERT_EMAIL env variable |
| STD-013 | High | Define explicit PR strategy (~36-42 PRs) |
| STD-002 | Medium | Improve "why" in commit messages |
| STD-010 | Medium | Clarify coverage threshold: 90% per file, 60% breadth |
| STD-014 | Medium | Define branch naming for each PR |
| STD-015 | Medium | Add tracking entry to tasks/todo.md |
| STD-016 | Medium | Enforce 3-Change Rule in multi-extraction tasks |
| STD-003 | Low | Use HEREDOC format for multi-line commits |
| STD-017 | Low | Create GitHub Issues for deferred items |

---

## Verdict

**CONDITIONAL PASS** -- The plan is thorough, well-phased, and technically sound. The three critical findings (inconsistent verification pipeline, missing complexity scores, no DoD gates) must be addressed before implementation begins. The high-severity findings around PR strategy and test conventions should be incorporated into the plan to avoid rework during execution.

The plan demonstrates strong awareness of project conventions (conventional commits, debt report references, incremental approach). With the recommended amendments, it would fully align with all project standards.

---

*Report generated by Standards Enforcement Specialist as part of Codex QA Review.*
