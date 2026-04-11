-- Recreate menu_ingredients_with_prices view to pick up new columns (abv)
-- PostgreSQL views capture column lists at creation time, so adding columns
-- to the base table doesn't automatically make them available in the view.
-- Must DROP + CREATE because CREATE OR REPLACE cannot reorder columns.

DROP VIEW IF EXISTS menu_ingredients_with_prices;

CREATE VIEW menu_ingredients_with_prices AS
  SELECT
    mi.*,
    menu_get_latest_pack_cost(mi.id) AS latest_pack_cost,
    menu_get_latest_unit_cost(mi.id) AS latest_unit_cost,
    (
      SELECT mip.effective_from
      FROM menu_ingredient_prices mip
      WHERE mip.ingredient_id = mi.id
      ORDER BY mip.effective_from DESC
      LIMIT 1
    ) AS latest_price_effective_from
  FROM menu_ingredients mi;

COMMENT ON VIEW menu_ingredients_with_prices IS 'Ingredients with derived latest costing information';
