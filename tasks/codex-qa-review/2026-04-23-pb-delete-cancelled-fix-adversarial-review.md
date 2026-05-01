# Adversarial Review: Private Booking Delete — Cancelled Booking Fix

**Date:** 2026-04-23
**Mode:** B (Code Review)
**Scope:** `privateBookingActions.ts`, `mutations.ts`, `20260623000000_allow_delete_cancelled_bookings.sql`
**Pack:** `tasks/codex-qa-review/2026-04-23-pb-delete-cancelled-fix-review-pack.md`
**Reviewers:** Assumption Breaker, Workflow & Failure-Path, Security & Data Risk

## Executive Summary

The three-layer fix (action eligibility, service mutation, DB trigger) is structurally sound and correctly addresses the bug where cancelled bookings with sent SMS were undeletable. The primary concern raised by all three reviewers is the assumption that `status = 'cancelled'` implies "customer already notified". Investigation confirms this holds for all application code paths — the `cancelBooking` service always sends a cancellation SMS. The only gap is direct SQL status updates, which are admin-only operations outside the application.

## What Appears Solid

- All three defence-in-depth layers updated consistently with the same `cancelled` bypass logic
- The DB trigger preserves full protection for non-cancelled bookings
- `ON DELETE CASCADE` on `private_booking_sms_queue.booking_id` prevents orphaned SMS rows (AB-002 resolved)
- Missing booking handled gracefully in eligibility check (returns `canDelete: false`, not an exception)
- No double-submit risk — repeated delete attempts on a deleted record return "not found"
- No new PII exposure, no injection vectors, no client-side-only permission checks

## Implementation Defects

None found. The code is correct for the intended use case.

## Unproven Assumptions

### AB-001 / SEC-001 / SEC-002: `cancelled` ≠ guaranteed notification (Medium risk, accepted)

All three reviewers flagged that `status = 'cancelled'` is trusted as proof of customer notification. Investigation shows:

- **`cancelBooking` service** (mutations.ts:1059) always sends cancellation SMS when contact phone or customer ID exists
- **`StatusModal`** routes through `cancelBooking` for the `cancelled` transition
- **Auto-cancel by system** (deposit deadline) also goes through `cancelBooking`

The only unprotected path would be a direct SQL `UPDATE ... SET status = 'cancelled'` — which requires service-role/admin access. For an internal staff tool behind RBAC, this is an acceptable residual risk.

**Verdict:** Accepted — no code change needed. If stricter guarantees are ever required, the trigger could check for a sent cancellation SMS row rather than trusting status alone.

### WF-001: Deploy ordering (Low risk, accepted)

Application code could deploy before the migration, causing the old DB trigger to reject deletes that the UI now offers. In practice, `supabase db push` runs before Vercel deploys the app. If a race does occur, the user sees a transient error — not data loss.

**Verdict:** Accepted — existing deploy pipeline handles this.

## Minor Observations

- **AB-004:** Changes manifest truncated — this is expected session-setup behaviour, not a regression
- **AB-005:** `supabase/.temp/` version drift — these are local artefacts and should not be committed
- **SEC-003:** Race between SMS approval and delete — closed by the DB trigger which runs in the same transaction as the DELETE

## Recommended Fix Order

No additional code changes required. The fix is ready to ship.
