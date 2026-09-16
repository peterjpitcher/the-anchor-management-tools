-- Mileage drivers, foundation. Adds drivers and their cars, driver columns on trips (nullable
-- until the cutover migration), v02 save functions that record the driver, a per-driver rate
-- preview, and OJ Projects sync that assigns the OJ Projects driver.
--
-- Spec: tasks/spec-2026-09-15-mileage-section-design.md sections 4.4 and 5.
-- No existing row changes. Driver names and cars are added later by a script, never here.
-- Until the cutover, OJ Projects mileage saved while no OJ Projects driver is set up still syncs,
-- with no driver; the backfill attributes it.

BEGIN;

CREATE TABLE public.mileage_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  drives_oj_projects boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mileage_drivers_display_name_length CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
  CONSTRAINT mileage_drivers_oj_driver_active CHECK (NOT drives_oj_projects OR is_active)
);
CREATE UNIQUE INDEX mileage_drivers_display_name_key ON public.mileage_drivers (lower(btrim(display_name)));
CREATE UNIQUE INDEX mileage_drivers_one_oj_driver ON public.mileage_drivers (drives_oj_projects) WHERE drives_oj_projects;
CREATE TRIGGER trg_mileage_drivers_updated_at BEFORE UPDATE ON public.mileage_drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.mileage_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.mileage_drivers(id) ON DELETE RESTRICT,
  valid_from date NOT NULL,
  fuel_type text NOT NULL CHECK (fuel_type IN ('petrol', 'diesel', 'lpg', 'electric_home', 'electric_public')),
  engine_cc integer CHECK (engine_cc IS NULL OR engine_cc BETWEEN 50 AND 10000),
  description text CHECK (description IS NULL OR char_length(description) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mileage_vehicles_engine_required CHECK (fuel_type IN ('electric_home', 'electric_public') OR engine_cc IS NOT NULL),
  CONSTRAINT mileage_vehicles_driver_valid_from_key UNIQUE (driver_id, valid_from)
);

ALTER TABLE public.mileage_trips
  ADD COLUMN driver_id uuid REFERENCES public.mileage_drivers(id) ON DELETE RESTRICT,
  ADD COLUMN driver_basis text CHECK (driver_basis IN ('entered', 'owner_statement', 'oj_projects')),
  ADD COLUMN create_request_id uuid;
ALTER TABLE public.mileage_trips
  ADD CONSTRAINT mileage_trips_driver_basis_pair CHECK ((driver_id IS NULL) = (driver_basis IS NULL));
CREATE UNIQUE INDEX mileage_trips_create_request_id_key ON public.mileage_trips (create_request_id)
  WHERE create_request_id IS NOT NULL;
CREATE INDEX idx_mileage_trips_driver_date ON public.mileage_trips (driver_id, trip_date);

-- Row level security on, with no policies: only the service role (which bypasses RLS) reads them.
-- The live default privileges give the service role every table privilege on new tables, so it
-- is revoked too and granted only what the app and the setup script use.
ALTER TABLE public.mileage_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_vehicles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mileage_drivers FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.mileage_vehicles FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.mileage_drivers TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.mileage_vehicles TO service_role;

-- Shared input checks for both save functions. Messages are codes the app maps to wording.
CREATE OR REPLACE FUNCTION public.mileage_assert_trip_input_v01(p_trip_date date, p_description text, p_total_miles numeric, p_driver_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_trip_date IS NULL THEN
    RAISE EXCEPTION 'MILEAGE_TRIP_DATE_REQUIRED';
  END IF;
  IF p_trip_date > (now() AT TIME ZONE 'Europe/London')::date THEN
    RAISE EXCEPTION 'MILEAGE_TRIP_DATE_IN_FUTURE';
  END IF;
  IF p_description IS NULL OR char_length(p_description) = 0 OR char_length(p_description) > 500 THEN
    RAISE EXCEPTION 'MILEAGE_REASON_REQUIRED';
  END IF;
  IF p_total_miles IS NULL OR p_total_miles <= 0 THEN
    RAISE EXCEPTION 'MILEAGE_MILES_REQUIRED';
  END IF;
  IF p_driver_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.mileage_drivers WHERE id = p_driver_id AND is_active) THEN
    RAISE EXCEPTION 'MILEAGE_DRIVER_REQUIRED';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_manual_mileage_trip_v02(
  p_trip_date date,
  p_description text,
  p_total_miles numeric,
  p_created_by uuid,
  p_legs jsonb,
  p_driver_id uuid,
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_trip_id uuid;
  v_inserted_total numeric;
  v_description text := NULLIF(BTRIM(p_description), '');
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'MILEAGE_REQUEST_ID_REQUIRED';
  END IF;

  -- A retried save returns the trip the first attempt created.
  SELECT id INTO v_trip_id FROM public.mileage_trips WHERE create_request_id = p_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_trip_id, 'created', false);
  END IF;

  PERFORM public.mileage_assert_trip_input_v01(p_trip_date, v_description, p_total_miles, p_driver_id);

  BEGIN
    -- Placeholder figures; trg_mileage_trips_recalculate prices the trip in this transaction.
    INSERT INTO public.mileage_trips (
      trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due,
      source, created_by, driver_id, driver_basis, create_request_id
    )
    VALUES (
      p_trip_date, v_description, ROUND(p_total_miles, 1), ROUND(p_total_miles, 1), 0, 0,
      'manual', p_created_by, p_driver_id, 'entered', p_request_id
    )
    RETURNING id INTO v_trip_id;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent save with the same request id committed first.
    SELECT id INTO v_trip_id FROM public.mileage_trips WHERE create_request_id = p_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object('id', v_trip_id, 'created', false);
    END IF;
    RAISE;
  END;

  v_inserted_total := public.insert_mileage_trip_legs_v01(v_trip_id, p_legs, 0);
  IF ABS(v_inserted_total - ROUND(p_total_miles, 1)) > 0.05 THEN
    RAISE EXCEPTION 'Mileage leg total does not match trip total';
  END IF;

  RETURN jsonb_build_object('id', v_trip_id, 'created', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_manual_mileage_trip_v02(
  p_trip_id uuid,
  p_trip_date date,
  p_description text,
  p_total_miles numeric,
  p_legs jsonb,
  p_driver_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
  v_inserted_total numeric;
  v_description text := NULLIF(BTRIM(p_description), '');
  v_order_offset integer := 30000;
BEGIN
  SELECT id, source, trip_date, total_miles, updated_at INTO v_existing
  FROM public.mileage_trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MILEAGE_TRIP_NOT_FOUND';
  END IF;
  IF v_existing.source = 'oj_projects' THEN
    RAISE EXCEPTION 'MILEAGE_OJ_TRIP_READ_ONLY';
  END IF;
  -- The caller sends updated_at exactly as it loaded it; any later write makes the edit stale.
  IF p_expected_updated_at IS NULL OR v_existing.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'MILEAGE_TRIP_CONFLICT';
  END IF;

  PERFORM public.mileage_assert_trip_input_v01(p_trip_date, v_description, p_total_miles, p_driver_id);

  v_inserted_total := public.insert_mileage_trip_legs_v01(p_trip_id, p_legs, v_order_offset);
  IF ABS(v_inserted_total - ROUND(p_total_miles, 1)) > 0.05 THEN
    RAISE EXCEPTION 'Mileage leg total does not match trip total';
  END IF;

  -- Placeholder figures; the trigger reprices the old and new groups in this transaction.
  UPDATE public.mileage_trips
  SET trip_date = p_trip_date,
      description = v_description,
      total_miles = ROUND(p_total_miles, 1),
      miles_at_standard_rate = ROUND(p_total_miles, 1),
      miles_at_reduced_rate = 0,
      amount_due = 0,
      driver_id = p_driver_id,
      driver_basis = 'entered'
  WHERE id = p_trip_id;

  DELETE FROM public.mileage_trip_legs WHERE trip_id = p_trip_id AND leg_order < v_order_offset;
  UPDATE public.mileage_trip_legs SET leg_order = leg_order - v_order_offset
  WHERE trip_id = p_trip_id AND leg_order >= v_order_offset;

  RETURN jsonb_build_object('id', p_trip_id, 'old_trip_date', v_existing.trip_date, 'old_total_miles', v_existing.total_miles);
END;
$function$;

-- Miles the driver had already logged in the tax year before this trip's position.
-- A new trip (p_trip_id null) counts after every existing trip on the same day.
CREATE OR REPLACE FUNCTION public.mileage_rate_preview_v01(p_driver_id uuid, p_trip_date date, p_trip_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(t.total_miles), 0)
  FROM public.mileage_trips t
  LEFT JOIN public.mileage_trips target ON target.id = p_trip_id
  WHERE t.driver_id = p_driver_id
    AND t.trip_date >= public.mileage_tax_year_start_v01(p_trip_date)
    AND t.id IS DISTINCT FROM p_trip_id
    AND (
      t.trip_date < p_trip_date
      OR (t.trip_date = p_trip_date AND (target.id IS NULL OR (t.created_at, t.id) < (target.created_at, target.id)))
    );
$$;

-- OJ Projects sync: the same behaviour as before, plus the OJ Projects driver on new trips.
-- Updates never change the driver. Placeholder figures are priced by the trigger.
-- Same signature, owner, SECURITY DEFINER, search_path and grants as the live function.
CREATE OR REPLACE FUNCTION public.fn_sync_oj_mileage_to_trips()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total_miles numeric(8,1);
  v_description text;
  v_driver_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::numeric(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      SELECT id INTO v_driver_id FROM public.mileage_drivers WHERE drives_oj_projects AND is_active;
      INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, oj_entry_id, created_by, driver_id, driver_basis)
      VALUES (NEW.entry_date, v_description, v_total_miles, v_total_miles, 0, 0, 'oj_projects', NEW.id, auth.uid(), v_driver_id,
              CASE WHEN v_driver_id IS NULL THEN NULL ELSE 'oj_projects' END);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.entry_type = 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::numeric(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      UPDATE public.mileage_trips
      SET trip_date = NEW.entry_date,
          description = v_description,
          total_miles = v_total_miles,
          miles_at_standard_rate = v_total_miles,
          miles_at_reduced_rate = 0,
          amount_due = 0
      WHERE oj_entry_id = OLD.id;
    ELSIF OLD.entry_type <> 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::numeric(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');
      SELECT id INTO v_driver_id FROM public.mileage_drivers WHERE drives_oj_projects AND is_active;
      INSERT INTO public.mileage_trips (trip_date, description, total_miles, miles_at_standard_rate, miles_at_reduced_rate, amount_due, source, oj_entry_id, created_by, driver_id, driver_basis)
      VALUES (NEW.entry_date, v_description, v_total_miles, v_total_miles, 0, 0, 'oj_projects', NEW.id, auth.uid(), v_driver_id,
              CASE WHEN v_driver_id IS NULL THEN NULL ELSE 'oj_projects' END);
    ELSIF OLD.entry_type = 'mileage' AND NEW.entry_type <> 'mileage' THEN
      DELETE FROM public.mileage_trips WHERE oj_entry_id = OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- The cascading foreign key (Release 1) has already removed the trip.
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.mileage_assert_trip_input_v01(date, text, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_manual_mileage_trip_v02(date, text, numeric, uuid, jsonb, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_manual_mileage_trip_v02(uuid, date, text, numeric, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mileage_rate_preview_v01(uuid, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_sync_oj_mileage_to_trips() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mileage_assert_trip_input_v01(date, text, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_manual_mileage_trip_v02(date, text, numeric, uuid, jsonb, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_manual_mileage_trip_v02(uuid, date, text, numeric, jsonb, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.mileage_rate_preview_v01(uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_sync_oj_mileage_to_trips() TO service_role;

COMMIT;
