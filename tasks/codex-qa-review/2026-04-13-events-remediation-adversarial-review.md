# Adversarial Review: Events Domain Remediation Spec

**Date:** 2026-04-13
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** `docs/superpowers/specs/2026-04-13-events-remediation-design.md` — 18 defects (D01-D18)

## Inspection Inventory

### Inspected
- `src/app/actions/events.ts` — all CRUD functions, manual booking, form data prep
- `src/services/events.ts` — EventService methods, Zod schema, publish validation
- `src/services/event-bookings.ts` — shared booking service
- `src/components/features/events/EventFormGrouped.tsx` — form fields, capacity, payment_mode
- `src/app/(authenticated)/events/[id]/edit/` — edit page + client
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` — detail page booking counts
- `src/app/api/cron/event-booking-holds/route.ts` — hold expiry cron
- `src/app/api/cron/event-guest-engagement/route.ts` — reminder cron
- `src/lib/events/event-payments.ts` — payment flows
- `src/lib/events/manage-booking.ts` — refund logic
- `src/lib/events/waitlist-offers.ts` — waitlist offer logic
- `supabase/migrations/20260528000000_event_seo_keyword_engine.sql` — CRUD RPCs
- `supabase/migrations/20260421000002_event_table_invariants.sql` — booking/payment RPCs
- `supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql` — latest booking RPC
- `supabase/migrations/20260604000000_sync_event_start_datetime_trigger.sql` — sync trigger
- `supabase/migrations/20251123120000_squashed.sql` — FK constraints, past-date trigger
- All FK cascade relationships traced through migrations
- Live DB queried for capacity and payment_mode data (29 events with capacity, 17 with cash_only)

### Not Inspected
- Stripe webhook handler (partially inspected for D09 only)
- All test files (listed for impact, not read in full)
- Brand site codebase (external)

### Limited Visibility
- Live DB query results for capacity/payment_mode are point-in-time snapshots
- D09 race condition analysis is theoretical — no reproduction attempted

---

## Executive Summary

The spec correctly identifies 18 real defects. All are traceable to concrete code paths. However, **several fixes are under-specified or unsafe as proposed**, and one defect (D06) is worse than described — admin edits actively erase capacity data on 29 live events. The spec needs 12 revisions before implementation is safe.

---

## What Appears Solid

- **D01/D02/D03 diagnoses are correct** — no event-level cancellation cascade exists, deletion is unsafeguarded, and date changes have zero downstream effects. All confirmed by Codex.
- **D05 duplication analysis is accurate** — phase ordering, SMS opt-out, error handling divergences all verified.
- **D08 diagnosis correct** — hold expiry cron sends no notifications.
- **D16/D17/D18 diagnoses correct** — console.error, duplicated rollback, and swallowed marketing errors all verified.
- **Trigger fix (start_datetime sync) is working correctly** — BEFORE trigger, correct edge case handling, no conflicts with RPCs.
- **Implementation priority ordering is sound** — D03 → D01/D02 → structural → polish is correct.

---

## Critical Spec Revisions Required

### CR-1: D06 is CRITICAL, not High — Admin Edits Actively Erase Capacity (AB-001)
The spec says capacity is "not editable." The reality is worse: **every admin edit overwrites capacity to NULL** because `prepareEventDataFromFormData()` hardcodes `capacity: null` and sends it to the RPC. 29 events in the live DB have non-null capacity. This is an active data corruption bug, not a missing feature.

**Spec must:** Elevate D06 to Critical/Tier 1. Immediate hotfix: stop sending `capacity` in the update payload unless the admin explicitly changes it. Then add the UI field.

### CR-2: D03 Reschedule SMS Cannot Be Synchronous (AB-006)
The spec proposes sending reschedule SMS in the `updateEvent()` action. But this is a synchronous server action — a heavily-booked event (200+ bookings) would turn "Save" into a multi-second operation hitting Twilio for each booking. Repeated date edits would spam customers.

**Spec must:** Require async/background dispatch for reschedule notifications. Options: Vercel `waitUntil`, a dedicated background job, or a queue. Also add deduplication — if the date is changed twice within 5 minutes, only the latest date should be sent.

### CR-3: D09 Recovery is Unsafe — Can Overbook (AB-005, SPEC-009)
Auto-reviving expired bookings in the payment RPC is dangerous. After hold expiry, the seat may have been given to a waitlist customer. Capacity accounting excludes expired rows. Recovery without re-checking capacity can overbook.

**Spec must:** Replace auto-recovery with: (1) accept the payment, (2) check capacity, (3) if seats available → confirm booking, (4) if not → mark as `requires_manual_review` and alert admin. Include automatic Stripe refund if no seat is available.

### CR-4: D01 Refund Scope Underspecified (SPEC-001)
`processEventRefund()` only targets the latest successful charge. But a booking can have multiple charges (initial + seat increase). The spec doesn't address multi-charge refunds.

**Spec must:** Define whether event cancellation refunds ALL charges or just the latest. Recommendation: refund all charges linked to the booking.

### CR-5: D03 Manage Token Must Be Freshly Generated (SPEC-003)
The spec says "include manage link if available." But existing tokens may have expired. The spec must require generating a fresh manage-booking token for each reschedule notification SMS.

### CR-6: D03 Hold Recalculation Must Update Both Tables + Payment Tokens (SPEC-003)
The spec mentions updating `hold_expires_at` but doesn't specify that both `bookings.hold_expires_at` AND `booking_holds.expires_at` need updating. Also, payment guest tokens (used for the payment link) have their own expiry computed from the old event start — these diverge if not also updated.

### CR-7: D11 Past-Date Validation Already Exists in DB (Repo Reality Mapper)
The spec proposes adding past-date validation. But a DB trigger `check_event_date_not_past()` already exists (`squashed.sql:198`). The real gap is app-side error surfacing, not validation absence. The spec should fix the Zod refine AND surface the DB trigger's error message.

### CR-8: D15 Validator Architecture Doesn't Support Warning/Info (SPEC-015)
`getPublishValidationIssues()` returns `string[]` (blocking issues). Adding warning/info levels requires changing the return type. Also, flagging NULL capacity as a warning contradicts D06 where NULL means "unlimited."

**Spec must:** Either change the validator to return `{ errors: string[], warnings: string[] }` or keep it blocking-only and skip the capacity warning.

### CR-9: D07 Requires Type System Updates (Repo Reality Mapper)
The hand-written `Event` type in `src/types/database.ts` omits `payment_mode`. Adding it to the form requires updating both the service input types AND the hand-written Event interface.

### CR-10: D05 Is Not a Simple Refactor (AB-007)
The admin action has specific behaviours the service doesn't support: duplicate customer detection (`23505` → `customer_conflict`), different token creation order, `cash_only` SMS variant. A straight delegation would change error handling, token URLs, and SMS content.

**Spec must:** Define a migration path — either enhance the service to accept admin-specific params, or do a phased refactor where behaviours are aligned one at a time.

### CR-11: `src/lib/sms/templates.ts` Referenced But Doesn't Exist (Spec Trace Auditor)
The spec references this file for new templates (reschedule, cancellation). The file was proposed in the previous SMS pipeline spec but was deferred. The spec must either create it or specify where the new templates go.

### CR-12: D04 Needs New Data Loader (AB-008)
The edit page only loads event + categories. Booking counts are loaded on the detail page. The spec's confirmation dialog requires a new data fetch — either in the edit page loader or as a client-side API call before submit.

---

## Security & Data Risks

### SEC-1: D02 Deletion Safeguard Bypassable (High)
RLS grants `DELETE` on `events` to authenticated users with `events:delete` permission. Even if the app blocks deletion, direct Supabase access or any future API route could bypass it. The safeguard should also exist at the DB level (e.g., a trigger that blocks deletion when active bookings exist).

### SEC-2: D01 Ships Before D04 — Accidental Mass Cancellation Risk (High)
The spec schedules the destructive mass-cancel/refund flow (D01) before the confirmation UX (D04). An admin could accidentally cancel a live event with no undo. Once Stripe refunds are issued, reversal is manual at best.

**Spec must:** Either ship D04 (confirmation dialog) first, or add a mandatory `--confirm` style safeguard to the cancel action itself (e.g., requiring the admin to type the event name).

### SEC-3: D09 Recovery SQL References Wrong Column (High)
The spec's recovery SQL checks `cancelled_at`, but the hold expiry cron writes `expired_at`, not `cancelled_at`. The recovery branch would never fire as written. Also, Stripe checkout sessions can outlive the hold by up to 31 minutes, making intentional late payment plausible as an abuse vector.

### SEC-4: Refund Function Partially Idempotent (Medium)
`processEventRefund()` uses Stripe idempotency keys (preventing double external refunds) but has no DB uniqueness constraint on refund rows. Two concurrent cancel attempts can create duplicate local refund records.

### SEC-5: Mass SMS Rate Limits (Medium)
`sendSMS()` has global limits of 120/hour and 3/hour per recipient. Large events (200+ bookings) will only partially notify unless work is queued across multiple cron cycles. Also, the dedupe context doesn't include old/new dates — a date-change-then-revert could suppress the corrective SMS.

### SEC-6: payment_mode Needs App-Layer Enum Validation (Medium)
Adding `payment_mode` to the form without Zod enum validation means invalid values would only be caught by the DB constraint. Add explicit validation.

### SEC-7: booking_holds Status Changes Not Audit-Logged (Medium)
Hold status transitions (active → released/expired/consumed) have no dedicated audit trail beyond `updated_at`. Weakens incident investigation for payment disputes.

### Data Integrity Emergency (AB-001 + SEC confirmed)
- 29 events with capacity being silently erased on every admin edit
- 17 events with `cash_only` payment_mode being silently erased
- D09 recovery SQL references wrong column (`cancelled_at` vs `expired_at`)

---

## Recommended Fix Order (Revised)

1. **HOTFIX D06** — Stop erasing capacity on event edits (remove `capacity: null` from `prepareEventDataFromFormData`, same for payment_mode). This is actively corrupting live data.
2. **D03** — Event reschedule notification (async, with deduplication)
3. **D01** — Event cancellation cascade (with multi-charge refund handling)
4. **D02** — Event deletion safeguards
5. **D06 full** — Add capacity field to UI
6. **D07** — Add payment_mode to UI (with type system updates)
7. **D04** — UI warning (with new data loader)
8. **D05** — Admin booking consolidation (phased, not big-bang)
9. **D08** — Hold expiry notification (with batching/cost controls)
10. **D09** — Payment race condition (safe recovery with capacity check)
11. **D10-D18** — Remaining polish items

---

## Follow-Up Review Required

- After D06 hotfix: verify live events retain their capacity values after admin edits
- After D01: verify refunds process correctly for multi-charge bookings
- After D03: verify async dispatch doesn't duplicate SMS on repeated edits
- After D09: verify recovery path respects capacity limits
