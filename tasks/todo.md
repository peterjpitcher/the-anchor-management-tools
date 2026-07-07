# Task Tracker

## Current Task: Premium hourly rates (time-and-a-half / double-time) (2026-07-07)

Spec: [premium-rate-spec.md](premium-rate-spec.md) · Plan: [premium-rate-impl-plan.md](premium-rate-impl-plan.md)
Orchestrated via implement-plan (code mode), 2 waves / 5 agents.

### Wave 1 — Foundation ✅ (gate passed: git-scope clean, 30/30 tests, tsc 0 errors)
- [x] Migration `20260727000000_premium_rates.sql` (rota_shifts, rota_published_shifts, timeclock_sessions)
- [x] Window-aware pay helper + precedence resolver in `pay-calculator.ts` (computeSessionPremiumPay, resolveSessionPremium, computePlannedShiftPremiumPay, resolveShiftWindowInstants, computeEffectiveRate, premiumLabel, hasPremium)
- [x] Helper Vitest coverage — 30 tests in `src/lib/rota/premium-pay.test.ts`
- [x] Generated DB types: not needed (Supabase clients untyped in this project)

### Wave 2 — Feature streams ✅ (gate passed)
- [x] R: rota shift write-path (actions + 2 modals + summary + publish snapshot + shift→session propagation + approval invalidation; 11 tests)
- [x] T: timeclock session write-path (actions + TimeclockManager + auto-close; copy-down + preserve-across-edits + window re-clamp; 6 tests)
- [x] P: payroll calc + accountant Excel/email (both loops + snapshot + Standard/Premium hours + Premium ×; back-compat; 15 tests)
- [x] Po: staff portal badge + pay (planned+actual via helper, session→shift fallback, PaySummaryCard line, ICS note)

### Verification
- [x] git scope diff per wave — clean (no strays in owned files)
- [x] lint (0 warn) → typecheck (0 err) → test (3434/3434) → build (ok)
- [x] codex-qa-review adversarial pass (Codex broken → Claude-only, owner-approved): 6 confirmed material + mediums
- [x] Repair wave (5 agents): drop copy-down + propagate, override cap ≤£100, numeric coercion, overnight off-by-one `<`, linked-only portal/payroll consistency, session validation + audited invalidation + payroll:approve path
- [x] Re-verify pipeline green (tsc 0 / lint 0 / 3462 tests / build ok) + all 6 confirmed findings spot-checked closed in code
- [x] Re-review after fixes: 1 HIGH (premium field-clear) + 3 mediums confirmed → all fixed + regression-tested
- [x] Final pipeline green: tsc 0 / lint 0 / **3464 tests** / build ok; all findings spot-checked closed in code

**Held for owner go-ahead:** apply migration to prod (Supabase MCP), commit/merge to `main` (auto-deploys).

### Review notes
Implementation COMPLETE + fully verified 2026-07-07. 2 adversarial review rounds:
- Round 1: 6 confirmed material (overnight off-by-one, copy-down staleness ×2, uncapped override, numeric-as-string, portal/payroll divergence) → fixed via 5-agent repair wave (key move: dropped clock-in copy-down; sessions resolve premium live from the shift).
- Round 2 (post-repair): 1 HIGH (updateShift `??` couldn't clear a rate field → stale override paid) + 3 mediums (calendar-feed coercion, HH:mm vs HH:mm:ss approval churn, approve not wired for payroll:approve) → all fixed + tests added.
15 code files + migration `20260727000000_premium_rates.sql` + 4 premium test files. Nothing committed; migration NOT applied to prod.
