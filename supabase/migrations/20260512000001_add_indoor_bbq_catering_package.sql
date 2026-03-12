-- Migration: add Indoor BBQ catering package
-- Description: Adds a new buffet-style Indoor BBQ food package at £17.99 per head,
--              with vegetarian options available at the same price.

BEGIN;

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
  'Indoor BBQ',
  E'Summary: A hearty BBQ spread served buffet-style for everyone to help themselves.\nIncludes: Beef burger, chicken drumstick, pork sausage, potato salad, coleslaw and fresh leaf salad.\nServed: Buffet-style — guests help themselves.\nGood to know: Vegetarian option available at the same price per head — beef burger replaced with a vegetarian burger and pork sausage replaced with a vegetarian sausage (chicken is not replaced). Dietary requirements can be catered for with advance notice (minimum 10 guests).',
  'buffet',
  'food',
  'per_head',
  17.99,
  10,
  true,
  55
WHERE NOT EXISTS (
  SELECT 1 FROM catering_packages WHERE name = 'Indoor BBQ'
);

COMMIT;
