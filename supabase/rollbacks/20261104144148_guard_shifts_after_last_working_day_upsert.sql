-- Rollback for 20261104144148_guard_shifts_after_last_working_day_upsert.sql.
-- Puts back the guard exactly as 20261104143348 created it, so an upsert of an existing row is
-- checked as a new insert again. The trigger itself is untouched.

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

REVOKE ALL ON FUNCTION public.guard_shift_after_last_working_day()
  FROM PUBLIC, anon, authenticated;
