-- Checklists timing: staff have 1 hour from the due instant (open or close)
-- before a completion counts as late, and opening tasks surface 30 minutes
-- before opening time so early arrivals can start on them.
-- Raises default_grace_minutes 30 to 60 and open_lead_minutes 0 to 30.
-- close_lead_minutes stays 60, so closing tasks surface an hour before close.
-- Pending instances pick the new instants up at the next generation reconcile
-- run (or immediately via 'Regenerate today' on /checklists/manage/today).

ALTER TABLE public.checklist_settings
  ALTER COLUMN default_grace_minutes SET DEFAULT 60,
  ALTER COLUMN open_lead_minutes SET DEFAULT 30;

UPDATE public.checklist_settings
   SET default_grace_minutes = 60,
       open_lead_minutes = 30,
       updated_at = now()
 WHERE id = 1;
