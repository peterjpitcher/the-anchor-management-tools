-- Table prioritisation, stream A task A4.
-- Booking-level allocation state: pinning, soft (yieldable) assignment, and the accessible-table
-- requirement.
--
-- Additive only. Nothing reads these until v06 is enabled.

BEGIN;

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS table_pinned              boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS assignment_soft           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_accessible_table boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.table_bookings.table_pinned IS
  'Staff have committed this booking to its tables. Never moved by any automatic process; an authorised manual move is allowed and keeps the pin.';
COMMENT ON COLUMN public.table_bookings.assignment_soft IS
  'The booking holds a table but will yield it to a food booking that has nowhere else to go, provided it has a valid alternative itself. Drinks bookings only.';
COMMENT ON COLUMN public.table_bookings.requires_accessible_table IS
  'Guest asked for step-free access with standard-height seating. Hard filter, never released close to the sitting. No reason is recorded: a seating requirement is not health data.';

-- ---------------------------------------------------------------------------
-- Backfill: existing and future drinks bookings become soft-assigned.
--
-- They keep their current tables. Soft only means the allocator may relocate them later if a food
-- booking would otherwise be refused, and only when they have somewhere valid to go.
--
-- At capture time (2026-07-27) there were zero future drinks bookings, so this is expected to be a
-- no-op today. The count is reported rather than asserted, because the diary moves.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.table_bookings
     SET assignment_soft = true
   WHERE booking_purpose = 'drinks'
     AND booking_date >= CURRENT_DATE
     AND status NOT IN ('cancelled', 'no_show')
     AND assignment_soft = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'assignment_soft backfill: % future drinks booking(s) marked soft', v_updated;
END;
$$;

-- ---------------------------------------------------------------------------
-- Invariants (review finding F-14).
--
-- Both are NOT VALID so the migration cannot fail on historical rows that predate the rule. They are
-- enforced on every insert and update from now on, which is what matters. A separate tidy-up can
-- validate them later once any legacy rows are cleaned.
-- ---------------------------------------------------------------------------
ALTER TABLE public.table_bookings
  DROP CONSTRAINT IF EXISTS table_bookings_assignment_soft_drinks_only;
ALTER TABLE public.table_bookings
  ADD CONSTRAINT table_bookings_assignment_soft_drinks_only
  CHECK (assignment_soft = false OR booking_purpose = 'drinks') NOT VALID;

-- An outside booking holds no indoor table, so there is nothing to pin it to.
ALTER TABLE public.table_bookings
  DROP CONSTRAINT IF EXISTS table_bookings_pin_requires_indoor;
ALTER TABLE public.table_bookings
  ADD CONSTRAINT table_bookings_pin_requires_indoor
  CHECK (table_pinned = false OR is_outside_seating = false) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_table_bookings_soft_assigned
  ON public.table_bookings (booking_date)
  WHERE assignment_soft = true AND left_at IS NULL;

COMMIT;
