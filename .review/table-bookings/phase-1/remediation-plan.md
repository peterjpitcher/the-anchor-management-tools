# Remediation Plan — Table Bookings / FOH / BOH
Date: 2026-03-11

## Confirmed Business Rules

- DR-001: Party size reductions free until 3 days before booking, then charged at per-head rate ✓
- DR-002: Late cancellation (<3 days): keep deposit if one was collected; no charge if no deposit ✓
- DR-003: FOH party size limit = 20. Managers (BOH) have no limit ✓
- DR-004: Per-head fee capped at committed_party_size × fee_per_head ✓
- Walkout: Staff AND managers can perform ✓
- manager@the-anchor.pub: Shared FOH kiosk account — staff-level permissions, not manager ✓
- BOH: Managers can do everything without restriction ✓

---

## Implementation Order

Dependencies must be respected: fix RBAC first, then the permission-dependent fixes, then the Stripe/state fixes.

---

### PR-1: RBAC fix — grant staff `table_bookings:edit` (CRITICAL — C-001)

**What**: Add `table_bookings:edit` permission to the `staff` role in the role_permissions table.
**Why**: Staff currently cannot perform any FOH status actions (seated, left, no-show, cancel, walkout, party-size, move-table). The FOH view is non-functional for staff.
**Files**:
- New migration: `supabase/migrations/YYYYMMDD_grant_staff_table_bookings_edit.sql`
  ```sql
  INSERT INTO role_permissions (role, module, action)
  VALUES ('staff', 'table_bookings', 'edit')
  ON CONFLICT DO NOTHING;
  ```
**Notes**: `manager@the-anchor.pub` account must already be on `staff` role. Verify this before deploying.
**Risk**: Low — only adds permissions, doesn't remove any.

---

### PR-2: Lock preorder editing to managers only (CRITICAL — C-002)

**What**: Change BOH preorder POST endpoint permission check from `table_bookings:edit` to `table_bookings:manage`.
**Why**: After PR-1, staff have `edit`. The preorder edit endpoint must be manager-only (`manage` permission).
**Files**:
- `src/app/api/boh/table-bookings/[id]/preorder/route.ts` — line 31: change `requireFohPermission('edit')` to `requireFohPermission('manage')`
- `src/app/(authenticated)/table-bookings/[id]/page.tsx` — confirm `canEdit` prop passed to PreorderTab only passes `true` if user has `table_bookings:manage`
- `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx` — no change needed (already gates on `canEdit`)
**Depends on**: PR-1 (establishes the permission split)

---

### PR-3: Fix no-show → seated state transition (CRITICAL — C-003)

**What**: When action is 'seated' and booking is currently 'no_show', also reset `status` to 'confirmed'.
**Why**: Clearing `no_show_at` without resetting `status` leaves booking in a permanently locked closed state.
**Files**:
- `src/lib/table-bookings/staff-status-actions.ts:100-116` — in the seated plan builder, add `status: 'confirmed'` to the update when current status is 'no_show'

---

### PR-4: Expire Stripe checkout on cancellation (CRITICAL — C-004)

**What**: Before cancelling a booking in `pending_payment` state, expire the Stripe checkout session.
**Why**: Active Stripe session can be completed by guest after booking is cancelled — orphaned payment.
**Files**:
- `src/app/api/foh/bookings/[id]/cancel/route.ts` — add check for `pending_payment`, retrieve Stripe session ID from payments table, call `stripe.checkout.sessions.expire(sessionId)` before status update
- Same check needed in BOH cancel/delete path: `src/app/api/boh/table-bookings/[id]/route.ts` (DELETE handler)

---

### PR-5: Add idempotency to charge approvals (CRITICAL — C-005)

**What**: Before creating a Stripe payment intent for charge approval, check if a non-failed intent already exists for this charge_request.
**Why**: Concurrent approval clicks create duplicate Stripe charges.
**Files**:
- `src/lib/table-bookings/charge-approvals.ts:300-642` — before Stripe intent creation, query DB for existing `stripe_payment_intent_id` on this charge_request; if found and not failed, return it instead of creating new

---

### PR-6: Add venue event deposit exemption (CRITICAL — C-006)

**What**: Automatically exempt venue-hosted events from deposit requirements.
**Why**: Currently no code exists for this. Staff must manually `waive_deposit`, which is error-prone.
**Files**:
- `src/app/api/foh/bookings/route.ts:88-99` — add event exemption check in deposit validation logic
- Need to determine: what identifies a venue-hosted event (event_id present? booking_purpose flag? specific event type?) — read existing event/booking schema to confirm correct field
**Note**: Requires minor investigation of event schema before implementing.

---

### PR-7: Fix FOH preorder capture-now silent failure (CRITICAL — C-007)

**What**: Return explicit error/warning when `capture_now` preorder save fails during booking creation.
**Why**: Current code returns 200 and reports `sunday_preorder_state: 'captured'` even when save failed.
**Files**:
- `src/app/api/foh/bookings/route.ts:1356-1406` — validate `captureResult?.state === 'saved'` and return distinct state in response when it isn't; add audit log entry for failure

---

### PR-8: Transaction-safe preorder save (HIGH — H-001)

**What**: Wrap preorder item delete + insert in a Supabase RPC or transaction to prevent race conditions.
**Why**: Two concurrent saves corrupt each other (DELETE from both, then INSERT from both = duplicate/lost items).
**Files**:
- `src/lib/table-bookings/sunday-preorder.ts:493-526` — use Supabase RPC that does delete+insert atomically, or add optimistic lock on `updated_at`

---

### PR-9: Stripe refund + DB atomicity (HIGH — H-002, H-003)

**What**: Handle partial failure in both refund and checkout session persistence.
**H-002 (Refund)**: If Stripe refund succeeds but DB update fails, log to audit_events tied to booking. Add reconciliation check.
**H-003 (Checkout)**: If Stripe session created but DB insert fails, don't return success. Return error.
**Files**:
- `src/lib/table-bookings/refunds.ts:34-75`
- `src/lib/table-bookings/bookings.ts:511-658`

---

### PR-10: Audit preorder overrides + SMS failures (HIGH — H-004, H-005)

**What**: Log to audit_events when (a) a manager overrides a preorder, (b) an SMS send fails.
**Files**:
- `src/app/api/boh/table-bookings/[id]/preorder/route.ts` — add audit event on save with `is_staff_override: true`
- `src/lib/table-bookings/bookings.ts` (SMS functions) — wrap sends and log failures to audit_events with booking_id

---

## Medium items (follow-up PR)

- M-001: Return full booking state from status action responses so client resyncs
- M-002: Validate `sunday_preorder_cutoff_at` on write — must not be earlier than booking allows
- M-003: Remove `any` casts from menu loading; return error if menu is incomplete
- M-004: Translate DB constraint 23P01 into "table no longer available" response
- M-005: Add NOT NULL constraint + backfill migration for `committed_party_size`

---

## Summary

| PR | Defects | Risk | Migration? |
|----|---------|------|------------|
| PR-1: RBAC staff edit | C-001 | Low | Yes |
| PR-2: Preorder lock to manage | C-002 | Low | No |
| PR-3: No-show→seated status fix | C-003 | Low | No |
| PR-4: Stripe session expire on cancel | C-004 | Medium | No |
| PR-5: Charge approval idempotency | C-005 | Medium | No |
| PR-6: Event deposit exemption | C-006 | Medium | No |
| PR-7: Capture-now silent failure | C-007 | Low | No |
| PR-8: Preorder transaction safety | H-001 | Medium | Maybe (RPC) |
| PR-9: Stripe atomicity | H-002, H-003 | Low | No |
| PR-10: Audit trail | H-004, H-005 | Low | No |
