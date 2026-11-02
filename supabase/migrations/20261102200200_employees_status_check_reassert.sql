-- Re-state the four employee statuses the app uses.
--
-- 20260227000001 set the check to Onboarding, Active, Started Separation and Former, but
-- 20260411000000 (committed earlier with a later timestamp) replaces it with Active, Former and
-- Prospective. Production applied them in an order that left the four-status check in place, so
-- this changes nothing there. A fresh database built from these files (a local reset, a branch,
-- a restore) runs 20260411000000 last and would then refuse every invite (Onboarding) and every
-- separation (Started Separation). This puts the files back in step with production.

alter table public.employees drop constraint if exists employees_status_check;
alter table public.employees add constraint employees_status_check
  check (status = any (array['Onboarding'::text, 'Active'::text, 'Started Separation'::text, 'Former'::text]));
