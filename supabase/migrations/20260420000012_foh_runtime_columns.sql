-- v0.5 FOH runtime support columns and indexes

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS seated_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_table_bookings_schedule_date_status
  ON public.table_bookings (booking_date, status, booking_time);

CREATE INDEX IF NOT EXISTS idx_booking_table_assignments_table_window
  ON public.booking_table_assignments (table_id, start_datetime, end_datetime);

CREATE INDEX IF NOT EXISTS idx_booking_table_assignments_booking_window
  ON public.booking_table_assignments (table_booking_id, start_datetime, end_datetime);
