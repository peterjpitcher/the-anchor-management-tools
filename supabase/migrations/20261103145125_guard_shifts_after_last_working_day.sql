-- Refuse a rota shift dated after someone's last working day, whatever their separation policy.
--
-- guard_released_separation_assignment (20260914075843) refuses only someone released from their
-- remaining shifts. Someone working their notice stayed assignable at the database, so any write
-- that skipped the app's own check (src/lib/rota/last-working-day-guard.ts) could give them a shift
-- after they leave, and marking them as Former then refused until a manager moved it. This is the
-- backstop, on the app's rule: the last working day itself is fine, the day after is not. It covers
-- someone on notice and someone already Former with a recorded last working day.
--
-- Only a new assignment or a moved date is checked. An edit to a shift already on the rota (its
-- hours, notes or status) is never refused, so the historic rows dated after a leaver's last day
-- still save. A cancelled shift is not work and is never refused. Templates have no date and keep
-- their existing rule. The existing guard is left exactly as it is.

CREATE OR REPLACE FUNCTION public.guard_shift_after_last_working_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF NEW.employee_id IS NULL OR NEW.status IS NOT DISTINCT FROM 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id
     AND NEW.shift_date IS NOT DISTINCT FROM OLD.shift_date THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.employee_id = NEW.employee_id
      AND e.status IN ('Started Separation', 'Former')
      AND e.employment_end_date IS NOT NULL
      AND NEW.shift_date > e.employment_end_date
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'This shift is after the employee''s last working day, so they cannot be given it.';
  END IF;

  RETURN NEW;
END;
$function$;

-- A trigger function needs no EXECUTE grant to fire; nobody calls it directly.
REVOKE ALL ON FUNCTION public.guard_shift_after_last_working_day()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER guard_shift_after_last_working_day
BEFORE INSERT OR UPDATE OF employee_id, shift_date ON public.rota_shifts
FOR EACH ROW
EXECUTE FUNCTION public.guard_shift_after_last_working_day();
