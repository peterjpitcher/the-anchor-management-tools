-- Table prioritisation, stream B task B2.
-- The single shared, side-effect-free table picker.
--
-- Today five different pieces of code choose tables and disagree with each other: the create RPC, the
-- FOH walk-in override, move-table, the party-size change, and the customer manage link. That is why
-- marking a no-show does not free a table for a walk-in, and why the customer manage link throws a raw
-- 500. Everything routes through this function instead.
--
-- It NEVER writes. Callers that mutate must take the allocation lock, call this again inside the lock,
-- and write in the same transaction.
--
-- What it fixes, in order of how often it bites:
--   * Parties of 7 and 8 stop taking Dining Room 4a + 4b when Low 4a + Low 4b would do. 31 bookings
--     since January. Each one drops the largest party still seatable that session from 26 to 18.
--   * Private-booking blocks are honoured at SELECTION time, not discovered at insert time. The
--     allocator lost this check on 9 May 2026, since when any party of 1 to 4, 7 or 8 booking over a
--     function has been refused outright instead of being offered the free Main Bar tables.
--   * Small parties stop eating the Dining Room, via priority and minimum party size.
--   * Accessibility and high-chair suitability become data rather than something a member of staff has
--     to remember.
--   * Drinks bookings fill the bar first and only overflow into the Dining Room when the bar is full,
--     so a round of drinks no longer takes a table someone wants to eat at.
--
-- Additive only. Nothing calls this until v06.

BEGIN;

-- ---------------------------------------------------------------------------
-- Typed overrides. A composite, not jsonb, so an unknown key is impossible by
-- construction (review finding F-10). Only the staff entry point may set these.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_allocation_overrides') THEN
    CREATE TYPE public.table_allocation_overrides AS (
      ignore_minimum       boolean,  -- seat a party below a table's minimum
      ignore_hold          boolean,  -- use a table held back for walk-ins
      allow_unjoined       boolean,  -- combine tables that are not physically linked
      ignore_accessibility boolean   -- guest has said the step or the stools are fine
    );
  END IF;
END;
$$;

COMMENT ON TYPE public.table_allocation_overrides IS
  'Staff-only allocation bypasses. Physical capacity, private-booking blocks, communal events and maintenance blocks are NOT here and are never bypassable.';

-- ---------------------------------------------------------------------------
-- Is this table held, for this channel, at this time?
--
-- walk_in_hold  : online only, and released once the sitting is within the lead time.
-- maintenance   : every channel, never released, and only when the hold is active (a maintenance block
--                 sits in 'pending' until every conflicting booking has been cleared).
--
-- Hold windows are Europe/London wall clock. ends_at <= starts_at means the window crosses midnight.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.table_is_held(
  p_table_id           uuid,
  p_start_at           timestamptz,
  p_end_at             timestamptz,
  p_channel            text,
  p_release_lead_hours integer,
  p_ignore_hold        boolean DEFAULT false,
  p_now                timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_released boolean;
BEGIN
  -- Review finding F2: this used to take only the start time, so a maintenance block
  -- running 19:00 to 21:00 did not stop an 18:00 to 20:00 booking. Each hold occurrence
  -- is now turned into a real Europe/London range and compared with the whole window.
  v_released := p_now >= (p_start_at - make_interval(hours => GREATEST(0, p_release_lead_hours)));

  RETURN EXISTS (
    SELECT 1
    FROM public.table_holds h
    -- Every service date the booking window can touch, plus the day before, so an
    -- overnight hold (22:00 to 02:00) that began yesterday still blocks an 01:00 booking.
    CROSS JOIN LATERAL (
      SELECT generate_series(
        ((p_start_at AT TIME ZONE 'Europe/London')::date - 1),
        ((p_end_at   AT TIME ZONE 'Europe/London')::date),
        interval '1 day'
      )::date AS occurrence_date
    ) occ
    CROSS JOIN LATERAL (
      SELECT
        (occ.occurrence_date + h.starts_at) AT TIME ZONE 'Europe/London' AS hold_start,
        (CASE
           WHEN h.ends_at > h.starts_at THEN occ.occurrence_date + h.ends_at
           ELSE (occ.occurrence_date + 1) + h.ends_at   -- crosses midnight
         END) AT TIME ZONE 'Europe/London' AS hold_end
    ) win
    WHERE h.status = 'active'
      AND h.scope = 'table'
      AND h.table_id = p_table_id
      AND h.starts_on <= occ.occurrence_date
      AND (h.ends_on IS NULL OR h.ends_on >= occ.occurrence_date)
      -- day_of_week applies to the date the occurrence STARTS on.
      AND (h.day_of_week IS NULL OR h.day_of_week = EXTRACT(DOW FROM occ.occurrence_date)::smallint)
      AND public.windows_overlap(win.hold_start, win.hold_end, p_start_at, p_end_at)
      AND (
            h.hold_type = 'maintenance'
         OR (h.hold_type = 'walk_in_hold'
             AND p_channel = 'online'
             AND NOT v_released
             AND NOT COALESCE(p_ignore_hold, false))
      )
  );
END;
$$;

COMMENT ON FUNCTION public.table_is_held IS
  'Walk-in holds bite on the online channel only and lapse close to the sitting. Maintenance blocks bite on every channel and never lapse.';

-- ---------------------------------------------------------------------------
-- Are these tables physically joinable into one run?
--
-- Review finding F6: the old search grew combinations only through tables that were
-- already adjacent to a chosen member, pruned by ascending uuid. On a topology where
-- A joins C and B joins C but A does not join B, the valid set {A,B,C} could never be
-- built: A could not add B, and B could not add the lower-uuid A. The Dining Room is a
-- clique so it never bit, but it would on any future floor.
--
-- With ten tables there are at most 1,023 subsets, so the honest algorithm is to
-- enumerate subsets and test connectivity afterwards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tables_are_connected(p_ids uuid[])
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_seen   uuid[];
  v_before integer;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RETURN false; END IF;
  IF cardinality(p_ids) = 1 THEN RETURN true; END IF;

  v_seen := ARRAY[p_ids[1]];
  LOOP
    v_before := cardinality(v_seen);

    SELECT array_agg(DISTINCT x) INTO v_seen
    FROM (
      SELECT unnest(v_seen) AS x
      UNION
      SELECT l.join_table_id FROM public.table_join_links l
       WHERE l.table_id = ANY (v_seen) AND l.join_table_id = ANY (p_ids)
      UNION
      SELECT l.table_id FROM public.table_join_links l
       WHERE l.join_table_id = ANY (v_seen) AND l.table_id = ANY (p_ids)
    ) reachable;

    EXIT WHEN cardinality(v_seen) = cardinality(p_ids);  -- everything reached
    EXIT WHEN cardinality(v_seen) = v_before;            -- nothing new, so disconnected
  END LOOP;

  RETURN cardinality(v_seen) = cardinality(p_ids);
END;
$$;

-- ---------------------------------------------------------------------------
-- Table names in the order a human reads a floor plan: by table number.
-- The id arrays stay in ascending uuid order because that is what makes the
-- combination tie-break deterministic and reproducible in tests.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.table_names_in_order(p_ids uuid[])
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT array_agg(t.label ORDER BY t.number_sort, t.label)
  FROM (
    SELECT COALESCE(tb.name, tb.table_number) AS label,
           COALESCE(NULLIF(regexp_replace(tb.table_number, '\D', '', 'g'), '')::integer, 9999) AS number_sort
    FROM public.tables tb
    WHERE tb.id = ANY (p_ids)
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- The primitive.
--
-- Returns EVERY candidate. Valid ones carry a rank (1 is best) and a null reason.
-- Invalid ones carry rank NULL and the internal reason they failed, so the
-- availability function can explain itself and staff screens can show why.
--
-- Outside bookings do not come through here: they hold no indoor table and are
-- capped against outside_reservations instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.find_table_allocation_candidates(
  p_start_at                  timestamptz,
  p_end_at                    timestamptz,
  p_party_size                integer,
  p_purpose                   text    DEFAULT 'food',
  p_high_chair_count          integer DEFAULT 0,
  p_requires_accessible_table boolean DEFAULT false,
  p_preferred_table_ids       uuid[]  DEFAULT NULL,
  p_channel                   text    DEFAULT 'online',
  p_exclude_booking           uuid    DEFAULT NULL,
  p_overrides                 public.table_allocation_overrides DEFAULT NULL,
  p_now                       timestamptz DEFAULT now()
)
RETURNS TABLE (
  table_ids        uuid[],
  table_names      text[],
  total_capacity   integer,
  table_count      integer,
  worst_priority   integer,
  rank             integer,
  reason_code      text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_release_lead   integer;
  v_ignore_min     boolean := COALESCE((p_overrides).ignore_minimum, false);
  v_ignore_hold    boolean := COALESCE((p_overrides).ignore_hold, false);
  v_allow_unjoined boolean := COALESCE((p_overrides).allow_unjoined, false);
  v_ignore_access  boolean := COALESCE((p_overrides).ignore_accessibility, false);
  v_minimums_live  boolean;
BEGIN
  -- Guarded read (review finding F1). This used to be an unguarded
  -- (value ->> 'value')::integer, so a manager saving 24.5 took every booking in
  -- the pub down until the row was repaired by hand. A malformed value now falls
  -- back to the coded default and warns.
  v_release_lead := public.get_setting_int('hold_release_lead_hours', 24);

  -- Minimum party sizes are an online-only lever, and they lapse close to the sitting for exactly the
  -- reason a hard minimum is dangerous: it is Wednesday evening, every four-top has gone, three
  -- six-tops are empty, and a couple should not be turned away to protect a large party who is not
  -- coming.
  v_minimums_live := (p_channel = 'online')
                     AND NOT v_ignore_min
                     AND p_now < (p_start_at - make_interval(hours => GREATEST(0, v_release_lead)));

  RETURN QUERY
  WITH scored AS (
    SELECT
      t.id,
      COALESCE(t.name, t.table_number) AS name,
      t.capacity,
      CASE WHEN p_purpose = 'drinks' THEN t.bar_priority ELSE t.priority END AS priority,
      t.min_party_size,
      COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999) AS number_sort,
      -- HARD failures. A table failing any of these is unusable, alone or in a join.
      CASE
        WHEN COALESCE(t.is_bookable, true) = false
          THEN 'table_not_bookable'
        WHEN p_requires_accessible_table AND NOT v_ignore_access
             AND (t.step_free = false OR t.standard_height = false)
          THEN 'not_accessible'
        WHEN COALESCE(p_high_chair_count, 0) > 0 AND t.high_chair_capable = false
          THEN 'no_high_chair_here'
        WHEN EXISTS (
              SELECT 1
              FROM public.booking_table_assignments bta
              JOIN public.table_bookings tb ON tb.id = bta.table_booking_id
              WHERE bta.table_id = t.id
                AND (p_exclude_booking IS NULL OR tb.id <> p_exclude_booking)
                AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status, p_now)
                AND public.windows_overlap(bta.start_datetime, bta.end_datetime, p_start_at, p_end_at)
             )
          THEN 'table_occupied'
        -- Review finding F7: a communal row whose parent event booking is cancelled, or whose
        -- payment hold has expired, is not live. Joining to `bookings` stops a dead event
        -- holding a table hostage.
        WHEN EXISTS (
              SELECT 1
              FROM public.event_communal_seat_allocations eca
              JOIN public.bookings b ON b.id = eca.event_booking_id
              WHERE eca.table_id = t.id
                AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
                AND public.windows_overlap(eca.start_datetime, eca.end_datetime, p_start_at, p_end_at)
             )
          THEN 'table_communal'
        -- The check that went missing on 9 May 2026.
        WHEN public.is_table_blocked_by_private_booking_v05(t.id, p_start_at, p_end_at, NULL)
          THEN 'table_private_block'
        -- Maintenance bites on every channel. Checked with the full window (F2).
        WHEN public.table_is_held(t.id, p_start_at, p_end_at, 'staff', v_release_lead, true, p_now)
          THEN 'table_blocked'
        ELSE NULL
      END AS hard_reason
    FROM public.tables t
  ),
  -- Review finding F4: a walk-in hold withholds a table from ONLINE SINGLE-TABLE sale.
  -- It must NOT remove the table from joined combinations, or holding Low 4a pushes every
  -- online party of seven into the Dining Room, undoing the fix this release exists for.
  -- So eligibility splits in two. Maintenance stays in `hard_reason` and is excluded from both.
  usable AS (
    SELECT sc.*,
           public.table_is_held(sc.id, p_start_at, p_end_at, p_channel, v_release_lead, v_ignore_hold, p_now)
             AS walk_in_held
    FROM scored sc
    WHERE sc.hard_reason IS NULL
  ),
  valid_for_single AS (
    SELECT * FROM usable u
    WHERE NOT u.walk_in_held
      AND u.capacity >= p_party_size
      AND NOT (v_minimums_live AND p_party_size < u.min_party_size)
  ),
  valid_for_combination AS (
    SELECT * FROM usable    -- held tables ARE allowed here
  ),
  singles AS (
    SELECT
      ARRAY[v.id] AS ids, v.capacity AS cap, 1 AS cnt, v.priority AS worst_prio,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_preferred_table_ids IS NOT NULL
                AND cardinality(p_preferred_table_ids) = 1
                AND v.id = ANY (p_preferred_table_ids) THEN 0 ELSE 1 END,
          v.capacity ASC, v.priority ASC, v.number_sort ASC
      )::integer AS rnk
    FROM valid_for_single v
  ),
  -- Review finding F6: enumerate subsets completely, then test connectivity, rather than
  -- pruning growth by adjacency (which could never build a valid A-C-B run).
  -- Review finding F5: no hard eight-table cap. The bound is the number of usable tables,
  -- so a staff party of 40 across nine free tables is reachable.
  combos AS (
    WITH RECURSIVE walk AS (
      SELECT ARRAY[v.id] AS ids, v.capacity AS cap, 1 AS cnt, v.priority AS worst_prio, v.id AS last_id
      FROM valid_for_combination v
      UNION ALL
      SELECT w.ids || v.id, w.cap + v.capacity, w.cnt + 1,
             GREATEST(w.worst_prio, v.priority), v.id
      FROM walk w
      JOIN valid_for_combination v ON v.id > w.last_id   -- ascending uuid: each subset once
      WHERE w.cnt < (SELECT count(*) FROM valid_for_combination)
    )
    SELECT
      w.ids, w.cap, w.cnt, w.worst_prio,
      ROW_NUMBER() OVER (
        ORDER BY
          -- An exactly-matching staff selection wins outright (F10).
          CASE WHEN p_preferred_table_ids IS NOT NULL
                AND w.ids @> p_preferred_table_ids
                AND w.ids <@ p_preferred_table_ids THEN 0 ELSE 1 END,
          w.cnt ASC,          -- fewest tables
          w.cap ASC,          -- then waste the fewest seats
          w.worst_prio ASC,   -- then the house order: Low 4a+4b beats Dining Room 4a+4b at 7 and 8
          w.ids ASC           -- deterministic
      )::integer AS rnk
    FROM walk w
    WHERE w.cnt >= 2
      AND w.cap >= p_party_size
      AND (v_allow_unjoined OR public.tables_are_connected(w.ids))
  )
  SELECT s.ids, public.table_names_in_order(s.ids), s.cap, s.cnt, s.worst_prio, s.rnk, NULL::text
    FROM singles s
  UNION ALL
  SELECT c.ids, public.table_names_in_order(c.ids), c.cap, c.cnt, c.worst_prio,
         c.rnk + (SELECT COUNT(*) FROM singles)::integer, NULL::text
    FROM combos c
   WHERE NOT EXISTS (SELECT 1 FROM singles)
  UNION ALL
  -- Rejected tables, with the reason, so availability and the staff screens can explain
  -- themselves. Review finding F14: capacity and minimum-party rejections are reported for
  -- SINGLE-table suitability, having been excluded from the hard filters so that a small
  -- table is still usable inside a join.
  SELECT ARRAY[sc.id], ARRAY[sc.name], sc.capacity, 1, sc.priority, NULL::integer,
         COALESCE(
           sc.hard_reason,
           CASE
             WHEN sc.capacity < p_party_size THEN 'too_large_for_table'
             WHEN v_minimums_live AND p_party_size < sc.min_party_size THEN 'below_table_minimum'
             WHEN public.table_is_held(sc.id, p_start_at, p_end_at, p_channel, v_release_lead, v_ignore_hold, p_now)
               THEN 'table_held'
           END)
    FROM scored sc
   WHERE sc.hard_reason IS NOT NULL
      OR sc.capacity < p_party_size
      OR (v_minimums_live AND p_party_size < sc.min_party_size)
      OR public.table_is_held(sc.id, p_start_at, p_end_at, p_channel, v_release_lead, v_ignore_hold, p_now);
END;
$$;

COMMENT ON FUNCTION public.find_table_allocation_candidates IS
  'The one table picker. Side-effect free. Returns ranked valid candidates and rejected tables with an internal reason. Callers that mutate must re-call this inside the allocation lock.';

REVOKE ALL ON FUNCTION public.find_table_allocation_candidates(
  timestamptz, timestamptz, integer, text, integer, boolean, uuid[], text, uuid,
  public.table_allocation_overrides, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.table_is_held(uuid, timestamptz, timestamptz, text, integer, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tables_are_connected(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tables_are_connected(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.table_names_in_order(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_names_in_order(uuid[]) TO service_role;

GRANT EXECUTE ON FUNCTION public.find_table_allocation_candidates(
  timestamptz, timestamptz, integer, text, integer, boolean, uuid[], text, uuid,
  public.table_allocation_overrides, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_is_held(uuid, timestamptz, timestamptz, text, integer, boolean, timestamptz) TO service_role;

COMMIT;
