-- Migration: add approved missing drink option from pricing sheet
-- Description: adds/updates "Cocktail Pitchers" as a variable-priced drink package.

BEGIN;

UPDATE catering_packages
SET
  description = E'Summary: Cocktail pitchers for private events.\nGood to know: Priced as required.',
  serving_style = 'drinks',
  category = 'drink',
  pricing_model = 'variable',
  cost_per_head = 0.00,
  minimum_guests = 1,
  active = true
WHERE name = 'Cocktail Pitchers';

INSERT INTO catering_packages (
  name,
  description,
  serving_style,
  category,
  pricing_model,
  cost_per_head,
  minimum_guests,
  active,
  display_order
)
SELECT
  'Cocktail Pitchers',
  E'Summary: Cocktail pitchers for private events.\nGood to know: Priced as required.',
  'drinks',
  'drink',
  'variable',
  0.00,
  1,
  true,
  85
WHERE NOT EXISTS (
  SELECT 1
  FROM catering_packages
  WHERE name = 'Cocktail Pitchers'
);

COMMIT;
