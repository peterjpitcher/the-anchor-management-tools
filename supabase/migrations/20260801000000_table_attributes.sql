-- Table prioritisation, stream A task A2.
-- Adds the allocation attributes that replace the accidental alphabetical seating order.
--
-- Additive only. Nothing reads these columns until create_table_booking_v06 is deployed and
-- table_allocation_v06_enabled is switched on, so applying this migration changes no behaviour.
--
-- Baseline: tasks/artefacts/2026-07-27/baseline.md

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight. Abort if the floor is not the one this backfill was written for.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(expected.id::text, ', ')
    INTO v_missing
  FROM (VALUES
    ('23d64766-a079-4700-9a07-708e3de2c8f6'::uuid),
    ('d0b22c8d-ac37-41b3-9c8b-45eb174f29c6'::uuid),
    ('37d61f34-0eed-4a97-9e8c-aa868fdfe779'::uuid),
    ('ea61faf9-ebfc-4964-bd60-ef907af36848'::uuid),
    ('8ff55f2a-86cb-4b2d-ae74-2d8cae44499b'::uuid),
    ('8f573b96-a337-4d6f-b21c-a7577471cec2'::uuid),
    ('ce917bec-36e8-472c-acfd-87f0d58f7d32'::uuid),
    ('39350c06-d5ea-4cea-a742-9ea78ebc0557'::uuid),
    ('f16044f7-8dcf-4403-8e89-02992fdc9532'::uuid),
    ('5deb3b97-1f18-4ee7-97c9-887b47ff504e'::uuid),
    ('eca30e1a-9000-410a-97f3-c7bda2ed538b'::uuid),
    ('fc306a12-0cb2-4692-bf3f-cfb89466abb6'::uuid)
  ) AS expected(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.id = expected.id);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Table set has drifted since the 2026-07-27 baseline; missing ids: %. Re-capture the baseline before applying.',
      v_missing;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS priority           integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS bar_priority     integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS min_party_size     integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS step_free          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS standard_height    boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS high_chair_capable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS heated             boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.tables.priority IS
  'Fill order for FOOD table bookings within a capacity band. Lower wins. The Dining Room comes first because that is where diners should eat. Set by the manager; never derived from the name.';
COMMENT ON COLUMN public.tables.bar_priority IS
  'Fill order for DRINKS bookings and EVENT communal seating. Deliberately the reverse of priority: both take the bar tables first and overflow into the Dining Room only when the bar is full, so the dining space stays free for diners.';
COMMENT ON COLUMN public.tables.min_party_size IS
  'Smallest party allowed on this table for online bookings. Released close to the sitting; staff may override.';
COMMENT ON COLUMN public.tables.step_free IS
  'False when there is a step to reach the table. Hard filter, never released.';
COMMENT ON COLUMN public.tables.standard_height IS
  'False for bar-height tables with stools. Hard filter when an accessible table is requested.';
COMMENT ON COLUMN public.tables.high_chair_capable IS
  'False when a high chair cannot be used at this table.';
COMMENT ON COLUMN public.tables.heated IS
  'Reserved for outside seating becoming first-class table rows. All indoor tables are heated.';

-- ---------------------------------------------------------------------------
-- Backfill by id. Owner decisions, see tasks/table-prioritisation-spec-v2-2026-07-27.md section 1.
--
-- TWO orders, deliberately opposed (owner, 2026-07-27 and 2026-07-28):
--
--   priority      FOOD table bookings. The Dining Room comes FIRST, because that is where diners
--                 should eat. High 4 comes LAST: it is bar height, no high chair fits, and the
--                 backtest showed it would otherwise become the default table for walk-ins.
--
--   bar_priority  DRINKS bookings and EVENT communal seating. The reverse: both take the bar
--                 tables first and overflow into the Dining Room only once the bar is full, so a
--                 quiz night or a round of drinks does not consume the dining space food bookings
--                 need. One column serves both because both want the same thing; if drinks and
--                 events ever need to differ it is one more column, not a redesign.
--
-- Minimum 4  : Big Bay and the three Dining Room six-tops.
-- Small Bay  : the only table that is not step free.
-- High 4     : bar height, and a high chair cannot be used there.
-- ---------------------------------------------------------------------------
UPDATE public.tables SET priority =  10, bar_priority =  60, min_party_size = 1
  WHERE id = '39350c06-d5ea-4cea-a742-9ea78ebc0557';  -- Dining Room 4a
UPDATE public.tables SET priority =  20, bar_priority =  70, min_party_size = 1
  WHERE id = 'f16044f7-8dcf-4403-8e89-02992fdc9532';  -- Dining Room 4b
UPDATE public.tables SET priority =  30, bar_priority =  80, min_party_size = 4
  WHERE id = '5deb3b97-1f18-4ee7-97c9-887b47ff504e';  -- Dining Room 6a
UPDATE public.tables SET priority =  40, bar_priority =  90, min_party_size = 4
  WHERE id = 'eca30e1a-9000-410a-97f3-c7bda2ed538b';  -- Dining Room 6b
UPDATE public.tables SET priority =  50, bar_priority = 100, min_party_size = 4
  WHERE id = 'fc306a12-0cb2-4692-bf3f-cfb89466abb6';  -- Dining Room 6c
UPDATE public.tables SET priority =  60, bar_priority =  40, min_party_size = 1, step_free = false
  WHERE id = '37d61f34-0eed-4a97-9e8c-aa868fdfe779';  -- Small Bay
UPDATE public.tables SET priority =  70, bar_priority =  50, min_party_size = 4
  WHERE id = 'd0b22c8d-ac37-41b3-9c8b-45eb174f29c6';  -- Big Bay
UPDATE public.tables SET priority =  80, bar_priority =  10, min_party_size = 1
  WHERE id = 'ea61faf9-ebfc-4964-bd60-ef907af36848';  -- Low 4a
UPDATE public.tables SET priority =  90, bar_priority =  20, min_party_size = 1
  WHERE id = '8ff55f2a-86cb-4b2d-ae74-2d8cae44499b';  -- Low 4b
UPDATE public.tables SET priority = 100, bar_priority =  30, min_party_size = 1,
       standard_height = false, high_chair_capable = false
  WHERE id = '8f573b96-a337-4d6f-b21c-a7577471cec2';  -- High 4

-- Not bookable. Values are placeholders so they never rank ahead of a real table.
UPDATE public.tables SET priority = 999, bar_priority = 999, min_party_size = 1
  WHERE id IN ('23d64766-a079-4700-9a07-708e3de2c8f6',   -- Electric Cupbard
               'ce917bec-36e8-472c-acfd-87f0d58f7d32');  -- High 2

-- ---------------------------------------------------------------------------
-- Invariants. Added after the backfill so the existing rows satisfy them.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tables
  DROP CONSTRAINT IF EXISTS tables_min_party_size_within_capacity;
ALTER TABLE public.tables
  ADD CONSTRAINT tables_min_party_size_within_capacity
  CHECK (min_party_size >= 1 AND min_party_size <= capacity);

ALTER TABLE public.tables
  DROP CONSTRAINT IF EXISTS tables_priority_positive;
ALTER TABLE public.tables
  ADD CONSTRAINT tables_priority_positive CHECK (priority >= 0 AND bar_priority >= 0);

-- ---------------------------------------------------------------------------
-- Post-check. The grid must match the spec exactly or the migration rolls back.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.tables
  WHERE is_bookable = true
    AND (priority IS NULL OR priority >= 999);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Backfill left % bookable table(s) without a real priority', v_bad;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.tables
  WHERE is_bookable = true AND min_party_size = 4;
  IF v_bad <> 4 THEN
    RAISE EXCEPTION 'Expected exactly 4 bookable tables with a minimum party of 4 (Big Bay plus the three six-tops), found %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.tables WHERE step_free = false;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 non step free table (Small Bay), found %', v_bad;
  END IF;

  SELECT count(*) INTO v_bad FROM public.tables WHERE high_chair_capable = false;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 table without high chair capability (High 4), found %', v_bad;
  END IF;

  -- The two orders must genuinely oppose each other on the Dining Room, or the
  -- whole point of splitting them is lost.
  IF NOT (
    (SELECT priority FROM public.tables WHERE id = '39350c06-d5ea-4cea-a742-9ea78ebc0557')
      < (SELECT priority FROM public.tables WHERE id = 'ea61faf9-ebfc-4964-bd60-ef907af36848')
  ) THEN
    RAISE EXCEPTION 'Table bookings must prefer the Dining Room over the Low tables';
  END IF;

  IF NOT (
    (SELECT bar_priority FROM public.tables WHERE id = '39350c06-d5ea-4cea-a742-9ea78ebc0557')
      > (SELECT bar_priority FROM public.tables WHERE id = 'ea61faf9-ebfc-4964-bd60-ef907af36848')
  ) THEN
    RAISE EXCEPTION 'Events must prefer the Low tables over the Dining Room';
  END IF;
END;
$$;

COMMIT;
