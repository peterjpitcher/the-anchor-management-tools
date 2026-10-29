-- Private hire contracts and contact details (release 26 of the customer bookings review of
-- 24 October 2026: BK-154 with owner decision D25, and BK-163).
--
--   * BK-154, D25. A private booking contract fixes the date, the times, the guest numbers, the
--     rooms and the price. Once it was accepted, a later change to any of them went unnoticed: the
--     booking kept a green "Contract Accepted" and a re-sent version could never record its
--     signature. private_bookings.contract_terms keeps those terms as the contract last sent named
--     them (written by the app when a contract is sent, or recorded as accepted another way, from
--     src/lib/private-bookings/contract-terms.ts). The app compares it with the booking to show
--     "Contract out of date, send version N+1", to withdraw an open signing request on old terms,
--     and to let the next version's signature replace an acceptance of old terms. Nullable, with no
--     default and no backfill: a contract sent before this column existed has no record of what it
--     said, so it is never flagged.
--   * BK-163 step 4. sync_customer_name_trigger (BEFORE INSERT OR UPDATE OF customer_id) copied the
--     linked customer's name over the name typed on a new booking, so an enquiry from a known email
--     became the customer's name. On INSERT the customer's name now fills in only when the booking
--     arrives with no first or last name. Relinking a booking to another customer (UPDATE OF
--     customer_id) still takes that customer's name, as before.
--
-- Live data this changes: none. The column is added empty; the trigger change affects only rows
-- inserted from now on. No existing booking is read or written.
--
-- sync_customer_name_from_customers is patched in place, as 20261028125055 did: the live
-- definition is read with pg_get_functiondef, the old passage is replaced, and the result is
-- executed. The block refuses to run unless the old passage appears exactly once, so a definition
-- that has moved on fails loudly; a second run is a no-op. CREATE OR REPLACE keeps the owner, the
-- grants and search_path; the grants are restated at the end anyway, anon's included, as
-- production has them (it is a trigger function, so nobody can call it directly). Body checked
-- against production on 28 October 2026: md5(prosrc) sync_customer_name_from_customers
-- 98d4cb3a39992dc5bf0df1181a99d7ce.
--
-- Rollback: tasks/private-hire-tidy/rollback.sql. Tested by
-- scripts/testing/private-hire-contract-terms-postgres.py.

ALTER TABLE public.private_bookings ADD COLUMN IF NOT EXISTS contract_terms jsonb;

COMMENT ON COLUMN public.private_bookings.contract_terms IS
  'The date, times, guest count, rooms and total the contract last sent (or accepted another way) named, as src/lib/private-bookings/contract-terms.ts writes them. Compared with the booking to flag an out-of-date contract (BK-154, D25). NULL for a contract sent before 28 October 2026.';

DO $patch$
DECLARE
  v_oid oid;
  v_count integer;
  v_def text;
  v_old_text text := $old$    IF FOUND THEN
      NEW.customer_first_name := v_first;$old$;
  v_new_text text := $new$    -- BK-163: a new booking keeps the name typed on it. The customer's name fills in only
    -- when none was given; relinking an existing booking still takes the new customer's name.
    IF FOUND AND TG_OP = 'INSERT'
       AND btrim(coalesce(NEW.customer_first_name, '') || coalesce(NEW.customer_last_name, '')) <> '' THEN
      RETURN NEW;
    END IF;
    IF FOUND THEN
      NEW.customer_first_name := v_first;$new$;
  v_old_hits integer;
  v_new_hits integer;
BEGIN
  SELECT count(*), min(p.oid) INTO v_count, v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sync_customer_name_from_customers';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'private_hire_contract_terms: expected one sync_customer_name_from_customers, found %', v_count;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_new_hits := (length(v_def) - length(replace(v_def, v_new_text, ''))) / length(v_new_text);
  IF v_new_hits = 1 THEN
    RAISE NOTICE 'private_hire_contract_terms: sync_customer_name_from_customers already patched, skipped';
    RETURN;
  END IF;

  v_old_hits := (length(v_def) - length(replace(v_def, v_old_text, ''))) / length(v_old_text);
  IF v_old_hits <> 1 OR v_new_hits <> 0 THEN
    RAISE EXCEPTION 'private_hire_contract_terms: sync_customer_name_from_customers found % old and % new passages, expected 1 and 0',
      v_old_hits, v_new_hits;
  END IF;

  EXECUTE replace(v_def, v_old_text, v_new_text);
  RAISE NOTICE 'private_hire_contract_terms: sync_customer_name_from_customers patched';
END
$patch$;

-- As production has them on 28 October 2026 (PUBLIC, anon, authenticated, service_role).
GRANT EXECUTE ON FUNCTION public.sync_customer_name_from_customers() TO anon, authenticated, service_role;
