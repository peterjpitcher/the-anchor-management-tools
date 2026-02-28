-- Migration: add internal_notes to customers, fix name data, merge duplicates
-- Applied: 2026-02-28

-- 1. Add internal_notes column
ALTER TABLE customers ADD COLUMN IF NOT EXISTS internal_notes TEXT;

-- 2. Handle the special case: first_name = '.' with a real last_name
--    Move last_name to correct position, clear the dot from first_name
UPDATE customers
SET first_name = '',
    internal_notes = 'First name was entered as ''.'' — moved to last name only'
WHERE first_name = '.' AND last_name = 'Howell';

-- 3. Clear all '.' placeholder last names (these were workarounds for a required field)
UPDATE customers
SET last_name = ''
WHERE last_name = '.';

-- 4. Split full names entered into the first_name field
UPDATE customers SET first_name = 'Cameron', last_name = 'Smith'
WHERE id = 'd8e4f64b-a10f-454e-b9a3-56d837f3dd0f';

UPDATE customers SET first_name = 'Victoria', last_name = 'Finnigan'
WHERE id = '3fdcaa63-36a3-4253-a030-72c3ae98e57e';

-- 5. Capitalisation fix: Sam jenkins → Jenkins
UPDATE customers SET last_name = 'Jenkins'
WHERE id = '70be8a85-79f6-4306-8ca2-6b10be5eff60';

-- 6. Typo fix: Sopie → Sophie
UPDATE customers SET first_name = 'Sophie'
WHERE id = '0203804c-772e-4139-919e-8558441643b0';

-- 7. JR Smith — first name corrected
UPDATE customers
SET first_name = 'JR',
    internal_notes = 'First name corrected from ''J r'' to ''JR'''
WHERE id = '1239896f-1368-4642-ae76-0c919c0f8b75';

-- 8. Remove nonsense last names, add notes
UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Back street boys'' removed'
WHERE id = '1d99491e-065a-4525-8533-dc1fef80d778'; -- Amrit

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Leanne Pal'' removed'
WHERE id = '6095eb79-bbdc-4b1f-b4eb-e92bb305f62a'; -- Beth

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''& Dan'' removed — may represent two people'
WHERE id = 'fff41035-8b3c-4525-8aa1-84cf39f21598'; -- Carl

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Airpets'' removed'
WHERE id = 'dd930b83-bc32-4cdb-9d46-6b83d7305afb'; -- Lee

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Paige''s Mum'' removed (relationship note)'
WHERE id = '148c5b6e-f24f-4006-81ea-0b4937ef7b22'; -- Lorraine

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Quiz Night'' removed (event note)'
WHERE id = '38ae9854-511d-412b-8891-a72096bf1c18'; -- Lou Quiz Night

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Pike Pal'' removed'
WHERE id = '01a13e88-9d6e-4a4b-a87e-d20c4458b0ef'; -- Mitch

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''4566'' removed (was phone digits)'
WHERE id = '0a7cc33d-9096-4add-905f-6363ae9f8a56'; -- Nawal

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Sonny mum'' removed (relationship note)'
WHERE id = '61627d05-6621-4282-9bd1-1c15880dbc5a'; -- Rani

UPDATE customers
SET last_name = 'Morris-Latham',
    internal_notes = 'Last name changed from ''Anchor'' to ''Morris-Latham'''
WHERE id = 'dc13ad2b-634f-4411-b178-70f9dda67356'; -- Shell

UPDATE customers
SET last_name = '',
    internal_notes = 'Previous last name ''Quiz Night'' removed (event note)'
WHERE id = 'a5667b7b-587a-4ddc-9ed1-335ee867895c'; -- Shirl

-- 9. Unknown customers with bookings — clear the phone-digit last name, add note
UPDATE customers
SET last_name = '',
    internal_notes = 'Customer identity unknown — has booking history. Phone: +447538720758 (last 4 digits were stored as last name)'
WHERE id = 'f313d254-5b31-4ba7-b825-3d7036e3002d';

UPDATE customers
SET last_name = '',
    internal_notes = 'Customer identity unknown — has booking history. Phone: +447897440401 (last 4 digits were stored as last name)'
WHERE id = '08f448ef-c775-4afc-9dbf-0b74e928c497';

UPDATE customers
SET last_name = '',
    internal_notes = 'Customer identity unknown — has booking history. Phone: +447709003308 (last 4 digits were stored as last name)'
WHERE id = 'b2eff7c0-e01f-4d20-bbca-48fece3c5901';

-- 10. Delete Unknown customers with zero bookings
DELETE FROM customer_scores WHERE customer_id IN (
    'b333e5b0-31ea-4eb3-bb39-a20bca8febe4',
    '9bbd60cb-c8b6-4985-9339-3c602c96b65c'
);
DELETE FROM customer_label_assignments WHERE customer_id IN (
    'b333e5b0-31ea-4eb3-bb39-a20bca8febe4',
    '9bbd60cb-c8b6-4985-9339-3c602c96b65c'
);
DELETE FROM customers WHERE id IN (
    'b333e5b0-31ea-4eb3-bb39-a20bca8febe4', -- Unknown 8774, 0 bookings
    '9bbd60cb-c8b6-4985-9339-3c602c96b65c'  -- Unknown 9463, 0 bookings
);

-- 11. Merge Kelly Masters (keep a639bb93, absorb 7c3bae02 — same phone +447984405318)
UPDATE bookings     SET customer_id = 'a639bb93-b6b4-4bd8-8afa-69c8e51f6ca3' WHERE customer_id = '7c3bae02-e7b6-4bf4-b57f-2963469c60c5';
UPDATE messages     SET customer_id = 'a639bb93-b6b4-4bd8-8afa-69c8e51f6ca3' WHERE customer_id = '7c3bae02-e7b6-4bf4-b57f-2963469c60c5';
DELETE FROM customer_scores            WHERE customer_id = '7c3bae02-e7b6-4bf4-b57f-2963469c60c5';
DELETE FROM customer_category_stats    WHERE customer_id = '7c3bae02-e7b6-4bf4-b57f-2963469c60c5';
DELETE FROM customer_label_assignments WHERE customer_id = '7c3bae02-e7b6-4bf4-b57f-2963469c60c5';
DELETE FROM customers WHERE id = '7c3bae02-e7b6-4bf4-b57f-2963469c60c5';
UPDATE customers
SET internal_notes = 'Merged with duplicate record (same phone +447984405318, duplicate created 2025-09-22)'
WHERE id = 'a639bb93-b6b4-4bd8-8afa-69c8e51f6ca3';

-- 12. Merge Louise Kitchener (keep 37219b95, absorb ac2330e9 — same phone +447555366156)
UPDATE bookings       SET customer_id = '37219b95-b34f-4a70-b5b1-18e1d48c8760' WHERE customer_id = 'ac2330e9-c287-4285-ab92-16b4bd8047fe';
UPDATE table_bookings SET customer_id = '37219b95-b34f-4a70-b5b1-18e1d48c8760' WHERE customer_id = 'ac2330e9-c287-4285-ab92-16b4bd8047fe';
UPDATE messages       SET customer_id = '37219b95-b34f-4a70-b5b1-18e1d48c8760' WHERE customer_id = 'ac2330e9-c287-4285-ab92-16b4bd8047fe';
DELETE FROM customer_scores            WHERE customer_id = 'ac2330e9-c287-4285-ab92-16b4bd8047fe';
DELETE FROM customer_category_stats    WHERE customer_id = 'ac2330e9-c287-4285-ab92-16b4bd8047fe';
DELETE FROM customer_label_assignments WHERE customer_id = 'ac2330e9-c287-4285-ab92-16b4bd8047fe';
DELETE FROM customers WHERE id = 'ac2330e9-c287-4285-ab92-16b4bd8047fe';
UPDATE customers
SET mobile_e164 = '+447555366156',
    internal_notes = 'Merged with duplicate record (same phone +447555366156, duplicate created 2025-11-02)'
WHERE id = '37219b95-b34f-4a70-b5b1-18e1d48c8760';

-- 13. Backfill mobile_e164 for any records where it is null but mobile_number is a valid E.164
--     This closes the gap that allowed duplicate phone records to slip through
UPDATE customers
SET mobile_e164 = mobile_number
WHERE mobile_e164 IS NULL
  AND mobile_number IS NOT NULL
  AND mobile_number ~ '^\+[1-9]\d{7,14}$';
