BEGIN;

DROP FUNCTION IF EXISTS public.import_customers_atomic(jsonb);

COMMIT;
