-- Reply-to-book now picks the promo we sent most recently, not the one whose
-- reply window runs longest. reply_window_expires_at holds the event's start
-- time, so the old ordering booked whichever open event started furthest in the
-- future: a customer texted about music bingo on the Friday was booked onto a
-- quiz the following Wednesday.
--
-- The lookup still filters on reply_window_expires_at (window must be open) and
-- booking_created, so keep those in the index and just move the sort key.

CREATE INDEX IF NOT EXISTS idx_sms_promo_context_reply_lookup_recent
ON sms_promo_context (phone_number, created_at DESC)
INCLUDE (reply_window_expires_at)
WHERE booking_created = FALSE;

-- The old index still serves nothing else, but dropping it is a separate
-- decision and the table is small, so it stays until someone confirms no other
-- query plans on it.
