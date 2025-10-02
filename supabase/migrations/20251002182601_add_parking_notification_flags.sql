ALTER TABLE public.parking_bookings
  ADD COLUMN IF NOT EXISTS start_notification_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS end_notification_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_overdue_notified boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS parking_bookings_start_notification_idx
  ON public.parking_bookings (start_notification_sent, start_at);

CREATE INDEX IF NOT EXISTS parking_bookings_end_notification_idx
  ON public.parking_bookings (end_notification_sent, end_at);

CREATE INDEX IF NOT EXISTS parking_bookings_payment_overdue_idx
  ON public.parking_bookings (payment_overdue_notified, payment_due_at);
