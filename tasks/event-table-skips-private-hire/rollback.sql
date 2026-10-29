-- Rollback for 20261029082723_event_table_skips_private_hire.sql. Puts create_table_booking_v05
-- back exactly as production held it on 29 October 2026 (md5(prosrc)
-- c94267f14af8e5dac93990def620a424) by replacing each added passage with the original. Refuses to
-- run unless each added passage appears exactly once. Restores the fault: a table-seated event on a
-- night with a private hire is refused online again.

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
$new$          AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
      )
    ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC
    LIMIT 1;
$new$,
$old$          AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
      )
      -- A table a private hire holds is refused by the assignment trigger, so never pick it.
      AND NOT public.is_table_blocked_by_private_booking_v05(t.id, v_booking_start, v_booking_end, NULL)
    ORDER BY t.capacity ASC, COALESCE(t.name, t.table_number) ASC
    LIMIT 1;
$old$),
      (2,
$new$              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          )
      ),
      links AS (
$new$,
$old$              AND public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
          )
          AND NOT public.is_table_blocked_by_private_booking_v05(t.id, v_booking_start, v_booking_end, NULL)
      ),
      links AS (
$old$)
    ) AS t(step, new_text, old_text)
    ORDER BY step
  LOOP
    v_def := pg_get_functiondef(v_oid);
    v_old_hits := (length(v_def) - length(replace(v_def, v_target.old_text, ''))) / length(v_target.old_text);
    v_new_hits := (length(v_def) - length(replace(v_def, v_target.new_text, ''))) / length(v_target.new_text);
    IF v_old_hits <> 1 OR v_new_hits <> 0 THEN
      RAISE EXCEPTION 'event_table_skips_private_hire rollback: step % found % old and % new passages, expected 1 and 0',
        v_target.step, v_old_hits, v_new_hits;
    END IF;
    EXECUTE replace(v_def, v_target.old_text, v_target.new_text);
  END LOOP;
END
$patch$;
