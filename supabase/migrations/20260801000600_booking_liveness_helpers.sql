-- Table prioritisation, stream B task B1.
-- One definition of "this booking still holds its resources", and one overlap rule.
--
-- Today there are three competing definitions in the codebase, which is why marking a party as a
-- no-show does not free their table for a walk-in: the FOH walk-in override filters on
-- `status !== 'cancelled'` alone, while every other path also excludes no_show and left_at.
-- 105 bookings in the last 90 days were in that state.
--
-- Review finding F-05: the earlier draft tested payment_status = 'paid'. That value does not exist on
-- table bookings. The enum is (pending, completed, failed, refunded, partial_refund); 'paid' belongs to
-- parking_payment_status. The function would have failed to create. It uses 'completed'.
--
-- Additive only. Nothing calls these until v06.

BEGIN;

-- ---------------------------------------------------------------------------
-- Liveness
--
-- A booking holds its table, outside capacity and high chairs when all of:
--   * its status is not cancelled or no_show,
--   * the guests have not left,
--   * it is not an unpaid hold that has expired.
--
-- refunded and partial_refund bookings stay live while their status is live. A refund is a money
-- event, not a cancellation: the guest is still coming until someone actually cancels them. Only
-- status releases a table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_booking_live(
  p_status          public.table_booking_status,
  p_left_at         timestamptz,
  p_hold_expires_at timestamptz,
  p_payment_status  public.payment_status,
  p_now             timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status NOT IN ('cancelled', 'no_show')
     AND p_left_at IS NULL
     AND NOT (
           p_status IN ('pending_payment', 'pending_card_capture')
       AND p_hold_expires_at IS NOT NULL
       AND p_hold_expires_at <= p_now
       AND p_payment_status IS DISTINCT FROM 'completed'
     );
$$;

COMMENT ON FUNCTION public.is_booking_live IS
  'The single definition of whether a booking still holds its resources. A deposit hold that has expired but has been PAID stays live: that is the defect where the faster cleanup job could cancel a booking whose money had already arrived.';

-- ---------------------------------------------------------------------------
-- Overlap
--
-- Half open: [start, end). A booking ending at 20:00 does not conflict with one starting at 20:00.
-- With the 15 minute turnaround gap the assignment already ends at 20:15, so back-to-back seating is
-- prevented by the gap rather than by fudging the comparison.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.windows_overlap(
  p_a_start timestamptz,
  p_a_end   timestamptz,
  p_b_start timestamptz,
  p_b_end   timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_a_start < p_b_end AND p_a_end > p_b_start;
$$;

COMMENT ON FUNCTION public.windows_overlap IS
  'Half-open interval overlap, [start, end). Used by every resource check so tables, outside capacity, high chairs and pacing cannot disagree at a boundary.';

REVOKE ALL ON FUNCTION public.is_booking_live(public.table_booking_status, timestamptz, timestamptz, public.payment_status, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_booking_live(public.table_booking_status, timestamptz, timestamptz, public.payment_status, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.windows_overlap(timestamptz, timestamptz, timestamptz, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Self-test. Rolled back; proves the predicate against the real enums before
-- anything depends on it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Confirmed and present.
  ASSERT public.is_booking_live('confirmed', NULL, NULL, 'pending', '2026-08-01 12:00+00'),
    'A confirmed booking with no hold must be live';

  -- Cancelled and no-show release their tables. This is the walk-in fix.
  ASSERT NOT public.is_booking_live('cancelled', NULL, NULL, 'pending', '2026-08-01 12:00+00'),
    'A cancelled booking must not hold a table';
  ASSERT NOT public.is_booking_live('no_show', NULL, NULL, 'pending', '2026-08-01 12:00+00'),
    'A no-show must not hold a table';

  -- Guests have left.
  ASSERT NOT public.is_booking_live('completed', '2026-08-01 11:00+00', NULL, 'completed', '2026-08-01 12:00+00'),
    'A booking whose guests have left must not hold a table';

  -- Expired unpaid hold releases.
  ASSERT NOT public.is_booking_live('pending_payment', NULL, '2026-08-01 11:00+00', 'pending', '2026-08-01 12:00+00'),
    'An expired unpaid hold must release its table';

  -- Expired PAID hold does not release. This is the cleanup-job defect.
  ASSERT public.is_booking_live('pending_payment', NULL, '2026-08-01 11:00+00', 'completed', '2026-08-01 12:00+00'),
    'An expired hold whose deposit has been paid must keep its table';

  -- Unexpired hold holds.
  ASSERT public.is_booking_live('pending_payment', NULL, '2026-08-01 13:00+00', 'pending', '2026-08-01 12:00+00'),
    'A hold that has not expired must keep its table';

  -- A refund does not free a table on its own.
  ASSERT public.is_booking_live('confirmed', NULL, NULL, 'refunded', '2026-08-01 12:00+00'),
    'A refunded but still confirmed booking must keep its table until someone cancels it';

  -- Half-open overlap.
  ASSERT NOT public.windows_overlap('2026-08-01 18:00+00','2026-08-01 20:00+00','2026-08-01 20:00+00','2026-08-01 22:00+00'),
    'Touching windows must not overlap';
  ASSERT public.windows_overlap('2026-08-01 18:00+00','2026-08-01 20:00+00','2026-08-01 19:59+00','2026-08-01 22:00+00'),
    'Windows sharing a minute must overlap';

  RAISE NOTICE 'is_booking_live and windows_overlap self-tests passed';
END;
$$;

COMMIT;
