-- Migration: update catering package pricing (July 2026)
-- Description: Updates prices and minimum guest counts for food and drink packages.

BEGIN;

-- FOOD
UPDATE catering_packages SET cost_per_head = 12.00, minimum_guests = 30
  WHERE name = 'Sandwich Buffet';

UPDATE catering_packages SET cost_per_head = 16.00, minimum_guests = 30
  WHERE name = 'Finger Buffet';

UPDATE catering_packages SET cost_per_head = 11.00, minimum_guests = 20
  WHERE name = 'Burger Buffet';

UPDATE catering_packages SET cost_per_head = 19.00, minimum_guests = 30
  WHERE name = 'Premium Buffet';

UPDATE catering_packages SET cost_per_head = 18.00, minimum_guests = 20
  WHERE name = 'Indoor BBQ';

-- DRINKS
UPDATE catering_packages SET cost_per_head = 5.00, minimum_guests = 20
  WHERE name = 'Unlimited Tea & Coffee';

UPDATE catering_packages SET cost_per_head = 8.00, minimum_guests = 40
  WHERE name = 'Pimm''s Jar';

UPDATE catering_packages SET cost_per_head = 4.00, minimum_guests = 20
  WHERE name = 'Kids Unlimited Squash';

UPDATE catering_packages SET cost_per_head = 9.00, minimum_guests = 20
  WHERE name = 'Welcome Prosecco/Orange Juice';

COMMIT;
