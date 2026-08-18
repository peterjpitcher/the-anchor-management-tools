-- Rota leave-conflict guard (spec: tasks/rota-review-2026-08-18.md, F2, decisions D1, D7, D8).
--
-- Why
-- ---
-- Nothing in the application stops a shift being rostered on top of approved leave.
-- The only guard today is a client-side toast in RotaGrid that fires AFTER the move
-- has already saved, and only on the drag path. An application-side preflight query
-- cannot close the hole either: a leave approval and a shift assignment can both pass
-- their own checks and then commit (developer review C07).
--
-- What this migration adds
-- ------------------------
--   public.rota_shift_leave_dates(...)              the one definition of the boundary rule
--   public.lock_rota_employee_leave(uuid)           the serialisation point for leave writes
--   public.check_rota_leave_conflicts(jsonb)        batch dry run, returns ALL conflicts, writes nothing
--   public.write_rota_shifts_with_leave_guard(jsonb) all-or-nothing guarded write
--
-- The boundary rule
-- -----------------
-- A shift conflicts with leave on its own date, plus the following date when the shift
-- runs past midnight. That rule is copied verbatim from the live and correct
-- approve_rota_open_shift_request:
--
--     leave_date IN (
--       shift_date,
--       CASE WHEN is_overnight OR end_time <= start_time
--            THEN shift_date + 1 ELSE shift_date END
--     )
--
-- joined leave_days -> leave_requests WHERE leave_requests.status = 'approved'.
-- It lives in rota_shift_leave_dates here so the check and the write cannot drift apart.
-- approve_rota_open_shift_request keeps its own inline copy for now and is deliberately
-- left untouched by this migration.
--
-- No override (D1)
-- ----------------
-- Approved leave always wins. There is no permission, flag or reason code that lets a
-- caller push a shift through. A conflict returns a structured refusal naming the
-- clashing dates so the manager can be shown exactly what is in the way.
--
-- Scope of the guard
-- ------------------
-- Only rows that would end up as a real assignment are guarded: an employee is set, the
-- row is not an open shift, and status = 'scheduled'. Absence markers (status 'sick') and
-- cancelled rows are not assignments, so they are left alone. This matches decision D5's
-- positive rule, so a future status cannot silently slip past the guard.
--
-- The week dirty flag
-- -------------------
-- Every shift action today saves the shift and then sets rota_weeks.has_unpublished_changes
-- in a second call whose error is never checked, so a saved edit can leave the week looking
-- clean (developer review C13). The guarded write sets that flag itself, in the same
-- transaction as the shift write and with the same "only when the week is already
-- published" rule the actions use. Callers moving onto this function should drop their
-- separate flag update rather than keep both.
--
-- Permissions
-- -----------
-- These functions are SECURITY DEFINER and do NOT check RBAC. The calling server action
-- must still call checkUserPermission('rota', ...) first, exactly as it does today.
-- EXECUTE is granted to service_role only, so they are reachable through the admin
-- (service-role) client and are not exposed to anon or to a logged-in browser session.

-- ---------------------------------------------------------------------------
-- 1. The boundary rule, in one place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rota_shift_leave_dates(
  p_shift_date date,
  p_start_time time,
  p_end_time time,
  p_is_overnight boolean
)
RETURNS date[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT d
    FROM unnest(ARRAY[
      p_shift_date,
      CASE
        WHEN p_is_overnight OR p_end_time <= p_start_time THEN p_shift_date + 1
        ELSE p_shift_date
      END
    ]) AS d
    ORDER BY d
  );
$$;

COMMENT ON FUNCTION public.rota_shift_leave_dates(date, time, time, boolean) IS
  'Calendar dates a shift can clash with: the shift date, plus the next day when the shift runs past midnight. Rule copied verbatim from approve_rota_open_shift_request.';

-- ---------------------------------------------------------------------------
-- 2. Serialisation point.
--
-- A transaction-scoped advisory lock keyed on the employee. Any code path that
-- approves, books or edits approved leave must take this lock too, otherwise a
-- leave approval and a shift assignment for the same person can still interleave.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_rota_employee_leave(p_employee_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_xact_lock(hashtext('rota_leave_guard'), hashtext(p_employee_id::text));
$$;

COMMENT ON FUNCTION public.lock_rota_employee_leave(uuid) IS
  'Transaction-scoped advisory lock for one employee leave/roster pair. Take this before checking or writing approved leave or rota shifts for that employee.';

-- ---------------------------------------------------------------------------
-- 3. Batch dry run.
--
-- Takes a set of proposed shifts and returns EVERY conflict, writing nothing, so
-- template population and other bulk paths can be all-or-nothing: show the manager
-- the complete list rather than failing on the first bad row.
--
-- p_shifts is a JSON array. Each element:
--   {
--     "ref":           "row-0",        -- optional caller key, echoed back; defaults to the array index
--     "shift_id":      "uuid"|null,    -- optional, echoed back
--     "employee_id":   "uuid"|null,
--     "shift_date":    "2026-08-22",
--     "start_time":    "12:00",
--     "end_time":      "21:00",
--     "is_overnight":  false,          -- optional, defaults false
--     "status":        "scheduled",    -- optional, defaults 'scheduled'
--     "is_open_shift": false           -- optional, defaults false
--   }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_rota_leave_conflicts(p_shifts jsonb)
RETURNS TABLE (
  ref text,
  shift_id uuid,
  employee_id uuid,
  shift_date date,
  conflict_date date,
  leave_request_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH proposed AS (
    SELECT
      COALESCE(e.value->>'ref', (e.ordinality - 1)::text)      AS ref,
      NULLIF(e.value->>'shift_id', '')::uuid                   AS shift_id,
      NULLIF(e.value->>'employee_id', '')::uuid                AS employee_id,
      (e.value->>'shift_date')::date                           AS shift_date,
      (e.value->>'start_time')::time                           AS start_time,
      (e.value->>'end_time')::time                             AS end_time,
      COALESCE((e.value->>'is_overnight')::boolean, false)     AS is_overnight,
      COALESCE(e.value->>'status', 'scheduled')                AS status,
      COALESCE((e.value->>'is_open_shift')::boolean, false)    AS is_open_shift
    FROM jsonb_array_elements(COALESCE(p_shifts, '[]'::jsonb)) WITH ORDINALITY AS e(value, ordinality)
  ),
  candidate AS (
    SELECT p.ref, p.shift_id, p.employee_id, p.shift_date, d AS candidate_date
    FROM proposed p
    CROSS JOIN LATERAL unnest(
      public.rota_shift_leave_dates(p.shift_date, p.start_time, p.end_time, p.is_overnight)
    ) AS d
    -- Only a real assignment can clash. Open shifts, absence markers and cancelled
    -- rows are not assignments (D5's positive rule).
    WHERE p.employee_id IS NOT NULL
      AND p.is_open_shift = false
      AND p.status = 'scheduled'
  )
  SELECT c.ref, c.shift_id, c.employee_id, c.shift_date, ld.leave_date, lr.id
  FROM candidate c
  JOIN public.leave_days ld
    ON ld.employee_id = c.employee_id
   AND ld.leave_date = c.candidate_date
  JOIN public.leave_requests lr
    ON lr.id = ld.request_id
   AND lr.status = 'approved'
  ORDER BY c.ref, ld.leave_date;
$$;

COMMENT ON FUNCTION public.check_rota_leave_conflicts(jsonb) IS
  'Dry run: returns every approved-leave conflict for a set of proposed rota shifts. Writes nothing.';

-- ---------------------------------------------------------------------------
-- 4. Guarded write.
--
-- Writes a set of rota shifts (insert, update, or a mix) in ONE transaction and
-- refuses the whole set if any of them would put an employee on shift during
-- approved leave. All-or-nothing: a template population either lands complete or
-- not at all, and the caller gets the full conflict list back in one round trip.
--
-- p_shifts is a JSON array. Each element:
--   {
--     "ref":                  "row-0",     -- optional caller key, echoed back
--     "shift_id":             "uuid"|null, -- null or absent inserts a new shift
--     "expected_updated_at":  "..."|null,  -- optional optimistic concurrency for an update
--     "values":               { column: value, ... }
--   }
--
-- Returns:
--   { "status": "written",        "shifts": [{"ref":..,"shift_id":..}], "conflicts": [], "reason": null }
--   { "status": "leave_conflict", "shifts": [], "conflicts": [ ... ], "reason": "employee_on_leave" }
--   { "status": "stale",          "shifts": [], "conflicts": [], "reason": "shift_missing"|"shift_changed", "ref": ".." }
--
-- A 'stale' or 'leave_conflict' result is returned BEFORE anything is written, so the
-- caller can retry or show the clash without any partial write to undo.
--
-- On success it also sets has_unpublished_changes on every affected published week, in
-- the same transaction, so callers must not repeat that update themselves.
--
-- Unknown column names, a missing NOT NULL column on insert, or a malformed payload
-- raise instead of returning a status: they are programming errors, and raising aborts
-- the transaction rather than half-writing a batch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_rota_shifts_with_leave_guard(p_shifts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Columns a caller may set. Anything else is rejected loudly rather than silently
  -- dropped. id, created_at and updated_at are deliberately absent: id is generated,
  -- created_at is a default, and updated_at is maintained by trg_rota_shifts_updated_at.
  v_allowed_columns constant text[] := ARRAY[
    'week_id', 'employee_id', 'template_id', 'shift_date', 'start_time', 'end_time',
    'unpaid_break_minutes', 'department', 'status', 'notes', 'is_overnight',
    'original_employee_id', 'reassigned_from_id', 'reassigned_at', 'reassigned_by',
    'reassignment_reason', 'created_by', 'is_open_shift', 'name', 'sick_reason',
    'acceptance_status', 'acceptance_decided_at', 'acceptance_decided_by',
    'acceptance_note', 'auto_accept_reason', 'auto_accept_warning_sent_at',
    'rate_multiplier', 'rate_override', 'premium_reason', 'premium_start_time',
    'premium_end_time'
  ];
  -- NOT NULL with no default, so an insert must supply them.
  v_required_on_insert constant text[] := ARRAY[
    'week_id', 'shift_date', 'start_time', 'end_time', 'department'
  ];
  -- Mirrors the table defaults. Used only to work out the effective row for the leave
  -- check on an insert; the insert itself lets the real table defaults apply, so a
  -- future column with a default keeps working without touching this function.
  v_insert_defaults constant jsonb := jsonb_build_object(
    'status', 'scheduled',
    'is_overnight', false,
    'is_open_shift', false
  );

  v_entry jsonb;
  v_values jsonb;
  v_ref text;
  v_shift_id uuid;
  v_expected_updated_at timestamptz;
  v_existing public.rota_shifts%ROWTYPE;
  v_effective public.rota_shifts%ROWTYPE;
  v_effective_shifts jsonb := '[]'::jsonb;
  v_target_ids uuid[];
  v_week_ids uuid[];
  v_employees uuid[];
  v_employee uuid;
  v_unknown text;
  v_missing text;
  v_conflicts jsonb;
  v_written jsonb := '[]'::jsonb;
  v_col_list text;
  v_val_list text;
  v_set_list text;
  v_new_id uuid;
  v_index int := 0;
BEGIN
  IF p_shifts IS NULL OR jsonb_typeof(p_shifts) <> 'array' THEN
    RAISE EXCEPTION 'write_rota_shifts_with_leave_guard: p_shifts must be a JSON array';
  END IF;

  IF jsonb_array_length(p_shifts) = 0 THEN
    RETURN jsonb_build_object(
      'status', 'written',
      'shifts', '[]'::jsonb,
      'conflicts', '[]'::jsonb,
      'reason', NULL
    );
  END IF;

  -- Lock targets, gathered before any locking so locks are always taken in the same
  -- order: week rows, then employees, then shift rows, then leave rows, all ascending.
  -- publish_rota_week takes its week lock before its shift locks too, so the two
  -- functions queue rather than deadlock.
  SELECT COALESCE(array_agg(DISTINCT (e.value->>'shift_id')::uuid), ARRAY[]::uuid[])
  INTO v_target_ids
  FROM jsonb_array_elements(p_shifts) AS e(value)
  WHERE NULLIF(e.value->>'shift_id', '') IS NOT NULL;

  SELECT COALESCE(array_agg(DISTINCT s.week ORDER BY s.week), ARRAY[]::uuid[])
  INTO v_week_ids
  FROM (
    SELECT NULLIF(e.value->'values'->>'week_id', '')::uuid AS week
    FROM jsonb_array_elements(p_shifts) AS e(value)
    UNION
    SELECT rs.week_id
    FROM public.rota_shifts rs
    WHERE rs.id = ANY (v_target_ids)
  ) s
  WHERE s.week IS NOT NULL;

  IF array_length(v_week_ids, 1) > 0 THEN
    PERFORM 1
    FROM public.rota_weeks
    WHERE id = ANY (v_week_ids)
    ORDER BY id
    FOR UPDATE;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT s.emp ORDER BY s.emp), ARRAY[]::uuid[])
  INTO v_employees
  FROM (
    -- the employee the caller is assigning
    SELECT NULLIF(e.value->'values'->>'employee_id', '')::uuid AS emp
    FROM jsonb_array_elements(p_shifts) AS e(value)
    UNION
    -- and the employee already on the row, whose leave the row still has to respect
    SELECT rs.employee_id
    FROM public.rota_shifts rs
    WHERE rs.id = ANY (v_target_ids)
  ) s
  WHERE s.emp IS NOT NULL;

  FOREACH v_employee IN ARRAY v_employees LOOP
    PERFORM public.lock_rota_employee_leave(v_employee);
  END LOOP;

  IF array_length(v_target_ids, 1) > 0 THEN
    PERFORM 1
    FROM public.rota_shifts
    WHERE id = ANY (v_target_ids)
    ORDER BY id
    FOR UPDATE;
  END IF;

  -- Pass 1: validate each entry and work out the row it would produce. Nothing is
  -- written in this pass, so any refusal below leaves the rota exactly as it was.
  FOR v_entry IN SELECT e.value FROM jsonb_array_elements(p_shifts) AS e(value) LOOP
    v_index := v_index + 1;
    v_ref := COALESCE(v_entry->>'ref', (v_index - 1)::text);
    v_values := COALESCE(v_entry->'values', '{}'::jsonb);
    v_shift_id := NULLIF(v_entry->>'shift_id', '')::uuid;

    IF jsonb_typeof(v_values) <> 'object' THEN
      RAISE EXCEPTION 'write_rota_shifts_with_leave_guard: entry % has no values object', v_ref;
    END IF;

    SELECT string_agg(DISTINCT k, ', ') INTO v_unknown
    FROM jsonb_object_keys(v_values) AS k
    WHERE NOT (k = ANY (v_allowed_columns));

    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'write_rota_shifts_with_leave_guard: entry % sets unknown column(s): %', v_ref, v_unknown;
    END IF;

    IF v_shift_id IS NULL THEN
      SELECT string_agg(c, ', ') INTO v_missing
      FROM unnest(v_required_on_insert) AS c
      WHERE NOT (v_values ? c);

      IF v_missing IS NOT NULL THEN
        RAISE EXCEPTION 'write_rota_shifts_with_leave_guard: entry % is missing required column(s): %', v_ref, v_missing;
      END IF;

      SELECT (jsonb_populate_record(NULL::public.rota_shifts, v_insert_defaults || v_values)).*
      INTO v_effective;
    ELSE
      SELECT * INTO v_existing FROM public.rota_shifts WHERE id = v_shift_id;

      IF NOT FOUND THEN
        RETURN jsonb_build_object(
          'status', 'stale',
          'shifts', '[]'::jsonb,
          'conflicts', '[]'::jsonb,
          'reason', 'shift_missing',
          'ref', v_ref
        );
      END IF;

      v_expected_updated_at := NULLIF(v_entry->>'expected_updated_at', '')::timestamptz;

      IF v_expected_updated_at IS NOT NULL
        AND v_existing.updated_at IS DISTINCT FROM v_expected_updated_at THEN
        RETURN jsonb_build_object(
          'status', 'stale',
          'shifts', '[]'::jsonb,
          'conflicts', '[]'::jsonb,
          'reason', 'shift_changed',
          'ref', v_ref
        );
      END IF;

      -- The effective row is the live row with the caller's changes laid over it, so a
      -- partial update that only moves the date is still checked against the employee
      -- already on the shift.
      SELECT (jsonb_populate_record(NULL::public.rota_shifts, to_jsonb(v_existing) || v_values)).*
      INTO v_effective;
    END IF;

    v_effective_shifts := v_effective_shifts || jsonb_build_array(jsonb_build_object(
      'ref', v_ref,
      'shift_id', v_shift_id,
      'employee_id', v_effective.employee_id,
      'shift_date', v_effective.shift_date,
      'start_time', v_effective.start_time,
      'end_time', v_effective.end_time,
      'is_overnight', v_effective.is_overnight,
      'status', v_effective.status,
      'is_open_shift', v_effective.is_open_shift
    ));
  END LOOP;

  -- Lock the leave rows this write depends on, including pending ones, so an approval
  -- landing at the same moment either commits before the check sees it or waits for
  -- this transaction to finish.
  PERFORM 1
  FROM public.leave_days ld
  JOIN public.leave_requests lr ON lr.id = ld.request_id
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_effective_shifts) AS e(value)
    CROSS JOIN LATERAL unnest(public.rota_shift_leave_dates(
      (e.value->>'shift_date')::date,
      (e.value->>'start_time')::time,
      (e.value->>'end_time')::time,
      COALESCE((e.value->>'is_overnight')::boolean, false)
    )) AS d
    WHERE NULLIF(e.value->>'employee_id', '')::uuid = ld.employee_id
      AND d = ld.leave_date
  )
  FOR UPDATE OF ld, lr;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.ref, c.conflict_date), '[]'::jsonb)
  INTO v_conflicts
  FROM public.check_rota_leave_conflicts(v_effective_shifts) AS c;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    -- D1: approved leave always wins, there is no override. Nothing has been written.
    RETURN jsonb_build_object(
      'status', 'leave_conflict',
      'shifts', '[]'::jsonb,
      'conflicts', v_conflicts,
      'reason', 'employee_on_leave'
    );
  END IF;

  -- Pass 2: write. Every entry is known good by this point.
  v_index := 0;

  FOR v_entry IN SELECT e.value FROM jsonb_array_elements(p_shifts) AS e(value) LOOP
    v_index := v_index + 1;
    v_ref := COALESCE(v_entry->>'ref', (v_index - 1)::text);
    v_values := COALESCE(v_entry->'values', '{}'::jsonb);
    v_shift_id := NULLIF(v_entry->>'shift_id', '')::uuid;

    IF v_shift_id IS NULL THEN
      SELECT
        string_agg(format('%I', k), ', ' ORDER BY k),
        string_agg(format('n.%I', k), ', ' ORDER BY k)
      INTO v_col_list, v_val_list
      FROM jsonb_object_keys(v_values) AS k;

      -- Column names come from the allowlist checked above and are quoted with %I;
      -- values travel as a bound jsonb parameter and are typed by jsonb_populate_record.
      EXECUTE format(
        'INSERT INTO public.rota_shifts (%s) '
        'SELECT %s FROM (SELECT (jsonb_populate_record(NULL::public.rota_shifts, $1)).*) AS n '
        'RETURNING id',
        v_col_list, v_val_list
      ) INTO v_new_id USING v_values;
    ELSE
      IF v_values <> '{}'::jsonb THEN
        SELECT string_agg(format('%I = n.%I', k, k), ', ' ORDER BY k)
        INTO v_set_list
        FROM jsonb_object_keys(v_values) AS k;

        EXECUTE format(
          'UPDATE public.rota_shifts AS t SET %s '
          'FROM (SELECT (jsonb_populate_record(NULL::public.rota_shifts, $1)).*) AS n '
          'WHERE t.id = $2',
          v_set_list
        ) USING v_values, v_shift_id;
      END IF;

      v_new_id := v_shift_id;
    END IF;

    v_written := v_written || jsonb_build_array(jsonb_build_object('ref', v_ref, 'shift_id', v_new_id));
  END LOOP;

  -- Same transaction as the write, so a saved edit can never leave the week looking
  -- clean. Only a published week can be dirty, which is the rule the server actions
  -- already use.
  IF array_length(v_week_ids, 1) > 0 THEN
    UPDATE public.rota_weeks
    SET has_unpublished_changes = true
    WHERE id = ANY (v_week_ids)
      AND status = 'published'
      AND has_unpublished_changes = false;
  END IF;

  RETURN jsonb_build_object(
    'status', 'written',
    'shifts', v_written,
    'conflicts', '[]'::jsonb,
    'reason', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.write_rota_shifts_with_leave_guard(jsonb) IS
  'Writes a batch of rota shifts in one transaction, refuses the whole batch if any row would put an employee on shift during approved leave, and marks the affected published weeks as having unpublished changes. No override exists (spec decision D1).';

-- ---------------------------------------------------------------------------
-- 5. Grants.
--
-- New public functions get EXECUTE for anon and authenticated by default in this
-- project, and a previous incident came from exactly that. These are SECURITY DEFINER
-- and skip RLS, so they are service_role only: reachable from the admin client in a
-- server action that has already checked RBAC, and reachable from nowhere else.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rota_shift_leave_dates(date, time, time, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rota_shift_leave_dates(date, time, time, boolean) TO service_role;

REVOKE EXECUTE ON FUNCTION public.lock_rota_employee_leave(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_rota_employee_leave(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_rota_leave_conflicts(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rota_leave_conflicts(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.write_rota_shifts_with_leave_guard(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_rota_shifts_with_leave_guard(jsonb) TO service_role;

-- Rollback
-- --------
-- This migration only adds functions. Nothing calls them until the application change
-- lands, so dropping them is safe as long as the calling code has been reverted first.
--
-- DROP FUNCTION IF EXISTS public.write_rota_shifts_with_leave_guard(jsonb);
-- DROP FUNCTION IF EXISTS public.check_rota_leave_conflicts(jsonb);
-- DROP FUNCTION IF EXISTS public.lock_rota_employee_leave(uuid);
-- DROP FUNCTION IF EXISTS public.rota_shift_leave_dates(date, time, time, boolean);
