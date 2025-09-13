-- Cleanup Event Reminders for a Single Event
-- Purpose: prevent early/duplicate D-1 ("tomorrow") SMS and tidy reminder rows
-- Usage:
--   1) Review the variables in the DO block (v_event_id, v_dry_run, flags)
--   2) Run once with v_dry_run := TRUE to preview counts (no changes)
--   3) Set v_dry_run := FALSE to apply updates

DO $$
DECLARE
  v_event_id uuid := '5b75f07e-53d6-4fd1-8f42-6b2861cf87a2'; -- TARGET EVENT UUID
  v_dry_run boolean := TRUE;                   -- Set to FALSE to apply changes
  v_restrict_d1_to_booked boolean := TRUE;    -- Cancel D-1 for seats=0
  v_cancel_legacy_24h boolean := TRUE;        -- Cancel legacy 24_hour pending rows
  v_cancel_early_day_before boolean := TRUE;  -- Cancel day-before scheduled earlier than event-1d

  n_legacy24h integer := 0;
  n_early_day_before integer := 0;
  n_inconsistent_sent integer := 0;
  n_d1_for_zero_seats integer := 0;
  n_dupes integer := 0;
  n_dupes_cancelled integer := 0;
BEGIN
  -- Validate event exists
  PERFORM 1 FROM events WHERE id = v_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event % not found', v_event_id;
  END IF;

  -- Count pending legacy 24_hour (day-before) reminders
  SELECT count(*) INTO n_legacy24h
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  WHERE b.event_id = v_event_id
    AND br.status = 'pending'
    AND br.reminder_type = '24_hour';

  RAISE NOTICE 'Pending legacy 24_hour: %', n_legacy24h;

  IF v_cancel_legacy_24h AND NOT v_dry_run THEN
    UPDATE booking_reminders br
    SET status = 'cancelled',
        error_message = 'Cancelled to prevent early D-1 (legacy 24_hour)',
        updated_at = now()
    FROM bookings b
    WHERE br.booking_id = b.id
      AND b.event_id = v_event_id
      AND br.status = 'pending'
      AND br.reminder_type = '24_hour';
  END IF;

  -- Count "day before" reminders scheduled earlier than event_date - 1 day
  SELECT count(*) INTO n_early_day_before
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  JOIN events e ON e.id = b.event_id
  WHERE b.event_id = v_event_id
    AND br.status = 'pending'
    AND br.reminder_type IN ('no_seats_day_before', 'has_seats_day_before')
    AND br.scheduled_for::date < (e.date::date - INTERVAL '1 day');

  RAISE NOTICE 'Pending early day-before: %', n_early_day_before;

  IF v_cancel_early_day_before AND NOT v_dry_run THEN
    WITH early AS (
      SELECT br.id
      FROM booking_reminders br
      JOIN bookings b ON b.id = br.booking_id
      JOIN events e ON e.id = b.event_id
      WHERE b.event_id = v_event_id
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

  -- Mark "pending but already sent" rows as sent (have Twilio message_id)
  SELECT count(*) INTO n_inconsistent_sent
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  WHERE b.event_id = v_event_id
    AND br.status = 'pending'
    AND br.message_id IS NOT NULL;

  RAISE NOTICE 'Pending with message_id (will mark sent): %', n_inconsistent_sent;

  IF NOT v_dry_run THEN
    UPDATE booking_reminders br
    SET status = 'sent',
        sent_at = COALESCE(br.sent_at, now()),
        updated_at = now()
    FROM bookings b
    WHERE br.booking_id = b.id
      AND b.event_id = v_event_id
      AND br.status = 'pending'
      AND br.message_id IS NOT NULL;
  END IF;

  -- Optional: restrict D-1 to booked customers only (seats > 0)
  SELECT count(*) INTO n_d1_for_zero_seats
  FROM booking_reminders br
  JOIN bookings b ON b.id = br.booking_id
  WHERE b.event_id = v_event_id
    AND br.status = 'pending'
    AND br.reminder_type IN ('24_hour', 'has_seats_day_before', 'no_seats_day_before')
    AND COALESCE(b.seats, 0) = 0;

  RAISE NOTICE 'Pending D-1 for seats=0: % (will cancel if restrict)', n_d1_for_zero_seats;

  IF v_restrict_d1_to_booked AND NOT v_dry_run THEN
    UPDATE booking_reminders br
    SET status = 'cancelled',
        error_message = 'Cancelled: D-1 only for seats>0',
        updated_at = now()
    FROM bookings b
    WHERE br.booking_id = b.id
      AND b.event_id = v_event_id
      AND br.status = 'pending'
      AND br.reminder_type IN ('24_hour', 'has_seats_day_before', 'no_seats_day_before')
      AND COALESCE(b.seats, 0) = 0;
  END IF;

  -- Dedupe pending reminders: keep the latest scheduled_for per (booking_id, reminder_type)
  WITH pending AS (
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
    WHERE b.event_id = v_event_id
      AND br.status = 'pending'
  ), dupes AS (
    SELECT id FROM pending WHERE rn > 1
  )
  SELECT count(*) INTO n_dupes FROM dupes;

  RAISE NOTICE 'Pending duplicates to cancel (keep latest scheduled_for): %', n_dupes;

  IF NOT v_dry_run THEN
    UPDATE booking_reminders
    SET status = 'cancelled',
        error_message = 'Cancelled duplicate pending reminder (kept latest)',
        updated_at = now()
    WHERE id IN (
      WITH pending AS (
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
        WHERE b.event_id = v_event_id
          AND br.status = 'pending'
      )
      SELECT id FROM pending WHERE rn > 1
    );
    GET DIAGNOSTICS n_dupes_cancelled = ROW_COUNT;
    RAISE NOTICE 'Duplicates cancelled: %', n_dupes_cancelled;
  END IF;

  -- Summary
  RAISE NOTICE 'Summary: legacy24h=% early_day_before=% pendingWithMsgId=% d1ZeroSeats=% duplicates=% (dry_run=%)',
    n_legacy24h, n_early_day_before, n_inconsistent_sent, n_d1_for_zero_seats, n_dupes, v_dry_run;
END $$;

-- Post-fix overview (aggregated counts by type/status)
SELECT br.reminder_type, br.status, COUNT(*)
FROM booking_reminders br
JOIN bookings b ON b.id = br.booking_id
WHERE b.event_id = '5b75f07e-53d6-4fd1-8f42-6b2861cf87a2'
GROUP BY 1, 2
ORDER BY 1, 2;

-- List current day-before rows to verify scheduled_for == event_date - 1 day
SELECT br.id, br.reminder_type, br.status, br.scheduled_for, e.date AS event_date
FROM booking_reminders br
JOIN bookings b ON b.id = br.booking_id
JOIN events e ON e.id = b.event_id
WHERE b.event_id = '5b75f07e-53d6-4fd1-8f42-6b2861cf87a2'
  AND br.reminder_type IN ('no_seats_day_before', 'has_seats_day_before')
ORDER BY e.date, br.scheduled_for;

