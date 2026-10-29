-- Rollback for release 16 of the customer bookings review (event edits, cancellations and
-- postponements). Restores production as it stood on 28 October 2026. Every part is safe to run
-- whether or not its migration was applied, and a second run is a no-op.
--
-- Parts, newest first, so run this file top to bottom:
--   3. 20261029083003_event_date_move_and_slug_history
--   2. 20261029083002_event_bookable_rules
--   1. 20261029083001_event_payment_mode_lock_and_single_line_seats
--
-- Data: part 3 drops event_slug_history and the old addresses it recorded. Nothing else here
-- touches a row. Bookings moved to a new night by move_event_seated_bookings_v01 stay where they
-- were moved; rolling back does not move them again.

-- ── Part 3: 20261029083003_event_date_move_and_slug_history ─────────────────────────────────────
DROP TRIGGER IF EXISTS trg_record_event_slug_history ON public.events;
DROP FUNCTION IF EXISTS public.record_event_slug_history_v01();
DROP TABLE IF EXISTS public.event_slug_history;
DROP FUNCTION IF EXISTS public.move_event_seated_bookings_v01(uuid, date, text, time without time zone, integer, jsonb, jsonb);

-- ── Part 2: 20261029083002_event_bookable_rules ─────────────────────────────────────────────────
-- Each replacement is put back to production's passage, newest step first, wherever it is found.
DO $rollback$
DECLARE
  v_target record;
  v_oid oid;
  v_def text;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      (1, 'public.create_event_booking_v05(uuid,uuid,integer,text,text)',
$old$    e.booking_open,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time,
    e.end_time,
    e.duration_minutes
  INTO v_event
$old$,
$new$    e.booking_open,
    e.bookings_enabled,
    e.booking_cutoff_at,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time,
    e.end_time,
    e.duration_minutes
  INTO v_event
$new$),
      (2, 'public.create_event_booking_v05(uuid,uuid,integer,text,text)',
$old$  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;
$old$,
$new$  -- BK-089: a postponed night has no date to book.
  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft', 'postponed') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  -- BK-035, owner decision D11: Accept bookings and the online sales close time apply to the
  -- website, waitlist acceptances and text replies. Staff and FOH bookings are not limited by them.
  IF COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site') IN ('brand_site', 'sms_reply') THEN
    IF COALESCE(v_event.bookings_enabled, true) = false THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'bookings_disabled');
    END IF;
    IF v_event.booking_cutoff_at IS NOT NULL AND v_event.booking_cutoff_at <= now() THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'sales_closed');
    END IF;
  END IF;
$new$),
      (3, 'public.create_next_waitlist_offer_v05(uuid)',
$old$    e.booking_open,
    e.event_status
  INTO v_event
$old$,
$new$    e.booking_open,
    e.bookings_enabled,
    e.booking_cutoff_at,
    e.event_status
  INTO v_event
$new$),
      (4, 'public.create_next_waitlist_offer_v05(uuid)',
$old$  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'not_bookable');
  END IF;
$old$,
$new$  -- BK-089: a postponed night has no date to offer.
  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft', 'postponed') THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'not_bookable');
  END IF;

  -- BK-035, owner decision D11: the waitlist is an online channel.
  IF COALESCE(v_event.bookings_enabled, true) = false THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'bookings_disabled');
  END IF;

  IF v_event.booking_cutoff_at IS NOT NULL AND v_event.booking_cutoff_at <= NOW() THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'sales_closed');
  END IF;
$new$),
      (5, 'public.accept_waitlist_offer_v05(text,text)',
$old$  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;
$old$,
$new$  -- BK-089: a postponed night has no date to book.
  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft', 'postponed') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;
$new$)
    ) AS t(step, signature, old_text, new_text)
    ORDER BY step DESC
  LOOP
    v_oid := to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN CONTINUE; END IF;
    v_def := pg_get_functiondef(v_oid);
    IF position(v_target.new_text IN v_def) > 0 THEN
      EXECUTE replace(v_def, v_target.new_text, v_target.old_text);
    END IF;
  END LOOP;
END
$rollback$;

-- Production's grants, restated: service_role only.
DO $grants$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_event_booking_v05(uuid,uuid,integer,text,text)',
    'public.create_next_waitlist_offer_v05(uuid)',
    'public.accept_waitlist_offer_v05(text,text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_signature);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_signature);
    END IF;
  END LOOP;
END
$grants$;

-- ── Part 1: 20261029083001_event_payment_mode_lock_and_single_line_seats ──────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS zz_guard_event_payment_mode_locked ON public.events;
DROP FUNCTION IF EXISTS public.guard_event_payment_mode_locked_v01();

DO $rollback$
DECLARE
  v_oid oid;
  v_def text;
  v_new text := $new$  if v_nondefault > 0 then
    -- BK-143: a booking with one line keeps its own ticket type when the event's default type
    -- changes, and that line's quantity still follows the booking's seats.
    if (select count(*) from public.booking_items where booking_id = p_booking_id) = 1 then
      update public.booking_items
         set quantity = v_seats
       where booking_id = p_booking_id
         and quantity is distinct from v_seats;
    end if;
    return;
  end if;
$new$;
  v_old text := $old$  if v_nondefault > 0 then return; end if;
$old$;
BEGIN
  v_oid := to_regprocedure('public.sync_booking_default_item_v01(uuid)');
  IF v_oid IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position(v_new IN v_def) > 0 THEN
    EXECUTE replace(v_def, v_new, v_old);
  END IF;
  -- Production's grants, restated.
  REVOKE ALL ON FUNCTION public.sync_booking_default_item_v01(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.sync_booking_default_item_v01(uuid) TO service_role;
END
$rollback$;
