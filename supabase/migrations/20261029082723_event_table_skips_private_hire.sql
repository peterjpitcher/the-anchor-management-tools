-- Event table reservations skip tables a private hire has taken.
--
-- Found 29 October 2026 from the daily "Website bookings turned away" report: four website
-- bookings for Sparks & Sparklers Quiz Night (4 November, a table-seated event) were refused
-- with "no_table" on 28 October, with 6 of 60 seats sold. The Dining Room is privately hired
-- that night (18:00 to 23:00), and the event path books its table through the older
-- create_table_booking_v05 (via create_event_table_reservation_v05 and
-- create_table_booking_v05_core). That function picks the smallest free table without asking
-- whether a private hire holds it, so it chose a Dining Room table; the assignment trigger
-- enforce_booking_table_assignment_integrity_v05 then raised table_assignment_private_blocked,
-- and create_event_table_reservation_v05 turned that into 'no_table'. High 4, Low 4a, Low 4b
-- and Small Bay were free all evening. Any table-seated event on a night with a private hire
-- was refused online in the same way.
--
-- Fix: both of create_table_booking_v05's table pickers (single table, then joined tables)
-- leave out a table that is_table_blocked_by_private_booking_v05 says is blocked for the
-- booking's window, which is the same test the trigger applies. A pick the trigger would
-- refuse is no longer made, so nothing that worked before changes.
--
-- Patched in place, as 20261028125055_table_availability_rules_agree did: the live definition
-- is read with pg_get_functiondef, each old passage is replaced, and the block refuses to run
-- unless each old passage appears exactly once and its replacement does not. CREATE OR REPLACE
-- keeps owner, grants, SECURITY DEFINER and search_path. Body checked against production on
-- 29 October 2026, md5(prosrc) c94267f14af8e5dac93990def620a424.
--
-- Live data this changes: none.
-- Rollback: tasks/event-table-skips-private-hire/rollback.sql.

DO $patch$
DECLARE
  v_target record;
  v_oid oid := 'public.create_table_booking_v05(uuid,date,time without time zone,integer,text,text,boolean,text,boolean,boolean,boolean,integer,boolean)'::regprocedure;
  v_def text;
  v_old_hits integer;
  v_new_hits integer;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      (1,
$old$          AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
      )
    ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC
    LIMIT 1;
$old$,
$new$          AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
      )
      -- A table a private hire holds is refused by the assignment trigger, so never pick it.
      AND NOT public.is_table_blocked_by_private_booking_v05(t.id, v_booking_start, v_booking_end, NULL)
    ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC
    LIMIT 1;
$new$),
      (2,
$old$              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          )
      ),
      links AS (
$old$,
$new$              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          )
          AND NOT public.is_table_blocked_by_private_booking_v05(t.id, v_booking_start, v_booking_end, NULL)
      ),
      links AS (
$new$)
    ) AS t(step, old_text, new_text)
    ORDER BY step
  LOOP
    v_def := pg_get_functiondef(v_oid);
    v_old_hits := (length(v_def) - length(replace(v_def, v_target.old_text, ''))) / length(v_target.old_text);
    v_new_hits := (length(v_def) - length(replace(v_def, v_target.new_text, ''))) / length(v_target.new_text);
    IF v_old_hits <> 1 OR v_new_hits <> 0 THEN
      RAISE EXCEPTION 'event_table_skips_private_hire: step % found % old and % new passages, expected 1 and 0',
        v_target.step, v_old_hits, v_new_hits;
    END IF;
    EXECUTE replace(v_def, v_target.old_text, v_target.new_text);
  END LOOP;
END
$patch$;
