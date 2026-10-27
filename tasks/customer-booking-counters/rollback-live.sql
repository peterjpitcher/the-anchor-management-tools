-- Rollback for supabase/migrations/20261027005339_customer_booking_counters_live.sql.
-- Restores update_customer_booking_stats and get_email_capture_audience exactly as production held
-- them on 27 October 2026 (pg_get_functiondef output; md5(prosrc) e91880fe00e9f4424a38037a3046bd20
-- and 42cf7716b86ab6c4979ef7c5636cc1a7), with their grants. Roll back part 2
-- (rollback-drop.sql) first if it was applied: the old trigger writes the columns part 2 drops.
-- Confirmations between the migration and this rollback did not raise the counters; nothing puts
-- those increments back.

CREATE OR REPLACE FUNCTION public.update_customer_booking_stats()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    UPDATE customers
    SET table_booking_count = table_booking_count + 1,
        last_table_booking_date = NEW.booking_date
    WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle no-show
    IF OLD.status != 'no_show' AND NEW.status = 'no_show' THEN
      UPDATE customers
      SET no_show_count = no_show_count + 1
      WHERE id = NEW.customer_id;
    END IF;
    
    -- Handle new confirmation
    IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
      UPDATE customers
      SET table_booking_count = table_booking_count + 1,
          last_table_booking_date = NEW.booking_date
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

REVOKE ALL ON FUNCTION public.get_email_capture_audience(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_capture_audience(integer) TO service_role;
