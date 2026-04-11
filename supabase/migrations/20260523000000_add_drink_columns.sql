-- Migration: add drink-specific optional columns
-- abv on ingredients (alcohol by volume percentage)
-- measure_ml on dish_ingredients (serve size in ml, e.g. 25ml single, 568ml pint)

ALTER TABLE menu_ingredients
  ADD COLUMN IF NOT EXISTS abv NUMERIC(4,1);

ALTER TABLE menu_dish_ingredients
  ADD COLUMN IF NOT EXISTS measure_ml NUMERIC(8,1);

COMMENT ON COLUMN menu_ingredients.abv IS 'Alcohol by volume percentage (e.g. 4.6 for Moretti). NULL for non-alcoholic.';
COMMENT ON COLUMN menu_dish_ingredients.measure_ml IS 'Serve size in millilitres (e.g. 568 for pint, 25 for single spirit). NULL for non-drink items.';
