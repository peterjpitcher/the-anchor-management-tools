-- Review suppression tracking
-- review_suppressed_at: set when a customer has already clicked a review link (cross-booking suppression)
ALTER TABLE bookings ADD COLUMN review_suppressed_at TIMESTAMPTZ;
ALTER TABLE table_bookings ADD COLUMN review_suppressed_at TIMESTAMPTZ;

-- Private booking review lifecycle
-- review_processed_at: set after the review SMS has been sent (or suppressed) — prevents re-evaluation each cron run
-- review_clicked_at: set when the customer clicks a review link via /r/[token]
ALTER TABLE private_bookings ADD COLUMN review_processed_at TIMESTAMPTZ;
ALTER TABLE private_bookings ADD COLUMN review_clicked_at TIMESTAMPTZ;
