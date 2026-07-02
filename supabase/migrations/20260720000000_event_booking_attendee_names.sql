-- Per-ticket attendee names for event bookings.
-- Ordered array of full names; index 0 = lead booker. NULL for legacy and
-- non-website (staff, FOH, SMS) bookings, which fall back to the booker name +
-- seat count everywhere names are displayed. Additive and nullable — no impact
-- on existing rows or dependent views.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS attendee_names text[];

COMMENT ON COLUMN public.bookings.attendee_names IS
  'Ordered per-ticket attendee names captured at booking creation; index 0 = lead booker. NULL for legacy / non-website (staff, FOH, SMS) bookings.';
