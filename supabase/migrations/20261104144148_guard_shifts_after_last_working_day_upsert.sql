-- Let an upsert of a shift already on the rota through the last-working-day guard when it keeps the
-- shift's employee and date.
--
-- INSERT ... ON CONFLICT runs BEFORE INSERT triggers before the conflict is resolved, so an upsert
-- of an existing row reached guard_shift_after_last_working_day (20261104143348) as an INSERT. The
-- rota's snapshot restore (getWeekShifts in src/app/actions/rota.ts) upserts a whole published week,
-- so one historic row dated after a leaver's last day refused the entire batch, including the
-- unrelated rows it was there to restore. Such a write is an edit to a row already on the rota,
-- which the guard was always meant to allow. A new row, or an upsert that changes the employee or
-- the date, is still checked exactly as before. Nothing else in the function changes.

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

  -- An upsert of a row already on the rota arrives here as an INSERT. Keeping that row's employee
  -- and date makes it an edit, not a new assignment.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM public.rota_shifts s
    WHERE s.id = NEW.id
      AND s.employee_id IS NOT DISTINCT FROM NEW.employee_id
      AND s.shift_date IS NOT DISTINCT FROM NEW.shift_date
  ) THEN
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

-- CREATE OR REPLACE keeps the existing grants; restated so this file stands on its own.
REVOKE ALL ON FUNCTION public.guard_shift_after_last_working_day()
  FROM PUBLIC, anon, authenticated;
