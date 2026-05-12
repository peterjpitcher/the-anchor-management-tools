# Claude Hand-Off Brief: Private Bookings Remediation Spec

**Generated:** 2026-05-11
**Review mode:** C (Spec Compliance)
**Overall risk:** High (3 blocking findings require spec revision before implementation)

## DO NOT REWRITE

- D4 server-side ALLOWED_TRANSITIONS enforcement in updateBooking() — structurally correct
- D1 hold_expiry = null for TBD bookings — correctly prevents cron cancellation
- D13 deposit guard extension to completed status — correct and complete
- D12 server-side immutability guard concept — correct approach
- Implementation ordering (status guards → TBD → downstream) — correct dependency chain
- ALLOWED_TRANSITIONS in types.ts — matches existing convention for that file

## SPEC REVISION REQUIRED

- [ ] **CR-1 (Group A, D4):** Status changes via edit form must delegate to the canonical handler. When `updateBooking()` detects a transition to `cancelled`, call `cancelBooking()` instead of applying the raw status update. When transitioning to `completed`, trigger completion side effects (SMS, audit). The edit form must not be a "silent" status change path that skips SMS, calendar, and financial-outcome resolution. Amend the D4 spec to route status changes through the existing handlers rather than just validating and applying.

- [ ] **CR-2 (Group B, D1):** TBD SMS detection must check `booking.date_tbd === true` as the primary signal, with `internal_notes.includes(DATE_TBD_NOTE)` as fallback only. The `sendCreationSms()` booking fetch must select the `date_tbd` column. Amend the D1 code snippet to: `const isTbd = booking.date_tbd === true || booking.internal_notes?.includes(DATE_TBD_NOTE);`

- [ ] **CR-3 (Group A, D4/D12):** Remove the D4 acceptance criterion "Edit form for a completed booking shows only Completed" — it contradicts D12's redirect. The canonical behaviour is: completed/cancelled bookings redirect from edit page; status transitions for cancelled bookings happen via the detail page's status action. Verify that `PrivateBookingDetailClient.tsx` exposes a status-change control for cancelled bookings.

- [ ] **ID-1 (Group B, D1):** Change `balanceDueDate = balanceDueDate || null` to `balanceDueDate = null` (unconditional) in the TBD branch. TBD bookings must not have a balance due date.

- [ ] **ID-2 (Group A, D12):** Amend the immutable-booking guard to filter out keys where value is `undefined` or matches the current booking. Replace `Object.keys(input).filter(k => k !== 'status')` with a check that only flags keys whose value is defined AND differs from `currentBooking`.

- [ ] **ID-3 (Group B, D1):** Add a subsection listing all `event_date` consumers: contract generation, calendar view, scheduled SMS preview, payment emails (deposit + balance), balance reminder cron, detail page display. Note which ones need TBD-aware formatting.

## ASSUMPTIONS TO RESOLVE

- [ ] **U-1:** Confirm both manual and PayPal deposit paths call `finalizeDepositPaymentWithClient()`. Trace: `privateBookingActions.ts` deposit action → `payments.ts`. Trace: PayPal capture webhook/action → `payments.ts`.
- [ ] **U-2:** Confirm `PrivateBookingDetailClient.tsx` has a status-change control that works on cancelled bookings and calls `updateBookingStatus()`.
- [ ] **U-3:** Grep for all status-update paths: `grep -rn "status.*cancelled\|status.*completed\|\.update.*status" src/services/private-bookings/ src/app/actions/privateBookingActions.ts` to confirm no third path bypasses transition validation.
- [ ] **U-4:** Check whether `sendCreationSms()` receives `date_tbd` in its booking object. If not, add it to the select query.

## REPO CONVENTIONS TO PRESERVE

- Domain constants (hold days, transition maps) live in `src/services/private-bookings/types.ts` alongside type definitions
- SMS side effects use `SmsQueueService.queueAndSend()` with idempotency via trigger_type + template_key
- Non-blocking side effects (email, calendar) use `.catch()` error swallowing with `logger.error()`
- Status guards in payment functions throw descriptive errors, not return objects
- Cron routes use `createAdminClient()` (service role) and `authorizeCronRequest()` for auth

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-1:** Re-review after status-change delegation is implemented — verify cancellation via edit form triggers all side effects
- [ ] **Groups C–L:** Full implementation review needed — these groups were not visible to Codex due to pack truncation
- [ ] **D9 migration:** Review the generated-column DROP/ADD migration against the view recreation and existing data

## REVISION PROMPT

Apply these amendments to `tasks/private-bookings-review/remediation-spec.md`:

1. In Group A / D4, replace the status validation snippet with delegation logic: if `input.status === 'cancelled'` and `currentBooking.status !== 'cancelled'`, call `cancelBooking(id, 'Status changed via edit form', performedByUserId)` and return. If `input.status === 'completed'` and `currentBooking.status !== 'completed'`, trigger completion side effects. Remove `status` from the `updatePayload` for these transitions.

2. In Group A / D4 acceptance criteria, remove "Edit form for a completed booking shows only Completed". Replace with "Completed/cancelled bookings redirect from the edit page to the detail page (per D12)".

3. In Group A / D12, change the immutable guard to: `const changedKeys = Object.keys(input).filter(k => k !== 'status' && input[k] !== undefined && input[k] !== currentBooking[k]);`

4. In Group B / D1 SMS fix, change the isTbd check to: `const isTbd = booking.date_tbd === true || booking.internal_notes?.includes(DATE_TBD_NOTE);` and add `date_tbd` to the sendCreationSms booking fetch.

5. In Group B / D1 TBD branch, change `balanceDueDate = balanceDueDate || null` to `balanceDueDate = null`.

6. In Group B / D1, add a new subsection: "event_date consumer audit" listing contract-template.ts, CalendarView.tsx, scheduled-sms.ts, payment emails, balance reminder cron, detail page display — noting which need TBD-aware formatting.
