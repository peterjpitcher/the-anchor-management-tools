-- Paid bookings cannot be deleted, 27 September 2026.
--
-- APPLIED to production project tfcasgxopxegwrabvwat on 27 September 2026 as migration version
-- 20260927155048 (name: block_paid_booking_deletes), through the Supabase MCP apply_migration path after the owner
-- approved this exact SQL (sha256 8d3adf82 of the drafted file). Validated first on a
-- throwaway local Postgres; smoke-tested live afterwards in a block that always rolled back.
-- The file is named after the version the ledger recorded, not its drafted timestamp
-- (supabase/migrations/README.md).
-- Rollback: supabase/rollbacks/20260927155048_block_paid_booking_deletes.sql
--
-- WHY
--
-- Parking booking PAR-20260312-0001 (paid 15 GBP by PayPal on 12 March 2026) was deleted straight
-- from the database. The delete cascaded to its payment row, so the money vanished from our records
-- with no trail; only PayPal still knew about it. Nothing in the app deletes parking bookings, and
-- the app already refuses to delete a table booking that holds a deposit, but a delete run from the
-- dashboard, a script or a cascade went straight through.
--
-- WHAT THIS DOES
--
-- A BEFORE DELETE trigger on parking_bookings, bookings (event bookings) and table_bookings refuses
-- to remove a booking that still holds money: paid and not refunded. It fires for every role and
-- for cascades, so deleting a customer or an event can no longer take a paid booking with it.
-- Refunded, unpaid, failed and expired bookings delete exactly as before.
--
--   parking_bookings  payment_status 'paid', or a parking_booking_payments row with status 'paid'.
--   bookings          a payments row for it (not a refund row) with status 'succeeded' or
--                     'partially_refunded': PayPal tickets and manual (cash) tickets alike.
--   table_bookings    the rule the staff delete already uses (src/app/api/boh/table-bookings/[id]):
--                     a PayPal deposit capture, or payment_status 'completed' or 'partial_refund';
--                     plus money in the older ledgers (a 'succeeded' Stripe row in payments, or a
--                     'completed' table_booking_payments row), which that rule misses. Settled
--                     (payment_status or deposit_refund_status 'refunded') deletes as before.
--
-- The refusal uses SQLSTATE 23503 (foreign_key_violation), the same answer a RESTRICT foreign key
-- gives. So the customer delete, which already turns that answer into "anonymise instead"
-- (src/services/customers.ts), treats a customer with a paid event booking the way it already
-- treats one with a table or parking booking.
--
-- DELIBERATE REMOVALS
--
-- For a real mistake (a test booking paid with the owner's own card, say), run the delete in a
-- transaction that first says: SET LOCAL anchor.allow_paid_booking_delete = 'on';
-- Only someone with direct SQL access can do that; the app and the API cannot set it.
--
-- LIVE STATE (read 27 September 2026)
--
-- Protected today: 5 of 9 parking bookings, 11 of 1,551 event bookings, 26 of 891 table bookings.
-- Existing BEFORE DELETE triggers on these tables: none. The functions are SECURITY DEFINER so the
-- payment look-up is not hidden by the deleting user's row-level security; nobody can call them
-- directly (EXECUTE revoked below, and a trigger does not need it).

CREATE OR REPLACE FUNCTION public.guard_paid_parking_booking_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('anchor.allow_paid_booking_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF OLD.payment_status IS NOT DISTINCT FROM 'paid'::public.parking_payment_status
     OR EXISTS (
       SELECT 1
       FROM public.parking_booking_payments p
       WHERE p.booking_id = OLD.id
         AND p.status = 'paid'::public.parking_payment_status
     )
  THEN
    RAISE EXCEPTION 'Parking booking % holds a payment, so it cannot be deleted',
      coalesce(OLD.reference, OLD.id::text)
      USING ERRCODE = '23503',
            DETAIL = 'Cancel or refund it instead. Deleting it would erase the payment record.';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_paid_event_booking_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('anchor.allow_paid_booking_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.event_booking_id = OLD.id
      AND p.charge_type IS DISTINCT FROM 'refund'
      AND p.status IN ('succeeded', 'partially_refunded')
  ) THEN
    RAISE EXCEPTION 'Event booking % holds a payment, so it cannot be deleted', OLD.id
      USING ERRCODE = '23503',
            DETAIL = 'Cancel or refund it instead. Deleting it would erase the payment record.';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_paid_table_booking_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_holds_money boolean;
  v_settled boolean;
BEGIN
  IF current_setting('anchor.allow_paid_booking_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;

  v_settled :=
    coalesce(OLD.deposit_refund_status, '') = 'refunded'
    OR coalesce(OLD.payment_status::text, '') = 'refunded';

  v_holds_money :=
    OLD.paypal_deposit_capture_id IS NOT NULL
    OR coalesce(OLD.payment_status::text, '') IN ('completed', 'partial_refund')
    OR EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.table_booking_id = OLD.id
        AND p.charge_type IS DISTINCT FROM 'refund'
        AND p.status IN ('succeeded', 'partially_refunded')
    )
    OR EXISTS (
      SELECT 1
      FROM public.table_booking_payments t
      WHERE t.booking_id = OLD.id
        AND t.status::text IN ('completed', 'partial_refund')
    );

  IF v_holds_money AND NOT v_settled THEN
    RAISE EXCEPTION 'Table booking % holds a payment, so it cannot be deleted',
      coalesce(OLD.booking_reference::text, OLD.id::text)
      USING ERRCODE = '23503',
            DETAIL = 'Cancel or refund it instead. Deleting it would erase the payment record.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_paid_parking_booking_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_paid_event_booking_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_paid_table_booking_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_paid_booking_delete ON public.parking_bookings;
CREATE TRIGGER trg_guard_paid_booking_delete
  BEFORE DELETE ON public.parking_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_paid_parking_booking_delete();

DROP TRIGGER IF EXISTS trg_guard_paid_booking_delete ON public.bookings;
CREATE TRIGGER trg_guard_paid_booking_delete
  BEFORE DELETE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_paid_event_booking_delete();

DROP TRIGGER IF EXISTS trg_guard_paid_booking_delete ON public.table_bookings;
CREATE TRIGGER trg_guard_paid_booking_delete
  BEFORE DELETE ON public.table_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_paid_table_booking_delete();
