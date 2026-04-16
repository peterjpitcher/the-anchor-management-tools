# Adversarial Review: Event Cross-Promo General Audience Expansion

**Date:** 2026-04-16
**Mode:** Adversarial Challenge (Mode A)
**Engines:** Claude + Codex
**Scope:** Spec review — `docs/superpowers/specs/2026-04-16-event-cross-promo-general-audience-design.md`
**Spec:** Same as scope

## Inspection Inventory

### Inspected
- `src/lib/sms/cross-promo.ts` — full file, send loop, error handling, idempotency
- `supabase/migrations/20260404192124_fix_cross_promo_rpc_phone_type.sql` — current RPC
- `supabase/migrations/20260404000002_cross_promo_infrastructure.sql` — sms_promo_context table, indexes
- `src/app/api/cron/event-guest-engagement/route.ts` — cron orchestrator, promo guard, template key counting
- `src/lib/twilio.ts` — sendSMS, safety guards, quiet hours, logFailure behaviour
- `src/lib/sms/reply-to-book.ts` — reply-to-book lookup, template-agnostic path
- `supabase/migrations/20260216210000_fix_customer_category_stats.sql` — stats rebuild, trigger
- `supabase/migrations/20251123120000_squashed.sql` — default privileges, table keys, indexes
- The design spec

### Not Inspected
- Live database (static code analysis only)
- Production audience sizes (inferred from code structure)
- `EventBookingService.createBooking` full paid/prepaid flow
- Applied migration state in production

### Limited Visibility Warnings
- Audience size estimates are inferred — actual numbers could change severity of timeout findings
- Production index usage cannot be confirmed without EXPLAIN ANALYZE

## Executive Summary

The spec's core design (extend the RPC with a second pool, branch message templates) is sound. However, **four high-severity issues** need spec revision before implementation: (1) new template keys bypass the cron's promo-specific hourly guard, (2) removing the recipient cap risks cron timeouts, (3) the UNION ALL dedup requires careful SQL to prevent duplicate sends, and (4) the RPC's SECURITY DEFINER function needs privilege hardening. All are fixable without changing the design approach.

## What Appears Solid

- **Two-pool priority with category-match first** — correct approach, dedup belongs in SQL
- **Dual consent filters** — well-understood, same pattern for both pools
- **7-day frequency cap** — applies cross-pool via `sms_promo_context.customer_id`, not template-specific
- **Idempotency** — different template keys naturally prevent cross-pool collisions
- **sms_promo_context tracking** — no schema changes needed, existing table serves both pools
- **Short link reuse** — one link per event, works for both audiences

## Critical Risks

### CR-1: Promo guard bypass (AB-001, WF-002, SD-005)
**Severity: High | Confidence: High | All three reviewers flagged**

The cron's promo-specific hourly guard hard-codes `EVENT_PROMO_TEMPLATE_KEYS` with only the two existing keys. New general promo template keys won't be counted, allowing general promos to bypass the promo throttle entirely.

**Fix:** Add new template keys to the promo guard constant. The spec must acknowledge a cron orchestrator change is required.

### CR-2: No recipient cap risks cron timeout (AB-002, WF-001, WF-006)
**Severity: High | Confidence: High | All three reviewers flagged**

The current `LIMIT 100` in the RPC is the only per-event brake. The cron's `MAX_EVENT_PROMOS_PER_RUN` only checks between events, not within the send loop. A single event with 300+ recipients could exhaust the 300s cron timeout.

**Fix:** Keep a reasonable per-event soft cap (e.g., 200) or pass remaining run capacity into the RPC. Add elapsed-time checking inside the send loop.

### CR-3: UNION ALL dedup must be explicit (AB-004, SD-002)
**Severity: High | Confidence: High | Both reviewers flagged**

`customer_category_stats` has one row per `(customer_id, category_id)`. The general pool query across all categories will return multiple rows per customer. Without `DISTINCT ON (customer_id)` or `ROW_NUMBER()` partitioning, duplicates will reach the send loop.

**Fix:** Spec must prescribe the dedup strategy: `DISTINCT ON (customer_id)` with `ORDER BY priority, last_attended_date DESC` after the UNION ALL.

### CR-4: RPC privilege hardening (SD-004)
**Severity: High | Confidence: High**

The RPC is `SECURITY DEFINER` and returns PII (names, phone numbers). Default privileges may grant `anon`/`authenticated` execute access. Removing the LIMIT increases exposure surface.

**Fix:** Add `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT EXECUTE ON FUNCTION ... TO service_role;` in the migration.

## Spec Defects

### SP-1: "No changes to cron orchestrator" is incorrect
The spec explicitly states no cron changes are needed. This is wrong — the promo guard template key list must be updated. (CR-1)

### SP-2: "No limits" needs qualification
Removing all caps is unsafe given the sequential send loop and cron timeout. A soft cap or pagination strategy is needed. (CR-2)

### SP-3: Dedup strategy not specified
The spec says "UNION ALL + dedup" but doesn't specify the SQL mechanism. This is the highest-risk implementation detail and should be prescribed. (CR-3)

### SP-4: Missing privilege management
No mention of REVOKE/GRANT on the updated RPC. (CR-4)

## Implementation Defects

None yet (spec-only review).

## Workflow & Failure-Path Defects

### WF-3: Quiet hours and reply window mismatch (WF-003)
**Severity: Medium**

The 48-hour reply window starts from `Date.now()` before the send loop, but SMS may be deferred to after quiet hours. Customers lose overnight hours from the promised window.

**Recommendation:** Advisory — note as a pre-existing issue. Fix if touching the reply window code, otherwise document as known behaviour.

### WF-4: Reply-to-book accepts paid promo templates (WF-004, AB-005)
**Severity: Medium**

Reply-to-book is template-agnostic. Customers who receive a paid general promo (with a link) can still reply with a number to create a booking via SMS. This is a pre-existing behaviour but expands to the new audience.

**Recommendation:** Needs human decision — is this acceptable or should reply-to-book filter by template key?

### WF-7: Stats source includes non-confirmed bookings (AB-003, WF-007)
**Severity: Medium**

`customer_category_stats` counts bookings on insert, including `pending_payment` and later-cancelled. The "attended any event" pool may include customers who never actually attended.

**Recommendation:** Needs human decision — is "had a booking" sufficient, or should the general pool require confirmed status?

### WF-8: Context insert failure leaves gaps (WF-008, SD-003)
**Severity: Medium**

If `sms_promo_context` insert fails after a successful send, the customer escapes the 7-day frequency cap and can't use reply-to-book. Pre-existing issue, but larger audiences increase exposure.

**Recommendation:** Advisory — consider treating context insert failure as a send failure.

### WF-9: sendSMS logFailure treated as success (WF-009)
**Severity: Medium (pre-existing)**

`sendSMS` can return `success: true` with `logFailure: true`. Cross-promo doesn't check this flag. Pre-existing, but worth noting.

## Security & Data Risks

### SD-6: last_event_name should filter event status (SD-006)
**Severity: Medium**

The `last_event_name` subquery should exclude cancelled/draft events and only use customer-visible event names.

**Recommendation:** Add `event_status` filter to the subquery.

## Unproven Assumptions

1. **Audience sizes** — we don't know how many customers fall in the 3-month general pool. If it's 1000+, the timeout and rate limit findings become critical rather than high.
2. **Index coverage** — the proposed `idx_ccs_last_attended_any` may not be sufficient for the `last_event_name` correlated subquery (AB-006). Needs EXPLAIN ANALYZE on real data.
3. **Stats accuracy** — whether `customer_category_stats` is "good enough" for targeting depends on how many pending/cancelled bookings exist in practice.

## Recommended Fix Order

1. **CR-1** — Add template keys to promo guard (blocks: everything else)
2. **CR-3** — Prescribe UNION ALL dedup strategy in spec
3. **CR-2** — Define soft cap / pagination strategy
4. **CR-4** — Add REVOKE/GRANT to migration
5. **SP decisions** — Resolve WF-4 (reply-to-book) and WF-7 (stats accuracy) with user
6. **SD-6** — Add event_status filter to last_event_name subquery

## Follow-Up Review Required

- Re-review the actual migration SQL after implementation (CR-3 dedup correctness)
- EXPLAIN ANALYZE the general pool query on real data (AB-006 performance)
- Verify audience sizes in production before enabling (CR-2 timeout risk)
