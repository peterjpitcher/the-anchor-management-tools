-- Rollback for supabase/migrations/20260913133400_music_bingo_events_name_the_prize.sql.
--
-- Takes the "Winners take home a £25 bar voucher" sentence back out of the three Music Bingo event
-- descriptions. Running it returns the event pages to saying "prizes" without ever saying what a
-- winner gets, which is what the owner asked to fix, so there is no operational reason to run it.
--
-- Each row is only touched if it still hashes to what the migration produced, so it cannot undo a
-- later edit. The sentence is removed by literal, not by pattern, because at this point its exact
-- text is known.

DO $rollback$
DECLARE
  v_rows integer;
  v_md5 text;
  c_add CONSTANT text := ' Winners take home a ' || chr(163)
    || '25 bar voucher, valid on food or drink for one month.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- [P1] Screams & Soundtracks, 16 October
  UPDATE public.events SET long_description = replace(long_description, c_add, '')
   WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac'
     AND md5(long_description) = '9d8e782aa780022cecc6fae48fb0c1ba';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] rollback expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac';
  IF v_md5 IS DISTINCT FROM 'd952121d481b57e6a88a93d5260d6c35' THEN
    RAISE EXCEPTION '[P1] rollback did not restore the original (md5 %)', v_md5;
  END IF;

  -- [P2] Sequins & Showstoppers, 13 November
  UPDATE public.events SET long_description = replace(long_description, c_add, '')
   WHERE id = 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735'
     AND md5(long_description) = '0b1a13fb5e7af13a995bc06daddebb64';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P2] rollback expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735';
  IF v_md5 IS DISTINCT FROM 'df43b0a868c5260aad3d8c3d9ad3b5c5' THEN
    RAISE EXCEPTION '[P2] rollback did not restore the original (md5 %)', v_md5;
  END IF;

  -- [P3] Sleigh My Name, 11 December
  UPDATE public.events SET long_description = replace(long_description, c_add, '')
   WHERE id = '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a'
     AND md5(long_description) = '62974400d061df067e9eb1c6c158bb02';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P3] rollback expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a';
  IF v_md5 IS DISTINCT FROM '1c60c4ecaac450a4146f2edb6bd55434' THEN
    RAISE EXCEPTION '[P3] rollback did not restore the original (md5 %)', v_md5;
  END IF;

  RAISE NOTICE 'music_bingo_event_prize rollback: 3 events restored (3 descriptions)';
END
$rollback$;
