-- Rollback for 20260911172000_ssot_record_and_content_corrections.sql
--
-- Puts back every value that migration changed, exactly as production held it on
-- 11 September 2026. Hand-run SQL, like everything in this folder.
--
-- It undoes the 60 statements in reverse order. Each one only touches a row whose current value
-- is exactly what the migration wrote (full text for short fields, the reviewed md5 for long
-- ones), and each long field must come back at the md5 captured before the migration. If anyone
-- has edited one of these fields in the app since the migration ran, the count check fails and
-- nothing is rolled back; restore that field by hand, or re-run after putting it back.
--
-- What it cannot restore: updated_at on event_faqs, business_amenities, catering_packages,
-- sunday_lunch_menu_items and venue_spaces. Their update triggers stamp the time of the rollback.
--
-- Restoring brings back the wording the owner asked to remove (the wrong access template, the
-- "gluten-free" claims, the 11pm finishes, "Doors open"). Agree it with the owner first.

DO $rollback$
DECLARE
  v_rows integer;
  v_md5 text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.booking_periods') IS NULL THEN
    RAISE NOTICE 'rollback ssot_record_and_content_corrections: not the production dataset; nothing changed';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = '8a4535ee-9547-4672-b20a-489457b46376') THEN
    RAISE NOTICE 'rollback ssot_record_and_content_corrections: not the production dataset; nothing changed';
    RETURN;
  END IF;

  -- [Q12] item 14: Quiz Night category FAQ "How is the seating arranged?"
  UPDATE public.event_categories
     SET faqs = (replace(faqs::text,
           'Each team has its own table.',
           'Quiz Night uses communal seating.'))::jsonb
   WHERE id = '65bf6647-3d76-4bb8-a719-572acbb6fb5a'
     AND md5(faqs::text) = 'a5bf60deebe4c1572c700def126bb859';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q12] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(faqs::text) INTO v_md5 FROM public.event_categories WHERE id = '65bf6647-3d76-4bb8-a719-572acbb6fb5a';
  IF v_md5 IS DISTINCT FROM '41ead3b2324c6ff567a17c57bab131f8' THEN RAISE EXCEPTION '[Q12] faqs did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [Q11] item 14: Quiz Night category long description, seating sentence
  UPDATE public.event_categories
     SET long_description = replace(long_description,
           'Each team has its own table.',
           'Seating is communal, so places are booked for each player rather than as a private table.')
   WHERE id = '65bf6647-3d76-4bb8-a719-572acbb6fb5a'
     AND md5(long_description) = '6e7d6a9830990e0b08f46f21eb0d6560';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q11] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.event_categories WHERE id = '65bf6647-3d76-4bb8-a719-572acbb6fb5a';
  IF v_md5 IS DISTINCT FROM '44d1b49f272007ca62741c44124d36b2' THEN RAISE EXCEPTION '[Q11] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [Q10] item 14: Quiz Night category copy (booking mode stays table)
  UPDATE public.event_categories
     SET description = 'A friendly, family-friendly pub quiz at The Anchor in Stanwell Moor, with varied rounds, communal seating and cash payment on arrival.',
         short_description = 'Join our family-friendly pub quiz in Stanwell Moor for varied rounds, friendly competition and communal seating. Entry is £3 cash on arrival.',
         meta_description = 'Join Quiz Night at The Anchor, Stanwell Moor. Family-friendly pub quiz, communal seating and £3 cash entry. Book your places online.',
         highlights = '["Family-friendly quiz", "Varied question rounds", "Communal seating", "£3 cash on arrival", "Free on-site parking"]'::jsonb
   WHERE id = '65bf6647-3d76-4bb8-a719-572acbb6fb5a'
     AND name = 'Quiz Night'
     AND default_booking_mode = 'table'
     AND description = 'A friendly, family-friendly pub quiz at The Anchor in Stanwell Moor, with varied rounds, a table for each team and cash payment on arrival.'
     AND short_description = 'Join our family-friendly pub quiz in Stanwell Moor for varied rounds, friendly competition and a table for each team. Entry is £3 cash on arrival.'
     AND meta_description = 'Join Quiz Night at The Anchor, Stanwell Moor. Family-friendly pub quiz, a table for each team and £3 cash entry. Book your places online.'
     AND highlights = '["Family-friendly quiz", "Varied question rounds", "A table for each team", "£3 cash on arrival", "Free on-site parking"]'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q10] expected 1 row(s), matched %', v_rows; END IF;

  -- [Q9] item 14: FAQ "How is the seating arranged?" on the 7 October, 4 November and 2 December quizzes
  UPDATE public.event_faqs
     SET answer = 'Quiz Night uses communal seating. Book the number of players attending and we will arrange the room for the teams.'
   WHERE id IN ('85eeab04-f3fd-46bf-aed2-119c1ddde270', 'ee54a472-99e6-4426-be4d-a8a62de77e7e', 'f3003da5-f24f-41eb-aae3-6cb1448ed0de')
     AND answer = 'Each team has its own table. Book the number of players attending and we will arrange the room for the teams.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 3 THEN RAISE EXCEPTION '[Q9] expected 3 row(s), matched %', v_rows; END IF;

  -- [Q8] item 14: 2 December quiz meta description
  UPDATE public.events
     SET meta_description = 'Join the Tinsel & Trivia Quiz Night at The Anchor, Stanwell Moor on 2 December. £3 cash entry, prizes, communal seating and dinner served from 4pm to 9pm.'
   WHERE id IN ('ccbe8b82-15b0-4261-b58e-2ac4d7210e25')
     AND meta_description = 'Join the Tinsel & Trivia Quiz Night at The Anchor, Stanwell Moor on 2 December. £3 cash entry, prizes, a table for each team and dinner served from 4pm to 9pm.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q8] expected 1 row(s), matched %', v_rows; END IF;

  -- [Q7] item 14: 4 November quiz meta description
  UPDATE public.events
     SET meta_description = 'Join the Sparks & Sparklers Quiz Night at The Anchor, Stanwell Moor on 4 November. £3 cash entry, prizes, communal seating and dinner served from 4pm to 9pm.'
   WHERE id IN ('8acfe965-ade6-4a9f-a666-e90ecdea2b7b')
     AND meta_description = 'Join the Sparks & Sparklers Quiz Night at The Anchor, Stanwell Moor on 4 November. £3 cash entry, prizes, a table for each team and dinner served from 4pm to 9pm.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q7] expected 1 row(s), matched %', v_rows; END IF;

  -- [Q6] item 14: 7 October quiz meta description
  UPDATE public.events
     SET meta_description = 'Join A Hint of Halloween Quiz Night at The Anchor, Stanwell Moor on 7 October. £3 cash entry, prizes, communal seating and dinner served from 4pm to 9pm.'
   WHERE id IN ('76ec328b-48f8-47c0-b041-cc405e085deb')
     AND meta_description = 'Join A Hint of Halloween Quiz Night at The Anchor, Stanwell Moor on 7 October. £3 cash entry, prizes, a table for each team and dinner served from 4pm to 9pm.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q6] expected 1 row(s), matched %', v_rows; END IF;

  -- [Q5] item 14: 2 December quiz long description, seating sentence
  UPDATE public.events
     SET long_description = replace(long_description,
           'Booking is strongly recommended so we can prepare a table for each team.',
           'Booking is strongly recommended so we can prepare the communal seating and keep teams together where possible.')
   WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25'
     AND md5(long_description) = '7ebfe347ee44bba8efc5477b9cc162c2';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q5] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25';
  IF v_md5 IS DISTINCT FROM '7953378b028de8eb1132570901e34ca2' THEN RAISE EXCEPTION '[Q5] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [Q4] item 14: 4 November quiz long description, seating sentence
  UPDATE public.events
     SET long_description = replace(long_description,
           'Booking is strongly recommended so we can prepare a table for each team.',
           'Booking is strongly recommended so we can prepare the communal seating and keep teams together where possible.')
   WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b'
     AND md5(long_description) = '3e95d537a5267867e77889f99f956985';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q4] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = '8acfe965-ade6-4a9f-a666-e90ecdea2b7b';
  IF v_md5 IS DISTINCT FROM '42f506e2ae5ea075b02e3291e8046d21' THEN RAISE EXCEPTION '[Q4] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [Q3] item 14: 7 October quiz long description, seating sentence
  UPDATE public.events
     SET long_description = replace(long_description,
           'Booking is strongly recommended so we can prepare a table for each team.',
           'Booking is strongly recommended so we can prepare the communal seating and keep teams together where possible.')
   WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb'
     AND md5(long_description) = '6aa3ca3cce4f89db7a824ccef9c7343f';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = '76ec328b-48f8-47c0-b041-cc405e085deb';
  IF v_md5 IS DISTINCT FROM '5579c60f8db60cb4f0ffdff8be25b568' THEN RAISE EXCEPTION '[Q3] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [Q2] item 14: 7 October, 4 November and 2 December quiz highlights
  UPDATE public.events
     SET highlights = '["Family-friendly quiz", "Varied question rounds", "Communal seating", "£3 cash on arrival", "Free on-site parking"]'::jsonb
   WHERE id IN ('76ec328b-48f8-47c0-b041-cc405e085deb', '8acfe965-ade6-4a9f-a666-e90ecdea2b7b', 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25')
     AND highlights = '["Family-friendly quiz", "Varied question rounds", "A table for each team", "£3 cash on arrival", "Free on-site parking"]'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 3 THEN RAISE EXCEPTION '[Q2] expected 3 row(s), matched %', v_rows; END IF;

  -- [Q1] item 14: 16 September quiz highlights
  UPDATE public.events
     SET highlights = '["family-friendly quiz", "varied question rounds", "communal seating", "£3 cash on arrival", "free on-site parking"]'::jsonb
   WHERE id IN ('9b78f364-7712-4c92-9b09-ffa9132e37e5')
     AND highlights = '["family-friendly quiz", "varied question rounds", "a table for each team", "£3 cash on arrival", "free on-site parking"]'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[Q1] expected 1 row(s), matched %', v_rows; END IF;

  -- [E16] item 13: 11 December Music Bingo FAQ
  UPDATE public.event_faqs
     SET answer = 'Sleigh My Name: Festive Music Bingo is on 11 December 2026 from 7pm to 11pm.'
   WHERE id IN ('d7083846-55c1-4ace-ac18-23c0a9714978')
     AND answer = 'Sleigh My Name: Festive Music Bingo is on 11 December 2026 from 7pm to 10pm.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E16] expected 1 row(s), matched %', v_rows; END IF;

  -- [E15] item 13: 11 December Music Bingo brief
  UPDATE public.events
     SET brief = replace(brief,
           '**11 December from 7pm to 10pm.**',
           '**11 December from 7pm to 11pm.**')
   WHERE id = '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a'
     AND md5(brief) = '90212a66523a746e982a0e9510c21873';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E15] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a';
  IF v_md5 IS DISTINCT FROM 'bda0eca87bb4862c4fce713c8f4a8928' THEN RAISE EXCEPTION '[E15] brief did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E14] item 13: 13 November Music Bingo FAQ
  UPDATE public.event_faqs
     SET answer = 'The Music Bingo night is on Friday, 13 November 2026, starting at 7pm and running until 11pm.'
   WHERE id IN ('bbea8ff8-f5a0-4fa5-98b8-8d14e3cb8590')
     AND answer = 'The Music Bingo night is on Friday, 13 November 2026, starting at 7pm and running until 10pm.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E14] expected 1 row(s), matched %', v_rows; END IF;

  -- [E13] item 13: 13 November Music Bingo brief
  UPDATE public.events
     SET brief = replace(brief,
           '**13 November from 7pm to 10pm.**',
           '**13 November from 7pm to 11pm.**')
   WHERE id = 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735'
     AND md5(brief) = '314e3cd951b32e3d465e6d64a04b82f0';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E13] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735';
  IF v_md5 IS DISTINCT FROM '6a279e91f150e9208115d6ad321937f6' THEN RAISE EXCEPTION '[E13] brief did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E12] item 13: 16 October Music Bingo FAQ
  UPDATE public.event_faqs
     SET answer = 'Screams & Soundtracks: Classic Horror Music Bingo runs from 7pm to 11pm. Please arrive before the first round starts.'
   WHERE id IN ('12aed652-6304-41b7-9c49-5ed49d795d42')
     AND answer = 'Screams & Soundtracks: Classic Horror Music Bingo runs from 7pm to 10pm. Please arrive before the first round starts.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E12] expected 1 row(s), matched %', v_rows; END IF;

  -- [E11] item 13: 16 October Music Bingo highlights
  UPDATE public.events
     SET highlights = '["7pm to 10.30pm", "£5 cash on arrival", "Communal seating", "Music-led bingo rounds", "Free on-site parking"]'::jsonb
   WHERE id IN ('c3ac7e18-e562-4ef8-bea7-cae29f6e96ac')
     AND highlights = '["7pm to 10pm", "£5 cash on arrival", "Communal seating", "Music-led bingo rounds", "Free on-site parking"]'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E11] expected 1 row(s), matched %', v_rows; END IF;

  -- [E10] item 13: 16 October Music Bingo brief
  UPDATE public.events
     SET brief = replace(brief,
           '**16 October from 7pm to 10pm.**',
           '**16 October from 7pm to 11pm.**')
   WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac'
     AND md5(brief) = '3e18b206a67400576e001404f5dba464';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E10] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac';
  IF v_md5 IS DISTINCT FROM 'f576daf0a598e6f3a20a8a577293b213' THEN RAISE EXCEPTION '[E10] brief did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E9] item 13: 16 October Music Bingo long description
  UPDATE public.events
     SET long_description = replace(long_description,
           'running from 7pm to 10pm.',
           'running from 7pm to 11pm.')
   WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac'
     AND md5(long_description) = 'cc8a84f509c4cfb51d370012b99ec014';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E9] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac';
  IF v_md5 IS DISTINCT FROM '183dcfe2044cb1a9bd9522e60d3f4dc5' THEN RAISE EXCEPTION '[E9] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E8] item 13: 18 September karaoke FAQ
  UPDATE public.event_faqs
     SET answer = 'The standard event runs from 8pm to 11.30pm. Check the event page for any date-specific change.'
   WHERE id IN ('9150b4f6-2a8d-466d-96c2-2651eba615dd')
     AND answer = 'The standard event runs from 8pm to 10pm. Check the event page for any date-specific change.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E8] expected 1 row(s), matched %', v_rows; END IF;

  -- [E7] item 13: 18 September karaoke brief (header line and body)
  UPDATE public.events
     SET brief = replace(replace(brief,
           'runs from **8pm to 10pm**',
           'runs from **8pm to 11.30pm**'),
           '| 8pm to 10pm**',
           '| 8:00pm to 11:30pm**')
   WHERE id = '9d03a427-d331-45bd-91af-142b396b82ae'
     AND md5(brief) = '6a9eb8e25dc6a79a276da7e93635956b';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E7] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '9d03a427-d331-45bd-91af-142b396b82ae';
  IF v_md5 IS DISTINCT FROM 'e766ce87262b637a02fce3f1c0c54f2e' THEN RAISE EXCEPTION '[E7] brief did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E6] item 13: 18 September karaoke long description
  UPDATE public.events
     SET long_description = replace(long_description,
           'running from 8pm to 10pm.',
           'running from 8pm to 11.30pm.')
   WHERE id = '9d03a427-d331-45bd-91af-142b396b82ae'
     AND md5(long_description) = 'b2c7c671ea6beae0143214e038ae0568';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E6] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = '9d03a427-d331-45bd-91af-142b396b82ae';
  IF v_md5 IS DISTINCT FROM '5821b9a72d4f01194972f033645c2c69' THEN RAISE EXCEPTION '[E6] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E5] item 13: 11 September Music Bingo (cancelled) FAQ
  UPDATE public.event_faqs
     SET answer = 'The Detention Disco: Back to School Music Bingo starts at 7pm and runs until 11pm on 11 September 2026.'
   WHERE id IN ('11572627-58bf-484d-8a6c-75b45f2f341e')
     AND answer = 'The Detention Disco: Back to School Music Bingo starts at 7pm and runs until 10pm on 11 September 2026.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E5] expected 1 row(s), matched %', v_rows; END IF;

  -- [E4] item 13: 11 September Music Bingo (cancelled) highlights
  UPDATE public.events
     SET highlights = '["7pm to 11pm", "£5 cash entry", "communal seating", "themed music bingo rounds", "free on-site parking"]'::jsonb
   WHERE id IN ('5cdadf74-97c1-4ec0-b495-d369a7304494')
     AND highlights = '["7pm to 10pm", "£5 cash entry", "communal seating", "themed music bingo rounds", "free on-site parking"]'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E4] expected 1 row(s), matched %', v_rows; END IF;

  -- [E3] item 13: 11 September Music Bingo (cancelled) brief
  UPDATE public.events
     SET brief = replace(brief,
           '**11 September from 7pm to 10pm.**',
           '**11 September from 7pm to 11pm.**')
   WHERE id = '5cdadf74-97c1-4ec0-b495-d369a7304494'
     AND md5(brief) = '25a0a7a66baeaaf54b35d188cdf0b2b6';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '5cdadf74-97c1-4ec0-b495-d369a7304494';
  IF v_md5 IS DISTINCT FROM '679833e5af283e8fc21c0dc3fc8d578d' THEN RAISE EXCEPTION '[E3] brief did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E2] item 13: 11 September Music Bingo (cancelled) long description
  UPDATE public.events
     SET long_description = replace(long_description,
           '11 September 2026, from 7pm to 10pm.',
           '11 September 2026, from 7pm to 11pm.')
   WHERE id = '5cdadf74-97c1-4ec0-b495-d369a7304494'
     AND md5(long_description) = 'c04f55d126a1f590a9f3a528f05347c6';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[E2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = '5cdadf74-97c1-4ec0-b495-d369a7304494';
  IF v_md5 IS DISTINCT FROM '3b75c27b654d4a849c507c3501e08082' THEN RAISE EXCEPTION '[E2] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [E1] item 13: end time and duration on the six upcoming events that end after 22:00 (Halloween excluded)
  UPDATE public.events AS e
     SET end_time = x.new_end_time, duration_minutes = x.new_duration_minutes
    FROM (VALUES
      ('5cdadf74-97c1-4ec0-b495-d369a7304494'::uuid, '19:00', '22:00:00'::time, 180, '23:00:00'::time, 240),
      ('9d03a427-d331-45bd-91af-142b396b82ae'::uuid, '20:00', '22:00:00'::time, 120, '23:30:00'::time, 210),
      ('c3ac7e18-e562-4ef8-bea7-cae29f6e96ac'::uuid, '19:00', '22:00:00'::time, 180, '23:00:00'::time, 240),
      ('c3e9fbbd-df4a-41f2-a1c6-8194a5979735'::uuid, '19:00', '22:00:00'::time, 180, '23:00:00'::time, 240),
      ('5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'::uuid, '19:00', '22:00:00'::time, 180, '22:30:00'::time, 210),
      ('9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a'::uuid, '19:00', '22:00:00'::time, 180, '23:00:00'::time, 240)
    ) AS x(id, g_time, old_end_time, old_duration_minutes, new_end_time, new_duration_minutes)
   WHERE e.id = x.id
     AND e.time = x.g_time
     AND e.end_time = x.old_end_time
     AND e.duration_minutes = x.old_duration_minutes;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 6 THEN RAISE EXCEPTION '[E1] expected 6 row(s), matched %', v_rows; END IF;

  -- [M3] item 13: Music Bingo category FAQ "What time is Music Bingo?"
  UPDATE public.event_categories
     SET faqs = (replace(faqs::text,
           'Music Bingo runs from 7pm to 10pm.',
           'Music Bingo runs from 7pm to 10.30pm.'))::jsonb
   WHERE id = '8493fffe-b218-484c-8646-4e28cfd6c2f8'
     AND md5(faqs::text) = '71eb62d5500d49c63415c5282d7f593c';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[M3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(faqs::text) INTO v_md5 FROM public.event_categories WHERE id = '8493fffe-b218-484c-8646-4e28cfd6c2f8';
  IF v_md5 IS DISTINCT FROM '77a5f9315e5b09cec40279b76c2a3b57' THEN RAISE EXCEPTION '[M3] faqs did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [M2] item 13: Music Bingo category long description, finish time
  UPDATE public.event_categories
     SET long_description = replace(long_description,
           'The event runs from 7pm to 10pm.',
           'The event runs from 7pm to 10.30pm.')
   WHERE id = '8493fffe-b218-484c-8646-4e28cfd6c2f8'
     AND md5(long_description) = 'b2a535b191be920bd4b451eaf0b185b3';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[M2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.event_categories WHERE id = '8493fffe-b218-484c-8646-4e28cfd6c2f8';
  IF v_md5 IS DISTINCT FROM '009c122e0d2071b0abb05fb7712575fe' THEN RAISE EXCEPTION '[M2] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [M1] item 13: Music Bingo default finish and short copy
  UPDATE public.event_categories
     SET default_end_time = '22:30:00'::time,
         default_duration_minutes = 210,
         short_description = 'Play Music Bingo at The Anchor in Stanwell Moor from 7pm to 10.30pm. Entry is £5 cash on arrival and seating is communal.',
         meta_description = U&'Play Music Bingo at The Anchor, Stanwell Moor, 7pm\201310.30pm. £5 cash entry, communal seating and free parking near Heathrow and Staines.',
         highlights = '["7pm to 10.30pm", "£5 cash on arrival", "Communal seating", "Music-led bingo rounds", "Free on-site parking"]'::jsonb
   WHERE id = '8493fffe-b218-484c-8646-4e28cfd6c2f8'
     AND name = 'Music Bingo'
     AND default_start_time = '19:00:00'::time
     AND default_end_time = '22:00:00'::time
     AND default_duration_minutes = 180
     AND short_description = 'Play Music Bingo at The Anchor in Stanwell Moor from 7pm to 10pm. Entry is £5 cash on arrival and seating is communal.'
     AND meta_description = 'Play Music Bingo at The Anchor, Stanwell Moor, 7pm to 10pm. £5 cash entry, communal seating and free parking near Heathrow and Staines.'
     AND highlights = '["7pm to 10pm", "£5 cash on arrival", "Communal seating", "Music-led bingo rounds", "Free on-site parking"]'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[M1] expected 1 row(s), matched %', v_rows; END IF;

  -- [9a] item 9: Parties default capacity
  UPDATE public.event_categories
     SET default_capacity = 100
   WHERE id = 'a3e13e87-816b-48cb-ba8f-ef6f9ae68b36'
     AND name = 'Parties'
     AND default_capacity = 150;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[9a] expected 1 row(s), matched %', v_rows; END IF;

  -- [K3] item 13: Karaoke Night category FAQ "What time does Karaoke Night run?"
  UPDATE public.event_categories
     SET faqs = (replace(faqs::text,
           'The standard event runs from 8pm to 10pm.',
           'The standard event runs from 8pm to 11.30pm.'))::jsonb
   WHERE id = 'cd28081e-7840-47a6-b5ea-fdec561147c1'
     AND md5(faqs::text) = '515599247270711e51d8cdf2a088e8cd';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[K3] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(faqs::text) INTO v_md5 FROM public.event_categories WHERE id = 'cd28081e-7840-47a6-b5ea-fdec561147c1';
  IF v_md5 IS DISTINCT FROM 'eb390c08c20115fddfdbc26913e87174' THEN RAISE EXCEPTION '[K3] faqs did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [K2] item 13: Karaoke Night category long description, finish time
  UPDATE public.event_categories
     SET long_description = replace(long_description,
           'The standard Karaoke Night runs from 8pm to 10pm and entry is free.',
           'The standard Karaoke Night runs from 8pm to 11.30pm and entry is free.')
   WHERE id = 'cd28081e-7840-47a6-b5ea-fdec561147c1'
     AND md5(long_description) = '8eb6a01d353608eb1bc6d19c735d8cef';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[K2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.event_categories WHERE id = 'cd28081e-7840-47a6-b5ea-fdec561147c1';
  IF v_md5 IS DISTINCT FROM '3736d837fefcb05f5c496d728e530a4a' THEN RAISE EXCEPTION '[K2] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [K1] item 9, 13: Karaoke Night default capacity and default finish
  UPDATE public.event_categories
     SET default_capacity = 80,
         default_end_time = '23:30:00'::time,
         default_duration_minutes = 210
   WHERE id = 'cd28081e-7840-47a6-b5ea-fdec561147c1'
     AND name = 'Karaoke Night'
     AND default_start_time = '20:00:00'::time
     AND default_capacity = 60
     AND default_end_time = '22:00:00'::time
     AND default_duration_minutes = 120;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[K1] expected 1 row(s), matched %', v_rows; END IF;

  -- [8a] item 8: The Main Area description
  UPDATE public.venue_spaces
     SET description = 'Want to host a big party with a lively atmosphere? Look no further than our Main Pub area. With a bar running along one wall, this spacious area is perfect for hosting discos, DJs, and live music. This space can accommodate up to 29 guests seated and up to 150 standing guests.'
   WHERE id = '1ada077a-df42-4cd6-b7c3-880ee6af8cbd'
     AND name = 'The Main Area'
     AND description = 'Want to host a big party with a lively atmosphere? With a bar running along one wall, our spacious Main Pub area is perfect for hosting discos and DJs. This space can accommodate up to 29 guests seated and up to 150 standing guests.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[8a] expected 1 row(s), matched %', v_rows; END IF;

  -- [7a] item 7: Live Music category switched off
  UPDATE public.event_categories
     SET is_active = true
   WHERE id = 'b119adc2-a4d5-465e-a064-713e921fe94b'
     AND name = 'Live Music'
     AND is_active = false;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[7a] expected 1 row(s), matched %', v_rows; END IF;

  -- [6a] item 6: Beetroot & Butternut Squash Wellington dietary_info
  UPDATE public.sunday_lunch_menu_items
     SET dietary_info = ARRAY['Vegetarian']::text[]
   WHERE id = '7da6244a-1588-44fc-ae2c-94c077ae844f'
     AND name = 'Beetroot & Butternut Squash Wellington'
     AND dietary_info = ARRAY['Vegan']::text[];
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[6a] expected 1 row(s), matched %', v_rows; END IF;

  -- [5e] item 5: catering Tex-Mex Hot Buffet
  UPDATE public.catering_packages
     SET dietary_notes = 'Vegetarian option included. Can be made gluten-free with advance notice (check tortilla chips).',
         good_to_know = U&'Can be made fully gluten-free \2014 check with us when booking. Vegetarian option included as standard.'
   WHERE id = 'bb32cf67-40b1-471a-b0a5-a49e5e160dfb'
     AND name = 'Tex-Mex Hot Buffet'
     AND dietary_notes = 'Vegetarian option included. Can be made NGCI with advance notice (check tortilla chips). NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination.'
     AND good_to_know = 'Can be made NGCI. Check with us when booking. NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination. Vegetarian option included as standard.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[5e] expected 1 row(s), matched %', v_rows; END IF;

  -- [5d] item 5: catering Mediterranean Hot Buffet
  UPDATE public.catering_packages
     SET good_to_know = 'Can be made gluten-free by substituting flatbreads for extra rice and potatoes. Vegetarian option included as standard.'
   WHERE id = '41cbc52c-c4a1-4bd9-afa6-75331116af40'
     AND name = 'Mediterranean Hot Buffet'
     AND good_to_know = 'Can be made NGCI by substituting flatbreads for extra rice and potatoes. NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination. Vegetarian option included as standard.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[5d] expected 1 row(s), matched %', v_rows; END IF;

  -- [5c] item 5: catering Indian-Inspired Curry Buffet
  UPDATE public.catering_packages
     SET dietary_notes = 'Contains coconut. Vegetarian option included. Can be made gluten-free with advance notice.',
         good_to_know = U&'Can be made fully gluten-free \2014 check with us when booking. Vegetarian option included as standard.'
   WHERE id = 'c31085bb-233b-4532-a17a-48e7a8ec299a'
     AND name = 'Indian-Inspired Curry Buffet'
     AND dietary_notes = 'Contains coconut. Vegetarian option included. Can be made NGCI with advance notice. NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination.'
     AND good_to_know = 'Can be made NGCI. Check with us when booking. NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination. Vegetarian option included as standard.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[5c] expected 1 row(s), matched %', v_rows; END IF;

  -- [5b] item 5: catering Prosecco Afternoon Tea
  UPDATE public.catering_packages
     SET dietary_notes = 'Vegetarian and gluten-free options available on request. Non-alcoholic alternative available.'
   WHERE id = 'b6185f33-15e0-43a9-abb5-a300bfdfd32b'
     AND name = 'Prosecco Afternoon Tea'
     AND dietary_notes = 'Vegetarian and NGCI options available on request. NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination. Non-alcoholic alternative available.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[5b] expected 1 row(s), matched %', v_rows; END IF;

  -- [5a] item 5: catering Afternoon Tea
  UPDATE public.catering_packages
     SET dietary_notes = 'Vegetarian and gluten-free options available on request.',
         good_to_know = 'Dietary requirements can be catered for with advance notice. Gluten-free and vegetarian options available.'
   WHERE id = 'edfd2701-d354-4bf4-b98d-9471895e7854'
     AND name = 'Afternoon Tea'
     AND dietary_notes = 'Vegetarian and NGCI options available on request. NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination.'
     AND good_to_know = 'Dietary requirements can be catered for with advance notice. NGCI and vegetarian options available. NGCI means No Gluten Containing Ingredients. These dishes are made without gluten-containing ingredients, but everything is prepared in one kitchen, so we can''t guarantee there''s no cross-contamination.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[5a] expected 1 row(s), matched %', v_rows; END IF;

  -- [4a] item 4: sites row for The Anchor
  UPDATE public.sites
     SET phone = '+44 1372 377 945',
         email = 'info@the-anchor.pub',
         address = 'The Anchor, 17 Church Street, Leatherhead, KT22 8DN',
         min_group_size_deposit = 10
   WHERE id = '1d83ea72-4f2a-4778-ba15-497bd0808c3d'
     AND name = 'The Anchor'
     AND phone = '+44 1753 682 707'
     AND email = 'manager@the-anchor.pub'
     AND address = 'The Anchor, Horton Road, Stanwell Moor, Surrey, TW19 6AQ'
     AND min_group_size_deposit = 15;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[4a] expected 1 row(s), matched %', v_rows; END IF;

  -- [3e] item 3: business_amenities dogFriendly
  UPDATE public.business_amenities
     SET details = 'Dogs welcome in bar area and garden'
   WHERE id = 'db0b1f25-8233-475e-961d-fd43894b9401'
     AND type = 'dogFriendly'
     AND details = 'Dogs are welcome throughout the pub, on a lead. We''ll have water bowls and biscuits waiting.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[3e] expected 1 row(s), matched %', v_rows; END IF;

  -- [3d] item 3: business_amenities liveMusic
  UPDATE public.business_amenities
     SET available = true,
         details = 'Live music every Friday and Saturday'
   WHERE id = '5a4626e8-8833-47f1-9520-f63b44303ff1'
     AND type = 'liveMusic'
     AND available = false
     AND details = 'Live music is discontinued in full.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[3d] expected 1 row(s), matched %', v_rows; END IF;

  -- [3c] item 3: business_amenities beerGarden
  UPDATE public.business_amenities
     SET details = 'Large beer garden with covered areas',
         capacity = 100,
         additional_info = '{"covered_areas":true,"heatingAvailable":true}'::jsonb
   WHERE id = '930296c8-98cf-42f9-a210-c460404d3f9d'
     AND type = 'beerGarden'
     AND details = 'Beer garden for 64 seated or 250 standing. It''s not covered or heated.'
     AND capacity = 64
     AND additional_info = '{"covered_areas":false,"heatingAvailable":false}'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[3c] expected 1 row(s), matched %', v_rows; END IF;

  -- [3b] item 3: business_amenities wheelchairAccess
  UPDATE public.business_amenities
     SET details = 'Full wheelchair access throughout',
         additional_info = '{"ramp":true,"accessible_toilet":true}'::jsonb
   WHERE id = '77539ea6-d4d6-4e0f-b642-33b884042497'
     AND type = 'wheelchairAccess'
     AND details = 'Getting in from the car park is step free, and so are the bar and the dining area. The beer garden is step free straight from the car park. From inside, there''s one step between the bar and the garden, and we''ll put our ramp out for it if you ask. We don''t have an accessible toilet. If you''d like to check what will work best for you, give us a call on 01753 682707 and we''ll help.'
     AND additional_info = '{"ramp":true,"accessible_toilet":false}'::jsonb;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[3b] expected 1 row(s), matched %', v_rows; END IF;

  -- [3a] item 3: business_amenities parking
  UPDATE public.business_amenities
     SET details = 'Free parking for 50 cars',
         capacity = 50
   WHERE id = '6041f69c-d9d8-4cd0-ac88-5457e33a77b1'
     AND type = 'parking'
     AND details = 'We''ve 20 free spaces right outside. There''s no time limit while you''re with us, and nothing to register.'
     AND capacity = 20;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[3a] expected 1 row(s), matched %', v_rows; END IF;

  -- [2c] item 2: 25 September quiz, FAQ "What time does the quiz start?"
  UPDATE public.event_faqs
     SET answer = 'The quiz starts at 7pm sharp. Please arrive from 6.45pm and be seated by 6.55pm so your team is ready for the first round.'
   WHERE id IN ('7151e5ca-0cac-4cd7-8e10-5605df7b4755')
     AND answer = 'Arrive from 6:30pm for a 7pm start.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[2c] expected 1 row(s), matched %', v_rows; END IF;

  -- [2b] item 2: 25 September quiz brief, the two arrival lines under "Key information"
  UPDATE public.events
     SET brief = replace(brief,
           '- Arrive from 6:30pm for a 7pm start.',
           ('- Arrive from: **6.45pm**' || E'\r\n' || '- Please be seated by: **6.55pm**'))
   WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240'
     AND md5(brief) = '02ff228dd3e9eaf3122835c00d5c46e8';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[2b] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240';
  IF v_md5 IS DISTINCT FROM '8b4efc34c382395f149974a7bce74b53' THEN RAISE EXCEPTION '[2b] brief did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [2a] item 2: 25 September quiz long description, arrival sentence
  UPDATE public.events
     SET long_description = replace(long_description,
           'Arrive from 6:30pm for a 7pm start.',
           'Arrive from 6.45pm, be seated by 6.55pm and get ready for a 7pm sharp start.')
   WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240'
     AND md5(long_description) = 'ebad24a7e1b391fcb199e4c1c6424684';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[2a] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240';
  IF v_md5 IS DISTINCT FROM '42293eba58b02bae7bc8d795f06e1996' THEN RAISE EXCEPTION '[2a] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [T3] item 2: 20 November tasting night, FAQ "What time does the Tasting Night start?"
  UPDATE public.event_faqs
     SET answer = 'The Tasting Night starts at 7:00 PM, but doors open at 6:45 PM for you to grab your hot mulled cider and settle in comfortably.'
   WHERE id IN ('fa0fd7b3-fe67-4eb5-952c-80b0f1e1195c')
     AND answer = 'Arrive from 6:30pm for a 7pm start.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[T3] expected 1 row(s), matched %', v_rows; END IF;

  -- [T2] item 2, 13: 20 November tasting night brief: header times, the "Doors open" schedule line, the finish line
  UPDATE public.events
     SET brief = replace(replace(replace(brief,
           U&'**By 10pm \00B7 The tasting night finishes**',
           U&'**By 10:30 PM \00B7 The tasting night finishes**'),
           '**Arrive from 6:30pm for a 7pm start.**',
           U&'**6:45 PM \00B7 Doors open**'),
           U&'**Friday 20 November 2026 \00B7 7pm to 10pm**',
           U&'**Friday 20 November 2026 \00B7 7:00 PM to 10:30 PM**')
   WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'
     AND md5(brief) = 'e475a2175e034f313d80d6cb597c7859';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[T2] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(brief) INTO v_md5 FROM public.events WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65';
  IF v_md5 IS DISTINCT FROM 'f407554a6b2ab91fa737488df56fe938' THEN RAISE EXCEPTION '[T2] brief did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [T1] item 1, 2, 13: 20 November tasting night long description: 10pm finish, arrival line, "accessible for all" sentence removed, nothing else touched
  UPDATE public.events
     SET long_description = replace(replace(replace(long_description,
           U&'free parking available. If you\2019re',
           U&'free parking available. It\2019s a ground-floor venue, so it\2019s accessible for all. If you\2019re'),
           'Arrive from 6:30pm for a 7pm start.',
           'Make sure to arrive by 6:45 PM to grab your cider and get comfy.'),
           'on 20 November from 7pm to 10pm.',
           'on 20 November from 7:00 PM to 10:30 PM.')
   WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'
     AND md5(long_description) = 'bcb05c5f1239f086ca62ba2ebc08173e';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[T1] expected 1 row(s), matched %', v_rows; END IF;
  SELECT md5(long_description) INTO v_md5 FROM public.events WHERE id = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65';
  IF v_md5 IS DISTINCT FROM 'ce01cf959743ee3f652c25f08cecdeb5' THEN RAISE EXCEPTION '[T1] long_description did not return to the value captured on 11 September 2026 (md5 %)', v_md5; END IF;

  -- [1e] item 1: 20 November tasting night, FAQ "Is the venue accessible for the Tasting Night?"
  UPDATE public.event_faqs
     SET answer = 'Yes, The Anchor is a ground-floor venue with step-free access from the car park, making it accessible for everyone.'
   WHERE id IN ('f7843deb-a9fd-4c98-8ece-c988569246a3')
     AND answer = 'Getting in from the car park is step free, and so are the bar and the dining area. The beer garden is step free straight from the car park. From inside, there''s one step between the bar and the garden, and we''ll put our ramp out for it if you ask. We don''t have an accessible toilet. If you''d like to check what will work best for you, give us a call on 01753 682707 and we''ll help.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[1e] expected 1 row(s), matched %', v_rows; END IF;

  -- [1d] item 1: 20 November tasting night accessibility notes
  UPDATE public.events
     SET accessibility_notes = 'The Anchor offers step-free access throughout the ground floor with an accessible toilet. For specific accessibility requirements, please call 01753 682707.'
   WHERE id IN ('5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65')
     AND accessibility_notes = 'Getting in from the car park is step free, and so are the bar and the dining area. The beer garden is step free straight from the car park. From inside, there''s one step between the bar and the garden, and we''ll put our ramp out for it if you ask. We don''t have an accessible toilet. If you''d like to check what will work best for you, give us a call on 01753 682707 and we''ll help.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[1d] expected 1 row(s), matched %', v_rows; END IF;

  -- [1c] item 1: 25 September quiz, FAQ "Is the venue accessible?"
  UPDATE public.event_faqs
     SET answer = 'Partly. The bar and dining area are step-free from the level car park. The beer garden has steps, with a ramp available on request. We do not currently have an accessible toilet. Assistance dogs are welcome. Call 01753 682707 and we will help you plan your visit.'
   WHERE id IN ('aff4ec7a-33cb-49a2-abc9-095168f8c8bc')
     AND answer = 'Getting in from the car park is step free, and so are the bar and the dining area. The beer garden is step free straight from the car park. From inside, there''s one step between the bar and the garden, and we''ll put our ramp out for it if you ask. We don''t have an accessible toilet. If you''d like to check what will work best for you, give us a call on 01753 682707 and we''ll help.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '[1c] expected 1 row(s), matched %', v_rows; END IF;

  -- [1b] item 1: accessibility notes on all 10 active categories (runs before Live Music is switched off in [7a])
  UPDATE public.event_categories
     SET accessibility_notes = 'The bar and dining area are step-free from the level car park. The beer garden has steps, with a ramp available on request. We do not currently have an accessible toilet. Assistance dogs are welcome. Please call 01753 682707 to discuss specific access needs.'
   WHERE id IN ('715cc457-a90c-48e8-a774-da13addf19ed', '8da89912-b2c6-4b93-bf7a-f8e68f2dae24', '9a39d780-91bb-4e53-b3cf-11d76e59dcb0', 'cd28081e-7840-47a6-b5ea-fdec561147c1', 'b119adc2-a4d5-465e-a064-713e921fe94b', '150badde-489b-44a6-9401-945cd96a75af', '8493fffe-b218-484c-8646-4e28cfd6c2f8', 'a3e13e87-816b-48cb-ba8f-ef6f9ae68b36', '65bf6647-3d76-4bb8-a719-572acbb6fb5a', '6c12979d-a6ae-428f-8a71-e64f4a006404')
     AND accessibility_notes = 'Getting in from the car park is step free, and so are the bar and the dining area. The beer garden is step free straight from the car park. From inside, there''s one step between the bar and the garden, and we''ll put our ramp out for it if you ask. We don''t have an accessible toilet. If you''d like to check what will work best for you, give us a call on 01753 682707 and we''ll help.'
     AND is_active = true;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 10 THEN RAISE EXCEPTION '[1b] expected 10 row(s), matched %', v_rows; END IF;

  -- [1a] item 1: accessibility notes on the 14 upcoming events that carry the old template
  UPDATE public.events
     SET accessibility_notes = 'The bar and dining area are step-free from the level car park. The beer garden has steps, with a ramp available on request. We do not currently have an accessible toilet. Assistance dogs are welcome. Please call 01753 682707 to discuss specific access needs.'
   WHERE id IN ('5cdadf74-97c1-4ec0-b495-d369a7304494', '9b78f364-7712-4c92-9b09-ffa9132e37e5', '9d03a427-d331-45bd-91af-142b396b82ae', 'e9e84ee8-c59b-4f93-80f6-7e7961a03240', 'd81512e7-5e99-48fd-a153-3400c2f6f009', '76ec328b-48f8-47c0-b041-cc405e085deb', 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac', 'd52cbd18-d293-4516-beca-e151eaa90180', '8acfe965-ade6-4a9f-a666-e90ecdea2b7b', 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735', '6e761f65-8b17-4bc9-8a01-d032b77f6a66', 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25', '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a', 'b9334958-76b4-4504-a64a-0d47145bd75e')
     AND accessibility_notes = 'Getting in from the car park is step free, and so are the bar and the dining area. The beer garden is step free straight from the car park. From inside, there''s one step between the bar and the garden, and we''ll put our ramp out for it if you ask. We don''t have an accessible toilet. If you''d like to check what will work best for you, give us a call on 01753 682707 and we''ll help.';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 14 THEN RAISE EXCEPTION '[1a] expected 14 row(s), matched %', v_rows; END IF;

  RAISE NOTICE 'rollback ssot_record_and_content_corrections: 60 corrections reversed';
END
$rollback$;
