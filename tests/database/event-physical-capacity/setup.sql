-- Isolated fixture only. Never execute against production.
\set ON_ERROR_STOP on
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE public.table_booking_status AS ENUM ('confirmed','pending_payment','pending_card_capture','cancelled','no_show','completed');
CREATE TYPE public.payment_status AS ENUM ('pending','completed','failed','refunded','cancelled');
CREATE TYPE public.table_booking_type AS ENUM ('regular','christmas','sunday_lunch');
CREATE TYPE public.table_allocation_overrides AS (ignore_minimum boolean,ignore_hold boolean,allow_unjoined boolean,ignore_accessibility boolean);
CREATE TABLE public.booking_holds (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"hold_type" text,
"event_booking_id" uuid,
"table_booking_id" uuid,
"waitlist_offer_id" uuid,
"seats_or_covers_held" int4,
"status" text,
"scheduled_sms_send_time" timestamptz,
"expires_at" timestamptz,
"created_at" timestamptz DEFAULT now(),
"updated_at" timestamptz DEFAULT now(),
"consumed_at" timestamptz,
"released_at" timestamptz
);
CREATE TABLE public.booking_table_assignments (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"table_booking_id" uuid,
"table_id" uuid,
"start_datetime" timestamptz,
"end_datetime" timestamptz,
"created_at" timestamptz DEFAULT now()
);
CREATE TABLE public.bookings (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"customer_id" uuid,
"event_id" uuid,
"seats" int4,
"created_at" timestamptz DEFAULT now(),
"notes" text,
"booking_source" text,
"last_reminder_sent" timestamptz,
"is_reminder_only" bool,
"status" text,
"source" text,
"updated_at" timestamptz DEFAULT now(),
"cancelled_at" timestamptz,
"cancelled_by" text,
"expired_at" timestamptz,
"hold_expires_at" timestamptz,
"review_sms_sent_at" timestamptz,
"review_clicked_at" timestamptz,
"review_window_closes_at" timestamptz,
"completed_at" timestamptz,
"review_suppressed_at" timestamptz,
"event_seating_type" text,
"attendee_names" text[],
"attendees" jsonb,
"ticket_price_locked" bool
);
CREATE TABLE public.event_communal_seat_allocations (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"event_id" uuid,
"event_booking_id" uuid,
"table_booking_id" uuid,
"table_id" uuid,
"seats" int4,
"start_datetime" timestamptz,
"end_datetime" timestamptz,
"created_at" timestamptz DEFAULT now(),
"updated_at" timestamptz DEFAULT now()
);
CREATE TABLE public.events (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"name" text,
"date" date,
"time" text,
"created_at" timestamptz DEFAULT now(),
"capacity" int4,
"category_id" uuid,
"end_time" time,
"event_status" varchar,
"performer_name" varchar,
"performer_type" varchar,
"price" numeric,
"is_free" bool,
"booking_url" text,
"slug" varchar,
"short_description" text,
"long_description" text,
"highlights" jsonb,
"meta_title" varchar,
"meta_description" text,
"keywords" jsonb,
"hero_image_url" text,
"gallery_image_urls" jsonb,
"poster_image_url" text,
"thumbnail_image_url" text,
"promo_video_url" text,
"highlight_video_urls" jsonb,
"doors_time" time,
"duration_minutes" int4,
"last_entry_time" time,
"brief" text,
"facebook_event_name" text,
"facebook_event_description" text,
"gbp_event_title" text,
"gbp_event_description" text,
"opentable_experience_title" text,
"opentable_experience_description" text,
"start_datetime" timestamptz,
"payment_mode" text,
"price_per_seat" numeric,
"booking_open" bool,
"event_type" text,
"booking_mode" text,
"primary_keywords" jsonb,
"secondary_keywords" jsonb,
"local_seo_keywords" jsonb,
"image_alt_text" text,
"social_copy_whatsapp" text,
"previous_event_summary" text,
"attendance_note" text,
"cancellation_policy" text,
"accessibility_notes" text,
"promo_sms_enabled" bool,
"bookings_enabled" bool,
"seated_capacity" int4,
"standing_capacity" int4,
"online_discount_type" text,
"online_discount_value" numeric,
"booking_cutoff_at" timestamptz,
"landscape_image_url" text,
"social_image_url" text,
"story_image_url" text,
"print_poster_url" text,
"online_discount_ends_at" timestamptz,
"booking_questions" jsonb,
"table_talker_url" text
);
CREATE TABLE public.table_bookings (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"booking_reference" varchar,
"customer_id" uuid,
"booking_date" date,
"booking_time" time,
"party_size" int4,
"tables_assigned" jsonb,
"booking_type" table_booking_type,
"status" table_booking_status,
"duration_minutes" int4,
"special_requirements" text,
"dietary_requirements" text[],
"allergies" text[],
"celebration_type" varchar,
"internal_notes" text,
"source" varchar,
"created_at" timestamptz DEFAULT now(),
"updated_at" timestamptz DEFAULT now(),
"confirmed_at" timestamptz,
"cancelled_at" timestamptz,
"cancellation_reason" text,
"completed_at" timestamptz,
"no_show_at" timestamptz,
"modification_count" int4,
"original_booking_data" jsonb,
"email_verification_token" uuid,
"email_verified_at" timestamptz,
"reminder_sent" bool,
"correlation_id" uuid,
"payment_method" text,
"payment_status" payment_status,
"booking_purpose" text,
"committed_party_size" int4,
"hold_expires_at" timestamptz,
"card_capture_completed_at" timestamptz,
"no_show_marked_at" timestamptz,
"no_show_marked_by" uuid,
"left_at" timestamptz,
"review_sms_sent_at" timestamptz,
"review_clicked_at" timestamptz,
"sunday_preorder_cutoff_at" timestamptz,
"sunday_preorder_completed_at" timestamptz,
"start_datetime" timestamptz,
"end_datetime" timestamptz,
"seated_at" timestamptz,
"event_id" uuid,
"event_booking_id" uuid,
"cancelled_by" text,
"deposit_waived" bool,
"is_venue_event" bool,
"paypal_deposit_order_id" text,
"paypal_deposit_capture_id" text,
"deposit_amount" numeric,
"review_suppressed_at" timestamptz,
"deposit_refund_status" text,
"deposit_amount_locked" numeric,
"high_chair_count" int4,
"is_outside_seating" bool,
"table_pinned" bool,
"assignment_soft" bool,
"requires_accessible_table" bool,
"booking_period_id" uuid,
"booking_period_code" text,
"booking_period_name" text,
"booking_period_answer" bool,
"booking_period_requires_preorder" bool,
"deposit_rule" text,
"deposit_basis" text,
"deposit_rate" numeric,
"deposit_refund_cutoff_days" int4,
"deposit_refund_policy" text,
"guest_confirmed_at" timestamptz,
"christmas_course_counts" text
);
CREATE TABLE public.table_holds (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"scope" text,
"table_id" uuid,
"hold_type" text,
"status" text,
"starts_on" date,
"ends_on" date,
"day_of_week" int2,
"starts_at" time,
"ends_at" time,
"note" text,
"created_by" uuid,
"created_at" timestamptz DEFAULT now(),
"cancelled_by" uuid,
"cancelled_at" timestamptz
);
CREATE TABLE public.tables (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"table_number" varchar,
"capacity" int4,
"is_active" bool,
"notes" text,
"created_at" timestamptz DEFAULT now(),
"updated_at" timestamptz DEFAULT now(),
"name" text,
"is_bookable" bool,
"area" text,
"area_id" uuid,
"priority" int4,
"bar_priority" int4,
"min_party_size" int4,
"step_free" bool,
"standard_height" bool,
"high_chair_capable" bool,
"heated" bool
);
CREATE TABLE public.waitlist_offers (
"id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
"waitlist_entry_id" uuid,
"event_id" uuid,
"customer_id" uuid,
"seats_held" int4,
"status" text,
"scheduled_sms_send_time" timestamptz,
"sent_at" timestamptz,
"accepted_at" timestamptz,
"expired_at" timestamptz,
"expires_at" timestamptz,
"created_at" timestamptz DEFAULT now()
);
CREATE TABLE public.event_ticket_types(id uuid PRIMARY KEY,event_id uuid,base_price numeric,capacity integer,is_active boolean,sort_order integer,created_at timestamptz);
CREATE TABLE public.booking_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid,ticket_type_id uuid,quantity integer,unit_price numeric,attendee_names text[]);
CREATE FUNCTION public.event_ticket_type_unit_price(numeric,text,numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT $1 $$;
CREATE TABLE public.event_faqs (event_id uuid,question text,answer text,sort_order integer);
CREATE TABLE public.table_join_links (table_id uuid, join_table_id uuid);
CREATE TABLE public.system_settings (key text,value jsonb);
CREATE TABLE public.fixture_private_blocks(table_id uuid,start_at timestamptz,end_at timestamptz);
CREATE TABLE public.payments (id uuid PRIMARY KEY,booking_id uuid,amount numeric,status text);
CREATE TABLE public.guest_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hashed_token text,customer_id uuid,event_booking_id uuid,waitlist_offer_id uuid,action_type text,expires_at timestamptz,consumed_at timestamptz);
CREATE TABLE public.waitlist_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid,customer_id uuid,requested_seats integer,status text,created_at timestamptz DEFAULT now(),updated_at timestamptz,offered_at timestamptz,accepted_at timestamptz,expired_at timestamptz);
CREATE OR REPLACE FUNCTION public.is_booking_live(p_status table_booking_status, p_left_at timestamp with time zone, p_hold_expires_at timestamp with time zone, p_payment_status payment_status, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_status NOT IN ('cancelled', 'no_show')
     AND p_left_at IS NULL
     AND NOT (
           p_status IN ('pending_payment', 'pending_card_capture')
       AND p_hold_expires_at IS NOT NULL
       AND p_hold_expires_at <= p_now
       AND p_payment_status IS DISTINCT FROM 'completed'
     );
$function$;

CREATE OR REPLACE FUNCTION public.is_active_event_booking_for_capacity_v01(p_status text, p_hold_expires_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    p_status = 'confirmed'
    OR (
      p_status = 'pending_payment'
      AND (p_hold_expires_at IS NULL OR p_hold_expires_at > now())
    );
$function$;

CREATE OR REPLACE FUNCTION public.windows_overlap(p_a_start timestamp with time zone, p_a_end timestamp with time zone, p_b_start timestamp with time zone, p_b_end timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT p_a_start < p_b_end AND p_a_end > p_b_start;
$function$;

CREATE OR REPLACE FUNCTION public.table_is_held(p_table_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_channel text, p_release_lead_hours integer, p_ignore_hold boolean DEFAULT false, p_now timestamp with time zone DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_released boolean;
BEGIN
  -- Review finding F2: this used to take only the start time, so a maintenance block
  -- running 19:00 to 21:00 did not stop an 18:00 to 20:00 booking. Each hold occurrence
  -- is now turned into a real Europe/London range and compared with the whole window.
  v_released := p_now >= (p_start_at - make_interval(hours => GREATEST(0, p_release_lead_hours)));

  RETURN EXISTS (
    SELECT 1
    FROM public.table_holds h
    -- Every service date the booking window can touch, plus the day before, so an
    -- overnight hold (22:00 to 02:00) that began yesterday still blocks an 01:00 booking.
    CROSS JOIN LATERAL (
      SELECT generate_series(
        ((p_start_at AT TIME ZONE 'Europe/London')::date - 1),
        ((p_end_at   AT TIME ZONE 'Europe/London')::date),
        interval '1 day'
      )::date AS occurrence_date
    ) occ
    CROSS JOIN LATERAL (
      SELECT
        (occ.occurrence_date + h.starts_at) AT TIME ZONE 'Europe/London' AS hold_start,
        (CASE
           WHEN h.ends_at > h.starts_at THEN occ.occurrence_date + h.ends_at
           ELSE (occ.occurrence_date + 1) + h.ends_at   -- crosses midnight
         END) AT TIME ZONE 'Europe/London' AS hold_end
    ) win
    WHERE h.status = 'active'
      AND h.scope = 'table'
      AND h.table_id = p_table_id
      AND h.starts_on <= occ.occurrence_date
      AND (h.ends_on IS NULL OR h.ends_on >= occ.occurrence_date)
      -- day_of_week applies to the date the occurrence STARTS on.
      AND (h.day_of_week IS NULL OR h.day_of_week = EXTRACT(DOW FROM occ.occurrence_date)::smallint)
      AND public.windows_overlap(win.hold_start, win.hold_end, p_start_at, p_end_at)
      AND (
            h.hold_type = 'maintenance'
         OR (h.hold_type = 'walk_in_hold'
             AND p_channel = 'online'
             AND NOT v_released
             AND NOT COALESCE(p_ignore_hold, false))
      )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.table_booking_assigned_capacity_v01(p_table_booking_id uuid)
 RETURNS TABLE(assignment_count integer, assigned_capacity integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COUNT(bta.table_id)::integer AS assignment_count,
    COALESCE(SUM(GREATEST(COALESCE(t.capacity, 0), 0)), 0)::integer AS assigned_capacity
  FROM public.booking_table_assignments bta
  LEFT JOIN public.tables t ON t.id = bta.table_id
  WHERE bta.table_booking_id = p_table_booking_id;
$function$;

CREATE OR REPLACE FUNCTION public.table_booking_assignment_capacity_ok_v01(p_table_booking_id uuid, p_party_size integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_capacity RECORD;
BEGIN
  IF p_table_booking_id IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN false;
  END IF;

  SELECT tb.id, tb.status
  INTO v_booking
  FROM public.table_bookings tb
  WHERE tb.id = p_table_booking_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_booking.status::text IN ('cancelled', 'no_show', 'completed') THEN
    RETURN true;
  END IF;

  SELECT *
  INTO v_capacity
  FROM public.table_booking_assigned_capacity_v01(p_table_booking_id);

  -- Unassigned active bookings are handled by the unassigned workflow. This
  -- guard only prevents assigned bookings from becoming over-capacity.
  IF COALESCE(v_capacity.assignment_count, 0) = 0 THEN
    RETURN true;
  END IF;

  RETURN COALESCE(v_capacity.assigned_capacity, 0) >= p_party_size;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_booking_table_capacity_ok_v01(p_event_booking_id uuid, p_party_size integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table_booking RECORD;
BEGIN
  IF p_event_booking_id IS NULL OR p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN false;
  END IF;

  FOR v_table_booking IN
    SELECT tb.id
    FROM public.table_bookings tb
    WHERE tb.event_booking_id = p_event_booking_id
      AND tb.status::text NOT IN ('cancelled', 'no_show', 'completed')
  LOOP
    IF NOT public.table_booking_assignment_capacity_ok_v01(v_table_booking.id, p_party_size) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_setting_int(p_key text, p_default integer)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_raw text;
  v_num numeric;
BEGIN
  SELECT value ->> 'value' INTO v_raw FROM public.system_settings WHERE key = p_key;
  IF v_raw IS NULL THEN
    RETURN p_default;
  END IF;

  BEGIN
    v_num := v_raw::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Setting % is not a number (%); using default %', p_key, v_raw, p_default;
    RETURN p_default;
  END;

  IF v_num <> trunc(v_num) THEN
    RAISE WARNING 'Setting % is not a whole number (%); using default %', p_key, v_raw, p_default;
    RETURN p_default;
  END IF;

  RETURN v_num::integer;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tables_are_connected(p_ids uuid[])
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_seen   uuid[];
  v_before integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN false; END IF;
  IF cardinality(p_ids) = 1 THEN RETURN true; END IF;

  v_seen := ARRAY[p_ids[1]];
  LOOP
    v_before := cardinality(v_seen);

    SELECT array_agg(DISTINCT x) INTO v_seen
    FROM (
      SELECT unnest(v_seen) AS x
      UNION
      SELECT l.join_table_id FROM public.table_join_links l
       WHERE l.table_id = ANY (v_seen) AND l.join_table_id = ANY (p_ids)
      UNION
      SELECT l.table_id FROM public.table_join_links l
       WHERE l.join_table_id = ANY (v_seen) AND l.table_id = ANY (p_ids)
    ) reachable;

    EXIT WHEN cardinality(v_seen) = cardinality(p_ids);  -- everything reached
    EXIT WHEN cardinality(v_seen) = v_before;            -- nothing new, so disconnected
  END LOOP;

  RETURN cardinality(v_seen) = cardinality(p_ids);
END;
$function$;

CREATE OR REPLACE FUNCTION public.table_names_in_order(p_ids uuid[])
 RETURNS text[]
 LANGUAGE sql
 STABLE
AS $function$
  SELECT array_agg(t.label ORDER BY t.number_sort, t.label)
  FROM (
    SELECT COALESCE(tb.name, tb.table_number) AS label,
           COALESCE(NULLIF(regexp_replace(tb.table_number, '\D', '', 'g'), '')::integer, 9999) AS number_sort
    FROM public.tables tb
    WHERE tb.id = ANY (p_ids)
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_table_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.tables t
    WHERE t.id = NEW.table_id
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'table_not_found'
      USING ERRCODE = '23503';
  END IF;

  -- The only mutual exclusion in the whole flow. Kept exactly as it was.
  PERFORM 1
  FROM public.tables t
  WHERE t.id = NEW.table_id
  FOR UPDATE;

  IF public.is_table_blocked_by_private_booking_v05(
    NEW.table_id,
    NEW.start_datetime,
    NEW.end_datetime,
    NULL
  ) THEN
    RAISE EXCEPTION 'table_assignment_private_blocked'
      USING ERRCODE = '23P01',
            DETAIL = 'table is blocked by an overlapping private booking window';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    WHERE bta.table_id = NEW.table_id
      -- THE CHANGE. Was:
      --   tb.status NOT IN ('cancelled','no_show') AND tb.left_at IS NULL
      -- which held a table for an expired UNPAID deposit hold that the picker had
      -- already released. Selection and enforcement now share one definition, so the
      -- picker can no longer offer a table the trigger will refuse.
      AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status)
      AND bta.start_datetime < NEW.end_datetime
      AND bta.end_datetime > NEW.start_datetime
      AND (TG_OP <> 'UPDATE' OR bta.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'table_assignment_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has an overlapping active assignment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.event_communal_seat_allocations ecsa
    JOIN public.bookings b ON b.id = ecsa.event_booking_id
    WHERE ecsa.table_id = NEW.table_id
      AND ecsa.start_datetime < NEW.end_datetime
      AND ecsa.end_datetime > NEW.start_datetime
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
  ) THEN
    RAISE EXCEPTION 'table_assignment_communal_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has communal seated guests for this window';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_event_communal_seat_allocation_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_table_capacity integer;
  v_allocated integer;
BEGIN
  IF NEW.seats < 1 THEN
    RAISE EXCEPTION 'invalid_communal_seats' USING ERRCODE = '23514';
  END IF;

  SELECT b.id, b.event_id, b.status, b.hold_expires_at, b.event_seating_type
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = NEW.event_booking_id;

  IF NOT FOUND OR v_booking.event_id IS DISTINCT FROM NEW.event_id THEN
    RAISE EXCEPTION 'event_booking_mismatch' USING ERRCODE = '23503';
  END IF;

  IF v_booking.event_seating_type <> 'seated' THEN
    RAISE EXCEPTION 'communal_allocation_requires_seated_booking' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(t.capacity, 0)
  INTO v_table_capacity
  FROM public.tables t
  WHERE t.id = NEW.table_id
    AND COALESCE(t.is_bookable, true) = true
  FOR UPDATE;

  IF NOT FOUND OR v_table_capacity < 1 THEN
    RAISE EXCEPTION 'table_not_bookable' USING ERRCODE = '23503';
  END IF;

  IF public.is_table_blocked_by_private_booking_v05(
    NEW.table_id,
    NEW.start_datetime,
    NEW.end_datetime,
    NULL
  ) THEN
    RAISE EXCEPTION 'table_assignment_private_blocked'
      USING ERRCODE = '23P01',
            DETAIL = 'table is blocked by an overlapping private booking window';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.booking_table_assignments bta
    JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
    WHERE bta.table_id = NEW.table_id
      AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
      AND tb.left_at IS NULL
      AND bta.start_datetime < NEW.end_datetime
      AND bta.end_datetime > NEW.start_datetime
  ) THEN
    RAISE EXCEPTION 'table_assignment_overlap'
      USING ERRCODE = '23P01',
            DETAIL = 'table already has an overlapping exclusive assignment';
  END IF;

  SELECT COALESCE(SUM(ecsa.seats), 0)::integer
  INTO v_allocated
  FROM public.event_communal_seat_allocations ecsa
  JOIN public.bookings b ON b.id = ecsa.event_booking_id
  WHERE ecsa.table_id = NEW.table_id
    AND ecsa.start_datetime < NEW.end_datetime
    AND ecsa.end_datetime > NEW.start_datetime
    AND (TG_OP <> 'UPDATE' OR ecsa.id <> NEW.id)
    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);

  IF v_allocated + NEW.seats > v_table_capacity THEN
    RAISE EXCEPTION 'communal_table_capacity_exceeded'
      USING ERRCODE = '23514',
            DETAIL = 'communal allocations exceed table capacity';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.event_communal_window_v01(p_event_id uuid, OUT start_datetime timestamp with time zone, OUT end_datetime timestamp with time zone)
 RETURNS record
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
BEGIN
  SELECT e.start_datetime, e.date, e.time, e.end_time, e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id;

  start_datetime := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF start_datetime IS NULL THEN
    end_datetime := NULL;
    RETURN;
  END IF;

  end_datetime := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    start_datetime + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF end_datetime <= start_datetime THEN
    end_datetime := end_datetime + INTERVAL '1 day';
  END IF;

  start_datetime := CASE
    WHEN start_datetime - INTERVAL '15 minutes' <= now() THEN start_datetime
    ELSE start_datetime - INTERVAL '15 minutes'
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_capacity_snapshot_v05(p_event_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(event_id uuid, capacity integer, confirmed_seats integer, held_seats integer, seats_remaining integer, is_full boolean, seated_remaining integer, standing_remaining integer, total_remaining integer, communal_seated_capacity integer, communal_seated_reserved integer, standing_capacity integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_start timestamptz;
  v_end timestamptz;
  v_reserved_total integer;
  v_reserved_seated integer;
  v_reserved_standing integer;
  v_waitlist_held integer;
  v_total_remaining integer;
  v_raw_seated_remaining integer;
  v_physical_seated_capacity integer;
  v_effective_seated_capacity integer;
  v_effective_standing_capacity integer;
  v_effective_total_capacity integer;
BEGIN
  FOR v_event IN
    SELECT
      e.id,
      e.capacity,
      e.seated_capacity,
      e.standing_capacity,
      COALESCE(e.booking_mode, 'table') AS booking_mode
    FROM public.events e
    WHERE p_event_ids IS NULL OR e.id = ANY(p_event_ids)
  LOOP
    SELECT
      COALESCE(SUM(COALESCE(b.seats, 0)), 0)::integer,
      COALESCE(SUM(CASE WHEN b.event_seating_type = 'standing' THEN 0 ELSE COALESCE(b.seats, 0) END), 0)::integer,
      COALESCE(SUM(CASE WHEN b.event_seating_type = 'standing' THEN COALESCE(b.seats, 0) ELSE 0 END), 0)::integer
    INTO v_reserved_total, v_reserved_seated, v_reserved_standing
    FROM public.bookings b
    WHERE b.event_id = v_event.id
      AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at);

    SELECT COALESCE(SUM(bh.seats_or_covers_held), 0)::integer
    INTO v_waitlist_held
    FROM public.booking_holds bh
    JOIN public.waitlist_offers wo ON wo.id = bh.waitlist_offer_id
    WHERE wo.event_id = v_event.id
      AND bh.status = 'active'
      AND bh.hold_type = 'waitlist_hold'
      AND bh.expires_at > now();

    v_raw_seated_remaining := NULL;
    v_physical_seated_capacity := NULL;
    v_effective_seated_capacity := NULL;
    v_effective_standing_capacity := 0;
    v_effective_total_capacity := v_event.capacity;

    IF v_event.booking_mode = 'communal' THEN
      SELECT start_datetime, end_datetime
      INTO v_start, v_end
      FROM public.event_communal_window_v01(v_event.id);

      IF v_start IS NULL OR v_end IS NULL THEN
        v_raw_seated_remaining := 0;
      ELSE
        SELECT COALESCE(SUM(free_seats), 0)::integer
        INTO v_raw_seated_remaining
        FROM (
          SELECT
            GREATEST(
              COALESCE(t.capacity, 0)
              - CASE WHEN EXISTS (
                  SELECT 1
                  FROM public.booking_table_assignments bta
                  JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
                  WHERE bta.table_id = t.id
                    AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
                    AND tb.left_at IS NULL
                    AND bta.start_datetime < v_end
                    AND bta.end_datetime > v_start
                ) THEN COALESCE(t.capacity, 0) ELSE 0 END
              - COALESCE((
                  SELECT SUM(ecsa.seats)
                  FROM public.event_communal_seat_allocations ecsa
                  JOIN public.bookings b ON b.id = ecsa.event_booking_id
                  WHERE ecsa.table_id = t.id
                    AND ecsa.start_datetime < v_end
                    AND ecsa.end_datetime > v_start
                    AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
                ), 0),
              0
            )::integer AS free_seats
          FROM public.tables t
          WHERE COALESCE(t.is_bookable, true) = true
            AND COALESCE(t.capacity, 0) > 0
            AND NOT public.is_table_blocked_by_private_booking_v05(t.id, v_start, v_end, NULL)
        ) availability;
      END IF;

      v_physical_seated_capacity := COALESCE(v_raw_seated_remaining, 0) + v_reserved_seated;
      v_effective_seated_capacity := CASE
        WHEN v_event.seated_capacity IS NULL THEN v_physical_seated_capacity
        ELSE LEAST(GREATEST(v_event.seated_capacity, 0), v_physical_seated_capacity)
      END;
      v_effective_standing_capacity := CASE
        WHEN v_event.standing_capacity IS NULL THEN
          CASE
            WHEN v_event.capacity IS NULL THEN 0
            ELSE GREATEST(v_event.capacity - v_effective_seated_capacity, 0)
          END
        ELSE GREATEST(v_event.standing_capacity, 0)
      END;
      v_effective_total_capacity := CASE
        WHEN v_event.seated_capacity IS NOT NULL OR v_event.standing_capacity IS NOT NULL THEN
          v_effective_seated_capacity + v_effective_standing_capacity
        ELSE v_event.capacity
      END;
      v_total_remaining := CASE
        WHEN v_effective_total_capacity IS NULL THEN NULL
        ELSE GREATEST(v_effective_total_capacity - v_reserved_total - v_waitlist_held, 0)
      END;

      seated_remaining := CASE
        WHEN v_total_remaining IS NULL THEN GREATEST(v_effective_seated_capacity - v_reserved_seated, 0)
        ELSE LEAST(GREATEST(v_effective_seated_capacity - v_reserved_seated, 0), v_total_remaining)
      END;
      standing_remaining := CASE
        WHEN v_total_remaining IS NULL THEN GREATEST(v_effective_standing_capacity - v_reserved_standing, 0)
        ELSE LEAST(GREATEST(v_effective_standing_capacity - v_reserved_standing, 0), v_total_remaining)
      END;
      total_remaining := CASE
        WHEN v_total_remaining IS NULL THEN seated_remaining + standing_remaining
        ELSE v_total_remaining
      END;
      seats_remaining := total_remaining;
      communal_seated_capacity := v_effective_seated_capacity;
      communal_seated_reserved := v_reserved_seated;
      standing_capacity := v_effective_standing_capacity;
    ELSE
      v_total_remaining := CASE
        WHEN v_event.capacity IS NULL THEN NULL
        ELSE GREATEST(v_event.capacity - v_reserved_total - v_waitlist_held, 0)
      END;
      seated_remaining := CASE
        WHEN v_event.capacity IS NULL THEN NULL
        ELSE v_total_remaining
      END;
      standing_remaining := 0;
      total_remaining := v_total_remaining;
      seats_remaining := v_total_remaining;
      communal_seated_capacity := NULL;
      communal_seated_reserved := 0;
      standing_capacity := 0;
    END IF;

    event_id := v_event.id;
    capacity := v_effective_total_capacity;
    confirmed_seats := v_reserved_total;
    held_seats := v_waitlist_held;
    is_full := CASE
      WHEN seats_remaining IS NULL THEN false
      ELSE seats_remaining <= 0
    END;

    RETURN NEXT;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_event_communal_seats_v01(p_event_id uuid, p_event_booking_id uuid, p_seats integer, p_start_datetime timestamp with time zone, p_end_datetime timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining integer := p_seats;
  v_take integer;
  v_table RECORD;
  v_table_names text[] := ARRAY[]::text[];
  v_table_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  DELETE FROM public.event_communal_seat_allocations
  WHERE event_booking_id = p_event_booking_id;

  FOR v_table IN
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS table_name,
      GREATEST(
        COALESCE(t.capacity, 0)
        - CASE WHEN EXISTS (
            SELECT 1
            FROM public.booking_table_assignments bta
            JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
            WHERE bta.table_id = t.id
              AND tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
              AND tb.left_at IS NULL
              AND bta.start_datetime < p_end_datetime
              AND bta.end_datetime > p_start_datetime
          ) THEN COALESCE(t.capacity, 0) ELSE 0 END
        - COALESCE((
            SELECT SUM(ecsa.seats)
            FROM public.event_communal_seat_allocations ecsa
            JOIN public.bookings b ON b.id = ecsa.event_booking_id
            WHERE ecsa.table_id = t.id
              AND ecsa.start_datetime < p_end_datetime
              AND ecsa.end_datetime > p_start_datetime
              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          ), 0),
        0
      )::integer AS free_seats
    FROM public.tables t
    WHERE COALESCE(t.is_bookable, true) = true
      AND COALESCE(t.capacity, 0) > 0
      AND NOT public.is_table_blocked_by_private_booking_v05(t.id, p_start_datetime, p_end_datetime, NULL)
    ORDER BY t.capacity ASC, COALESCE(t.table_number, t.name) ASC
    FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_table.free_seats <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_table.free_seats, v_remaining);

    INSERT INTO public.event_communal_seat_allocations (
      event_id,
      event_booking_id,
      table_id,
      seats,
      start_datetime,
      end_datetime
    ) VALUES (
      p_event_id,
      p_event_booking_id,
      v_table.id,
      v_take,
      p_start_datetime,
      p_end_datetime
    );

    v_table_names := array_append(v_table_names, v_table.table_name);
    v_table_ids := array_append(v_table_ids, v_table.id);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    DELETE FROM public.event_communal_seat_allocations
    WHERE event_booking_id = p_event_booking_id;

    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'insufficient_seated_capacity',
      'unallocated_seats', v_remaining
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'confirmed',
    'table_name', CASE
      WHEN cardinality(v_table_names) = 0 THEN NULL
      ELSE array_to_string(v_table_names, ' + ')
    END,
    'table_names', to_jsonb(v_table_names),
    'table_ids', to_jsonb(v_table_ids)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.allocate_event_communal_seats_v02(p_event_id uuid, p_event_booking_id uuid, p_seats integer, p_start_datetime timestamp with time zone, p_end_datetime timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining   integer := p_seats;
  v_take        integer;
  v_table       RECORD;
  v_table_names text[] := ARRAY[]::text[];
  v_table_ids   uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  DELETE FROM public.event_communal_seat_allocations
  WHERE event_booking_id = p_event_booking_id;

  FOR v_table IN
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS table_name,
      GREATEST(
        COALESCE(t.capacity, 0)
        - CASE WHEN EXISTS (
            SELECT 1
            FROM public.booking_table_assignments bta
            JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
            WHERE bta.table_id = t.id
              AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status)
              AND bta.start_datetime < p_end_datetime
              AND bta.end_datetime > p_start_datetime
          ) THEN COALESCE(t.capacity, 0) ELSE 0 END
        - COALESCE((
            SELECT SUM(ecsa.seats)
            FROM public.event_communal_seat_allocations ecsa
            JOIN public.bookings b ON b.id = ecsa.event_booking_id
            WHERE ecsa.table_id = t.id
              AND ecsa.start_datetime < p_end_datetime
              AND ecsa.end_datetime > p_start_datetime
              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          ), 0),
        0
      )::integer AS free_seats
    FROM public.tables t
    WHERE COALESCE(t.is_bookable, true) = true
      AND COALESCE(t.capacity, 0) > 0
      AND NOT public.is_table_blocked_by_private_booking_v05(t.id, p_start_datetime, p_end_datetime, NULL)
      -- Review finding F3: v01 never looked at table_holds, so a communal event could be
      -- seated on a table that was out of service. Channel 'event' is not 'online', so
      -- walk-in holds do not apply; maintenance blocks apply to every channel.
      AND NOT public.table_is_held(t.id, p_start_datetime, p_end_datetime, 'event', 0, true)
    -- THE CHANGE. Events fill the bar tables first and the Dining Room last.
    ORDER BY
      t.bar_priority ASC,
      t.capacity ASC,
      COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999) ASC
    FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF v_table.free_seats <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_table.free_seats, v_remaining);

    INSERT INTO public.event_communal_seat_allocations (
      event_id, event_booking_id, table_id, seats, start_datetime, end_datetime
    ) VALUES (
      p_event_id, p_event_booking_id, v_table.id, v_take, p_start_datetime, p_end_datetime
    );

    v_table_names := array_append(v_table_names, v_table.table_name);
    v_table_ids   := array_append(v_table_ids, v_table.id);
    v_remaining   := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    DELETE FROM public.event_communal_seat_allocations
    WHERE event_booking_id = p_event_booking_id;

    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'insufficient_seated_capacity',
      'unallocated_seats', v_remaining
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'confirmed',
    'table_name', CASE
      WHEN cardinality(v_table_names) = 0 THEN NULL
      ELSE array_to_string(v_table_names, ' + ')
    END,
    'table_names', to_jsonb(v_table_names),
    'table_ids', to_jsonb(v_table_ids)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reallocate_event_communal_booking_v01(p_booking_id uuid, p_target_seats integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  SELECT b.id, b.event_id, b.event_seating_type
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.event_seating_type = 'standing' THEN
    DELETE FROM public.event_communal_seat_allocations
    WHERE event_booking_id = p_booking_id;

    RETURN jsonb_build_object('state', 'confirmed', 'event_seating_type', 'standing');
  END IF;

  SELECT start_datetime, end_datetime
  INTO v_start, v_end
  FROM public.event_communal_window_v01(v_booking.event_id);

  RETURN public.allocate_event_communal_seats_v01(
    v_booking.event_id,
    p_booking_id,
    p_target_seats,
    v_start,
    v_end
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_event_booking_v05(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text DEFAULT 'brand_site'::text, p_seating_preference text DEFAULT 'seated'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_after_snapshot RECORD;
  v_existing_active RECORD;
  v_status text;
  v_booking_id uuid;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
  v_event_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_requested_seating text := CASE WHEN p_seating_preference = 'standing' THEN 'standing' ELSE 'seated' END;
  v_effective_seating text := 'seated';
  v_allocation jsonb := '{}'::jsonb;
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT
    e.id,
    e.name,
    e.capacity,
    e.payment_mode,
    e.booking_mode,
    e.booking_open,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time,
    e.end_time,
    e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_datetime_missing');
  END IF;

  v_event_end := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    v_event_start + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF v_event_end <= v_event_start THEN
    v_event_end := v_event_end + INTERVAL '1 day';
  END IF;

  SELECT start_datetime, end_datetime
  INTO v_window_start, v_window_end
  FROM public.event_communal_window_v01(p_event_id);

  IF v_window_start IS NULL OR v_window_end IS NULL THEN
    v_window_start := v_event_start;
    v_window_end := v_event_end;
  END IF;

  IF v_event_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  SELECT b.id, b.status
  INTO v_existing_active
  FROM public.bookings b
  WHERE b.event_id = p_event_id
    AND b.customer_id = p_customer_id
    AND b.status IN ('pending_payment', 'confirmed')
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', 'blocked',
      'reason', 'customer_conflict',
      'booking_id', v_existing_active.id,
      'status', v_existing_active.status
    );
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
    IF v_requested_seating = 'standing' THEN
      -- Only staff may choose standing while seated places remain.
      IF COALESCE(p_source, '') NOT IN ('admin', 'foh', 'walk-in')
         AND v_capacity_snapshot.seated_remaining IS DISTINCT FROM 0 THEN
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'standing_not_available_until_seated_full',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_capacity, 0) <= 0 THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'standing_capacity_not_configured');
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_remaining, 0) < p_seats THEN
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;

      v_effective_seating := 'standing';
    ELSE
      IF COALESCE(v_capacity_snapshot.seated_remaining, 0) >= p_seats THEN
        v_effective_seating := 'seated';
      ELSIF COALESCE(p_source, '') NOT IN ('admin', 'foh', 'walk-in')
         AND (COALESCE(v_capacity_snapshot.seated_remaining, 0) > 0
              OR COALESCE(v_capacity_snapshot.standing_remaining, 0) > 0) THEN
        -- The guest must review standing tickets before making a new request.
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'seated_capacity_changed',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      ELSIF COALESCE(v_capacity_snapshot.standing_remaining, 0) >= p_seats THEN
        v_effective_seating := 'standing';
      ELSE
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;
    END IF;
  ELSE
    IF v_capacity_snapshot.capacity IS NOT NULL
       AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < p_seats) THEN
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', 'insufficient_capacity',
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0)
      );
    END IF;
  END IF;

  v_status := CASE
    WHEN COALESCE(v_event.payment_mode, 'free') = 'prepaid' THEN 'pending_payment'
    ELSE 'confirmed'
  END;

  IF v_status = 'pending_payment' THEN
    v_hold_expires_at := LEAST(v_event_start, now() + INTERVAL '24 hours');
    IF v_hold_expires_at <= now() THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
    END IF;
  END IF;

  INSERT INTO public.bookings (
    customer_id,
    event_id,
    seats,
    status,
    source,
    event_seating_type,
    hold_expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_customer_id,
    p_event_id,
    p_seats,
    v_status,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
    v_effective_seating,
    v_hold_expires_at,
    now(),
    now()
  )
  RETURNING id INTO v_booking_id;

  IF v_status = 'pending_payment' THEN
    INSERT INTO public.booking_holds (
      hold_type,
      event_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_booking_id,
      p_seats,
      'active',
      v_hold_expires_at,
      now(),
      now()
    );
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' AND v_effective_seating = 'seated' THEN
    v_allocation := public.allocate_event_communal_seats_v01(
      p_event_id,
      v_booking_id,
      p_seats,
      v_window_start,
      v_window_end
    );

    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      DELETE FROM public.booking_holds WHERE event_booking_id = v_booking_id;
      DELETE FROM public.bookings WHERE id = v_booking_id;
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', COALESCE(v_allocation->>'reason', 'insufficient_seated_capacity'),
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
        'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
        'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
        'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
      );
    END IF;
  END IF;

  SELECT *
  INTO v_after_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_status = 'pending_payment' THEN 'pending_payment' ELSE 'confirmed' END,
    'booking_id', v_booking_id,
    'status', v_status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'hold_expires_at', v_hold_expires_at,
    'event_seating_type', v_effective_seating,
    'seats_remaining', v_after_snapshot.seats_remaining,
    'seated_remaining', v_after_snapshot.seated_remaining,
    'standing_remaining', v_after_snapshot.standing_remaining,
    'total_remaining', v_after_snapshot.total_remaining,
    'table_name', v_allocation->>'table_name',
    'table_names', COALESCE(v_allocation->'table_names', '[]'::jsonb),
    'table_ids', COALESCE(v_allocation->'table_ids', '[]'::jsonb)
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_conflict');
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_event_booking_v06(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text DEFAULT 'brand_site'::text, p_seating_preference text DEFAULT 'seated'::text, p_payment_hold_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_booking_id uuid;
  v_event_start timestamptz;
  v_hold_expires_at timestamptz;
  v_minutes integer;
BEGIN
  v_result := public.create_event_booking_v05(
    p_event_id,
    p_customer_id,
    p_seats,
    p_source,
    p_seating_preference
  );

  IF COALESCE(v_result->>'state', '') <> 'pending_payment' THEN
    RETURN v_result;
  END IF;

  v_booking_id := NULLIF(v_result->>'booking_id', '')::uuid;
  v_minutes := GREATEST(1, COALESCE(p_payment_hold_minutes, 24 * 60));

  SELECT COALESCE(
    e.start_datetime,
    CASE
      WHEN e.date IS NOT NULL AND e.time IS NOT NULL
        THEN ((e.date::text || ' ' || e.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  )
  INTO v_event_start
  FROM public.events e
  WHERE e.id = p_event_id;

  v_hold_expires_at := LEAST(
    COALESCE(v_event_start, now() + make_interval(mins => v_minutes)),
    now() + make_interval(mins => v_minutes)
  );

  UPDATE public.bookings
  SET hold_expires_at = v_hold_expires_at, updated_at = now()
  WHERE id = v_booking_id
    AND status = 'pending_payment';

  UPDATE public.booking_holds
  SET expires_at = v_hold_expires_at, updated_at = now()
  WHERE event_booking_id = v_booking_id
    AND hold_type = 'payment_hold'
    AND status = 'active';

  RETURN jsonb_set(v_result, '{hold_expires_at}', to_jsonb(v_hold_expires_at), true);
END;
$function$;

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
   v_result := v_result || jsonb_build_object('state','confirmed','hold_expires_at',NULL);
 END IF;
 IF jsonb_array_length(v_saved)>0 THEN
   UPDATE public.bookings SET attendees=v_saved,attendee_names=v_names WHERE id=v_booking_id;
   UPDATE public.booking_items bi SET attendee_names=(SELECT array_agg(a->>'name') FROM jsonb_array_elements(v_saved) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id) WHERE bi.booking_id=v_booking_id;
 END IF;
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.update_event_booking_seats_staff_v05(p_booking_id uuid, p_new_seats integer, p_actor text DEFAULT 'staff'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_event RECORD;
  v_event_start timestamptz;
  v_now timestamptz := now();
  v_delta integer;
  v_capacity_snapshot RECORD;
  v_allocated_current integer;
  v_allocation jsonb;
BEGIN
  IF p_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_booking_id');
  END IF;

  IF p_new_seats IS NULL OR p_new_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT b.id, b.customer_id, b.event_id, b.seats, b.status, b.hold_expires_at, b.event_seating_type
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_changeable');
  END IF;

  SELECT e.id, e.name, e.capacity, e.booking_mode, e.payment_mode, e.price_per_seat, e.price, e.start_datetime, e.date, e.time
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(v_event.start_datetime, ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London'));

  IF v_event_start IS NULL OR v_event_start <= v_now THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  v_delta := p_new_seats - COALESCE(v_booking.seats, 1);

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'state', 'unchanged',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_event.id,
      'event_name', v_event.name,
      'event_start_datetime', v_event_start,
      'status', v_booking.status,
      'payment_mode', COALESCE(v_event.payment_mode, 'free'),
      'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
      'event_seating_type', v_booking.event_seating_type,
      'old_seats', COALESCE(v_booking.seats, 1),
      'new_seats', COALESCE(v_booking.seats, 1),
      'delta', 0
    );
  END IF;

  IF v_delta > 0 THEN
    SELECT *
    INTO v_capacity_snapshot
    FROM public.get_event_capacity_snapshot_v05(ARRAY[v_event.id]::uuid[])
    LIMIT 1;

    IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
      IF v_event.capacity IS NOT NULL AND COALESCE(v_capacity_snapshot.total_remaining, 0) < v_delta THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_capacity', 'seats_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0), 'requested_increase', v_delta);
      END IF;

      IF v_booking.event_seating_type = 'standing' AND COALESCE(v_capacity_snapshot.standing_capacity, 0) <= 0 THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'standing_capacity_not_configured');
      END IF;

      IF v_booking.event_seating_type = 'standing' AND COALESCE(v_capacity_snapshot.standing_remaining, 0) < v_delta THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_standing_capacity', 'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0), 'requested_increase', v_delta);
      END IF;

      IF v_booking.event_seating_type = 'seated' AND COALESCE(v_capacity_snapshot.seated_remaining, 0) < v_delta THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_seated_capacity', 'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0), 'requested_increase', v_delta);
      END IF;
    ELSIF v_event.capacity IS NOT NULL
       AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < v_delta) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_capacity', 'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0), 'requested_increase', v_delta);
    END IF;
  END IF;

  UPDATE public.bookings
  SET seats = p_new_seats, updated_at = v_now
  WHERE id = v_booking.id;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
    v_allocation := public.reallocate_event_communal_booking_v01(v_booking.id, p_new_seats);
    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      UPDATE public.bookings SET seats = v_booking.seats, updated_at = v_now WHERE id = v_booking.id;
      PERFORM public.reallocate_event_communal_booking_v01(v_booking.id, COALESCE(v_booking.seats, 1));
      RETURN jsonb_build_object('state', 'blocked', 'reason', COALESCE(v_allocation->>'reason', 'insufficient_seated_capacity'));
    END IF;
  ELSE
    UPDATE public.table_bookings
    SET party_size = p_new_seats,
        committed_party_size = p_new_seats,
        hold_expires_at = CASE WHEN v_booking.status = 'pending_payment' THEN v_booking.hold_expires_at ELSE NULL END,
        updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND status <> 'cancelled'::public.table_booking_status;
  END IF;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.booking_holds
    SET seats_or_covers_held = p_new_seats, updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'status', v_booking.status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'price_per_seat', COALESCE(v_event.price_per_seat, v_event.price, 0),
    'event_seating_type', v_booking.event_seating_type,
    'old_seats', COALESCE(v_booking.seats, 1),
    'new_seats', p_new_seats,
    'delta', v_delta,
    'actor', COALESCE(NULLIF(TRIM(p_actor), ''), 'staff')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_event_booking_seats_v05(p_hashed_token text, p_new_seats integer, p_actor text DEFAULT 'guest'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token RECORD;
  v_result jsonb;
BEGIN
  SELECT gt.event_booking_id
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'manage'
    AND gt.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND OR v_token.event_booking_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  v_result := public.update_event_booking_seats_staff_v05(v_token.event_booking_id, p_new_seats, COALESCE(NULLIF(TRIM(p_actor), ''), 'guest'));
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_event_transaction(p_event_data jsonb, p_faqs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event_id UUID;
  v_event_record JSONB;
BEGIN
  INSERT INTO events (
    name,
    date,
    time,
    capacity,
    category_id,
    short_description,
    long_description,
    brief,
    highlights,
    keywords,
    slug,
    meta_title,
    meta_description,
    end_time,
    duration_minutes,
    doors_time,
    last_entry_time,
    event_status,
    booking_mode,
    booking_open,
    booking_url,
    event_type,
    performer_name,
    performer_type,
    price,
    price_per_seat,
    is_free,
    payment_mode,
    start_datetime,
    hero_image_url,
    thumbnail_image_url,
    poster_image_url,
    promo_video_url,
    highlight_video_urls,
    gallery_image_urls,
    facebook_event_name,
    facebook_event_description,
    gbp_event_title,
    gbp_event_description,
    opentable_experience_title,
    opentable_experience_description,
    primary_keywords,
    secondary_keywords,
    local_seo_keywords,
    image_alt_text,
    social_copy_whatsapp,
    previous_event_summary,
    attendance_note,
    cancellation_policy,
    accessibility_notes,
    promo_sms_enabled,
    bookings_enabled
  ) VALUES (
    p_event_data->>'name',
    (p_event_data->>'date')::DATE,
    COALESCE(p_event_data->>'time', '00:00'),
    (p_event_data->>'capacity')::INTEGER,
    (p_event_data->>'category_id')::UUID,
    p_event_data->>'short_description',
    p_event_data->>'long_description',
    p_event_data->>'brief',
    COALESCE(p_event_data->'highlights', '[]'::JSONB),
    COALESCE(p_event_data->'keywords', '[]'::JSONB),
    p_event_data->>'slug',
    p_event_data->>'meta_title',
    p_event_data->>'meta_description',
    (p_event_data->>'end_time')::TIME,
    (p_event_data->>'duration_minutes')::INTEGER,
    (p_event_data->>'doors_time')::TIME,
    (p_event_data->>'last_entry_time')::TIME,
    COALESCE(p_event_data->>'event_status', 'scheduled'),
    COALESCE(NULLIF(p_event_data->>'booking_mode', ''), 'table'),
    COALESCE((p_event_data->>'booking_open')::BOOLEAN, true),
    p_event_data->>'booking_url',
    NULLIF(TRIM(p_event_data->>'event_type'), ''),
    p_event_data->>'performer_name',
    p_event_data->>'performer_type',
    COALESCE((p_event_data->>'price')::DECIMAL, 0),
    (p_event_data->>'price_per_seat')::NUMERIC(10,2),
    COALESCE((p_event_data->>'is_free')::BOOLEAN, false),
    COALESCE(NULLIF(p_event_data->>'payment_mode', ''), 'free'),
    (p_event_data->>'start_datetime')::TIMESTAMPTZ,
    p_event_data->>'hero_image_url',
    p_event_data->>'thumbnail_image_url',
    p_event_data->>'poster_image_url',
    p_event_data->>'promo_video_url',
    COALESCE(p_event_data->'highlight_video_urls', '[]'::JSONB),
    COALESCE(p_event_data->'gallery_image_urls', '[]'::JSONB),
    p_event_data->>'facebook_event_name',
    p_event_data->>'facebook_event_description',
    p_event_data->>'gbp_event_title',
    p_event_data->>'gbp_event_description',
    p_event_data->>'opentable_experience_title',
    p_event_data->>'opentable_experience_description',
    COALESCE(p_event_data->'primary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'secondary_keywords', '[]'::JSONB),
    COALESCE(p_event_data->'local_seo_keywords', '[]'::JSONB),
    p_event_data->>'image_alt_text',
    p_event_data->>'social_copy_whatsapp',
    p_event_data->>'previous_event_summary',
    p_event_data->>'attendance_note',
    p_event_data->>'cancellation_policy',
    p_event_data->>'accessibility_notes',
    COALESCE((p_event_data->>'promo_sms_enabled')::BOOLEAN, true),
    COALESCE((p_event_data->>'bookings_enabled')::BOOLEAN, true)
  )
  RETURNING id INTO v_event_id;

  -- Insert FAQs if provided
  IF p_faqs IS NOT NULL AND jsonb_array_length(p_faqs) > 0 THEN
    INSERT INTO event_faqs (
      event_id,
      question,
      answer,
      sort_order
    )
    SELECT
      v_event_id,
      item->>'question',
      item->>'answer',
      COALESCE((item->>'sort_order')::INTEGER, 0)
    FROM jsonb_array_elements(p_faqs) AS item;
  END IF;

  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = v_event_id;

  RETURN v_event_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_event_transaction(p_event_id uuid, p_event_data jsonb, p_faqs jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event_record JSONB;
BEGIN
  UPDATE events SET
    name              = CASE WHEN p_event_data ? 'name'              THEN COALESCE(p_event_data->>'name', name) ELSE name END,
    date              = CASE WHEN p_event_data ? 'date'              THEN COALESCE((p_event_data->>'date')::DATE, date) ELSE date END,
    time              = CASE WHEN p_event_data ? 'time'              THEN COALESCE(p_event_data->>'time', time) ELSE time END,
    capacity          = CASE WHEN p_event_data ? 'capacity'          THEN (p_event_data->>'capacity')::INTEGER ELSE capacity END,
    category_id       = CASE WHEN p_event_data ? 'category_id'       THEN (p_event_data->>'category_id')::UUID ELSE category_id END,
    short_description = CASE WHEN p_event_data ? 'short_description' THEN p_event_data->>'short_description' ELSE short_description END,
    long_description  = CASE WHEN p_event_data ? 'long_description'  THEN p_event_data->>'long_description' ELSE long_description END,
    brief             = CASE WHEN p_event_data ? 'brief'             THEN p_event_data->>'brief' ELSE brief END,
    highlights        = CASE WHEN p_event_data ? 'highlights'        THEN COALESCE(p_event_data->'highlights', highlights) ELSE highlights END,
    keywords          = CASE WHEN p_event_data ? 'keywords'          THEN COALESCE(p_event_data->'keywords', keywords) ELSE keywords END,
    slug              = CASE WHEN p_event_data ? 'slug'              THEN COALESCE(p_event_data->>'slug', slug) ELSE slug END,
    meta_title        = CASE WHEN p_event_data ? 'meta_title'        THEN p_event_data->>'meta_title' ELSE meta_title END,
    meta_description  = CASE WHEN p_event_data ? 'meta_description'  THEN p_event_data->>'meta_description' ELSE meta_description END,
    end_time          = CASE WHEN p_event_data ? 'end_time'          THEN (p_event_data->>'end_time')::TIME ELSE end_time END,
    duration_minutes  = CASE WHEN p_event_data ? 'duration_minutes'  THEN (p_event_data->>'duration_minutes')::INTEGER ELSE duration_minutes END,
    doors_time        = CASE WHEN p_event_data ? 'doors_time'        THEN (p_event_data->>'doors_time')::TIME ELSE doors_time END,
    last_entry_time   = CASE WHEN p_event_data ? 'last_entry_time'   THEN (p_event_data->>'last_entry_time')::TIME ELSE last_entry_time END,
    event_status      = CASE WHEN p_event_data ? 'event_status'      THEN COALESCE(p_event_data->>'event_status', event_status) ELSE event_status END,
    booking_mode      = CASE WHEN p_event_data ? 'booking_mode'      THEN COALESCE(NULLIF(p_event_data->>'booking_mode', ''), booking_mode) ELSE booking_mode END,
    booking_open      = CASE WHEN p_event_data ? 'booking_open'      THEN COALESCE((p_event_data->>'booking_open')::BOOLEAN, booking_open) ELSE booking_open END,
    booking_url       = CASE WHEN p_event_data ? 'booking_url'       THEN p_event_data->>'booking_url' ELSE booking_url END,
    event_type        = CASE WHEN p_event_data ? 'event_type'        THEN NULLIF(TRIM(p_event_data->>'event_type'), '') ELSE event_type END,
    performer_name    = CASE WHEN p_event_data ? 'performer_name'    THEN p_event_data->>'performer_name' ELSE performer_name END,
    performer_type    = CASE WHEN p_event_data ? 'performer_type'    THEN p_event_data->>'performer_type' ELSE performer_type END,
    price             = CASE WHEN p_event_data ? 'price'             THEN COALESCE((p_event_data->>'price')::DECIMAL, price) ELSE price END,
    price_per_seat    = CASE WHEN p_event_data ? 'price_per_seat'    THEN (p_event_data->>'price_per_seat')::NUMERIC(10,2) ELSE price_per_seat END,
    is_free           = CASE WHEN p_event_data ? 'is_free'           THEN COALESCE((p_event_data->>'is_free')::BOOLEAN, is_free) ELSE is_free END,
    payment_mode      = CASE WHEN p_event_data ? 'payment_mode'      THEN COALESCE(NULLIF(p_event_data->>'payment_mode', ''), payment_mode) ELSE payment_mode END,
    start_datetime    = CASE WHEN p_event_data ? 'start_datetime'    THEN (p_event_data->>'start_datetime')::TIMESTAMPTZ ELSE start_datetime END,
    hero_image_url    = CASE WHEN p_event_data ? 'hero_image_url'    THEN p_event_data->>'hero_image_url' ELSE hero_image_url END,
    thumbnail_image_url = CASE WHEN p_event_data ? 'thumbnail_image_url' THEN p_event_data->>'thumbnail_image_url' ELSE thumbnail_image_url END,
    poster_image_url  = CASE WHEN p_event_data ? 'poster_image_url'  THEN p_event_data->>'poster_image_url' ELSE poster_image_url END,
    promo_video_url   = CASE WHEN p_event_data ? 'promo_video_url'   THEN p_event_data->>'promo_video_url' ELSE promo_video_url END,
    highlight_video_urls = CASE WHEN p_event_data ? 'highlight_video_urls' THEN COALESCE(p_event_data->'highlight_video_urls', highlight_video_urls) ELSE highlight_video_urls END,
    gallery_image_urls   = CASE WHEN p_event_data ? 'gallery_image_urls'   THEN COALESCE(p_event_data->'gallery_image_urls', gallery_image_urls) ELSE gallery_image_urls END,
    facebook_event_name        = CASE WHEN p_event_data ? 'facebook_event_name'        THEN p_event_data->>'facebook_event_name' ELSE facebook_event_name END,
    facebook_event_description = CASE WHEN p_event_data ? 'facebook_event_description' THEN p_event_data->>'facebook_event_description' ELSE facebook_event_description END,
    gbp_event_title            = CASE WHEN p_event_data ? 'gbp_event_title'            THEN p_event_data->>'gbp_event_title' ELSE gbp_event_title END,
    gbp_event_description      = CASE WHEN p_event_data ? 'gbp_event_description'      THEN p_event_data->>'gbp_event_description' ELSE gbp_event_description END,
    opentable_experience_title       = CASE WHEN p_event_data ? 'opentable_experience_title'       THEN p_event_data->>'opentable_experience_title' ELSE opentable_experience_title END,
    opentable_experience_description = CASE WHEN p_event_data ? 'opentable_experience_description' THEN p_event_data->>'opentable_experience_description' ELSE opentable_experience_description END,
    primary_keywords   = CASE WHEN p_event_data ? 'primary_keywords'   THEN COALESCE(p_event_data->'primary_keywords', primary_keywords) ELSE primary_keywords END,
    secondary_keywords = CASE WHEN p_event_data ? 'secondary_keywords' THEN COALESCE(p_event_data->'secondary_keywords', secondary_keywords) ELSE secondary_keywords END,
    local_seo_keywords = CASE WHEN p_event_data ? 'local_seo_keywords' THEN COALESCE(p_event_data->'local_seo_keywords', local_seo_keywords) ELSE local_seo_keywords END,
    image_alt_text     = CASE WHEN p_event_data ? 'image_alt_text'     THEN p_event_data->>'image_alt_text' ELSE image_alt_text END,
    social_copy_whatsapp    = CASE WHEN p_event_data ? 'social_copy_whatsapp'    THEN p_event_data->>'social_copy_whatsapp' ELSE social_copy_whatsapp END,
    previous_event_summary  = CASE WHEN p_event_data ? 'previous_event_summary'  THEN p_event_data->>'previous_event_summary' ELSE previous_event_summary END,
    attendance_note         = CASE WHEN p_event_data ? 'attendance_note'         THEN p_event_data->>'attendance_note' ELSE attendance_note END,
    cancellation_policy     = CASE WHEN p_event_data ? 'cancellation_policy'     THEN p_event_data->>'cancellation_policy' ELSE cancellation_policy END,
    accessibility_notes     = CASE WHEN p_event_data ? 'accessibility_notes'     THEN p_event_data->>'accessibility_notes' ELSE accessibility_notes END,
    promo_sms_enabled       = CASE WHEN p_event_data ? 'promo_sms_enabled'       THEN (p_event_data->>'promo_sms_enabled')::BOOLEAN ELSE promo_sms_enabled END,
    bookings_enabled        = CASE WHEN p_event_data ? 'bookings_enabled'        THEN (p_event_data->>'bookings_enabled')::BOOLEAN ELSE bookings_enabled END
  WHERE id = p_event_id;

  -- Only touch FAQs when p_faqs IS NOT NULL (preserves existing FAQs on partial updates)
  IF p_faqs IS NOT NULL THEN
    DELETE FROM event_faqs WHERE event_id = p_event_id;

    IF jsonb_array_length(p_faqs) > 0 THEN
      INSERT INTO event_faqs (
        event_id,
        question,
        answer,
        sort_order
      )
      SELECT
        p_event_id,
        item->>'question',
        item->>'answer',
        COALESCE((item->>'sort_order')::INTEGER, 0)
      FROM jsonb_array_elements(p_faqs) AS item;
    END IF;
  END IF;

  SELECT to_jsonb(e) INTO v_event_record
  FROM events e
  WHERE e.id = p_event_id;

  RETURN v_event_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_event_table_reservation_v05(p_event_id uuid, p_event_booking_id uuid, p_customer_id uuid, p_party_size integer, p_source text DEFAULT 'admin'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_booking RECORD;

  v_event_start timestamptz;
  v_event_end timestamptz;
  v_reservation_start timestamptz;
  v_reservation_start_local timestamp without time zone;
  v_reservation_date date;
  v_reservation_time time without time zone;

  v_table_result jsonb := '{}'::jsonb;
  v_table_state text;
  v_table_booking_id uuid;

  v_current_assignment_end timestamptz;
  v_conflict_exists boolean := false;

  v_duration_minutes integer;
  v_booking_reference text;
  v_table_names text[];
  v_table_ids uuid[];

  v_note_text text;
  v_source text := COALESCE(NULLIF(TRIM(COALESCE(p_source, '')), ''), 'admin');

  v_target_status public.table_booking_status;
  v_target_hold_expires_at timestamptz;
BEGIN
  IF p_event_id IS NULL
     OR p_event_booking_id IS NULL
     OR p_customer_id IS NULL
     OR p_party_size IS NULL
     OR p_party_size < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_request');
  END IF;

  IF p_party_size > 20 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'too_large_party');
  END IF;

  SELECT
    b.id, b.customer_id, b.event_id, b.status, b.seats, b.hold_expires_at
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  IF v_booking.event_id IS DISTINCT FROM p_event_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_mismatch');
  END IF;

  IF v_booking.customer_id IS DISTINCT FROM p_customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_mismatch');
  END IF;

  IF v_booking.status NOT IN ('confirmed', 'pending_payment') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_active');
  END IF;

  SELECT
    e.id, e.name, e.booking_mode, e.booking_open, e.event_status,
    e.start_datetime, e.date, e.time, e.end_time, e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'general' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_general_entry_only');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_datetime_missing');
  END IF;

  IF v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  v_event_end := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    v_event_start + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF v_event_end <= v_event_start THEN
    v_event_end := v_event_end + INTERVAL '1 day';
  END IF;

  v_reservation_start := v_event_start - INTERVAL '15 minutes';
  IF v_reservation_start <= NOW() THEN
    v_reservation_start := v_event_start;
  END IF;

  v_reservation_start_local := v_reservation_start AT TIME ZONE 'Europe/London';
  v_reservation_date := v_reservation_start_local::date;
  v_reservation_time := v_reservation_start_local::time without time zone;

  v_note_text := concat_ws(
    ' · ',
    CASE WHEN COALESCE(v_event.name, '') = '' THEN NULL ELSE 'Event: ' || v_event.name END,
    NULLIF(TRIM(COALESCE(p_notes, '')), '')
  );

  IF v_booking.status = 'pending_payment' THEN
    v_target_status := 'pending_payment'::public.table_booking_status;
    v_target_hold_expires_at := v_booking.hold_expires_at;
  ELSE
    v_target_status := 'confirmed'::public.table_booking_status;
    v_target_hold_expires_at := NULL;
  END IF;

  SELECT tb.id
  INTO v_table_booking_id
  FROM public.table_bookings tb
  WHERE tb.event_booking_id = p_event_booking_id
    AND tb.status <> 'cancelled'::public.table_booking_status
  ORDER BY tb.created_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  IF v_table_booking_id IS NOT NULL THEN
    UPDATE public.table_bookings
    SET
      party_size = p_party_size,
      committed_party_size = p_party_size,
      status = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.status
        ELSE v_target_status
      END,
      confirmed_at = CASE
        WHEN v_target_status = 'confirmed'::public.table_booking_status
          THEN COALESCE(tb.confirmed_at, NOW())
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.confirmed_at
        ELSE NULL
      END,
      hold_expires_at = CASE
        WHEN tb.status IN ('no_show'::public.table_booking_status, 'completed'::public.table_booking_status)
          THEN tb.hold_expires_at
        ELSE v_target_hold_expires_at
      END,
      source = v_source,
      booking_type = 'regular'::public.table_booking_type,
      booking_purpose = 'drinks',
      special_requirements = COALESCE(v_note_text, tb.special_requirements),
      event_id = p_event_id,
      event_booking_id = p_event_booking_id,
      updated_at = NOW()
    FROM public.table_bookings tb
    WHERE public.table_bookings.id = v_table_booking_id
      AND tb.id = v_table_booking_id;

    IF v_target_status = 'confirmed'::public.table_booking_status AND p_party_size < 15 THEN
      PERFORM public.neutralise_under10_table_deposit_state_v01(
        v_table_booking_id,
        'event_table_reservation_confirmed_under10_existing'
      );
    END IF;

    SELECT tb.booking_reference, tb.start_datetime, tb.end_datetime
    INTO v_booking_reference, v_reservation_start, v_event_end
    FROM public.table_bookings tb
    WHERE tb.id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
    FROM public.booking_table_assignments bta
    JOIN public.tables t ON t.id = bta.table_id
    WHERE bta.table_booking_id = v_table_booking_id;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', v_table_booking_id,
      'booking_reference', v_booking_reference,
      'table_name', CASE
        WHEN v_table_names IS NULL OR cardinality(v_table_names) = 0 THEN NULL
        ELSE array_to_string(v_table_names, ' + ')
      END,
      'table_names', to_jsonb(COALESCE(v_table_names, ARRAY[]::text[])),
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', (SELECT status::text FROM public.table_bookings WHERE id = v_table_booking_id),
      'hold_expires_at', (SELECT hold_expires_at FROM public.table_bookings WHERE id = v_table_booking_id)
    );
  END IF;

  BEGIN
    IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NOT NULL THEN
      v_table_result := public.create_table_booking_v05_core(
        p_customer_id, v_reservation_date, v_reservation_time,
        p_party_size, 'drinks', v_note_text, false, v_source
      );
    ELSE
      v_table_result := public.create_table_booking_v05(
        p_customer_id, v_reservation_date, v_reservation_time,
        p_party_size, 'drinks', v_note_text, false, v_source
      );
    END IF;

    v_table_state := COALESCE(v_table_result->>'state', 'blocked');
    IF v_table_state NOT IN ('confirmed', 'pending_payment') THEN
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', COALESCE(v_table_result->>'reason', 'no_table')
      );
    END IF;

    v_table_booking_id := NULLIF(v_table_result->>'table_booking_id', '')::uuid;
    IF v_table_booking_id IS NULL THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
    END IF;

    UPDATE public.booking_holds
    SET status = 'released',
        released_at = NOW(),
        updated_at = NOW()
    WHERE table_booking_id = v_table_booking_id
      AND hold_type = 'payment_hold'
      AND status = 'active';

    UPDATE public.table_bookings
    SET status = v_target_status,
        confirmed_at = CASE
          WHEN v_target_status = 'confirmed'::public.table_booking_status THEN COALESCE(confirmed_at, NOW())
          ELSE NULL
        END,
        hold_expires_at = v_target_hold_expires_at,
        source = v_source,
        booking_type = 'regular'::public.table_booking_type,
        booking_purpose = 'drinks',
        special_requirements = COALESCE(v_note_text, special_requirements),
        event_id = p_event_id,
        event_booking_id = p_event_booking_id,
        party_size = p_party_size,
        committed_party_size = p_party_size,
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    SELECT MAX(end_datetime)
    INTO v_current_assignment_end
    FROM public.booking_table_assignments
    WHERE table_booking_id = v_table_booking_id;

    IF v_current_assignment_end IS NULL THEN
      v_current_assignment_end := v_reservation_start;
    END IF;

    IF v_event_end > v_current_assignment_end THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.booking_table_assignments current_bta
        JOIN public.booking_table_assignments other_bta
          ON other_bta.table_id = current_bta.table_id
        JOIN public.table_bookings other_tb
          ON other_tb.id = other_bta.table_booking_id
        WHERE current_bta.table_booking_id = v_table_booking_id
          AND other_bta.table_booking_id <> v_table_booking_id
          AND other_tb.status NOT IN ('cancelled'::public.table_booking_status, 'no_show'::public.table_booking_status)
          AND other_tb.left_at IS NULL
          AND other_bta.start_datetime < v_event_end
          AND other_bta.end_datetime > v_current_assignment_end
      ) INTO v_conflict_exists;

      IF v_conflict_exists THEN
        DELETE FROM public.table_bookings WHERE id = v_table_booking_id;
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
      END IF;
    END IF;

    v_duration_minutes := GREATEST(
      30,
      CEIL(EXTRACT(EPOCH FROM (v_event_end - v_reservation_start)) / 60.0)::integer
    );

    UPDATE public.booking_table_assignments
    SET start_datetime = v_reservation_start,
        end_datetime = v_event_end
    WHERE table_booking_id = v_table_booking_id;

    UPDATE public.table_bookings
    SET booking_date = v_reservation_date,
        booking_time = v_reservation_time,
        start_datetime = v_reservation_start,
        end_datetime = v_event_end,
        duration_minutes = v_duration_minutes,
        updated_at = NOW()
    WHERE id = v_table_booking_id;

    IF v_target_status = 'confirmed'::public.table_booking_status AND p_party_size < 15 THEN
      PERFORM public.neutralise_under10_table_deposit_state_v01(
        v_table_booking_id,
        'event_table_reservation_confirmed_under10_new'
      );
    END IF;

    SELECT booking_reference INTO v_booking_reference
    FROM public.table_bookings WHERE id = v_table_booking_id;

    SELECT
      array_agg(COALESCE(t.name, t.table_number) ORDER BY COALESCE(t.table_number, t.name)),
      array_agg(t.id ORDER BY COALESCE(t.table_number, t.name))
    INTO v_table_names, v_table_ids
    FROM public.booking_table_assignments bta
    JOIN public.tables t ON t.id = bta.table_id
    WHERE bta.table_booking_id = v_table_booking_id;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'table_booking_id', v_table_booking_id,
      'booking_reference', v_booking_reference,
      'table_name', CASE
        WHEN v_table_names IS NULL OR cardinality(v_table_names) = 0 THEN NULL
        ELSE array_to_string(v_table_names, ' + ')
      END,
      'table_names', to_jsonb(COALESCE(v_table_names, ARRAY[]::text[])),
      'table_ids', to_jsonb(COALESCE(v_table_ids, ARRAY[]::uuid[])),
      'start_datetime', v_reservation_start,
      'end_datetime', v_event_end,
      'table_booking_status', (SELECT status::text FROM public.table_bookings WHERE id = v_table_booking_id),
      'hold_expires_at', (SELECT hold_expires_at FROM public.table_bookings WHERE id = v_table_booking_id)
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_table');
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_table_allocation_candidates(p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_party_size integer, p_purpose text DEFAULT 'food'::text, p_high_chair_count integer DEFAULT 0, p_requires_accessible_table boolean DEFAULT false, p_preferred_table_ids uuid[] DEFAULT NULL::uuid[], p_channel text DEFAULT 'online'::text, p_exclude_booking uuid DEFAULT NULL::uuid, p_overrides table_allocation_overrides DEFAULT NULL::table_allocation_overrides, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(table_ids uuid[], table_names text[], total_capacity integer, table_count integer, worst_priority integer, rank integer, reason_code text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_release_lead   integer;
  v_ignore_min     boolean := COALESCE((p_overrides).ignore_minimum, false);
  v_ignore_hold    boolean := COALESCE((p_overrides).ignore_hold, false);
  v_allow_unjoined boolean := COALESCE((p_overrides).allow_unjoined, false);
  v_ignore_access  boolean := COALESCE((p_overrides).ignore_accessibility, false);
  v_minimums_live  boolean;
BEGIN
  -- Guarded read (review finding F1). This used to be an unguarded
  -- (value ->> 'value')::integer, so a manager saving 24.5 took every booking in
  -- the pub down until the row was repaired by hand. A malformed value now falls
  -- back to the coded default and warns.
  v_release_lead := public.get_setting_int('hold_release_lead_hours', 24);

  -- Minimum party sizes are an online-only lever, and they lapse close to the sitting for exactly the
  -- reason a hard minimum is dangerous: it is Wednesday evening, every four-top has gone, three
  -- six-tops are empty, and a couple should not be turned away to protect a large party who is not
  -- coming.
  v_minimums_live := (p_channel = 'online')
                     AND NOT v_ignore_min
                     AND p_now < (p_start_at - make_interval(hours => GREATEST(0, v_release_lead)));

  RETURN QUERY
  WITH scored AS (
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS name,
      t.capacity,
      CASE WHEN p_purpose = 'drinks' THEN t.bar_priority ELSE t.priority END AS priority,
      t.min_party_size,
      COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999) AS number_sort,
      -- HARD failures. A table failing any of these is unusable, alone or in a join.
      CASE
        WHEN COALESCE(t.is_bookable, true) = false
          THEN 'table_not_bookable'
        WHEN p_requires_accessible_table AND NOT v_ignore_access
             AND (t.step_free = false OR t.standard_height = false)
          THEN 'not_accessible'
        WHEN COALESCE(p_high_chair_count, 0) > 0 AND t.high_chair_capable = false
          THEN 'no_high_chair_here'
        WHEN EXISTS (
              SELECT 1
              FROM public.booking_table_assignments bta
              JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
              WHERE bta.table_id = t.id
                AND (p_exclude_booking IS NULL OR tb.id <> p_exclude_booking)
                AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, p_now)
                AND public.windows_overlap(bta.start_datetime, bta.end_datetime, p_start_at, p_end_at)
             )
          THEN 'table_occupied'
        -- Review finding F7: a communal row whose parent event booking is cancelled, or whose
        -- payment hold has expired, is not live. Joining to `bookings` stops a dead event
        -- holding a table hostage.
        WHEN EXISTS (
              SELECT 1
              FROM public.event_communal_seat_allocations eca
              JOIN public.bookings b ON b.id = eca.event_booking_id
              WHERE eca.table_id = t.id
                AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
                AND public.windows_overlap(eca.start_datetime, eca.end_datetime, p_start_at, p_end_at)
             )
          THEN 'table_communal'
        -- The check that went missing on 9 May 2026.
        WHEN public.is_table_blocked_by_private_booking_v05(t.id, p_start_at, p_end_at, NULL)
          THEN 'table_private_block'
        -- Maintenance bites on every channel. Checked with the full window (F2).
        WHEN public.table_is_held(t.id, p_start_at, p_end_at, 'staff', v_release_lead, true, p_now)
          THEN 'table_blocked'
        ELSE NULL
      END AS hard_reason
    FROM public.tables t
  ),
  -- Review finding F4: a walk-in hold withholds a table from ONLINE SINGLE-TABLE sale.
  -- It must NOT remove the table from joined combinations, or holding Low 4a pushes every
  -- online party of seven into the Dining Room, undoing the fix this release exists for.
  -- So eligibility splits in two. Maintenance stays in `hard_reason` and is excluded from both.
  usable AS (
    SELECT sc.*,
           public.table_is_held(sc.id, p_start_at, p_end_at, p_channel, v_release_lead, v_ignore_hold, p_now)
             AS walk_in_held
    FROM scored sc
    WHERE sc.hard_reason IS NULL
  ),
  valid_for_single AS (
    SELECT * FROM usable u
    WHERE NOT u.walk_in_held
      AND u.capacity >= p_party_size
      AND NOT (v_minimums_live AND p_party_size < u.min_party_size)
  ),
  valid_for_combination AS (
    SELECT * FROM usable    -- held tables ARE allowed here
  ),
  singles AS (
    SELECT
      ARRAY[v.id] AS ids, v.capacity AS cap, 1 AS cnt, v.priority AS worst_prio,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_preferred_table_ids IS NOT NULL
                AND cardinality(p_preferred_table_ids) = 1
                AND v.id = ANY (p_preferred_table_ids) THEN 0 ELSE 1 END,
          v.capacity ASC, v.priority ASC, v.number_sort ASC
      )::integer AS rnk
    FROM valid_for_single v
  ),
  -- Review finding F6: enumerate subsets completely, then test connectivity, rather than
  -- pruning growth by adjacency (which could never build a valid A-C-B run).
  -- Review finding F5: no hard eight-table cap. The bound is the number of usable tables,
  -- so a staff party of 40 across nine free tables is reachable.
  combos AS (
    WITH RECURSIVE walk AS (
      SELECT ARRAY[v.id] AS ids, v.capacity AS cap, 1 AS cnt, v.priority AS worst_prio, v.id AS last_id
      FROM valid_for_combination v
      UNION ALL
      SELECT w.ids || v.id, w.cap + v.capacity, w.cnt + 1,
             GREATEST(w.worst_prio, v.priority), v.id
      FROM walk w
      JOIN valid_for_combination v ON v.id > w.last_id   -- ascending uuid: each subset once
      WHERE w.cnt < (SELECT count(*) FROM valid_for_combination)
    )
    SELECT
      w.ids, w.cap, w.cnt, w.worst_prio,
      ROW_NUMBER() OVER (
        ORDER BY
          -- An exactly-matching staff selection wins outright (F10).
          CASE WHEN p_preferred_table_ids IS NOT NULL
                AND w.ids @> p_preferred_table_ids
                AND w.ids <@ p_preferred_table_ids THEN 0 ELSE 1 END,
          w.cnt ASC,          -- fewest tables
          w.cap ASC,          -- then waste the fewest seats
          w.worst_prio ASC,   -- then the house order: Low 4a+4b beats Dining Room 4a+4b at 7 and 8
          w.ids ASC           -- deterministic
      )::integer AS rnk
    FROM walk w
    WHERE w.cnt >= 2
      AND w.cap >= p_party_size
      AND (v_allow_unjoined OR public.tables_are_connected(w.ids))
  )
  SELECT s.ids, public.table_names_in_order(s.ids), s.cap, s.cnt, s.worst_prio, s.rnk, NULL::text
    FROM singles s
  UNION ALL
  SELECT c.ids, public.table_names_in_order(c.ids), c.cap, c.cnt, c.worst_prio,
         c.rnk + (SELECT COUNT(*) FROM singles)::integer, NULL::text
    FROM combos c
   WHERE NOT EXISTS (SELECT 1 FROM singles)
  UNION ALL
  -- Rejected tables, with the reason, so availability and the staff screens can explain
  -- themselves. Review finding F14: capacity and minimum-party rejections are reported for
  -- SINGLE-table suitability, having been excluded from the hard filters so that a small
  -- table is still usable inside a join.
  SELECT ARRAY[sc.id], ARRAY[sc.name], sc.capacity, 1, sc.priority, NULL::integer,
         COALESCE(
           sc.hard_reason,
           CASE
             WHEN sc.capacity < p_party_size THEN 'too_large_for_table'
             WHEN v_minimums_live AND p_party_size < sc.min_party_size THEN 'below_table_minimum'
             WHEN public.table_is_held(sc.id, p_start_at, p_end_at, p_channel, v_release_lead, v_ignore_hold, p_now)
               THEN 'table_held'
           END)
    FROM scored sc
   WHERE sc.hard_reason IS NOT NULL
      OR sc.capacity < p_party_size
      OR (v_minimums_live AND p_party_size < sc.min_party_size)
      OR public.table_is_held(sc.id, p_start_at, p_end_at, p_channel, v_release_lead, v_ignore_hold, p_now);
END;
$function$;

CREATE OR REPLACE FUNCTION public.accept_waitlist_offer_v05(p_hashed_token text, p_source text DEFAULT 'brand_site'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token RECORD;
  v_offer RECORD;
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_booking_id uuid;
  v_booking_status text;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
  v_table_result jsonb := '{}'::jsonb;
  v_table_state text := 'blocked';
BEGIN
  SELECT
    gt.id,
    gt.customer_id,
    gt.waitlist_offer_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'waitlist_offer'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_used');
  END IF;

  IF v_token.expires_at <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  SELECT
    wo.id,
    wo.event_id,
    wo.customer_id,
    wo.seats_held,
    wo.status,
    wo.expires_at
  INTO v_offer
  FROM public.waitlist_offers wo
  WHERE wo.id = v_token.waitlist_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_not_found');
  END IF;

  IF v_offer.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_offer.status <> 'sent' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_unavailable');
  END IF;

  IF v_offer.expires_at <= NOW() THEN
    UPDATE public.waitlist_offers
    SET status = 'expired', expired_at = NOW()
    WHERE id = v_offer.id;

    UPDATE public.booking_holds
    SET status = 'expired', released_at = NOW(), updated_at = NOW()
    WHERE waitlist_offer_id = v_offer.id
      AND status = 'active';

    UPDATE public.waitlist_entries
    SET status = 'expired', expired_at = NOW(), updated_at = NOW()
    WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id)
      AND status = 'offered';

    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_expired');
  END IF;

  SELECT
    e.id,
    e.name,
    e.payment_mode,
    e.start_datetime,
    e.date,
    e.time,
    e.booking_open,
    e.event_status,
    e.booking_mode
  INTO v_event
  FROM public.events e
  WHERE e.id = v_offer.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[v_offer.event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_capacity_snapshot.seats_remaining, 0) < v_offer.seats_held THEN
    UPDATE public.waitlist_offers
    SET status = 'expired', expired_at = NOW()
    WHERE id = v_offer.id;

    UPDATE public.booking_holds
    SET status = 'expired', released_at = NOW(), updated_at = NOW()
    WHERE waitlist_offer_id = v_offer.id
      AND status = 'active';

    UPDATE public.waitlist_entries
    SET status = 'expired', expired_at = NOW(), updated_at = NOW()
    WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id)
      AND status = 'offered';

    RETURN jsonb_build_object('state', 'blocked', 'reason', 'capacity_unavailable');
  END IF;

  v_booking_status := CASE
    WHEN COALESCE(v_event.payment_mode, 'free') = 'prepaid' THEN 'pending_payment'
    ELSE 'confirmed'
  END;

  IF v_booking_status = 'pending_payment' THEN
    v_hold_expires_at := LEAST(v_event_start, NOW() + INTERVAL '24 hours');
  END IF;

  INSERT INTO public.bookings (
    customer_id,
    event_id,
    seats,
    status,
    source,
    hold_expires_at,
    created_at,
    updated_at
  ) VALUES (
    v_offer.customer_id,
    v_offer.event_id,
    v_offer.seats_held,
    v_booking_status,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
    v_hold_expires_at,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_booking_id;

  IF v_booking_status = 'pending_payment' THEN
    INSERT INTO public.booking_holds (
      hold_type,
      event_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_booking_id,
      v_offer.seats_held,
      'active',
      v_hold_expires_at,
      NOW(),
      NOW()
    );
  END IF;

  -- Ensure waitlist acceptance only succeeds if we can also reserve a table (unless general entry only).
  IF COALESCE(v_event.booking_mode, 'table') <> 'general' THEN
    BEGIN
      v_table_result := public.create_event_table_reservation_v05(
        v_event.id,
        v_booking_id,
        v_offer.customer_id,
        v_offer.seats_held,
        COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
        'Waitlist offer acceptance'
      );
      v_table_state := COALESCE(v_table_result->>'state', 'blocked');
    EXCEPTION
      WHEN OTHERS THEN
        v_table_state := 'blocked';
        v_table_result := jsonb_build_object('state', 'blocked', 'reason', 'no_table');
    END;

    IF v_table_state <> 'confirmed' THEN
      -- Roll back booking creation so the offer remains usable until expiry.
      DELETE FROM public.bookings
      WHERE id = v_booking_id;

      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', COALESCE(v_table_result->>'reason', 'no_table')
      );
    END IF;
  END IF;

  UPDATE public.waitlist_offers
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_offer.id;

  UPDATE public.waitlist_entries
  SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
  WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id);

  UPDATE public.booking_holds
  SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
  WHERE waitlist_offer_id = v_offer.id
    AND status = 'active';

  UPDATE public.guest_tokens
  SET consumed_at = NOW()
  WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_booking_status = 'pending_payment' THEN 'pending_payment' ELSE 'confirmed' END,
    'booking_id', v_booking_id,
    'status', v_booking_status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'hold_expires_at', v_hold_expires_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_next_waitlist_offer_v05(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_entry RECORD;
  v_offer_id uuid;
  v_hold_id uuid;
  v_scheduled_sms_send_time timestamptz := NOW();
  v_expires_at timestamptz;
  v_event_start timestamptz;
BEGIN
  SELECT
    e.id,
    e.capacity,
    e.start_datetime,
    e.date,
    e.time,
    e.booking_open,
    e.event_status
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'not_bookable');
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_capacity_snapshot.seats_remaining, 0) < 1 THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'no_capacity');
  END IF;

  SELECT
    we.id,
    we.customer_id,
    we.requested_seats
  INTO v_entry
  FROM public.waitlist_entries we
  WHERE we.event_id = p_event_id
    AND we.status = 'queued'
    AND we.requested_seats <= COALESCE(v_capacity_snapshot.seats_remaining, 0)
  ORDER BY we.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'no_eligible_waitlist_entry');
  END IF;

  v_expires_at := LEAST(v_event_start, v_scheduled_sms_send_time + INTERVAL '24 hours');

  INSERT INTO public.waitlist_offers (
    waitlist_entry_id,
    event_id,
    customer_id,
    seats_held,
    status,
    scheduled_sms_send_time,
    expires_at,
    created_at
  ) VALUES (
    v_entry.id,
    p_event_id,
    v_entry.customer_id,
    v_entry.requested_seats,
    'sent',
    v_scheduled_sms_send_time,
    v_expires_at,
    NOW()
  )
  RETURNING id INTO v_offer_id;

  INSERT INTO public.booking_holds (
    hold_type,
    waitlist_offer_id,
    seats_or_covers_held,
    status,
    scheduled_sms_send_time,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    'waitlist_hold',
    v_offer_id,
    v_entry.requested_seats,
    'active',
    v_scheduled_sms_send_time,
    v_expires_at,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_hold_id;

  UPDATE public.waitlist_entries
  SET
    status = 'offered',
    offered_at = NOW(),
    updated_at = NOW()
  WHERE id = v_entry.id;

  RETURN jsonb_build_object(
    'state', 'offered',
    'waitlist_offer_id', v_offer_id,
    'waitlist_entry_id', v_entry.id,
    'hold_id', v_hold_id,
    'event_id', p_event_id,
    'customer_id', v_entry.customer_id,
    'requested_seats', v_entry.requested_seats,
    'scheduled_sms_send_time', v_scheduled_sms_send_time,
    'expires_at', v_expires_at,
    'event_start_datetime', v_event_start
  );
END;
$function$;
CREATE FUNCTION public.is_table_blocked_by_private_booking_v05(uuid,timestamptz,timestamptz,uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql AS $$ SELECT EXISTS(SELECT 1 FROM fixture_private_blocks WHERE table_id=$1 AND start_at<$3 AND end_at>$2) $$;
CREATE FUNCTION public.neutralise_under10_table_deposit_state_v01(uuid,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
-- This fixture core only creates the initial ordinary table reservation. Event-specific
-- extension, atomicity and idempotency run through the unchanged live event reservation RPC.
CREATE FUNCTION public.create_table_booking_v05_core(p_customer uuid,p_date date,p_time time,p_size integer,p_purpose text,p_notes text,p_flag boolean,p_source text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c record; b uuid; st timestamptz := (p_date+p_time) AT TIME ZONE 'Europe/London';
BEGIN
 SELECT * INTO c FROM find_table_allocation_candidates(st,st+interval '90 minutes',p_size,'drinks',0,false,NULL,'event') WHERE reason_code IS NULL ORDER BY rank LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','blocked','reason','no_table'); END IF;
 INSERT INTO table_bookings(customer_id,party_size,committed_party_size,status,booking_date,booking_time,start_datetime,end_datetime,booking_reference,payment_status)
 VALUES(p_customer,p_size,p_size,'confirmed',p_date,p_time,st,st+interval '90 minutes','FIXTURE','completed') RETURNING id INTO b;
 INSERT INTO booking_table_assignments(table_booking_id,table_id,start_datetime,end_datetime) SELECT b,unnest(c.table_ids),st,st+interval '90 minutes';
 RETURN jsonb_build_object('state','confirmed','table_booking_id',b);
END $$;
CREATE TRIGGER trg_enforce_booking_table_assignment_integrity_v05 BEFORE INSERT OR UPDATE ON booking_table_assignments FOR EACH ROW EXECUTE FUNCTION enforce_booking_table_assignment_integrity_v05();
CREATE TRIGGER trg_enforce_event_communal_seat_allocation_v01 BEFORE INSERT OR UPDATE ON event_communal_seat_allocations FOR EACH ROW EXECUTE FUNCTION enforce_event_communal_seat_allocation_v01();
INSERT INTO tables(id,name,table_number,capacity,is_bookable,bar_priority,priority,min_party_size) VALUES
('10000000-0000-0000-0000-000000000001','A','1',20,true,1,1,1),
('10000000-0000-0000-0000-000000000002','B','2',20,true,2,2,1),
('10000000-0000-0000-0000-000000000003','C','3',9,true,3,3,1);
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('d81512e7-5e99-48fd-a153-3400c2f6f009','Freeze fixture 0','2035-01-01','19:00','2035-01-01 19:00+00',180,60,NULL,'communal','free',true,'scheduled');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65','Freeze fixture 1','2035-01-02','19:00','2035-01-02 19:00+00',180,25,25,'communal','free',true,'scheduled');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('b9334958-76b4-4504-a64a-0d47145bd75e','Freeze fixture 2','2035-01-03','19:00','2035-01-03 19:00+00',180,60,NULL,'communal','free',true,'scheduled');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('6e761f65-8b17-4bc9-8a01-d032b77f6a66','Freeze fixture 3','2035-01-04','19:00','2035-01-04 19:00+00',180,60,NULL,'communal','free',true,'scheduled');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('c3ac7e18-e562-4ef8-bea7-cae29f6e96ac','Freeze fixture 4','2035-01-05','19:00','2035-01-05 19:00+00',180,60,NULL,'communal','free',true,'scheduled');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('c3e9fbbd-df4a-41f2-a1c6-8194a5979735','Freeze fixture 5','2035-01-06','19:00','2035-01-06 19:00+00',180,60,NULL,'communal','free',true,'scheduled');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a','Freeze fixture 6','2035-01-07','19:00','2035-01-07 19:00+00',180,60,NULL,'communal','free',true,'scheduled');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,seated_capacity,booking_mode,payment_mode,booking_open,event_status) VALUES('e9e84ee8-c59b-4f93-80f6-7e7961a03240','Freeze fixture 7','2035-01-08','19:00','2035-01-08 19:00+00',180,50,50,'communal','free',true,'scheduled');
INSERT INTO bookings(id,event_id,customer_id,seats,status,event_seating_type,source) VALUES
('20000000-0000-0000-0000-000000000001','d81512e7-5e99-48fd-a153-3400c2f6f009',gen_random_uuid(),2,'confirmed','seated','fixture');
INSERT INTO event_communal_seat_allocations(id,event_booking_id,event_id,table_id,seats,start_datetime,end_datetime) VALUES
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','d81512e7-5e99-48fd-a153-3400c2f6f009','10000000-0000-0000-0000-000000000001',2,'2035-01-01 18:45+00','2035-01-01 22:00+00');
INSERT INTO payments VALUES ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',12,'completed');
CREATE TABLE fixture_before AS SELECT 'bookings' AS source,to_jsonb(b) AS row FROM bookings b
UNION ALL SELECT 'allocations',to_jsonb(a) FROM event_communal_seat_allocations a
UNION ALL SELECT 'payments',to_jsonb(p) FROM payments p;
CREATE TABLE fixture_functions_before AS SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
