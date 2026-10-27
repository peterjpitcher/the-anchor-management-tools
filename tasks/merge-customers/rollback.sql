-- Rollback for supabase/migrations/20261027154845_merge_customers.sql.
-- Production held neither function before the migration (checked 27 October 2026), so the rollback
-- removes both. Merges already made are not undone: their rows stay on the kept record and the
-- duplicate stays anonymised (the audit log names both ids for each merge).
DROP FUNCTION IF EXISTS public.merge_customers(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.merge_customers_apply(uuid, uuid);
