-- Kitchen pacing is food-only. Patch the existing function in place so this
-- also fixes databases where the original pacing migration already ran.
DO $migration$
DECLARE
  v_function oid := to_regprocedure(
    'public.create_table_booking_v05(uuid,date,time without time zone,integer,text,text,boolean,text,boolean,boolean,boolean,integer,boolean)'
  )::oid;
  v_definition text;
  v_old_guard constant text := 'IF NOT COALESCE(p_bypass_pacing, false) THEN';
  v_new_guard constant text := 'IF v_purpose = ''food'' AND NOT COALESCE(p_bypass_pacing, false) THEN';
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'create_table_booking_v05 runtime function was not found';
  END IF;

  v_definition := pg_get_functiondef(v_function);

  IF position(v_new_guard IN v_definition) > 0 THEN
    RETURN;
  END IF;

  IF position(v_old_guard IN v_definition) = 0 THEN
    RAISE EXCEPTION 'create_table_booking_v05 pacing guard was not found';
  END IF;

  EXECUTE replace(v_definition, v_old_guard, v_new_guard);
END
$migration$;
