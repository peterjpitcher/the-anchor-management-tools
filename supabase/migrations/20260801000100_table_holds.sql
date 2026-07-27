-- Table prioritisation, stream A task A3.
-- Two things the venue has never been able to express:
--   1. hold a table back from online sale so walk-ins can have it,
--   2. take a table out of service for an evening.
--
-- Today the only lever is the permanent tables.is_bookable flag, which also removes the table from the
-- floor screen and dumps any bookings already on it into the amber Unassigned strip. This replaces that
-- with something time-bounded and reversible.
--
-- Additive only. Nothing reads this table until v06 is enabled.

BEGIN;

CREATE TABLE IF NOT EXISTS public.table_holds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Scope. A walk-in hold is always a single table. A weather closure covers all outside seating,
  -- which has no table rows, so table_id is null for that scope.
  scope          text NOT NULL DEFAULT 'table'
                   CHECK (scope IN ('table', 'outside_all')),
  table_id       uuid REFERENCES public.tables(id) ON DELETE CASCADE,

  hold_type      text NOT NULL
                   CHECK (hold_type IN ('walk_in_hold', 'maintenance')),

  -- A maintenance block is created pending and only becomes active once every conflicting booking has
  -- been moved or cancelled. It must never be possible to have an active hard block sitting on top of a
  -- live assignment.
  status         text NOT NULL DEFAULT 'active'
                   CHECK (status IN ('pending', 'active', 'cancelled')),

  -- Dates are inclusive at both ends. ends_on null means open ended, which is how the standing
  -- walk-in holds are expressed.
  starts_on      date NOT NULL,
  ends_on        date,

  -- Null day_of_week means every day in the range. 0 = Sunday, matching EXTRACT(DOW).
  day_of_week    smallint CHECK (day_of_week BETWEEN 0 AND 6),

  -- Europe/London service-local wall clock. ends_at <= starts_at means the window crosses midnight.
  starts_at      time NOT NULL DEFAULT '00:00',
  ends_at        time NOT NULL DEFAULT '23:59',

  note           text,

  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  cancelled_by   uuid,
  cancelled_at   timestamptz,

  CONSTRAINT table_holds_date_range_valid
    CHECK (ends_on IS NULL OR ends_on >= starts_on),

  -- A table-scoped hold needs a table; an outside closure must not name one.
  CONSTRAINT table_holds_scope_target_consistent
    CHECK ((scope = 'table' AND table_id IS NOT NULL)
        OR (scope = 'outside_all' AND table_id IS NULL)),

  -- Only maintenance blocks use the pending state.
  CONSTRAINT table_holds_pending_is_maintenance
    CHECK (status <> 'pending' OR hold_type = 'maintenance'),

  CONSTRAINT table_holds_cancelled_has_timestamp
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

COMMENT ON TABLE public.table_holds IS
  'Time-bounded table holds. walk_in_hold withholds a table from ONLINE sale only and releases automatically close to the sitting; maintenance blocks every channel.';
COMMENT ON COLUMN public.table_holds.ends_on IS
  'Inclusive. Null means open ended, used by the standing walk-in holds.';
COMMENT ON COLUMN public.table_holds.status IS
  'Maintenance blocks start pending and only go active once conflicting bookings are cleared.';

CREATE INDEX IF NOT EXISTS idx_table_holds_lookup
  ON public.table_holds (table_id, starts_on, ends_on)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_table_holds_outside
  ON public.table_holds (starts_on, ends_on)
  WHERE status = 'active' AND scope = 'outside_all';

ALTER TABLE public.table_holds ENABLE ROW LEVEL SECURITY;

-- Reads and writes go through server actions and RPCs using the service role. No anon or authenticated
-- policy is created, so RLS denies everything else by default.
DROP POLICY IF EXISTS table_holds_service_role_all ON public.table_holds;
CREATE POLICY table_holds_service_role_all ON public.table_holds
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Seed the two approved walk-in holds.
--
-- Owner decision, 2026-07-27: "Leave the walk in tables as 4a and high 4, bookings take priority."
-- These withhold the two tables from online sale only. Walk-ins are not restricted to them, so a guest
-- who needs step-free or standard-height seating is still seated on whatever suits them.
-- ---------------------------------------------------------------------------
INSERT INTO public.table_holds (scope, table_id, hold_type, status, starts_on, ends_on, note, created_by)
SELECT 'table', v.table_id, 'walk_in_hold', 'active', CURRENT_DATE, NULL, v.note, NULL
FROM (VALUES
  ('ea61faf9-ebfc-4964-bd60-ef907af36848'::uuid, 'Standing walk-in hold: Low 4a'),
  ('8f573b96-a337-4d6f-b21c-a7577471cec2'::uuid, 'Standing walk-in hold: High 4')
) AS v(table_id, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.table_holds h
  WHERE h.table_id = v.table_id
    AND h.hold_type = 'walk_in_hold'
    AND h.status = 'active'
);

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.table_holds
  WHERE hold_type = 'walk_in_hold' AND status = 'active';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected exactly 2 standing walk-in holds after seeding, found %', v_count;
  END IF;
END;
$$;

COMMIT;
