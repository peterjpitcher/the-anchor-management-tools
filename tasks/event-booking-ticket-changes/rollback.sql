-- Rollback for 20261028150412_event_booking_ticket_changes.sql.
--
-- The migration only adds event_booking_refund_requests and seven functions; nothing existing was
-- changed, so dropping them restores production exactly.
--
-- Revert the app first: it calls the new functions and reads the new table.
--
-- Changes already made through the new functions stay as they are: they are ordinary bookings,
-- ticket lines, guest rows, payments and transfer rows. The one thing a rollback would lose is the
-- list of refunds waiting for a manager, so it refuses while that table holds any row. Export it
-- first (SELECT * FROM public.event_booking_refund_requests), settle or record each one, then run
-- this with the rows removed.

DO $$
BEGIN
  IF to_regclass('public.event_booking_refund_requests') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.event_booking_refund_requests) THEN
    RAISE EXCEPTION 'event_booking_refund_requests holds refund decisions; export and clear them before rolling back';
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.transfer_event_booking_v01(uuid, uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.change_event_booking_ticket_type_v01(uuid, uuid[], uuid, integer, uuid, text, text, numeric, uuid);
DROP FUNCTION IF EXISTS public.add_event_booking_guests_v01(uuid, uuid, integer, jsonb, text, text, numeric, uuid);
DROP FUNCTION IF EXISTS public.event_booking_staff_guest_rows_v01(uuid, uuid, jsonb, uuid[]);
DROP FUNCTION IF EXISTS public.remove_event_booking_guests_v01(uuid, uuid[], uuid, integer, uuid);
DROP FUNCTION IF EXISTS public.event_booking_refundable_v01(uuid);
DROP FUNCTION IF EXISTS public.event_booking_net_paid_v01(uuid);
DROP TABLE IF EXISTS public.event_booking_refund_requests;
