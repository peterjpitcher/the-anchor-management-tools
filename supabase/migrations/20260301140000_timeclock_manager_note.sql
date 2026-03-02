-- Add manager_note column to timeclock_sessions for historical import and ongoing use
ALTER TABLE public.timeclock_sessions
  ADD COLUMN IF NOT EXISTS manager_note TEXT;

COMMENT ON COLUMN public.timeclock_sessions.manager_note IS 'Manager annotation on this clock session (from old system or added manually).';
