-- Rollback for supabase/migrations/20261027154847_drop_customer_booking_counters.sql.
-- Re-adds customers.table_booking_count (integer, default 0) and customers.last_table_booking_date
-- (date) as production held them, puts back every value from the copy the migration took, and
-- drops the copy. Customers not in the copy held the defaults (0 and no date), which the re-added
-- columns give them. The columns come back at the end of the table: Postgres cannot restore their
-- old position, and nothing reads columns by position.
ALTER TABLE public.customers
  ADD COLUMN table_booking_count integer DEFAULT 0,
  ADD COLUMN last_table_booking_date date;

UPDATE public.customers c
   SET table_booking_count = r.table_booking_count,
       last_table_booking_date = r.last_table_booking_date
  FROM public.retired_customer_booking_counters_20261027 r
 WHERE r.customer_id = c.id;

DROP TABLE public.retired_customer_booking_counters_20261027;
