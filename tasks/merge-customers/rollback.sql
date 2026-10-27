-- Rollback for supabase/migrations/20261027154845_merge_customers.sql.
-- Production held neither function before the migration (checked 27 October 2026), so the rollback
-- removes both. Merges already made are not undone: their rows stay on the kept record and the
-- duplicate stays anonymised (the audit log names both ids for each merge).
DROP FUNCTION IF EXISTS public.merge_customers(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.merge_customers_apply(uuid, uuid);
-- Roll back the unsubscribe route (src/lib/email/unsubscribe.ts) first: it reads this column.
-- Dropping it forgets where merged records went, so an old link of a merged record then opts
-- out only the anonymised duplicate.
ALTER TABLE public.customers DROP COLUMN IF EXISTS merged_into_customer_id;
