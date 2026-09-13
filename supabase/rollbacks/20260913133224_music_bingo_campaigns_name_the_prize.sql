-- Rollback for supabase/migrations/20260913133224_music_bingo_campaigns_name_the_prize.sql.
--
-- Removes the Prize row from the three Music Bingo fact strips and puts each campaign's
-- content_hash back to the value it carried before. Running it returns the emails to saying only
-- "Expect prizes" without naming the £25 bar voucher, which is what the owner asked to fix, so
-- there is no operational reason to run it.
--
-- Each campaign is only touched if it still holds exactly the hash the migration wrote and its
-- second fact-strip row is still the Prize row this added, so it cannot undo a later edit or strip
-- a row somebody else put there.

DO $rollback$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- [P1] Screams & Soundtracks, 16 October
  UPDATE public.marketing_campaigns
     SET content = content #- '{blocks,3,data,rows,1}',
         content_hash = '2220aa760191fa50cf3a9ec1fbaa6ce29712fffbbd14d16925d97183aeab597a',
         updated_at = now()
   WHERE id = '3edae0f3-42a5-437d-b6e6-a747ba2f9ab6'
     AND content_hash = 'd4fef38371de2fb2b916cbc27183902ab056c4ca80fa6c9ed7ecf2d7be4a90c8'
     AND content->'blocks'->3->'data'->'rows'->1->>'label' = 'Prize';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] rollback expected 1 row(s), matched %', v_rows; END IF;

  -- [P2] Sequins & Showstoppers, 13 November
  UPDATE public.marketing_campaigns
     SET content = content #- '{blocks,3,data,rows,1}',
         content_hash = '129678990dd64d68c3768653c097a9a48826df67ee02ed98f6c1082c49566fb1',
         updated_at = now()
   WHERE id = '4fcaadb7-ca98-4aba-a756-8d82b4cb52c0'
     AND content_hash = 'a8659df5b8e87169430d4729478bcd1ced9d3d4c6f2e8922cb5f47446e613682'
     AND content->'blocks'->3->'data'->'rows'->1->>'label' = 'Prize';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P2] rollback expected 1 row(s), matched %', v_rows; END IF;

  -- [P3] Sleigh My Name, 11 December
  UPDATE public.marketing_campaigns
     SET content = content #- '{blocks,3,data,rows,1}',
         content_hash = '67de53dce385f690324eb61a438f7f3f8908ec5606540be161d868357345f2f1',
         updated_at = now()
   WHERE id = 'c9a5618c-008e-4e7b-b624-d49141cc9f91'
     AND content_hash = '198436d09d7168825a5c45ff041c8845eebc1e213e2b790ffa0c6f8880769689'
     AND content->'blocks'->3->'data'->'rows'->1->>'label' = 'Prize';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P3] rollback expected 1 row(s), matched %', v_rows; END IF;

  RAISE NOTICE 'music_bingo_prize rollback: 3 campaigns restored (3 fact-strip rows, 3 content hashes)';
END
$rollback$;
