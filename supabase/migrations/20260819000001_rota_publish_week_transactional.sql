-- Transactional rota publish (spec: tasks/rota-review-2026-08-18.md, F3, decisions D8 and D13).
--
-- Why
-- ---
-- publishRotaWeek currently reads the live shifts, DELETEs the published snapshot,
-- INSERTs a replacement and clears has_unpublished_changes in four separate requests.
-- The code comment calls that atomic. It is not. A failed insert leaves staff with an
-- empty rota, and a concurrent edit can be dropped while the later flag reset marks the
-- week clean (developer review C12 and C13).
--
-- What this migration adds
-- ------------------------
--   rota_published_shifts.first_published_at             new nullable column, see below
--   public.rota_week_live_basis_is_current(...)          did the live shift set move under us
--   public.rota_week_snapshot_basis_is_current(...)      did the published snapshot move under us
--   public.publish_rota_week(...)                        snapshot replacement + week state, one transaction
--
-- Atomicity
-- ---------
-- The delete, the insert and the rota_weeks update all happen inside publish_rota_week,
-- so they are one transaction by construction. On ANY error the whole thing rolls back
-- and the previous snapshot survives untouched: staff keep seeing the last good rota and
-- the week stays dirty. Nothing here may be split back out into a separate statement by
-- the caller.
--
-- Concurrency
-- -----------
-- The week row is locked FOR UPDATE first, so two publishes of the same week queue.
-- The caller passes the basis it made its decision on: the live shift ids and their
-- updated_at values, and the published rows and their acceptance state. If either has
-- moved, the function returns status 'stale' and writes nothing, so the manager can be
-- told "the rota changed, review and publish again" rather than silently losing an edit.
-- The live basis is checked again after the write, which also catches a shift inserted
-- by another session while this publish was running.
--
-- Acceptance (D13)
-- ----------------
-- This function does NOT compute or auto-accept anything. It stores exactly the
-- acceptance columns the caller supplies. The late-publish policy (publishing inside the
-- cutoff is allowed, never auto-accepts, and grants a 48-hour rejection window from
-- publish) lives in the application, which is where the cutoff arithmetic already lives.
--
-- first_published_at
-- ------------------
-- The 48-hour grace window needs to know when a shift was first published to the person
-- now on it. published_at cannot answer that: it is overwritten with "now" on every
-- republish. So this migration adds one additive, nullable column,
-- rota_published_shifts.first_published_at, and publish_rota_week maintains it:
-- it carries the previous value forward while the shift keeps the same employee, and
-- resets it to the publish time when the shift is new to that employee. Any value a
-- caller supplies for it is ignored.
--
-- Permissions
-- -----------
-- SECURITY DEFINER and no RBAC check: the calling server action must still call
-- checkUserPermission('rota', 'publish') first. EXECUTE is service_role only, matching
-- the existing rule that only the system writes rota_published_shifts.

-- ---------------------------------------------------------------------------
-- 1. first_published_at
-- ---------------------------------------------------------------------------
ALTER TABLE public.rota_published_shifts
  ADD COLUMN IF NOT EXISTS first_published_at timestamptz;

COMMENT ON COLUMN public.rota_published_shifts.first_published_at IS
  'When this shift was first published to the employee currently on it. Reset when the shift is published to a different employee. Drives the 48-hour late-publish rejection window. NULL means unknown.';

-- Backfill. For rows published before this migration the true first-publish time was
-- never recorded; published_at is the closest available proxy and is exactly right for
-- any week that was published once and never republished.
UPDATE public.rota_published_shifts
SET first_published_at = published_at
WHERE first_published_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Optimistic concurrency helpers.
--
-- p_expected_shifts is a JSON array of the live rota_shifts the caller based its
-- decision on: [{ "id": uuid, "updated_at": timestamptz }, ...]. It must cover exactly
-- the rows the caller read, which is every shift in the week whose status is not
-- 'cancelled'. An empty week passes '[]'. NULL is rejected by publish_rota_week so the
-- guard cannot be skipped by omitting it.
--
-- p_expected_published is a JSON array of the published snapshot the caller read before
-- computing acceptance carry-over: [{ "id": uuid, "employee_id": uuid|null,
-- "acceptance_status": text|null, "acceptance_decided_at": timestamptz|null }, ...].
-- This is what catches an employee accepting or rejecting a shift between the caller's
-- read and the publish, which would otherwise be overwritten.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rota_week_live_basis_is_current(
  p_week_id uuid,
  p_expected_shifts jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH expected AS (
    SELECT (e.value->>'id')::uuid AS id, (e.value->>'updated_at')::timestamptz AS updated_at
    FROM jsonb_array_elements(COALESCE(p_expected_shifts, '[]'::jsonb)) AS e(value)
  ),
  live AS (
    SELECT rs.id, rs.updated_at
    FROM public.rota_shifts rs
    WHERE rs.week_id = p_week_id
      AND rs.status <> 'cancelled'
  ),
  diff AS (
    (SELECT expected.id, expected.updated_at FROM expected
     EXCEPT ALL
     SELECT live.id, live.updated_at FROM live)
    UNION ALL
    (SELECT live.id, live.updated_at FROM live
     EXCEPT ALL
     SELECT expected.id, expected.updated_at FROM expected)
  )
  SELECT NOT EXISTS (SELECT 1 FROM diff);
$$;

COMMENT ON FUNCTION public.rota_week_live_basis_is_current(uuid, jsonb) IS
  'True when the live non-cancelled shifts for a week still match the ids and updated_at values the caller based a publish decision on.';

CREATE OR REPLACE FUNCTION public.rota_week_snapshot_basis_is_current(
  p_week_id uuid,
  p_expected_published jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH expected AS (
    SELECT
      (e.value->>'id')::uuid                                  AS id,
      NULLIF(e.value->>'employee_id', '')::uuid               AS employee_id,
      NULLIF(e.value->>'acceptance_status', '')               AS acceptance_status,
      NULLIF(e.value->>'acceptance_decided_at', '')::timestamptz AS acceptance_decided_at
    FROM jsonb_array_elements(COALESCE(p_expected_published, '[]'::jsonb)) AS e(value)
  ),
  live AS (
    SELECT ps.id, ps.employee_id, ps.acceptance_status, ps.acceptance_decided_at
    FROM public.rota_published_shifts ps
    WHERE ps.week_id = p_week_id
  ),
  diff AS (
    (SELECT expected.id, expected.employee_id, expected.acceptance_status, expected.acceptance_decided_at FROM expected
     EXCEPT ALL
     SELECT live.id, live.employee_id, live.acceptance_status, live.acceptance_decided_at FROM live)
    UNION ALL
    (SELECT live.id, live.employee_id, live.acceptance_status, live.acceptance_decided_at FROM live
     EXCEPT ALL
     SELECT expected.id, expected.employee_id, expected.acceptance_status, expected.acceptance_decided_at FROM expected)
  )
  SELECT NOT EXISTS (SELECT 1 FROM diff);
$$;

COMMENT ON FUNCTION public.rota_week_snapshot_basis_is_current(uuid, jsonb) IS
  'True when the published snapshot for a week still matches the rows and acceptance state the caller based a publish decision on.';

-- ---------------------------------------------------------------------------
-- 3. The transactional publish.
--
-- p_rows is the snapshot the caller wants staff to see: a JSON array of complete
-- rota_published_shifts rows, keyed by column name. The caller keeps ownership of what
-- goes in each row (which is where the acceptance carry-over and the D13 late-publish
-- rules live), and this function stores them as given. Every column present on the table
-- is accepted, so the premium columns (rate_multiplier, rate_override, premium_reason,
-- premium_start_time, premium_end_time) and the acceptance columns travel through
-- unchanged. An unrecognised key raises rather than being dropped, so a typo or a new
-- column the caller forgot cannot silently lose staff data.
--
-- Returns:
--   { "status": "published", "week_id":.., "week_start":.., "was_republish": bool,
--     "published_at":.., "published_count": int, "previous": [ ...rows... ], "reason": null }
--   { "status": "stale",     "reason": "live_shifts_changed"|"published_snapshot_changed", ... }
--   { "status": "not_found", "reason": "week_missing", ... }
--
-- "previous" is the snapshot as it was inside this transaction, immediately before it
-- was replaced. The caller uses it to work out which employees actually had a change and
-- so which of them to email, and to record calendar cancellations, exactly as the
-- current code does with the copy it reads beforehand. Emails and calendar sync must
-- fire only after this call returns 'published', never before.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_rota_week(
  p_week_id uuid,
  p_published_by uuid,
  p_rows jsonb,
  p_expected_shifts jsonb,
  p_expected_published jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week public.rota_weeks%ROWTYPE;
  v_now timestamptz := now();
  v_was_republish boolean;
  v_previous jsonb;
  v_unknown text;
  v_wrong_week int;
  v_missing_id int;
  v_count int;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'publish_rota_week: p_rows must be a JSON array';
  END IF;

  -- Both bases are compulsory. Accepting NULL would turn the concurrency guard into
  -- something a caller can switch off by forgetting an argument.
  IF p_expected_shifts IS NULL OR jsonb_typeof(p_expected_shifts) <> 'array' THEN
    RAISE EXCEPTION 'publish_rota_week: p_expected_shifts must be a JSON array';
  END IF;

  IF p_expected_published IS NULL OR jsonb_typeof(p_expected_published) <> 'array' THEN
    RAISE EXCEPTION 'publish_rota_week: p_expected_published must be a JSON array';
  END IF;

  -- Lock the week. Two publishes of the same week now queue instead of racing.
  SELECT * INTO v_week
  FROM public.rota_weeks
  WHERE id = p_week_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'not_found',
      'reason', 'week_missing',
      'week_id', p_week_id
    );
  END IF;

  v_was_republish := v_week.status = 'published';

  -- Validate the payload before touching anything.
  SELECT string_agg(DISTINCT k.key, ', ') INTO v_unknown
  FROM jsonb_array_elements(p_rows) AS r(value)
  CROSS JOIN LATERAL jsonb_object_keys(r.value) AS k(key)
  WHERE k.key NOT IN (
    SELECT c.column_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'rota_published_shifts'
  );

  IF v_unknown IS NOT NULL THEN
    RAISE EXCEPTION 'publish_rota_week: p_rows contains unknown column(s): %', v_unknown;
  END IF;

  SELECT count(*) INTO v_wrong_week
  FROM jsonb_array_elements(p_rows) AS r(value)
  WHERE COALESCE(r.value->>'week_id', '') <> p_week_id::text;

  IF v_wrong_week > 0 THEN
    RAISE EXCEPTION 'publish_rota_week: % row(s) in p_rows belong to a different week', v_wrong_week;
  END IF;

  SELECT count(*) INTO v_missing_id
  FROM jsonb_array_elements(p_rows) AS r(value)
  WHERE NULLIF(r.value->>'id', '') IS NULL;

  IF v_missing_id > 0 THEN
    RAISE EXCEPTION 'publish_rota_week: % row(s) in p_rows have no id', v_missing_id;
  END IF;

  -- Lock the live shifts so an edit in flight cannot commit underneath the snapshot.
  PERFORM 1
  FROM public.rota_shifts
  WHERE week_id = p_week_id
  ORDER BY id
  FOR UPDATE;

  IF NOT public.rota_week_live_basis_is_current(p_week_id, p_expected_shifts) THEN
    RETURN jsonb_build_object(
      'status', 'stale',
      'reason', 'live_shifts_changed',
      'week_id', p_week_id,
      'week_start', v_week.week_start
    );
  END IF;

  IF NOT public.rota_week_snapshot_basis_is_current(p_week_id, p_expected_published) THEN
    RETURN jsonb_build_object(
      'status', 'stale',
      'reason', 'published_snapshot_changed',
      'week_id', p_week_id,
      'week_start', v_week.week_start
    );
  END IF;

  -- The snapshot as staff see it right now, captured before it is replaced so the caller
  -- can work out who actually had a change.
  SELECT COALESCE(jsonb_agg(to_jsonb(ps) ORDER BY ps.id), '[]'::jsonb)
  INTO v_previous
  FROM public.rota_published_shifts ps
  WHERE ps.week_id = p_week_id;

  -- Everything that changes data happens inside this block. It is one unit: if the
  -- rota moves under us the block is rolled back and the previous snapshot is still
  -- there, exactly as it is if any statement in here fails for any other reason.
  BEGIN
    DELETE FROM public.rota_published_shifts
    WHERE week_id = p_week_id;

    WITH previous_rows AS (
      SELECT
        (p.value->>'id')::uuid                                  AS id,
        NULLIF(p.value->>'employee_id', '')::uuid               AS employee_id,
        NULLIF(p.value->>'first_published_at', '')::timestamptz AS first_published_at
      FROM jsonb_array_elements(v_previous) AS p(value)
    ),
    incoming AS (
      SELECT
        (r.value->>'id')::uuid                    AS id,
        NULLIF(r.value->>'employee_id', '')::uuid AS employee_id,
        r.value                                   AS row_json
      FROM jsonb_array_elements(p_rows) AS r(value)
    )
    INSERT INTO public.rota_published_shifts
    SELECT (jsonb_populate_record(
      NULL::public.rota_published_shifts,
      -- published_at defaults to this publish, the caller's row wins if it sets one, and
      -- first_published_at is always decided here, never by the caller.
      jsonb_build_object('published_at', v_now)
      || i.row_json
      || jsonb_build_object(
           'first_published_at',
           CASE
             WHEN pr.id IS NOT NULL AND pr.employee_id IS NOT DISTINCT FROM i.employee_id
               THEN COALESCE(pr.first_published_at, v_now)
             ELSE v_now
           END
         )
    )).*
    FROM incoming i
    LEFT JOIN previous_rows pr ON pr.id = i.id;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE public.rota_weeks
    SET
      status = 'published',
      published_at = v_now,
      published_by = p_published_by,
      has_unpublished_changes = false
    WHERE id = p_week_id;

    -- Row locks cannot stop another session inserting a brand new shift into this week
    -- while the publish runs. Re-checking the live basis after the write catches that.
    IF NOT public.rota_week_live_basis_is_current(p_week_id, p_expected_shifts) THEN
      RAISE EXCEPTION 'publish_rota_week: the rota changed while publishing week %', p_week_id
        USING ERRCODE = 'serialization_failure';
    END IF;
  EXCEPTION
    -- Only the raise above uses this code, so this handler never hides a real fault:
    -- anything else propagates and rolls the whole publish back. Reaching here means
    -- the delete, the insert and the week update have all been undone.
    WHEN serialization_failure THEN
      RETURN jsonb_build_object(
        'status', 'stale',
        'reason', 'live_shifts_changed',
        'week_id', p_week_id,
        'week_start', v_week.week_start
      );
  END;

  RETURN jsonb_build_object(
    'status', 'published',
    'reason', NULL,
    'week_id', p_week_id,
    'week_start', v_week.week_start,
    'was_republish', v_was_republish,
    'published_at', v_now,
    'published_count', v_count,
    'previous', v_previous
  );
END;
$$;

COMMENT ON FUNCTION public.publish_rota_week(uuid, uuid, jsonb, jsonb, jsonb) IS
  'Replaces the published snapshot for a rota week and updates the week state in one transaction. Returns stale when the rota moved under the caller. Never auto-accepts (spec decision D13).';

-- ---------------------------------------------------------------------------
-- 4. Grants.
--
-- New public functions get EXECUTE for anon and authenticated by default in this
-- project. rota_published_shifts is system-write-only by design, so these are
-- service_role only and are called from the admin client after the server action has
-- checked rota:publish.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rota_week_live_basis_is_current(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rota_week_live_basis_is_current(uuid, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.rota_week_snapshot_basis_is_current(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rota_week_snapshot_basis_is_current(uuid, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.publish_rota_week(uuid, uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_rota_week(uuid, uuid, jsonb, jsonb, jsonb) TO service_role;

-- Rollback
-- --------
-- The functions are additive and nothing calls them until the application change lands,
-- so they can be dropped once the calling code is reverted.
--
-- DROP FUNCTION IF EXISTS public.publish_rota_week(uuid, uuid, jsonb, jsonb, jsonb);
-- DROP FUNCTION IF EXISTS public.rota_week_snapshot_basis_is_current(uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.rota_week_live_basis_is_current(uuid, jsonb);
--
-- first_published_at is additive and nullable, so nothing needs it dropped to roll back.
-- Dropping a column is destructive and needs explicit approval, so it is left commented:
-- ALTER TABLE public.rota_published_shifts DROP COLUMN IF EXISTS first_published_at;
