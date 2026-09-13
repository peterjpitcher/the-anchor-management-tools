-- Rollback for supabase/migrations/20260912090000_campaign_quiz_prize_claims.sql.
--
-- Puts the content and the content_hash of the six scheduled campaigns back exactly as captured
-- on 12 September 2026, free-drink question and spot prize claims included. Content and
-- fingerprint move together in both directions, so the hash never describes copy that is not
-- there. Guarded the same way: production only, ids plus the md5 and the hash the migration
-- produced, exactly one row per UPDATE, and each row must come back at the md5 and the hash it
-- had before.

DO $rollback$
DECLARE
  v_rows integer;
  v_md5 text;
  v_hash text;
  -- The same phrase pairs as the migration; the rollback swaps new back for old.
  c_quiz_old CONSTANT text := 'Expect general knowledge, music, TV and film, free-drink questions and spot prizes.';
  c_quiz_new CONSTANT text := 'Expect general knowledge, music, TV and film, plus one round in the middle that you play on your phone.';
  c_ofah_old CONSTANT text := 'plus an interactive middle game and spot prizes.';
  c_ofah_new CONSTANT text := 'plus an interactive middle game.';
  c_bingo_old CONSTANT text := 'Expect quick games, spot prizes, a few surprises and plenty of singing along.';
  c_bingo_new CONSTANT text := 'Expect quick games, a few surprises and plenty of singing along.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.marketing_campaigns') IS NULL THEN
    RAISE NOTICE 'campaign_quiz_prize_claims rollback: no marketing_campaigns table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketing_campaigns WHERE id = 'a060c4ef-d4f8-418e-89bd-6da7b3af4976') THEN
    RAISE NOTICE 'campaign_quiz_prize_claims rollback: 16 September quiz campaign absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [C1] Autumn Kick-Off Quiz Night, guests, 16 Sep 2026
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_quiz_new, c_quiz_old)::jsonb,
         content_hash = '2c5fe9e07e27d9ac95a8da8d2fb10bd60dde2b1c02072020cca8259e119986d9'
   WHERE id = 'a060c4ef-d4f8-418e-89bd-6da7b3af4976'
     AND md5(content::text) = '5e0924d3ba925ae80efc5a7b50d2b3f5'
     AND content_hash = '58e129840704dd35593b64453c80f6fafe1afdd6f1a268a7863fa3e0a115d831';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [C1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = 'a060c4ef-d4f8-418e-89bd-6da7b3af4976';
  IF v_md5 IS DISTINCT FROM '6d9c19b0e54202cdca98b4fb2c0e73a5'
     OR v_hash IS DISTINCT FROM '2c5fe9e07e27d9ac95a8da8d2fb10bd60dde2b1c02072020cca8259e119986d9' THEN
    RAISE EXCEPTION 'rollback [C1] did not come back as captured (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C2] Lovely Jubbly Charity Quiz, guests, 25 Sep 2026
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_ofah_new, c_ofah_old)::jsonb,
         content_hash = '01633327eca633a2f923e25421122a0e4d23b2e655af717ab4b597215657ba99'
   WHERE id = '5c3c6be9-5495-461c-9d58-a44d7eecee7b'
     AND md5(content::text) = 'c656c96c4d1561e2866682b316023908'
     AND content_hash = '94bb304423ba121c1fc664afc32041e0b406a5ccca42a684241ab72689f6bfa1';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [C2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '5c3c6be9-5495-461c-9d58-a44d7eecee7b';
  IF v_md5 IS DISTINCT FROM 'd08eb5ef2f8397011df1bdfba6fc0edc'
     OR v_hash IS DISTINCT FROM '01633327eca633a2f923e25421122a0e4d23b2e655af717ab4b597215657ba99' THEN
    RAISE EXCEPTION 'rollback [C2] did not come back as captured (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C3] A Hint of Halloween Quiz Night, guests, 7 Oct 2026
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_quiz_new, c_quiz_old)::jsonb,
         content_hash = '46a63958965152b411633c5ddd76b3990fb74e31f9c285db7564bafc29a45ff8'
   WHERE id = '094d4c3e-69f0-40da-a3fb-64f38b284bdc'
     AND md5(content::text) = '34a637e9a66b3052916a5cd6b3b31879'
     AND content_hash = '693256ee79459fc52a66916ef4da1b77d66d310ecc97d156bcfc8deea1e2d704';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [C3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '094d4c3e-69f0-40da-a3fb-64f38b284bdc';
  IF v_md5 IS DISTINCT FROM '899a4dbd1e36c204bdd3d8f355e220d2'
     OR v_hash IS DISTINCT FROM '46a63958965152b411633c5ddd76b3990fb74e31f9c285db7564bafc29a45ff8' THEN
    RAISE EXCEPTION 'rollback [C3] did not come back as captured (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C4] Sparks & Sparklers Quiz Night, guests, 4 Nov 2026
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_quiz_new, c_quiz_old)::jsonb,
         content_hash = '46a09fde88d18ee55e544653499a09336622a3a2870d3dcad2291775d23998d7'
   WHERE id = '782b1ea2-95ad-4fc8-be4a-954c59bd6664'
     AND md5(content::text) = '7e6530dab542ce446b9e8a578c5a4cb6'
     AND content_hash = '9beefd86bdbdeb7b4efe328d5744cb57556f5dc82f017b1d5bdc0cf6deb95742';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [C4] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '782b1ea2-95ad-4fc8-be4a-954c59bd6664';
  IF v_md5 IS DISTINCT FROM 'ffebb94a4bdb250d847fa5a5dfafc596'
     OR v_hash IS DISTINCT FROM '46a09fde88d18ee55e544653499a09336622a3a2870d3dcad2291775d23998d7' THEN
    RAISE EXCEPTION 'rollback [C4] did not come back as captured (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C5] Sequins & Showstoppers Music Bingo, guests, 13 Nov 2026
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_bingo_new, c_bingo_old)::jsonb,
         content_hash = '39ac425ca0cba18e00f98398b205dd573a578ba35eac2c3f3e4bd7215d194ae7'
   WHERE id = '4fcaadb7-ca98-4aba-a756-8d82b4cb52c0'
     AND md5(content::text) = 'e802e6d3d2ba30f9443fd78595a76cdb'
     AND content_hash = '129678990dd64d68c3768653c097a9a48826df67ee02ed98f6c1082c49566fb1';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [C5] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '4fcaadb7-ca98-4aba-a756-8d82b4cb52c0';
  IF v_md5 IS DISTINCT FROM '0076417eedebeaa6c196e36d13ccc6a6'
     OR v_hash IS DISTINCT FROM '39ac425ca0cba18e00f98398b205dd573a578ba35eac2c3f3e4bd7215d194ae7' THEN
    RAISE EXCEPTION 'rollback [C5] did not come back as captured (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C6] Sleigh My Name Festive Music Bingo, guests, 11 Dec 2026
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_bingo_new, c_bingo_old)::jsonb,
         content_hash = 'c00e6892721c0858c5884b7ab964e6dc15b99c43400f885b9fdfb2f550d38b7a'
   WHERE id = 'c9a5618c-008e-4e7b-b624-d49141cc9f91'
     AND md5(content::text) = '49b0a0541012ee0f47852685cda3b971'
     AND content_hash = '67de53dce385f690324eb61a438f7f3f8908ec5606540be161d868357345f2f1';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [C6] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = 'c9a5618c-008e-4e7b-b624-d49141cc9f91';
  IF v_md5 IS DISTINCT FROM '1aeee9e7e035ac9f9e89ccc43bf3cf7d'
     OR v_hash IS DISTINCT FROM 'c00e6892721c0858c5884b7ab964e6dc15b99c43400f885b9fdfb2f550d38b7a' THEN
    RAISE EXCEPTION 'rollback [C6] did not come back as captured (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  RAISE NOTICE 'campaign_quiz_prize_claims rollback: 6 scheduled campaigns restored, content and content_hash together';
END
$rollback$;
