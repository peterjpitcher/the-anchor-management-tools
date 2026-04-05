-- OJ-Projects mileage → mileage_trips sync trigger
--
-- Lightweight trigger that syncs oj_entries rows with entry_type = 'mileage'
-- into mileage_trips. Does NOT perform HMRC rate recalculation — the
-- application layer handles that after the transaction commits.
--
-- Behaviour matrix:
--   INSERT + NEW.entry_type = 'mileage'        → create mileage_trips row
--   INSERT + NEW.entry_type ≠ 'mileage'        → no-op
--   UPDATE + OLD/NEW both 'mileage'            → update synced row
--   UPDATE + OLD ≠ 'mileage', NEW = 'mileage'  → create synced row
--   UPDATE + OLD = 'mileage', NEW ≠ 'mileage'  → delete synced row
--   UPDATE + neither is 'mileage'              → no-op
--   DELETE + OLD.entry_type = 'mileage'        → delete synced row
--   DELETE + OLD.entry_type ≠ 'mileage'        → no-op

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
        v_total_miles * 0.45,    -- default: all at £0.45/mile
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
        amount_due = v_total_miles * 0.45,
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
        v_total_miles * 0.45,
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

-- Attach trigger to oj_entries
DROP TRIGGER IF EXISTS trg_sync_oj_mileage ON public.oj_entries;

CREATE TRIGGER trg_sync_oj_mileage
  AFTER INSERT OR UPDATE OR DELETE
  ON public.oj_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_oj_mileage_to_trips();
