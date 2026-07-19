-- Optional rendered HTML body for a checklist outbox email. Breach/system-alert rows leave
-- it null and fall back to a subject-only body; the weekly summary stores its full HTML here.
ALTER TABLE public.checklist_email_outbox ADD COLUMN body_html text;
