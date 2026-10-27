-- BK-165 (customer bookings review of 24 October 2026), part 2 of 2: drop the customer
-- table-booking counters (owner approved, release 28).
--
-- customers.table_booking_count and customers.last_table_booking_date only ever went up, so they
-- disagreed with the bookings for 129 and 105 of the 852 customers with table bookings on 27
-- October 2026. Part 1 (20261027005339_customer_booking_counters_live) stopped the trigger writing
-- them and moved their one reader, get_email_capture_audience, to the bookings themselves. Nothing
-- else reads them: no view, policy, index or other function (checked in production on 27 October
-- 2026), no TypeScript outside the generated types, and not the website.
--
-- What it touches, measured read-only on 27 October 2026: 1,288 customers, 843 of them with a
-- counter that is not at its default (table_booking_count not 0, or a last_table_booking_date),
-- the counts adding up to 976. Those 843 rows are copied, with both values, into
-- public.retired_customer_booking_counters_20261027 before the columns go, so the rollback can put
-- every value back. The copy is service_role only with row level security on; it holds customer
-- ids, a count and a date, no contact details. Drop it once the owner is happy (a separate step).
--
-- The guard is on completeness rather than a fixed count, because the counters changed with every
-- confirmed booking until part 1 landed: the migration refuses to run unless part 1 is in (the
-- trigger no longer writes the columns and no function reads them) and unless the copy holds
-- exactly the rows that carry a value. It also refuses if more than 1,343 customers carry a value
-- (the 843 measured on 27 October 2026 plus 500), which would mean something else wrote to the
-- columns.
--
-- Rollback: tasks/customer-booking-counters/rollback-drop.sql re-adds both columns (at the end of
-- the table; Postgres cannot put them back in their old position), restores every value from the
-- copy and drops the copy. Tested by scripts/testing/customer-booking-counters-postgres.py.

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND (p.prosrc ~ '(^|[^a-z_])table_booking_count' OR p.prosrc ~ '(^|[^a-z_])last_table_booking_date')
  ) THEN
    RAISE EXCEPTION 'drop_customer_booking_counters: a function still reads or writes the counters; apply 20261027005339_customer_booking_counters_live first';
  END IF;
END
$guard$;

CREATE TABLE public.retired_customer_booking_counters_20261027 (
  customer_id uuid PRIMARY KEY,
  table_booking_count integer,
  last_table_booking_date date,
  copied_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.retired_customer_booking_counters_20261027 IS
  'Copy of customers.table_booking_count and last_table_booking_date taken before the columns were dropped (BK-165), for the rollback. Drop once no longer needed.';

ALTER TABLE public.retired_customer_booking_counters_20261027 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.retired_customer_booking_counters_20261027 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.retired_customer_booking_counters_20261027 TO service_role;

DO $copy$
DECLARE
  v_carrying integer;
  v_copied integer;
BEGIN
  SELECT count(*) INTO v_carrying
    FROM public.customers
   WHERE COALESCE(table_booking_count, 0) <> 0 OR last_table_booking_date IS NOT NULL;

  IF v_carrying > 843 + 500 THEN
    RAISE EXCEPTION 'drop_customer_booking_counters: % customers carry a counter, far more than expected; stopping', v_carrying;
  END IF;

  INSERT INTO public.retired_customer_booking_counters_20261027 (customer_id, table_booking_count, last_table_booking_date)
  SELECT id, table_booking_count, last_table_booking_date
    FROM public.customers
   WHERE COALESCE(table_booking_count, 0) <> 0 OR last_table_booking_date IS NOT NULL;
  GET DIAGNOSTICS v_copied = ROW_COUNT;

  IF v_copied <> v_carrying THEN
    RAISE EXCEPTION 'drop_customer_booking_counters: copied % rows but % carry a counter; stopping', v_copied, v_carrying;
  END IF;

  RAISE NOTICE 'drop_customer_booking_counters: copied % customers'' counters before dropping the columns', v_copied;
END
$copy$;

ALTER TABLE public.customers
  DROP COLUMN table_booking_count,
  DROP COLUMN last_table_booking_date;
