-- Migration: update food and drink pricing from approved pricing sheet
-- Description: aligns private-booking catering prices with the provided "Pricing that Fits" poster.

BEGIN;

-- FOOD
UPDATE catering_packages
SET
  cost_per_head = 9.95,
  pricing_model = 'per_head'
WHERE id = '10b9ef30-b53e-4d57-a3d8-14644676336e'
   OR name = 'Sandwich Buffet';

UPDATE catering_packages
SET
  cost_per_head = 10.50,
  pricing_model = 'per_head'
WHERE id = '10e7153e-3bfc-4791-8f2a-02981d72fed0'
   OR name = 'Finger Buffet';

UPDATE catering_packages
SET
  cost_per_head = 10.95,
  pricing_model = 'per_head'
WHERE id = '7fddf321-91f6-48a2-9758-64c02f4bab7a'
   OR name = 'Burger Buffet';

UPDATE catering_packages
SET
  cost_per_head = 13.95,
  pricing_model = 'per_head'
WHERE id = '5e8dba3d-8c50-473f-9a4f-c09299dd23c2'
   OR name = 'Premium Buffet';

UPDATE catering_packages
SET
  cost_per_head = 0.00,
  pricing_model = 'menu_priced'
WHERE id = '8bb92d1f-3150-473f-b558-153a5bf58aae'
   OR name IN ('Pizza (Ordered from our Menu)', 'Pizza Buffet');

UPDATE catering_packages
SET
  name = 'Pizza Buffet'
WHERE
  (
    id = '8bb92d1f-3150-473f-b558-153a5bf58aae'
    OR name = 'Pizza (Ordered from our Menu)'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM catering_packages existing
    WHERE existing.name = 'Pizza Buffet'
      AND existing.id <> catering_packages.id
  );

UPDATE catering_packages
SET
  cost_per_head = 8.00,
  pricing_model = 'per_head'
WHERE id = '5dbf956f-8859-4072-bb6b-e715c736c1d1'
   OR name = 'Kids Burger & Chips';

UPDATE catering_packages
SET
  cost_per_head = 8.00,
  pricing_model = 'per_head'
WHERE id = '0b31b557-f70c-44af-8a83-fbcae0b0157f'
   OR name = 'Kids Chicken Nuggets & Chips';

UPDATE catering_packages
SET
  cost_per_head = 8.00,
  pricing_model = 'per_head'
WHERE id = 'c0f62610-9cab-4ba4-bc83-785ef436a608'
   OR name = 'Kids Mini Pizza & Chips';

-- DRINKS
UPDATE catering_packages
SET
  cost_per_head = 4.49,
  pricing_model = 'per_head'
WHERE id = '2cb8ce9a-c181-4c8f-bf6f-5b0a4de849c9'
   OR name = 'Unlimited Tea & Coffee';

UPDATE catering_packages
SET
  cost_per_head = 5.99,
  pricing_model = 'per_head'
WHERE id = '7423d70e-2627-4e8e-b8e1-a7b5fa91600c'
   OR name IN ('Pimms Jar', 'Pimm''s Jar');

UPDATE catering_packages
SET
  name = 'Pimm''s Jar'
WHERE
  (
    id = '7423d70e-2627-4e8e-b8e1-a7b5fa91600c'
    OR name = 'Pimms Jar'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM catering_packages existing
    WHERE existing.name = 'Pimm''s Jar'
      AND existing.id <> catering_packages.id
  );

UPDATE catering_packages
SET
  cost_per_head = 3.50,
  pricing_model = 'per_head'
WHERE id = '64f05d5c-f68a-4261-8705-3a8ce09416a5'
   OR name IN ('Unlimited Kids Squash', 'Kids Unlimited Squash');

UPDATE catering_packages
SET
  name = 'Kids Unlimited Squash'
WHERE
  (
    id = '64f05d5c-f68a-4261-8705-3a8ce09416a5'
    OR name = 'Unlimited Kids Squash'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM catering_packages existing
    WHERE existing.name = 'Kids Unlimited Squash'
      AND existing.id <> catering_packages.id
  );

UPDATE catering_packages
SET
  cost_per_head = 7.99,
  pricing_model = 'per_head'
WHERE id = '5f10ea45-14b2-47d4-9d3a-605375bfab77'
   OR name = 'Welcome Prosecco/Orange Juice';

COMMIT;
