-- Calendar notes: every note has an end date.
--
-- 53 of the 121 notes on production had no end_date on 5 October 2026. All 53
-- came from one hand-run insert on 10 July 2026. A note with no end date is a
-- one-day note, and every reader has to remember that. The rota day headers
-- did not, and dropped those notes (fixed in the reader by PR 188).
--
-- This gives those rows the end date every reader already treats them as
-- having, then makes the column required so the next reader cannot repeat the
-- mistake. The app's own save paths always set end_date, so nothing the app
-- writes is affected. A hand-run insert that leaves end_date out now fails
-- with a not-null error instead of saving a row some screens cannot see.
--
-- The Google Calendar queue trigger fires on every update. The backfill changes
-- nothing Google is sent (the sync already uses note_date when end_date is
-- missing), so the trigger is switched off for the one statement, which keeps
-- 53 needless re-syncs out of the queue. ALTER TABLE ... DISABLE TRIGGER holds
-- a lock that makes every other writer wait until this commits, so no real
-- change can slip past while the trigger is off.
--
-- One DO block is one statement, so it is all or nothing whichever tool runs
-- it. Safe to run twice: the second run updates no rows.

DO $$
DECLARE
  backfilled integer;
  remaining integer;
BEGIN
  -- Give up after five seconds if the table is busy, so this can never sit in
  -- the lock queue holding up the calendars that read it.
  SET LOCAL lock_timeout = '5s';

  ALTER TABLE public.calendar_notes
    DISABLE TRIGGER queue_calendar_note_google_sync;

  UPDATE public.calendar_notes
  SET end_date = note_date
  WHERE end_date IS NULL;

  GET DIAGNOSTICS backfilled = ROW_COUNT;

  ALTER TABLE public.calendar_notes
    ENABLE TRIGGER queue_calendar_note_google_sync;

  SELECT count(*) INTO remaining
  FROM public.calendar_notes
  WHERE end_date IS NULL;

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'calendar_notes still has % rows with no end_date', remaining;
  END IF;

  ALTER TABLE public.calendar_notes
    ALTER COLUMN end_date SET NOT NULL;

  RAISE NOTICE 'calendar_notes: % rows given end_date = note_date', backfilled;
END;
$$;
