-- Leave-side half of the rota/leave guard (spec: tasks/rota-review-2026-08-18.md, F2, decisions D1, D7, D8).
--
-- Why
-- ---
-- 20260819000000 locked the rota direction: a shift can no longer be written on top of
-- approved leave, because write_rota_shifts_with_leave_guard takes an advisory lock on
-- the employee, locks the leave rows and re-checks under those locks. That migration's
-- own contract says any code path that approves, books or edits approved leave must take
-- the same lock, and nothing did. The leave direction was still a plain application
-- preflight SELECT followed by a separate UPDATE in another transaction, so:
--
--   1. the manager approves leave; the preflight reads rota_shifts and finds no shift,
--   2. before the approval commits, somebody drags a shift onto that employee; the
--      guarded write locks the leave rows, sees the request is still 'pending', finds
--      no approved-leave conflict and commits,
--   3. the approval then commits.
--
-- Both guards pass and the database ends in exactly the state D1 forbids: an approved
-- leave day with a scheduled shift on it, with no error shown to either manager.
--
-- What this migration adds
-- ------------------------
--   public.rota_shifts_clashing_with_leave(uuid, date[])       shared conflict lookup
--   public.approve_leave_request_with_rota_guard(...)          guarded approval
--   public.book_approved_leave_with_rota_guard(...)            guarded direct booking
--   public.update_leave_request_dates(...)                     replaced, now guarded
--
-- Each of the three write paths takes public.lock_rota_employee_leave(employee_id)
-- FIRST, then checks the rota, then writes, all in one transaction. The advisory lock
-- is transaction scoped, so taking it in a separate round trip would prove nothing:
-- the check and the write have to sit inside the same function call.
--
-- Lock ordering
-- -------------
-- write_rota_shifts_with_leave_guard takes week rows, then employee advisory locks,
-- then shift rows, then leave rows. These functions take the employee advisory lock
-- first and then leave rows, and read rota_shifts without locking it, so the two
-- directions queue on the advisory lock rather than deadlocking on table rows.
--
-- Permissions
-- -----------
-- SECURITY DEFINER, no RBAC check inside. The calling server action still calls
-- checkUserPermission('leave', ...) exactly as it does today. EXECUTE is service_role
-- only, so these are reachable through the admin client and from nowhere else.

-- ---------------------------------------------------------------------------
-- 1. The conflict lookup, shared by all three write paths.
--
-- Mirrors check_rota_leave_conflicts in the opposite direction: given an employee and
-- a set of leave dates, return every scheduled, non-open shift of theirs that covers
-- one of those dates. The boundary rule is D7 and comes from rota_shift_leave_dates,
-- so the two directions cannot drift apart.
--
-- The scan starts a day before the earliest leave date, because a shift starting the
-- night before can run into it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rota_shifts_clashing_with_leave(
  p_employee_id uuid,
  p_leave_dates date[]
)
RETURNS TABLE (
  shift_id uuid,
  shift_date date,
  leave_date date,
  start_time time,
  end_time time,
  department text,
  shift_name text,
  is_overnight boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.shift_date,
    d,
    s.start_time,
    s.end_time,
    s.department,
    s.name,
    COALESCE(s.is_overnight, false)
  FROM public.rota_shifts s
  CROSS JOIN LATERAL unnest(
    public.rota_shift_leave_dates(s.shift_date, s.start_time, s.end_time, COALESCE(s.is_overnight, false))
  ) AS d
  WHERE s.employee_id = p_employee_id
    AND s.status = 'scheduled'
    AND s.is_open_shift = false
    AND p_leave_dates IS NOT NULL
    AND array_length(p_leave_dates, 1) > 0
    AND s.shift_date >= (SELECT min(x) FROM unnest(p_leave_dates) AS x) - 1
    AND s.shift_date <= (SELECT max(x) FROM unnest(p_leave_dates) AS x)
    AND d = ANY (p_leave_dates)
  ORDER BY s.shift_date, s.start_time;
$$;

COMMENT ON FUNCTION public.rota_shifts_clashing_with_leave(uuid, date[]) IS
  'Every scheduled, non-open shift an employee is on across a set of leave dates. Uses the D7 boundary rule from rota_shift_leave_dates.';

-- ---------------------------------------------------------------------------
-- 2. Guarded approval.
--
-- Takes the employee lock, works out the affected dates (leave_days is authoritative;
-- the start/end range is only a fallback for a request whose days never expanded),
-- re-checks the rota under the lock, and only then flips the request to 'approved'.
--
-- Returns:
--   { "status": "approved",      "conflicts": [] }
--   { "status": "rota_conflict", "conflicts": [ ... ] }
--   { "status": "not_found"|"not_pending", "conflicts": [] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_leave_request_with_rota_guard(
  p_request_id uuid,
  p_reviewed_by uuid,
  p_manager_note text,
  p_reviewed_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
  v_dates date[];
  v_conflicts jsonb;
BEGIN
  SELECT * INTO v_request FROM public.leave_requests WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'conflicts', '[]'::jsonb);
  END IF;

  -- Before anything is read or written, so a shift assignment for this employee
  -- either commits before the check sees it or waits for this transaction.
  PERFORM public.lock_rota_employee_leave(v_request.employee_id);

  SELECT * INTO v_request FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;

  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('status', 'not_pending', 'conflicts', '[]'::jsonb);
  END IF;

  SELECT COALESCE(array_agg(ld.leave_date ORDER BY ld.leave_date), ARRAY[]::date[])
  INTO v_dates
  FROM public.leave_days ld
  WHERE ld.request_id = p_request_id;

  IF COALESCE(array_length(v_dates, 1), 0) = 0 THEN
    SELECT array_agg(d::date ORDER BY d)
    INTO v_dates
    FROM generate_series(v_request.start_date, v_request.end_date, interval '1 day') AS d;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.shift_date, c.start_time), '[]'::jsonb)
  INTO v_conflicts
  FROM public.rota_shifts_clashing_with_leave(v_request.employee_id, v_dates) AS c;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    -- D1: approved leave and a rostered shift cannot coexist, and there is no override.
    RETURN jsonb_build_object('status', 'rota_conflict', 'conflicts', v_conflicts);
  END IF;

  UPDATE public.leave_requests
  SET status = 'approved',
      manager_note = p_manager_note,
      reviewed_by = p_reviewed_by,
      reviewed_at = p_reviewed_at,
      updated_at = p_reviewed_at
  WHERE id = p_request_id;

  RETURN jsonb_build_object('status', 'approved', 'conflicts', '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.approve_leave_request_with_rota_guard(uuid, uuid, text, timestamptz) IS
  'Approves a leave request under the employee leave lock, refusing when the rota still has a shift on any of its dates (spec decision D1).';

-- ---------------------------------------------------------------------------
-- 3. Guarded direct booking (manager books approved leave outright).
--
-- Same shape: lock, check overlap, check the rota, then insert the request and its
-- days in one transaction.
--
-- Returns:
--   { "status": "booked",        "request_id": uuid, "leave_dates": [...], "conflicts": [] }
--   { "status": "rota_conflict", "conflicts": [ ... ] }
--   { "status": "overlap",       "conflicts": [] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.book_approved_leave_with_rota_guard(
  p_employee_id uuid,
  p_start_date date,
  p_end_date date,
  p_note text,
  p_holiday_year smallint,
  p_created_by uuid,
  p_booked_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dates date[];
  v_conflicts jsonb;
  v_request_id uuid;
BEGIN
  IF p_end_date < p_start_date THEN
    RETURN jsonb_build_object('status', 'invalid_range', 'conflicts', '[]'::jsonb);
  END IF;

  PERFORM public.lock_rota_employee_leave(p_employee_id);

  IF EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    WHERE lr.employee_id = p_employee_id
      AND lr.status <> 'declined'
      AND lr.start_date <= p_end_date
      AND lr.end_date >= p_start_date
  ) THEN
    RETURN jsonb_build_object('status', 'overlap', 'conflicts', '[]'::jsonb);
  END IF;

  SELECT array_agg(d::date ORDER BY d)
  INTO v_dates
  FROM generate_series(p_start_date, p_end_date, interval '1 day') AS d;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.shift_date, c.start_time), '[]'::jsonb)
  INTO v_conflicts
  FROM public.rota_shifts_clashing_with_leave(p_employee_id, v_dates) AS c;

  IF jsonb_array_length(v_conflicts) > 0 THEN
    RETURN jsonb_build_object('status', 'rota_conflict', 'conflicts', v_conflicts);
  END IF;

  INSERT INTO public.leave_requests (
    employee_id, start_date, end_date, note, holiday_year,
    status, reviewed_by, reviewed_at, created_by
  )
  VALUES (
    p_employee_id, p_start_date, p_end_date, p_note, p_holiday_year,
    'approved', p_created_by, p_booked_at, p_created_by
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.leave_days (request_id, employee_id, leave_date)
  SELECT v_request_id, p_employee_id, d
  FROM unnest(v_dates) AS d
  ON CONFLICT (employee_id, leave_date) DO NOTHING;

  RETURN jsonb_build_object(
    'status', 'booked',
    'request_id', v_request_id,
    'leave_dates', to_jsonb(v_dates),
    'conflicts', '[]'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.book_approved_leave_with_rota_guard(uuid, date, date, text, smallint, uuid, timestamptz) IS
  'Books approved leave outright under the employee leave lock, refusing when the rota still has a shift on any of its dates (spec decision D1).';

-- ---------------------------------------------------------------------------
-- 4. Editing an existing request.
--
-- Replaces update_leave_request_dates from 20260628000001. Same contract and the same
-- result codes, with two additions: it takes the employee leave lock before it reads
-- anything, and an APPROVED request is re-checked against the rota under that lock.
-- A pending request is not checked, because pending leave does not block a shift; it
-- is checked when somebody approves it.
--
-- The extra 'rota_conflict' code carries the clashing shifts so the caller can name
-- them, rather than returning a bare message.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_leave_request_dates(
  p_request_id uuid,
  p_start_date date,
  p_end_date date,
  p_holiday_year smallint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
  v_leave_date date;
  v_day_count integer := 0;
  v_dates date[];
  v_conflicts jsonb;
BEGIN
  IF p_end_date < p_start_date THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_range',
      'error', 'End date must be on or after start date'
    );
  END IF;

  SELECT *
  INTO v_request
  FROM public.leave_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'not_found',
      'error', 'Request not found'
    );
  END IF;

  PERFORM public.lock_rota_employee_leave(v_request.employee_id);

  SELECT *
  INTO v_request
  FROM public.leave_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_request.status = 'declined' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'declined_request',
      'error', 'Declined holiday requests cannot be edited'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.leave_requests lr
    WHERE lr.employee_id = v_request.employee_id
      AND lr.id <> p_request_id
      AND lr.status <> 'declined'
      AND lr.start_date <= p_end_date
      AND lr.end_date >= p_start_date
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'overlap',
      'error', 'Employee already has leave covering some of these dates'
    );
  END IF;

  -- An edit to an approved request extends approved leave over the new dates, so the
  -- whole resulting date set has to be clear, not just the dates being added: a date
  -- that is kept is still approved leave, and a shift sitting on it is still a clash.
  IF v_request.status = 'approved' THEN
    SELECT array_agg(d::date ORDER BY d)
    INTO v_dates
    FROM generate_series(p_start_date, p_end_date, interval '1 day') AS d;

    SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.shift_date, c.start_time), '[]'::jsonb)
    INTO v_conflicts
    FROM public.rota_shifts_clashing_with_leave(v_request.employee_id, v_dates) AS c;

    IF jsonb_array_length(v_conflicts) > 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'rota_conflict',
        'error', 'This holiday clashes with a rostered shift',
        'conflicts', v_conflicts
      );
    END IF;
  END IF;

  UPDATE public.leave_requests
  SET
    start_date = p_start_date,
    end_date = p_end_date,
    holiday_year = p_holiday_year,
    updated_at = now()
  WHERE id = p_request_id;

  DELETE FROM public.leave_days
  WHERE request_id = p_request_id;

  FOR v_leave_date IN
    SELECT generate_series(p_start_date, p_end_date, interval '1 day')::date
  LOOP
    INSERT INTO public.leave_days (request_id, employee_id, leave_date)
    VALUES (p_request_id, v_request.employee_id, v_leave_date);

    v_day_count := v_day_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'employee_id', v_request.employee_id,
    'days', v_day_count
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'overlap',
      'error', 'Employee already has leave covering some of these dates'
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants.
--
-- New public functions get EXECUTE for anon and authenticated by default in this
-- project. These are SECURITY DEFINER and skip RLS, so they are service_role only.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.rota_shifts_clashing_with_leave(uuid, date[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rota_shifts_clashing_with_leave(uuid, date[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.approve_leave_request_with_rota_guard(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_request_with_rota_guard(uuid, uuid, text, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.book_approved_leave_with_rota_guard(uuid, date, date, text, smallint, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_approved_leave_with_rota_guard(uuid, date, date, text, smallint, uuid, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_leave_request_dates(uuid, date, date, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_leave_request_dates(uuid, date, date, smallint) TO service_role;

-- Rollback
-- --------
-- Two of the three functions are new and nothing on main calls them, so dropping them
-- is safe once the calling code is reverted. update_leave_request_dates is a REPLACE,
-- so rolling it back means re-applying the body from 20260628000001, which is
-- byte-identical to this one minus the lock and the approved-request rota check.
--
-- DROP FUNCTION IF EXISTS public.book_approved_leave_with_rota_guard(uuid, date, date, text, smallint, uuid, timestamptz);
-- DROP FUNCTION IF EXISTS public.approve_leave_request_with_rota_guard(uuid, uuid, text, timestamptz);
-- DROP FUNCTION IF EXISTS public.rota_shifts_clashing_with_leave(uuid, date[]);
