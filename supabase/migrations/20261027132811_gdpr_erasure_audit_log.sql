-- GDPR erasure reaches the audit log (BK-081, customer bookings review of 24 October 2026).
--
-- An erasure request rewrote the guest's customer row, bookings and messages, but left copies of
-- their name, phone number and email in audit_logs: deleting or editing a customer logs the whole
-- row, and event booking rows log the booker's name. Twenty customer audit rows held a phone or an
-- email on 26 October 2026. The erasure code could not clear them because the audit log refuses
-- every UPDATE (prevent_audit_log_update), which is right for everything else.
--
-- This adds one narrow way through, for an erasure only:
--   * gdpr_scrub_audit_logs_v01(customer ids, booking ids) takes a fixed list of personal keys out
--     of old_values, new_values and additional_info on the audit rows about those customers and
--     bookings. Ids, statuses, amounts, dates and who did what all stay, so the row still proves
--     what happened. It is service_role only: the GDPR server action calls it after its own
--     super_admin check.
--   * prevent_audit_log_update lets an update through only while that function has set a
--     transaction-local flag, and only when the update removes JSON keys and changes nothing
--     else. Every other update is refused exactly as before. Nothing outside a database function
--     can set the flag: API callers cannot run set_config, and it is reset before the function
--     returns.
--
-- prevent_audit_log_update's body is production's text (md5 f6de7f9de4f2184d4cb0f45777356bca,
-- checked 26 October 2026) with the exception added in front of the same RAISE. Its header,
-- SECURITY INVOKER, search_path (public, pg_catalog) and grants are as production holds them;
-- CREATE OR REPLACE keeps the grants.
--
-- Deploy order: this migration first, then the app. The app only calls the new function from
-- the erasure action, and treats a missing function as a reported failure, not a crash.
-- Rollback: tasks/gdpr-erasure-audit-log/rollback.sql. Tested by
-- scripts/testing/gdpr-erasure-audit-log-postgres.py.

CREATE OR REPLACE FUNCTION public.prevent_audit_log_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- One exception, for a GDPR erasure (gdpr_scrub_audit_logs_v01): personal details may be
  -- taken out of the row's JSON. Nothing else about the row may change, and nothing may be added.
  IF current_setting('app.gdpr_audit_scrub', true) = 'on'
     AND NEW.id = OLD.id
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.user_email IS NOT DISTINCT FROM OLD.user_email
     AND NEW.operation_type IS NOT DISTINCT FROM OLD.operation_type
     AND NEW.resource_type IS NOT DISTINCT FROM OLD.resource_type
     AND NEW.resource_id IS NOT DISTINCT FROM OLD.resource_id
     AND NEW.operation_status IS NOT DISTINCT FROM OLD.operation_status
     AND NEW.ip_address IS NOT DISTINCT FROM OLD.ip_address
     AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
     AND NEW.error_message IS NOT DISTINCT FROM OLD.error_message
     AND coalesce(OLD.old_values, '{}'::jsonb) @> coalesce(NEW.old_values, '{}'::jsonb)
     AND coalesce(OLD.new_values, '{}'::jsonb) @> coalesce(NEW.new_values, '{}'::jsonb)
     AND coalesce(OLD.additional_info, '{}'::jsonb) @> coalesce(NEW.additional_info, '{}'::jsonb)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Audit logs cannot be modified';
END;
$function$;

CREATE OR REPLACE FUNCTION public.gdpr_scrub_audit_logs_v01(p_customer_ids uuid[], p_booking_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  -- Every key the app has written a guest's own details under (production, 26 October 2026).
  v_keys text[] := ARRAY[
    'first_name', 'last_name', 'email', 'mobile_number', 'mobile_e164', 'mobile_number_raw',
    'phone_number', 'phone', 'internal_notes', 'stripe_customer_id',
    'last_sms_failure_reason', 'sms_deactivation_reason', 'last_email_failure_reason',
    'last_whatsapp_failure_reason', 'whatsapp_deactivation_reason', 'sms_opt_in_source',
    'whatsapp_opt_in_source', 'loser_name', 'loser_mobile', 'winner_renamed_to',
    'customerName', 'customer_name', 'customer_first_name', 'customer_last_name',
    'customer_phone', 'customer_email', 'customer_mobile',
    'attendee_names', 'attendees', 'guest_names', 'notes'
  ];
  v_customers text[];
  v_bookings text[];
  v_count integer;
BEGIN
  SELECT coalesce(array_agg(id::text), '{}') INTO v_customers FROM unnest(p_customer_ids) id WHERE id IS NOT NULL;
  SELECT coalesce(array_agg(id::text), '{}') INTO v_bookings FROM unnest(p_booking_ids) id WHERE id IS NOT NULL;
  IF cardinality(v_customers) = 0 AND cardinality(v_bookings) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM set_config('app.gdpr_audit_scrub', 'on', true);

  UPDATE public.audit_logs a
  SET old_values = CASE WHEN jsonb_typeof(a.old_values) = 'object' THEN a.old_values - v_keys ELSE a.old_values END,
      new_values = CASE WHEN jsonb_typeof(a.new_values) = 'object' THEN a.new_values - v_keys ELSE a.new_values END,
      additional_info = CASE WHEN jsonb_typeof(a.additional_info) = 'object' THEN a.additional_info - v_keys ELSE a.additional_info END
  WHERE (
      (a.resource_type = 'customer' AND (
        a.resource_id = ANY (v_customers)
        OR a.additional_info->>'loser_id' = ANY (v_customers)
        OR a.additional_info->>'winner_id' = ANY (v_customers)))
      OR (a.resource_type IN ('booking', 'event_booking') AND (
        a.resource_id = ANY (v_bookings)
        OR a.additional_info->>'customerId' = ANY (v_customers)
        OR a.additional_info->>'customer_id' = ANY (v_customers)))
    )
    AND (
      (jsonb_typeof(a.old_values) = 'object' AND a.old_values ?| v_keys)
      OR (jsonb_typeof(a.new_values) = 'object' AND a.new_values ?| v_keys)
      OR (jsonb_typeof(a.additional_info) = 'object' AND a.additional_info ?| v_keys)
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM set_config('app.gdpr_audit_scrub', '', true);
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.gdpr_scrub_audit_logs_v01(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gdpr_scrub_audit_logs_v01(uuid[], uuid[]) TO service_role;

-- Prove it: the scrub is service_role only, and the trigger keeps its search_path.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.gdpr_scrub_audit_logs_v01(uuid[], uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.gdpr_scrub_audit_logs_v01(uuid[], uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'gdpr_scrub_audit_logs_v01 is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.gdpr_scrub_audit_logs_v01(uuid[], uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'gdpr_scrub_audit_logs_v01 is not executable by service_role';
  END IF;
  IF (SELECT proconfig FROM pg_proc WHERE oid = 'public.prevent_audit_log_update()'::regprocedure)
     IS DISTINCT FROM ARRAY['search_path=public, pg_catalog'] THEN
    RAISE EXCEPTION 'prevent_audit_log_update lost its search_path';
  END IF;
END;
$$;
