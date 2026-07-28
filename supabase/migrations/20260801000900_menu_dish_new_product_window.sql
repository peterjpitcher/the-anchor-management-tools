-- Mark a dish as a new product for a bounded window so the website can badge it.
--
-- Stored as two explicit dates rather than a boolean plus a hardcoded "8 weeks"
-- constant: the window is then visible in the data, overridable per dish, and it
-- expires on its own with no one having to remember to untick anything. This
-- mirrors the available_from / available_until pattern already used on menu
-- assignments, and the public menu API compares them the same way (whole-day
-- inclusive, Europe/London).

ALTER TABLE public.menu_dishes
  ADD COLUMN IF NOT EXISTS new_from  date,
  ADD COLUMN IF NOT EXISTS new_until date;

COMMENT ON COLUMN public.menu_dishes.new_from IS
  'First day the dish is advertised as new. NULL means never badged as new.';
COMMENT ON COLUMN public.menu_dishes.new_until IS
  'Last day the dish is advertised as new, inclusive. NULL means no end date.';

-- Guard against an inverted window being saved.
ALTER TABLE public.menu_dishes
  DROP CONSTRAINT IF EXISTS menu_dishes_new_window_ordered;
ALTER TABLE public.menu_dishes
  ADD CONSTRAINT menu_dishes_new_window_ordered
  CHECK (new_from IS NULL OR new_until IS NULL OR new_until >= new_from);

-- Partial index: the public menu endpoint only ever asks for currently-new
-- dishes, which is a tiny subset of the table.
CREATE INDEX IF NOT EXISTS idx_menu_dishes_new_window
  ON public.menu_dishes (new_from, new_until)
  WHERE new_from IS NOT NULL;

-- ---------------------------------------------------------------------------
-- View: append the two columns. A view freezes its column list, so it has to be
-- recreated for the new columns to become visible to PostgREST.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.menu_dishes_with_costs AS
 SELECT d.id AS dish_id,
    d.name,
    d.slug,
    d.description,
    d.selling_price,
    d.target_gp_pct,
    d.portion_cost,
    d.gp_pct,
    d.allergen_flags,
    d.dietary_flags,
    d.calories,
    d.is_active,
    d.is_sunday_lunch,
    d.is_gp_alert,
    d.image_url,
    d.notes,
    dma.menu_id,
    m.code AS menu_code,
    m.name AS menu_name,
    dma.category_id,
    c.code AS category_code,
    c.name AS category_name,
    dma.sort_order,
    dma.is_special,
    dma.is_default_side,
    dma.available_from,
    dma.available_until,
    d.removable_allergens,
    d.is_modifiable_for,
    d.allergen_verified,
    d.allergen_verified_at,
    d.new_from,
    d.new_until
   FROM menu_dishes d
     JOIN menu_dish_menu_assignments dma ON dma.dish_id = d.id
     JOIN menu_menus m ON m.id = dma.menu_id
     JOIN menu_categories c ON c.id = dma.category_id;

-- ---------------------------------------------------------------------------
-- Dish write transactions: both use explicit column lists, so both need the new
-- fields or the drawer can never set them.
--
-- update_dish_transaction overwrites every column it lists, so the caller must
-- always send new_from / new_until. The dish drawer does.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_dish_transaction(
  p_dish_data jsonb,
  p_ingredients jsonb DEFAULT '[]'::jsonb,
  p_recipes jsonb DEFAULT '[]'::jsonb,
  p_assignments jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    notes,
    new_from,
    new_until
  ) VALUES (
    p_dish_data->>'name',
    p_dish_data->>'description',
    (p_dish_data->>'selling_price')::DECIMAL,
    (p_dish_data->>'target_gp_pct')::DECIMAL,
    (p_dish_data->>'calories')::INTEGER,
    COALESCE((p_dish_data->>'is_active')::BOOLEAN, true),
    COALESCE((p_dish_data->>'is_sunday_lunch')::BOOLEAN, false),
    p_dish_data->>'image_url',
    p_dish_data->>'notes',
    NULLIF(p_dish_data->>'new_from', '')::DATE,
    NULLIF(p_dish_data->>'new_until', '')::DATE
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
      option_group,
      inclusion_type,
      upgrade_price
    )
    SELECT
      v_dish_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'unit')::menu_unit,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes',
      NULLIF(TRIM(item->>'option_group'), ''),
      COALESCE(NULLIF(TRIM(item->>'inclusion_type'), ''), 'included'),
      NULLIF(item->>'upgrade_price', '')::NUMERIC
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
      option_group,
      inclusion_type,
      upgrade_price
    )
    SELECT
      v_dish_id,
      (item->>'recipe_id')::UUID,
      (item->>'quantity')::DECIMAL,
      (item->>'yield_pct')::DECIMAL,
      (item->>'wastage_pct')::DECIMAL,
      (item->>'cost_override')::DECIMAL,
      item->>'notes',
      NULLIF(TRIM(item->>'option_group'), ''),
      COALESCE(NULLIF(TRIM(item->>'inclusion_type'), ''), 'included'),
      NULLIF(item->>'upgrade_price', '')::NUMERIC
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
$function$;

CREATE OR REPLACE FUNCTION public.update_dish_transaction(
  p_dish_id uuid,
  p_dish_data jsonb,
  p_ingredients jsonb DEFAULT '[]'::jsonb,
  p_recipes jsonb DEFAULT '[]'::jsonb,
  p_assignments jsonb DEFAULT '[]'::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    new_from        = NULLIF(p_dish_data->>'new_from', '')::DATE,
    new_until       = NULLIF(p_dish_data->>'new_until', '')::DATE,
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
$function$;
