-- Only Fools and Horses charity quiz, 25 September 2026: one phone per player.
--
-- The owner confirmed on 11 September 2026 that the interactive round in the middle of the quiz
-- is played on a phone, one phone per player. The 25 September charity quiz record is the last
-- upcoming one still saying "one phone per team"; the regular quizzes already say player. A guest
-- reading this would leave five of their six phones in a pocket and get the round wrong.
--
-- WHAT CHANGES (1 event, brief and long_description, one phrase each)
--   [P1] 25 September charity quiz:
--     brief:            "- A quick interactive middle game using one phone per team" becomes
--                       "- A quick interactive middle game using one phone per player"
--     long_description: "There will also be a quick interactive game using one phone per team."
--                       becomes the same sentence with "one phone per player".
--
-- LEFT ALONE (searched read-only on 12 September 2026)
--   This event's five FAQs, its highlights, its short description and its meta description say
--   nothing about phones, so nothing else on the record needs changing. The Quiz Night and Music
--   Bingo categories do not carry the phrase either. Four older records do (4 February, 4 March,
--   15 April and 15 May 2026); all four are past events and are left as the historical record.
--
-- HOW IT GUARDS ITSELF
--   One DO block. Two separate IFs for the production marker, because Postgres plans the whole
--   condition and a missing table would error rather than skip. The UPDATE names its row by id
--   and the md5 of both current texts, which are the md5s migration 20260911220000 produced and
--   which production still holds (checked read-only on 12 September 2026). The phrase occurs
--   exactly once in each text. The UPDATE must match exactly one row and both texts must come out
--   at the md5 reviewed then, or the block raises and nothing changes. The events triggers that
--   fire on UPDATE act only on date, time and price, none of which change here.
--
-- Rollback: supabase/rollbacks/20260912091000_charity_quiz_one_phone_per_player.sql

DO $migration$
DECLARE
  v_rows integer;
  v_brief_md5 text;
  v_long_md5 text;
  c_old CONSTANT text := 'one phone per team';
  c_new CONSTANT text := 'one phone per player';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'charity_quiz_one_phone_per_player: no events table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240') THEN
    RAISE NOTICE 'charity_quiz_one_phone_per_player: 25 September charity quiz absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [P1] 25 September Only Fools and Horses charity quiz
  UPDATE public.events
     SET brief = replace(brief, c_old, c_new),
         long_description = replace(long_description, c_old, c_new)
   WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240'
     AND md5(brief) = 'ed69099536d8c8eeb85ff58037d492a9'
     AND md5(long_description) = 'dc6695a3fcf5f29849116172aae73f6f';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240';
  IF v_brief_md5 IS DISTINCT FROM 'a5eb9fc1909b84565266a265836f00e9'
     OR v_long_md5 IS DISTINCT FROM 'cb44d639a5233c18869132f5cbfbe7a4' THEN
    RAISE EXCEPTION '[P1] did not come out as checked (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  RAISE NOTICE 'charity_quiz_one_phone_per_player: 1 event corrected (2 fields)';
END
$migration$;
