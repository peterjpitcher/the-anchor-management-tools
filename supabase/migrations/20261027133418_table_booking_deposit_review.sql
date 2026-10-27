-- BK-042, BK-043, BK-044 (customer bookings review of 24 October 2026; owner decision D20): a
-- table booking's deposit follows its party size, and a deposit that cannot follow is flagged to a
-- manager until one has checked it.
--
-- D20: when a booking with a deposit changes size, an unpaid deposit follows the new size, while a
-- paid one is flagged to a manager and settled on the bill. The app does the re-pricing, through
-- resolve_table_booking_deposit (unchanged here). What it had nowhere to keep was the flag: a paid
-- deposit on a booking that grew or shrank, or one whose new figure could not be worked out, used
-- to raise a "handle it manually" line that flashed on the back office once, never reached the FOH
-- iPad and was saved nowhere, so a manager reviewing Christmas had no list of bookings to check.
--
--   deposit_review_needed_at  set when a size change leaves the deposit for a person to settle;
--                             cleared when a manager marks it checked (both audited in audit_logs)
--   deposit_review_note       what changed, in the words staff see ("Party size 16 to 20. The
--                             GBP 160.00 deposit is paid ...")
--
-- Both nullable with no default, so every existing booking reads "nothing to check" and no row is
-- rewritten. They inherit table_bookings' existing table-level grants, as every other column does;
-- the app reads and writes them with the service role only. Neither dependent view
-- (customer_communications, table_bookings_awaiting_confirmation) selects them.
--
-- The partial index serves the back-office list's "deposit to check" filter, which only ever looks
-- for the handful of flagged bookings.
--
-- Rollback: tasks/table-booking-deposit-review/rollback.sql (drops the index and both columns).

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_review_needed_at timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_review_note text;

COMMENT ON COLUMN public.table_bookings.deposit_review_needed_at IS
  'Set when a party-size change left the deposit for a manager to settle (BK-043, D20); cleared when a manager marks it checked.';
COMMENT ON COLUMN public.table_bookings.deposit_review_note IS
  'What the manager is checking, in the words the staff screens show. Cleared with deposit_review_needed_at.';

CREATE INDEX IF NOT EXISTS table_bookings_deposit_review_needed_idx
  ON public.table_bookings (booking_date)
  WHERE deposit_review_needed_at IS NOT NULL;
