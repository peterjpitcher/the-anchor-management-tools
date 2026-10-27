-- Kitchen pacing counts the food at private hires and events (owner decision D29; BK-072, customer
-- bookings review of 24 October 2026).
--
-- The kitchen limit online (the pace for the day, less the walk-in reserve, per arrival window)
-- only counted table bookings marked as food. A catered hire or event guests eating never reduced
-- it, so the kitchen could be booked to its normal pace on top of a 50-portion buffet. D29: food at
-- private hires and events reduces the kitchen slots on sale online that night, counting each guest
-- who eats as one cover unless staff set otherwise.
--
--   * private_bookings.kitchen_covers and kitchen_food_time: staff's own number of covers (0 for a
--     hire whose food the kitchen does not cook) and when the food goes out. Left empty, a hire that
--     holds its room (private_booking_occupies_space) and has kitchen catering (a catering line whose
--     package is food or an add-on and not bring-your-own, or a line with no package) counts its
--     guest count (or, with no guest count, its largest per-head food quantity) at its start time.
--   * events.food_served, kitchen_covers and kitchen_food_time: guests eat at this event. Each live
--     ticket counts as a cover at the event's start, unless staff give a number or a time. Off by
--     default, so no event changes until staff say it serves food.
--   * kitchen_food_loads(from, to) lists those covers by date and time; kitchen_food_load_covers adds
--     them up for one arrival window, exactly as the pacing check counts table bookings (by arrival
--     time, the window centred on the slot).
--   * create_table_booking_core_v06 (every booking channel) and check_table_availability_v06 (the
--     slots the website and staff form offer) add those covers to the window before the pacing test.
--     Staff can still book over it (their bypass is unchanged), and walk-ins still skip pacing.
--   * check_table_availability_v06 also now reads the date's own pace and walk-in reserve from
--     special hours, as create_table_booking_core_v06 already did, so the website no longer offers a
--     slot the booking engine refuses on a date with its own pace.
--
-- On 26 October 2026 two upcoming confirmed hires have kitchen catering: Sunday 1 November (35
-- guests from 15:00, Finger Buffet) and Saturday 7 November (30 guests from 19:30, Finger Buffet).
-- On 1 November the 15:00 and 15:15 online food slots stop selling (the kitchen serves 13:00 to
-- 18:00 that Sunday) until staff set a food time or a number of covers on the hire. On 7 November
-- nothing changes online: the kitchen closes at 19:00, so no food slot is offered at 19:30 anyway.
--
-- The two booking functions are patched in place, as 20261016180511_kitchen_pacing_lone_party did:
-- the live definition is read with pg_get_functiondef, the one pacing test line has the new lines
-- put before it, and the result is executed. The block refuses to run unless that line appears
-- exactly once and the new lines not at all, so a definition that has moved on fails loudly instead
-- of being half-patched; a second run is a no-op. CREATE OR REPLACE keeps owner, grants, SECURITY
-- DEFINER and search_path; the grants are restated at the end anyway. Bodies checked against
-- production on 26 October 2026: create_table_booking_core_v06 md5(prosrc)
-- e831d41dc33d4331c09db4570fd85003, check_table_availability_v06 60eccdcfbfabdee9433d84c0bcbd3ef1.
--
-- Depends on 20261026175212_private_hire_occupies_space (private_booking_occupies_space), which must
-- be applied first. Rollback: tasks/kitchen-pacing-hire-event-food/rollback.sql. Tested by
-- scripts/testing/kitchen-pacing-hire-event-food-postgres.py.

ALTER TABLE public.private_bookings
  ADD COLUMN kitchen_covers integer CHECK (kitchen_covers IS NULL OR kitchen_covers >= 0),
  ADD COLUMN kitchen_food_time time without time zone;

COMMENT ON COLUMN public.private_bookings.kitchen_covers IS
  'Covers the kitchen cooks for this hire, counted against online food bookings (D29). Empty: the guest count when the hire has kitchen catering. 0: none.';
COMMENT ON COLUMN public.private_bookings.kitchen_food_time IS
  'When the hire''s food goes out, for kitchen pacing (D29). Empty: the start time.';

ALTER TABLE public.events
  ADD COLUMN food_served boolean NOT NULL DEFAULT false,
  ADD COLUMN kitchen_covers integer CHECK (kitchen_covers IS NULL OR kitchen_covers >= 0),
  ADD COLUMN kitchen_food_time time without time zone;

COMMENT ON COLUMN public.events.food_served IS
  'Guests eat at this event, so its covers count against online food bookings (D29).';
COMMENT ON COLUMN public.events.kitchen_covers IS
  'Covers the kitchen cooks for this event (D29). Empty: one per live ticket.';
COMMENT ON COLUMN public.events.kitchen_food_time IS
  'When the event''s food goes out, for kitchen pacing (D29). Empty: the event start.';

CREATE OR REPLACE FUNCTION public.kitchen_food_loads(p_from date, p_to date)
 RETURNS TABLE(source_kind text, source_id uuid, food_date date, food_time time without time zone, covers integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT loads.source_kind, loads.source_id, loads.food_date, loads.food_time, loads.covers
  FROM (
    SELECT
      'private_booking'::text AS source_kind,
      pb.id AS source_id,
      pb.event_date AS food_date,
      COALESCE(pb.kitchen_food_time, pb.start_time) AS food_time,
      GREATEST(0, COALESCE(
        pb.kitchen_covers,
        pb.guest_count,
        (
          SELECT max(i.quantity)::integer
          FROM public.private_booking_items i
          JOIN public.catering_packages cp ON cp.id = i.package_id
          WHERE i.booking_id = pb.id
            AND i.item_type = 'catering'
            AND cp.pricing_model = 'per_head'
            AND COALESCE(cp.category, 'food') IN ('food', 'addon')
            AND NOT COALESCE(cp.requires_waiver, false)
        ),
        0
      )) AS covers
    FROM public.private_bookings pb
    WHERE pb.event_date BETWEEN p_from AND p_to
      AND public.private_booking_occupies_space(pb.status, pb.deposit_paid_date, pb.hold_expiry, pb.date_tbd)
      AND (
        pb.kitchen_covers IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.private_booking_items i
          LEFT JOIN public.catering_packages cp ON cp.id = i.package_id
          WHERE i.booking_id = pb.id
            AND i.item_type = 'catering'
            AND COALESCE(i.quantity, 0) > 0
            AND (
              i.package_id IS NULL
              OR (COALESCE(cp.category, 'food') IN ('food', 'addon') AND NOT COALESCE(cp.requires_waiver, false))
            )
        )
      )

    UNION ALL

    SELECT
      'event'::text,
      e.id,
      e.date,
      COALESCE(
        e.kitchen_food_time,
        (e.start_datetime AT TIME ZONE 'Europe/London')::time,
        CASE WHEN e.time ~ '^\s*\d{1,2}:\d{2}' THEN substring(e.time FROM '\d{1,2}:\d{2}')::time END
      ),
      GREATEST(0, COALESCE(
        e.kitchen_covers,
        (
          SELECT COALESCE(sum(b.seats), 0)::integer
          FROM public.bookings b
          WHERE b.event_id = e.id
            AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
        )
      ))
    FROM public.events e
    WHERE e.date BETWEEN p_from AND p_to
      AND COALESCE(e.event_status, 'scheduled') NOT IN ('cancelled', 'draft')
      AND (e.food_served OR e.kitchen_covers IS NOT NULL)
  ) loads
  WHERE loads.covers > 0
    AND loads.food_time IS NOT NULL;
$function$;

REVOKE ALL ON FUNCTION public.kitchen_food_loads(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kitchen_food_loads(date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.kitchen_food_load_covers(p_date date, p_from_minutes numeric, p_to_minutes numeric)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Minutes of the day, compared exactly as the pacing check compares a table booking's arrival.
  SELECT COALESCE(sum(l.covers), 0)::integer
  FROM public.kitchen_food_loads(p_date, p_date) l
  WHERE (EXTRACT(HOUR FROM l.food_time)::int * 60 + EXTRACT(MINUTE FROM l.food_time)::int) >= p_from_minutes
    AND (EXTRACT(HOUR FROM l.food_time)::int * 60 + EXTRACT(MINUTE FROM l.food_time)::int) < p_to_minutes;
$function$;

REVOKE ALL ON FUNCTION public.kitchen_food_load_covers(date, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kitchen_food_load_covers(date, numeric, numeric) TO service_role;

DO $patch$
DECLARE
  v_target record;
  v_oid oid;
  v_count integer;
  v_def text;
  v_anchor_hits integer;
  v_added_hits integer;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('create_table_booking_core_v06',
       'IF v_existing_covers > 0 AND v_existing_covers + p_party_size > v_ceiling THEN',
       E'-- Owner decision D29: food at private hires and events that night counts too.\n'
       || E'      v_existing_covers := v_existing_covers\n'
       || E'        + public.kitchen_food_load_covers(p_booking_date, v_center_minutes - v_half, v_center_minutes + v_half);\n'
       || E'\n'
       || E'      '),
      ('check_table_availability_v06',
       'IF v_covers > 0 AND v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN',
       E'-- The date''s own pace and walk-in reserve, as the booking function reads them.\n'
       || E'        v_pace := COALESCE((SELECT sh.kitchen_pace_covers FROM public.special_hours sh WHERE sh.date = p_booking_date), v_pace);\n'
       || E'        v_reserve := COALESCE((SELECT sh.kitchen_walk_in_reserve FROM public.special_hours sh WHERE sh.date = p_booking_date), v_reserve);\n'
       || E'        -- Owner decision D29: food at private hires and events that night counts too.\n'
       || E'        v_covers := v_covers\n'
       || E'          + public.kitchen_food_load_covers(p_booking_date, v_minutes - (v_window / 2.0), v_minutes + (v_window / 2.0));\n'
       || E'\n'
       || E'        ')
    ) AS t(proname, anchor, added)
  LOOP
    SELECT count(*), min(p.oid) INTO v_count, v_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_target.proname;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'kitchen_pacing_hire_event_food: expected one %, found %', v_target.proname, v_count;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_anchor_hits := (length(v_def) - length(replace(v_def, v_target.anchor, ''))) / length(v_target.anchor);
    v_added_hits := (length(v_def) - length(replace(v_def, v_target.added || v_target.anchor, '')))
      / length(v_target.added || v_target.anchor);

    IF v_anchor_hits = 1 AND v_added_hits = 1 THEN
      RAISE NOTICE 'kitchen_pacing_hire_event_food: % already patched, skipped', v_target.proname;
      CONTINUE;
    END IF;

    IF v_anchor_hits <> 1 OR v_added_hits <> 0 THEN
      RAISE EXCEPTION 'kitchen_pacing_hire_event_food: % has % pacing tests and % food lines, expected 1 and 0',
        v_target.proname, v_anchor_hits, v_added_hits;
    END IF;

    EXECUTE replace(v_def, v_target.anchor, v_target.added || v_target.anchor);
    RAISE NOTICE 'kitchen_pacing_hire_event_food: % patched', v_target.proname;
  END LOOP;
END
$patch$;

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) TO service_role;
