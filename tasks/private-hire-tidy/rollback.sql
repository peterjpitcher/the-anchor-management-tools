-- Rollback for release 26 (private hire tidy). Drafted only; run by hand with the owner's go-ahead.
--
-- 1. 20261029083000_private_hire_contract_terms.sql
--    Puts sync_customer_name_from_customers back exactly as production had it on 28 October 2026
--    (md5(prosrc) 98d4cb3a39992dc5bf0df1181a99d7ce) and drops private_bookings.contract_terms.
--    Dropping the column loses the contract terms recorded since the release: every contract
--    sent since then stops being checked for changes. Roll back the app code first (it reads and
--    writes the column), then run this.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_customer_name_from_customers()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_first text;
  v_last  text;
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT first_name, last_name INTO v_first, v_last
    FROM customers WHERE id = NEW.customer_id;
    IF FOUND THEN
      NEW.customer_first_name := v_first;
      NEW.customer_last_name  := v_last;
      IF btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, '')) <> '' THEN
        NEW.customer_name := btrim(coalesce(v_first, '') || ' ' || coalesce(v_last, ''));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.sync_customer_name_from_customers() TO anon, authenticated, service_role;

ALTER TABLE public.private_bookings DROP COLUMN IF EXISTS contract_terms;

COMMIT;

-- 2. 20261029083100_private_hire_portal_links_and_requested_room.sql
--    Drops the two columns. Switched-off booking links start working again until they expire,
--    and the rooms website enquiries asked for are lost (the manager email still named them).
--    Roll back the app code first.

BEGIN;

ALTER TABLE public.private_bookings DROP CONSTRAINT IF EXISTS private_bookings_requested_space_id_fkey;
ALTER TABLE public.private_bookings DROP COLUMN IF EXISTS requested_space_id;
ALTER TABLE public.private_bookings DROP COLUMN IF EXISTS portal_links_revoked_at;

COMMIT;
