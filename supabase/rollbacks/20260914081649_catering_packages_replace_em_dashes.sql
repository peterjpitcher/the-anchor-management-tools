-- Rollback for supabase/migrations/20260914081649_catering_packages_replace_em_dashes.sql.
--
-- Tested on 14 September 2026 before the migration was applied: the migration's block and this
-- one ran back to back against production inside a single DO block that then raised, so nothing
-- was kept. All 32 fields came out at their checked md5s and this block restored every one.
--
-- Puts the em dash back into the 32 catering package fields. Running it republishes punctuation
-- that house style bans in customer-facing text, so there is no operational reason to run it. It
-- exists so the pair is complete and so putting the dashes back is a deliberate, recorded act.
--
-- It only touches a field that still holds exactly the text the migration wrote, so it cannot undo
-- an edit somebody has made since. Each field swaps back one short fragment that appears exactly
-- once in it (checked when this file was generated) and must come out at its original md5.

DO $rollback$
DECLARE
  c_em CONSTANT text := chr(8212);
  v_fix record;
  v_rows integer;
  v_md5 text;
  v_fields integer := 0;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  FOR v_fix IN
    SELECT *
      FROM (VALUES
      ('9fdbf82b-6717-4bff-8af6-8865cb5bfe21'::uuid, 'guest_description', 'fe6822267ab2892c97093c7b5b3c8014', '817860b19ea6974f40124c90efe668ca', 'y fine. A waiver will ', 'y fine {EM} a waiver will '),
      ('629353c6-472b-4bfc-85b8-23643d74d9d8'::uuid, 'guest_description', '044f92da279ff1107575b03186246965', '94129cd36742e91ee005d3f3ecd00930', 't menu, a seas', 't menu {EM} a seas'),
      ('dc29c1f5-9417-4d2b-ae9d-87b35183c5af'::uuid, 'guest_description', '0e86f302a73caa6fefe7fb65c354cc17', '6bab333d589fa79ac57cdfd214af60fb', ' price: our si', ' price {EM} our si'),
      ('d500fd41-e37d-4b8d-9791-2748323de660'::uuid, 'summary', 'e5dffda68bbb843a7d8460e554a57b45', '38472abd9ef6056bf31539b02d7e0b75', ' fours, a perf', ' fours {EM} a perf'),
      ('edfd2701-d354-4bf4-b98d-9471895e7854'::uuid, 'summary', 'ab6d61bf7b5438d06860cf49d3c3be45', '3ff9770127cf18ef7b4dc8650ba7b415', 'spread, perfec', 'spread {EM} perfec'),
      ('edfd2701-d354-4bf4-b98d-9471895e7854'::uuid, 'guest_description', '8a0407cc9b2fd162b071e2551d68430c', '6fe35416ce045b0ebfd533aa301e4d29', 'on tea: delica', 'on tea {EM} delica'),
      ('b6185f33-15e0-43a9-abb5-a300bfdfd32b'::uuid, 'summary', '0f1b6e08457a7d732f1d9182c08d4baa', 'cc89c5e16f9df3a55c622a5fe7cdb430', 'rrival, ideal ', 'rrival {EM} ideal '),
      ('b6185f33-15e0-43a9-abb5-a300bfdfd32b'::uuid, 'guest_description', '146400ad865dd320d9d233b450cf27a2', '653975142e4d72fdf22eb4106630c877', 'ration: welcom', 'ration {EM} welcom'),
      ('10e7153e-3bfc-4791-8f2a-02981d72fed0'::uuid, 'guest_description', '68378854fb184e8ac89573179e7a1db7', '1b755f0e2378ec7487cf0b4517e04b35', 'pizzas, perfec', 'pizzas {EM} perfec'),
      ('c31085bb-233b-4532-a17a-48e7a8ec299a'::uuid, 'guest_description', '4c51e5e3e0215bbc4a7ad949031d71eb', 'd512ccbe269ffbf6f71fe207035992e8', 'guests, served', 'guests {EM} served'),
      ('bb32cf67-40b1-471a-b0a5-a49e5e160dfb'::uuid, 'guest_description', 'ba7f921801a7c33b89022f495b45523d', '29b0d0fc69d279eac063bbc2e8fe4d83', 'buffet: smoky ', 'buffet {EM} smoky '),
      ('7423d70e-2627-4e8e-b8e1-a7b5fa91600c'::uuid, 'guest_description', 'c534ca67765d732caa7214a0dea6b6cc', 'dc41bfa56fb876ec6bb7accd4b746484', 'events, ready ', 'events {EM} ready '),
      ('64f05d5c-f68a-4261-8705-3a8ce09416a5'::uuid, 'guest_description', 'f67f4d563741cada7ea10eeab3e8dcd1', '0320ee6805acb3af748c60dd896d367c', ' event, great ', ' event {EM} great '),
      ('0b31b557-f70c-44af-8a83-fbcae0b0157f'::uuid, 'guest_description', 'abf3b0c6dc97c1eecc6477a0fcc36b1b', 'a0e820b41687087bb83678527dd11d88', 'ourite: crispy', 'ourite {EM} crispy'),
      ('7fddf321-91f6-48a2-9758-64c02f4bab7a'::uuid, 'guest_description', 'efaac2f47afe002ab0165fe281d84246', 'a1d4ab15fc1a72896aabd1e5a35691fa', 'spread: beef, ', 'spread {EM} beef, '),
      ('41cbc52c-c4a1-4bd9-afa6-75331116af40'::uuid, 'dietary_notes', '4cd3760d616d605fe65af56b62b9c371', '19480ad03c90efcaae1323096fef4d43', 'ntain gluten (can be substituted with advance notice).', 'ntain gluten {EM} can be substituted with advance notice.'),
      ('41cbc52c-c4a1-4bd9-afa6-75331116af40'::uuid, 'guest_description', '6850eeae1aae8508cb3de33e8b11ed32', 'e4955b548f68f6467c17c008b2d3c4b2', 'tagine, served', 'tagine {EM} served'),
      ('c7af241d-a24d-416c-a75e-79da55ffaecd'::uuid, 'served', 'c489293b302db82b5976ade840e90421', '9154c85ba4e713d67cc26449d199f27d', 'n-site: guests', 'n-site {EM} guests'),
      ('c7af241d-a24d-416c-a75e-79da55ffaecd'::uuid, 'guest_description', '665d3d3e24192f8e5522c21a6f3dc81c', '3651dde931e90f3b8164a626cd0f0bad', 'kaging, a fun ', 'kaging {EM} a fun '),
      ('058c7b0b-f3cb-4f06-9c56-6e3060a28f35'::uuid, 'guest_description', 'f37afe4ee30b3882c535c2a121421627', '0f02b506ae9e5b992c49ccc8eca596ae', 'rrival: choose', 'rrival {EM} choose'),
      ('2cb8ce9a-c181-4c8f-bf6f-5b0a4de849c9'::uuid, 'guest_description', 'a589a9df3962d01286a388b6640a6b6f', '99d7c6a68a58102fb54ee32a9813fc15', 'coffee, ideal ', 'coffee {EM} ideal '),
      ('5dbf956f-8859-4072-bb6b-e715c736c1d1'::uuid, 'guest_description', '86923e238aff679932130b3bf3a67d5f', 'c0cfb9aab9aa8d49e6564542c0326b09', ' chips, a firm', ' chips {EM} a firm'),
      ('c0f62610-9cab-4ba4-bc83-785ef436a608'::uuid, 'guest_description', '735b747247330f540da770700a23436d', 'cbe340870f8a5c3ac12c634929f546d6', 'guests, always', 'guests {EM} always'),
      ('10b9ef30-b53e-4d57-a3d8-14644676336e'::uuid, 'guest_description', '579d219d3eed7e129d11fcb2bee9314c', '5c8e2ce073133a6b8872c95677eb810b', 'eryone: a gene', 'eryone {EM} a gene'),
      ('5e8dba3d-8c50-473f-9a4f-c09299dd23c2'::uuid, 'guest_description', 'b29e36cf14243c896f8c8a54842feadb', 'c1aed5c4391b0bb48595f8448c5b0fd8', 'spread: beauti', 'spread {EM} beauti'),
      ('59e78ed5-4ed5-47a0-9753-7e795033b5b3'::uuid, 'served', 'c80f6a7ef29eebf4f61386cda5840146', '4038be33332edcb7f0723179d36593d8', '-style: guests', '-style {EM} guests'),
      ('59e78ed5-4ed5-47a0-9753-7e795033b5b3'::uuid, 'good_to_know', '3ea2e982a2e5a846c05ca96cec939bcc', '5274197fdaa0f21bb63e01b82823549d', 'r head: beef b', 'r head {EM} beef b'),
      ('59e78ed5-4ed5-47a0-9753-7e795033b5b3'::uuid, 'guest_description', 'd683ca2a7628848cb45a6055fbef7c73', 'fa45969c737fe8bf6de8d451dcccc340', 'salads, all la', 'salads {EM} all la'),
      ('4596dd6f-df49-4090-9ccc-bf60f734c3fe'::uuid, 'guest_description', 'c82500576fee66c6b698b5493794365e', '5929bec96bd954d5b3584384d0b2024b', 'h dips, ideal ', 'h dips {EM} ideal '),
      ('8d7ae1fa-aceb-46e4-8183-99002b095314'::uuid, 'guest_description', '90e98d681e3d3e6ad17552f0ae7e58f7', '6809de4d988640277dfc0eb54ac37828', 'r food: a hot ', 'r food {EM} a hot '),
      ('f680eadd-f877-453a-8c31-f094016b454b'::uuid, 'guest_description', 'fd14146b793500bcffa1fd8aba503f1f', '85a1a38ab2ec80ae8340ae930eace0e7', 'ations, an imp', 'ations {EM} an imp'),
      ('cdc720e2-56da-47b1-a691-543490ec2fc7'::uuid, 'guest_description', 'd48f1f201f43c9b0a836071086d632d4', '33170e7076e99c3e0238b11f31add248', 'groups: season', 'groups {EM} season')
      ) AS f(package_id, column_name, md5_before, md5_after, from_text, to_text)
  LOOP
    EXECUTE format(
      'UPDATE public.catering_packages SET %1$I = replace(%1$I, $1, $2) WHERE id = $3 AND md5(%1$I) = $4',
      v_fix.column_name
    ) USING v_fix.from_text, replace(v_fix.to_text, '{EM}', c_em), v_fix.package_id, v_fix.md5_before;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION '% %: rollback expected 1 row, matched %', v_fix.package_id, v_fix.column_name, v_rows;
    END IF;

    EXECUTE format('SELECT md5(%I) FROM public.catering_packages WHERE id = $1', v_fix.column_name)
      INTO v_md5 USING v_fix.package_id;
    IF v_md5 IS DISTINCT FROM v_fix.md5_after THEN
      RAISE EXCEPTION '% %: rollback did not restore the original (md5 %)', v_fix.package_id, v_fix.column_name, v_md5;
    END IF;

    v_fields := v_fields + 1;
  END LOOP;

  IF v_fields <> 32 THEN
    RAISE EXCEPTION 'catering_packages_replace_em_dashes rollback: expected 32 fields, restored %', v_fields;
  END IF;

  RAISE NOTICE 'catering_packages_replace_em_dashes rollback: 32 fields restored in 26 packages';
END
$rollback$;
