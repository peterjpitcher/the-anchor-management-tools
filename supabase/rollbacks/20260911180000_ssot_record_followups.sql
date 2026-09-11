-- Rollback for supabase/migrations/20260911180000_ssot_record_followups.sql.
--
-- Puts the 30 rows back exactly as 20260911172000 left them: the SSOT access block without the
-- assistance dogs sentence on the 25 rows, the tasting night brief's wheelchair line, and the two
-- 6:45pm and 6:55pm arrival lines on the four quiz briefs. Guarded the same way: production only,
-- ids plus the md5 the migration produced, exact counts, and the md5 each brief had before.

DO $rollback$
DECLARE
  v_rows integer;
  v_md5 text;
  v_access_dogs text;
  v_access text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- Two checks, not one OR: Postgres plans the whole condition, so a missing table would error.
  IF to_regclass('public.booking_periods') IS NULL THEN
    RAISE NOTICE 'ssot_record_followups rollback: no booking_periods table, so not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = '8a4535ee-9547-4672-b20a-489457b46376') THEN
    RAISE NOTICE 'ssot_record_followups rollback: christmas-2026 booking period absent, so not the production dataset; nothing changed';
    RETURN;
  END IF;

  SELECT accessibility_notes INTO v_access_dogs FROM public.events WHERE id = '5cdadf74-97c1-4ec0-b495-d369a7304494';
  IF right(v_access_dogs, length(' Assistance dogs are always welcome.')) <> ' Assistance dogs are always welcome.' THEN
    RAISE EXCEPTION 'rollback: the access notes do not end with the assistance dogs sentence';
  END IF;
  v_access := left(v_access_dogs, length(v_access_dogs) - length(' Assistance dogs are always welcome.'));
  IF md5(v_access) IS DISTINCT FROM '2a255cfefbb8708f148cb962ebf39de6' THEN
    RAISE EXCEPTION 'rollback: the access block is not the one 20260911172000 stored (md5 %)', md5(v_access);
  END IF;

  UPDATE public.events SET accessibility_notes = v_access
   WHERE id IN ('5cdadf74-97c1-4ec0-b495-d369a7304494', '9b78f364-7712-4c92-9b09-ffa9132e37e5', '9d03a427-d331-45bd-91af-142b396b82ae', 'e9e84ee8-c59b-4f93-80f6-7e7961a03240', 'd81512e7-5e99-48fd-a153-3400c2f6f009', '76ec328b-48f8-47c0-b041-cc405e085deb', 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac', 'd52cbd18-d293-4516-beca-e151eaa90180', '8acfe965-ade6-4a9f-a666-e90ecdea2b7b', 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735', '6e761f65-8b17-4bc9-8a01-d032b77f6a66', 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25', '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a', 'b9334958-76b4-4504-a64a-0d47145bd75e')
     AND accessibility_notes = v_access_dogs;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 14 THEN RAISE EXCEPTION 'rollback [D1] expected 14 row(s), matched %', v_rows; END IF;

  UPDATE public.event_categories SET accessibility_notes = v_access
   WHERE id IN ('715cc457-a90c-48e8-a774-da13addf19ed', '8da89912-b2c6-4b93-bf7a-f8e68f2dae24', '9a39d780-91bb-4e53-b3cf-11d76e59dcb0', 'cd28081e-7840-47a6-b5ea-fdec561147c1', 'b119adc2-a4d5-465e-a064-713e921fe94b', '150badde-489b-44a6-9401-945cd96a75af', '8493fffe-b218-484c-8646-4e28cfd6c2f8', 'a3e13e87-816b-48cb-ba8f-ef6f9ae68b36', '65bf6647-3d76-4bb8-a719-572acbb6fb5a', '6c12979d-a6ae-428f-8a71-e64f4a006404')
     AND accessibility_notes = v_access_dogs;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 10 THEN RAISE EXCEPTION 'rollback [D2] expected 10 row(s), matched %', v_rows; END IF;

  UPDATE public.event_faqs SET answer = v_access
   WHERE id = 'aff4ec7a-33cb-49a2-abc9-095168f8c8bc' AND answer = v_access_dogs;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [D3] expected 1 row(s), matched %', v_rows; END IF;

  UPDATE public.events
     SET brief = replace(brief,
           '* **Free parking** is available on site, and getting in from the car park is step free.',
           '* **Free parking** is available on site and the venue is wheelchair accessible.')
   WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65' AND md5(brief) = '494ac92d51741051f55a4e7cc839cec3';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'rollback [W1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65';
  IF v_md5 IS DISTINCT FROM 'e475a2175e034f313d80d6cb597c7859' THEN RAISE EXCEPTION 'rollback [W1] brief md5 %', v_md5; END IF;

  UPDATE public.events AS e
     SET brief = replace(e.brief, 'Arrive from 6:30pm for a 7pm start.',
                         ('Arrive from: **6:45pm**' || E'\r\n' || 'Please be seated by: **6:55pm**'))
    FROM (VALUES
      ('9b78f364-7712-4c92-9b09-ffa9132e37e5'::uuid, '91be00571ac19fbdf20c813f2fa86b94'),
      ('76ec328b-48f8-47c0-b041-cc405e085deb'::uuid, '27209ac48f8493bcfbc7d62c49b79208'),
      ('8acfe965-ade6-4a9f-a666-e90ecdea2b7b'::uuid, '45630919ad0a42e25c6478f9780ce598'),
      ('ccbe8b82-15b0-4261-b58e-2ac4d7210e25'::uuid, '00b5e7117df9c5c15a9cd2bb02793dc4')
    ) AS x(id, new_md5)
   WHERE e.id = x.id AND md5(e.brief) = x.new_md5;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 4 THEN RAISE EXCEPTION 'rollback [A] expected 4 row(s), matched %', v_rows; END IF;

  SELECT count(*) INTO v_rows FROM public.events
   WHERE (id, md5(brief)) IN (
     ('9b78f364-7712-4c92-9b09-ffa9132e37e5'::uuid, '6756d7199b35dcc40eb98f226fad6de9'),
     ('76ec328b-48f8-47c0-b041-cc405e085deb'::uuid, '8b45fe048cba46069a0bae9a9c74a5df'),
     ('8acfe965-ade6-4a9f-a666-e90ecdea2b7b'::uuid, '61825ae77d8af42d6c56052550a8b5a4'),
     ('ccbe8b82-15b0-4261-b58e-2ac4d7210e25'::uuid, '7528365d71310f1835834a4c58c5c156'));
  IF v_rows <> 4 THEN RAISE EXCEPTION 'rollback [A] only % of 4 briefs are back to their original text', v_rows; END IF;

  RAISE NOTICE 'ssot_record_followups rollback: 30 rows restored';
END
$rollback$;
