# QA Review Report — Technical Debt Remediation Plan

**Scope:** `docs/superpowers/plans/2026-04-04-technical-debt-remediation.md` reviewed against `tasks/technical-debt-report.md`
**Date:** 2026-04-04
**Mode:** Spec Compliance Review
**Engines:** Claude + Codex (dual-engine)
**Spec:** `tasks/technical-debt-report.md` (42 debt items across 7 categories)

---

## Executive Summary

The plan addresses 26 of 42 debt items fully, partially covers 9, explicitly defers 5, and **misses 7 entirely**. Five specialists (3 Codex, 2 Claude) independently reviewed the plan and produced **69 total findings** which deduplicate to **28 unique issues**: 5 critical, 9 high, 10 medium, 4 low.

**Verdict: DO NOT EXECUTE AS-IS.** The plan needs revisions to address the critical and high findings before implementation begins. The core structure and phasing is sound, but several tasks contain incorrect assumptions, wrong code samples, or dangerous gaps.

---

## Spec Compliance Summary

**Coverage: 26 fully covered, 9 partial, 5 deferred, 7 missing (of 42 items)**

### Requirements Coverage Matrix

| ID | Severity | Plan Task | Status | Issue |
|---|---|---|---|---|
| CQ-1 | High | T6.4 | Partial | No lint rule to prevent regression; hotspot order ignored |
| CQ-2 | High | T2.1 | Covered | But see MERGED-003 re: behaviour changes |
| CQ-3 | High | T3.1-T3.3 | Partial | Only 3 of 27 god objects targeted |
| CQ-4 | Medium | T2.2 | Partial | `no-console: warn` conflicts with `--max-warnings=0` |
| CQ-5 | Medium | T3.6 | Partial | Some hex values are runtime data, not styling |
| CQ-6 | Medium | T3.4 | Covered | But grep approach has false positives |
| CQ-7 | Low | — | Covered | Already healthy, no action needed |
| CQ-8 | Low | T3.5 | Partial | Discovery grep hits definitions, not consumers; may be 0 legacy pages |
| TD-1 | Critical | T1.1 | Covered | |
| TD-2 | High | T4.2-T4.7 | Covered | |
| TD-3 | High | T4.8-T4.9 | Partial | Only Stripe/Twilio; misses table-bookings, jobs/process, FOH |
| TD-4 | Medium | — | **Missing** | No component test task or deferral |
| TD-5 | Medium | Deferred | Deferred | Explicitly deferred (Playwright) |
| TD-6 | Medium | T4.1 | Partial | No coverage thresholds configured |
| TD-7 | Low | — | **Missing** | No scripts test task or deferral |
| DD-1 | High | T1.2 | Partial | Audit now shows 14 high/40 moderate; acceptance criteria stale |
| DD-2 | High | T5.1 | Covered | |
| DD-3 | Medium | T5.2 | Partial | `npm update` won't reach target versions due to semver ranges |
| DD-4 | Medium | Deferred | Deferred | |
| DD-5 | Low | Deferred | Deferred | |
| DD-6 | Low | T5.1 | Covered | |
| DS-1 | Medium | T6.1 | Partial | Restores page redirects but `/api` stays public |
| DS-2 | Medium | Deferred | Deferred | |
| DS-3 | Medium | T5.4 | Partial | Only 1 of 30 crons addressed |
| DS-4 | Medium | T5.7 | Covered | |
| DS-5 | Medium | T3.5 | Partial | Same issue as CQ-8 |
| DS-6 | Low | T5.5 | Covered | |
| DS-7 | Low | T6.3 | Partial | RPC design wrong; see MERGED-002 |
| IF-1 | High | T1.3 | Partial | CI exists; task adds tests but not merge gating |
| IF-2 | High | Correction | **Incorrect** | `.nvmrc` exists but local dev still runs Node 25 |
| IF-3 | Medium | T5.6 | Partial | Code sample wrong; only covers 5 of 30 crons |
| IF-4 | Medium | T6.6 | Covered | |
| IF-5 | Low | — | **Missing** | No backup verification task |
| DC-1 | Medium | T6.5 | Covered | |
| DC-2 | Low | T5.1 | Covered | |
| DC-3 | Low | T5.3 | Covered | |
| DC-4 | Low | — | **Missing** | No `.env.example` changelog task |
| PF-1 | Medium | T6.2 | Partial | event-images is a false N+1; projects fix is wrong approach |
| PF-2 | Medium | — | **Missing** | 3,434-line billing cron not targeted |
| PF-3 | Medium | T5.4 | Partial | Schedule is intentionally hourly (idempotent with day-gate) |
| PF-4 | Low | — | **Missing** | Generated types file not addressed |
| PF-5 | Low | — | **Missing** | 300s timeout routes not investigated |

---

## Critical Findings

### MERGED-001: `no-console` ESLint rule will instantly break the build
- **Engines:** Claude Bug Hunter + Codex Spec Compliance
- **Severity:** Critical
- **Task:** 2.2
- **Description:** The plan adds `no-console: "warn"` but the lint script uses `--max-warnings=0`. The 123 existing `console.log` statements become 123 warnings, which equals a build failure. Setting it to `"off"` renders the rule useless.
- **Fix:** Must clean up existing `console.log` statements FIRST, then enable the rule at `"error"` level. Or scope the rule to only new/changed files via ESLint overrides.

### MERGED-002: Parking TOCTOU fix RPC is wrong in every dimension
- **Engines:** Codex Bug Hunter + Codex Security + Codex Spec Compliance + Claude Performance
- **Severity:** Critical
- **Task:** 6.3
- **Description:** The SQL sketch uses wrong column names (`booking_date` vs `start_at/end_at`), wrong table references (`parking_config` vs `parking_rates`), `SELECT COUNT(*) ... FOR UPDATE` which doesn't lock anything when zero rows exist, and omits `SECURITY INVOKER`/RLS considerations. The actual parking model uses overlapping time windows, not simple date-based counts.
- **Fix:** Remove the sample SQL entirely. The task should read the actual parking service, capacity module, and repository before designing the RPC. An advisory lock or unique constraint approach is more appropriate than `FOR UPDATE`.

### MERGED-003: Catch block migration changes error response behaviour
- **Engines:** Claude Bug Hunter + Codex Bug Hunter + Codex Security
- **Severity:** Critical
- **Task:** 2.1
- **Description:** The plan claims "identical runtime behaviour" but `getErrorMessage()` collapses non-Error values to a generic string, which differs from the current `error.message || 'fallback'` pattern. Some handlers also branch on `error.code` (e.g., Postgres `23505` duplicate key), which is lost with `error: unknown`. Error response shapes visible to the frontend could change.
- **Fix:** Cannot be a mechanical sweep. Each catch block needs context-aware migration: (1) extend `getErrorMessage` or create variants that preserve `.code`, (2) audit which error messages are returned to clients vs logged internally, (3) add tests for error response shapes before migrating.

### MERGED-004: Middleware re-enable is dangerously underspecified
- **Engines:** Claude Bug Hunter + Codex Bug Hunter + Codex Security
- **Severity:** Critical
- **Task:** 6.1
- **Description:** The disabled middleware does far more than auth redirects: short-link host bypass, Supabase cookie refresh, redirect sanitisation, and `X-Robots-Tag` headers. The plan's "minimal" version would break short links (`l.the-anchor.pub`), weaken session handling, and still exempt all `/api` routes (the very gap the debt report flagged). The plan also doesn't verify layout auth checks remain intact post-enable.
- **Fix:** This task needs a complete rewrite. Start by documenting every responsibility the current disabled middleware has. The "minimal" approach should be "restore the existing middleware exactly as-is" not "write a new minimal one". Test on preview deployment before merge. Add explicit verification that layout auth AND middleware auth both function.

### MERGED-005: No complexity scores or PR strategy for large tasks
- **Engines:** Claude Standards Enforcer
- **Severity:** Critical
- **Task:** All
- **Description:** Project rules require complexity scores on all work and mandate that score >= 4 tasks be broken into smaller PRs (300-500 lines). Zero tasks have complexity scores. Task 2.1 alone touches 109 files in 3 commits. No PR strategy is defined for a 39-item remediation.
- **Fix:** Add complexity scores to every task. Tasks scoring >= 4 (T2.1, T3.1, T3.2, T3.3, T6.4 at minimum) must define explicit PR boundaries. Add a PR strategy section mapping tasks to PRs.

---

## High Findings

### MERGED-006: FohScheduleClient decomposition risks realtime/render regressions
- **Engines:** Claude Performance + Claude Bug Hunter + Codex Bug Hunter
- **Severity:** High
- **Task:** 3.1
- **Description:** The component has 43 `useState` hooks, 15+ `useMemo`/`useCallback`, and 8 realtime channel subscriptions with ref-based drag suppression. The plan doesn't mention `React.memo`, render count validation, or how to preserve realtime subscription stability. Decomposition is done in Phase 3 BEFORE component tests are added in Phase 4.
- **Fix:** (1) Add component-level tests or at least render-count smoke tests BEFORE decomposing. (2) Include explicit `React.memo` strategy. (3) Keep realtime subscriptions in a single hook that doesn't split across components. (4) Mandate browser testing of drag-and-drop after each extraction.

### MERGED-007: Cron alerting code won't compile and leaks PII
- **Engines:** Codex Bug Hunter + Codex Security + Codex Spec Compliance
- **Severity:** High
- **Task:** 5.6
- **Description:** `sendEmail` is called with positional args but the actual API takes an options object. Error context JSON-stringified into HTML without sanitisation can leak PII (customer phone numbers, emails from parking/booking crons) and enables HTML injection. The plan ignores the existing `persistCronRunResult` utility.
- **Fix:** (1) Use the correct `sendEmail({ to, subject, html })` signature. (2) HTML-escape all interpolated values. (3) Redact PII from context before emailing. (4) Build on existing `persistCronRunResult` rather than a parallel system.

### MERGED-008: Weekly summary cron is intentionally hourly
- **Engines:** Codex Bug Hunter + Codex Spec Compliance
- **Severity:** High
- **Task:** 5.4
- **Description:** The route self-gates to Monday and the configured London hour, with idempotency protection. The hourly schedule is a safe polling pattern, not a bug. Changing to `0 9 * * 1` would remove env-based hour control and could miss the window.
- **Fix:** Remove this from the plan or change it to "verify and document the intentional polling pattern" rather than "fix the schedule".

### MERGED-009: npm audit vulnerability count has grown significantly
- **Engines:** Codex Spec Compliance
- **Severity:** High
- **Task:** 1.2
- **Description:** The report said 9 vulnerabilities (7 high, 2 moderate). Live audit now shows 14 high and 40 moderate. The acceptance criteria of "0 high/critical after `npm audit fix`" is likely unachievable without major dependency changes.
- **Fix:** Re-run `npm audit --json` at plan start to get current numbers. Set realistic acceptance criteria. Some transitive vulnerabilities may need to be documented as accepted risk if they can't be fixed without major version bumps.

### MERGED-010: Verification pipeline not consistently applied
- **Engines:** Claude Standards Enforcer
- **Severity:** High
- **Tasks:** Multiple
- **Description:** Only 4 of ~20 tasks run the full lint/typecheck/test/build pipeline. The rest skip 1-3 steps. The project's `verification-pipeline.md` requires all 4 checks before every push.
- **Fix:** Add the full verification command to every task: `npm run lint && npx tsc --noEmit && npm test && npm run build`

### MERGED-011: ESLint config ambiguity (two configs exist)
- **Engines:** Claude Bug Hunter + Codex Bug Hunter
- **Severity:** High
- **Task:** 2.2
- **Description:** The repo has both `.eslintrc.json` and `eslint.config.js`. ESLint 9 uses flat config, so `.eslintrc.json` may be ignored. The plan says "find the config" without specifying which one is authoritative.
- **Fix:** Determine which config is active (check ESLint version and configuration). Modify only the active one. Document which is the source of truth.

### MERGED-012: `as any` reduction has no lint enforcement
- **Engines:** Claude Spec Compliance
- **Severity:** High
- **Task:** 6.4
- **Description:** `@typescript-eslint/no-explicit-any` is OFF in `eslint.config.js`. Without enabling it, the reduction campaign has no guardrail against new `as any` being introduced.
- **Fix:** Enable `@typescript-eslint/no-explicit-any` at `"warn"` level alongside the reduction campaign. Promote to `"error"` once under 200.

### MERGED-013: Decomposition before tests creates regression risk
- **Engines:** Codex Bug Hunter + Claude Standards Enforcer
- **Severity:** High
- **Tasks:** 3.1, 3.2, 3.3
- **Description:** Phase 3 decomposes the three largest files (FoH, receipts, private bookings) but Phase 4 is where tests are added. This means the highest-risk refactoring happens without test coverage.
- **Fix:** Either (1) swap Phase 3 and Phase 4, adding tests first, or (2) add targeted tests for each file within Phase 3 before decomposing it.

### MERGED-014: IF-2 incorrectly closed as false positive
- **Engines:** Codex Spec Compliance
- **Severity:** High
- **Task:** Corrections section
- **Description:** The plan claims IF-2 is a false positive because `.nvmrc` exists. But the issue is that local dev runs Node 25.6.0 while `.nvmrc` says 20 and `engines` says `<23`. The `.nvmrc` existing doesn't mean it's being used.
- **Fix:** Restore IF-2 as a genuine item. The task should ensure developers actually use `.nvmrc` (e.g., add shell hook guidance, or document `nvm use` in CLAUDE.md).

---

## Medium Findings

### MERGED-015: Hex colour sweep includes runtime/data colours
- **Engines:** Codex Bug Hunter
- **Task:** 3.6
- **Description:** Some hex values are canvas chart defaults, persisted customer-label colours, and inline event colours — not Tailwind-swappable styling. A blanket replacement would change runtime behaviour.
- **Fix:** Categorise hex values as "styling" vs "data/runtime" before replacing. Only styling values get Tailwind tokens.

### MERGED-016: Button type grep has multiline false positives
- **Engines:** Codex Bug Hunter
- **Task:** 3.4
- **Description:** Line-based grep flags multiline buttons where `type="submit"` is on the next line. Could lead to accidentally changing submit buttons to `type="button"`.
- **Fix:** Use AST-based tooling or manual review rather than grep-and-replace.

### MERGED-017: PostCSS rename doesn't stage the deletion
- **Engines:** Codex Bug Hunter
- **Task:** 5.5
- **Description:** After `rm postcss.config.js`, the commit only `git add`s the new file. The old file deletion won't be committed.
- **Fix:** Use `git add postcss.config.mjs postcss.config.js` or `git rm postcss.config.js` before committing.

### MERGED-018: N+1 fix for event-images is a false positive
- **Engines:** Claude Performance + Codex Spec Compliance
- **Task:** 6.2
- **Description:** `supabase.storage.getPublicUrl()` is synchronous URL construction, not a network call. The loop is O(n) string operations, not N+1 queries.
- **Fix:** Remove event-images from the N+1 fix task.

### MERGED-019: N+1 fix for projects.ts is wrong approach
- **Engines:** Claude Performance + Codex Spec Compliance
- **Task:** 6.2
- **Description:** The unique code loop runs at most 10 iterations with near-zero collision probability (5-char random suffix). `.in()` batch doesn't apply since candidates are randomly generated.
- **Fix:** Deprioritise or remove. If concerned about collisions, add a unique constraint at DB level.

### MERGED-020: Service decomposition could expose privileged helpers
- **Engines:** Codex Security
- **Task:** 3.2, 3.3
- **Description:** Extracting admin-backed mutations from server actions into generic service modules (before permission tests land in Phase 4) could let future code import privileged helpers and bypass auth checks.
- **Fix:** Ensure every extracted service function either (1) takes an auth context parameter, or (2) is explicitly marked as requiring caller-side auth. Add a comment convention.

### MERGED-021: Coverage thresholds needed for TD-6
- **Engines:** Codex Bug Hunter + Codex Spec Compliance
- **Task:** 4.1
- **Description:** Adding `npm run test:coverage` to CI reports numbers but doesn't enforce them. Vitest config has no thresholds.
- **Fix:** Add coverage thresholds to `vitest.config.ts`:
```typescript
coverage: { thresholds: { lines: 60, branches: 50, functions: 60 } }
```

### MERGED-022: No Definition of Done checklist at phase boundaries
- **Engines:** Claude Standards Enforcer
- **Tasks:** All phases
- **Description:** The project's Definition of Done requires specific quality gates. No phase includes a DoD checklist.
- **Fix:** Add a DoD verification step at the end of each phase.

### MERGED-023: Dependency update commands won't reach target versions
- **Engines:** Codex Spec Compliance
- **Task:** 5.2
- **Description:** `npm update` respects semver ranges in `package.json`. The pinned ranges for `@supabase/ssr` (`^0.6.1`), `googleapis` (`^150.0.1`) etc. won't reach the versions the report named.
- **Fix:** Use `npm install @supabase/ssr@latest googleapis@latest` instead of `npm update`.

### MERGED-024: Plan modifies the spec document (destroys audit baseline)
- **Engines:** Codex Spec Compliance
- **Task:** 4.10
- **Description:** Task 4.10 Step 2 tells workers to update `tasks/technical-debt-report.md` with new coverage numbers. This destroys the original audit baseline.
- **Fix:** Write updated metrics to a separate file (e.g., `tasks/technical-debt-progress.md`) and keep the original report as-is.

---

## Low Findings

### MERGED-025: Missing items should be explicitly deferred or added
- TD-4 (component tests), TD-7 (scripts tests), IF-5 (backup verification), DC-4 (env changelog), PF-2 (billing cron decomposition), PF-4 (generated types), PF-5 (300s timeout routes)
- **Fix:** Add each as either a concrete task or an explicit deferral with justification.

### MERGED-026: CI test step ordering contradicts verification pipeline
- **Engines:** Claude Bug Hunter
- **Task:** 1.3
- **Description:** Plan places tests before typecheck; `verification-pipeline.md` specifies lint -> typecheck -> test -> build.
- **Fix:** Reorder to match the project's documented pipeline.

### MERGED-027: PageWrapper legacy migration may be 0 files
- **Engines:** Codex Bug Hunter + Codex Spec Compliance
- **Task:** 3.5
- **Description:** Grep hits component definitions, not consumer pages. There may be 0 actual legacy consumers remaining.
- **Fix:** Verify before including in the plan. If 0 consumers, mark CQ-8 as already resolved.

### MERGED-028: `getErrorMessage()` not a security sanitiser
- **Engines:** Codex Security
- **Task:** 2.1
- **Description:** The function forwards raw `Error.message` which can contain internal DB/provider details. Using it as a universal response adapter could leak information to clients.
- **Fix:** Add a `getSafeErrorMessage()` variant for client-facing responses that strips internal details, or audit each usage for client vs internal context.

---

## Cross-Engine Analysis

### Agreed (both Claude and Codex flagged independently)

| Finding | Claude Source | Codex Source | Confidence |
|---------|-------------|-------------|------------|
| Parking RPC design is wrong | Performance, Bug Hunter | Bug Hunter, Security, Spec Compliance | **Very High** |
| Catch migration changes behaviour | Bug Hunter | Bug Hunter, Security | **Very High** |
| Middleware re-enable is underspecified | Bug Hunter | Bug Hunter, Security, Spec Compliance | **Very High** |
| Cron alerting code won't compile | — | Bug Hunter, Spec Compliance | **High** |
| Weekly summary is intentionally hourly | — | Bug Hunter, Spec Compliance | **High** |
| event-images N+1 is false positive | Performance | Spec Compliance | **High** |
| ESLint no-console breaks build | Bug Hunter | Spec Compliance | **High** |

### Codex-Only Findings
- SEC-004: Service decomposition privilege escalation risk (medium confidence — valid concern but theoretical)
- SPEC-002: IF-2 false positive correction is itself incorrect (high confidence — verified against live environment)

### Claude-Only Findings
- STD-004/006/011: Missing complexity scores, PR strategy, and DoD checklists (high confidence — these are project rule violations)
- PERF-001: FoH realtime subscription risk during decomposition (high confidence — based on actual code analysis)

---

## Recommendations — Priority Order

### Must Fix Before Execution (Blockers)
1. **Rewrite Task 6.3** — Remove sample SQL; require codebase reading before designing RPC
2. **Rewrite Task 6.1** — Change from "minimal new middleware" to "restore existing middleware with testing"
3. **Rewrite Task 2.1** — Change from mechanical sweep to context-aware migration with test-first approach
4. **Fix Task 2.2** — Clean up console.logs first OR use ESLint override for new files only
5. **Add complexity scores and PR strategy** to all tasks
6. **Swap Phase 3/4 ordering** or add tests within Phase 3 before each decomposition

### Should Fix (Important)
7. **Remove false N+1s** (event-images, projects.ts) from Task 6.2
8. **Fix cron alerting code** (correct sendEmail signature, add HTML escaping, redact PII)
9. **Remove weekly summary schedule "fix"** — document it as intentional instead
10. **Add full verification pipeline** to every task
11. **Fix dependency update commands** (use `npm install pkg@latest` not `npm update`)
12. **Restore IF-2** as genuine item
13. **Add 7 missing items** as tasks or explicit deferrals
14. **Enable `@typescript-eslint/no-explicit-any`** alongside CQ-1 campaign

### Nice to Have
15. Add DoD checklists at phase boundaries
16. Fix PostCSS rename git staging
17. Verify CQ-8 legacy pages actually exist
18. Add coverage thresholds to Vitest config

---

## Individual Specialist Reports

| Specialist | Engine | Findings | Report |
|-----------|--------|----------|--------|
| Spec Compliance Auditor | Codex | 12 | `2026-04-04-tech-debt-plan-spec-compliance-auditor-report.md` |
| Bug Hunter | Codex | 11 | `2026-04-04-tech-debt-plan-bug-hunter-report.md` |
| Security Auditor | Codex | 6 | `2026-04-04-tech-debt-plan-security-auditor-report.md` |
| Performance Analyst | Claude | 9 | `2026-04-04-tech-debt-plan-performance-analyst-report.md` |
| Standards Enforcer | Claude | 17 | `2026-04-04-tech-debt-plan-standards-enforcer-report.md` |
| Bug Hunter | Claude | 26 | `2026-04-04-tech-debt-plan-bug-hunter-report.md` |
| Spec Compliance Auditor | Claude | 26 | `2026-04-04-tech-debt-plan-spec-compliance-auditor-report.md` |

*Note: Claude fallback agents ran in parallel with Codex agents due to initial auth failure. Both perspectives are reflected in the merged findings above.*

---

*Report generated by Codex QA Review skill. All findings cross-referenced between engines where applicable.*
