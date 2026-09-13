-- Quiz prize claims, 11 September 2026.
--
-- The owner confirmed on 11 September 2026 that quiz night has five rounds, with one interactive
-- phone-based round in the middle, and prizes for first place and second from last only: the £25
-- bar voucher and the bottle of wine. There are no free drink questions, spot prizes, league
-- tables or quiz food deals. The upcoming quiz records still promised closest-wins free drink
-- questions, free drinks and spot prizes. This removes those claims with the smallest edit and
-- changes nothing else: the phone mini challenge (the interactive middle round), the £25 bar
-- voucher and the bottle of wine all stay.
--
-- WHAT CHANGES (5 quiz events, one row each, brief and long_description only)
--   [Q1] 16 September, [Q3] 7 October, [Q4] 4 November, [Q5] 2 December briefs:
--     "with quick-fire moments, free drink questions, spot prizes, surprises and the kind of
--     atmosphere" becomes "with quick-fire moments, surprises and the kind of atmosphere".
--     "A **closest-wins free drink question in every round**, a mini challenge using **one phone
--     per player**, spot prizes and plenty of friendly rivalry." becomes "A mini challenge using
--     **one phone per player** and plenty of friendly rivalry."
--     The paragraph "There are also closest-wins free drinks and spot prizes throughout the
--     night." goes.
--   [Q1] 16 September long description: "think fast-paced questions, a closest-wins free drink
--     question in each round, and spot prizes to keep everyone on their toes" becomes "think
--     fast-paced questions to keep everyone on their toes".
--   [Q3] [Q4] [Q5] long descriptions: "Expect quick-fire moments, a closest-wins free drink
--     question in every round, a one-phone-per-player mini challenge and spot prizes." becomes
--     "Expect quick-fire moments and a one-phone-per-player mini challenge."
--   [Q2] 25 September brief: the prize bullet "- Spot prizes and free drinks during the night"
--     goes. Its long description: "The winning team will receive a £25 bar voucher,
--     second-to-last place will receive a bottle of wine, and there will be spot prizes and free
--     drinks during the night." becomes "The winning team will receive a £25 bar voucher, and
--     second-to-last place will receive a bottle of wine."
--
-- LEFT ALONE (searched read-only on 11 September 2026)
--   The FAQs of these events and the Quiz Night and Music Bingo categories make none of these
--   claims, and nothing upcoming in either category mentions league tables or food deals. Music
--   Bingo records mention prizes only in general terms. The 25 September quiz lists four themed
--   rounds plus the interactive middle game, which makes five. Other categories are not touched.
--
-- HOW IT GUARDS ITSELF
--   One DO block, so all of it applies or none of it. On a database without the christmas-2026
--   booking period it raises a NOTICE and changes nothing. Every UPDATE names its row by id and
--   the md5 of both current texts, in which each replaced phrase occurs exactly once (checked
--   read-only on 11 September 2026). Each UPDATE must match exactly one row, and both texts must
--   come out at the md5 reviewed then, or the block raises and nothing changes. The events
--   triggers that fire on UPDATE act only on date, time and price, none of which change here.
--
-- Rollback: supabase/rollbacks/20260911220000_quiz_prize_claims.sql

DO $migration$
DECLARE
  v_rows integer;
  v_brief_md5 text;
  v_long_md5 text;
  -- The standard quiz brief (16 September, 7 October, 4 November, 2 December)
  c_b1_old CONSTANT text := 'with quick-fire moments, free drink questions, spot prizes, surprises and the kind of atmosphere';
  c_b1_new CONSTANT text := 'with quick-fire moments, surprises and the kind of atmosphere';
  c_b2_old CONSTANT text := 'A **closest-wins free drink question in every round**, a mini challenge using **one phone per player**, spot prizes and plenty of friendly rivalry.';
  c_b2_new CONSTANT text := 'A mini challenge using **one phone per player** and plenty of friendly rivalry.';
  c_b3_old CONSTANT text := 'deserves rewarding too.' || E'\r\n\r\n' || 'There are also closest-wins free drinks and spot prizes throughout the night.' || E'\r\n\r\n' || '**House rules**';
  c_b3_new CONSTANT text := 'deserves rewarding too.' || E'\r\n\r\n' || '**House rules**';
  -- The standard quiz long description (7 October, 4 November, 2 December)
  c_l1_old CONSTANT text := 'Expect quick-fire moments, a closest-wins free drink question in every round, a one-phone-per-player mini challenge and spot prizes.';
  c_l1_new CONSTANT text := 'Expect quick-fire moments and a one-phone-per-player mini challenge.';
  -- The 16 September long description
  c_l16_old CONSTANT text := 'think fast-paced questions, a closest-wins free drink question in each round, and spot prizes to keep everyone on their toes';
  c_l16_new CONSTANT text := 'think fast-paced questions to keep everyone on their toes';
  -- The 25 September brief and long description
  c_c1_old CONSTANT text := '- **Second-to-last place:** bottle of wine' || E'\r\n' || '- Spot prizes and free drinks during the night' || E'\r\n';
  c_c1_new CONSTANT text := '- **Second-to-last place:** bottle of wine' || E'\r\n';
  c_c2_old CONSTANT text := 'bar voucher, second-to-last place will receive a bottle of wine, and there will be spot prizes and free drinks during the night.';
  c_c2_new CONSTANT text := 'bar voucher, and second-to-last place will receive a bottle of wine.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.booking_periods') IS NULL THEN
    RAISE NOTICE 'quiz_prize_claims: no booking_periods table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = '8a4535ee-9547-4672-b20a-489457b46376') THEN
    RAISE NOTICE 'quiz_prize_claims: christmas-2026 booking period absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [Q1] 16 September quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b1_old, c_b1_new), c_b2_old, c_b2_new), c_b3_old, c_b3_new),
         long_description = replace(long_description, c_l16_old, c_l16_new)
   WHERE id = '9b78f364-7712-4c92-9b09-ffa9132e37e5'
     AND md5(brief) = '91be00571ac19fbdf20c813f2fa86b94'
     AND md5(long_description) = 'fd8b391829914e49bb0b6ea0ece959ec';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = '9b78f364-7712-4c92-9b09-ffa9132e37e5';
  IF v_brief_md5 IS DISTINCT FROM '6857fbff3b712e99b4ae4df8b507351c' OR v_long_md5 IS DISTINCT FROM '5643017c275e2cb6a5f62fdaa7a1b7d5' THEN
    RAISE EXCEPTION '[Q1] did not come out as checked (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q2] 25 September Only Fools and Horses charity quiz
  UPDATE public.events
     SET brief = replace(brief, c_c1_old, c_c1_new),
         long_description = replace(long_description, c_c2_old, c_c2_new)
   WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240'
     AND md5(brief) = '02ff228dd3e9eaf3122835c00d5c46e8'
     AND md5(long_description) = 'ebad24a7e1b391fcb199e4c1c6424684';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240';
  IF v_brief_md5 IS DISTINCT FROM 'ed69099536d8c8eeb85ff58037d492a9' OR v_long_md5 IS DISTINCT FROM 'dc6695a3fcf5f29849116172aae73f6f' THEN
    RAISE EXCEPTION '[Q2] did not come out as checked (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q3] 7 October quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b1_old, c_b1_new), c_b2_old, c_b2_new), c_b3_old, c_b3_new),
         long_description = replace(long_description, c_l1_old, c_l1_new)
   WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb'
     AND md5(brief) = '27209ac48f8493bcfbc7d62c49b79208'
     AND md5(long_description) = '6aa3ca3cce4f89db7a824ccef9c7343f';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb';
  IF v_brief_md5 IS DISTINCT FROM '524fbf8170216bf20d85d04bd5fd533d' OR v_long_md5 IS DISTINCT FROM '572ba06f51074bb19aa5731eda7837a2' THEN
    RAISE EXCEPTION '[Q3] did not come out as checked (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q4] 4 November quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b1_old, c_b1_new), c_b2_old, c_b2_new), c_b3_old, c_b3_new),
         long_description = replace(long_description, c_l1_old, c_l1_new)
   WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b'
     AND md5(brief) = '45630919ad0a42e25c6478f9780ce598'
     AND md5(long_description) = '3e95d537a5267867e77889f99f956985';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q4] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b';
  IF v_brief_md5 IS DISTINCT FROM 'a439521173b7e174d826ffeb794642c9' OR v_long_md5 IS DISTINCT FROM '3a865f7a912114cbe233beefdef41fa2' THEN
    RAISE EXCEPTION '[Q4] did not come out as checked (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q5] 2 December quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b1_old, c_b1_new), c_b2_old, c_b2_new), c_b3_old, c_b3_new),
         long_description = replace(long_description, c_l1_old, c_l1_new)
   WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25'
     AND md5(brief) = '00b5e7117df9c5c15a9cd2bb02793dc4'
     AND md5(long_description) = '7ebfe347ee44bba8efc5477b9cc162c2';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q5] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25';
  IF v_brief_md5 IS DISTINCT FROM '41832bffe6542d8ef9a4b0cc257e8635' OR v_long_md5 IS DISTINCT FROM 'dfc3a7e38db9306df3dd5b8b0622b18f' THEN
    RAISE EXCEPTION '[Q5] did not come out as checked (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  RAISE NOTICE 'quiz_prize_claims: 5 quiz events corrected (10 fields)';
END
$migration$;
