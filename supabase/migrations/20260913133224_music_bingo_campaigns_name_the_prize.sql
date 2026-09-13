-- Name the Music Bingo prize in the three scheduled campaign emails.
--
-- APPLIED to production on 13 September 2026 through the Supabase MCP, which recorded it at
-- version 20260913133224. This file is named after that version, as supabase/migrations/README.md
-- requires, and its SQL below is the statement that ran, minus this note: ledger statement md5
-- a9f0a465c1d4449fc1fc286b260b4f0b, 5,565 bytes.
--
-- Rollback: supabase/rollbacks/20260913133224_music_bingo_campaigns_name_the_prize.sql
--
-- The owner asked on 13 September 2026 for the prize to be mentioned. Music Bingo winners get the
-- same £25 bar voucher as Quiz Night, and the quiz campaigns already word it as "a £25 bar
-- voucher, valid on food or drink for one month", so this uses that wording rather than inventing
-- a second phrasing for the same voucher. Until now these three emails said only "Expect prizes"
-- or "a few surprises" and never said what a winner actually gets.
--
-- WHAT CHANGES (3 campaigns, 1 fact-strip row each)
--   A row {"label": "Prize", "value": "A £25 bar voucher, valid on food or drink for one month"}
--   is inserted into the fact strip immediately after "Host", so the strip reads
--   Host / Prize / Arrive from / Dressing up / Seating. Nothing else in the emails moves.
--     [P1] 3edae0f3 Screams & Soundtracks, 16 Oct, sends 9 Oct
--     [P2] 4fcaadb7 Sequins & Showstoppers, 13 Nov, sends 6 Nov
--     [P3] c9a5618c Sleigh My Name, 11 Dec, sends 4 Dec
--
-- CONTENT HASH
--   content_hash is the fingerprint of what a human approved: sha256 over the parsed content with
--   keys sorted (computeContentHash in src/services/marketing-campaigns.ts). Changing the copy
--   without recomputing it would leave the record claiming these are the approved bytes when they
--   are not, so each new hash is set here. Every new hash was computed with that exact function
--   against the edited content, and the same function reproduced all three CURRENT hashes from the
--   live rows first, which is what proves the method matches the application rather than
--   resembling it. Each was verified again by reading the row back after this ran: all three
--   stored hashes hash their own stored content.
--
-- HOW IT GUARDS ITSELF
--   One DO block. Each UPDATE names its campaign by id and by the content hash it must still
--   hold, and also checks that block 3 is the fact strip and that its first row is Host, so the
--   insert cannot land in a reordered email. Each must match exactly one row, and the rows are
--   then re-read to confirm the strip has five entries with Prize second. A re-run is a no-op that
--   raises, because the old content_hash no longer matches.

DO $migration$
DECLARE
  v_rows integer;
  v_count integer;
  c_prize CONSTANT jsonb := jsonb_build_object(
    'label', 'Prize',
    'value', 'A ' || chr(163) || '25 bar voucher, valid on food or drink for one month');
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.marketing_campaigns') IS NULL THEN
    RAISE NOTICE 'music_bingo_prize: no marketing_campaigns table, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [P1] Screams & Soundtracks, 16 October
  UPDATE public.marketing_campaigns
     SET content = jsonb_insert(content, '{blocks,3,data,rows,1}', c_prize),
         content_hash = 'd4fef38371de2fb2b916cbc27183902ab056c4ca80fa6c9ed7ecf2d7be4a90c8',
         updated_at = now()
   WHERE id = '3edae0f3-42a5-437d-b6e6-a747ba2f9ab6'
     AND content_hash = '2220aa760191fa50cf3a9ec1fbaa6ce29712fffbbd14d16925d97183aeab597a'
     AND content->'blocks'->3->>'type' = 'fact_strip'
     AND content->'blocks'->3->'data'->'rows'->0->>'label' = 'Host';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P1] expected 1 row(s), matched %', v_rows; END IF;

  -- [P2] Sequins & Showstoppers, 13 November
  UPDATE public.marketing_campaigns
     SET content = jsonb_insert(content, '{blocks,3,data,rows,1}', c_prize),
         content_hash = 'a8659df5b8e87169430d4729478bcd1ced9d3d4c6f2e8922cb5f47446e613682',
         updated_at = now()
   WHERE id = '4fcaadb7-ca98-4aba-a756-8d82b4cb52c0'
     AND content_hash = '129678990dd64d68c3768653c097a9a48826df67ee02ed98f6c1082c49566fb1'
     AND content->'blocks'->3->>'type' = 'fact_strip'
     AND content->'blocks'->3->'data'->'rows'->0->>'label' = 'Host';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P2] expected 1 row(s), matched %', v_rows; END IF;

  -- [P3] Sleigh My Name, 11 December
  UPDATE public.marketing_campaigns
     SET content = jsonb_insert(content, '{blocks,3,data,rows,1}', c_prize),
         content_hash = '198436d09d7168825a5c45ff041c8845eebc1e213e2b790ffa0c6f8880769689',
         updated_at = now()
   WHERE id = 'c9a5618c-008e-4e7b-b624-d49141cc9f91'
     AND content_hash = '67de53dce385f690324eb61a438f7f3f8908ec5606540be161d868357345f2f1'
     AND content->'blocks'->3->'data'->'rows'->0->>'label' = 'Host'
     AND content->'blocks'->3->>'type' = 'fact_strip';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[P3] expected 1 row(s), matched %', v_rows; END IF;

  -- all three now carry the Prize row, second in the strip
  SELECT count(*) INTO v_count
    FROM public.marketing_campaigns
   WHERE id IN ('3edae0f3-42a5-437d-b6e6-a747ba2f9ab6',
                '4fcaadb7-ca98-4aba-a756-8d82b4cb52c0',
                'c9a5618c-008e-4e7b-b624-d49141cc9f91')
     AND jsonb_array_length(content->'blocks'->3->'data'->'rows') = 5
     AND content->'blocks'->3->'data'->'rows'->1->>'label' = 'Prize'
     AND content->'blocks'->3->'data'->'rows'->1->>'value'
         = 'A ' || chr(163) || '25 bar voucher, valid on food or drink for one month';
  IF v_count <> 3 THEN RAISE EXCEPTION 'expected 3 campaigns carrying the Prize row, found %', v_count; END IF;

  RAISE NOTICE 'music_bingo_prize: 3 campaigns corrected (3 fact-strip rows, 3 content hashes)';
END
$migration$;
