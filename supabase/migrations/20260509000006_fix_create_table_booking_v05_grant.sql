-- Fix EXECUTE permissions for the 10-parameter create_table_booking_v05 function.
-- The previous migration (20260509000005) incorrectly applied REVOKE/GRANT to the
-- 9-parameter signature. This migration corrects the permissions on the 10-param version.

REVOKE ALL ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean) TO service_role;
