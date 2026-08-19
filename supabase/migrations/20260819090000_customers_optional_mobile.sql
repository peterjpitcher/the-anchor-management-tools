-- Allow a customer record with no mobile number, so a website newsletter sign-up can
-- exist as a customer rather than as a second, parallel contact list.
--
-- WHY THIS IS SAFE
--
-- 1. `chk_customer_phone_format` has always read `mobile_number IS NULL OR <format>`, so
--    the table's own validation already anticipated a null number. Only the column-level
--    NOT NULL blocked it. This finishes a migration that was started and left half done.
--
-- 2. `idx_customers_mobile_e164` is a plain unique index. Postgres treats NULLs as
--    distinct, so any number of phone-less rows coexist without colliding.
--
-- 3. The five SMS-critical functions were audited on 2026-08-19 and are already
--    null-guarded, so none of them will pick up a phone-less customer and try to text it:
--      - get_bulk_sms_recipients
--      - get_bookings_needing_reminders
--      - voucher_reminders_claim_due
--      - register_guest_transaction
--      - import_customers_atomic
--
-- 4. `get_category_regulars` and `get_cross_category_suggestions` return mobile_number
--    without a null check, but both INNER JOIN `customer_category_stats`, which only ever
--    has rows for a customer who has attended an event. A newsletter-only subscriber has
--    no such row, so neither function can reach them. Left unchanged deliberately: adding
--    a redundant guard would imply the join was not already doing the work.
--
-- WHAT STILL HAS TO BE TRUE IN APPLICATION CODE
--
-- `customers.sms_opt_in` DEFAULTS TO TRUE. A phone-less record inserted without setting it
-- explicitly would claim SMS marketing consent it was never given, and would sit in the
-- SMS-eligible pool with nothing to send to. Any code path creating an email-only customer
-- MUST set, explicitly:
--     sms_opt_in            = false
--     marketing_sms_opt_in  = false
--     sms_status            = 'active'   (the CHECK forbids null; 'active' is inert with no number)
-- The partial index below exists so a drift check can find any record that got this wrong.

-- No explicit BEGIN/COMMIT: the Supabase migration runner wraps each file in its own
-- transaction, and committing early inside that would break its error handling.

ALTER TABLE public.customers
  ALTER COLUMN mobile_number DROP NOT NULL;

COMMENT ON COLUMN public.customers.mobile_number IS
  'Optional since 2026-08-19, so a website newsletter subscriber can exist without a phone number. Any code creating a phone-less customer must explicitly set sms_opt_in = false and marketing_sms_opt_in = false, because sms_opt_in defaults to true.';

-- Finds records that claim SMS consent while having no number to send to. Should always be
-- empty; a non-empty result means a create path forgot the rule in the comment above.
CREATE INDEX IF NOT EXISTS idx_customers_phoneless_sms_claim
  ON public.customers (id)
  WHERE mobile_number IS NULL AND (sms_opt_in IS TRUE OR marketing_sms_opt_in IS TRUE);

-- ROLLBACK
--
-- Only reversible while no phone-less rows exist. Restoring NOT NULL with subscribers
-- present would fail, so delete or backfill them first:
--
--   SELECT count(*) FROM public.customers WHERE mobile_number IS NULL;
--   DROP INDEX IF EXISTS public.idx_customers_phoneless_sms_claim;
--   ALTER TABLE public.customers ALTER COLUMN mobile_number SET NOT NULL;
