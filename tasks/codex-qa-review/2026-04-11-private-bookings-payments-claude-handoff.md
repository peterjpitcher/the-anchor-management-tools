# Claude Hand-Off Brief: Private Bookings Payment System

**Generated:** 2026-04-11
**Review mode:** Code Review (Mode B)
**Overall risk assessment:** High

## DO NOT REWRITE

- `PaymentHistoryTable.tsx` — deposit exclusion fix is correct and verified
- `calculate_private_booking_balance()` DB function — correctly excludes deposits
- `private_booking_payments` table schema and constraints — sound
- Balance payment RPC serialisation via `FOR UPDATE` — correct pattern
- Server action auth checks (`manage_deposits`, `manage`) — present and correct
- Payment history synthesis in `getBookingPaymentHistory()` — correct merge of deposit + balance entries
- Deposit/balance storage separation architecture — correct

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **SEC-001 (Critical):** `supabase/migrations/20260514000002_record_balance_payment_rpc.sql` — Add `IF NOT user_has_permission(auth.uid(), 'private_bookings', 'manage_deposits') THEN RAISE EXCEPTION 'Permission denied'; END IF;` inside the RPC body, OR revoke EXECUTE from `authenticated` and grant only to `service_role`
- [ ] **CR-2 (High):** `supabase/migrations/20260502000000_private_booking_payments.sql` (balance function), `20260514000001` (view), `20260514000002` (RPC), `20260319124206` (apply_balance_payment_status) — All four DB functions compute total from `SUM(private_booking_items.line_total)` but ignore booking-level discounts (`discount_type`, `discount_amount`). Must apply the same discount logic as `PrivateBookingDetailClient.tsx:1666-1671`
- [ ] **ID-3 (High):** `src/app/booking-portal/[token]/page.tsx:157` — Customer portal still subtracts deposit from event balance. Align with corrected formula (deposit excluded from balance)
- [ ] **ID-1 (High):** `src/app/actions/privateBookingActions.ts` — After item add/edit/delete (lines ~803, 1149, 1192, 1219) and discount changes, call `apply_balance_payment_status(booking_id)` to reconcile `final_payment_date`
- [ ] **SEC-3 (High):** `src/app/actions/privateBookingActions.ts:1487` — After PayPal capture, verify `captureResult.amount === deposit_amount` and `captureResult.currency === 'GBP'` before marking deposit paid
- [ ] **ID-2 (Medium):** `supabase/migrations/20260514000002_record_balance_payment_rpc.sql:35` — Add `IF p_amount > v_balance_remaining THEN RAISE EXCEPTION 'Amount exceeds remaining balance'; END IF;` after calculating balance
- [ ] **ID-6 (Medium):** `src/services/private-bookings/payments.ts:319` and `PrivateBookingDetailClient.tsx:2419` — Add booking status check: block balance payments for `cancelled` and `completed` bookings
- [ ] **ID-4 (Medium):** `src/app/api/cron/private-booking-monitor/route.ts:646` — Balance reminder uses old formula subtracting deposit. Align with corrected formula
- [ ] **WF-1 (Medium):** `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:1417` — After payment modal success, call `router.refresh()` instead of just `refreshBooking()` to reload `paymentHistory` prop
- [ ] **WF-2 (Medium):** `src/services/private-bookings/payments.ts:29-69` — Add `WHERE deposit_paid_date IS NULL` guard to deposit UPDATE to prevent concurrent double-recording
- [ ] **ID-5 (Medium):** `src/services/private-bookings/payments.ts:56` — Don't overwrite `deposit_amount` with user-entered value. Validate it matches the configured deposit amount, or store actual captured amount in a separate field

## ASSUMPTIONS TO RESOLVE

- [ ] **Existing stale data:** Are there production bookings marked "Fully Paid" that had items added after payment? → Run: `SELECT id FROM private_bookings WHERE final_payment_date IS NOT NULL AND calculate_private_booking_balance(id) > 0`
- [ ] **Discount divergence scope:** How many bookings have booking-level discounts? This determines the blast radius of CR-2 → Check: `SELECT count(*) FROM private_bookings WHERE discount_amount > 0`
- [ ] **PayPal deposit edits in production:** Have any PayPal deposit amounts been edited after capture? → Check: `SELECT id FROM private_bookings WHERE paypal_deposit_capture_id IS NOT NULL AND deposit_amount != [original PayPal amount]`
- [ ] **RPC direct calls:** Has anyone called `record_balance_payment` directly (not through the app)? → Check Supabase logs for direct RPC invocations

## REPO CONVENTIONS TO PRESERVE

- Payment-related server actions check permissions via `checkUserPermission('private_bookings', 'manage_deposits')` or `checkUserPermission('private_bookings', 'manage')`
- Balance payments use the atomic RPC path with `FOR UPDATE` locks
- Deposit state is stored on the booking row, balance payments in the ledger table
- Edit/delete operations go through admin client + `apply_balance_payment_status` reconciliation
- All mutations log to `audit_logs` via `logAuditEvent()`
- `revalidatePath` called after every mutation

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-2:** After discount alignment — re-verify all four DB functions, the view, and the UI all produce the same total for a discounted booking
- [ ] **SEC-001:** After RPC fix — verify unprivileged users cannot call the RPC
- [ ] **ID-1:** After item-change reconciliation — audit existing production data for stale states
- [ ] **ID-3:** After portal fix — verify customer-facing balance display matches admin view

## REVISION PROMPT

You are fixing the private bookings payment system based on an adversarial review.

Apply these changes in order:

1. **SEC-001 (Critical):** Create a new migration that replaces `record_balance_payment` RPC with a version that checks `user_has_permission(auth.uid(), 'private_bookings', 'manage_deposits')` at the top, raising an exception if denied
2. **CR-2 (High):** Create a new migration that updates `calculate_private_booking_balance()`, the `private_bookings_with_details` view, `record_balance_payment` RPC, and `apply_balance_payment_status()` to apply booking-level discounts when computing the total (match the UI logic in `calculateTotal()`)
3. **ID-3 (High):** Fix `src/app/booking-portal/[token]/page.tsx:157` to not subtract deposit from balance
4. **ID-1 (High):** After item/discount mutations in `privateBookingActions.ts`, call `apply_balance_payment_status(booking_id)` to reconcile payment state
5. **ID-6 (Medium):** Add booking status guards to block payments on cancelled/completed bookings
6. **ID-2 (Medium):** Add overpayment check in the RPC
7. **ID-4 (Medium):** Fix cron balance reminder formula
8. **WF-1 (Medium):** Use `router.refresh()` after payment recording

Preserve these decisions:
- Deposit exclusion from balance (already correct)
- FOR UPDATE locking pattern in RPC
- Deposit on booking row / balance in ledger table separation

Verify these assumptions before proceeding:
- Check production data for stale `final_payment_date` values
- Check how many bookings have booking-level discounts
