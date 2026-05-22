-- Retire the Sunday lunch pre-order workflow for upcoming active bookings.
-- Historical submitted items are left intact for audit/reporting.
UPDATE public.table_bookings
SET
  booking_type = 'regular'::public.table_booking_type,
  sunday_preorder_cutoff_at = NULL,
  updated_at = NOW()
WHERE booking_type = 'sunday_lunch'::public.table_booking_type
  AND status NOT IN ('cancelled', 'no_show')
  AND booking_date >= CURRENT_DATE;
