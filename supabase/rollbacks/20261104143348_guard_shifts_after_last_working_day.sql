-- Rollback for 20261104143348_guard_shifts_after_last_working_day.sql (drafted as 20261103145125).
-- Removes the database backstop only; the app's own check (src/lib/rota/last-working-day-guard.ts)
-- still refuses a shift after someone's last working day.

DROP TRIGGER IF EXISTS guard_shift_after_last_working_day ON public.rota_shifts;
DROP FUNCTION IF EXISTS public.guard_shift_after_last_working_day();
