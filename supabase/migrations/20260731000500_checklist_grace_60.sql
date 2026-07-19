-- Checklists: staff have 1 hour from the due instant (open or close) before a
-- completion counts as late. Raises default_grace_minutes from 30 to 60.
-- close_lead_minutes stays 60, so closing tasks surface an hour before close.
-- Pending instances pick the new grace up at the next generation reconcile run
-- (or immediately via 'Regenerate today' on /checklists/manage/today).

ALTER TABLE public.checklist_settings
  ALTER COLUMN default_grace_minutes SET DEFAULT 60;

UPDATE public.checklist_settings
   SET default_grace_minutes = 60,
       updated_at = now()
 WHERE id = 1;
