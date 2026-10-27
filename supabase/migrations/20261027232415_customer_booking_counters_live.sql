-- BK-165 (customer bookings review of 24 October 2026), part 1 of 2: stop keeping the customer
-- table-booking counters, and read last activity from the bookings themselves.
--
-- customers.table_booking_count and customers.last_table_booking_date went up when a table booking
-- was confirmed and never came down when it was cancelled, so they read as "ever booked" tallies.
-- On 27 October 2026, of the 852 customers with table bookings, 129 had a count that differs from
-- their bookings that are not cancelled and 105 had a different last date. No app screen reads
-- them, but get_email_capture_audience used the date as the guest's last activity, so a guest whose
-- last booking was cancelled still looked recently active.
--
--   update_customer_booking_stats   keeps only what it is still for: adding up no-shows. It no
--                                   longer touches the two counters. Built from production's text
--                                   (md5(prosrc) e91880fe00e9f4424a38037a3046bd20 on 27 October
--                                   2026; the repo's squashed baseline holds the same body), still
--                                   SECURITY INVOKER with search_path public, pg_catalog, and its
--                                   grants restated exactly (PUBLIC, anon, authenticated and
--                                   service_role hold EXECUTE). The trigger that calls it is
--                                   unchanged.
--   get_email_capture_audience      takes last activity from the latest table booking that is not
--                                   cancelled, instead of the counter. Otherwise production's text
--                                   exactly (md5(prosrc) 42cf7716b86ab6c4979ef7c5636cc1a7, the body
--                                   from 20260821094458_email_capture_skip_dead_numbers.sql), still
--                                   SECURITY DEFINER with search_path public, service_role only.
--
-- convert_event_table_bookings_to_communal_v01, which the review also named, never touches the
-- customer counter: the match was its own local variable v_cancelled_table_booking_count. It is
-- not changed.
--
-- Part 2 (20261027154847_drop_customer_booking_counters) keeps a copy of the two columns and drops
-- them; it refuses to run until this part is in.
--
-- Rollback: tasks/customer-booking-counters/rollback-live.sql restores both functions as
-- production holds them. Tested by scripts/testing/customer-booking-counters-postgres.py.

CREATE OR REPLACE FUNCTION public.update_customer_booking_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- Table booking counts and dates are read from table_bookings when needed (BK-165); only the
  -- no-show tally is kept on the customer.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'no_show' AND NEW.status = 'no_show' THEN
      UPDATE customers
      SET no_show_count = no_show_count + 1
      WHERE id = NEW.customer_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.update_customer_booking_stats() TO PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_email_capture_audience(p_max_recipients integer DEFAULT 500)
 RETURNS TABLE(customer_id uuid, first_name text, phone_number text, last_activity_on date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
      -- The latest table booking that was not cancelled (BK-165), not the old counter.
      COALESCE((SELECT max(t.booking_date) FROM public.table_bookings t
                 WHERE t.customer_id = c.id AND t.status <> 'cancelled'), '1900-01-01'::date),
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

REVOKE ALL ON FUNCTION public.get_email_capture_audience(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_capture_audience(integer) TO service_role;
