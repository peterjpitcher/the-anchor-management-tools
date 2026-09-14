-- SSOT record follow-ups, 11 September 2026. Same owner approval as
-- 20260911172000_ssot_record_and_content_corrections.sql: access and arrival wording on event
-- records follows the website's docs/SSOT.md.
--
-- WHAT CHANGES (expected rows in brackets)
--   [D] 20260911172000 replaced the old access template, which ended "Assistance dogs are
--       welcome.", with the SSOT section 16 access block, which does not mention them. SSOT
--       section 8 says "Assistance dogs: always welcome.", so "Assistance dogs are always
--       welcome." follows the block again on the rows that had it: 14 upcoming events [14],
--       10 active categories [10] and the 25 September quiz FAQ [1]. The tasting night's notes and
--       FAQ never mentioned assistance dogs and are left alone.
--   [W] The 20 November tasting night brief said "the venue is wheelchair accessible". It now
--       says getting in from the car park is step free, from SSOT section 16 [1].
--   [A] The 16 September, 7 October, 4 November and 2 December quiz briefs said "Arrive from:
--       **6:45pm**" and "Please be seated by: **6:55pm**"; the SSOT says arrive from 6:30pm. Both
--       lines become "Arrive from 6:30pm for a 7pm start.", as the 25 September brief now reads [4].
--
-- HOW IT GUARDS ITSELF
--   One DO block, so all of it applies or none of it. On a database without the christmas-2026
--   booking period it raises a NOTICE and changes nothing. The access block is read from the row
--   20260911172000 wrote, not retyped, and must hash to that file's md5. Every UPDATE names its
--   rows by id and the md5 of the current text, every count must match, and every changed brief
--   must come out at the md5 checked read-only on 11 September 2026.
--
-- Rollback: supabase/rollbacks/20260911180000_ssot_record_followups.sql

DO $migration$
DECLARE
  v_rows integer;
  v_md5 text;
  v_access text;
  v_access_dogs text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.booking_periods') IS NULL THEN
    RAISE NOTICE 'ssot_record_followups: no booking_periods table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = '8a4535ee-9547-4672-b20a-489457b46376') THEN
    RAISE NOTICE 'ssot_record_followups: christmas-2026 booking period absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- The SSOT access block exactly as 20260911172000 stored it.
  SELECT accessibility_notes INTO v_access FROM public.events WHERE id = '5cdadf74-97c1-4ec0-b495-d369a7304494';
  IF md5(v_access) IS DISTINCT FROM '2a255cfefbb8708f148cb962ebf39de6' THEN
    RAISE EXCEPTION '[D] the access block is not the one 20260911172000 stored (md5 %)', md5(v_access);
  END IF;
  v_access_dogs := v_access || ' Assistance dogs are always welcome.';

  -- [D1] the 14 upcoming events whose old template mentioned assistance dogs
  UPDATE public.events
     SET accessibility_notes = v_access_dogs
   WHERE id IN ('5cdadf74-97c1-4ec0-b495-d369a7304494', '9b78f364-7712-4c92-9b09-ffa9132e37e5', '9d03a427-d331-45bd-91af-142b396b82ae', 'e9e84ee8-c59b-4f93-80f6-7e7961a03240', 'd81512e7-5e99-48fd-a153-3400c2f6f009', '76ec328b-48f8-47c0-b041-cc405e085deb', 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac', 'd52cbd18-d293-4516-beca-e151eaa90180', '8acfe965-ade6-4a9f-a666-e90ecdea2b7b', 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735', '6e761f65-8b17-4bc9-8a01-d032b77f6a66', 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25', '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a', 'b9334958-76b4-4504-a64a-0d47145bd75e')
     AND md5(accessibility_notes) = '2a255cfefbb8708f148cb962ebf39de6';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 14 THEN RAISE EXCEPTION '[D1] expected 14 row(s), matched %', v_rows; END IF;

  -- [D2] the 10 categories whose old template mentioned assistance dogs
  UPDATE public.event_categories
     SET accessibility_notes = v_access_dogs
   WHERE id IN ('715cc457-a90c-48e8-a774-da13addf19ed', '8da89912-b2c6-4b93-bf7a-f8e68f2dae24', '9a39d780-91bb-4e53-b3cf-11d76e59dcb0', 'cd28081e-7840-47a6-b5ea-fdec561147c1', 'b119adc2-a4d5-465e-a064-713e921fe94b', '150badde-489b-44a6-9401-945cd96a75af', '8493fffe-b218-484c-8646-4e28cfd6c2f8', 'a3e13e87-816b-48cb-ba8f-ef6f9ae68b36', '65bf6647-3d76-4bb8-a719-572acbb6fb5a', '6c12979d-a6ae-428f-8a71-e64f4a006404')
     AND md5(accessibility_notes) = '2a255cfefbb8708f148cb962ebf39de6';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 10 THEN RAISE EXCEPTION '[D2] expected 10 row(s), matched %', v_rows; END IF;

  -- [D3] the 25 September quiz FAQ "Is the venue accessible?"
  UPDATE public.event_faqs
     SET answer = v_access_dogs
   WHERE id = 'aff4ec7a-33cb-49a2-abc9-095168f8c8bc'
     AND md5(answer) = '2a255cfefbb8708f148cb962ebf39de6';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[D3] expected 1 row(s), matched %', v_rows; END IF;

  -- [W1] 20 November tasting night brief, the wheelchair claim
  UPDATE public.events
     SET brief = replace(brief,
           '* **Free parking** is available on site and the venue is wheelchair accessible.',
           '* **Free parking** is available on site, and getting in from the car park is step free.')
   WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'
     AND md5(brief) = 'e475a2175e034f313d80d6cb597c7859';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[W1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65';
  IF v_md5 IS DISTINCT FROM '494ac92d51741051f55a4e7cc839cec3' THEN RAISE EXCEPTION '[W1] brief did not come out as checked (md5 %)', v_md5; END IF;

  -- [A1] 16 September quiz brief, arrival lines
  UPDATE public.events
     SET brief = replace(brief,
           ('Arrive from: **6:45pm**' || E'\r\n' || 'Please be seated by: **6:55pm**'),
           'Arrive from 6:30pm for a 7pm start.')
   WHERE id = '9b78f364-7712-4c92-9b09-ffa9132e37e5'
     AND md5(brief) = '6756d7199b35dcc40eb98f226fad6de9';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[A1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '9b78f364-7712-4c92-9b09-ffa9132e37e5';
  IF v_md5 IS DISTINCT FROM '91be00571ac19fbdf20c813f2fa86b94' THEN RAISE EXCEPTION '[A1] brief did not come out as checked (md5 %)', v_md5; END IF;

  -- [A2] 7 October quiz brief, arrival lines
  UPDATE public.events
     SET brief = replace(brief,
           ('Arrive from: **6:45pm**' || E'\r\n' || 'Please be seated by: **6:55pm**'),
           'Arrive from 6:30pm for a 7pm start.')
   WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb'
     AND md5(brief) = '8b45fe048cba46069a0bae9a9c74a5df';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[A2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb';
  IF v_md5 IS DISTINCT FROM '27209ac48f8493bcfbc7d62c49b79208' THEN RAISE EXCEPTION '[A2] brief did not come out as checked (md5 %)', v_md5; END IF;

  -- [A3] 4 November quiz brief, arrival lines
  UPDATE public.events
     SET brief = replace(brief,
           ('Arrive from: **6:45pm**' || E'\r\n' || 'Please be seated by: **6:55pm**'),
           'Arrive from 6:30pm for a 7pm start.')
   WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b'
     AND md5(brief) = '61825ae77d8af42d6c56052550a8b5a4';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[A3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b';
  IF v_md5 IS DISTINCT FROM '45630919ad0a42e25c6478f9780ce598' THEN RAISE EXCEPTION '[A3] brief did not come out as checked (md5 %)', v_md5; END IF;

  -- [A4] 2 December quiz brief, arrival lines
  UPDATE public.events
     SET brief = replace(brief,
           ('Arrive from: **6:45pm**' || E'\r\n' || 'Please be seated by: **6:55pm**'),
           'Arrive from 6:30pm for a 7pm start.')
   WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25'
     AND md5(brief) = '7528365d71310f1835834a4c58c5c156';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[A4] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25';
  IF v_md5 IS DISTINCT FROM '00b5e7117df9c5c15a9cd2bb02793dc4' THEN RAISE EXCEPTION '[A4] brief did not come out as checked (md5 %)', v_md5; END IF;

  RAISE NOTICE 'ssot_record_followups: 30 rows corrected';
END
$migration$;
