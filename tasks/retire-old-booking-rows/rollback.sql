-- Rollback for supabase/migrations/20261027154849_retire_old_booking_rows.sql.
-- Puts back every value the migration changed, from the two backup tables it wrote, then drops
-- them: the 6 payment holds (status, consumed_at, released_at, updated_at), the 9 ledger rows
-- (status 'pending', metadata, updated_at) and payments_status_check without 'void', the 30 table
-- bookings (confirmed_at, payment_status, updated_at), the 48 pending_bookings rows in full, and the
-- 2 short links (expires_at, updated_at). The updated_at triggers on booking_holds and
-- table_bookings are switched off for the restore only, so the old timestamps come back exactly;
-- the hold status audit trigger stays on and records the change back.
SELECT set_config('lock_timeout', '5s', true);

ALTER TABLE public.booking_holds DISABLE TRIGGER set_booking_holds_updated_at;
UPDATE public.booking_holds h
   SET status = b.old_values ->> 'status',
       consumed_at = (b.old_values ->> 'consumed_at')::timestamptz,
       released_at = (b.old_values ->> 'released_at')::timestamptz,
       updated_at = (b.old_values ->> 'updated_at')::timestamptz
  FROM public.retired_row_values_20261027 b
 WHERE b.source_table = 'booking_holds' AND b.row_id = h.id;
ALTER TABLE public.booking_holds ENABLE TRIGGER set_booking_holds_updated_at;

UPDATE public.payments p
   SET status = b.old_values ->> 'status',
       metadata = b.old_values -> 'metadata',
       updated_at = (b.old_values ->> 'updated_at')::timestamptz
  FROM public.retired_row_values_20261027 b
 WHERE b.source_table = 'payments' AND b.row_id = p.id;

ALTER TABLE public.payments DROP CONSTRAINT payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text]));

ALTER TABLE public.table_bookings DISABLE TRIGGER table_bookings_updated_at;
UPDATE public.table_bookings tb
   SET confirmed_at = (b.old_values ->> 'confirmed_at')::timestamptz,
       payment_status = (b.old_values ->> 'payment_status')::public.payment_status,
       updated_at = (b.old_values ->> 'updated_at')::timestamptz
  FROM public.retired_row_values_20261027 b
 WHERE b.source_table = 'table_bookings' AND b.row_id = tb.id;
ALTER TABLE public.table_bookings ENABLE TRIGGER table_bookings_updated_at;

INSERT INTO public.pending_bookings SELECT * FROM public.retired_pending_bookings_20261027;

UPDATE public.short_links s
   SET expires_at = (b.old_values ->> 'expires_at')::timestamptz,
       updated_at = (b.old_values ->> 'updated_at')::timestamptz
  FROM public.retired_row_values_20261027 b
 WHERE b.source_table = 'short_links' AND b.row_id = s.id;

DROP TABLE public.retired_row_values_20261027;
DROP TABLE public.retired_pending_bookings_20261027;
