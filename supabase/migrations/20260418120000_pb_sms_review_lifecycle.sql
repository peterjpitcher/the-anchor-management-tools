-- supabase/migrations/20260418120000_pb_sms_review_lifecycle.sql
--
-- Phase 1, Task 1.1 — Private Bookings SMS Redesign
-- Adds post_event outcome lifecycle columns to private_bookings so that the
-- new private-booking-monitor Pass 5a/5b gate can track manager decisions
-- separately from the legacy review_processed_at flag.
--
-- Backfill rule: rows with review_processed_at already set are marked
-- post_event_outcome = 'skip' so the new gate will not re-trigger a review
-- SMS for bookings that were already processed under the old code path.
BEGIN;

ALTER TABLE private_bookings
  ADD COLUMN post_event_outcome text
    CHECK (post_event_outcome IN ('pending','went_well','issues','skip'))
    DEFAULT 'pending',
  ADD COLUMN post_event_outcome_decided_at timestamptz,
  ADD COLUMN outcome_email_sent_at timestamptz,
  ADD COLUMN review_sms_sent_at timestamptz;

-- Backfill: rows where review was already processed before this migration
-- Set their outcome to 'skip' so the new gate won't re-trigger.
UPDATE private_bookings
SET post_event_outcome = 'skip',
    post_event_outcome_decided_at = review_processed_at
WHERE review_processed_at IS NOT NULL;

COMMENT ON COLUMN private_bookings.post_event_outcome IS
  'Manager decision on whether to send review request: pending (not yet decided), went_well (send), issues (do not send), skip (do not send).';
COMMENT ON COLUMN private_bookings.post_event_outcome_decided_at IS
  'Timestamp when post_event_outcome was moved off pending.';
COMMENT ON COLUMN private_bookings.outcome_email_sent_at IS
  'Timestamp when the manager outcome email was successfully dispatched.';
COMMENT ON COLUMN private_bookings.review_sms_sent_at IS
  'Timestamp when the review request SMS was sent to the customer.';

COMMIT;
