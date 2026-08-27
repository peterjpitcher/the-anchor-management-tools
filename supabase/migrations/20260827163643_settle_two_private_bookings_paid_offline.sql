-- Data correction (owner approved 2026-08-27): record the balance payments that
-- were taken in cash but never landed in private_booking_payments, so the two
-- bookings that read "paid in full" are actually paid in full in the data.
--
--   Lauren Harmes, 2025-07-19, gross 232.98, payments on record 0.00
--     The pre-2026-02-28 "record final payment" button took a payment method
--     only. It stamped final_payment_date directly and recorded no money. The
--     direct-write helper behind it is removed in the same change as this
--     migration.
--
--   Millie Prynn, 2026-06-20, gross 90.00, payments on record 75.00
--     apply_balance_payment_status compared payments against the NET total
--     until 20260705100000 made totals VAT-aware. She paid the net 75.00, the
--     RPC saw remaining = 0 and stamped. That migration raised the payable
--     total to 90.00 gross but never re-derived the stamps it had invalidated,
--     leaving the 15.00 of VAT unrecorded.
--
-- Each payment is dated when the money was actually taken (the existing
-- final_payment_date), not today, so the cash lands in the period it belongs to
-- and the payment history agrees with the settlement date already on record.
--
-- No communications: private_booking_payments carries no triggers, and every
-- customer-facing send is queued by the application layer or by crons gated to
-- date windows both of these events are long past.
--
-- The booking and damage deposit is a returnable bond held separately, so it is
-- correctly absent here: only private_booking_payments rows reduce the event
-- balance.
--
-- Idempotent: the amount is derived from the live outstanding balance and
-- nothing is inserted once a booking is settled.

DO $$
DECLARE
  v_row       RECORD;
  v_remaining numeric;
BEGIN
  FOR v_row IN
    SELECT *
    FROM (VALUES
      ('b8821e0a-69fd-434e-8344-0846d5b0eadf'::uuid, '2025-07-14 19:29:31.583+00'::timestamptz),
      ('f10ad80d-39a7-4103-82e1-67a18cd75e49'::uuid, '2026-06-13 16:05:31+00'::timestamptz)
    ) AS t(booking_id, paid_at)
  LOOP
    v_remaining := public.calculate_private_booking_balance(v_row.booking_id);

    IF v_remaining > 0 THEN
      INSERT INTO public.private_booking_payments
        (booking_id, amount, method, notes, recorded_by, created_at)
      VALUES
        (v_row.booking_id, v_remaining, 'cash',
         'Reconciliation 2026-08-27: balance settled in cash at the time but never recorded, '
         || 'confirmed paid in full by the owner. Back-dated to the settlement date.',
         NULL, v_row.paid_at);

      RAISE NOTICE 'Booking %: recorded % of previously unrecorded cash', v_row.booking_id, v_remaining;
    END IF;

    -- Re-derive the stamp from payments against the gross total. Both bookings
    -- already carry a correct final_payment_date, and the RPC only stamps when
    -- the column is NULL, so the original dates survive untouched.
    PERFORM public.apply_balance_payment_status(v_row.booking_id);
  END LOOP;
END;
$$;

-- Verification (expect 0 rows):
--   SELECT count(*) FROM private_bookings_with_details
--   WHERE final_payment_date IS NOT NULL AND balance_remaining > 0;
