-- v0.5 event review lifecycle fields and statuses

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS review_sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_window_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check
  CHECK (
    status IN (
      'pending_payment',
      'confirmed',
      'cancelled',
      'expired',
      'visited_waiting_for_review',
      'review_clicked',
      'completed'
    )
  );

CREATE INDEX IF NOT EXISTS idx_bookings_review_window_status
  ON public.bookings (status, review_window_closes_at)
  WHERE review_window_closes_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_event_status
  ON public.bookings (event_id, status);
