-- Table prioritisation, stream A task A5.
-- Durable outside reservations.
--
-- Outside bookings currently hold nothing at all: the allocator skips the whole allocation step when
-- p_outside_seating is true, so an unlimited number can be taken for the same slot. Kitchen pacing
-- catches outside FOOD bookings; outside DRINKS bookings hit no limit whatsoever.
--
-- A settings-only model was rejected at review (finding F-09): if the per-table capacity changes from 8
-- to 6, recomputing every existing booking's cost from the current setting would silently oversubscribe
-- a diary that was legitimately taken. So the cost and the basis are stored per booking, and the
-- occupancy window is stored too, because outside bookings have no assignment row to carry the
-- turnaround gap.
--
-- Additive only. Nothing reads this until v06 is enabled.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outside_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id  uuid NOT NULL
                      REFERENCES public.table_bookings(id) ON DELETE CASCADE,

  -- How many outside tables this booking consumes: ceil(party_size / capacity_basis).
  tables_reserved   integer NOT NULL CHECK (tables_reserved >= 1),

  -- The per-table capacity in force when the booking was taken. Stored so that changing the venue
  -- setting from 8 to 6 does not silently re-cost bookings that were already promised.
  capacity_basis    integer NOT NULL CHECK (capacity_basis >= 1),

  -- Occupancy window, INCLUDING the turnaround gap. This is deliberately not the customer's booking
  -- window; the guest is told the shorter time.
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT outside_reservations_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT outside_reservations_one_per_booking UNIQUE (table_booking_id)
);

COMMENT ON TABLE public.outside_reservations IS
  'One row per outside booking. Records how many outside tables it consumes and the per-table capacity that cost was based on, so a later capacity change cannot silently re-cost existing bookings.';
COMMENT ON COLUMN public.outside_reservations.ends_at IS
  'Occupancy end, including the turnaround gap. Not the time shown to the guest.';

CREATE INDEX IF NOT EXISTS idx_outside_reservations_window
  ON public.outside_reservations (starts_at, ends_at);

ALTER TABLE public.outside_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outside_reservations_service_role_all ON public.outside_reservations;
CREATE POLICY outside_reservations_service_role_all ON public.outside_reservations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Backfill live future outside bookings at the current basis of 8 seats per table.
--
-- The occupancy window is taken from the booking's own start and end. The turnaround gap is not applied
-- retrospectively: existing bookings keep the promise they were made under (see spec section 10).
--
-- At capture time there were 4 future outside bookings. The count is reported, not asserted.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_inserted integer;
  v_basis    integer := 8;
BEGIN
  INSERT INTO public.outside_reservations
    (table_booking_id, tables_reserved, capacity_basis, starts_at, ends_at)
  SELECT
    tb.id,
    GREATEST(1, CEIL(COALESCE(tb.party_size, 1)::numeric / v_basis)::integer),
    v_basis,
    tb.start_datetime,
    COALESCE(tb.end_datetime, tb.start_datetime + INTERVAL '2 hours')
  FROM public.table_bookings tb
  WHERE tb.is_outside_seating = true
    AND tb.booking_date >= CURRENT_DATE
    AND tb.status NOT IN ('cancelled', 'no_show')
    AND tb.start_datetime IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.outside_reservations r WHERE r.table_booking_id = tb.id
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RAISE NOTICE 'outside_reservations backfill: % future outside booking(s) costed at % seats per table',
    v_inserted, v_basis;
END;
$$;

COMMIT;
