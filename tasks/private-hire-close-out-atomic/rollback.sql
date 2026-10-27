-- Rollback for 20261027180246_private_hire_close_out_atomic.sql.
-- Removes the close-out function. Deploy the app code that no longer calls it first, or the
-- close-out panel fails with "function not found" (nothing is half-written: the call is refused).
DROP FUNCTION IF EXISTS public.close_out_private_booking(uuid, text, text, text, numeric, text, uuid);
