-- Sunday lunch service message: stop it printing a claim the SSOT retired on 17 May 2026.
--
-- APPLIED to production on 13 September 2026 through the Supabase MCP, which recorded it at
-- version 20260913110049. This file is named after that version, as supabase/migrations/README.md
-- requires, so `db push` sees it as done rather than re-running a block that would raise. The
-- ledger's statement is this file with the comment block above the DO condensed: md5
-- 8d5cfee99ed1a7e06f4622dceab3999a, 2,567 bytes. The DO block itself is identical.
--
-- `service_statuses.sunday_lunch.message` still reads "Sunday lunch bookings require pre-order
-- with £5 per person deposit by 1pm Saturday." It was last written on 4 November 2025. The
-- website's SSOT (§4, §14) retired all three of those facts at the 17 May 2026 walk-in launch:
-- there is no pre-order, no Saturday cutoff and no per-roast prepayment. Sunday roast is served
-- 1pm to 6pm and is blocked only when the kitchen is closed for that date.
--
-- The message is dormant today because `is_enabled` is true and the site prints it only on a
-- Sunday where the service is unavailable (WeekHours.tsx and BusinessHours.tsx read
-- `serviceStatus.sunday_lunch.message` from GET /business/hours and render it as the note beside
-- that Sunday's hours). So one toggle in the business-hours settings would put a banned claim on
-- the live homepage. Replacing the text now removes that.
--
-- WHAT CHANGES (1 row, 1 message)
--   [P1] service_statuses.sunday_lunch:
--     from "Sunday lunch bookings require pre-order with £5 per person deposit by 1pm Saturday."
--       to "We're not serving Sunday roast on this date. Call us on 01753 682707 if you'd like to
--           know more."
--     `updated_at` moves to now(), because this table has no touch trigger and the API returns
--     the column as `updatedAt`; leaving it at 4 November 2025 would state the wrong thing.
--
-- WHY THIS WORDING
--   The message only ever renders while the service is switched off, so it has to be true in that
--   state and in no other. It says the two things the SSOT supports: the roast is not being served
--   on that date, and the venue number is 01753 682707 (§2). It names no reason, no return date and
--   no alternative, because the SSOT records none. It sits beside the date in both components, so
--   "on this date" always has a date next to it. Checked against houseStyleErrors()
--   (src/lib/copy/house-style.ts) on 13 September 2026: no errors and no warnings, and no em dash.
--
-- LEFT ALONE (searched read-only on 13 September 2026)
--   `is_enabled` stays true: Sunday roast is being served, and switching a service off is an
--   operational decision for the owner, not a migration. `display_name` and `metadata` are correct.
--   `service_status_overrides` carries its own per-date message and holds no row for sunday_lunch.
--   The house-style checker does not catch the old text (it looks for "Sunday roast" beside
--   "pre-order", and this row says "Sunday lunch" and "1pm Saturday"), which is how the claim
--   survived; widening that rule is a separate change and is not made here.
--
-- HOW IT GUARDS ITSELF
--   One DO block. Two separate IFs for the production marker, because Postgres plans the whole
--   condition and a missing table would error rather than skip. The UPDATE names its row by
--   service_code and by the md5 of the current message, which is the md5 production still holds
--   (checked read-only on 13 September 2026). It must match exactly one row and the message must
--   come out at the md5 reviewed then, or the block raises and nothing changes. Re-running it is a
--   no-op that raises, because the old md5 no longer matches. service_statuses has no triggers and
--   no dependent views, so nothing else moves.
--
-- Rollback: supabase/rollbacks/20260913110049_sunday_lunch_service_message_walk_in_launch.sql

DO $migration$
DECLARE
  v_rows integer;
  v_message_md5 text;
  c_new CONSTANT text :=
    'We''re not serving Sunday roast on this date. Call us on 01753 682707 if you''d like to know more.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.service_statuses') IS NULL THEN
    RAISE NOTICE 'sunday_lunch_service_message: no service_statuses table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.service_statuses WHERE service_code = 'sunday_lunch') THEN
    RAISE NOTICE 'sunday_lunch_service_message: no sunday_lunch row, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [P1] the message the site shows when Sunday roast is unavailable
  UPDATE public.service_statuses
     SET message = c_new,
         updated_at = now()
   WHERE service_code = 'sunday_lunch'
     AND md5(message) = 'f62c68e8ef33c5da4ecd9c921eeb49ef';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(message) INTO v_message_md5 FROM public.service_statuses WHERE service_code = 'sunday_lunch';
  IF v_message_md5 IS DISTINCT FROM 'ba684d021cc130948200880718f83cd5' THEN
    RAISE EXCEPTION '[P1] did not come out as checked (message md5 %)', v_message_md5;
  END IF;

  RAISE NOTICE 'sunday_lunch_service_message: 1 service status corrected (1 field)';
END
$migration$;
