-- Rollback for 20261027132851_event_collect_guest_details.sql: restores create_event_booking_v08
-- exactly as production held it on 26 October 2026 (md5(prosrc) bb05eb67c52cdb2f99c8e32a0b459ffc,
-- SECURITY DEFINER, search_path public, service_role only) and drops events.collect_guest_details.
--
-- Revert the app first: the booking route and /api/events read the column. Dropping it loses any
-- per-event setting a manager saved after the deploy, so note those first if you need them back.
-- Guest rows already stamped with details_confirmed_at keep the stamp; nothing reads it as a rule.

CREATE OR REPLACE FUNCTION public.create_event_booking_v08(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text, p_seating_preference text, p_payment_hold_minutes integer, p_ticket_selections jsonb, p_attendees jsonb, p_expected_total numeric DEFAULT NULL::numeric)
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
BEGIN
 SELECT payment_mode,price,price_per_seat,booking_questions INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
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
 v_required := coalesce(nullif(trim(p_source),''),'brand_site')='brand_site'
   AND (v_event.payment_mode='prepaid' OR jsonb_array_length(v_event.booking_questions)>0)
   AND (coalesce(v_event.price_per_seat,v_event.price,0)>0 OR EXISTS (SELECT 1 FROM public.event_ticket_types WHERE event_id=p_event_id AND is_active AND base_price>0));
 p_attendees := coalesce(p_attendees,'[]'::jsonb);
 IF jsonb_typeof(p_attendees)<>'array' THEN RAISE EXCEPTION 'invalid_attendees'; END IF;
 IF (v_required OR jsonb_array_length(p_attendees)>0) AND jsonb_array_length(p_attendees)<>p_seats THEN RAISE EXCEPTION 'attendee_count_mismatch'; END IF;
 FOR v_attendee IN SELECT value FROM jsonb_array_elements(p_attendees) LOOP
   v_id := (v_attendee->>'id')::uuid;
   IF v_id IS NULL OR v_id=ANY(v_ids) THEN RAISE EXCEPTION 'invalid_attendee_id'; END IF;
   v_ids := array_append(v_ids,v_id);
   IF length(trim(coalesce(v_attendee->>'name',''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'attendee_name_required'; END IF;
   v_type_id := coalesce(nullif(v_attendee->>'ticket_type_id','')::uuid,v_default);
   IF v_type_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.event_ticket_types WHERE id=v_type_id AND event_id=p_event_id AND is_active) THEN RAISE EXCEPTION 'invalid_attendee_ticket_type'; END IF;
   IF NOT v_has_selections AND v_type_id<>v_default THEN RAISE EXCEPTION 'invalid_attendee_ticket_type'; END IF;
   IF jsonb_typeof(coalesce(v_attendee->'answers','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'invalid_attendee_answers'; END IF;
   IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(v_attendee->'answers','{}'::jsonb)) k WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_event.booking_questions) q WHERE q->>'id'=k)) THEN RAISE EXCEPTION 'unknown_attendee_question'; END IF;
   v_answers := '[]'::jsonb;
   FOR v_question IN SELECT value FROM jsonb_array_elements(v_event.booking_questions) LOOP
     v_value := trim(coalesce(v_attendee->'answers'->>(v_question->>'id'),''));
     IF length(v_value)>2000 THEN RAISE EXCEPTION 'attendee_answer_too_long'; END IF;
     IF coalesce((v_question->>'required')::boolean,false) AND v_value='' THEN RAISE EXCEPTION 'attendee_answer_required'; END IF;
     IF v_value<>'' AND v_question->>'type'='yes_no' AND v_value NOT IN ('yes','no') THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
     IF v_value<>'' AND v_question->>'type'='choice' AND NOT coalesce((v_question->'options') ? v_value,false) THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
     v_answers := v_answers || jsonb_build_array(jsonb_build_object('question_id',v_question->>'id','label',v_question->>'label','type',v_question->>'type','required',coalesce((v_question->>'required')::boolean,false),'options',coalesce(v_question->'options','[]'::jsonb),'value',v_value));
   END LOOP;
   v_saved := v_saved || jsonb_build_array(jsonb_build_object('id',v_id,'name',trim(v_attendee->>'name'),'ticket_type_id',v_type_id,'answers',v_answers));
   v_names := array_append(v_names,trim(v_attendee->>'name'));
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
   UPDATE public.booking_items bi SET attendee_names=(SELECT array_agg(a->>'name') FROM jsonb_array_elements(v_saved) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id) WHERE bi.booking_id=v_booking_id;
 END IF;
 RETURN v_result;
END $function$;

REVOKE ALL ON FUNCTION public.create_event_booking_v08(uuid, uuid, integer, text, text, integer, jsonb, jsonb, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v08(uuid, uuid, integer, text, text, integer, jsonb, jsonb, numeric) TO service_role;

ALTER TABLE public.events DROP COLUMN IF EXISTS collect_guest_details;
