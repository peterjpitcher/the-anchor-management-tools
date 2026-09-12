-- Rollback for supabase/migrations/20260912091000_charity_quiz_one_phone_per_player.sql.
--
-- Puts "one phone per team" back into the brief and the long description of the 25 September
-- charity quiz, exactly as captured on 12 September 2026. Guarded the same way: production only,
-- the id plus the md5s the migration produced, exactly one row, and both texts must come back at
-- the md5 they had before it ran.

DO $rollback$
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
    RAISE NOTICE 'charity_quiz_one_phone_per_player rollback: no events table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240') THEN
    RAISE NOTICE 'charity_quiz_one_phone_per_player rollback: 25 September charity quiz absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [P1] 25 September Only Fools and Horses charity quiz
  UPDATE public.events
     SET brief = replace(brief, c_new, c_old),
         long_description = replace(long_description, c_new, c_old)
   WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240'
     AND md5(brief) = 'a5eb9fc1909b84565266a265836f00e9'
     AND md5(long_description) = 'cb44d639a5233c18869132f5cbfbe7a4';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [P1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief), md5(long_description) INTO v_brief_md5, v_long_md5 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240';
  IF v_brief_md5 IS DISTINCT FROM 'ed69099536d8c8eeb85ff58037d492a9'
     OR v_long_md5 IS DISTINCT FROM 'dc6695a3fcf5f29849116172aae73f6f' THEN
    RAISE EXCEPTION 'rollback [P1] did not come back as captured (brief md5 %, long description md5 %)', v_brief_md5, v_long_md5;
  END IF;

  RAISE NOTICE 'charity_quiz_one_phone_per_player rollback: 1 event restored (2 fields)';
END
$rollback$;
