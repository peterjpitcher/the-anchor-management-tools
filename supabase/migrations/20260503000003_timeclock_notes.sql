-- Add a free-text notes field to timeclock sessions for manager annotations.
ALTER TABLE public.timeclock_sessions
  ADD COLUMN IF NOT EXISTS notes TEXT;
