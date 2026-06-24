DROP FUNCTION IF EXISTS public.create_credit_note_atomic(uuid, numeric, text, uuid);
DROP INDEX IF EXISTS public.uniq_rota_couldnt_work_marker;
DROP INDEX IF EXISTS public.uniq_timeclock_sessions_open_employee;
