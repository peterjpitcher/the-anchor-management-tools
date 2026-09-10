-- Additive schema; existing bookings and locked item prices are preserved.
SET lock_timeout = '5s';
ALTER TABLE public.events ADD COLUMN online_discount_ends_at timestamptz;
ALTER TABLE public.events ADD COLUMN booking_questions jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.bookings ADD COLUMN attendees jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.events ADD CONSTRAINT events_booking_questions_array CHECK (jsonb_typeof(booking_questions) = 'array' AND jsonb_array_length(booking_questions) <= 20);
ALTER TABLE public.bookings ADD CONSTRAINT bookings_attendees_array CHECK (jsonb_typeof(attendees) = 'array');

-- Repair upcoming single-Standard mismatches from the event's existing full price.
-- This changes ticket configuration only, never historical booking_items prices.
UPDATE public.event_ticket_types t SET base_price = coalesce(nullif(e.price_per_seat,0),e.price,0)
FROM public.events e WHERE e.id=t.event_id AND e.date>=current_date
AND t.name='Standard' AND t.is_active AND t.base_price=0
AND coalesce(nullif(e.price_per_seat,0),e.price,0)>0
AND (SELECT count(*) FROM public.event_ticket_types other WHERE other.event_id=e.id AND other.is_active)=1;

CREATE OR REPLACE FUNCTION public.sync_booking_default_item_v01(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_id uuid; v_seats integer; v_reminder boolean;
  v_type_id uuid; v_base numeric; v_disc_type text; v_disc_val numeric; v_pmode text; v_deadline timestamptz;
  v_unit numeric(10,2); v_nondefault integer;
begin
  if coalesce(current_setting('ams.skip_default_item', true), '') = 'on' then
    return;
  end if;

  select event_id, seats, is_reminder_only
    into v_event_id, v_seats, v_reminder
  from public.bookings where id = p_booking_id;
  if not found then return; end if;

  if coalesce(v_reminder, false) or v_seats is null or v_seats < 1 then
    delete from public.booking_items where booking_id = p_booking_id;
    return;
  end if;

  select id into v_type_id
  from public.event_ticket_types
  where event_id = v_event_id and is_active
  order by sort_order, created_at
  limit 1;

  if v_type_id is null then
    select coalesce(nullif(price_per_seat, 0), nullif(price, 0), 0) into v_base
    from public.events where id = v_event_id;
    insert into public.event_ticket_types (event_id, name, base_price, sort_order, is_active)
    values (v_event_id, 'Standard', coalesce(v_base, 0), 0, true)
    returning id into v_type_id;
  end if;

  select count(*) into v_nondefault
  from public.booking_items
  where booking_id = p_booking_id and ticket_type_id <> v_type_id;
  if v_nondefault > 0 then return; end if;

  select t.base_price, e.online_discount_type, e.online_discount_value, e.payment_mode, e.online_discount_ends_at
    into v_base, v_disc_type, v_disc_val, v_pmode, v_deadline
  from public.events e join public.event_ticket_types t on t.id = v_type_id where e.id = v_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' or v_deadline <= now() then v_disc_type := null; v_disc_val := null; end if;
  v_unit := public.event_ticket_type_unit_price(coalesce(v_base, 0), v_disc_type, v_disc_val);

  insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
  values (p_booking_id, v_type_id, v_seats, v_unit)
  on conflict (booking_id, ticket_type_id)
    do update set quantity = excluded.quantity;
end $function$;

CREATE OR REPLACE FUNCTION public.create_event_booking_v07(p_event_id uuid, p_customer_id uuid, p_source text, p_seating_preference text, p_payment_hold_minutes integer, p_ticket_selections jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total integer;
  v_result jsonb;
  v_booking_id uuid;
  v_sel jsonb;
  v_type_id uuid; v_base numeric; v_cap integer;
  v_disc_type text; v_disc_val numeric; v_pmode text; v_deadline timestamptz;
  v_unit numeric(10,2);
  v_names text[]; v_all_names text[] := '{}';
  v_remaining integer;
begin
  if p_ticket_selections is null or jsonb_typeof(p_ticket_selections) <> 'array'
     or jsonb_array_length(p_ticket_selections) = 0 then
    return jsonb_build_object('state', 'blocked', 'reason', 'no_ticket_selections');
  end if;

  select coalesce(sum((s->>'quantity')::int), 0) into v_total
  from jsonb_array_elements(p_ticket_selections) s;
  if v_total < 1 then
    return jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  end if;

  select online_discount_type, online_discount_value, payment_mode, online_discount_ends_at
    into v_disc_type, v_disc_val, v_pmode, v_deadline
  from public.events where id = p_event_id for update;
  if coalesce(v_pmode, 'free') <> 'prepaid' or v_deadline <= now() then v_disc_type := null; v_disc_val := null; end if;

  perform set_config('ams.skip_default_item', 'on', true);
  v_result := public.create_event_booking_v06(
    p_event_id, p_customer_id, v_total, p_source, p_seating_preference, p_payment_hold_minutes
  );
  perform set_config('ams.skip_default_item', '', true);

  v_booking_id := (v_result->>'booking_id')::uuid;

  -- Only proceed when v05/v06 actually CREATED a booking. Blocked responses can
  -- still carry a booking_id (state='blocked', reason='customer_conflict' returns
  -- the customer's EXISTING active booking) , mutating that booking's lines here
  -- corrupted live bookings and made every retry-with-active-hold fail hard.
  if v_booking_id is null
     or (v_result->>'state') not in ('pending_payment', 'confirmed') then
    return v_result;
  end if;

  -- Defensive: the new basket defines this booking's lines in full.
  delete from public.booking_items where booking_id = v_booking_id;

  for v_sel in select value from jsonb_array_elements(p_ticket_selections) loop
    select id, coalesce(base_price, 0), capacity into v_type_id, v_base, v_cap
    from public.event_ticket_types
    where id = (v_sel->>'ticket_type_id')::uuid and event_id = p_event_id and is_active;
    if v_type_id is null then
      raise exception 'invalid_ticket_type % for event %', v_sel->>'ticket_type_id', p_event_id;
    end if;

    if v_cap is not null then
      select remaining into v_remaining
      from public.get_event_ticket_type_capacity_v01(p_event_id)
      where ticket_type_id = v_type_id;
      if coalesce(v_remaining, 0) < (v_sel->>'quantity')::int then
        raise exception 'ticket_type_capacity_exceeded:%', v_type_id;
      end if;
    end if;

    v_unit := public.event_ticket_type_unit_price(v_base, v_disc_type, v_disc_val);
    v_names := coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_sel->'attendee_names', '[]'::jsonb)) x),
      '{}');

    insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price, attendee_names)
    values (v_booking_id, v_type_id, (v_sel->>'quantity')::int, v_unit, v_names);

    v_all_names := v_all_names || v_names;
  end loop;

  update public.bookings
  set attendee_names = case when cardinality(v_all_names) > 0 then v_all_names else null end
  where id = v_booking_id;

  return v_result;
end $function$;

CREATE FUNCTION public.sync_event_ticket_price_v01() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event_id uuid; v_price numeric; v_has_paid boolean;
BEGIN
  v_event_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  SELECT base_price INTO v_price FROM public.event_ticket_types
  WHERE event_id=v_event_id AND is_active ORDER BY sort_order,created_at,id LIMIT 1;
  IF FOUND THEN
    SELECT EXISTS (SELECT 1 FROM public.event_ticket_types WHERE event_id=v_event_id AND is_active AND base_price>0) INTO v_has_paid;
    UPDATE public.events SET price=v_price,price_per_seat=v_price,is_free=NOT v_has_paid,
      payment_mode=CASE WHEN v_has_paid AND payment_mode='free' THEN 'cash_only' ELSE payment_mode END
    WHERE id=v_event_id AND (price IS DISTINCT FROM v_price OR price_per_seat IS DISTINCT FROM v_price OR is_free IS DISTINCT FROM NOT v_has_paid);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER sync_event_ticket_price AFTER INSERT OR UPDATE OF base_price,is_active,sort_order OR DELETE
ON public.event_ticket_types FOR EACH ROW EXECUTE FUNCTION public.sync_event_ticket_price_v01();

CREATE FUNCTION public.initialise_event_ticket_v01() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.event_ticket_types(event_id,name,base_price,sort_order,is_active)
  VALUES (NEW.id,'Standard',coalesce(nullif(NEW.price_per_seat,0),NEW.price,0),0,true);
  RETURN NULL;
END $$;
CREATE TRIGGER initialise_event_ticket AFTER INSERT ON public.events
FOR EACH ROW EXECUTE FUNCTION public.initialise_event_ticket_v01();

CREATE FUNCTION public.create_event_booking_v08(
 p_event_id uuid,p_customer_id uuid,p_seats integer,p_source text,p_seating_preference text,
 p_payment_hold_minutes integer,p_ticket_selections jsonb,p_attendees jsonb,p_expected_total numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
   v_result := v_result || jsonb_build_object('state','confirmed','hold_expires_at',NULL);
 END IF;
 IF jsonb_array_length(v_saved)>0 THEN
   UPDATE public.bookings SET attendees=v_saved,attendee_names=v_names WHERE id=v_booking_id;
   UPDATE public.booking_items bi SET attendee_names=(SELECT array_agg(a->>'name') FROM jsonb_array_elements(v_saved) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id) WHERE bi.booking_id=v_booking_id;
 END IF;
 RETURN v_result;
END $$;

REVOKE ALL ON FUNCTION public.create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric) TO service_role;
REVOKE ALL ON FUNCTION public.sync_event_ticket_price_v01(), public.initialise_event_ticket_v01(), public.sync_booking_default_item_v01(uuid), public.create_event_booking_v07(uuid,uuid,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_ticket_price_v01(), public.initialise_event_ticket_v01(), public.sync_booking_default_item_v01(uuid), public.create_event_booking_v07(uuid,uuid,text,text,integer,jsonb) TO service_role;


CREATE FUNCTION public.sync_event_legacy_price_v01() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
 IF pg_trigger_depth()>1 OR NEW.price IS NOT DISTINCT FROM OLD.price THEN RETURN NULL; END IF;
 SELECT id INTO v_id FROM public.event_ticket_types WHERE event_id=NEW.id AND is_active ORDER BY sort_order,created_at,id LIMIT 1;
 UPDATE public.event_ticket_types SET base_price=coalesce(NEW.price,0) WHERE id=v_id AND base_price IS DISTINCT FROM coalesce(NEW.price,0);
 RETURN NULL;
END $$;
CREATE TRIGGER sync_event_legacy_price AFTER UPDATE OF price ON public.events FOR EACH ROW EXECUTE FUNCTION public.sync_event_legacy_price_v01();

CREATE FUNCTION public.sync_booking_attendee_names_v01() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NEW.attendees IS NOT DISTINCT FROM OLD.attendees THEN RETURN NEW; END IF;
 NEW.attendee_names := (SELECT array_agg(a->>'name') FROM jsonb_array_elements(NEW.attendees) a);
 UPDATE public.booking_items bi SET attendee_names=coalesce((SELECT array_agg(a->>'name') FROM jsonb_array_elements(NEW.attendees) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id),'{}') WHERE bi.booking_id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER sync_booking_attendee_names BEFORE UPDATE OF attendees ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.sync_booking_attendee_names_v01();
REVOKE ALL ON FUNCTION public.sync_event_legacy_price_v01(),public.sync_booking_attendee_names_v01() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_legacy_price_v01(),public.sync_booking_attendee_names_v01() TO service_role;

ALTER TABLE public.bookings ADD COLUMN ticket_price_locked boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.mark_booking_ticket_price_locked_v01() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.ticket_price_locked := true; RETURN NEW; END $$;
CREATE TRIGGER mark_booking_ticket_price_locked BEFORE INSERT ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.mark_booking_ticket_price_locked_v01();
REVOKE ALL ON FUNCTION public.mark_booking_ticket_price_locked_v01() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_ticket_price_locked_v01() TO service_role;

-- Align the legacy display fields after repairing sole Standard tickets.
UPDATE public.events e SET price_per_seat=t.base_price,price=t.base_price
FROM public.event_ticket_types t WHERE t.event_id=e.id AND e.date>=current_date
AND t.name='Standard' AND t.is_active AND t.base_price>0
AND t.base_price=coalesce(nullif(e.price_per_seat,0),e.price,0)
AND (SELECT count(*) FROM public.event_ticket_types other WHERE other.event_id=e.id AND other.is_active)=1;


CREATE FUNCTION public.guard_event_last_ticket_v01() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.is_active AND (TG_OP='DELETE' OR NOT NEW.is_active) THEN
   PERFORM 1 FROM public.events WHERE id=OLD.event_id FOR UPDATE;
   IF NOT FOUND THEN RETURN OLD; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.event_ticket_types WHERE event_id=OLD.event_id AND is_active AND id<>OLD.id) THEN
     RAISE EXCEPTION 'last_active_ticket_type';
   END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER guard_event_last_ticket BEFORE UPDATE OF is_active OR DELETE ON public.event_ticket_types
FOR EACH ROW EXECUTE FUNCTION public.guard_event_last_ticket_v01();

CREATE FUNCTION public.guard_booking_attendee_count_v01() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF jsonb_array_length(OLD.attendees)>0 AND NEW.seats IS DISTINCT FROM OLD.seats
 AND jsonb_array_length(NEW.attendees) IS DISTINCT FROM NEW.seats THEN
   RAISE EXCEPTION 'attendee_count_mismatch';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_booking_attendee_count BEFORE UPDATE OF seats,attendees ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.guard_booking_attendee_count_v01();
REVOKE ALL ON FUNCTION public.guard_event_last_ticket_v01(),public.guard_booking_attendee_count_v01() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_event_last_ticket_v01(),public.guard_booking_attendee_count_v01() TO service_role;
RESET lock_timeout;
