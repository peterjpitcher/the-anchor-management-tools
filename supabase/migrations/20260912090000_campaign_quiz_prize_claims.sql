-- Scheduled marketing emails: quiz and Music Bingo prize claims, 12 September 2026.
--
-- The owner confirmed on 11 September 2026 that quiz night has five rounds, one of which is an
-- interactive round in the middle played on a phone, one phone per player, and that the only
-- prizes are a £25 bar voucher for first place and a bottle of wine for second from last. There
-- are no free-drink questions, no spot prizes, no league tables and no quiz food deals. Music
-- Bingo winners get a £25 voucher and Music Bingo has no spot prizes either; fancy dress earning
-- extra points is real and stays. Cash Bingo does have free drink rounds and £10 food vouchers,
-- so Cash Bingo copy is deliberately untouched.
--
-- Migration 20260911220000 fixed the event records. Six scheduled marketing emails still carry
-- the retired claims, the first of them sending at 12:00 London on Monday 14 September. The
-- owner approved these exact wordings on 12 September 2026.
--
-- WHAT CHANGES (6 scheduled campaigns, content and content_hash only)
--   [C1] 16 Sep quiz (sends 14 Sep 12:00), [C3] 7 Oct quiz (sends 30 Sep 09:00) and
--     [C4] 4 Nov quiz (sends 28 Oct 09:00):
--       "Expect general knowledge, music, TV and film, free-drink questions and spot prizes."
--       becomes
--       "Expect general knowledge, music, TV and film, plus one round in the middle that you
--        play on your phone."
--   [C2] 25 Sep Only Fools and Horses charity quiz (sends 18 Sep 12:00):
--       "plus an interactive middle game and spot prizes." becomes
--       "plus an interactive middle game."
--   [C5] 13 Nov Music Bingo (sends 6 Nov 12:00) and [C6] 11 Dec Music Bingo (sends 4 Dec 12:00):
--       "Expect quick games, spot prizes, a few surprises and plenty of singing along." becomes
--       "Expect quick games, a few surprises and plenty of singing along."
--
-- WHY content_hash MOVES WITH THE COPY
--   A scheduled campaign is locked and carries content_hash, the sha256 of its parsed content
--   with keys sorted (computeContentHash in src/services/marketing-campaigns.ts). It is what
--   proves, after the fact, that the bytes which went out are the bytes a human signed off.
--   Leaving it on the old copy would make the fingerprint a lie, so each new hash was computed
--   offline with that same function over the corrected content and is written here beside it.
--   Every stored hash was first reproduced from its stored content, so the method is proven
--   before it is trusted.
--
-- LEFT ALONE (all 21 scheduled campaigns searched read-only on 12 September 2026)
--   No subject or preheader carries any of these phrases, so none is touched. Cash Bingo's
--   "a mixture of prizes", the Music Bingo "Expect prizes" line on 16 October, the correct
--   £25 bar voucher and bottle of wine lines, and the November round-ups' "£25 bar voucher for
--   whoever comes out on top" are all true and stay. Nothing scheduled mentions a league table,
--   a quiz food deal or one phone per team. status, scheduled_for, audience,
--   approved_recipient_count and link_map are not touched by any statement here.
--
-- HOW IT GUARDS ITSELF
--   One DO block, so all of it applies or none of it. Two separate IFs for the production
--   marker, because Postgres plans the whole condition and a missing table would error rather
--   than skip. Every UPDATE names its row by id, the md5 of the current content text and the
--   current content_hash, and each replaced phrase occurs exactly once in that content (checked
--   read-only on 12 September 2026). Each UPDATE must match exactly one row, and the result must
--   reach the md5 and the hash reviewed then, or the block raises and nothing changes. The only
--   trigger on this table sets updated_at.
--
--   The send path never reads content_hash: the cron selects id, subject, content, link_map and
--   utm_campaign, and no database function references the column at all. Changing it cannot
--   block Monday's send.
--
-- Rollback: supabase/rollbacks/20260912090000_campaign_quiz_prize_claims.sql

DO $migration$
DECLARE
  v_rows integer;
  v_md5 text;
  v_hash text;
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
    RAISE NOTICE 'campaign_quiz_prize_claims: no marketing_campaigns table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.marketing_campaigns WHERE id = 'a060c4ef-d4f8-418e-89bd-6da7b3af4976') THEN
    RAISE NOTICE 'campaign_quiz_prize_claims: 16 September quiz campaign absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [C1] Autumn Kick-Off Quiz Night, guests, 16 Sep 2026 (sends 14 Sep 12:00 London)
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_quiz_old, c_quiz_new)::jsonb,
         content_hash = '58e129840704dd35593b64453c80f6fafe1afdd6f1a268a7863fa3e0a115d831'
   WHERE id = 'a060c4ef-d4f8-418e-89bd-6da7b3af4976'
     AND md5(content::text) = '6d9c19b0e54202cdca98b4fb2c0e73a5'
     AND content_hash = '2c5fe9e07e27d9ac95a8da8d2fb10bd60dde2b1c02072020cca8259e119986d9';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[C1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = 'a060c4ef-d4f8-418e-89bd-6da7b3af4976';
  IF v_md5 IS DISTINCT FROM '5e0924d3ba925ae80efc5a7b50d2b3f5'
     OR v_hash IS DISTINCT FROM '58e129840704dd35593b64453c80f6fafe1afdd6f1a268a7863fa3e0a115d831' THEN
    RAISE EXCEPTION '[C1] did not come out as checked (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C2] Lovely Jubbly Charity Quiz, guests, 25 Sep 2026 (sends 18 Sep 12:00 London)
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_ofah_old, c_ofah_new)::jsonb,
         content_hash = '94bb304423ba121c1fc664afc32041e0b406a5ccca42a684241ab72689f6bfa1'
   WHERE id = '5c3c6be9-5495-461c-9d58-a44d7eecee7b'
     AND md5(content::text) = 'd08eb5ef2f8397011df1bdfba6fc0edc'
     AND content_hash = '01633327eca633a2f923e25421122a0e4d23b2e655af717ab4b597215657ba99';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[C2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '5c3c6be9-5495-461c-9d58-a44d7eecee7b';
  IF v_md5 IS DISTINCT FROM 'c656c96c4d1561e2866682b316023908'
     OR v_hash IS DISTINCT FROM '94bb304423ba121c1fc664afc32041e0b406a5ccca42a684241ab72689f6bfa1' THEN
    RAISE EXCEPTION '[C2] did not come out as checked (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C3] A Hint of Halloween Quiz Night, guests, 7 Oct 2026 (sends 30 Sep 09:00 London)
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_quiz_old, c_quiz_new)::jsonb,
         content_hash = '693256ee79459fc52a66916ef4da1b77d66d310ecc97d156bcfc8deea1e2d704'
   WHERE id = '094d4c3e-69f0-40da-a3fb-64f38b284bdc'
     AND md5(content::text) = '899a4dbd1e36c204bdd3d8f355e220d2'
     AND content_hash = '46a63958965152b411633c5ddd76b3990fb74e31f9c285db7564bafc29a45ff8';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[C3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '094d4c3e-69f0-40da-a3fb-64f38b284bdc';
  IF v_md5 IS DISTINCT FROM '34a637e9a66b3052916a5cd6b3b31879'
     OR v_hash IS DISTINCT FROM '693256ee79459fc52a66916ef4da1b77d66d310ecc97d156bcfc8deea1e2d704' THEN
    RAISE EXCEPTION '[C3] did not come out as checked (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C4] Sparks & Sparklers Quiz Night, guests, 4 Nov 2026 (sends 28 Oct 09:00 London)
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_quiz_old, c_quiz_new)::jsonb,
         content_hash = '9beefd86bdbdeb7b4efe328d5744cb57556f5dc82f017b1d5bdc0cf6deb95742'
   WHERE id = '782b1ea2-95ad-4fc8-be4a-954c59bd6664'
     AND md5(content::text) = 'ffebb94a4bdb250d847fa5a5dfafc596'
     AND content_hash = '46a09fde88d18ee55e544653499a09336622a3a2870d3dcad2291775d23998d7';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[C4] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '782b1ea2-95ad-4fc8-be4a-954c59bd6664';
  IF v_md5 IS DISTINCT FROM '7e6530dab542ce446b9e8a578c5a4cb6'
     OR v_hash IS DISTINCT FROM '9beefd86bdbdeb7b4efe328d5744cb57556f5dc82f017b1d5bdc0cf6deb95742' THEN
    RAISE EXCEPTION '[C4] did not come out as checked (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C5] Sequins & Showstoppers Music Bingo, guests, 13 Nov 2026 (sends 6 Nov 12:00 London)
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_bingo_old, c_bingo_new)::jsonb,
         content_hash = '129678990dd64d68c3768653c097a9a48826df67ee02ed98f6c1082c49566fb1'
   WHERE id = '4fcaadb7-ca98-4aba-a756-8d82b4cb52c0'
     AND md5(content::text) = '0076417eedebeaa6c196e36d13ccc6a6'
     AND content_hash = '39ac425ca0cba18e00f98398b205dd573a578ba35eac2c3f3e4bd7215d194ae7';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[C5] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = '4fcaadb7-ca98-4aba-a756-8d82b4cb52c0';
  IF v_md5 IS DISTINCT FROM 'e802e6d3d2ba30f9443fd78595a76cdb'
     OR v_hash IS DISTINCT FROM '129678990dd64d68c3768653c097a9a48826df67ee02ed98f6c1082c49566fb1' THEN
    RAISE EXCEPTION '[C5] did not come out as checked (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  -- [C6] Sleigh My Name Festive Music Bingo, guests, 11 Dec 2026 (sends 4 Dec 12:00 London)
  UPDATE public.marketing_campaigns
     SET content = replace(content::text, c_bingo_old, c_bingo_new)::jsonb,
         content_hash = '67de53dce385f690324eb61a438f7f3f8908ec5606540be161d868357345f2f1'
   WHERE id = 'c9a5618c-008e-4e7b-b624-d49141cc9f91'
     AND md5(content::text) = '1aeee9e7e035ac9f9e89ccc43bf3cf7d'
     AND content_hash = 'c00e6892721c0858c5884b7ab964e6dc15b99c43400f885b9fdfb2f550d38b7a';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[C6] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(content::text), content_hash INTO v_md5, v_hash FROM public.marketing_campaigns WHERE id = 'c9a5618c-008e-4e7b-b624-d49141cc9f91';
  IF v_md5 IS DISTINCT FROM '49b0a0541012ee0f47852685cda3b971'
     OR v_hash IS DISTINCT FROM '67de53dce385f690324eb61a438f7f3f8908ec5606540be161d868357345f2f1' THEN
    RAISE EXCEPTION '[C6] did not come out as checked (content md5 %, content_hash %)', v_md5, v_hash;
  END IF;

  RAISE NOTICE 'campaign_quiz_prize_claims: 6 scheduled campaigns corrected, content and content_hash together';
END
$migration$;
