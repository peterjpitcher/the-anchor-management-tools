**Assumption Breaker**

**Contradicted**
- High: “The DB and UI agree on outstanding balance.” They do not. The detail page uses `calculateTotal()` with booking-level discounts in `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:1666`, `:2385`, `:2435`, `:2571`. The DB balance function, the view, the balance-payment RPC, and the status-recalc RPC all use raw `SUM(line_total)` and ignore booking-level discount in `supabase/migrations/20260502000000_private_booking_payments.sql:50`, `supabase/migrations/20260514000001_add_payment_columns_to_private_bookings_view.sql:46`, `supabase/migrations/20260514000002_record_balance_payment_rpc.sql:39`, and `supabase/migrations/20260319124206_apply_balance_payment_status.sql:12`. A discounted booking can show `£0` outstanding in the detail page while the DB still considers it underpaid.
- High: “Fully Paid stays correct after later edits.” Only balance-payment edit/delete re-run reconciliation in `src/services/private-bookings/payments.ts:549` and `:570`. Item adds/edits/deletes and booking discounts only revalidate pages in `src/app/actions/privateBookingActions.ts:803`, `:1149`, `:1192`, `:1219` and never reconcile `final_payment_date`. The detail page and admin list then trust `final_payment_date` as zero balance in `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:2415`, `:2439` and `src/services/private-bookings/queries.ts:242`. That allows impossible states after commercial changes.
- High: “Deposit and balance are cleanly separated.” The storage location is separated, but the amount semantics are not. Deposit entry accepts any positive amount with no match-to-configured-deposit validation in `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:274` and `src/app/actions/privateBookingActions.ts:614`. `recordDeposit()` then overwrites `private_bookings.deposit_amount` with whatever was entered in `src/services/private-bookings/payments.ts:56`. A £1 manual deposit marks the deposit paid/confirmed and destroys the original required bond amount; deleting the deposit later does not restore it in `src/services/private-bookings/payments.ts:596`.
- Medium: “Final payment amounts are validated correctly.” Only the client enforces `<= remaining` in `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:274`. Server-side record/edit paths only require `> 0` in `src/app/actions/privateBookingActions.ts:684`, `:1738` and `src/services/private-bookings/payments.ts:539`. The RPC accepts any positive amount in `supabase/migrations/20260514000002_record_balance_payment_rpc.sql:35`. Overpayments are then hidden because both UI and DB clamp remaining to zero in `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx:47` and `supabase/migrations/20260502000000_private_booking_payments.sql:60`.
- Medium: “Null/zero deposit bookings behave consistently.” The detail page still offers deposit collection whenever the booking is draft/confirmed, even if `deposit_amount` is `0`, in `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:2347` and `:2562`. The detail query only treats deposit as required when `deposit_amount > 0` in `src/services/private-bookings/queries.ts:358`, but the view marks every confirmed booking as `deposit_status='Required'` regardless of amount in `supabase/migrations/20260514000001_add_payment_columns_to_private_bookings_view.sql:51`.
- Medium: “Cancelled or zero-total bookings cannot become fully paid.” The balance button has no status guard in `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:2419`; the service/RPC fetch `status` but never enforce it in `src/services/private-bookings/payments.ts:319` and `supabase/migrations/20260514000002_record_balance_payment_rpc.sql:22`. The RPC also stamps `final_payment_date` even when total items are `0` in `supabase/migrations/20260514000002_record_balance_payment_rpc.sql:53`, while `apply_balance_payment_status()` explicitly does not in `supabase/migrations/20260319124206_apply_balance_payment_status.sql:22`.

**Verified**
- The `PaymentHistoryTable` fix is real: deposit no longer reduces “Paid to date” there in `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx:44`.
- Payment history itself keeps deposit on `private_bookings` and balance payments in `private_booking_payments` in `src/services/private-bookings/payments.ts:495`.
- `calculate_private_booking_balance()` does exclude deposits from its payment sum in `supabase/migrations/20260502000000_private_booking_payments.sql:55`.

**Unverified**
- Whether existing rows already contain stale `final_payment_date` values from earlier item/discount changes; nothing reviewed backfills or audits private-booking payment state.
- Whether downstream refund/accounting flows need both “configured deposit” and “actual captured deposit”; the schema only has one mutable `deposit_amount`.

**Unfounded**
- “There is one source of truth for booking total.” The code alternates between `total_amount`, `calculated_total`, and UI-only `calculateTotal()` with different discount semantics in `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:1666`, `src/services/private-bookings/queries.ts:240`, and `src/app/booking-portal/[token]/page.tsx:157`.
- “The view’s payment columns drive the app.” The view defines `total_balance_paid`, `balance_remaining`, and `payment_status` in `supabase/migrations/20260514000001_add_payment_columns_to_private_bookings_view.sql:59`, but `PrivateBookingWithDetails` omits them in `src/types/private-bookings.ts:231`, and `fetchPrivateBookings()` recomputes balance instead of selecting them in `src/services/private-bookings/queries.ts:123` and `:239`.

**Completeness Gaps**
- Tests only cover payment-history sorting and that payment edit/delete call the RPC in `src/services/private-bookings.test.ts:56`, `:138`, `:166`, `:182`.
- No test covers booking-level discounts interacting with balance/payment status.
- No test covers item/discount changes after full payment, zero/absent deposit, overpayment, cancelled booking payment attempts, or zero-total bookings.

**Codebase Fit Issues**
- The customer booking portal still subtracts the deposit from the event balance in `src/app/booking-portal/[token]/page.tsx:157`.
- The 14-day balance reminder cron does the same in `src/app/api/cron/private-booking-monitor/route.ts:646`.
- Admin list and weekly digest can disagree: `fetchPrivateBookings()` recomputes balance from `final_payment_date` in `src/services/private-bookings/queries.ts:239`, while the weekly summary reads `balance_remaining` directly from the view in `src/app/api/cron/private-bookings-weekly-summary/route.ts:171`.

**Hidden Risks**
- PayPal deposits can still have their amount edited later: the UI locks method but not amount for PayPal deposits in `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx:184`, and `updateDeposit()` blindly overwrites `deposit_amount` in `src/services/private-bookings/payments.ts:574`.
- `deleteDeposit()` clears `deposit_paid_date` and method but leaves the possibly mutated `deposit_amount` in place in `src/services/private-bookings/payments.ts:596`.

**False Confidence Flags**
- The view migration comment says the new columns are “needed by the balance payment UI and booking detail pages” in `supabase/migrations/20260514000001_add_payment_columns_to_private_bookings_view.sql:3`, but those paths do not actually use them.
- The current test suite explicitly asserts that deposit edits do not trigger reconciliation in `src/services/private-bookings.test.ts:185`, which protects the present inconsistency instead of the financial invariant.

Review only; no tests executed.