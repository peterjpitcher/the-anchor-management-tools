-- Run only in an empty isolated PostgreSQL database, never production.
\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY, event_id uuid, customer_id uuid, status text,
  notes text CHECK (notes NOT LIKE '%reject-me%'), updated_at timestamptz
);
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON public.bookings TO service_role;
CREATE FUNCTION public.create_event_booking_v06(uuid, uuid, integer, text, text, integer) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE v_id uuid := '33333333-3333-4333-8333-333333333333';
BEGIN
  IF $4 = 'conflict' THEN
    RETURN jsonb_build_object('state','blocked','reason','customer_conflict','booking_id',v_id);
  END IF;
  IF $4 = 'waitlist' THEN
    RETURN jsonb_build_object('state','full_with_waitlist_option');
  END IF;
  IF $4 = 'missing' THEN
    RETURN jsonb_build_object('state','confirmed','booking_id',v_id);
  END IF;
  INSERT INTO public.bookings VALUES (v_id,$1,$2,CASE WHEN $4='pending' THEN 'pending_payment' ELSE 'confirmed' END,CASE WHEN $4='reject' THEN 'reject-me' ELSE 'Existing note' END, now());
  RETURN jsonb_build_object('state',CASE WHEN $4='pending' THEN 'pending_payment' ELSE 'confirmed' END,'booking_id',v_id);
END $$;
CREATE FUNCTION public.create_event_booking_v07(uuid,uuid,text,text,integer,jsonb) RETURNS jsonb
LANGUAGE sql AS $$ SELECT public.create_event_booking_v06($1,$2,2,$3,$4,$5) $$;
\ir ../../supabase/migrations/20260905100521_event_booking_dining_requests.sql

DO $$ BEGIN
  IF has_function_privilege('anon','public.create_event_booking_with_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean)','EXECUTE') OR
     has_function_privilege('authenticated','public.create_event_booking_with_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Public role can execute';
  END IF;
END $$;
SET ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_event_booking_with_requests_v01(NULL,NULL,2);
    RAISE EXCEPTION 'Anon unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_event_booking_with_requests_v01(NULL,NULL,2);
    RAISE EXCEPTION 'Authenticated unexpectedly executed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$
DECLARE v_result jsonb; v_before text;
BEGIN
  v_result := public.create_event_booking_with_requests_v01('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',2,'brand_site','seated',15,NULL,'before_event',true);
  IF v_result->>'requests_recorded' <> 'true' OR NOT EXISTS (SELECT 1 FROM public.bookings WHERE notes LIKE 'Existing note%' AND notes LIKE '%UNCONFIRMED REQUEST:%' AND notes LIKE '%before the event%' AND notes LIKE '%arriving early%') THEN RAISE EXCEPTION 'Request not stored'; END IF;
  SELECT notes INTO v_before FROM public.bookings;
  v_result := public.create_event_booking_with_requests_v01('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',2,'conflict','seated',15,NULL,'during_event',true);
  IF v_result->>'state' <> 'blocked' OR EXISTS (SELECT 1 FROM public.bookings WHERE notes <> v_before) THEN RAISE EXCEPTION 'Retry altered existing booking'; END IF;
  DELETE FROM public.bookings;
  v_result := public.create_event_booking_with_requests_v01('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',2,'pending','seated',15,'[]','not_sure',false);
  IF v_result->>'state' <> 'pending_payment' OR v_result->>'requests_recorded' <> 'true' THEN RAISE EXCEPTION 'Multi-ticket pending request lost'; END IF;
  DELETE FROM public.bookings;
  v_result := public.create_event_booking_with_requests_v01('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',2,'waitlist','seated',15,NULL,'during_event',true);
  IF v_result ? 'requests_recorded' OR EXISTS(SELECT 1 FROM public.bookings) THEN RAISE EXCEPTION 'Waitlist wrote notes'; END IF;
  BEGIN
    PERFORM public.create_event_booking_with_requests_v01('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',2,'brand_site','seated',15,NULL,'invalid',false);
    RAISE EXCEPTION 'Invalid request accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.bookings) THEN RAISE EXCEPTION 'Invalid request created booking'; END IF;
END $$;
RESET ROLE;
-- Fail the notes UPDATE, after the inner creator has inserted the booking.
CREATE FUNCTION public.reject_booking_notes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected notes failure'; END $$;
CREATE TRIGGER reject_booking_notes BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.reject_booking_notes();
SET ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM public.create_event_booking_with_requests_v01('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',2,'brand_site','seated',15,NULL,'before_event',false);
    RAISE EXCEPTION 'Expected failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'injected notes failure' THEN RAISE; END IF;
  END;
  IF EXISTS(SELECT 1 FROM public.bookings) THEN RAISE EXCEPTION 'Booking survived failed request persistence'; END IF;
END $$;
RESET ROLE;
DROP TRIGGER reject_booking_notes ON public.bookings;
-- Reversible rollout: function removal does not remove booking notes or change legacy creators.
DROP FUNCTION public.create_event_booking_with_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean);
SELECT 'PASS: request persistence, conflict/retry, pending multi-type, waitlist, validation, atomic rollback, grants and rollback' AS result;
