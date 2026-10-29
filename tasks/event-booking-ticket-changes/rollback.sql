-- Rollback for 20261029090400_event_booking_ticket_changes.sql.
--
-- The migration only adds event_booking_refund_requests, booking_items.price_paid_groups, the
-- payments_manual_refund_claim_unique index and eleven functions; nothing existing was changed, so
-- dropping them restores production exactly.
--
-- Revert the app first: it calls the new functions and reads the new table.
--
-- Changes already made through the new functions stay as they are: they are ordinary bookings,
-- ticket lines, guest rows, payments and transfer rows. A rollback would lose two records: the
-- refunds waiting for a manager, and what was paid for tickets added at a different price
-- (price_paid_groups). It refuses while either holds anything. Export them first
-- (SELECT * FROM public.event_booking_refund_requests;
--  SELECT * FROM public.booking_items WHERE price_paid_groups IS NOT NULL), settle or record each
-- one, clear them, then run this.

DO $$
BEGIN
  IF to_regclass('public.event_booking_refund_requests') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.event_booking_refund_requests) THEN
    RAISE EXCEPTION 'event_booking_refund_requests holds refund decisions; export and clear them before rolling back';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'booking_items' AND column_name = 'price_paid_groups') THEN
    IF EXISTS (SELECT 1 FROM public.booking_items WHERE price_paid_groups IS NOT NULL) THEN
      RAISE EXCEPTION 'booking_items.price_paid_groups holds prices paid; export and clear them before rolling back';
    END IF;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.record_manual_event_refund_v01(uuid, numeric, text, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.transfer_event_booking_v01(uuid, uuid, jsonb, uuid);
DROP FUNCTION IF EXISTS public.change_event_booking_ticket_type_v01(uuid, uuid[], uuid, integer, uuid, text, text, numeric, uuid);
DROP FUNCTION IF EXISTS public.add_event_booking_guests_v01(uuid, uuid, integer, jsonb, text, text, numeric, uuid);
DROP FUNCTION IF EXISTS public.event_booking_staff_guest_rows_v01(uuid, uuid, jsonb, uuid[]);
DROP FUNCTION IF EXISTS public.remove_event_booking_guests_v01(uuid, uuid[], uuid, integer, uuid);
DROP FUNCTION IF EXISTS public.event_booking_refundable_v01(uuid);
DROP FUNCTION IF EXISTS public.event_booking_put_tickets_v01(uuid, uuid, integer, numeric, numeric);
DROP FUNCTION IF EXISTS public.event_booking_take_tickets_v01(uuid, jsonb);
DROP FUNCTION IF EXISTS public.event_booking_line_groups_v01(jsonb, integer, numeric);
DROP FUNCTION IF EXISTS public.event_booking_net_paid_v01(uuid);
DROP INDEX IF EXISTS public.payments_manual_refund_claim_unique;
ALTER TABLE public.booking_items DROP COLUMN IF EXISTS price_paid_groups;
DROP TABLE IF EXISTS public.event_booking_refund_requests;
