-- Rollback for 20261027193337_event_guest_phone_and_details_to_follow.sql.
--
-- The migration only adds create_event_booking_v09 and
-- create_event_booking_with_attendees_and_requests_v02; v08 and the v01 wrapper were never
-- changed, so dropping the two new functions restores production exactly.
--
-- Revert the app first: it calls the new names. Guest rows already saved with a phone or with
-- details to follow keep them; v08 and the staff editor read such rows without error.

DROP FUNCTION IF EXISTS public.create_event_booking_with_attendees_and_requests_v02(uuid, uuid, integer, text, text, integer, jsonb, text, boolean, jsonb, numeric);
DROP FUNCTION IF EXISTS public.create_event_booking_v09(uuid, uuid, integer, text, text, integer, jsonb, jsonb, numeric);
