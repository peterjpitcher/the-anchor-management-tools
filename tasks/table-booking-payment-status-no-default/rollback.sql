-- Rollback for supabase/migrations/20261027133206_table_booking_payment_status_no_default.sql.
-- Restores both column defaults as production held them on 26 October 2026, and puts 'pending'
-- back on the 15 walk-in and override bookings the backfill cleared (listed by id, as read from
-- production that day; a walk-in written after the migration and before this rollback keeps NULL,
-- which is correct for it). The rows' updated_at is not wound back.
ALTER TABLE public.table_bookings ALTER COLUMN payment_status SET DEFAULT 'pending'::payment_status;
ALTER TABLE public.table_bookings ALTER COLUMN status SET DEFAULT 'pending_payment'::table_booking_status;

UPDATE public.table_bookings
   SET payment_status = 'pending'
 WHERE payment_status IS NULL
   AND id IN (
     '4da4efc5-e3df-416e-839c-5c01ecbb246d', 'eddaf0ce-93d8-4fb2-8517-3b165843b227',
     'ee2759f2-1b2f-4ef5-9f4d-c9eb227f3155', '70dcaea1-4324-433d-b116-ff4524c608bb',
     'a73b43e8-6ecf-473c-80ca-c2916cf86ad1', '852b7c60-bd81-41b7-bc24-cab4249bb853',
     '1114c770-ee3f-4887-abe3-f5fffb1ad8cf', '79c77421-8c4d-48fb-92e0-f436beec278f',
     'f077e609-8120-4893-89aa-b4dcc176e14a', '19865745-ab8b-4a0b-93fc-d7e7c0792ff9',
     '01d88f67-fd2b-45ce-bdf1-7d7073ad3c0b', '6fc7f55b-32aa-4144-a3ce-bb9acbf83b72',
     'a24dbe51-f26f-4d29-ad63-aefa3ccfa66c', '2bee9e55-ae28-4f7e-929c-c1d91c3a3ade',
     '26e3adc8-597c-40da-88b6-a46204b3e88c'
   );
