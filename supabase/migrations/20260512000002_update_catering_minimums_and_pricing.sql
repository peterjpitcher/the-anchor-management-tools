-- Migration: update catering package minimums and Chicken Goujon pricing
-- Description:
--   1. Raise minimum_guests to 30 for all packages currently above 6 (except Chicken Goujon Sharing Tray)
--   2. Set Chicken Goujon Sharing Tray to £35.00 and minimum 25 guests
--   3. Ensure Fish and Chip Van has a minimum of 30 guests (if it exists)

BEGIN;

-- 1. Raise all packages with minimum_guests > 6 to 30
--    (Chicken Goujon Sharing Tray is handled separately below)
UPDATE catering_packages
SET minimum_guests = 30
WHERE minimum_guests > 6
  AND name != 'Chicken Goujon Sharing Tray';

-- 2. Update Chicken Goujon Sharing Tray: new price and minimum
UPDATE catering_packages
SET
  cost_per_head = 35.00,
  minimum_guests = 25
WHERE name = 'Chicken Goujon Sharing Tray';

-- 3. Ensure Fish and Chip Van minimum is 30 (applies if the package exists)
UPDATE catering_packages
SET minimum_guests = 30
WHERE name = 'Fish and Chip Van';

COMMIT;
