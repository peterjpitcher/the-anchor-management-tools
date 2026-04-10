-- Migration: 20260519000000_add_option_groups.sql
-- Adds option_group column to menu_dish_ingredients and menu_dish_recipes,
-- updates transaction RPCs to persist the new column, and replaces
-- menu_refresh_dish_calculations with max-per-group costing logic.

-- ============================================================
-- 1. Schema: add option_group column to both tables
-- ============================================================

ALTER TABLE menu_dish_ingredients
  ADD COLUMN IF NOT EXISTS option_group TEXT;

COMMENT ON COLUMN menu_dish_ingredients.option_group
  IS 'Groups alternative ingredients — only the most expensive in each group counts toward portion cost. NULL = fixed (always included).';

ALTER TABLE menu_dish_recipes
  ADD COLUMN IF NOT EXISTS option_group TEXT;

COMMENT ON COLUMN menu_dish_recipes.option_group
  IS 'Groups alternative recipes — only the most expensive in each group counts toward portion cost. NULL = fixed (always included).';

-- ============================================================
-- 2. Replace menu_refresh_dish_calculations with max-per-group costing
-- ============================================================

CREATE OR REPLACE FUNCTION menu_refresh_dish_calculations(p_dish_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_portion_cost NUMERIC(12,4) := 0;
  v_selling_price NUMERIC(12,4) := 0;
  v_target_gp NUMERIC(6,4) := 0.70;
  v_gp NUMERIC(6,4);
  v_allergens TEXT[];
  v_dietary TEXT[];
BEGIN
  WITH ingredient_rows AS (
    SELECT
      di.option_group,
      di.quantity,
      COALESCE(NULLIF(di.yield_pct, 0), 100)::NUMERIC AS yield_pct,
      COALESCE(di.wastage_pct, 0)::NUMERIC AS dish_wastage_pct,
      mi.wastage_pct AS ingredient_wastage_pct,
      COALESCE(di.cost_override, menu_get_latest_unit_cost(mi.id)) AS unit_cost,
      mi.allergens,
      mi.dietary_flags
    FROM menu_dish_ingredients di
    JOIN menu_ingredients mi ON mi.id = di.ingredient_id
    WHERE di.dish_id = p_dish_id
  ),
  ingredient_line_costs AS (
    SELECT
      ir.option_group,
      (
        ir.quantity
        * ir.unit_cost
        * 100 / NULLIF(ir.yield_pct, 0)
        * (1 + (COALESCE(ir.dish_wastage_pct, ir.ingredient_wastage_pct, 0) / 100))
      ) AS line_cost,
      ir.allergens,
      ir.dietary_flags
    FROM ingredient_rows ir
  ),
  recipe_rows AS (
    SELECT
      dr.option_group,
      dr.quantity,
      COALESCE(NULLIF(dr.yield_pct, 0), 100)::NUMERIC AS yield_pct,
      COALESCE(dr.wastage_pct, 0)::NUMERIC AS dish_wastage_pct,
      COALESCE(dr.cost_override, mr.portion_cost) AS unit_cost,
      mr.allergen_flags AS allergens,
      mr.dietary_flags
    FROM menu_dish_recipes dr
    JOIN menu_recipes mr ON mr.id = dr.recipe_id
    WHERE dr.dish_id = p_dish_id
  ),
  recipe_line_costs AS (
    SELECT
      rr.option_group,
      (
        rr.quantity
        * rr.unit_cost
        * 100 / NULLIF(rr.yield_pct, 0)
        * (1 + (COALESCE(rr.dish_wastage_pct, 0) / 100))
      ) AS line_cost,
      rr.allergens,
      rr.dietary_flags
    FROM recipe_rows rr
  ),
  -- Combine all line costs for costing
  all_line_costs AS (
    SELECT option_group, line_cost FROM ingredient_line_costs
    UNION ALL
    SELECT option_group, line_cost FROM recipe_line_costs
  ),
  -- Fixed items: option_group IS NULL → sum all
  fixed_cost AS (
    SELECT COALESCE(SUM(line_cost), 0) AS total
    FROM all_line_costs
    WHERE option_group IS NULL
  ),
  -- Grouped items: take MAX line_cost per option_group, then sum those maxes
  grouped_cost AS (
    SELECT COALESCE(SUM(max_cost), 0) AS total
    FROM (
      SELECT MAX(line_cost) AS max_cost
      FROM all_line_costs
      WHERE option_group IS NOT NULL
      GROUP BY option_group
    ) per_group
  ),
  -- Combine all rows for allergen/dietary aggregation (all items contribute flags)
  all_flags AS (
    SELECT allergens, dietary_flags FROM ingredient_line_costs
    UNION ALL
    SELECT allergens, dietary_flags FROM recipe_line_costs
  ),
  cost_rows AS (
    SELECT
      (SELECT total FROM fixed_cost) + (SELECT total FROM grouped_cost) AS portion_cost,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM all_flags af,
        LATERAL UNNEST(af.allergens) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS allergens,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM all_flags af2,
        LATERAL UNNEST(af2.dietary_flags) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS dietary_flags
  )
  SELECT
    cr.portion_cost,
    cr.allergens,
    cr.dietary_flags
  INTO
    v_portion_cost,
    v_allergens,
    v_dietary
  FROM cost_rows cr;

  SELECT selling_price, target_gp_pct
  INTO v_selling_price, v_target_gp
  FROM menu_dishes
  WHERE id = p_dish_id;

  IF v_selling_price IS NOT NULL AND v_selling_price > 0 THEN
    v_gp := (v_selling_price - v_portion_cost) / v_selling_price;
  ELSE
    v_gp := NULL;
  END IF;

  UPDATE menu_dishes
  SET
    portion_cost = ROUND(COALESCE(v_portion_cost, 0)::NUMERIC, 4),
    gp_pct = v_gp,
    allergen_flags = COALESCE(v_allergens, '{}'::TEXT[]),
    dietary_flags = COALESCE(v_dietary, '{}'::TEXT[]),
    is_gp_alert = CASE
      WHEN v_gp IS NOT NULL AND v_target_gp IS NOT NULL AND v_gp < v_target_gp THEN TRUE
      ELSE FALSE
    END,
    updated_at = NOW()
  WHERE id = p_dish_id;
END;
$$;

COMMENT ON FUNCTION menu_refresh_dish_calculations(UUID)
  IS 'Recalculates dish costing (with max-per-group option logic), GP percentage, and aggregated allergen/dietary flags';

-- ============================================================
-- 3. Update create_dish_transaction to include option_group
-- ============================================================

CREATE OR REPLACE FUNCTION create_dish_transaction(
  p_dish_data JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB,
  p_recipes JSONB DEFAULT '[]'::JSONB,
  p_assignments JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dish_id UUID;
  v_dish_record JSONB;
BEGIN
  -- 1. Insert Dish
  INSERT INTO menu_dishes (
    name,
    description,
    selling_price,
    target_gp_pct,
    calories,
    is_active,
    is_sunday_lunch,
    image_url,
    notes
  ) VALUES (
    p_dish_data->>'name',
    p_dish_data->>'description',
    (p_dish_data->>'selling_price')::DECIMAL,
    (p_dish_data->>'target_gp_pct')::DECIMAL,
    (p_dish_data->>'calories')::INTEGER,
    COALESCE((p_dish_data->>'is_active')::BOOLEAN, true),
    COALESCE((p_dish_data->>'is_sunday_lunch')::BOOLEAN, false),
    p_dish_data->>'image_url',
    p_dish_data->>'notes'
  )
  RETURNING id INTO v_dish_id;

  -- 2. Insert Dish Ingredients
  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_dish_ingredients (
      dish_id,
      ingredient_id,
      quantity,
      unit,
      yield_pct,
      wastage_pct,
      cost_override,
      notes,
      option_group
    )
    SELECT
      v_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      item->>'unit',
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes',
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  -- 3. Insert Dish Recipes
  IF jsonb_array_length(p_recipes) > 0 THEN
    INSERT INTO menu_dish_recipes (
      dish_id,
      recipe_id,
      quantity,
      yield_pct,
      wastage_pct,
      cost_override,
      notes,
      option_group
    )
    SELECT
      v_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes',
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_recipes) AS item;
  END IF;

  -- 4. Insert Assignments
  IF jsonb_array_length(p_assignments) > 0 THEN
    INSERT INTO menu_dish_menu_assignments (
      dish_id,
      menu_id,
      category_id,
      sort_order,
      is_special,
      is_default_side,
      available_from,
      available_until
    )
    SELECT
      v_dish_id,
      (item->>'menu_id')::UUID,
      (item->>'category_id')::UUID,
      COALESCE((item->>'sort_order')::INTEGER, 0),
      COALESCE((item->>'is_special')::BOOLEAN, false),
      COALESCE((item->>'is_default_side')::BOOLEAN, false),
      NULLIF(item->>'available_from', '')::DATE,
      NULLIF(item->>'available_until', '')::DATE
    FROM jsonb_array_elements(p_assignments) AS item;
  END IF;

  -- 5. Refresh calculated fields
  PERFORM menu_refresh_dish_calculations(v_dish_id);

  -- 6. Return the new dish row as JSONB
  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d
  WHERE d.id = v_dish_id;

  RETURN v_dish_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- ============================================================
-- 4. Update update_dish_transaction to include option_group
-- ============================================================

CREATE OR REPLACE FUNCTION update_dish_transaction(
  p_dish_id    UUID,
  p_dish_data  JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB,
  p_recipes     JSONB DEFAULT '[]'::JSONB,
  p_assignments JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dish_record JSONB;
BEGIN
  -- 1. Update the dish scalar fields
  UPDATE menu_dishes SET
    name            = p_dish_data->>'name',
    description     = p_dish_data->>'description',
    selling_price   = (p_dish_data->>'selling_price')::DECIMAL,
    target_gp_pct   = (p_dish_data->>'target_gp_pct')::DECIMAL,
    calories        = NULLIF(p_dish_data->>'calories', '')::INTEGER,
    is_active       = COALESCE((p_dish_data->>'is_active')::BOOLEAN, true),
    is_sunday_lunch = COALESCE((p_dish_data->>'is_sunday_lunch')::BOOLEAN, false),
    image_url       = NULLIF(p_dish_data->>'image_url', ''),
    notes           = NULLIF(p_dish_data->>'notes', ''),
    updated_at      = now()
  WHERE id = p_dish_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dish not found: %', p_dish_id;
  END IF;

  -- 2. Replace dish ingredients (delete all, re-insert)
  DELETE FROM menu_dish_ingredients WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_dish_ingredients (
      dish_id,
      ingredient_id,
      quantity,
      unit,
      yield_pct,
      wastage_pct,
      cost_override,
      notes,
      option_group
    )
    SELECT
      p_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      item->>'unit',
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', ''),
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  -- 3. Replace dish recipes (delete all, re-insert)
  DELETE FROM menu_dish_recipes WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_recipes) > 0 THEN
    INSERT INTO menu_dish_recipes (
      dish_id,
      recipe_id,
      quantity,
      yield_pct,
      wastage_pct,
      cost_override,
      notes,
      option_group
    )
    SELECT
      p_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', ''),
      NULLIF(TRIM(item->>'option_group'), '')
    FROM jsonb_array_elements(p_recipes) AS item;
  END IF;

  -- 4. Replace menu assignments (delete all, re-insert)
  DELETE FROM menu_dish_menu_assignments WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_assignments) > 0 THEN
    INSERT INTO menu_dish_menu_assignments (
      dish_id,
      menu_id,
      category_id,
      sort_order,
      is_special,
      is_default_side,
      available_from,
      available_until
    )
    SELECT
      p_dish_id,
      (item->>'menu_id')::UUID,
      (item->>'category_id')::UUID,
      COALESCE((item->>'sort_order')::INTEGER, 0),
      COALESCE((item->>'is_special')::BOOLEAN, false),
      COALESCE((item->>'is_default_side')::BOOLEAN, false),
      NULLIF(item->>'available_from', '')::DATE,
      NULLIF(item->>'available_until', '')::DATE
    FROM jsonb_array_elements(p_assignments) AS item;
  END IF;

  -- 5. Refresh calculated fields (portion_cost, gp_pct, is_gp_alert)
  PERFORM menu_refresh_dish_calculations(p_dish_id);

  -- 6. Return the updated dish row as JSONB
  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d
  WHERE d.id = p_dish_id;

  RETURN v_dish_record;

EXCEPTION WHEN OTHERS THEN
  -- Re-raise; PostgreSQL automatically rolls back the implicit savepoint
  RAISE;
END;
$$;
