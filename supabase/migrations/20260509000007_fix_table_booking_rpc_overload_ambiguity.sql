-- Fix: remove stale 8-param and 9-param overloads of create_table_booking_v05.
--
-- Problem: Multiple overloads of create_table_booking_v05 exist in the database
-- with different parameter counts:
--   • 8-param (from 20260509000001): only excludes 'cancelled' from overlap check
--     (missing no_show and left_at IS NULL guards), and has NO joined-table combo
--     search. PostgreSQL function resolution picks this as the best match when
--     callers supply 8 named arguments — which is exactly what the public API does.
--
--   • 9-param (from 20260509000003): has correct overlap logic and combo search,
--     but only used when p_bypass_cutoff is explicitly passed (FOH kiosk).
--
--   • 10-param (from 20260509000005): canonical version — correct overlap logic,
--     joined-table combo search, p_bypass_cutoff, and p_deposit_waived.
--
-- Effect: public booking attempts that need joined tables always return no_table.
-- Bookings where guests left or were marked no_show incorrectly block their table.
--
-- Fix: drop the 8-param and 9-param overloads. All callers — including those
-- supplying only 8 named arguments — will resolve to the 10-param version because
-- the extra two parameters default to false. No calling code needs to change.

DROP FUNCTION IF EXISTS public.create_table_booking_v05(
  uuid,
  date,
  time without time zone,
  integer,
  text,
  text,
  boolean,
  text
);

DROP FUNCTION IF EXISTS public.create_table_booking_v05(
  uuid,
  date,
  time without time zone,
  integer,
  text,
  text,
  boolean,
  text,
  boolean
);
