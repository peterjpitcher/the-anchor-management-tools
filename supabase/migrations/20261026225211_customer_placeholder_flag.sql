-- Mark the made-up customers behind anonymous walk-ins so they stay out of customer lists,
-- counts and insights (BK-082, customer bookings review of 24 October 2026).
--
-- Every anonymous walk-in creates a customer with a made-up +447000 number
-- (src/lib/foh/walk-in-customer.ts), and deleting a customer that bookings still point at
-- anonymises it into the same range (src/services/customers.ts). Nothing told those records
-- apart, so on 26 October 2026 they were 313 of 1,288 customers and over 40% of "new customers"
-- in the last 90 days, and staff scrolled past "Walk-in" rows when searching.
--
-- The app sets the flag when it creates or anonymises one and filters it out of the customer
-- list, the front-of-house search, the dashboard customer tiles and the insights. SMS audiences
-- already exclude them (texts are off on every one). None holds an email address today.
--
-- 07000 numbers are personal-number ranges no guest gives as a mobile, which is why the app
-- chose them; 313 rows match, 0 hold an email, and 263 are named "Walk-in".
--
-- Adding a NOT NULL column with a constant default is a catalogue-only change on Postgres 11+;
-- the backfill touches 313 rows and fires no trigger (the only one on customers watches names).
-- No view selects customers with *, so none needs rebuilding. Grants are unchanged.
--
-- Rollback: tasks/customer-placeholder-flag/rollback.sql

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.is_placeholder IS
  'True for a made-up customer: an anonymous walk-in or an anonymised record, both on a +447000 number. Kept out of customer lists, counts and insights.';

UPDATE public.customers
   SET is_placeholder = true
 WHERE mobile_e164 LIKE '+447000%'
   AND is_placeholder = false;
