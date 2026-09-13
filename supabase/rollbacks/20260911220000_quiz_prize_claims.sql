-- Rollback for supabase/migrations/20260911220000_quiz_prize_claims.sql.
--
-- Puts the brief and long description of the five quiz events back exactly as captured on
-- 11 September 2026, free drink and spot prize claims included. Guarded the same way: production
-- only, ids plus the md5 the migration produced, exactly one row per UPDATE, and each text must
-- come back at the md5 it had before the migration.

DO $rollback$
DECLARE
  v_rows integer;
  v_brief_md5 text;
  v_long_md5 text;
  -- The same phrase pairs as the migration; the rollback swaps new for old, last edit first.
  c_b1_old CONSTANT text := 'with quick-fire moments, free drink questions, spot prizes, surprises and the kind of atmosphere';
  c_b1_new CONSTANT text := 'with quick-fire moments, surprises and the kind of atmosphere';
  c_b2_old CONSTANT text := 'A **closest-wins free drink question in every round**, a mini challenge using **one phone per player**, spot prizes and plenty of friendly rivalry.';
  c_b2_new CONSTANT text := 'A mini challenge using **one phone per player** and plenty of friendly rivalry.';
  c_b3_old CONSTANT text := 'deserves rewarding too.' || E'\r\n\r\n' || 'There are also closest-wins free drinks and spot prizes throughout the night.' || E'\r\n\r\n' || '**House rules**';
  c_b3_new CONSTANT text := 'deserves rewarding too.' || E'\r\n\r\n' || '**House rules**';
  c_l1_old CONSTANT text := 'Expect quick-fire moments, a closest-wins free drink question in every round, a one-phone-per-player mini challenge and spot prizes.';
  c_l1_new CONSTANT text := 'Expect quick-fire moments and a one-phone-per-player mini challenge.';
  c_l16_old CONSTANT text := 'think fast-paced questions, a closest-wins free drink question in each round, and spot prizes to keep everyone on their toes';
  c_l16_new CONSTANT text := 'think fast-paced questions to keep everyone on their toes';
  c_c1_old CONSTANT text := '- **Second-to-last place:** bottle of wine' || E'\r\n' || '- Spot prizes and free drinks during the night' || E'\r\n';
  c_c1_new CONSTANT text := '- **Second-to-last place:** bottle of wine' || E'\r\n';
  c_c2_old CONSTANT text := 'bar voucher, second-to-last place will receive a bottle of wine, and there will be spot prizes and free drinks during the night.';
  c_c2_new CONSTANT text := 'bar voucher, and second-to-last place will receive a bottle of wine.';
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.booking_periods') IS NULL THEN
    RAISE NOTICE 'quiz_prize_claims rollback: no booking_periods table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = '8a4535ee-9547-4672-b20a-489457b46376') THEN
    RAISE NOTICE 'quiz_prize_claims rollback: christmas-2026 booking period absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [Q1] 16 September quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b3_new, c_b3_old), c_b2_new, c_b2_old), c_b1_new, c_b1_old),
         long_description = replace(long_description, c_l16_new, c_l16_old)
   WHERE id = '9b78f364-7712-4c92-9b09-ffa9132e37e5'
     AND md5(brief) = '6857fbff3b712e99b4ae4df8b507351c'
     AND md5(long_description) = '5643017c275e2cb6a5f62fdaa7a1b7d5';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [Q1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = '9b78f364-7712-4c92-9b09-ffa9132e37e5';
  IF v_brief_md5 IS DISTINCT FROM '91be00571ac19fbdf20c813f2fa86b94' OR v_long_md5 IS DISTINCT FROM 'fd8b391829914e49bb0b6ea0ece959ec' THEN
    RAISE EXCEPTION 'rollback [Q1] did not come back as captured (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q2] 25 September Only Fools and Horses charity quiz
  UPDATE public.events
     SET brief = replace(brief, c_c1_new, c_c1_old),
         long_description = replace(long_description, c_c2_new, c_c2_old)
   WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240'
     AND md5(brief) = 'ed69099536d8c8eeb85ff58037d492a9'
     AND md5(long_description) = 'dc6695a3fcf5f29849116172aae73f6f';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [Q2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240';
  IF v_brief_md5 IS DISTINCT FROM '02ff228dd3e9eaf3122835c00d5c46e8' OR v_long_md5 IS DISTINCT FROM 'ebad24a7e1b391fcb199e4c1c6424684' THEN
    RAISE EXCEPTION 'rollback [Q2] did not come back as captured (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q3] 7 October quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b3_new, c_b3_old), c_b2_new, c_b2_old), c_b1_new, c_b1_old),
         long_description = replace(long_description, c_l1_new, c_l1_old)
   WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb'
     AND md5(brief) = '524fbf8170216bf20d85d04bd5fd533d'
     AND md5(long_description) = '572ba06f51074bb19aa5731eda7837a2';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [Q3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb';
  IF v_brief_md5 IS DISTINCT FROM '27209ac48f8493bcfbc7d62c49b79208' OR v_long_md5 IS DISTINCT FROM '6aa3ca3cce4f89db7a824ccef9c7343f' THEN
    RAISE EXCEPTION 'rollback [Q3] did not come back as captured (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q4] 4 November quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b3_new, c_b3_old), c_b2_new, c_b2_old), c_b1_new, c_b1_old),
         long_description = replace(long_description, c_l1_new, c_l1_old)
   WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b'
     AND md5(brief) = 'a439521173b7e174d826ffeb794642c9'
     AND md5(long_description) = '3a865f7a912114cbe233beefdef41fa2';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [Q4] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b';
  IF v_brief_md5 IS DISTINCT FROM '45630919ad0a42e25c6478f9780ce598' OR v_long_md5 IS DISTINCT FROM '3e95d537a5267867e77889f99f956985' THEN
    RAISE EXCEPTION 'rollback [Q4] did not come back as captured (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  -- [Q5] 2 December quiz
  UPDATE public.events
     SET brief = replace(replace(replace(brief, c_b3_new, c_b3_old), c_b2_new, c_b2_old), c_b1_new, c_b1_old),
         long_description = replace(long_description, c_l1_new, c_l1_old)
   WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25'
     AND md5(brief) = '41832bffe6542d8ef9a4b0cc257e8635'
     AND md5(long_description) = 'dfc3a7e38db9306df3dd5b8b0622b18f';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [Q5] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25';
  IF v_brief_md5 IS DISTINCT FROM '00b5e7117df9c5c15a9cd2bb02793dc4' OR v_long_md5 IS DISTINCT FROM '7ebfe347ee44bba8efc5477b9cc162c2' THEN
    RAISE EXCEPTION 'rollback [Q5] did not come back as captured (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  RAISE NOTICE 'quiz_prize_claims rollback: 5 quiz events restored (10 fields)';
END
$rollback$;
