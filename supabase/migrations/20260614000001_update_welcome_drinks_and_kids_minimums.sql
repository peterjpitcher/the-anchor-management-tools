-- Migration: update Welcome Drinks pricing model and kids package minimums
-- Description: Welcome Drinks changed to variable pricing (quoted per booking).
--              All kids meal packages now require minimum 20 guests.

BEGIN;

-- Welcome Drinks: variable pricing (quoted depending on requirements)
UPDATE catering_packages
  SET pricing_model = 'variable', cost_per_head = 0.00
  WHERE name = 'Welcome Drinks';

-- Kids packages: minimum 20 guests
UPDATE catering_packages SET minimum_guests = 20
  WHERE name IN (
    'Kids Burger & Chips',
    'Kids Chicken Nuggets & Chips',
    'Kids Mini Pizza & Chips'
  );

COMMIT;
