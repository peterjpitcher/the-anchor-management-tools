-- Function to handle atomic creation of recipes with ingredients
CREATE OR REPLACE FUNCTION create_recipe_transaction(
  p_recipe_data JSONB,
  p_ingredients JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipe_id UUID;
  v_recipe_record JSONB;
BEGIN
  -- 1. Insert Recipe
  INSERT INTO menu_recipes (
    name,
    description,
    instructions,
    yield_quantity,
    yield_unit,
    notes,
    is_active
  ) VALUES (
    p_recipe_data->>'name',
    p_recipe_data->>'description',
    p_recipe_data->>'instructions',
    (p_recipe_data->>'yield_quantity')::DECIMAL,
    p_recipe_data->>'yield_unit',
    p_recipe_data->>'notes',
    COALESCE((p_recipe_data->>'is_active')::BOOLEAN, true)
  )
  RETURNING id INTO v_recipe_id;

  -- 2. Insert Recipe Ingredients
  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_recipe_ingredients (
      recipe_id,
      ingredient_id,
      quantity,
      unit,
      yield_pct,
      wastage_pct,
      cost_override,
      notes
    )
    SELECT
      v_recipe_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      item->>'unit',
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  -- 3. Trigger calculation refresh (if needed, otherwise rely on triggers)
  -- Assuming 'menu_refresh_recipe_calculations' is a separate function or trigger
  -- We can call it here if it exists and is safe
  PERFORM menu_refresh_recipe_calculations(v_recipe_id);

  -- 4. Return the created recipe
  SELECT to_jsonb(r) INTO v_recipe_record
  FROM menu_recipes r
  WHERE r.id = v_recipe_id;

  RETURN v_recipe_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Function to handle atomic creation of dishes with ingredients, recipes, and assignments
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
      notes
    )
    SELECT
      v_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      item->>'unit',
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
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
      notes
    )
    SELECT
      v_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
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
      (item->>'available_from')::DATE,
      (item->>'available_until')::DATE
    FROM jsonb_array_elements(p_assignments) AS item;
  END IF;

  -- 5. Refresh calculations
  PERFORM menu_refresh_dish_calculations(v_dish_id);

  -- 6. Return the created dish
  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d
  WHERE d.id = v_dish_id;

  RETURN v_dish_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
