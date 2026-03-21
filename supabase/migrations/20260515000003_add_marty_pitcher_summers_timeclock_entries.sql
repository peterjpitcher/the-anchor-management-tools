-- Migration: Add historical timeclock entries for Marty Pitcher-Summers (runner)
-- All times are UK local time (GMT/UTC+0 — all dates fall before DST change on 29 Mar 2026)
-- Strategy:
--   • If the date has no existing session → INSERT
--   • If the date has an exact match (same clock_in + clock_out) → NOTICE + skip
--   • If the date has a session with different times → UPDATE to authoritative times from this list

DO $$
DECLARE
  v_employee_id UUID;
  v_existing     RECORD;
  v_entry        RECORD;
BEGIN

  -- Resolve employee by name
  SELECT employee_id INTO v_employee_id
  FROM employees
  WHERE first_name = 'Marty'
    AND last_name  = 'Pitcher-Summers'
  LIMIT 1;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Employee "Marty Pitcher-Summers" not found in employees table — aborting';
  END IF;

  RAISE NOTICE 'Resolved Marty Pitcher-Summers → employee_id: %', v_employee_id;

  -- Iterate over all 19 target entries
  FOR v_entry IN
    SELECT *
    FROM (VALUES
      ('2026-01-18'::date, '2026-01-18T12:00:00Z'::timestamptz, '2026-01-18T18:00:00Z'::timestamptz),
      ('2026-01-25'::date, '2026-01-25T12:00:00Z'::timestamptz, '2026-01-25T18:00:00Z'::timestamptz),
      ('2026-02-01'::date, '2026-02-01T12:00:00Z'::timestamptz, '2026-02-01T18:00:00Z'::timestamptz),
      ('2026-02-04'::date, '2026-02-04T17:00:00Z'::timestamptz, '2026-02-04T21:00:00Z'::timestamptz),
      ('2026-02-07'::date, '2026-02-07T16:00:00Z'::timestamptz, '2026-02-07T18:00:00Z'::timestamptz),
      ('2026-02-08'::date, '2026-02-08T12:00:00Z'::timestamptz, '2026-02-08T18:00:00Z'::timestamptz),
      ('2026-02-11'::date, '2026-02-11T16:00:00Z'::timestamptz, '2026-02-11T18:00:00Z'::timestamptz),
      ('2026-02-15'::date, '2026-02-15T12:00:00Z'::timestamptz, '2026-02-15T18:00:00Z'::timestamptz),
      ('2026-02-17'::date, '2026-02-17T18:00:00Z'::timestamptz, '2026-02-17T19:00:00Z'::timestamptz),
      ('2026-02-18'::date, '2026-02-18T18:00:00Z'::timestamptz, '2026-02-18T21:00:00Z'::timestamptz),
      ('2026-02-22'::date, '2026-02-22T12:00:00Z'::timestamptz, '2026-02-22T18:30:00Z'::timestamptz),
      ('2026-02-27'::date, '2026-02-27T18:00:00Z'::timestamptz, '2026-02-27T21:00:00Z'::timestamptz),
      ('2026-03-01'::date, '2026-03-01T12:00:00Z'::timestamptz, '2026-03-01T18:00:00Z'::timestamptz),
      ('2026-03-04'::date, '2026-03-04T17:30:00Z'::timestamptz, '2026-03-04T22:00:00Z'::timestamptz),
      ('2026-03-07'::date, '2026-03-07T13:00:00Z'::timestamptz, '2026-03-07T17:00:00Z'::timestamptz),
      ('2026-03-11'::date, '2026-03-11T16:30:00Z'::timestamptz, '2026-03-11T21:00:00Z'::timestamptz),
      ('2026-03-14'::date, '2026-03-14T17:00:00Z'::timestamptz, '2026-03-14T21:00:00Z'::timestamptz),
      ('2026-03-15'::date, '2026-03-15T11:00:00Z'::timestamptz, '2026-03-15T16:00:00Z'::timestamptz),
      ('2026-03-18'::date, '2026-03-18T18:00:00Z'::timestamptz, '2026-03-18T21:00:00Z'::timestamptz)
    ) AS t(work_date, clock_in_at, clock_out_at)
  LOOP

    -- Check for any existing session on this date for this employee
    SELECT id, clock_in_at, clock_out_at
    INTO v_existing
    FROM timeclock_sessions
    WHERE employee_id = v_employee_id
      AND work_date   = v_entry.work_date
    LIMIT 1;

    IF v_existing.id IS NULL THEN
      -- No session exists → insert
      INSERT INTO timeclock_sessions (
        employee_id,
        work_date,
        clock_in_at,
        clock_out_at,
        is_unscheduled,
        is_reviewed
      ) VALUES (
        v_employee_id,
        v_entry.work_date,
        v_entry.clock_in_at,
        v_entry.clock_out_at,
        true,   -- no linked shift
        false   -- pending manager review
      );
      RAISE NOTICE 'Inserted: % (%  →  %)', v_entry.work_date, v_entry.clock_in_at, v_entry.clock_out_at;

    ELSIF v_existing.clock_in_at = v_entry.clock_in_at
      AND v_existing.clock_out_at = v_entry.clock_out_at THEN
      -- Exact duplicate → skip silently
      RAISE NOTICE 'Skipped (exact duplicate): %', v_entry.work_date;

    ELSE
      -- Conflict — different times on the same date → UPDATE to authoritative times
      UPDATE timeclock_sessions
      SET clock_in_at  = v_entry.clock_in_at,
          clock_out_at = v_entry.clock_out_at,
          updated_at   = NOW()
      WHERE id = v_existing.id;
      RAISE NOTICE 'Updated: % (was %→%, now %→%)',
        v_entry.work_date,
        v_existing.clock_in_at, v_existing.clock_out_at,
        v_entry.clock_in_at, v_entry.clock_out_at;
    END IF;

  END LOOP;

  RAISE NOTICE 'Migration complete for Marty Pitcher-Summers.';
END $$;
