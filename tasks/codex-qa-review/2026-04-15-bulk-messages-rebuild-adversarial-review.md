# Adversarial Review: Bulk Messages Page Rebuild

**Date:** 2026-04-15
**Mode:** Spec Compliance (Mode C)
**Engines:** Codex (6 reviewers)
**Scope:** `docs/superpowers/specs/2026-04-15-bulk-messages-rebuild-design.md`
**Spec:** Ground-up rebuild of `/messages/bulk` page

## Inspection Inventory

### Inspected
- Spec document and reality map
- Current page: `src/app/(authenticated)/messages/bulk/page.tsx` (790 lines)
- Current API route: `src/app/api/messages/bulk/customers/route.ts`
- Send infrastructure: `src/app/actions/sms-bulk-direct.ts`, `src/app/actions/job-queue.ts`, `src/lib/sms/bulk.ts`
- SMS safety: `src/lib/sms/safety.ts`, `src/lib/sms/quiet-hours.ts`, `src/lib/sms/name-utils.ts`
- Customer schema: squashed migration + `20260420000003_bookings_v05_foundations.sql`
- Booking schema: squashed + `20260420000025_event_booking_rebook_after_cancel.sql`, `20260606000000_prevent_event_delete_with_active_bookings.sql`
- Category stats: `20260216210000_fix_customer_category_stats.sql`
- Cross-promo RPC: `20260404000002_cross_promo_infrastructure.sql`
- RBAC: `src/types/rbac.ts`, `src/services/permission.ts`, `src/app/actions/rbac.ts`
- UI components: `DataTable.tsx`, `Select.tsx`, `SearchInput.tsx`, `FilterPanel.tsx`, `ConfirmDialog.tsx`, `EmptyState.tsx`
- Navigation: `AppNavigation.tsx`
- Supabase clients: `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`
- Existing tests: `tests/api/bulkCustomersRouteMarketingEligibility.test.ts`
- CLAUDE.md project conventions

### Not Inspected
- Twilio configuration and rate limit thresholds (external service)
- Production customer data distribution

### Limited Visibility Warnings
- Quiet hours deferral behaviour traced through code but not tested against a live Twilio instance

## Executive Summary

The spec correctly identifies and fixes the core bug (global vs event-specific booking count). The server-wrapper + RPC architecture fits the codebase well. However, **the spec introduces a new critical problem**: the fetch layer's eligibility model diverges from the unchanged send pipeline, meaning the UI would show recipients who are silently skipped at send time. Additionally, booking semantics, permission names, and several implementation details don't match the real codebase.

## What Appears Solid

- **Architecture direction is correct.** Server wrapper + client component + SQL RPC replaces a fragile batch-scanning API route. This fits established patterns.
- **The core bug fix is sound.** Using `NOT EXISTS` scoped to the selected event is the right approach.
- **Deleting the API route is safe.** No other code path references it.
- **"Load all" is appropriate** for ~400 customers. No pagination complexity needed.
- **Reusing existing send infrastructure** is the right call — no need to change Twilio/safety/queue logic.
- **ui-v2 components support the proposed UI** — DataTable, ConfirmDialog, EmptyState, SearchInput all exist and fit.

## Critical Risks

### CR-1: Fetch eligibility diverges from send eligibility
**Type:** Spec defect | **Severity:** Critical | **Confidence:** High
**Engines:** All 6 reviewers flagged this

The spec removes `marketing_sms_opt_in` and `sms_status` from the fetch layer, but the unchanged `sendBulkSms()` still rejects customers failing those checks. Result: UI shows recipients who will be silently skipped at send time, breaking the spec's own success criterion ("what you see is what gets sent").

**Fix:** Make the RPC use the same eligibility predicate as the send pipeline. Model it on the existing `get_cross_promo_audience()` RPC which already implements the correct rules: `sms_opt_in = true AND marketing_sms_opt_in = true AND sms_status = 'active' AND mobile_e164 IS NOT NULL`.

### CR-2: SECURITY DEFINER RPC without access controls
**Type:** Security defect | **Severity:** Critical | **Confidence:** High
**Engines:** Security, Assumption Breaker

The spec creates a `SECURITY DEFINER` function without `SET search_path`, without `REVOKE` from public, and without grants. Default privileges in this repo grant execute to `anon` and `authenticated`, making this a direct PII exfiltration endpoint callable from the browser.

**Fix:** Add `SET search_path = public`, `REVOKE ALL ON FUNCTION ... FROM PUBLIC`, and explicit `GRANT EXECUTE` only to `authenticated`. Or better: use admin client in the server action and make the function `SECURITY INVOKER` (non-DEFINER).

### CR-3: Permission check is non-functional
**Type:** Spec defect | **Severity:** Critical | **Confidence:** High
**Engines:** Security, Assumption Breaker, Integration

The pseudo-code calls `await checkUserPermission(...)` but never checks the returned boolean. Additionally, the permission name `messages:create` doesn't exist in the codebase — the correct permission is `messages:send`.

**Fix:** Use `messages:send` for both page access and recipient fetch. Check the boolean return value and fail closed on `false`.

## Spec Defects

### SD-1: Booking semantics undefined
**Type:** Spec ambiguity | **Severity:** High | **Confidence:** High

The RPC's `EXISTS(bookings)` counts all booking rows including cancelled, expired, and reminder-only. The codebase defines "active booking" as `status IN ('pending_payment', 'confirmed') AND is_reminder_only = false`.

**Fix:** Add booking status and reminder-only predicates to all booking checks in the RPC.

### SD-2: Wrong helper function name
**Type:** Spec error | **Severity:** Medium | **Confidence:** High

`getSupabaseServerClient()` doesn't exist. The real helper is `createClient()` from `src/lib/supabase/server.ts`.

### SD-3: Wrong file reference for enqueueBulkSMSJob
**Type:** Spec error | **Severity:** Medium | **Confidence:** High

`enqueueBulkSMSJob` is in `src/app/actions/job-queue.ts`, not `sms-bulk-direct.ts`.

### SD-4: Empty state contradiction
**Type:** Internal contradiction | **Severity:** Medium | **Confidence:** High

The spec says "Apply filters to find recipients" when no filters are applied, but also defaults SMS opt-in to "Opted In" (which is a filter) and says "all filters cleared shows all opted-in customers". These contradict each other.

**Fix:** Auto-load default eligible recipients on page load. Remove the "apply filters" empty state.

### SD-5: Invalid mobile number edge case contradicts success criteria
**Type:** Internal contradiction | **Severity:** Medium | **Confidence:** High

The edge case table says "Customer has mobile but it's invalid — Still shown" but the success criteria says "Only customers with a valid mobile number appear". 

**Fix:** Exclude unsendable numbers at the RPC level using `mobile_e164 IS NOT NULL`.

## Workflow & Failure-Path Defects

### WF-1: No request cancellation for filter changes
**Type:** Race condition | **Severity:** Critical | **Confidence:** High

The spec adds 300ms debounce but no `AbortController` or request sequencing. A slow RPC response can arrive after a newer filter change and overwrite the recipient list with stale data. The user could then send to the wrong audience.

**Fix:** Use `AbortController` or a request counter to ensure only the latest response is applied.

### WF-2: Selection not cleared on filter change
**Type:** Stale state | **Severity:** Medium | **Confidence:** High

The spec doesn't specify that selection resets when filters change. If a user selects recipients, changes filters, and the list updates, selected IDs may no longer be in the visible set.

**Fix:** Clear selection on every filter change (matching current page behaviour).

### WF-3: Quiet hours — no UI warning
**Type:** Missing feature | **Severity:** High | **Confidence:** High

Backend defers messages during 21:00-09:00 London time, but the UI says "sent successfully" immediately. User has no indication messages are deferred.

**Fix:** Check current London time client-side. If in quiet hours, show warning: "Messages will be delivered after 9:00 AM". Adjust success copy to "scheduled" instead of "sent".

### WF-4: Partial send failure not modelled
**Type:** Missing spec | **Severity:** Medium | **Confidence:** Medium

The spec mentions partial failure toast but doesn't model fatal aborts after partial delivery (where some SMS were already sent). The queue path is worse — only reports "queued" with no later failure feedback.

**Fix:** Add note that partial delivery is possible and the UI should never offer "retry all" after a partial send.

## Security & Data Risks

### SEC-1: Recipient fetch not rate-limited
**Type:** Missing control | **Severity:** Medium | **Confidence:** Medium

The send path has rate limiting but the recipient fetch does not. This endpoint returns PII (mobile numbers).

**Fix:** Add a light user-scoped rate limiter to the fetch action.

### SEC-2: No audit trail for list access
**Type:** Missing control | **Severity:** Medium | **Confidence:** Medium

Send actions log via audit, but recipient list access is not logged. No record of who queried what customer data.

**Fix:** Log fetch events with user_id, filter params, and result count (not raw phone numbers).

### SEC-3: Search wildcards not escaped
**Type:** Minor | **Severity:** Low | **Confidence:** High

`%` and `_` in search input act as SQL wildcards in the ILIKE. Not an injection risk (parameterised), but could return unexpected results.

**Fix:** Escape `%`, `_`, `\` in the search parameter before passing to RPC.

## Architecture & Integration

### AI-1: Send action branching needs simplification
**Type:** Architecture | **Severity:** Low | **Confidence:** Medium

`sendBulkSMSDirect` already self-queues for >100 recipients. Having the client also branch to `enqueueBulkSMSJob` creates two different queueing strategies. 

**Fix:** Use a single server entry point that decides queue strategy internally.

### AI-2: No searchable combobox in ui-v2
**Type:** Implementation gap | **Severity:** Medium | **Confidence:** High

The spec requires a searchable event select but `ui-v2` only has native `Select`. Need to build a custom combobox or relax to plain select.

**Fix:** For ~200 events, a plain `Select` with good ordering (most recent first) may suffice. Budget a custom combobox only if plain select is unusable.

## Recommended Fix Order

1. **CR-1** — Align RPC eligibility with send pipeline (blocks correctness)
2. **CR-2** — Secure the RPC function (blocks deployment)
3. **CR-3** — Fix permission model (blocks deployment)
4. **SD-1** — Define booking semantics (blocks correctness)
5. **WF-1** — Add request cancellation (blocks correctness)
6. **SD-4, SD-5** — Resolve contradictions (blocks implementation clarity)
7. **WF-3** — Add quiet hours warning (blocks UX correctness)
8. **SD-2, SD-3** — Fix references (editorial)
9. **WF-2** — Clear selection on filter change
10. **SEC-1, SEC-2** — Rate limiting and audit (post-launch hardening)
11. **AI-1, AI-2** — Architecture simplification

## Follow-Up Review Required

- [ ] CR-1: Re-review RPC eligibility after changes — must match `sendBulkSms()` exactly
- [ ] CR-2: Re-review RPC security after adding REVOKE/grants
- [ ] WF-1: Verify request cancellation works with rapid filter changes
