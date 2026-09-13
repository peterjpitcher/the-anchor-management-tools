-- Retire the last two Sunday pre-order claims left in the database.
--
-- APPLIED to production on 13 September 2026 through the Supabase MCP, which recorded it at
-- version 20260913121332. This file is named after that version, as supabase/migrations/README.md
-- requires, and its SQL below is the statement that ran, minus this note: ledger statement md5
-- 0d64dd3c5d5c57752712ae788a715406, 4,795 bytes.
--
-- Rollback: supabase/rollbacks/20260913121332_retire_sunday_preorder_from_menu_and_mothers_day.sql
--
-- The owner confirmed on 13 September 2026 that there is no Sunday pre-order any more, so the
-- house-style rule was widened to catch the claim in any wording. Sweeping every text column of
-- every public table with the widened pattern found exactly two live records still making it.
-- Everything else that matched was an internal identifier (cron job names, template keys, rate
-- limit keys), a guest's own words in special_requirements, or an email or text already sent,
-- none of which is rewritten. The website itself was checked page by page and only ever denies
-- the pre-order, so nothing there needs changing.
--
-- WHAT CHANGES (2 rows, 2 fields)
--   [P1] menu_menus "Sunday Lunch" (6d924a9d), description, is_active true:
--     from "Pre-orderable Sunday lunch menu"
--       to "Our Sunday roast menu."
--     It says less because there is less to say: the menu's name already carries the day, and any
--     claim about how to get one belongs on the page, which states the walk-in correctly.
--
--   [P2] events "Mother's Day Lunch", 15 March 2026 (a2be85db), long_description. The page is
--     still live at /events/mothers-day-lunch-2026-03-15 and was serving both retired claims:
--     from "Pre-orders must be completed by 1pm on Saturday via OpenTable. For parties of up to
--          six, there's no deposit required, while larger groups will need to secure their table
--          with a £5 per person deposit."
--       to "For parties of 15 or more we take a £10 per person deposit, and it comes off your
--          bill on the day."
--     The pre-order, the Saturday cutoff and the £5 head charge all went at the 17 May 2026
--     walk-in launch. The replacement is the group deposit as the SSOT actually records it: 15 or
--     more, £10 a head, deducted from the bill. The OpenTable reference goes with it rather than
--     being restated, because no other live record names it as a booking route.
--
-- HOW IT GUARDS ITSELF
--   One DO block, each row named by id and by the md5 of its current text, both read from
--   production on 13 September 2026. Each UPDATE must match exactly one row and each field must
--   come out at the md5 checked here, or the block raises and nothing changes. The event edit
--   replaces one occurrence of a substring that was confirmed to appear exactly once. A re-run is
--   a no-op that raises, because the old md5 no longer matches.

DO $migration$
DECLARE
  v_rows integer;
  v_md5 text;
  c_old_event CONSTANT text :=
    'Pre-orders must be completed by 1pm on Saturday via OpenTable. For parties of up to six, there'
    || chr(8217) || 's no deposit required, while larger groups will need to secure their table with a '
    || chr(163) || '5 per person deposit.';
  c_new_event CONSTANT text :=
    'For parties of 15 or more we take a ' || chr(163)
    || '10 per person deposit, and it comes off your bill on the day.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.menu_menus') IS NULL THEN
    RAISE NOTICE 'retire_sunday_preorder: no menu_menus table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'retire_sunday_preorder: no events table, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [P1] the Sunday Lunch menu subtitle
  UPDATE public.menu_menus
     SET description = 'Our Sunday roast menu.'
   WHERE id = '6d924a9d-6538-4c11-aa4c-eb2a420e92b6'
     AND md5(description) = 'fc2b5aab46c40feee43bab91da230bf1';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(description) INTO v_md5 FROM public.menu_menus WHERE id = '6d924a9d-6538-4c11-aa4c-eb2a420e92b6';
  IF v_md5 IS DISTINCT FROM '9682c860a567c256c996af5248b0335d' THEN
    RAISE EXCEPTION '[P1] did not come out as checked (md5 %)', v_md5;
  END IF;

  -- [P2] the Mother's Day 2026 description, still on a live page
  UPDATE public.events
     SET long_description = replace(long_description, c_old_event, c_new_event)
   WHERE id = 'a2be85db-6047-4a69-a065-30913d8df596'
     AND md5(long_description) = '061e69085416d8d19d5bcd34be5336e5';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'a2be85db-6047-4a69-a065-30913d8df596';
  IF v_md5 IS DISTINCT FROM 'a1cae05bb7a509558ba025af02e11263' THEN
    RAISE EXCEPTION '[P2] did not come out as checked (md5 %)', v_md5;
  END IF;

  RAISE NOTICE 'retire_sunday_preorder: 2 records corrected (2 fields)';
END
$migration$;
