-- Separate kitchen food purchases from bar/drink purchases for allergen validation.

ALTER TABLE menu_ingredients
  ADD COLUMN IF NOT EXISTS purchase_department TEXT NOT NULL DEFAULT 'kitchen';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'menu_ingredients_purchase_department_check'
      AND conrelid = 'menu_ingredients'::regclass
  ) THEN
    ALTER TABLE menu_ingredients
      ADD CONSTRAINT menu_ingredients_purchase_department_check
      CHECK (purchase_department IN ('kitchen', 'bar', 'other'));
  END IF;
END $$;

UPDATE menu_ingredients
SET purchase_department = 'bar'
WHERE abv IS NOT NULL
  AND abv > 0
  AND purchase_department = 'kitchen';

CREATE INDEX IF NOT EXISTS idx_menu_ingredients_purchase_department
  ON menu_ingredients(purchase_department);

COMMENT ON COLUMN menu_ingredients.purchase_department IS
  'Department responsible for purchase and allergen validation: kitchen, bar, or other.';

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
