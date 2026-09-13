-- New Year's Eve 2026 closes at 1am.
--
-- The owner confirmed on 11 September 2026 that the pub stays open until 1am on New Year's Eve,
-- as the website's docs/SSOT.md has said since 16 August 2026. The special_hours row for
-- 2026-12-31 (created 7 September 2026 with the festive kitchen closures) closes at 22:00, so from
-- about 2 October the site's live hours would have shown 10pm while /new-years-eve says 1am.
--
-- A close after midnight is stored as a close time earlier than the opening time, so 1am is
-- 01:00. The booking functions, checklists, FOH schedule, rota and the website's hours display and
-- slot builder already read that correctly; the management API's live "open now" status was fixed
-- to read the previous day's late close in commits 58f8f09e and c0a99cc4, deployed before this.
--
-- Only the closing time changes. The kitchen stays closed as the row has it, and its sittings,
-- note and the 1 January closed row are untouched.
--
-- Guards: one DO block; nothing happens where the table or the row is absent (any database but
-- production); on production the row must be exactly as captured on 11 September 2026, or the
-- block raises and nothing changes.
--
-- Rollback: supabase/rollbacks/20260911210000_nye_close_1am.sql

DO $migration$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.special_hours') IS NULL THEN
    RAISE NOTICE 'nye_close_1am: no special_hours table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.special_hours WHERE id = '4a689baa-34c3-4586-8d0a-6a892f58fd47') THEN
    RAISE NOTICE 'nye_close_1am: the 31 December 2026 row is absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  UPDATE public.special_hours
     SET closes = '01:00:00'::time
   WHERE id = '4a689baa-34c3-4586-8d0a-6a892f58fd47'
     AND date = '2026-12-31'
     AND opens = '12:00:00'::time
     AND closes = '22:00:00'::time
     AND is_closed = false
     AND is_kitchen_closed = true
     AND kitchen_opens IS NULL
     AND kitchen_closes IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'nye_close_1am: expected 1 row as captured, matched %', v_rows; END IF;

  RAISE NOTICE 'nye_close_1am: 31 December 2026 now closes at 01:00';
END
$migration$;
