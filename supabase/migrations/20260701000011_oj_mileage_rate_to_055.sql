-- Update OJ-Projects vendor mileage rate to match new HMRC AMAP standard.
--
-- HMRC standard rate increased from £0.45 to £0.55 from 1 April 2026.
-- OJ-Projects tracks the HMRC rate as the per-vendor billing rate. This
-- migration:
--   1. Updates the column DEFAULT for new vendors to 0.55.
--   2. Bumps every vendor still on the previous 0.45 rate to 0.55.
--   3. Refreshes the mileage sync trigger so its placeholder `amount_due`
--      reflects the new rate. The application layer still recalculates the
--      final HMRC rate split (date-aware) after the trigger fires.

-- 1. Column default
ALTER TABLE public.oj_vendor_billing_settings
  ALTER COLUMN mileage_rate SET DEFAULT 0.550;

-- 2. Existing vendors at the prior rate
UPDATE public.oj_vendor_billing_settings
SET mileage_rate = 0.55
WHERE mileage_rate = 0.45;

-- 3. Refresh sync trigger function with the new placeholder rate
CREATE OR REPLACE FUNCTION public.fn_sync_oj_mileage_to_trips()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_miles NUMERIC(8,1);
  v_description TEXT;
BEGIN
  -- ---- INSERT ----
  IF TG_OP = 'INSERT' THEN
    IF NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::NUMERIC(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');

      INSERT INTO public.mileage_trips (
        trip_date,
        description,
        total_miles,
        miles_at_standard_rate,
        miles_at_reduced_rate,
        amount_due,
        source,
        oj_entry_id,
        created_by
      ) VALUES (
        NEW.entry_date,
        v_description,
        v_total_miles,
        v_total_miles,           -- default: all at standard rate
        0,                       -- default: none at reduced rate
        v_total_miles * 0.55,    -- placeholder: app-layer recalc applies date-aware HMRC rate
        'oj_projects',
        NEW.id,
        auth.uid()
      );
    END IF;

    RETURN NEW;
  END IF;

  -- ---- UPDATE ----
  IF TG_OP = 'UPDATE' THEN
    -- mileage → mileage: update synced row
    IF OLD.entry_type = 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::NUMERIC(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');

      UPDATE public.mileage_trips
      SET
        trip_date = NEW.entry_date,
        description = v_description,
        total_miles = v_total_miles,
        miles_at_standard_rate = v_total_miles,
        miles_at_reduced_rate = 0,
        amount_due = v_total_miles * 0.55,
        updated_at = now()
      WHERE oj_entry_id = OLD.id;

    -- non-mileage → mileage: create synced row
    ELSIF OLD.entry_type != 'mileage' AND NEW.entry_type = 'mileage' THEN
      v_total_miles := COALESCE(NEW.miles, 0)::NUMERIC(8,1);
      v_description := COALESCE(NEW.description, 'OJ Projects mileage');

      INSERT INTO public.mileage_trips (
        trip_date,
        description,
        total_miles,
        miles_at_standard_rate,
        miles_at_reduced_rate,
        amount_due,
        source,
        oj_entry_id,
        created_by
      ) VALUES (
        NEW.entry_date,
        v_description,
        v_total_miles,
        v_total_miles,
        0,
        v_total_miles * 0.55,
        'oj_projects',
        NEW.id,
        auth.uid()
      );

    -- mileage → non-mileage: delete synced row
    ELSIF OLD.entry_type = 'mileage' AND NEW.entry_type != 'mileage' THEN
      DELETE FROM public.mileage_trips
      WHERE oj_entry_id = OLD.id;
    END IF;

    -- other → other: no-op (falls through)
    RETURN NEW;
  END IF;

  -- ---- DELETE ----
  IF TG_OP = 'DELETE' THEN
    IF OLD.entry_type = 'mileage' THEN
      DELETE FROM public.mileage_trips
      WHERE oj_entry_id = OLD.id;
    END IF;

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;
