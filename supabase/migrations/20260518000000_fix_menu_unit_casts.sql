-- Migration: 20260518000000_fix_menu_unit_casts.sql
-- Fix: column "unit" is of type menu_unit but expression is of type text
-- All four transaction functions extract unit/yield_unit from JSONB via ->>
-- which returns text, but the columns are menu_unit enum. Add explicit casts.

-- 1. Fix create_recipe_transaction
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
    (p_recipe_data->>'yield_unit')::menu_unit,
    p_recipe_data->>'notes',
    COALESCE((p_recipe_data->>'is_active')::BOOLEAN, true)
  )
  RETURNING id INTO v_recipe_id;

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
      (item->>'unit')::menu_unit,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  PERFORM menu_refresh_recipe_calculations(v_recipe_id);

  SELECT to_jsonb(r) INTO v_recipe_record
  FROM menu_recipes r
  WHERE r.id = v_recipe_id;

  RETURN v_recipe_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- 2. Fix update_recipe_transaction
CREATE OR REPLACE FUNCTION update_recipe_transaction(
  p_recipe_id   UUID,
  p_recipe_data JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipe_record JSONB;
BEGIN
  UPDATE menu_recipes SET
    name           = p_recipe_data->>'name',
    description    = NULLIF(p_recipe_data->>'description', ''),
    instructions   = NULLIF(p_recipe_data->>'instructions', ''),
    yield_quantity = (p_recipe_data->>'yield_quantity')::DECIMAL,
    yield_unit     = (p_recipe_data->>'yield_unit')::menu_unit,
    notes          = NULLIF(p_recipe_data->>'notes', ''),
    is_active      = COALESCE((p_recipe_data->>'is_active')::BOOLEAN, true),
    updated_at     = now()
  WHERE id = p_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe not found: %', p_recipe_id;
  END IF;

  DELETE FROM menu_recipe_ingredients WHERE recipe_id = p_recipe_id;

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
      p_recipe_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'unit')::menu_unit,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', '')
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  PERFORM menu_refresh_recipe_calculations(p_recipe_id);

  SELECT to_jsonb(r) INTO v_recipe_record
  FROM menu_recipes r
  WHERE r.id = p_recipe_id;

  RETURN v_recipe_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- 3. Fix create_dish_transaction
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
      (item->>'unit')::menu_unit,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes'
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

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

  PERFORM menu_refresh_dish_calculations(v_dish_id);

  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d
  WHERE d.id = v_dish_id;

  RETURN v_dish_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- 4. Fix update_dish_transaction
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
      notes
    )
    SELECT
      p_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'unit')::menu_unit,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', '')
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  DELETE FROM menu_dish_recipes WHERE dish_id = p_dish_id;

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
      p_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', '')
    FROM jsonb_array_elements(p_recipes) AS item;
  END IF;

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

  PERFORM menu_refresh_dish_calculations(p_dish_id);

  SELECT to_jsonb(d) INTO v_dish_record
  FROM menu_dishes d
  WHERE d.id = p_dish_id;

  RETURN v_dish_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
