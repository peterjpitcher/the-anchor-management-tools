-- Name the Music Bingo prize on the three event records too, not just in the emails.
--
-- APPLIED to production on 13 September 2026 through the Supabase MCP, which recorded it at
-- version 20260913133400. This file is named after that version, as supabase/migrations/README.md
-- requires, and its SQL below is the statement that ran, minus this note: ledger statement md5
-- 5dd99a625de0d5eb328d88d2da8eef3f, 4,314 bytes.
--
-- Rollback: supabase/rollbacks/20260913133400_music_bingo_events_name_the_prize.sql
--
-- The owner asked on 13 September 2026 for the prize to be mentioned. The campaign emails were
-- corrected in 20260913133224; these are the event records behind the same three nights, which
-- feed the website's event pages and are where most people actually read about the night. All
-- three said "prizes" and none said what a winner gets.
--
-- WHAT CHANGES (3 events, 1 sentence each)
--   One sentence is inserted straight after each description's existing prize sentence:
--     "Winners take home a £25 bar voucher, valid on food or drink for one month."
--   That is the same voucher and the same wording as Quiz Night and as the three campaign emails,
--   so the three places a guest could read about the prize now agree with each other. Nothing else
--   in the descriptions moves, and each gains exactly 75 characters.
--     [P1] c3ac7e18 Screams & Soundtracks, 16 October
--     [P2] c3e9fbbd Sequins & Showstoppers, 13 November
--     [P3] 9b8f85f8 Sleigh My Name, 11 December
--
-- HOW IT GUARDS ITSELF
--   One DO block. Each UPDATE names its event by id and by the md5 of the description it must
--   still hold, read from production on 13 September 2026, and each result is re-read and checked
--   against the md5 previewed then. The insertion point is the first sentence containing "prize",
--   found by pattern rather than by a literal, because these descriptions carry carriage returns
--   and curly apostrophes that a hand-typed literal gets wrong. Each must match exactly one row
--   and come out at the checked md5, or the block raises and nothing changes. A re-run is a no-op
--   that raises, because the old md5 no longer matches.

DO $migration$
DECLARE
  v_rows integer;
  v_md5 text;
  c_add CONSTANT text := ' Winners take home a ' || chr(163)
    || '25 bar voucher, valid on food or drink for one month.';
  c_pat CONSTANT text := '([^.]*[Pp]rize[^.]*\.)';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'music_bingo_event_prize: no events table, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [P1] Screams & Soundtracks, 16 October
  UPDATE public.events
     SET long_description = regexp_replace(long_description, c_pat, '\1' || c_add, '')
   WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac'
     AND md5(long_description) = 'd952121d481b57e6a88a93d5260d6c35';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac';
  IF v_md5 IS DISTINCT FROM '9d8e782aa780022cecc6fae48fb0c1ba' THEN
    RAISE EXCEPTION '[P1] did not come out as checked (md5 %)', v_md5;
  END IF;

  -- [P2] Sequins & Showstoppers, 13 November
  UPDATE public.events
     SET long_description = regexp_replace(long_description, c_pat, '\1' || c_add, '')
   WHERE id = 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735'
     AND md5(long_description) = 'df43b0a868c5260aad3d8c3d9ad3b5c5';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735';
  IF v_md5 IS DISTINCT FROM '0b1a13fb5e7af13a995bc06daddebb64' THEN
    RAISE EXCEPTION '[P2] did not come out as checked (md5 %)', v_md5;
  END IF;

  -- [P3] Sleigh My Name, 11 December
  UPDATE public.events
     SET long_description = regexp_replace(long_description, c_pat, '\1' || c_add, '')
   WHERE id = '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a'
     AND md5(long_description) = '1c60c4ecaac450a4146f2edb6bd55434';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a';
  IF v_md5 IS DISTINCT FROM '62974400d061df067e9eb1c6c158bb02' THEN
    RAISE EXCEPTION '[P3] did not come out as checked (md5 %)', v_md5;
  END IF;

  RAISE NOTICE 'music_bingo_event_prize: 3 events corrected (3 descriptions)';
END
$migration$;
