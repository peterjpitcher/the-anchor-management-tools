-- Performance indexes for menu management page
-- The listDishes() query flow:
--   1. SELECT * FROM menu_dishes_with_costs (view joins menu_dishes → menu_dish_menu_assignments → menu_menus → menu_categories)
--   2. SELECT FROM menu_dish_ingredients WHERE dish_id IN (...)
--   3. SELECT FROM menu_ingredients_with_prices WHERE id IN (...)  ← calls menu_get_latest_pack_cost/unit_cost per row
--   4. SELECT FROM menu_dish_recipes WHERE dish_id IN (...)
--   5. SELECT FROM menu_recipes WHERE id IN (...)
--
-- Existing indexes:
--   idx_menu_dish_menu_assignments_menu (menu_id, category_id, sort_order) — wrong leading column for the view join
--   UNIQUE (dish_id, menu_id, category_id) — covers dish_id lookups but not sort_order for ORDER BY
--   idx_menu_dish_ingredients_dish (dish_id) — good
--   idx_menu_dish_ingredients_ingredient (ingredient_id) — good
--   idx_menu_ingredient_prices_ingredient (ingredient_id, effective_from DESC) — good
--   idx_menu_dish_recipes_dish (dish_id) — good
--   idx_menu_dish_recipes_recipe (recipe_id) — good
--
-- Missing indexes added below:

-- 1. Covering index for the menu_dishes_with_costs view join + ORDER BY
--    The view joins on dma.dish_id = d.id and the TS code orders by menu_code, category_code, sort_order.
--    This index lets PostgreSQL do an index-only scan for the join and sort.
CREATE INDEX IF NOT EXISTS idx_menu_dish_menu_assignments_dish_covering
  ON menu_dish_menu_assignments (dish_id, menu_id, category_id, sort_order);

-- 2. Index on menu_dish_menu_assignments.category_id for the JOIN to menu_categories
--    Without this, the join to menu_categories requires a sequential scan or nested loop.
CREATE INDEX IF NOT EXISTS idx_menu_dish_menu_assignments_category
  ON menu_dish_menu_assignments (category_id);

-- 3. Index on menu_dishes.is_active for filtered queries
--    The existing idx_menu_dishes_active covers this but let's also add a covering
--    index that includes the columns the view selects to enable index-only scans.
--    (Skipped — the table has too many columns for a practical covering index.)

-- 4. Composite index on menu_ingredient_prices for the correlated subquery in
--    menu_get_latest_pack_cost() which does:
--      SELECT pack_cost FROM menu_ingredient_prices
--      WHERE ingredient_id = $1 ORDER BY effective_from DESC LIMIT 1
--    The existing idx_menu_ingredient_prices_ingredient (ingredient_id, effective_from DESC)
--    covers the lookup but not the pack_cost column. Adding pack_cost via INCLUDE
--    enables an index-only scan, avoiding the heap fetch for every ingredient.
CREATE INDEX IF NOT EXISTS idx_menu_ingredient_prices_cost_lookup
  ON menu_ingredient_prices (ingredient_id, effective_from DESC)
  INCLUDE (pack_cost);

-- 5. Index on menu_dishes for the view's base table scan.
--    The view selects all active + inactive dishes. The ORDER BY in TS code is on
--    menu_code/category_code/sort_order (from the assignments table), so an index
--    on menu_dishes.name helps the final fallback sort.
CREATE INDEX IF NOT EXISTS idx_menu_dishes_name
  ON menu_dishes (name);

-- 6. Index on menu_recipe_ingredients for recipe cost calculations.
--    menu_refresh_recipe_calculations() queries WHERE recipe_id = $1.
--    The existing idx_menu_recipe_ingredients_recipe covers this, but adding
--    ingredient_id lets the join to menu_ingredients use an index-only scan.
CREATE INDEX IF NOT EXISTS idx_menu_recipe_ingredients_recipe_ingredient
  ON menu_recipe_ingredients (recipe_id, ingredient_id);
