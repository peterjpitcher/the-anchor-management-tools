# Standards Enforcement Report

**Spec:** `docs/superpowers/specs/2026-03-22-event-sms-cross-promotion-and-tone-refresh.md`
**Date:** 2026-03-22
**Reviewer:** Standards Enforcer (automated)

---

## Summary

The spec is well-structured and demonstrates strong awareness of existing codebase patterns. Seven findings were identified, ranging from a missing RLS requirement to minor naming inconsistencies.

---

## Findings

### STD-001: New table `sms_promo_context` is missing RLS enablement and policies
- **Severity:** High
- **Standard:** Supabase conventions (`supabase.md` — "RLS is always enabled on all tables")
- **Description:** The `sms_promo_context` CREATE TABLE SQL in section 6 does not include `ALTER TABLE sms_promo_context ENABLE ROW LEVEL SECURITY` or any RLS policies. Every other new table migration in the codebase (e.g., `calendar_notes`, `table_join_groups`, `hiring_*` tables) includes RLS enablement and at least one policy.
- **Expected:** The migration must include `ALTER TABLE sms_promo_context ENABLE ROW LEVEL SECURITY;` followed by appropriate policies. Since this table is only accessed by cron/webhook handlers using the service-role client, a deny-all policy for authenticated users (or a service-role-only SELECT/INSERT policy) would be appropriate, matching the pattern used for other system-only tables.

### STD-002: Complexity score XL (5) but rollout plan does not map inter-PR dependencies
- **Severity:** Medium
- **Standard:** Complexity & incremental dev (`complexity-and-incremental-dev.md` — "Score >= 4: MUST be broken into smaller PRs with dependencies mapped")
- **Description:** The spec correctly assigns complexity score 5 (XL) and breaks the work into 5 phases. The rollout plan states dependencies narratively (e.g., "Phase 5 depends on Phases 3 and 4") but does not use the required format of "Part N of M -- depends on #NNN" referencing actual PR numbers, nor does it explicitly state which phases can run in parallel vs. sequentially. Phase 1 and Phase 2 appear independent but this is not stated.
- **Expected:** Each phase should explicitly state: (1) which other phases it depends on, (2) whether it can be deployed independently, and (3) estimated line count to confirm each stays within the 300-500 line target. The spec does say "each phase is independently deployable" which partially addresses this, but the dependency graph should be explicit (e.g., "Phase 1: no dependencies, Phase 2: no dependencies, Phase 3: no dependencies, Phase 4: depends on Phase 3, Phase 5: depends on Phases 3 and 4").

### STD-003: Proposed `EventBookingService` should follow class-based service pattern
- **Severity:** Medium
- **Standard:** Existing codebase conventions (source of truth hierarchy: "existing code patterns in the project")
- **Description:** The spec proposes extracting `EventBookingService.createBooking()` as a "shared function." All 20+ services in `src/services/` use the class-based pattern (`export class XxxService { ... }`), including `EventMarketingService`, `PrivateBookingService`, `CustomerService`, etc. The spec's language ("shared function") is ambiguous about whether this will be a class with static methods or a standalone function.
- **Expected:** The spec should explicitly state that `EventBookingService` will be a class in `src/services/event-bookings.ts` following the same pattern as other services (e.g., `export class EventBookingService { static async createBooking(...) }`). The file naming should also follow the existing `kebab-case.ts` convention in `src/services/`.

### STD-004: Quiet hours bypass for reply-to-book responses needs explicit safety justification
- **Severity:** Medium
- **Standard:** SMS safety infrastructure (spec's own scope exclusion: "no changes to SMS infrastructure")
- **Description:** Section 2 (Safety) states that reply-to-book edge case responses "bypass quiet hours deferral." This is a change to the SMS safety infrastructure behaviour, which the spec's own scope section declares as out of scope ("Changes to SMS infrastructure (rate limits, quiet hours, safety guards)"). The justification (customer expects immediate response) is reasonable, but introducing a quiet-hours bypass is a safety guard modification.
- **Expected:** Either: (a) move the quiet hours bypass into scope with explicit acknowledgement that it modifies safety infrastructure, or (b) implement reply-to-book responses through the standard send path and accept that responses during quiet hours will be deferred (which is the safer default). If (a), the bypass mechanism should be documented -- e.g., a `bypassQuietHours: true` flag in the `sendSMS` call, and the conditions under which it is permitted.

### STD-005: New columns on existing tables missing function/trigger audit
- **Severity:** Medium
- **Standard:** Supabase conventions (`supabase.md` — "Dropping columns or tables -- mandatory function audit")
- **Description:** The spec adds `review_suppressed_at` to `bookings` and `table_bookings`, and `review_processed_at` + `review_clicked_at` to `private_bookings`. While these are ADD COLUMN operations (not DROP), the Supabase convention requires checking for functions/triggers that reference these tables, because adding columns that alter query semantics (e.g., cron queries that use `SELECT *` or build WHERE clauses) could silently change behaviour. The cron queries for review eligibility will need to add `AND review_suppressed_at IS NULL` -- the spec describes this but does not call out a systematic audit of all queries touching these tables.
- **Expected:** The spec should include an explicit audit step: "Before implementation, search for all functions, triggers, and queries that filter on `bookings`, `table_bookings`, and `private_bookings` review-related columns to ensure the new columns are incorporated consistently." This prevents a scenario where one query path checks `review_suppressed_at` but another does not.

### STD-006: Environment variable naming uses different prefix pattern than existing crons
- **Severity:** Low
- **Standard:** Existing codebase conventions (source of truth: existing code patterns)
- **Description:** The spec proposes env vars like `EVENT_PROMO_LOOKAHEAD_DAYS`, `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT`, etc. The existing event-guest-engagement cron uses the prefix `EVENT_ENGAGEMENT_` (e.g., `EVENT_ENGAGEMENT_SEND_GUARD_WINDOW_MINUTES`, `EVENT_ENGAGEMENT_HOURLY_SEND_GUARD_LIMIT`). The SMS safety layer uses `SMS_SAFETY_` prefix. Using `EVENT_PROMO_` is reasonable for a distinct concern, but it introduces a third naming convention within the same cron file.
- **Expected:** This is acceptable as-is since the promo stage is a genuinely different concern from the engagement stage. However, the spec should note that these variables are parsed using the same `parsePositiveIntEnv()` / `parseBooleanEnv()` helpers already defined in the cron file (or imported from `src/lib/sms/safety.ts`), rather than introducing new parsing logic.

### STD-007: `sms_promo` marketing channel addition needs type/enum consistency check
- **Severity:** Low
- **Standard:** Existing codebase conventions (type safety)
- **Description:** The spec states a new `sms_promo` channel should be "added to the marketing channels list" for `EventMarketingService.generateSingleLink()`. The existing channels are defined in `src/lib/event-marketing-links.ts` as `EVENT_MARKETING_CHANNELS` and `EVENT_MARKETING_CHANNEL_MAP` with a typed `EventMarketingChannelKey`. The spec does not mention updating these type definitions.
- **Expected:** The spec should explicitly state that `sms_promo` must be added to: (1) `EVENT_MARKETING_CHANNELS` array, (2) `EVENT_MARKETING_CHANNEL_MAP` object with appropriate label/type/description, and (3) the `EventMarketingChannelKey` type. This ensures type safety is maintained when calling `generateSingleLink()` with the new channel.

---

## Conformance Summary

| Area | Verdict | Notes |
|------|---------|-------|
| Rollout / complexity rules | Partial | Phases defined but dependency graph not explicit (STD-002) |
| Database migration patterns | Fail | Missing RLS on new table (STD-001) |
| Server action patterns | N/A | Spec does not introduce new server actions; uses cron + webhook |
| Cron structure | Pass | Correctly extends existing cron with separate stage and constants |
| SMS safety / idempotency | Partial | Correctly reuses idempotency_keys and safety guards, but quiet hours bypass contradicts scope (STD-004) |
| Template key naming | Pass | Preserves existing keys, new keys follow `snake_case` convention consistently |
| Service extraction pattern | Partial | Correct intent but should specify class-based pattern (STD-003) |

---

## Recommendations

1. **Must fix before implementation:** STD-001 (RLS). This is a hard project rule with no exceptions.
2. **Should fix before implementation:** STD-003 (class pattern), STD-004 (quiet hours scope), STD-005 (function audit step).
3. **Nice to have:** STD-002 (explicit dependency graph), STD-006 (env var parsing note), STD-007 (type definition update list).
