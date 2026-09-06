-- DRAFT: apply before deploying the optional event dining/arrival request UI.
-- Existing booking creation stays unchanged for callers without requests.
-- Requests and the new booking commit together, or both roll back.
CREATE OR REPLACE FUNCTION public.create_event_booking_with_requests_v01(
  p_event_id uuid,
  p_customer_id uuid,
  p_seats integer,
  p_source text DEFAULT 'brand_site',
  p_seating_preference text DEFAULT 'seated',
  p_payment_hold_minutes integer DEFAULT NULL,
  p_ticket_selections jsonb DEFAULT NULL,
  p_dining_request text DEFAULT NULL,
  p_early_arrival_request boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_booking_id uuid;
  v_notes text;
BEGIN
  IF p_dining_request IS NOT NULL AND p_dining_request NOT IN ('before_event', 'during_event', 'not_sure') THEN
    RAISE EXCEPTION 'invalid_dining_request' USING ERRCODE = '22023';
  END IF;

  v_notes := CASE p_dining_request
    WHEN 'before_event' THEN 'Guest asks about food before the event.'
    WHEN 'during_event' THEN 'Guest asks about food during the event.'
    WHEN 'not_sure' THEN 'Guest would like to discuss food options.'
    ELSE NULL
  END;
  IF COALESCE(p_early_arrival_request, false) THEN
    v_notes := concat_ws(' ', v_notes, 'Guest would like to discuss arriving early.');
  END IF;
  IF v_notes IS NOT NULL THEN
    v_notes := 'UNCONFIRMED REQUEST: ' || v_notes || ' Food availability and arrival arrangements must be agreed with the team. No separate dining booking has been made.';
  END IF;

  IF p_ticket_selections IS NOT NULL THEN
    v_result := public.create_event_booking_v07(
      p_event_id, p_customer_id, p_source, p_seating_preference,
      p_payment_hold_minutes, p_ticket_selections
    );
  ELSE
    v_result := public.create_event_booking_v06(
      p_event_id, p_customer_id, p_seats, p_source,
      p_seating_preference, p_payment_hold_minutes
    );
  END IF;

  -- Conflicts can contain the ID of an EXISTING booking. Never change it.
  -- Only these explicit states are new successful creates in v06 and v07.
  IF COALESCE(v_result->>'state', '') NOT IN ('confirmed', 'pending_payment') THEN
    RETURN v_result;
  END IF;
  IF v_notes IS NULL THEN
    RETURN v_result;
  END IF;

  v_booking_id := NULLIF(v_result->>'booking_id', '')::uuid;
  UPDATE public.bookings
  SET notes = concat_ws(E'\n', NULLIF(btrim(notes), ''), v_notes), updated_at = now()
  WHERE id = v_booking_id AND event_id = p_event_id AND customer_id = p_customer_id
    AND status IN ('confirmed', 'pending_payment');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_booking_request_persistence_failed';
  END IF;

  RETURN v_result || jsonb_build_object('requests_recorded', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_event_booking_with_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_with_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean) TO service_role;
COMMENT ON FUNCTION public.create_event_booking_with_requests_v01(uuid, uuid, integer, text, text, integer, jsonb, text, boolean) IS 'Service-only atomic event creation with unconfirmed dining and early-arrival requests in staff-visible booking notes.';
