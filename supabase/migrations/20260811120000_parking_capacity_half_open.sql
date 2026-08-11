-- Make the capacity check agree with the availability calculation.
--
-- src/lib/parking/capacity.ts was changed to treat booking intervals as
-- half-open, so a booking that ends at 14:00 no longer occupies the 14:00 slot
-- and the space it vacates is immediately sellable. That fixed a real loss of
-- back-to-back bookings.
--
-- check_parking_capacity was left on closed ranges ('[]'), which means the two
-- now disagree at exactly the shared boundary. The website reads availability
-- from the application code and says "we have N spaces free", the guest fills in
-- the rest of the wizard and clicks PayPal, and this function then refuses the
-- booking with a capacity error. Losing the customer at the payment step is
-- worse than never offering the slot.
--
-- Verified against production before writing this: booking PAR-20251012-0001
-- runs 2025-11-03 20:00 to 2025-11-04 05:00, and a new 05:00 to 09:00 window
-- overlaps it under '[]' but not under '[)'. That is the case a guest would hit.
--
-- Only the two range bounds change. Capacity resolution and the ignore-booking
-- behaviour are untouched.

create or replace function public.check_parking_capacity(
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_ignore_booking uuid default null::uuid
)
returns table(remaining integer, capacity integer, active integer)
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
DECLARE
  active_capacity integer;
  active_bookings integer;
BEGIN
  SELECT COALESCE(capacity_override, 10)
    INTO active_capacity
  FROM public.parking_rates
  WHERE effective_from <= timezone('utc', now())
  ORDER BY effective_from DESC
  LIMIT 1;

  active_capacity := COALESCE(active_capacity, 10);

  SELECT COUNT(*)
    INTO active_bookings
  FROM public.parking_bookings
  WHERE status IN ('pending_payment', 'confirmed')
    -- Half-open, matching src/lib/parking/capacity.ts. A booking ending exactly
    -- when another starts does not overlap it.
    AND tstzrange(start_at, end_at, '[)') && tstzrange(p_start, p_end, '[)')
    AND (p_ignore_booking IS NULL OR id <> p_ignore_booking);

  RETURN QUERY SELECT active_capacity - active_bookings, active_capacity, active_bookings;
END;
$function$;
