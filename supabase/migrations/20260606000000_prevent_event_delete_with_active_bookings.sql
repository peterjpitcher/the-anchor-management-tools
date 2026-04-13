-- Prevent deletion of events that have active bookings.
-- Defence-in-depth: the app layer also checks, but RLS grants DELETE
-- to authenticated users with events:delete permission, so a DB-level
-- safeguard is necessary.

CREATE OR REPLACE FUNCTION public.prevent_event_delete_with_active_bookings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE event_id = OLD.id
    AND status IN ('confirmed', 'pending_payment')
  ) THEN
    RAISE EXCEPTION 'Cannot delete event with active bookings. Cancel the event first.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_event_delete_with_active_bookings ON public.events;

CREATE TRIGGER trg_prevent_event_delete_with_active_bookings
  BEFORE DELETE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_event_delete_with_active_bookings();
