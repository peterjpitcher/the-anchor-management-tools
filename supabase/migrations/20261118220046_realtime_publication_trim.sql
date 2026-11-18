-- Trim the supabase_realtime publication to the front-of-house floor-plan tables.
--
-- Spec D1 (tasks/spec-2026-11-18-page-load-performance.md), approved by the owner on
-- 18 November 2026. Realtime WAL polling was 28.9% of database time. customers is written by
-- every booking, message and marketing send, none of which change the floor plan. The only
-- subscriber (src/app/(authenticated)/table-bookings/foh/hooks/useFohRealtime.ts) stopped
-- listening to these three tables in the preceding code change, which must be live first.
--
-- Live state checked 18 November 2026: the publication listed booking_table_assignments,
-- customers, private_booking_items, private_bookings, table_areas, table_bookings, tables and
-- venue_space_table_areas (puballtables = false). After this migration it lists the five
-- floor-plan tables only.
--
-- Idempotent: each table is dropped only if the publication still lists it.
--
-- Rollback:
--   alter publication supabase_realtime add table public.customers, public.private_bookings, public.private_booking_items;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'private_bookings', 'private_booking_items'] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
