-- Event edits, cancellations and postponements, part 2: one booking rule in the database (release
-- 16 of the customer bookings review of 24 October 2026: BK-035, BK-089; owner decision D11).
--
--   * BK-035, D11. Turning off Accept bookings (events.bookings_enabled) and the online sales close
--     time (events.booking_cutoff_at) were checked by the website's booking route only, so text
--     replies still booked and the waitlist still offered seats. create_event_booking_v05, which
--     every booking version and wrapper calls (v06 to v09, the attendee and request wrappers and
--     accept_waitlist_offer_v05), now refuses the online sources 'brand_site' (the default, and
--     what a waitlist acceptance passes) and 'sms_reply' with 'bookings_disabled' when Accept
--     bookings is off and 'sales_closed' once the sales close time has passed. Staff and FOH
--     bookings are not limited by either, as decided. create_next_waitlist_offer_v05 makes no
--     offer in either case. The reasons are the ones reply-to-book already treats as closed.
--   * BK-089. A postponed night stayed bookable. 'postponed' joins 'cancelled' and 'draft' as not
--     bookable in create_event_booking_v05, create_next_waitlist_offer_v05 and
--     accept_waitlist_offer_v05, for every source.
--
-- Live data this changes: none. Checked on 28 October 2026: no event is postponed, no upcoming
-- event has Accept bookings off, and the only event with booking_open false is cancelled.
--
-- The three functions are patched in place, as 20261027193656_table_availability_rules_agree did:
-- the live definition is read with pg_get_functiondef, each old passage is replaced, and the result
-- is executed. The block refuses to run unless each old passage appears exactly once and its
-- replacement only where the old passage itself holds it, so a definition that has moved on fails
-- loudly instead of being half patched; a second run is a no-op. Other releases may patch other
-- passages of these functions; any order works as long as the passages below are untouched.
-- CREATE OR REPLACE keeps owner, grants, SECURITY DEFINER and search_path; the grants are restated
-- at the end anyway. Bodies checked against production on 28 October 2026, md5(prosrc):
-- create_event_booking_v05 3451c92d9e571f975b4651dcde605af3, create_next_waitlist_offer_v05
-- 833840416e444589b6bd1708187d7419, accept_waitlist_offer_v05 1fbfbfe96c644bab32d5a499712196ae.
-- All three are service_role only in production (20261026212313), and stay so; none is callable by
-- anon, so no anon grant is re-issued.
--
-- Rollback: tasks/event-edits-cancel-postpone/rollback.sql. Tested by
-- scripts/testing/event-bookable-rules-postgres.py.

DO $patch$
DECLARE
  v_target record;
  v_oid oid;
  v_def text;
  v_old_hits integer;
  v_new_hits integer;
  v_old_in_new integer;
  v_new_in_old integer;
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
    ORDER BY step
  LOOP
    v_oid := to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'event_bookable_rules: % is missing', v_target.signature;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_old_hits := (length(v_def) - length(replace(v_def, v_target.old_text, ''))) / length(v_target.old_text);
    v_new_hits := (length(v_def) - length(replace(v_def, v_target.new_text, ''))) / length(v_target.new_text);
    v_old_in_new := (length(v_target.new_text) - length(replace(v_target.new_text, v_target.old_text, '')))
      / length(v_target.old_text);
    v_new_in_old := (length(v_target.old_text) - length(replace(v_target.old_text, v_target.new_text, '')))
      / length(v_target.new_text);

    IF v_new_hits = 1 AND v_old_hits = v_old_in_new THEN
      RAISE NOTICE 'event_bookable_rules: % step % already applied, skipped', v_target.signature, v_target.step;
      CONTINUE;
    END IF;

    IF v_old_hits <> 1 OR v_new_hits <> v_new_in_old THEN
      RAISE EXCEPTION 'event_bookable_rules: % step % found % old and % new passages, expected 1 and %',
        v_target.signature, v_target.step, v_old_hits, v_new_hits, v_new_in_old;
    END IF;

    EXECUTE replace(v_def, v_target.old_text, v_target.new_text);
    RAISE NOTICE 'event_bookable_rules: % step % patched', v_target.signature, v_target.step;
  END LOOP;
END
$patch$;

-- Production's grants on 28 October 2026, restated: service_role only.
REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.create_next_waitlist_offer_v05(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_next_waitlist_offer_v05(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.accept_waitlist_offer_v05(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_waitlist_offer_v05(text,text) TO service_role;
