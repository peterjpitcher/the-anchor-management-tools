-- Event edits, cancellations and postponements, part 3: moving a night takes its tables and seats
-- with it, and old web addresses keep working (release 16 of the customer bookings review of
-- 24 October 2026: BK-073, BK-192).
--
--   * BK-073. Changing a table, mixed or communal event's date or time only messaged the guests:
--     their table bookings, table assignments and communal seats stayed on the old night, so the
--     new night showed every seat free and the old night held tables for nobody. The app refused
--     the move while seated bookings existed (part 1). move_event_seated_bookings_v01 now moves
--     the event and every linked seat in one transaction: it sets the event's date, start time and
--     (when given) end time and duration, puts each live table booking, its assignments and each
--     communal seat allocation on the event's new window (worked out as
--     create_event_table_reservation_v05 does), then saves the rest of the edit through
--     update_event_transaction in the same transaction, so a refused edit undoes the move. The existing triggers re-check every table on the new night (other bookings, private
--     hires, communal seats, table capacity). Assignments and allocations are first parked far in
--     the future, so bookings on the same event never clash with each other's old positions mid
--     move. If any booking does not fit, nothing is saved at all and the result lists each booking
--     that did not fit and why.
--   * BK-192. Web addresses change when a date moves or staff rewrite them, and AMS kept no record
--     of the old one, so old links, posters and short links landed on a 'not found' page (190 of
--     1,296 event short links). event_slug_history records each old address against its event,
--     written by a trigger whenever events.slug changes, from any path. An address that becomes an
--     event's current one again is removed from the history. The events API looks it up on a miss.
--
-- Live data this changes: event_slug_history is created with 29 rows, one for each distinct dead
-- address in short_links whose link metadata names an event that still exists (checked on
-- 28 October 2026; every one names exactly one event, and none is any event's current address).
-- No other row is touched. move_event_seated_bookings_v01 writes only when the app calls it.
--
-- New objects only; no existing function is changed. Both functions are SECURITY DEFINER with
-- search_path public. move_event_seated_bookings_v01 is service_role only, called by the event
-- edit action through the service-role client; the trigger function is callable by nobody. The
-- table is service_role only with RLS on and no policies, so neither anon nor a staff session can
-- read it directly. Production md5(prosrc) of the functions this relies on, read on 28 October
-- 2026: event_communal_window_v01 d991d0caa701827e0fffc1e1f53a257d,
-- enforce_booking_table_assignment_integrity_v05 bc62088e84a45351bcf8d96a2ae88399,
-- enforce_event_communal_seat_allocation_v01 7c763b63915a3c15b9a2ed221ea76eee,
-- update_event_transaction 4d480796c44e214af8886cbc5eb01b74 (unchanged; for a seated move the
-- app passes the whole edit to move_event_seated_bookings_v01, which calls it in the same
-- transaction).
--
-- Rollback: tasks/event-edits-cancel-postpone/rollback.sql. Tested by
-- scripts/testing/event-date-move-postgres.py.

CREATE FUNCTION public.move_event_seated_bookings_v01(
  p_event_id uuid,
  p_new_date date,
  p_new_time text,
  p_new_end_time time without time zone DEFAULT NULL,
  p_new_duration_minutes integer DEFAULT NULL,
  p_event_data jsonb DEFAULT NULL,
  p_faqs jsonb DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Far enough ahead that nothing else is booked there, so parked rows never clash.
  c_park CONSTANT interval := interval '100 years';
  v_event RECORD;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_booking RECORD;
  v_failures jsonb := '[]'::jsonb;
  v_moved integer := 0;
  v_table_bookings integer := 0;
  v_allocations integer := 0;
  v_rows integer;
  v_duration integer;
  v_saved jsonb;
BEGIN
  IF p_new_date IS NULL OR p_new_time IS NULL OR TRIM(p_new_time) = '' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'new_start_missing');
  END IF;

  SELECT e.id, e.date, e.time, e.start_datetime, e.event_status
    INTO v_event
    FROM public.events e
   WHERE e.id = p_event_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_old_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );
  v_new_start := ((p_new_date::text || ' ' || TRIM(p_new_time))::timestamp AT TIME ZONE 'Europe/London');

  IF v_new_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'new_start_in_past');
  END IF;

  UPDATE public.events
     SET date = p_new_date,
         time = TRIM(p_new_time),
         start_datetime = v_new_start,
         end_time = COALESCE(p_new_end_time, end_time),
         duration_minutes = COALESCE(p_new_duration_minutes, duration_minutes)
   WHERE id = p_event_id;

  -- The event's new window: its start less 15 minutes (or the start itself once that has
  -- passed) to its end time, or the start plus its duration, past midnight when needed. The same
  -- window create_event_table_reservation_v05 reserves tables for and communal seats use, so a
  -- start-only change keeps the explicit end time.
  SELECT w.start_datetime, w.end_datetime
    INTO v_window_start, v_window_end
    FROM public.event_communal_window_v01(p_event_id) w;
  v_duration := GREATEST(30, CEIL(EXTRACT(EPOCH FROM (v_window_end - v_window_start)) / 60.0)::integer);

  -- Park this event's seats out of the way first.
  UPDATE public.booking_table_assignments bta
     SET start_datetime = bta.start_datetime + c_park,
         end_datetime = bta.end_datetime + c_park
    FROM public.table_bookings tb
    JOIN public.bookings b ON b.id = tb.event_booking_id
   WHERE bta.table_booking_id = tb.id
     AND b.event_id = p_event_id
     AND b.status IN ('confirmed', 'pending_payment')
     AND tb.status IN ('confirmed', 'pending_payment');

  UPDATE public.event_communal_seat_allocations ecsa
     SET start_datetime = ecsa.start_datetime + c_park,
         end_datetime = ecsa.end_datetime + c_park
    FROM public.bookings b
   WHERE ecsa.event_booking_id = b.id
     AND ecsa.event_id = p_event_id
     AND b.status IN ('confirmed', 'pending_payment');

  -- Then bring each booking onto the new night on its own, so one that does not fit is named.
  FOR v_booking IN
    SELECT b.id
      FROM public.bookings b
     WHERE b.event_id = p_event_id
       AND b.status IN ('confirmed', 'pending_payment')
       AND (
         EXISTS (SELECT 1 FROM public.table_bookings tb WHERE tb.event_booking_id = b.id AND tb.status IN ('confirmed', 'pending_payment'))
         OR EXISTS (SELECT 1 FROM public.event_communal_seat_allocations ecsa WHERE ecsa.event_booking_id = b.id)
       )
     ORDER BY b.created_at, b.id
  LOOP
    BEGIN
      UPDATE public.table_bookings tb
         SET start_datetime = v_window_start,
             end_datetime = v_window_end,
             duration_minutes = v_duration,
             booking_date = (v_window_start AT TIME ZONE 'Europe/London')::date,
             booking_time = (v_window_start AT TIME ZONE 'Europe/London')::time
       WHERE tb.event_booking_id = v_booking.id
         AND tb.status IN ('confirmed', 'pending_payment');
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_table_bookings := v_table_bookings + v_rows;

      UPDATE public.booking_table_assignments bta
         SET start_datetime = v_window_start,
             end_datetime = v_window_end
        FROM public.table_bookings tb
       WHERE bta.table_booking_id = tb.id
         AND tb.event_booking_id = v_booking.id
         AND tb.status IN ('confirmed', 'pending_payment');

      UPDATE public.event_communal_seat_allocations
         SET start_datetime = v_window_start,
             end_datetime = v_window_end
       WHERE event_booking_id = v_booking.id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_allocations := v_allocations + v_rows;

      v_moved := v_moved + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failures := v_failures || jsonb_build_array(jsonb_build_object('booking_id', v_booking.id, 'reason', SQLERRM));
    END;
  END LOOP;

  IF jsonb_array_length(v_failures) > 0 THEN
    -- Caught below, which undoes everything this call did, the event's own date included.
    RAISE EXCEPTION USING ERRCODE = 'P2011', MESSAGE = 'seated_bookings_do_not_fit';
  END IF;

  -- The rest of the edit, in this same transaction: if update_event_transaction refuses it (for
  -- example a standing limit below the standing tickets sold), its error ends this call and the
  -- move, the date and every seat are undone with it.
  IF p_event_data IS NOT NULL THEN
    v_saved := public.update_event_transaction(p_event_id, p_event_data, p_faqs);
  END IF;

  RETURN jsonb_build_object(
    'state', 'moved',
    'event_id', p_event_id,
    'old_start', v_old_start,
    'new_start', v_new_start,
    'bookings_moved', v_moved,
    'table_bookings_moved', v_table_bookings,
    'communal_allocations_moved', v_allocations,
    'event', v_saved
  );
EXCEPTION WHEN SQLSTATE 'P2011' THEN
  RETURN jsonb_build_object('state', 'blocked', 'reason', 'seated_bookings_do_not_fit', 'bookings', v_failures);
END;
$function$;

COMMENT ON FUNCTION public.move_event_seated_bookings_v01(uuid, date, text, time without time zone, integer, jsonb, jsonb) IS
  'Moves an event to a new date and time with its table bookings, table assignments and communal seats, in one transaction; refuses with the bookings that do not fit (BK-073).';

REVOKE ALL ON FUNCTION public.move_event_seated_bookings_v01(uuid, date, text, time without time zone, integer, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_event_seated_bookings_v01(uuid, date, text, time without time zone, integer, jsonb, jsonb) TO service_role;

CREATE TABLE public.event_slug_history (
  old_slug character varying PRIMARY KEY,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  replaced_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_slug_history IS
  'Old event web addresses and the event each now belongs to, so old links redirect (BK-192). Written by trg_record_event_slug_history.';

CREATE INDEX event_slug_history_event_id_idx ON public.event_slug_history (event_id);

ALTER TABLE public.event_slug_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_slug_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_slug_history TO service_role;

CREATE FUNCTION public.record_event_slug_history_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.slug IS NOT DISTINCT FROM OLD.slug THEN
    RETURN NULL;
  END IF;

  -- An address that is an event's current one again stops redirecting.
  IF NEW.slug IS NOT NULL THEN
    DELETE FROM public.event_slug_history WHERE old_slug = NEW.slug;
  END IF;

  IF OLD.slug IS NOT NULL AND TRIM(OLD.slug) <> '' THEN
    INSERT INTO public.event_slug_history (old_slug, event_id, replaced_at)
    VALUES (OLD.slug, NEW.id, now())
    ON CONFLICT (old_slug) DO UPDATE
      SET event_id = EXCLUDED.event_id,
          replaced_at = EXCLUDED.replaced_at;
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.record_event_slug_history_v01() IS
  'Records an event''s old slug in event_slug_history whenever events.slug changes (BK-192).';

REVOKE ALL ON FUNCTION public.record_event_slug_history_v01() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_record_event_slug_history
  AFTER UPDATE OF slug ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.record_event_slug_history_v01();

-- Backfill: the dead addresses short links still point at, for events that still exist. Each
-- link's metadata names the event it was made for. Addresses that are any event's current one,
-- and links whose event was deleted, are left out.
INSERT INTO public.event_slug_history (old_slug, event_id, replaced_at)
SELECT DISTINCT ON (dead.slug) dead.slug, e.id, now()
  FROM (
    SELECT substring(sl.destination_url FROM '/events/([a-z0-9-]+)') AS slug,
           sl.metadata ->> 'event_id' AS event_id,
           sl.created_at
      FROM public.short_links sl
     WHERE sl.destination_url ~ '/events/[a-z0-9-]+'
  ) dead
  JOIN public.events e ON e.id::text = dead.event_id
 WHERE dead.slug IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.events current_event WHERE current_event.slug = dead.slug)
 ORDER BY dead.slug, dead.created_at DESC
ON CONFLICT (old_slug) DO NOTHING;
