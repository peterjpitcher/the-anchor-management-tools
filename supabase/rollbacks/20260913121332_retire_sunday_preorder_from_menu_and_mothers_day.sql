-- Rollback for supabase/migrations/20260913121332_retire_sunday_preorder_from_menu_and_mothers_day.sql.
--
-- Puts both records back to the text they held before 13 September 2026. Running it republishes a
-- Sunday pre-order claim the owner has confirmed is retired, and a £5 per person deposit that was
-- never the group policy, so there is no operational reason to run it. It exists so the pair is
-- complete and so putting the claim back is a deliberate, recorded act.
--
-- It only touches a row that still holds exactly the text the migration wrote, so it cannot undo
-- an edit somebody has made since.

DO $rollback$
DECLARE
  v_rows integer;
  v_md5 text;
  c_new_event CONSTANT text :=
    'For parties of 15 or more we take a ' || chr(163)
    || '10 per person deposit, and it comes off your bill on the day.';
  c_old_event CONSTANT text :=
    'Pre-orders must be completed by 1pm on Saturday via OpenTable. For parties of up to six, there'
    || chr(8217) || 's no deposit required, while larger groups will need to secure their table with a '
    || chr(163) || '5 per person deposit.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- [P1] menu_menus "Sunday Lunch"
  UPDATE public.menu_menus
     SET description = 'Pre-orderable Sunday lunch menu'
   WHERE id = '6d924a9d-6538-4c11-aa4c-eb2a420e92b6'
     AND md5(description) = '9682c860a567c256c996af5248b0335d';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] rollback expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(description) INTO v_md5 FROM public.menu_menus WHERE id = '6d924a9d-6538-4c11-aa4c-eb2a420e92b6';
  IF v_md5 IS DISTINCT FROM 'fc2b5aab46c40feee43bab91da230bf1' THEN
    RAISE EXCEPTION '[P1] rollback did not restore the original (md5 %)', v_md5;
  END IF;

  -- [P2] events "Mother's Day Lunch", 15 March 2026
  UPDATE public.events
     SET long_description = replace(long_description, c_new_event, c_old_event)
   WHERE id = 'a2be85db-6047-4a69-a065-30913d8df596'
     AND md5(long_description) = 'a1cae05bb7a509558ba025af02e11263';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P2] rollback expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'a2be85db-6047-4a69-a065-30913d8df596';
  IF v_md5 IS DISTINCT FROM '061e69085416d8d19d5bcd34be5336e5' THEN
    RAISE EXCEPTION '[P2] rollback did not restore the original (md5 %)', v_md5;
  END IF;

  RAISE NOTICE 'retire_sunday_preorder rollback: 2 records restored (2 fields)';
END
$rollback$;
