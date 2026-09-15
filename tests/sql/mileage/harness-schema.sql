-- Stand-in for the production objects the mileage migrations touch. Table shapes, constraints,
-- function bodies and grants copied from the live catalogue on 15 September 2026
-- (project tfcasgxopxegwrabvwat). Throwaway test harness only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by name, so a
-- REVOKE from PUBLIC alone leaves them callable. Reproduce that, or grant tests prove nothing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  user_email text,
  operation_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  operation_status text NOT NULL CHECK (operation_status = ANY (ARRAY['success'::text, 'failure'::text])),
  ip_address inet,
  user_agent text,
  old_values jsonb,
  new_values jsonb,
  error_message text,
  additional_info jsonb
);

CREATE TABLE public.invoice_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name character varying(200) NOT NULL
);

CREATE TABLE public.oj_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id),
  project_name text NOT NULL
);

CREATE TABLE public.oj_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id),
  project_id uuid NOT NULL REFERENCES public.oj_projects(id),
  entry_type text NOT NULL,
  entry_date date NOT NULL,
  miles numeric(12,2),
  description text
);

CREATE TABLE public.mileage_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  postcode text,
  is_home_base boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_mileage_destinations_home_base
  ON public.mileage_destinations (is_home_base) WHERE (is_home_base = true);
CREATE TRIGGER trg_mileage_destinations_updated_at BEFORE UPDATE ON public.mileage_destinations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.mileage_destination_distances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_destination_id uuid NOT NULL REFERENCES public.mileage_destinations(id) ON DELETE CASCADE,
  to_destination_id uuid NOT NULL REFERENCES public.mileage_destinations(id) ON DELETE CASCADE,
  miles numeric(8,1) NOT NULL CHECK (miles > (0)::numeric),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_canonical_order CHECK (from_destination_id < to_destination_id),
  CONSTRAINT uq_destination_pair UNIQUE (from_destination_id, to_destination_id)
);

CREATE TABLE public.mileage_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_date date NOT NULL,
  description text,
  total_miles numeric(8,1) NOT NULL CHECK (total_miles > (0)::numeric),
  miles_at_standard_rate numeric(8,1) NOT NULL DEFAULT 0 CHECK (miles_at_standard_rate >= (0)::numeric),
  miles_at_reduced_rate numeric(8,1) NOT NULL DEFAULT 0 CHECK (miles_at_reduced_rate >= (0)::numeric),
  amount_due numeric(10,2) NOT NULL CHECK (amount_due >= (0)::numeric),
  source text NOT NULL CHECK (source = ANY (ARRAY['manual'::text, 'oj_projects'::text])),
  oj_entry_id uuid,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_miles_split CHECK (total_miles = (miles_at_standard_rate + miles_at_reduced_rate)),
  CONSTRAINT uq_oj_entry UNIQUE (oj_entry_id),
  CONSTRAINT mileage_trips_oj_entry_id_fkey FOREIGN KEY (oj_entry_id) REFERENCES public.oj_entries(id) ON DELETE SET NULL
);
CREATE INDEX idx_mileage_trips_date ON public.mileage_trips (trip_date DESC);
CREATE INDEX idx_mileage_trips_source ON public.mileage_trips (source);
CREATE TRIGGER trg_mileage_trips_updated_at BEFORE UPDATE ON public.mileage_trips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.mileage_trip_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.mileage_trips(id) ON DELETE CASCADE,
  leg_order smallint NOT NULL CHECK (leg_order > 0),
  from_destination_id uuid NOT NULL REFERENCES public.mileage_destinations(id),
  to_destination_id uuid NOT NULL REFERENCES public.mileage_destinations(id),
  miles numeric(8,1) NOT NULL CHECK (miles > (0)::numeric),
  CONSTRAINT uq_trip_leg_order UNIQUE (trip_id, leg_order)
);

ALTER TABLE public.mileage_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_destination_distances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_trip_legs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.insert_mileage_trip_legs_v01(p_trip_id uuid, p_legs jsonb, p_order_offset integer DEFAULT 0)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_leg jsonb;
  v_order integer := 0;
  v_total numeric := 0;
  v_from uuid;
  v_to uuid;
  v_miles numeric;
BEGIN
  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'Trip id is required';
  END IF;

  IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'array' OR jsonb_array_length(p_legs) = 0 THEN
    RAISE EXCEPTION 'At least one mileage leg is required';
  END IF;

  IF jsonb_array_length(p_legs) > 2000 THEN
    RAISE EXCEPTION 'Too many mileage legs';
  END IF;

  FOR v_leg IN SELECT value FROM jsonb_array_elements(p_legs)
  LOOP
    v_order := v_order + 1;
    IF p_order_offset + v_order > 32767 THEN
      RAISE EXCEPTION 'Too many mileage legs';
    END IF;

    v_from := COALESCE(v_leg->>'from_destination_id', v_leg->>'fromDestinationId')::uuid;
    v_to := COALESCE(v_leg->>'to_destination_id', v_leg->>'toDestinationId')::uuid;
    v_miles := (v_leg->>'miles')::numeric;

    IF v_from IS NULL OR v_to IS NULL THEN
      RAISE EXCEPTION 'Mileage leg destinations are required';
    END IF;
    IF v_miles IS NULL OR v_miles <= 0 THEN
      RAISE EXCEPTION 'Mileage leg miles must be greater than zero';
    END IF;

    INSERT INTO public.mileage_trip_legs (trip_id, leg_order, from_destination_id, to_destination_id, miles)
    VALUES (p_trip_id, p_order_offset + v_order, v_from, v_to, ROUND(v_miles, 1));

    v_total := v_total + ROUND(v_miles, 1);
  END LOOP;

  RETURN ROUND(v_total, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_mileage_tax_year_v01(p_trip_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_year integer;
  v_start date;
  v_end date;
  v_cumulative numeric := 0;
  v_standard_miles numeric;
  v_reduced_miles numeric;
  v_standard_rate numeric;
  v_trip record;
BEGIN
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;

  v_year := EXTRACT(YEAR FROM p_trip_date)::integer;
  IF EXTRACT(MONTH FROM p_trip_date)::integer > 4
     OR (EXTRACT(MONTH FROM p_trip_date)::integer = 4 AND EXTRACT(DAY FROM p_trip_date)::integer >= 6) THEN
    v_start := make_date(v_year, 4, 6);
  ELSE
    v_start := make_date(v_year - 1, 4, 6);
  END IF;
  v_end := (v_start + INTERVAL '1 year' - INTERVAL '1 day')::date;

  FOR v_trip IN
    SELECT id, trip_date, total_miles
    FROM public.mileage_trips
    WHERE trip_date BETWEEN v_start AND v_end
    ORDER BY trip_date ASC, created_at ASC, id ASC
    FOR UPDATE
  LOOP
    IF v_cumulative >= 10000 THEN
      v_standard_miles := 0;
      v_reduced_miles := v_trip.total_miles;
    ELSIF v_cumulative + v_trip.total_miles <= 10000 THEN
      v_standard_miles := v_trip.total_miles;
      v_reduced_miles := 0;
    ELSE
      v_standard_miles := 10000 - v_cumulative;
      v_reduced_miles := v_trip.total_miles - v_standard_miles;
    END IF;

    v_standard_rate := CASE WHEN v_trip.trip_date < DATE '2026-04-01' THEN 0.45 ELSE 0.55 END;

    UPDATE public.mileage_trips
    SET
      miles_at_standard_rate = ROUND(v_standard_miles, 1),
      miles_at_reduced_rate = ROUND(v_reduced_miles, 1),
      amount_due = ROUND((v_standard_miles * v_standard_rate) + (v_reduced_miles * 0.25), 2)
    WHERE id = v_trip.id;

    v_cumulative := v_cumulative + v_trip.total_miles;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_mileage_trip_v01(p_trip_date date, p_description text, p_total_miles numeric, p_created_by uuid, p_legs jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trip_id uuid;
  v_inserted_total numeric;
  v_standard_rate numeric;
BEGIN
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;
  IF p_total_miles IS NULL OR p_total_miles <= 0 THEN
    RAISE EXCEPTION 'Total miles must be greater than zero';
  END IF;

  v_standard_rate := CASE WHEN p_trip_date < DATE '2026-04-01' THEN 0.45 ELSE 0.55 END;

  INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, created_by)
  VALUES (p_trip_date, NULLIF(BTRIM(p_description), ''), ROUND(p_total_miles, 1), ROUND(p_total_miles, 1), 0, ROUND(p_total_miles * v_standard_rate, 2), 'manual', p_created_by)
  RETURNING id INTO v_trip_id;

  v_inserted_total := public.insert_mileage_trip_legs_v01(v_trip_id, p_legs, 0);
  IF ABS(v_inserted_total - ROUND(p_total_miles, 1)) > 0.05 THEN
    RAISE EXCEPTION 'Mileage leg total does not match trip total';
  END IF;

  PERFORM public.recalculate_mileage_tax_year_v01(p_trip_date);

  RETURN v_trip_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_mileage_trip_v01(p_trip_id uuid, p_trip_date date, p_description text, p_total_miles numeric, p_legs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
  v_inserted_total numeric;
  v_standard_rate numeric;
  v_order_offset integer := 30000;
BEGIN
  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'Trip id is required';
  END IF;
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'Trip date is required';
  END IF;
  IF p_total_miles IS NULL OR p_total_miles <= 0 THEN
    RAISE EXCEPTION 'Total miles must be greater than zero';
  END IF;

  SELECT id, source, trip_date, total_miles INTO v_existing
  FROM public.mileage_trips WHERE id = p_trip_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trip not found';
  END IF;
  IF v_existing.source = 'oj_projects' THEN
    RAISE EXCEPTION 'Cannot edit OJ Projects synced trips';
  END IF;

  v_standard_rate := CASE WHEN p_trip_date < DATE '2026-04-01' THEN 0.45 ELSE 0.55 END;

  v_inserted_total := public.insert_mileage_trip_legs_v01(p_trip_id, p_legs, v_order_offset);
  IF ABS(v_inserted_total - ROUND(p_total_miles, 1)) > 0.05 THEN
    RAISE EXCEPTION 'Mileage leg total does not match trip total';
  END IF;

  UPDATE public.mileage_trips
  SET trip_date = p_trip_date,
      description = NULLIF(BTRIM(p_description), ''),
      total_miles = ROUND(p_total_miles, 1),
      miles_at_standard_rate = ROUND(p_total_miles, 1),
      miles_at_reduced_rate = 0,
      amount_due = ROUND(p_total_miles * v_standard_rate, 2)
  WHERE id = p_trip_id;

  DELETE FROM public.mileage_trip_legs WHERE trip_id = p_trip_id AND leg_order < v_order_offset;
  UPDATE public.mileage_trip_legs SET leg_order = leg_order - v_order_offset
  WHERE trip_id = p_trip_id AND leg_order >= v_order_offset;

  PERFORM public.recalculate_mileage_tax_year_v01(p_trip_date);
  IF v_existing.trip_date <> p_trip_date THEN
    PERFORM public.recalculate_mileage_tax_year_v01(v_existing.trip_date);
  END IF;

  RETURN jsonb_build_object('id', p_trip_id, 'old_trip_date', v_existing.trip_date, 'old_total_miles', v_existing.total_miles);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_oj_mileage_to_trips()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_miles NUMERIC(8,1);
  v_description TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::NUMERIC(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, oj_entry_id, created_by)
      VALUES (NEW.entry_date, v_description, v_total_miles, v_total_miles, 0, v_total_miles * 0.55, 'oj_projects', NEW.id, auth.uid());
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.entry_type = 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::NUMERIC(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      UPDATE public.mileage_trips
      SET trip_date = NEW.entry_date,
          description = v_description,
          total_miles = v_total_miles,
          miles_at_standard_rate = v_total_miles,
          miles_at_reduced_rate = 0,
          amount_due = v_total_miles * 0.55,
          updated_at = now()
      WHERE oj_entry_id = OLD.id;
    ELSIF OLD.entry_type != 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::NUMERIC(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, oj_entry_id, created_by)
      VALUES (NEW.entry_date, v_description, v_total_miles, v_total_miles, 0, v_total_miles * 0.55, 'oj_projects', NEW.id, auth.uid());
    ELSIF OLD.entry_type = 'mileage' AND NEW.entry_type != 'mileage' THEN
      DELETE FROM public.mileage_trips WHERE oj_entry_id = OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.entry_type = 'mileage' THEN
      DELETE FROM public.mileage_trips WHERE oj_entry_id = OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_sync_oj_mileage AFTER INSERT OR DELETE OR UPDATE ON public.oj_entries
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_oj_mileage_to_trips();

REVOKE ALL ON FUNCTION public.insert_mileage_trip_legs_v01(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recalculate_mileage_tax_year_v01(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_oj_mileage_to_trips() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_mileage_trip_legs_v01(uuid, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_mileage_tax_year_v01(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_oj_mileage_to_trips() TO service_role;
