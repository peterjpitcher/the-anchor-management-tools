-- Rollback for 20261026212313_booking_functions_server_only.sql: restores create_table_booking_public_v06 exactly as production held it
-- on 26 October 2026 and gives authenticated back EXECUTE on the thirteen functions. service_role
-- kept EXECUTE throughout; anon and PUBLIC held none before or after.

CREATE OR REPLACE FUNCTION public.create_table_booking_public_v06(p_customer_id uuid, p_booking_date date, p_booking_time time without time zone, p_party_size integer, p_booking_purpose text DEFAULT 'food'::text, p_notes text DEFAULT NULL::text, p_sunday_lunch boolean DEFAULT false, p_source text DEFAULT 'brand_site'::text, p_bypass_cutoff boolean DEFAULT false, p_deposit_waived boolean DEFAULT false, p_bypass_pacing boolean DEFAULT false, p_high_chair_count integer DEFAULT 0, p_outside_seating boolean DEFAULT false, p_requires_accessible_table boolean DEFAULT false, p_booking_period_id uuid DEFAULT NULL::uuid, p_booking_period_answer boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, p_booking_purpose,
    p_notes, p_sunday_lunch, p_source,
    -- A public caller cannot bypass the cut-off or pacing, whatever it passes.
    false, p_deposit_waived, false,
    p_high_chair_count, p_outside_seating, p_requires_accessible_table,
    'online', false,
    public.get_setting_int('table_booking_max_party_online', 20),
    NULL, NULL,
    p_booking_period_id, p_booking_period_answer
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_table_booking_v05(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_public_v06(uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean, boolean, integer, boolean, boolean, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_sunday_lunch_booking(uuid, date, time without time zone, integer, text, text[], text[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_table_booking_assignments_v05(uuid, uuid[], timestamp with time zone, timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability(date, time without time zone, integer, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_table_reservation_v05_legacy(uuid, uuid, uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_refund_amount(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_transaction(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_transaction(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_payment_transaction(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_customers_atomic(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_private_booking_transaction(jsonb, jsonb, jsonb) TO authenticated;
