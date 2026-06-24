BEGIN;

DROP FUNCTION IF EXISTS public.convert_quote_to_invoice_atomic(uuid, date, date);

COMMIT;
