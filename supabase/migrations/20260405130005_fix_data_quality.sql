-- =============================================================
-- Fix data quality issues from historical imports
-- =============================================================

-- -------------------------------------------------------
-- Mileage Destinations: merge duplicates/typos
-- -------------------------------------------------------

-- Windsor Cr Park → Windsor Car Park (merge trips + legs, delete duplicate)
UPDATE public.mileage_trip_legs
SET from_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Windsor Car Park' LIMIT 1)
WHERE from_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Windsor Cr Park' LIMIT 1);

UPDATE public.mileage_trip_legs
SET to_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Windsor Car Park' LIMIT 1)
WHERE to_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Windsor Cr Park' LIMIT 1);

UPDATE public.mileage_trips
SET description = 'Windsor Car Park'
WHERE description = 'Windsor Cr Park';

DELETE FROM public.mileage_destinations WHERE name = 'Windsor Cr Park';

-- Ikea reading → Ikea Reading (merge trips + legs, delete duplicate)
UPDATE public.mileage_trip_legs
SET from_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Ikea Reading' LIMIT 1)
WHERE from_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Ikea reading' LIMIT 1);

UPDATE public.mileage_trip_legs
SET to_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Ikea Reading' LIMIT 1)
WHERE to_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Ikea reading' LIMIT 1);

UPDATE public.mileage_trips
SET description = 'Ikea Reading'
WHERE description = 'Ikea reading';

DELETE FROM public.mileage_destinations WHERE name = 'Ikea reading';

-- mexicanos staines → Mexicanos Staines (merge trips + legs, delete duplicate)
UPDATE public.mileage_trip_legs
SET from_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Mexicanos Staines' LIMIT 1)
WHERE from_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'mexicanos staines' LIMIT 1);

UPDATE public.mileage_trip_legs
SET to_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'Mexicanos Staines' LIMIT 1)
WHERE to_destination_id = (SELECT id FROM public.mileage_destinations WHERE name = 'mexicanos staines' LIMIT 1);

UPDATE public.mileage_trips
SET description = 'Mexicanos Staines'
WHERE description = 'mexicanos staines';

DELETE FROM public.mileage_destinations WHERE name = 'mexicanos staines';

-- -------------------------------------------------------
-- Expenses: delete junk rows
-- -------------------------------------------------------

-- Delete header rows that leaked in (company_ref = 'Copmany/Ref')
DELETE FROM public.expenses WHERE company_ref = 'Copmany/Ref';

-- Delete asterisk separator rows
DELETE FROM public.expenses WHERE company_ref = '******************************';

-- -------------------------------------------------------
-- Expenses: normalise company names
-- -------------------------------------------------------

-- Case fixes
UPDATE public.expenses SET company_ref = 'Cash Bingo' WHERE company_ref = 'cash Bingo';
UPDATE public.expenses SET company_ref = 'Tesco' WHERE company_ref = 'tesco';
UPDATE public.expenses SET company_ref = 'Peter' WHERE company_ref = 'peter';

-- T5 Stores variants
UPDATE public.expenses SET company_ref = 'T5 Stores' WHERE company_ref = 'T5 Store';
UPDATE public.expenses SET company_ref = 'T5 Stores' WHERE company_ref = 'T5 stores';

-- Mr Fizz variants
UPDATE public.expenses SET company_ref = 'Mr Fizz' WHERE company_ref = 'MF Fizz';
UPDATE public.expenses SET company_ref = 'Mr Fizz' WHERE company_ref = 'MR Fizz';

-- M and S variants
UPDATE public.expenses SET company_ref = 'M and S' WHERE company_ref = 'M AND S';
UPDATE public.expenses SET company_ref = 'M and S' WHERE company_ref = 'M and  S';

-- Two Rivers variants → Two Rivers Car Park
UPDATE public.expenses SET company_ref = 'Two Rivers Car Park' WHERE company_ref = 'Two Rivers Carpark';
UPDATE public.expenses SET company_ref = 'Two Rivers Car Park' WHERE company_ref = 'Two Rivers';

-- TK Maxx variants
UPDATE public.expenses SET company_ref = 'TK Maxx' WHERE company_ref = 'T K Maxx';
UPDATE public.expenses SET company_ref = 'TK Maxx' WHERE company_ref = 'T.K.Maxx';
UPDATE public.expenses SET company_ref = 'TK Maxx' WHERE company_ref = 'Tk maxx';

-- Yasmin variants (all the same cleaner)
UPDATE public.expenses SET company_ref = 'Yasmin' WHERE company_ref = 'Yasmin Janvtih';
UPDATE public.expenses SET company_ref = 'Yasmin' WHERE company_ref = 'Jasmin Januth';
