-- Rollback for 20261026202026_whole_pub_hire_stops_ticket_sales.sql: takes the whole-pub hire check
-- back out of create_event_booking_v05, leaving its body exactly as production held it on 26 October
-- 2026 (md5(prosrc) b902aaf91f8a4aad7f318bebd57c9463), then drops the function it called.

DO $patch$
DECLARE
  v_oid oid;
  v_count integer;
  v_def text;
  v_anchor constant text := E'  IF COALESCE(v_event.booking_open, true) = false THEN\n'
    || E'    RETURN jsonb_build_object(''state'', ''blocked'', ''reason'', ''booking_closed'');\n'
    || E'  END IF;\n';
  v_added constant text := E'\n'
    || E'  -- Owner decision D24 (customer bookings review, 24 October 2026): a whole-pub private hire\n'
    || E'  -- stops ticket sales for an event it overlaps. The guest is told booking has closed.\n'
    || E'  IF EXISTS (SELECT 1 FROM public.events_closed_by_whole_pub_hire(ARRAY[p_event_id])) THEN\n'
    || E'    RETURN jsonb_build_object(''state'', ''blocked'', ''reason'', ''booking_closed'');\n'
    || E'  END IF;\n';
  v_hits integer;
BEGIN
  SELECT count(*), min(p.oid) INTO v_count, v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_event_booking_v05';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'rollback: expected one create_event_booking_v05, found %', v_count;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_hits := (length(v_def) - length(replace(v_def, v_anchor || v_added, ''))) / length(v_anchor || v_added);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'rollback: create_event_booking_v05 has % patched checks, expected 1', v_hits;
  END IF;

  EXECUTE replace(v_def, v_anchor || v_added, v_anchor);
END
$patch$;

REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid, uuid, integer, text, text) TO service_role;

DROP FUNCTION public.events_closed_by_whole_pub_hire(uuid[], uuid);
