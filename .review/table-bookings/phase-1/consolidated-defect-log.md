# Consolidated Defect Log — Table Bookings / FOH / BOH
Generated from: Structural Mapper, Business Rules Auditor, Technical Architect, QA Specialist + RBAC check
Date: 2026-03-11

---

## CRITICAL — Actively wrong, must fix before this section is safe to use

### C-001: Staff cannot use FOH at all — RBAC missing `table_bookings:edit`
**Agents**: Structural Mapper (permission map) + RBAC check
**Root cause**: Staff role has `table_bookings:view` and `table_bookings:create` only. All FOH status action routes (seated, left, no-show, cancel, party-size, move-table) require `table_bookings:edit`. Staff cannot execute any of these.
**Impact**: FOH is manager-only in practice. Staff who try to mark guests as seated or cancel a booking are silently rejected.
**Fix**: Grant `table_bookings:edit` to the `staff` role in the role_permissions table (migration required).
**Files**: RBAC migration (supabase/migrations/), role_permissions table

---

### C-002: Preorder edit not locked to managers — wrong permission on BOH endpoint
**Agents**: Business Rules Auditor (BR-003, BR-011), confirmed by RBAC check
**Root cause**: `/api/boh/table-bookings/[id]/preorder` POST uses `requireFohPermission('edit')` = `table_bookings:edit`. Once C-001 is fixed and staff have `edit`, they can edit preorders. Business rule: only managers can edit.
**Impact**: After C-001 fix, all staff can modify preorders. Financial/service risk.
**Fix**: Change POST permission check to `requireFohPermission('manage')` = `table_bookings:manage` (manager-only).
**Files**: `src/app/api/boh/table-bookings/[id]/preorder/route.ts:31`

---

### C-003: No-show → Seated transition permanently locks booking
**Agent**: Technical Architect (ARCH-014)
**Root cause**: `buildStaffStatusTransitionPlan()` action 'seated' sets `no_show_at: null` but leaves `status: 'no_show'`. Since `no_show` is in `CLOSED_STATUSES`, all subsequent transitions are rejected. Booking is permanently stuck.
**Impact**: If a guest is incorrectly marked no-show and then arrives, the booking cannot be recovered via UI.
**Fix**: When clearing no-show fields via seated action, also set `status: 'confirmed'`.
**Files**: `src/lib/table-bookings/staff-status-actions.ts:100-116` (line 111)

---

### C-004: Cancelling a pending_payment booking leaves Stripe checkout alive
**Agent**: Technical Architect (ARCH-016)
**Root cause**: FOH cancel route (`/api/foh/bookings/[id]/cancel`) doesn't check payment state. A booking in `pending_payment` can be cancelled without invalidating the Stripe checkout session.
**Impact**: Guest receives payment SMS, booking gets cancelled, guest pays anyway. Payment orphaned. No refund triggered.
**Fix**: Check `payment_status` before cancel. If `pending_payment`, expire the Stripe session (via Stripe API expireSession) before completing cancellation.
**Files**: `src/app/api/foh/bookings/[id]/cancel/route.ts`

---

### C-005: Concurrent charge approvals create duplicate Stripe charges
**Agent**: Technical Architect (ARCH-004)
**Root cause**: `attemptApprovedChargeFromDecision()` has no database-level idempotency guard. Two concurrent approval clicks create two Stripe payment intents (different idempotency keys on second attempt), with only the second persisted to DB. Customer charged twice.
**Impact**: Double charge to customer. Financial error requiring manual reconciliation.
**Fix**: Add unique constraint on `charge_requests.stripe_payment_intent_id`. Or check for existing non-failed intent before creating new one.
**Files**: `src/lib/table-bookings/charge-approvals.ts:300-642` (line 466)

---

### C-006: Event deposit exemption logic absent
**Agent**: Business Rules Auditor (BR-007)
**Root cause**: No code path automatically exempts venue-hosted events from deposit requirements. The deposit check at `route.ts:91` only looks at `party_size >= 7` with no event-type check.
**Impact**: Staff must manually use `waive_deposit: true` for every venue event. Prone to error. If forgotten, guests are incorrectly required to pay deposit.
**Fix**: Add explicit check — if booking is for a venue-hosted event (check `event_id` or `booking_purpose` or similar flag), automatically bypass deposit requirement without needing `waive_deposit`.
**Files**: `src/app/api/foh/bookings/route.ts:88-99`

---

### C-007: FOH preorder capture during booking creation silently fails
**Agent**: Business Rules Auditor (BR-002)
**Root cause**: During FOH booking creation with `sunday_preorder_mode: 'capture_now'`, if `captureResult?.state !== 'saved'`, the booking still returns 200 with success. Staff see "booking created" but preorder was not saved.
**Impact**: This is the reported bug ("pre-orders in FOH didn't seem to store"). Staff believe preorder captured; kitchen has no record.
**Fix**: Return a clear warning or error state when capture fails. Do not report `sunday_preorder_state: 'captured'` unless save confirmed. Log failure to audit trail.
**Files**: `src/app/api/foh/bookings/route.ts:1356-1406`

---

## HIGH — Fragile, will break under real-world edge cases

### H-001: Preorder save race condition — DELETE + INSERT without transaction
**Agent**: Technical Architect (ARCH-002)
**Root cause**: `saveSundayPreorderFromPageData()` deletes all items then inserts new ones. Two concurrent saves result in items from one being silently overwritten.
**Fix**: Wrap delete + insert in Supabase transaction, or use upsert with ON CONFLICT.
**Files**: `src/lib/table-bookings/sunday-preorder.ts:493-526`

---

### H-002: Stripe refund not atomic with DB update
**Agent**: Technical Architect (ARCH-007)
**Root cause**: `refundTableBookingDeposit()` issues Stripe refund, then updates DB. If DB update fails, customer receives money but system shows pending_refund. Manager re-issues = double refund.
**Fix**: Log failure on booking's audit trail. Add reconciliation check to detect orphaned Stripe refunds (compare Stripe refunds vs DB status).
**Files**: `src/lib/table-bookings/refunds.ts:34-75`

---

### H-003: Payment persistence failure after Stripe checkout created
**Agent**: Technical Architect (ARCH-011)
**Root cause**: `createTableCheckoutSessionByRawToken()` creates Stripe session, then tries to persist. If persistence fails, returns `state: 'created'` anyway. Guest pays via orphaned session; webhook has no DB record to match.
**Fix**: Do not return success if DB insert fails. Return error. Expire Stripe session.
**Files**: `src/lib/table-bookings/bookings.ts:511-658`

---

### H-004: Staff preorder override not audited
**Agent**: Technical Architect (ARCH-009)
**Root cause**: `staffOverride: true` passed unconditionally in BOH preorder route. No audit event distinguishes customer-submitted from manager-overridden preorders. No timestamp or user ID for override.
**Fix**: Log audit event on override saves: `operation_type: 'preorder.staff_override'`, include user ID. (After C-002 fix, only managers can trigger this path.)
**Files**: `src/app/api/boh/table-bookings/[id]/preorder/route.ts:56` + `src/lib/table-bookings/sunday-preorder.ts`

---

### H-005: SMS/email failures not recorded in audit trail
**Agent**: Technical Architect (ARCH-003, ARCH-017)
**Root cause**: SMS sends are fire-and-forget in multiple places. Failures logged to app logger only, not to `audit_events`. Support cannot confirm which customers received notifications.
**Fix**: Record each SMS send attempt (success/failure) as audit_event tied to `table_booking_id`.
**Files**: `src/lib/table-bookings/bookings.ts` (SMS functions)

---

## MEDIUM — Should fix, lower immediate risk

### M-001: Seated transition not protected against stale concurrent state
**Agent**: Technical Architect (ARCH-005)
Between deposit check and status update, another request could change status. UI shows optimistic success but gets 409 from server. Full booking state should be returned on every response so client resyncs.

### M-002: `sunday_preorder_cutoff_at` DB field can override 24h rule
**Agent**: Business Rules Auditor (BR-001)
If `sunday_preorder_cutoff_at` is set to a time earlier than 24h before booking, the earlier time wins. This is probably intentional but creates inconsistency if the field is set incorrectly. Document the rule explicitly and validate on write.

### M-003: Type-unsafe `any` casts in menu loading
**Agent**: Technical Architect (ARCH-013)
Corrupt menu data causes silent partial menu display. Remove `any` casts, add runtime validation.

### M-004: Table move conflict not surfaced as user-friendly error
**Agent**: Technical Architect (ARCH-008)
DB constraint rejection (23P01) not translated to "table no longer available". Returns generic error.

### M-005: `committed_party_size` nullable — charge calculation uses wrong fallback
**Agent**: Technical Architect (ARCH-012)
NULL `committed_party_size` silently falls back to actual party size. Could calculate wrong charges for legacy bookings.

---

## DISCOVERED RULES (from code, not from owner — verify)

- **DR-001**: Party size reductions charged after 3-day commit window
- **DR-002**: Cancellations within 24h charged a fee
- **DR-003**: Maximum party size 20 people (guest-initiated)
- **DR-004**: Per-head fee cap applies across all charge requests on one booking

---

## Summary

| Severity | Count | Must fix before live? |
|----------|-------|----------------------|
| Critical | 7 | Yes |
| High | 5 | Yes — before edge cases hit |
| Medium | 5 | Soon |
| **Total** | **17** | |
