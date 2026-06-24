BEGIN;

DROP FUNCTION IF EXISTS public.update_manual_mileage_trip_v01(uuid, date, text, numeric, jsonb);
DROP FUNCTION IF EXISTS public.create_manual_mileage_trip_v01(date, text, numeric, uuid, jsonb);
DROP FUNCTION IF EXISTS public.insert_mileage_trip_legs_v01(uuid, jsonb, integer);
DROP FUNCTION IF EXISTS public.recalculate_mileage_tax_year_v01(date);

COMMIT;
