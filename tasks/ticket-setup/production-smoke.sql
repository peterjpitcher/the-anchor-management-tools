-- Apply neither schema nor durable test data. Run only after the approved migrations.
-- The inner exception subtransaction rolls back every fixture and booking.
-- No phone/email, external provider, job runner or customer message is used.
DO $smoke$
DECLARE
  v_event uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_combined uuid := gen_random_uuid();
  v_question uuid := gen_random_uuid();
  v_type uuid;
  v_guest jsonb;
  v_result jsonb;
  v_booking uuid;
  v_checks jsonb := '[]';
BEGIN
  BEGIN
    SET LOCAL ROLE service_role;
    INSERT INTO public.customers(id,first_name,last_name,sms_status,marketing_sms_opt_in,marketing_email_opt_in)
    VALUES (v_customer,'Ticket smoke','Synthetic','opted_out',false,false),
      (v_other,'Ticket smoke','Synthetic retry','opted_out',false,false),
      (v_combined,'Ticket smoke','Synthetic dining','opted_out',false,false);
    INSERT INTO public.events(id,name,slug,date,time,booking_mode,capacity,payment_mode,price,price_per_seat,is_free,online_discount_type,online_discount_value,online_discount_ends_at,promo_sms_enabled,booking_questions)
    VALUES (v_event,'Synthetic ticket smoke, rolled back','ticket-smoke-'||v_event,
      (now() AT TIME ZONE 'Europe/London')::date+30,'18:00','general',10,'prepaid',45,45,false,'fixed',5,now()+interval '1 day',false,
      jsonb_build_array(jsonb_build_object('id',v_question,'label','Synthetic required answer','type','text','required',true)));
    SELECT id INTO STRICT v_type FROM public.event_ticket_types WHERE event_id=v_event AND is_active;
    IF (SELECT base_price FROM public.event_ticket_types WHERE id=v_type) <> 45 THEN RAISE EXCEPTION 'Standard initial price failed'; END IF;
    v_guest := jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'name','Synthetic Guest','ticket_type_id',v_type,'answers',jsonb_build_object(v_question::text,'none')));
    BEGIN
      PERFORM public.create_event_booking_v08(v_event,v_customer,1,'brand_site','seated',15,null,'[]',40);
      RAISE EXCEPTION 'Missing guest unexpectedly accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'attendee_count_mismatch' THEN RAISE; END IF;
    END;
    BEGIN
      PERFORM public.create_event_booking_v08(v_event,v_customer,1,'brand_site','seated',15,null,v_guest,39);
      RAISE EXCEPTION 'Changed price unexpectedly accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'price_changed' THEN RAISE; END IF;
    END;
    IF EXISTS (SELECT 1 FROM public.bookings WHERE event_id=v_event) THEN RAISE EXCEPTION 'Rejected booking was persisted'; END IF;
    v_checks := v_checks || '"invalid guests and changed price roll back"'::jsonb;
    v_result := public.create_event_booking_v08(v_event,v_customer,1,'brand_site','seated',15,null,v_guest,40);
    IF v_result->>'state' <> 'pending_payment' THEN RAISE EXCEPTION 'Paid booking failed: %',v_result; END IF;
    v_booking := (v_result->>'booking_id')::uuid;
    IF NOT (SELECT ticket_price_locked AND jsonb_array_length(attendees)=1 AND attendee_names=ARRAY['Synthetic Guest'] FROM public.bookings WHERE id=v_booking) THEN RAISE EXCEPTION 'Guest snapshot missing'; END IF;
    IF (SELECT sum(quantity*unit_price) FROM public.booking_items WHERE booking_id=v_booking) <> 40 THEN RAISE EXCEPTION 'Discount price incorrect'; END IF;
    v_result := public.create_event_booking_v08(v_event,v_customer,1,'brand_site','seated',15,null,v_guest,40);
    IF v_result->>'state'<>'blocked' OR v_result->>'reason'<>'customer_conflict' THEN RAISE EXCEPTION 'Retry gate failed'; END IF;
    v_checks := v_checks || '"paid hold, guest snapshot, price and retry gate"'::jsonb;
    v_result := public.create_event_booking_with_attendees_and_requests_v01(v_event,v_combined,1,'brand_site','seated',15,null,'before_event',true,v_guest,40);
    IF v_result->>'state'<>'pending_payment' OR NOT (v_result->>'requests_recorded')::boolean THEN RAISE EXCEPTION 'Combined booking failed: %',v_result; END IF;
    IF NOT (SELECT jsonb_array_length(attendees)=1 AND notes LIKE '%food before the event.%arriving early.%' FROM public.bookings WHERE id=(v_result->>'booking_id')::uuid) THEN RAISE EXCEPTION 'Combined guest and request persistence failed'; END IF;
    v_result := public.create_event_booking_with_attendees_and_requests_v01(v_event,v_combined,1,'brand_site','seated',15,null,'during_event',false,v_guest,40);
    IF v_result->>'reason'<>'customer_conflict' OR (v_result->>'requests_recorded')::boolean IS TRUE THEN RAISE EXCEPTION 'Combined retry gate failed'; END IF;
    IF EXISTS(SELECT 1 FROM public.bookings WHERE event_id=v_event AND customer_id=v_combined AND notes LIKE '%during the event%') THEN RAISE EXCEPTION 'Combined retry overwrote notes'; END IF;
    v_checks := v_checks || '"combined guest and dining request, retry gate"'::jsonb;
    UPDATE public.events SET online_discount_ends_at=now()-interval '1 minute' WHERE id=v_event;
    v_result := public.create_event_booking_v08(v_event,v_other,1,'brand_site','seated',15,
      jsonb_build_array(jsonb_build_object('ticket_type_id',v_type,'quantity',1)),v_guest,45);
    IF v_result->>'state'<>'pending_payment' THEN RAISE EXCEPTION 'Expired discount booking failed'; END IF;
    IF (SELECT sum(quantity*unit_price) FROM public.booking_items WHERE booking_id=(v_result->>'booking_id')::uuid) <> 45 THEN RAISE EXCEPTION 'Expired discount still used'; END IF;
    IF (SELECT sum(quantity*unit_price) FROM public.booking_items WHERE booking_id=v_booking) <> 40 THEN RAISE EXCEPTION 'Existing hold repriced'; END IF;
    UPDATE public.bookings SET attendees=jsonb_set(attendees,'{0,name}','"Synthetic Edited Guest"') WHERE id=v_booking;
    IF (SELECT attendee_names FROM public.bookings WHERE id=v_booking)<>ARRAY['Synthetic Edited Guest'] THEN RAISE EXCEPTION 'Guest name mirror failed'; END IF;
    UPDATE public.event_ticket_types SET base_price=46 WHERE id=v_type;
    IF (SELECT price FROM public.events WHERE id=v_event)<>46 THEN RAISE EXCEPTION 'Ticket price mirror failed'; END IF;
    UPDATE public.events SET price=47 WHERE id=v_event;
    IF (SELECT base_price FROM public.event_ticket_types WHERE id=v_type)<>47 THEN RAISE EXCEPTION 'Legacy price mirror failed'; END IF;
    v_checks := v_checks || '"deadline, old hold preservation and edit mirrors"'::jsonb;
    BEGIN
      UPDATE public.event_ticket_types SET is_active=false WHERE id=v_type;
      RAISE EXCEPTION 'Last active ticket removal accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'last_active_ticket_type' THEN RAISE; END IF;
    END;
    BEGIN
      UPDATE public.bookings SET seats=2 WHERE id=v_booking;
      RAISE EXCEPTION 'Guest count mismatch accepted';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'attendee_count_mismatch' THEN RAISE; END IF;
    END;
    SET CONSTRAINTS ALL IMMEDIATE;
    v_checks := v_checks || '"ticket and guest count guards, deferred constraints"'::jsonb;
    RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Rollback all synthetic ticket smoke data';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    IF EXISTS (SELECT 1 FROM public.events WHERE id=v_event)
      OR EXISTS (SELECT 1 FROM public.customers WHERE id IN (v_customer,v_other,v_combined))
      OR EXISTS (SELECT 1 FROM public.bookings WHERE event_id=v_event)
    THEN RAISE EXCEPTION 'Synthetic fixture rollback failed'; END IF;
    PERFORM set_config('ticket_smoke.result',(v_checks || '"all synthetic data rolled back"'::jsonb)::text,true);
  END;
END $smoke$;
SELECT current_setting('ticket_smoke.result')::jsonb AS passed_checks;
