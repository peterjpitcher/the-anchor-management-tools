-- A phone number for each ticket holder, and guest details on every booking channel
-- (BK-013 and BK-011, customer bookings review of 24 October 2026; owner decision D5).
--
-- create_event_booking_v08 saves a name, a ticket type and the event's answers for each guest.
-- A phone sent with a guest was silently dropped, and a booking taken by staff, at the bar or by
-- text could only carry guest rows if every one had a name and every required answer, so staff
-- could not save what they knew and leave the rest "to follow".
--
-- create_event_booking_v09 is v08 with two changes:
--   1. Each guest may carry a phone. It is optional (D5: people book for friends whose numbers
--      they do not have), must already be E.164 (the app normalises it first), and is stored on
--      that guest only, in bookings.attendees. Nothing copies it to customers, and no message
--      or marketing module reads it (tests/guards/guest-phone-isolation.test.ts).
--   2. A booking that is not from the website (staff, FOH, text reply, walk-in) may save guests
--      with a blank name or a blank required answer: "details to follow". The booker completes
--      them from their manage link, or staff from the event page; the event page counts the
--      tickets still missing details. Website bookings keep every rule they have today.
--
-- create_event_booking_with_attendees_and_requests_v02 is v01 calling v09 (v01 calls v08 by
-- name). Both new functions take production's settings and grants for their predecessors:
-- v09 SECURITY DEFINER with search_path public, the wrapper SECURITY INVOKER with an empty
-- search_path, both service_role only (since 20261026181322 booking functions are server only).
-- v08 and the v01 wrapper are left exactly as production holds them (v08 md5
-- 964657f32c2efbacce2a40565e20118f, wrapper md5 51828dea749b998a6979a67c18ee8184, checked
-- 27 October 2026), so reverting the app is the rollback for behaviour.
--
-- No live data changes: two functions are added, nothing is altered, backfilled or deleted.
--
-- Deploy order: this migration, then the app (which calls the new names), then the website.
-- Rollback: tasks/event-guest-phone-and-details-to-follow/rollback.sql (revert the app first).
-- Tested by scripts/testing/event-guest-phone-and-details-to-follow-postgres.py.

CREATE OR REPLACE FUNCTION public.create_event_booking_v09(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text, p_seating_preference text, p_payment_hold_minutes integer, p_ticket_selections jsonb, p_attendees jsonb, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 v_event record; v_attendee jsonb; v_question jsonb; v_value text; v_answers jsonb;
 v_saved jsonb := '[]'; v_names text[] := '{}'; v_result jsonb; v_booking_id uuid;
 v_type_id uuid; v_id uuid; v_ids uuid[] := '{}'; v_total integer; v_selection jsonb;
 v_required boolean; v_has_selections boolean; v_default uuid; v_total_price numeric;
 v_website boolean; v_name text; v_phone text;
BEGIN
 SELECT payment_mode,price,price_per_seat,booking_questions,collect_guest_details INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked','reason','event_not_found'); END IF;
 IF p_seats IS NULL OR p_seats < 1 THEN RETURN jsonb_build_object('state','blocked','reason','invalid_seats'); END IF;
 v_has_selections := p_ticket_selections IS NOT NULL AND p_ticket_selections <> '[]'::jsonb;
 IF v_has_selections THEN
   IF jsonb_typeof(p_ticket_selections) <> 'array' THEN RAISE EXCEPTION 'invalid_ticket_selections'; END IF;
   SELECT sum((s->>'quantity')::integer) INTO v_total FROM jsonb_array_elements(p_ticket_selections) s;
   IF v_total IS DISTINCT FROM p_seats THEN RAISE EXCEPTION 'attendee_quantity_mismatch'; END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_ticket_selections) s WHERE coalesce((s->>'quantity')::integer,0)<1)
     OR (SELECT count(DISTINCT s->>'ticket_type_id') FROM jsonb_array_elements(p_ticket_selections) s) <> jsonb_array_length(p_ticket_selections)
   THEN RAISE EXCEPTION 'invalid_ticket_selections'; END IF;
 END IF;
 SELECT id INTO v_default FROM public.event_ticket_types WHERE event_id=p_event_id AND is_active ORDER BY sort_order,created_at,id LIMIT 1;
 -- BK-014: the event's own setting decides whether a website booking needs a name and the
 -- event's answers for every ticket. Unset follows owner decision D4: paid online in advance.
 v_website := coalesce(nullif(trim(p_source),''),'brand_site')='brand_site';
 v_required := v_website AND coalesce(v_event.collect_guest_details, v_event.payment_mode='prepaid');
 p_attendees := coalesce(p_attendees,'[]'::jsonb);
 IF jsonb_typeof(p_attendees)<>'array' THEN RAISE EXCEPTION 'invalid_attendees'; END IF;
 IF (v_required OR jsonb_array_length(p_attendees)>0) AND jsonb_array_length(p_attendees)<>p_seats THEN RAISE EXCEPTION 'attendee_count_mismatch'; END IF;
 FOR v_attendee IN SELECT value FROM jsonb_array_elements(p_attendees) LOOP
   v_id := (v_attendee->>'id')::uuid;
   IF v_id IS NULL OR v_id=ANY(v_ids) THEN RAISE EXCEPTION 'invalid_attendee_id'; END IF;
   v_ids := array_append(v_ids,v_id);
   v_name := trim(coalesce(v_attendee->>'name',''));
   -- BK-011, D5: staff, FOH and text bookings may leave a name to follow; the website may not.
   IF length(v_name)>120 OR (v_website AND length(v_name)<1) THEN RAISE EXCEPTION 'attendee_name_required'; END IF;
   -- BK-013, D5: an optional phone for this guest, already normalised to E.164 by the app.
   v_phone := nullif(trim(coalesce(v_attendee->>'phone','')),'');
   IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'invalid_attendee_phone'; END IF;
   v_type_id := coalesce(nullif(v_attendee->>'ticket_type_id','')::uuid,v_default);
   IF v_type_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.event_ticket_types WHERE id=v_type_id AND event_id=p_event_id AND is_active) THEN RAISE EXCEPTION 'invalid_attendee_ticket_type'; END IF;
   IF NOT v_has_selections AND v_type_id<>v_default THEN RAISE EXCEPTION 'invalid_attendee_ticket_type'; END IF;
   IF jsonb_typeof(coalesce(v_attendee->'answers','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'invalid_attendee_answers'; END IF;
   IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(v_attendee->'answers','{}'::jsonb)) k WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_event.booking_questions) q WHERE q->>'id'=k)) THEN RAISE EXCEPTION 'unknown_attendee_question'; END IF;
   v_answers := '[]'::jsonb;
   FOR v_question IN SELECT value FROM jsonb_array_elements(v_event.booking_questions) LOOP
     v_value := trim(coalesce(v_attendee->'answers'->>(v_question->>'id'),''));
     IF length(v_value)>2000 THEN RAISE EXCEPTION 'attendee_answer_too_long'; END IF;
     -- A required answer may follow on a staff booking (D5); the website must give it.
     IF v_website AND coalesce((v_question->>'required')::boolean,false) AND v_value='' THEN RAISE EXCEPTION 'attendee_answer_required'; END IF;
     IF v_value<>'' AND v_question->>'type'='yes_no' AND v_value NOT IN ('yes','no') THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
     IF v_value<>'' AND v_question->>'type'='choice' AND NOT coalesce((v_question->'options') ? v_value,false) THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
     v_answers := v_answers || jsonb_build_array(jsonb_build_object('question_id',v_question->>'id','label',v_question->>'label','type',v_question->>'type','required',coalesce((v_question->>'required')::boolean,false),'options',coalesce(v_question->'options','[]'::jsonb),'value',v_value));
   END LOOP;
   -- BK-017: the booker confirmed everyone they added is happy to share these details.
   v_saved := v_saved || jsonb_build_array(jsonb_build_object('id',v_id,'name',v_name,'ticket_type_id',v_type_id,'answers',v_answers)
     || CASE WHEN v_phone IS NOT NULL THEN jsonb_build_object('phone',v_phone) ELSE '{}'::jsonb END
     || CASE WHEN v_attendee->'details_confirmed'='true'::jsonb THEN jsonb_build_object('details_confirmed_at',now()) ELSE '{}'::jsonb END);
   -- The legacy name list only holds names that were given.
   IF v_name<>'' THEN v_names := array_append(v_names,v_name); END IF;
 END LOOP;
 IF v_has_selections THEN
   IF jsonb_array_length(v_saved)>0 THEN
     FOR v_selection IN SELECT value FROM jsonb_array_elements(p_ticket_selections) LOOP
       IF (SELECT count(*) FROM jsonb_array_elements(v_saved) a WHERE a->>'ticket_type_id'=v_selection->>'ticket_type_id') <> (v_selection->>'quantity')::integer THEN RAISE EXCEPTION 'attendee_ticket_quantity_mismatch'; END IF;
     END LOOP;
   END IF;
   v_result := public.create_event_booking_v07(p_event_id,p_customer_id,p_source,p_seating_preference,p_payment_hold_minutes,p_ticket_selections);
 ELSE
   v_result := public.create_event_booking_v06(p_event_id,p_customer_id,p_seats,p_source,p_seating_preference,p_payment_hold_minutes);
 END IF;
 IF coalesce(v_result->>'state','') NOT IN ('confirmed','pending_payment') THEN RETURN v_result; END IF;
 v_booking_id := (v_result->>'booking_id')::uuid;
 IF v_booking_id IS NULL THEN RAISE EXCEPTION 'booking_creation_missing_id'; END IF;
 SELECT sum(quantity*unit_price) INTO v_total_price FROM public.booking_items WHERE booking_id=v_booking_id;
 IF p_expected_total IS NOT NULL AND v_total_price IS DISTINCT FROM p_expected_total THEN RAISE EXCEPTION 'price_changed'; END IF;
 IF v_total_price IS NULL THEN RAISE EXCEPTION 'booking_price_missing'; END IF;
 -- An explicitly free ticket basket needs no PayPal order, even when other
 -- ticket types on this event are prepaid.
 IF v_total_price=0 AND v_result->>'state'='pending_payment' THEN
   UPDATE public.bookings SET status='confirmed',hold_expires_at=NULL,updated_at=now() WHERE id=v_booking_id;
   UPDATE public.booking_holds SET status='consumed',consumed_at=now(),updated_at=now()
   WHERE event_booking_id=v_booking_id AND hold_type='payment_hold' AND status='active';
   UPDATE public.table_bookings SET status='confirmed',hold_expires_at=NULL,confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
   WHERE event_booking_id=v_booking_id AND status='pending_payment';
   v_result := v_result || jsonb_build_object('state','confirmed','hold_expires_at',NULL);
 END IF;
 IF jsonb_array_length(v_saved)>0 THEN
   UPDATE public.bookings SET attendees=v_saved,attendee_names=v_names WHERE id=v_booking_id;
   UPDATE public.booking_items bi SET attendee_names=(SELECT array_agg(a->>'name') FILTER (WHERE a->>'name'<>'') FROM jsonb_array_elements(v_saved) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id) WHERE bi.booking_id=v_booking_id;
 END IF;
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.create_event_booking_with_attendees_and_requests_v02(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text DEFAULT 'brand_site'::text, p_seating_preference text DEFAULT 'seated'::text, p_payment_hold_minutes integer DEFAULT NULL::integer, p_ticket_selections jsonb DEFAULT NULL::jsonb, p_dining_request text DEFAULT NULL::text, p_early_arrival_request boolean DEFAULT false, p_attendees jsonb DEFAULT NULL::jsonb, p_expected_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
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

  v_result := public.create_event_booking_v09(
    p_event_id, p_customer_id, p_seats, p_source, p_seating_preference,
    p_payment_hold_minutes, p_ticket_selections, p_attendees, p_expected_total
  );

  -- Conflicts can contain the ID of an EXISTING booking. Never change it.
  -- Only these explicit states are new successful creates in v09.
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

REVOKE ALL ON FUNCTION public.create_event_booking_v09(uuid, uuid, integer, text, text, integer, jsonb, jsonb, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v09(uuid, uuid, integer, text, text, integer, jsonb, jsonb, numeric) TO service_role;
REVOKE ALL ON FUNCTION public.create_event_booking_with_attendees_and_requests_v02(uuid, uuid, integer, text, text, integer, jsonb, text, boolean, jsonb, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_with_attendees_and_requests_v02(uuid, uuid, integer, text, text, integer, jsonb, text, boolean, jsonb, numeric) TO service_role;

-- Prove it: the settings their predecessors hold, and service_role only.
DO $$
DECLARE
  v_fn regprocedure := 'public.create_event_booking_v09(uuid, uuid, integer, text, text, integer, jsonb, jsonb, numeric)'::regprocedure;
  v_wrapper regprocedure := 'public.create_event_booking_with_attendees_and_requests_v02(uuid, uuid, integer, text, text, integer, jsonb, text, boolean, jsonb, numeric)'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = v_fn) THEN
    RAISE EXCEPTION 'create_event_booking_v09 is not SECURITY DEFINER with search_path public';
  END IF;
  IF NOT (SELECT NOT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_wrapper) THEN
    RAISE EXCEPTION 'create_event_booking_with_attendees_and_requests_v02 is not SECURITY INVOKER with an empty search_path';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
    OR has_function_privilege('anon', v_wrapper, 'EXECUTE') OR has_function_privilege('authenticated', v_wrapper, 'EXECUTE') THEN
    RAISE EXCEPTION 'a new event booking function is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') OR NOT has_function_privilege('service_role', v_wrapper, 'EXECUTE') THEN
    RAISE EXCEPTION 'a new event booking function is not executable by service_role';
  END IF;
END;
$$;
