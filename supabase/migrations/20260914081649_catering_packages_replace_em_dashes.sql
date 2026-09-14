-- Take the em dashes out of the catering package text that guests read.
--
-- APPLIED to production on 14 September 2026 through the Supabase MCP, which recorded it at
-- version 20260914081649. This file is named after that version, as supabase/migrations/README.md
-- requires, and its SQL below is the statement that ran, minus this note: ledger statement md5
-- 01a393ec7f1f434c43a728c03080d881, 8,966 bytes. Before it was applied, it and its rollback ran
-- back to back against production inside one DO block that then raised, so nothing was kept; both
-- came out as checked.
--
-- Rollback: supabase/rollbacks/20260914081649_catering_packages_replace_em_dashes.sql
--
-- The owner asked on 14 September 2026 for them to go. House style bans the em dash in
-- customer-facing text, and the guest descriptions show in the private hire price estimator on
-- the website. They arrived with the seed migrations that created the packages (20260512000001,
-- 20260512000005, 20260605000000 and 20260804000200), not through the staff editor, so correcting
-- the data is the whole fix.
--
-- WHAT CHANGES (32 fields in 26 of the 30 packages; punctuation only, no wording, price or fact)
--   Every affected field holds exactly one em dash with a space either side. It becomes:
--     a comma in 16 fields, e.g. Petits Fours summary: "bite-sized petits fours, a perfect way"
--     a colon in 14 fields, e.g. Afternoon Tea: "a traditional afternoon tea: delicate finger"
--     a full stop in 1 field, Bring Your Own Food: "That's absolutely fine. A waiver will be"
--     brackets in 1 field, Mediterranean Hot Buffet dietary notes: "Flatbreads contain gluten
--       (can be substituted with advance notice)."
--   The em dash is written as chr(8212) through the placeholder {EM}, so this file holds none.
--   updated_at moves on the 26 rows through the table's existing trigger.
--
-- HOW IT GUARDS ITSELF
--   One DO block. Every field is named by package id and column, with the md5 of its text as read
--   from production on 14 September 2026 and the md5 it must have afterwards. Each UPDATE must
--   match exactly one row and each field must come out at its checked md5, or the block raises and
--   nothing changes. It ends by checking that no em dash is left anywhere in the table. A re-run
--   raises, because the old md5s no longer match. A database without these packages is left alone.

DO $migration$
DECLARE
  c_em CONSTANT text := chr(8212);
  v_fix record;
  v_rows integer;
  v_md5 text;
  v_fields integer := 0;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('public.catering_packages') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.catering_packages WHERE id = 'edfd2701-d354-4bf4-b98d-9471895e7854') THEN
    RAISE NOTICE 'catering_packages_replace_em_dashes: not the production dataset; nothing changed';
    RETURN;
  END IF;

  FOR v_fix IN
    SELECT *
      FROM (VALUES
      ('9fdbf82b-6717-4bff-8af6-8865cb5bfe21'::uuid, 'guest_description', '817860b19ea6974f40124c90efe668ca', 'fe6822267ab2892c97093c7b5b3c8014', ' {EM} a waiver', '. A waiver'),
      ('629353c6-472b-4bfc-85b8-23643d74d9d8'::uuid, 'guest_description', '94129cd36742e91ee005d3f3ecd00930', '044f92da279ff1107575b03186246965', ' {EM} ', ', '),
      ('dc29c1f5-9417-4d2b-ae9d-87b35183c5af'::uuid, 'guest_description', '6bab333d589fa79ac57cdfd214af60fb', '0e86f302a73caa6fefe7fb65c354cc17', ' {EM} ', ': '),
      ('d500fd41-e37d-4b8d-9791-2748323de660'::uuid, 'summary', '38472abd9ef6056bf31539b02d7e0b75', 'e5dffda68bbb843a7d8460e554a57b45', ' {EM} ', ', '),
      ('edfd2701-d354-4bf4-b98d-9471895e7854'::uuid, 'summary', '3ff9770127cf18ef7b4dc8650ba7b415', 'ab6d61bf7b5438d06860cf49d3c3be45', ' {EM} ', ', '),
      ('edfd2701-d354-4bf4-b98d-9471895e7854'::uuid, 'guest_description', '6fe35416ce045b0ebfd533aa301e4d29', '8a0407cc9b2fd162b071e2551d68430c', ' {EM} ', ': '),
      ('b6185f33-15e0-43a9-abb5-a300bfdfd32b'::uuid, 'summary', 'cc89c5e16f9df3a55c622a5fe7cdb430', '0f1b6e08457a7d732f1d9182c08d4baa', ' {EM} ', ', '),
      ('b6185f33-15e0-43a9-abb5-a300bfdfd32b'::uuid, 'guest_description', '653975142e4d72fdf22eb4106630c877', '146400ad865dd320d9d233b450cf27a2', ' {EM} ', ': '),
      ('10e7153e-3bfc-4791-8f2a-02981d72fed0'::uuid, 'guest_description', '1b755f0e2378ec7487cf0b4517e04b35', '68378854fb184e8ac89573179e7a1db7', ' {EM} ', ', '),
      ('c31085bb-233b-4532-a17a-48e7a8ec299a'::uuid, 'guest_description', 'd512ccbe269ffbf6f71fe207035992e8', '4c51e5e3e0215bbc4a7ad949031d71eb', ' {EM} ', ', '),
      ('bb32cf67-40b1-471a-b0a5-a49e5e160dfb'::uuid, 'guest_description', '29b0d0fc69d279eac063bbc2e8fe4d83', 'ba7f921801a7c33b89022f495b45523d', ' {EM} ', ': '),
      ('7423d70e-2627-4e8e-b8e1-a7b5fa91600c'::uuid, 'guest_description', 'dc41bfa56fb876ec6bb7accd4b746484', 'c534ca67765d732caa7214a0dea6b6cc', ' {EM} ', ', '),
      ('64f05d5c-f68a-4261-8705-3a8ce09416a5'::uuid, 'guest_description', '0320ee6805acb3af748c60dd896d367c', 'f67f4d563741cada7ea10eeab3e8dcd1', ' {EM} ', ', '),
      ('0b31b557-f70c-44af-8a83-fbcae0b0157f'::uuid, 'guest_description', 'a0e820b41687087bb83678527dd11d88', 'abf3b0c6dc97c1eecc6477a0fcc36b1b', ' {EM} ', ': '),
      ('7fddf321-91f6-48a2-9758-64c02f4bab7a'::uuid, 'guest_description', 'a1d4ab15fc1a72896aabd1e5a35691fa', 'efaac2f47afe002ab0165fe281d84246', ' {EM} ', ': '),
      ('41cbc52c-c4a1-4bd9-afa6-75331116af40'::uuid, 'dietary_notes', '19480ad03c90efcaae1323096fef4d43', '4cd3760d616d605fe65af56b62b9c371', ' {EM} can be substituted with advance notice.', ' (can be substituted with advance notice).'),
      ('41cbc52c-c4a1-4bd9-afa6-75331116af40'::uuid, 'guest_description', 'e4955b548f68f6467c17c008b2d3c4b2', '6850eeae1aae8508cb3de33e8b11ed32', ' {EM} ', ', '),
      ('c7af241d-a24d-416c-a75e-79da55ffaecd'::uuid, 'served', '9154c85ba4e713d67cc26449d199f27d', 'c489293b302db82b5976ade840e90421', ' {EM} ', ': '),
      ('c7af241d-a24d-416c-a75e-79da55ffaecd'::uuid, 'guest_description', '3651dde931e90f3b8164a626cd0f0bad', '665d3d3e24192f8e5522c21a6f3dc81c', ' {EM} ', ', '),
      ('058c7b0b-f3cb-4f06-9c56-6e3060a28f35'::uuid, 'guest_description', '0f02b506ae9e5b992c49ccc8eca596ae', 'f37afe4ee30b3882c535c2a121421627', ' {EM} ', ': '),
      ('2cb8ce9a-c181-4c8f-bf6f-5b0a4de849c9'::uuid, 'guest_description', '99d7c6a68a58102fb54ee32a9813fc15', 'a589a9df3962d01286a388b6640a6b6f', ' {EM} ', ', '),
      ('5dbf956f-8859-4072-bb6b-e715c736c1d1'::uuid, 'guest_description', 'c0cfb9aab9aa8d49e6564542c0326b09', '86923e238aff679932130b3bf3a67d5f', ' {EM} ', ', '),
      ('c0f62610-9cab-4ba4-bc83-785ef436a608'::uuid, 'guest_description', 'cbe340870f8a5c3ac12c634929f546d6', '735b747247330f540da770700a23436d', ' {EM} ', ', '),
      ('10b9ef30-b53e-4d57-a3d8-14644676336e'::uuid, 'guest_description', '5c8e2ce073133a6b8872c95677eb810b', '579d219d3eed7e129d11fcb2bee9314c', ' {EM} ', ': '),
      ('5e8dba3d-8c50-473f-9a4f-c09299dd23c2'::uuid, 'guest_description', 'c1aed5c4391b0bb48595f8448c5b0fd8', 'b29e36cf14243c896f8c8a54842feadb', ' {EM} ', ': '),
      ('59e78ed5-4ed5-47a0-9753-7e795033b5b3'::uuid, 'served', '4038be33332edcb7f0723179d36593d8', 'c80f6a7ef29eebf4f61386cda5840146', ' {EM} ', ': '),
      ('59e78ed5-4ed5-47a0-9753-7e795033b5b3'::uuid, 'good_to_know', '5274197fdaa0f21bb63e01b82823549d', '3ea2e982a2e5a846c05ca96cec939bcc', ' {EM} ', ': '),
      ('59e78ed5-4ed5-47a0-9753-7e795033b5b3'::uuid, 'guest_description', 'fa45969c737fe8bf6de8d451dcccc340', 'd683ca2a7628848cb45a6055fbef7c73', ' {EM} ', ', '),
      ('4596dd6f-df49-4090-9ccc-bf60f734c3fe'::uuid, 'guest_description', '5929bec96bd954d5b3584384d0b2024b', 'c82500576fee66c6b698b5493794365e', ' {EM} ', ', '),
      ('8d7ae1fa-aceb-46e4-8183-99002b095314'::uuid, 'guest_description', '6809de4d988640277dfc0eb54ac37828', '90e98d681e3d3e6ad17552f0ae7e58f7', ' {EM} ', ': '),
      ('f680eadd-f877-453a-8c31-f094016b454b'::uuid, 'guest_description', '85a1a38ab2ec80ae8340ae930eace0e7', 'fd14146b793500bcffa1fd8aba503f1f', ' {EM} ', ', '),
      ('cdc720e2-56da-47b1-a691-543490ec2fc7'::uuid, 'guest_description', '33170e7076e99c3e0238b11f31add248', 'd48f1f201f43c9b0a836071086d632d4', ' {EM} ', ': ')
      ) AS f(package_id, column_name, md5_before, md5_after, from_text, to_text)
  LOOP
    EXECUTE format(
      'UPDATE public.catering_packages SET %1$I = replace(%1$I, $1, $2) WHERE id = $3 AND md5(%1$I) = $4',
      v_fix.column_name
    ) USING replace(v_fix.from_text, '{EM}', c_em), v_fix.to_text, v_fix.package_id, v_fix.md5_before;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION '% %: expected 1 row, matched %', v_fix.package_id, v_fix.column_name, v_rows;
    END IF;

    EXECUTE format('SELECT md5(%I) FROM public.catering_packages WHERE id = $1', v_fix.column_name)
      INTO v_md5 USING v_fix.package_id;
    IF v_md5 IS DISTINCT FROM v_fix.md5_after THEN
      RAISE EXCEPTION '% %: did not come out as checked (md5 %)', v_fix.package_id, v_fix.column_name, v_md5;
    END IF;

    v_fields := v_fields + 1;
  END LOOP;

  IF v_fields <> 32 THEN
    RAISE EXCEPTION 'catering_packages_replace_em_dashes: expected 32 fields, corrected %', v_fields;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.catering_packages c, jsonb_each_text(to_jsonb(c)) AS kv(key, value)
     WHERE position(c_em IN kv.value) > 0
  ) THEN
    RAISE EXCEPTION 'catering_packages_replace_em_dashes: an em dash is still present';
  END IF;

  RAISE NOTICE 'catering_packages_replace_em_dashes: 32 fields corrected in 26 packages';
END
$migration$;
