-- Keep numbers that provably cannot receive an SMS out of the email-capture audience.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS
--
-- The audience excludes anyone already holding an email_capture token, which is what stops a
-- guest being asked twice. The consequence is that being asked once is permanent. So a
-- recipient whose number is rejected by Twilio at request time does not merely fail: they are
-- written off forever, silently, having received nothing.
--
-- Measured on 2026-08-21 against the 423-person audience, by joining each number to its most
-- recent outbound message:
--   10  Twilio 21612  North American numbers, unreachable from the UK long code
--    6  Twilio 21211  malformed UK numbers that are not valid destinations at all
--    2  Twilio 21408  Pakistan and UAE, region not enabled on the account
--    3  delivered fine (Spain, Germany, and a UK 01753 number with 13 lifetime sends)
--
-- Note the last line. A number being a landline, or being abroad, does NOT mean it cannot
-- receive an SMS, and an earlier version of this analysis wrongly assumed it did. The rule
-- below is therefore based on OBSERVED Twilio outcomes, not on the shape of the number.
--
-- THE RULE
--
-- Exclude a number when it has at least one hard, request-time Twilio rejection AND has never
-- once been accepted for delivery. A number that failed once but has also delivered stays in,
-- because the failure was situational rather than fatal (2 such numbers today).
--
-- This is self-maintaining. If staff correct a mistyped number, the customer becomes eligible
-- again with no code change, because the corrected number has no failure history.

CREATE OR REPLACE FUNCTION public.get_email_capture_audience(p_max_recipients integer DEFAULT 500)
RETURNS TABLE (
  customer_id uuid,
  first_name text,
  phone_number text,
  last_activity_on date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH hard_failures AS (
    -- Request-time rejections. Twilio never attempts delivery for these, so they are a
    -- property of the number rather than of the moment.
    --   21211 invalid 'To' number
    --   21408 permission not enabled for that region
    --   21610 recipient has opted out (STOP)
    --   21612 not reachable from this 'From' number
    --   21614 not a mobile number
    SELECT DISTINCT m.to_number
    FROM public.messages m
    WHERE m.direction = 'outbound'
      AND m.twilio_status IN ('21211', '21408', '21610', '21612', '21614')
  ),
  ever_accepted AS (
    SELECT DISTINCT m.to_number
    FROM public.messages m
    WHERE m.direction = 'outbound'
      AND m.twilio_status IN ('delivered', 'sent', 'queued', 'accepted')
  )
  SELECT
    c.id::uuid,
    c.first_name::text,
    c.mobile_e164::text,
    GREATEST(
      COALESCE(c.last_table_booking_date, '1900-01-01'::date),
      COALESCE((SELECT max(b.created_at)::date FROM public.bookings b WHERE b.customer_id = c.id), '1900-01-01'::date)
    )::date AS last_activity_on
  FROM public.customers c
  WHERE (c.email IS NULL OR btrim(c.email) = '')
    AND c.mobile_e164 IS NOT NULL
    AND c.sms_status = 'active'
    AND c.messaging_status = 'active'
    AND c.marketing_sms_opted_out_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = c.id)
      OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = c.id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.guest_tokens g
      WHERE g.customer_id = c.id AND g.action_type = 'email_capture'
    )
    AND NOT (
      c.mobile_e164 IN (SELECT to_number FROM hard_failures)
      AND c.mobile_e164 NOT IN (SELECT to_number FROM ever_accepted)
    )
  ORDER BY last_activity_on DESC, c.id
  LIMIT GREATEST(1, LEAST(COALESCE(p_max_recipients, 500), 1000));
$function$;

COMMENT ON FUNCTION public.get_email_capture_audience(integer) IS
  'Customers who are SMS-reachable but have no email address, have booked before (the soft opt-in basis), have not already been sent an email_capture link, and whose number has not been hard-rejected by Twilio without ever having been delivered to. Ordered warmest first.';

REVOKE ALL ON FUNCTION public.get_email_capture_audience(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_capture_audience(integer) TO service_role;

-- ROLLBACK: re-apply 20260820090000_email_capture_tokens_and_audience.sql, which contains the
-- previous definition of this function verbatim.
