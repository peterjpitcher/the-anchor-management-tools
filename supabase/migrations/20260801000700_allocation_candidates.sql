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
  p_table_id        uuid,
  p_start_at        timestamptz,
  p_channel         text,
  p_release_lead_hours integer,
  p_ignore_hold     boolean DEFAULT false,
  p_now             timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_local_date date;
  v_local_time time;
  v_dow        smallint;
  v_released   boolean;
BEGIN
  v_local_date := (p_start_at AT TIME ZONE 'Europe/London')::date;
  v_local_time := (p_start_at AT TIME ZONE 'Europe/London')::time;
  v_dow        := EXTRACT(DOW FROM v_local_date)::smallint;

  -- Inside the release window the walk-in holds no longer apply.
  v_released := p_now >= (p_start_at - make_interval(hours => GREATEST(0, p_release_lead_hours)));

  RETURN EXISTS (
    SELECT 1
    FROM public.table_holds h
    WHERE h.status = 'active'
      AND h.scope = 'table'
      AND h.table_id = p_table_id
      AND h.starts_on <= v_local_date
      AND (h.ends_on IS NULL OR h.ends_on >= v_local_date)
      AND (h.day_of_week IS NULL OR h.day_of_week = v_dow)
      AND (
            -- normal window
            (h.ends_at > h.starts_at AND v_local_time >= h.starts_at AND v_local_time < h.ends_at)
            -- window crossing midnight
         OR (h.ends_at <= h.starts_at AND (v_local_time >= h.starts_at OR v_local_time < h.ends_at))
      )
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
      -- Which house order applies depends on what the guest is here for.
      --   food   -> tables.priority     : the Dining Room first, because diners should eat there.
      --   drinks -> tables.bar_priority : the bar first, overflowing into the Dining Room only
      --                                   once the bar is full.
      -- Events use bar_priority too, applied in allocate_event_communal_seats_v02.
      CASE WHEN p_purpose = 'drinks' THEN t.bar_priority ELSE t.priority END AS priority,
      t.min_party_size,
      -- table_number is text in this schema, so '10' sorts before '2' unless it is cast.
      COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999) AS number_sort,
      CASE
        WHEN COALESCE(t.is_bookable, true) = false
          THEN 'table_not_bookable'
        WHEN p_requires_accessible_table AND NOT v_ignore_access
             AND (t.step_free = false OR t.standard_height = false)
          THEN 'not_accessible'
        WHEN COALESCE(p_high_chair_count, 0) > 0 AND t.high_chair_capable = false
          THEN 'no_high_chair_here'
        -- NOTE: capacity and minimum party size are deliberately NOT judged here.
        -- They decide whether a table can hold the party ON ITS OWN, which is a
        -- question only the single-table branch asks. A member of a join does not
        -- need to fit the whole party, and applying a per-table minimum to members
        -- would block every large join. Both are applied in `singles` below.
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
        WHEN EXISTS (
              SELECT 1
              FROM public.event_communal_seat_allocations eca
              WHERE eca.table_id = t.id
                AND public.windows_overlap(eca.start_datetime, eca.end_datetime, p_start_at, p_end_at)
             )
          THEN 'table_communal'
        -- The check that went missing on 9 May 2026.
        WHEN public.is_table_blocked_by_private_booking_v05(t.id, p_start_at, p_end_at, NULL)
          THEN 'table_private_block'
        WHEN public.table_is_held(t.id, p_start_at, p_channel, v_release_lead, v_ignore_hold, p_now)
          THEN 'table_held'
        ELSE NULL
      END AS reason
    FROM public.tables t
  ),
  valid AS (
    SELECT * FROM scored WHERE reason IS NULL
  ),
  -- Single tables. Best fit first ("maximise covers wherever possible"), then the house order, then a
  -- deterministic tie-break. A table the staff explicitly picked is promoted ahead of everything.
  singles AS (
    SELECT
      ARRAY[v.id]   AS ids,
      ARRAY[v.name] AS names,
      v.capacity    AS cap,
      1             AS cnt,
      v.priority    AS worst_prio,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE WHEN p_preferred_table_ids IS NOT NULL AND v.id = ANY (p_preferred_table_ids)
               THEN 0 ELSE 1 END,
          v.capacity ASC,
          v.priority ASC,
          v.number_sort ASC
      )::integer AS rnk
    FROM valid v
    WHERE v.capacity >= p_party_size
      AND NOT (v_minimums_live AND p_party_size < v.min_party_size)
  ),
  -- Combinations, searched only when no single table fits.
  combos AS (
    WITH RECURSIVE walk AS (
      SELECT
        ARRAY[v.id]   AS ids,
        ARRAY[v.name] AS names,
        v.capacity    AS cap,
        1             AS cnt,
        v.priority    AS worst_prio,
        v.id          AS last_id
      FROM valid v

      UNION ALL

      SELECT
        w.ids || v.id,
        w.names || v.name,
        w.cap + v.capacity,
        w.cnt + 1,
        GREATEST(w.worst_prio, v.priority),
        v.id
      FROM walk w
      JOIN valid v
        ON v.id > w.last_id          -- ascending uuid keeps each set enumerated once
       AND NOT (v.id = ANY (w.ids))
      WHERE w.cnt < 8
        AND w.cap < p_party_size     -- stop growing once the party already fits
        AND (
          v_allow_unjoined
          OR EXISTS (                -- must physically join an existing member, links are undirected
                SELECT 1 FROM public.table_join_links l
                WHERE (l.table_id = v.id AND l.join_table_id = ANY (w.ids))
                   OR (l.join_table_id = v.id AND l.table_id = ANY (w.ids))
             )
        )
    )
    SELECT
      w.ids, w.names, w.cap, w.cnt, w.worst_prio,
      ROW_NUMBER() OVER (
        ORDER BY
          w.cnt ASC,           -- a single table always beats a join; fewer tables always better
          w.cap ASC,           -- then waste the fewest seats
          w.worst_prio ASC,    -- then the house order: Low 4a+4b beats Dining Room 4a+4b at 7 and 8
          w.ids ASC            -- deterministic, so tests are reproducible
      )::integer AS rnk
    FROM walk w
    WHERE w.cnt >= 2
      AND w.cap >= p_party_size
  )
  -- Names are re-derived in table-number order for display. The id array stays in
  -- ascending uuid order because that is what makes the tie-break deterministic,
  -- but "Low 4a + Low 4b" is what a member of staff should read, not "Low 4b + Low 4a".
  SELECT s.ids, public.table_names_in_order(s.ids), s.cap, s.cnt, s.worst_prio, s.rnk, NULL::text
    FROM singles s
  UNION ALL
  SELECT c.ids, public.table_names_in_order(c.ids), c.cap, c.cnt, c.worst_prio,
         -- Combinations rank strictly below every single table.
         c.rnk + (SELECT COUNT(*) FROM singles)::integer,
         NULL::text
    FROM combos c
   WHERE NOT EXISTS (SELECT 1 FROM singles)
  UNION ALL
  -- Rejected tables, so availability and the staff screens can say why.
  SELECT ARRAY[sc.id], ARRAY[sc.name], sc.capacity, 1, sc.priority, NULL::integer, sc.reason
    FROM scored sc
   WHERE sc.reason IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.find_table_allocation_candidates IS
  'The one table picker. Side-effect free. Returns ranked valid candidates and rejected tables with an internal reason. Callers that mutate must re-call this inside the allocation lock.';

REVOKE ALL ON FUNCTION public.find_table_allocation_candidates(
  timestamptz, timestamptz, integer, text, integer, boolean, uuid[], text, uuid,
  public.table_allocation_overrides, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.table_is_held(uuid, timestamptz, text, integer, boolean, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.table_names_in_order(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_names_in_order(uuid[]) TO service_role;

GRANT EXECUTE ON FUNCTION public.find_table_allocation_candidates(
  timestamptz, timestamptz, integer, text, integer, boolean, uuid[], text, uuid,
  public.table_allocation_overrides, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.table_is_held(uuid, timestamptz, text, integer, boolean, timestamptz) TO service_role;

COMMIT;
