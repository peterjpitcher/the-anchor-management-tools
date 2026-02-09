-- v0.5 analytics reporting performance indexes

CREATE INDEX IF NOT EXISTS idx_bookings_customer_created
  ON public.bookings (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_table_bookings_customer_created
  ON public.table_bookings (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_created
  ON public.private_bookings (customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_scores_total_score
  ON public.customer_scores (total_score DESC, customer_id);

CREATE INDEX IF NOT EXISTS idx_events_event_type
  ON public.events (event_type)
  WHERE event_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_review_sms_sent
  ON public.bookings (review_sms_sent_at)
  WHERE review_sms_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_review_clicked
  ON public.bookings (review_clicked_at)
  WHERE review_clicked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_table_bookings_review_sms_sent
  ON public.table_bookings (review_sms_sent_at)
  WHERE review_sms_sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_table_bookings_review_clicked
  ON public.table_bookings (review_clicked_at)
  WHERE review_clicked_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_charge_requests_decision_status_created
  ON public.charge_requests (manager_decision, charge_status, created_at DESC);
