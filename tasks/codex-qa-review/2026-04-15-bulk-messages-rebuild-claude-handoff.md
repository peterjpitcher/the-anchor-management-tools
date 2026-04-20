# Claude Hand-Off Brief: Bulk Messages Page Rebuild

**Generated:** 2026-04-15
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Critical (3 critical findings require spec revision before implementation)

## DO NOT REWRITE

- **Architecture direction:** Server wrapper + client component + SQL RPC is correct and fits codebase patterns
- **Core bug fix approach:** `NOT EXISTS` scoped to selected event is the right solution
- **API route deletion:** Safe — no other callers reference `src/app/api/messages/bulk/customers/route.ts`
- **"Load all" decision:** Appropriate for ~400 customers, no pagination needed
- **Send infrastructure reuse:** Correct — don't touch `sendBulkSms`, `sendBulkSMSDirect`, or queue logic
- **ui-v2 component choices:** DataTable, ConfirmDialog, EmptyState, SearchInput are the right primitives
- **Filter set:** The 6 filters are appropriate
- **Debounce at 300ms:** Correct approach for filter-triggered fetches
- **Post-send behaviour:** Clear message/selection, keep filters — correct

## SPEC REVISION REQUIRED

- [ ] **SPEC-1: Align RPC eligibility with send pipeline.** The spec currently uses only `sms_opt_in` + `mobile_number IS NOT NULL`. It must use: `sms_opt_in = true AND marketing_sms_opt_in = true AND (sms_status IS NULL OR sms_status = 'active') AND mobile_e164 IS NOT NULL`. Model this on the existing `get_cross_promo_audience()` RPC in `supabase/migrations/20260404000002_cross_promo_infrastructure.sql:58-77`. Return `mobile_e164` instead of `mobile_number` for display.

- [ ] **SPEC-2: Define booking semantics.** Replace bare `EXISTS(bookings WHERE event_id = ...)` with `EXISTS(bookings WHERE event_id = ... AND status IN ('pending_payment', 'confirmed') AND COALESCE(is_reminder_only, false) = false)`. Apply the same predicate to `last_booking_date` and category filter. This matches the established active-booking definition used across the codebase.

- [ ] **SPEC-3: Fix permission model.** Replace `messages:create` with `messages:send` everywhere (page wrapper, fetch action, send action). Check the boolean return from `checkUserPermission()` and return `{ error: 'Unauthorized' }` on false.

- [ ] **SPEC-4: Secure the RPC function.** Add `SET search_path = public` to the function definition. Add `REVOKE ALL ON FUNCTION get_bulk_sms_recipients FROM PUBLIC` and `GRANT EXECUTE ON FUNCTION get_bulk_sms_recipients TO authenticated` after creation. Schema-qualify all table references (`public.customers`, `public.bookings`, `public.events`).

- [ ] **SPEC-5: Add request cancellation.** Specify that filter changes must use `AbortController` (or a request counter) to discard stale RPC responses. Only the latest response should update the recipient list.

- [ ] **SPEC-6: Clear selection on filter change.** Add explicit requirement: every filter change clears the current selection before loading new recipients.

- [ ] **SPEC-7: Resolve empty state contradiction.** Remove "Apply filters to find recipients" empty state. Default behaviour: auto-load all eligible recipients on page mount (with default `smsOptIn = 'opted_in'`). Empty state only shows when filters return zero results: "No customers match these filters".

- [ ] **SPEC-8: Fix invalid mobile edge case.** Remove the edge case row about invalid mobiles being shown. With `mobile_e164 IS NOT NULL` in the RPC, only sendable numbers appear.

- [ ] **SPEC-9: Add quiet hours warning.** When current London time is between 21:00 and 09:00, show a warning banner above the send button: "Messages sent now will be delivered after 9:00 AM". Change success toast to "Messages scheduled" instead of "sent" during quiet hours.

- [ ] **SPEC-10: Fix implementation references.** Replace `getSupabaseServerClient()` with `createClient()`. Move `enqueueBulkSMSJob` reference from `sms-bulk-direct.ts` to `src/app/actions/job-queue.ts`.

- [ ] **SPEC-11: Simplify send entry point.** Instead of client-side branching between two actions, use a single `sendBulkMessages` server action that internally decides direct vs queue based on recipient count. This avoids exposing the queue threshold to the client.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1:** `supabase/migrations/YYYYMMDDHHMMSS_add_bulk_sms_recipients_rpc.sql` — Write the RPC with full eligibility predicate, active booking semantics, SET search_path, REVOKE/GRANT, and escaped search wildcards.

- [ ] **IMPL-2:** `src/app/actions/bulk-messages.ts` — New server action using `createClient()`, checking `messages:send`, calling the RPC, returning `{ data } | { error }` (not throwing — match repo convention).

- [ ] **IMPL-3:** `src/app/(authenticated)/messages/bulk/page.tsx` — Rewrite as server component: auth check, permission check (`messages:send`), fetch events + categories, pass as props to `BulkMessagesClient`.

- [ ] **IMPL-4:** `src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx` — Full client component with: filter panel, debounced fetch with AbortController, DataTable with selection, compose panel with preview, ConfirmDialog for send confirmation, quiet hours warning, post-send feedback.

- [ ] **IMPL-5:** Delete `src/app/api/messages/bulk/customers/route.ts` after migration.

- [ ] **IMPL-6:** Update or remove `tests/api/bulkCustomersRouteMarketingEligibility.test.ts` — replace with tests for the new server action.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** SMS opt-in filter "All" — should this show customers with `sms_opt_in = false`? The send pipeline will reject them, making "All" misleading. Consider renaming to "All Eligible" or removing the "All" option entirely. -> Ask: Peter, should the "All" SMS filter option include non-opted-in customers (who can't be sent to), or should it always be limited to sendable customers?

- [ ] **ASM-2:** Event dropdown scope — should cancelled/draft/completed events appear in the dropdown? Currently all events are shown. -> Ask: Should the event dropdown show all events (including past/cancelled) for retrospective messaging, or only future/active events?

- [ ] **ASM-3:** Searchable combobox — `ui-v2` doesn't have one. A plain `<Select>` ordered by date (most recent first) may be sufficient for ~200 events. -> Ask: Is a plain dropdown ordered by most recent first acceptable, or do you need type-to-search?

## REPO CONVENTIONS TO PRESERVE

- Server actions return `{ data } | { error }` objects, not thrown exceptions
- Supabase server helper is `createClient()` from `src/lib/supabase/server.ts`
- Admin client is `createAdminClient()` from `src/lib/supabase/admin.ts`
- Permission check via `checkUserPermission('module', 'action', userId)`
- New pages must use `PageLayout` from `ui-v2`
- Navigation stays as-is — `/messages/bulk` is accessed via `/messages` page CTA
- Newer SECURITY DEFINER functions use `SET search_path = public`
- Active booking = `status IN ('pending_payment', 'confirmed') AND is_reminder_only = false`

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1: Re-review RPC eligibility predicate — must exactly match `sendBulkSms()` checks in `src/lib/sms/bulk.ts:243-276`
- [ ] CR-2: Re-review RPC security — verify REVOKE/GRANT and search_path are correct
- [ ] WF-1: Verify AbortController/request cancellation works with rapid filter toggling
- [ ] SD-1: Verify booking predicate matches `get_cross_promo_audience()` active booking logic

## REVISION PROMPT

You are revising the bulk messages rebuild spec based on an adversarial review.

Apply these changes to `docs/superpowers/specs/2026-04-15-bulk-messages-rebuild-design.md` in order:

1. **RPC eligibility:** Replace the WHERE clause with the full send-pipeline predicate: `sms_opt_in = true AND marketing_sms_opt_in = true AND (sms_status IS NULL OR sms_status = 'active') AND mobile_e164 IS NOT NULL`. Return `mobile_e164` as the phone column.

2. **Booking semantics:** Add `AND b.status IN ('pending_payment', 'confirmed') AND COALESCE(b.is_reminder_only, false) = false` to all booking EXISTS subqueries and the last_booking_date subquery.

3. **RPC security:** Add `SET search_path = public` to the function. Add REVOKE/GRANT statements after the function. Schema-qualify all table references.

4. **Permissions:** Replace all `messages:create` with `messages:send`. Replace all `messages:view` with `messages:send`. Add boolean check on `checkUserPermission` result.

5. **Server action pattern:** Change `fetchBulkRecipients` to return `{ data } | { error }` instead of throwing. Use `createClient()` not `getSupabaseServerClient()`.

6. **Fix file reference:** Move `enqueueBulkSMSJob` reference to `src/app/actions/job-queue.ts`.

7. **Request cancellation:** Add requirement for AbortController or request counter in filter-change handling.

8. **Selection reset:** Add requirement to clear selection on every filter change.

9. **Empty state:** Remove "Apply filters" state. Auto-load on mount with default smsOptIn filter.

10. **Quiet hours:** Add warning banner and adjusted success copy during 21:00-09:00 London time.

11. **Remove invalid mobile edge case.** With `mobile_e164 IS NOT NULL`, unsendable numbers never appear.

12. **Escape search wildcards:** Note that `%`, `_`, `\` should be escaped in p_search before ILIKE.

After applying changes, confirm:
- [ ] All spec revisions applied
- [ ] RPC eligibility matches `sendBulkSms()` exactly
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for human review (ASM-1, ASM-2, ASM-3)
