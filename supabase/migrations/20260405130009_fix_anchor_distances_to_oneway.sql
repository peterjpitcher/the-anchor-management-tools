-- Fix: distance cache was seeded with round-trip distances from spreadsheet
-- but should store one-way distances (used for individual trip legs).
-- Halve all Anchor ↔ destination distances.

UPDATE public.mileage_destination_distances
SET miles = miles / 2
WHERE from_destination_id IN (SELECT id FROM public.mileage_destinations WHERE is_home_base = TRUE)
   OR to_destination_id IN (SELECT id FROM public.mileage_destinations WHERE is_home_base = TRUE);
