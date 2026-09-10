-- Behavioural proof that walk-ins pass the service-window guard, and nothing else does.
--
-- Isolated PostgreSQL harness only. Never run it against a linked database. It builds
-- the bare tables the guard reads, then applies the REAL migrations on top, so the rule
-- being asserted comes from supabase/migrations rather than from a copy here.
--
-- Run locally (Docker, about 15 seconds):
--   docker run --rm -d -p 55433:5432 -e POSTGRES_PASSWORD=postgres --name ams-service-window postgres:15
--   until docker exec ams-service-window pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done; sleep 2
--   psql postgres://postgres:postgres@localhost:55433/postgres -v ON_ERROR_STOP=1 -f tests/db/service-window-walk-ins.sql
--   docker rm -f ams-service-window
--
-- Any failed assertion raises, and psql with ON_ERROR_STOP exits non-zero.

\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.system_settings (key text PRIMARY KEY, value jsonb);
CREATE FUNCTION public.get_setting_bool(p_key text, p_default boolean)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT (value ->> 'value')::boolean FROM public.system_settings WHERE key = p_key), p_default)
$$;

CREATE TYPE public.table_booking_type AS ENUM ('regular', 'sunday_lunch', 'christmas');

CREATE TABLE public.business_hours (day_of_week integer NOT NULL, schedule_config jsonb);
CREATE TABLE public.special_hours (date date NOT NULL, schedule_config jsonb);

-- Stand-in for the versioned resolver. This harness holds a single version.
CREATE FUNCTION public.business_hours_for_date(p_date date)
RETURNS SETOF public.business_hours LANGUAGE sql STABLE AS $$
  SELECT * FROM public.business_hours WHERE day_of_week = EXTRACT(DOW FROM p_date)::integer
$$;

-- The live September hours: Wednesday has two services with a gap, Saturday one.
INSERT INTO public.business_hours VALUES
  (3, '[{"name": "Lunch",  "starts_at": "12:00", "ends_at": "15:00", "booking_type": "regular"},
        {"name": "Dinner", "starts_at": "16:00", "ends_at": "21:00", "booking_type": "regular"}]'),
  (6, '[{"name": "food service", "starts_at": "12:00", "ends_at": "19:00", "booking_type": "regular"}]');

CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  booking_purpose text NOT NULL DEFAULT 'food',
  booking_type public.table_booking_type NOT NULL DEFAULT 'regular',
  source varchar DEFAULT 'website'
);

\ir ../../supabase/migrations/20260815190000_service_window_rule_and_create_guard.sql
\ir ../../supabase/migrations/20260816090000_service_window_rule_uses_resolver.sql
\ir ../../supabase/migrations/20260910083051_walk_ins_skip_service_window_guard.sql

UPDATE public.system_settings SET value = '{"value": true}'
 WHERE key = 'service_window_enforcement_enabled';

-- Returns the new id, or NULL when the guard refuses. Any other error fails the run.
CREATE FUNCTION pg_temp.try_book(p_date date, p_time time, p_purpose text, p_source varchar)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.table_bookings (booking_date, booking_time, booking_purpose, source)
  VALUES (p_date, p_time, p_purpose, p_source)
  RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN NULL;
END $$;

CREATE FUNCTION pg_temp.try_change(p_id uuid, p_time time, p_purpose text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.table_bookings SET booking_time = p_time, booking_purpose = p_purpose WHERE id = p_id;
  RETURN true;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN false;
END $$;

DO $$
DECLARE
  v_wed constant date := DATE '2026-09-09';
  v_sat constant date := DATE '2026-09-12';
  v_id uuid;
BEGIN
  ASSERT EXTRACT(DOW FROM v_wed) = 3 AND EXTRACT(DOW FROM v_sat) = 6, 'fixture dates have drifted';

  -- ========================================================================
  -- Everything the guard refused before is still refused. Without these, a
  -- fixture in which the trigger never fires would pass every walk-in check.
  -- ========================================================================
  ASSERT pg_temp.try_book(v_wed, '20:34', 'food', 'admin') IS NULL,
    'a staff advance food booking at 20:34 must still be refused';
  ASSERT pg_temp.try_book(v_wed, '15:30', 'food', 'brand_site') IS NULL,
    'a website food booking in the gap between services must still be refused';
  ASSERT pg_temp.try_book(v_sat, '18:45', 'food', 'sms_reply') IS NULL,
    'an SMS-reply food booking after Saturday''s last arrival must still be refused';
  ASSERT pg_temp.try_book(v_wed, '20:34', 'food', 'management') IS NULL,
    'a management override is not a walk-in and must still be refused';
  ASSERT pg_temp.try_book(v_wed, '20:34', 'food', NULL) IS NULL,
    'a row with no source is not a walk-in and must still be refused';

  -- ...and what it accepted before is still accepted.
  ASSERT pg_temp.try_book(v_wed, '18:00', 'food', 'admin') IS NOT NULL,
    'a food booking inside dinner must be accepted';
  ASSERT pg_temp.try_book(v_wed, '20:34', 'drinks', 'admin') IS NOT NULL,
    'drinks are never slot-gated';

  -- ========================================================================
  -- The fix. Walk-ins are recorded whatever the time.
  -- ========================================================================
  ASSERT pg_temp.try_book(v_wed, '20:34', 'food', 'walk-in') IS NOT NULL,
    'the 9 September case: a food walk-in at 20:34 must be recorded';
  ASSERT pg_temp.try_book(v_wed, '20:46', 'food', 'walk-in') IS NOT NULL,
    'the 1 September case: a food walk-in at 20:46 must be recorded';
  ASSERT pg_temp.try_book(v_wed, '15:30', 'food', 'walk-in') IS NOT NULL,
    'a food walk-in between services must be recorded';
  ASSERT pg_temp.try_book(v_sat, '18:45', 'food', 'walk-in') IS NOT NULL,
    'a food walk-in after Saturday''s last arrival must be recorded';
  ASSERT pg_temp.try_book(v_wed, '21:30', 'food', 'walk-in') IS NOT NULL,
    'a food walk-in after the kitchen closes (the FOH raw-insert fallback) must be recorded';

  -- ========================================================================
  -- Changes after creation follow the same split.
  -- ========================================================================
  v_id := pg_temp.try_book(v_wed, '18:00', 'food', 'walk-in');
  ASSERT pg_temp.try_change(v_id, '20:50', 'food'),
    'a walk-in''s time must be correctable to after the last arrival';

  v_id := pg_temp.try_book(v_wed, '20:40', 'drinks', 'walk-in');
  ASSERT pg_temp.try_change(v_id, '20:40', 'food'),
    'a drinks walk-in must be switchable to food late in service';

  v_id := pg_temp.try_book(v_wed, '18:00', 'food', 'admin');
  ASSERT NOT pg_temp.try_change(v_id, '20:50', 'food'),
    'a staff booking must still not be moved past the last arrival';

  -- ========================================================================
  -- The kill switch still switches the whole rule off.
  -- ========================================================================
  UPDATE public.system_settings SET value = '{"value": false}'
   WHERE key = 'service_window_enforcement_enabled';
  ASSERT pg_temp.try_book(v_wed, '20:34', 'food', 'admin') IS NOT NULL,
    'with enforcement off, nothing is refused';

  RAISE NOTICE 'service-window walk-in tests passed';
END $$;
