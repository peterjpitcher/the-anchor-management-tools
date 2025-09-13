-- Cleanup Event Reminders Across All Events
-- Purpose: Prevent early/duplicate D-1 ("tomorrow") SMS and tidy reminder rows across events
-- How to use:
--   - Run once with v_dry_run := TRUE (default) to preview changes via NOTICEs and summary queries
--   - Then set v_dry_run := FALSE and re-run to apply updates
--   - Horizon can be adjusted; defaults target future events and the next 30 days window

DO $$
DECLARE
  v_dry_run boolean := TRUE;                 -- Set to FALSE to apply changes
  v_days_ahead integer := 30;                -- Horizon (days ahead) for selection
  v_limit_to_horizon boolean := TRUE;        -- Limit actions to horizon (recommended)
  v_include_past_cleanup boolean := TRUE;    -- Cancel pending reminders for past events
  v_restrict_d1_to_booked boolean := TRUE;   -- Cancel D-1 for seats=0
  v_cancel_legacy_24h boolean := TRUE;       -- Cancel legacy 24_hour pending rows
  v_cancel_early_day_before boolean := TRUE; -- Cancel day-before scheduled earlier than event-1d

  n_legacy24h integer := 0;
  n_early_day_before integer := 0;
  n_inconsistent_sent integer := 0;
  n_d1_for_zero_seats integer := 0;
  n_dupes integer := 0;
  n_dupes_cancelled integer := 0;
  n_past_pending integer := 0;
BEGIN
  -- Pending legacy 24_hour (day-before) reminders in scope
  WITH scope AS (
    SELECT e.id AS event_id
    FROM events e
    WHERE (
      (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
      OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
    )
  )
  SELECT count(*) INTO n_legacy24h
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN scope s ON s.event_id = b.event_id
  WHERE br.status = 'pending'
    AND br.reminder_type = '24_hour';

  RAISE NOTICE 'Pending legacy 24_hour: %', n_legacy24h;

  IF v_cancel_legacy_24h AND NOT v_dry_run THEN
    WITH scope AS (
      SELECT e.id AS event_id
      FROM events e
      WHERE (
        (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
        OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
      )
    )
    UPDATE booking_reminders br
    SET status = 'cancelled',
        error_message = 'Cancelled to prevent early D-1 (legacy 24_hour)',
        updated_at = now()
    FROM bookings b
    JOIN scope s ON s.event_id = b.event_id
    WHERE br.booking_id = b.id
      AND br.status = 'pending'
      AND br.reminder_type = '24_hour';
  END IF;

  -- Early day-before (scheduled earlier than event_date - 1 day)
  WITH scope AS (
    SELECT e.id AS event_id, e.date AS event_date
    FROM events e
    WHERE (
      (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
      OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
    )
  )
  SELECT count(*) INTO n_early_day_before
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN scope s ON s.event_id = b.event_id
  WHERE br.status = 'pending'
    AND br.reminder_type IN ('no_seats_day_before', 'has_seats_day_before')
    AND br.scheduled_for::date < (s.event_date::date - INTERVAL '1 day');

  RAISE NOTICE 'Pending early day-before: %', n_early_day_before;

  IF v_cancel_early_day_before AND NOT v_dry_run THEN
    WITH early AS (
      SELECT br.id
      FROM booking_reminders br
      JOIN bookings b ON b.id = br.booking_id
      JOIN events e ON e.id = b.event_id
      WHERE (
        (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
        OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
      )
        AND br.status = 'pending'
        AND br.reminder_type IN ('no_seats_day_before', 'has_seats_day_before')
        AND br.scheduled_for::date < (e.date::date - INTERVAL '1 day')
    )
    UPDATE booking_reminders
    SET status = 'cancelled',
        error_message = 'Cancelled early day-before (scheduled_for < event-1d)',
        updated_at = now()
    WHERE id IN (SELECT id FROM early);
  END IF;

  -- Pending but already sent (has message_id): mark as sent
  WITH scope AS (
    SELECT e.id AS event_id
    FROM events e
    WHERE (
      (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
      OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
    )
  )
  SELECT count(*) INTO n_inconsistent_sent
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN scope s ON s.event_id = b.event_id
  WHERE br.status = 'pending'
    AND br.message_id IS NOT NULL;

  RAISE NOTICE 'Pending with message_id (will mark sent): %', n_inconsistent_sent;

  IF NOT v_dry_run THEN
    WITH scope AS (
      SELECT e.id AS event_id
      FROM events e
      WHERE (
        (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
        OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
      )
    )
    UPDATE booking_reminders br
    SET status = 'sent',
        sent_at = COALESCE(br.sent_at, now()),
        updated_at = now()
    FROM bookings b
    JOIN scope s ON s.event_id = b.event_id
    WHERE br.booking_id = b.id
      AND br.status = 'pending'
      AND br.message_id IS NOT NULL;
  END IF;

  -- Restrict D-1 to booked customers only (seats > 0)
  WITH scope AS (
    SELECT e.id AS event_id
    FROM events e
    WHERE (
      (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
      OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
    )
  )
  SELECT count(*) INTO n_d1_for_zero_seats
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN scope s ON s.event_id = b.event_id
  WHERE br.status = 'pending'
    AND br.reminder_type IN ('24_hour', 'has_seats_day_before', 'no_seats_day_before')
    AND COALESCE(b.seats, 0) = 0;

  RAISE NOTICE 'Pending D-1 for seats=0: % (will cancel if restrict)', n_d1_for_zero_seats;

  IF v_restrict_d1_to_booked AND NOT v_dry_run THEN
    WITH scope AS (
      SELECT e.id AS event_id
      FROM events e
      WHERE (
        (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
        OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
      )
    )
    UPDATE booking_reminders br
    SET status = 'cancelled',
        error_message = 'Cancelled: D-1 only for seats>0',
        updated_at = now()
    FROM bookings b
    JOIN scope s ON s.event_id = b.event_id
    WHERE br.booking_id = b.id
      AND br.status = 'pending'
      AND br.reminder_type IN ('24_hour', 'has_seats_day_before', 'no_seats_day_before')
      AND COALESCE(b.seats, 0) = 0;
  END IF;

  -- Dedupe pending reminders per (booking_id, reminder_type): keep latest scheduled_for
  WITH scope AS (
    SELECT e.id AS event_id
    FROM events e
    WHERE (
      (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
      OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
    )
  ), pending AS (
    SELECT br.id,
           br.booking_id,
           br.reminder_type,
           br.scheduled_for,
           ROW_NUMBER() OVER (
             PARTITION BY br.booking_id, br.reminder_type
             ORDER BY br.scheduled_for DESC, br.created_at DESC, br.id DESC
           ) AS rn
    FROM booking_reminders br
    JOIN bookings b ON b.id = br.booking_id
    JOIN scope s ON s.event_id = b.event_id
    WHERE br.status = 'pending'
  ), dupes AS (
    SELECT id FROM pending WHERE rn > 1
  )
  SELECT count(*) INTO n_dupes FROM dupes;

  RAISE NOTICE 'Pending duplicates to cancel (keep latest scheduled_for): %', n_dupes;

  IF NOT v_dry_run THEN
    WITH scope AS (
      SELECT e.id AS event_id
      FROM events e
      WHERE (
        (v_limit_to_horizon AND e.date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (v_days_ahead || ' days')::interval))
        OR (NOT v_limit_to_horizon AND e.date >= CURRENT_DATE)
      )
    ), pending AS (
      SELECT br.id,
             br.booking_id,
             br.reminder_type,
             br.scheduled_for,
             ROW_NUMBER() OVER (
               PARTITION BY br.booking_id, br.reminder_type
               ORDER BY br.scheduled_for DESC, br.created_at DESC, br.id DESC
             ) AS rn
      FROM booking_reminders br
      JOIN bookings b ON b.id = br.booking_id
      JOIN scope s ON s.event_id = b.event_id
      WHERE br.status = 'pending'
    )
    UPDATE booking_reminders
    SET status = 'cancelled',
        error_message = 'Cancelled duplicate pending reminder (kept latest)',
        updated_at = now()
    WHERE id IN (SELECT id FROM pending WHERE rn > 1);
    GET DIAGNOSTICS n_dupes_cancelled = ROW_COUNT;
    RAISE NOTICE 'Duplicates cancelled: %', n_dupes_cancelled;
  END IF;

  -- Cancel pending reminders for past events (safety)
  IF v_include_past_cleanup THEN
    WITH past AS (
      SELECT br.id
      FROM booking_reminders br
      JOIN bookings b ON b.id = br.booking_id
      JOIN events e ON e.id = b.event_id
      WHERE br.status = 'pending'
        AND e.date < CURRENT_DATE
    )
    SELECT count(*) INTO n_past_pending FROM past;

    RAISE NOTICE 'Pending for past events: %', n_past_pending;

    IF NOT v_dry_run THEN
      UPDATE booking_reminders
      SET status = 'cancelled',
          error_message = 'Cancelled pending reminder for past event',
          updated_at = now()
      WHERE id IN (SELECT id FROM (
        SELECT br.id
        FROM booking_reminders br
        JOIN bookings b ON b.id = br.booking_id
        JOIN events e ON e.id = b.event_id
        WHERE br.status = 'pending'
          AND e.date < CURRENT_DATE
      ) q);
    END IF;
  END IF;

  -- Summary
  RAISE NOTICE 'Summary: legacy24h=% early_day_before=% pendingWithMsgId=% d1ZeroSeats=% duplicates=% pastPending=% (dry_run=% horizonDays=% limitToHorizon=%)',
    n_legacy24h, n_early_day_before, n_inconsistent_sent, n_d1_for_zero_seats, n_dupes, n_past_pending, v_dry_run, v_days_ahead, v_limit_to_horizon;
END $$;

-- Post-fix overview: aggregated counts by type/status (future + horizon)
WITH scope AS (
  SELECT e.id AS event_id
  FROM events e
  WHERE e.date >= CURRENT_DATE
)
SELECT br.reminder_type, br.status, COUNT(*)
FROM booking_reminders br
JOIN bookings b ON b.id = br.booking_id
JOIN scope s ON s.event_id = b.event_id
GROUP BY 1, 2
ORDER BY 1, 2;

