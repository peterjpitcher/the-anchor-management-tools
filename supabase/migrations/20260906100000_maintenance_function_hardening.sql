-- Clears the three Supabase security advisor warnings raised by
-- 20260905210000_maintenance_tracker.sql. No behaviour changes.
--
-- 1 and 2: both functions had a role mutable search_path. A caller can set
--    search_path, so an unqualified name inside the function body could resolve
--    to an object the caller controls. maintenance_items_normalise reads
--    public.maintenance_areas, so it matters most there, but pinning both is
--    free and removes the whole class.
-- 3: maintenance_items_write_history is SECURITY DEFINER, so it was executable
--    by authenticated over /rest/v1/rpc. Calling a trigger function directly
--    raises "trigger functions can only be called as triggers", so it was not
--    exploitable, but a definer function should not be reachable at all when
--    only a trigger is meant to call it.

CREATE OR REPLACE FUNCTION public.maintenance_format_reference(n bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT 'M-' || CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END
$$;

CREATE OR REPLACE FUNCTION public.maintenance_items_normalise()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_today date := (timezone('Europe/London', now()))::date;
  v_check_area boolean := false;
BEGIN
  NEW.title := btrim(NEW.title);
  NEW.description := nullif(btrim(NEW.description), '');
  NEW.contractor_name := nullif(btrim(NEW.contractor_name), '');
  NEW.contractor_contact := nullif(btrim(NEW.contractor_contact), '');
  NEW.created_by_email := nullif(btrim(NEW.created_by_email), '');

  IF NEW.reported_on > v_today THEN
    RAISE EXCEPTION 'maintenance_items.reported_on cannot be in the future (today in London is %)', v_today
      USING ERRCODE = '22007';
  END IF;

  IF NEW.completed_on IS NOT NULL AND NEW.completed_on > v_today THEN
    RAISE EXCEPTION 'maintenance_items.completed_on cannot be in the future (today in London is %)', v_today
      USING ERRCODE = '22007';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_check_area := true;
  ELSIF NEW.area_id IS DISTINCT FROM OLD.area_id THEN
    v_check_area := true;
  END IF;

  IF v_check_area AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_areas a
    WHERE a.id = NEW.area_id AND a.active
  ) THEN
    RAISE EXCEPTION 'That area is no longer available. Pick another one.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'maintenance_items.id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.reference IS DISTINCT FROM OLD.reference THEN
      RAISE EXCEPTION 'maintenance_items.reference is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'maintenance_items.created_at is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.created_by IS NOT NULL
       AND NEW.created_by IS NOT NULL
       AND NEW.created_by <> OLD.created_by THEN
      RAISE EXCEPTION 'maintenance_items.created_by is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Only the trigger should ever run this. The trigger itself is unaffected:
-- Postgres does not check EXECUTE on a trigger function when firing a trigger.
REVOKE EXECUTE ON FUNCTION public.maintenance_items_write_history() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.maintenance_items_write_history() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.maintenance_items_write_history() FROM anon;
