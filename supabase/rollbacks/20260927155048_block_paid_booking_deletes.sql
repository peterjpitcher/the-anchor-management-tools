-- Rollback for 20260927155048_block_paid_booking_deletes.sql.
-- Safe at any time: removes the delete guard only, never data.

DROP TRIGGER IF EXISTS trg_guard_paid_booking_delete ON public.parking_bookings;
DROP TRIGGER IF EXISTS trg_guard_paid_booking_delete ON public.bookings;
DROP TRIGGER IF EXISTS trg_guard_paid_booking_delete ON public.table_bookings;

DROP FUNCTION IF EXISTS public.guard_paid_parking_booking_delete();
DROP FUNCTION IF EXISTS public.guard_paid_event_booking_delete();
DROP FUNCTION IF EXISTS public.guard_paid_table_booking_delete();
