-- Rollback for supabase/migrations/20261027180333_customer_contact_suppressions.sql.
-- Production held none of these objects before the migration (checked 27 October 2026), so the
-- rollback removes them all. Any suppression rows written since are lost with the table: a
-- customer deleted or merged in the meantime would again come back without their opt-outs.
DROP TRIGGER IF EXISTS customers_apply_contact_suppression ON public.customers;
DROP FUNCTION IF EXISTS public.apply_customer_contact_suppression();
DROP FUNCTION IF EXISTS public.record_customer_contact_suppression(uuid[], text);
DROP FUNCTION IF EXISTS public.customer_contact_hash(text, text);
DROP TABLE IF EXISTS public.customer_contact_suppressions;
