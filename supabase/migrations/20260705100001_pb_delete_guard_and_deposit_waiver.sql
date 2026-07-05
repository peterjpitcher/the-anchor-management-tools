-- Private Bookings SOP compliance (pack 2026-07-05), part 2 of 2:
--   A. Hard-delete guard per SOP §8: a booking may be hard-deleted only when
--      no payment has been made, no contract has been generated, and no
--      customer SMS or email has been sent or queued. The previous
--      cancelled-bookings bypass is removed — cancellation records must be
--      retained per the retention policy.
--   B. Explicit deposit waiver: a £0 deposit no longer silently auto-confirms;
--      the General Manager must record a waiver with a reason
--      (venue-hosted/internal events).

-- ---------------------------------------------------------------------------
-- A. Delete guard (function name kept — trigger private_bookings_delete_gate
--    is already bound to it)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_hard_delete_when_sms_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- SOP §8: once a customer has been messaged, paid, or received a contract,
  -- the booking must be cancelled, not deleted. Applies to cancelled bookings
  -- too — cancellation records are retained.

  IF OLD.deposit_paid_date IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: a deposit has been paid. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private_booking_payments WHERE booking_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: payments have been recorded. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(OLD.contract_version, 0) > 0 OR EXISTS (
    SELECT 1 FROM private_booking_documents WHERE booking_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: a contract or document has been generated. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM email_messages
    WHERE private_booking_id = OLD.id
      AND COALESCE(direction, 'outbound') <> 'inbound'
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: a customer email has been sent. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private_booking_sms_queue
    WHERE booking_id = OLD.id
      AND (status = 'sent'
           OR (status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for > now()))
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: SMS already sent or scheduled. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$function$;

-- ---------------------------------------------------------------------------
-- B. Explicit deposit waiver backfill (columns created in 20260705100000)
-- ---------------------------------------------------------------------------

-- Existing £0-deposit bookings keep working: treat historic zero-deposit rows
-- as waived so they are not blocked retroactively.
UPDATE public.private_bookings
SET deposit_waived = true,
    deposit_waived_reason = COALESCE(deposit_waived_reason, 'Historic booking created before explicit waivers (migration 2026-07-05)')
WHERE COALESCE(deposit_amount, 0) = 0
  AND deposit_waived = false;
