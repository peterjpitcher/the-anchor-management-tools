DO $$
BEGIN
  -- table_bookings
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'table_bookings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE table_bookings;
  END IF;

  -- booking_table_assignments
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'booking_table_assignments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE booking_table_assignments;
  END IF;

  -- tables
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tables') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  END IF;

  -- customers
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'customers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE customers;
  END IF;

  -- private_bookings
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'private_bookings') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE private_bookings;
  END IF;

  -- private_booking_items
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'private_booking_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE private_booking_items;
  END IF;

  -- venue_space_table_areas
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'venue_space_table_areas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE venue_space_table_areas;
  END IF;

  -- table_areas
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'table_areas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE table_areas;
  END IF;
END $$;
