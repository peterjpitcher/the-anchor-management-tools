-- Fix: column "unit" is of type menu_unit but expression is of type text
-- The update_dish_transaction from 20260520000000 missed the ::menu_unit cast
-- on the ingredient unit column in the UPDATE path.

CREATE OR REPLACE FUNCTION update_dish_transaction(
  p_dish_id UUID,
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
      dish_id, ingredient_id, quantity, unit,
      yield_pct, wastage_pct, cost_override, notes, option_group,
      inclusion_type, upgrade_price
    )
    SELECT
      p_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'unit')::menu_unit,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', ''),
      NULLIF(TRIM(item->>'option_group'), ''),
      COALESCE(NULLIF(TRIM(item->>'inclusion_type'), ''), 'included'),
      NULLIF(item->>'upgrade_price', '')::NUMERIC
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  DELETE FROM menu_dish_recipes WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_recipes) > 0 THEN
    INSERT INTO menu_dish_recipes (
      dish_id, recipe_id, quantity,
      yield_pct, wastage_pct, cost_override, notes, option_group,
      inclusion_type, upgrade_price
    )
    SELECT
      p_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', ''),
      NULLIF(TRIM(item->>'option_group'), ''),
      COALESCE(NULLIF(TRIM(item->>'inclusion_type'), ''), 'included'),
      NULLIF(item->>'upgrade_price', '')::NUMERIC
    FROM jsonb_array_elements(p_recipes) AS item;
  END IF;

  DELETE FROM menu_dish_menu_assignments WHERE dish_id = p_dish_id;

  IF jsonb_array_length(p_assignments) > 0 THEN
    INSERT INTO menu_dish_menu_assignments (
      dish_id, menu_id, category_id, sort_order,
      is_special, is_default_side, available_from, available_until
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
  FROM menu_dishes d WHERE d.id = p_dish_id;

  RETURN v_dish_record;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
