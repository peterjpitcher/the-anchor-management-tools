-- Migration: 20260520000000_add_inclusion_type.sql
-- Adds inclusion_type and upgrade_price to dish junction tables,
-- computed allergen traceability fields to menu_dishes,
-- and updates all transaction RPCs with the new costing/allergen logic.

-- ============================================================
-- 1. Schema: add inclusion_type and upgrade_price columns
-- ============================================================

ALTER TABLE menu_dish_ingredients
  ADD COLUMN IF NOT EXISTS inclusion_type TEXT NOT NULL DEFAULT 'included';

ALTER TABLE menu_dish_ingredients
  ADD COLUMN IF NOT EXISTS upgrade_price NUMERIC(8,2);

ALTER TABLE menu_dish_recipes
  ADD COLUMN IF NOT EXISTS inclusion_type TEXT NOT NULL DEFAULT 'included';

ALTER TABLE menu_dish_recipes
  ADD COLUMN IF NOT EXISTS upgrade_price NUMERIC(8,2);

-- ============================================================
-- 2. Schema: add computed allergen fields to menu_dishes
-- ============================================================

ALTER TABLE menu_dishes
  ADD COLUMN IF NOT EXISTS removable_allergens TEXT[] DEFAULT '{}';

ALTER TABLE menu_dishes
  ADD COLUMN IF NOT EXISTS is_modifiable_for JSONB DEFAULT '{}';

ALTER TABLE menu_dishes
  ADD COLUMN IF NOT EXISTS allergen_verified BOOLEAN DEFAULT FALSE;

ALTER TABLE menu_dishes
  ADD COLUMN IF NOT EXISTS allergen_verified_at TIMESTAMPTZ;

-- ============================================================
-- 3. Backfill: existing option_group rows should be 'choice'
-- ============================================================

UPDATE menu_dish_ingredients
  SET inclusion_type = 'choice'
  WHERE option_group IS NOT NULL AND inclusion_type = 'included';

UPDATE menu_dish_recipes
  SET inclusion_type = 'choice'
  WHERE option_group IS NOT NULL AND inclusion_type = 'included';

-- ============================================================
-- 4. CHECK constraints on inclusion_type and upgrade_price
-- ============================================================

-- Valid inclusion_type values
ALTER TABLE menu_dish_ingredients
  ADD CONSTRAINT chk_mdi_inclusion_type
  CHECK (inclusion_type IN ('included', 'removable', 'choice', 'upgrade'));

ALTER TABLE menu_dish_recipes
  ADD CONSTRAINT chk_mdr_inclusion_type
  CHECK (inclusion_type IN ('included', 'removable', 'choice', 'upgrade'));

-- upgrade_price only allowed when inclusion_type = 'upgrade'
ALTER TABLE menu_dish_ingredients
  ADD CONSTRAINT chk_mdi_upgrade_price
  CHECK (inclusion_type = 'upgrade' OR upgrade_price IS NULL);

ALTER TABLE menu_dish_recipes
  ADD CONSTRAINT chk_mdr_upgrade_price
  CHECK (inclusion_type = 'upgrade' OR upgrade_price IS NULL);

-- included/removable items must NOT have an option_group
ALTER TABLE menu_dish_ingredients
  ADD CONSTRAINT chk_mdi_inclusion_option_group
  CHECK (inclusion_type NOT IN ('included', 'removable') OR option_group IS NULL);

ALTER TABLE menu_dish_recipes
  ADD CONSTRAINT chk_mdr_inclusion_option_group
  CHECK (inclusion_type NOT IN ('included', 'removable') OR option_group IS NULL);

-- ============================================================
-- 5. Replace menu_refresh_dish_calculations with allergen traceability
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
  v_removable_allergens TEXT[];
  v_is_modifiable_for JSONB;
BEGIN
  -- ── Cost calculation ──────────────────────────────────────
  WITH ingredient_rows AS (
    SELECT
      di.inclusion_type,
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
      ir.inclusion_type,
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
      dr.inclusion_type,
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
      rr.inclusion_type,
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
    SELECT inclusion_type, option_group, line_cost FROM ingredient_line_costs
    UNION ALL
    SELECT inclusion_type, option_group, line_cost FROM recipe_line_costs
  ),
  -- Base cost: included + removable items (always counted)
  base_cost AS (
    SELECT COALESCE(SUM(line_cost), 0) AS total
    FROM all_line_costs
    WHERE inclusion_type IN ('included', 'removable')
  ),
  -- Choice items: take MAX line_cost per option_group, then sum those maxes
  choice_cost AS (
    SELECT COALESCE(SUM(max_cost), 0) AS total
    FROM (
      SELECT MAX(line_cost) AS max_cost
      FROM all_line_costs
      WHERE inclusion_type = 'choice'
      GROUP BY option_group
    ) per_group
  ),
  -- Upgrade items are excluded from portion_cost
  -- Combine all rows for allergen/dietary aggregation (all NON-UPGRADE items)
  all_flags AS (
    SELECT allergens, dietary_flags FROM ingredient_line_costs
    WHERE inclusion_type != 'upgrade'
    UNION ALL
    SELECT allergens, dietary_flags FROM recipe_line_costs
    WHERE inclusion_type != 'upgrade'
  ),
  cost_rows AS (
    SELECT
      (SELECT total FROM base_cost) + (SELECT total FROM choice_cost) AS portion_cost,
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

  -- ── Allergen removability computation ─────────────────────
  WITH base_components AS (
    SELECT di.inclusion_type, di.option_group,
           UNNEST(mi.allergens) AS allergen, mi.name AS component_name
    FROM menu_dish_ingredients di
    JOIN menu_ingredients mi ON mi.id = di.ingredient_id
    WHERE di.dish_id = p_dish_id AND di.inclusion_type != 'upgrade'
    UNION ALL
    SELECT dr.inclusion_type, dr.option_group,
           UNNEST(mr.allergen_flags) AS allergen, mr.name AS component_name
    FROM menu_dish_recipes dr
    JOIN menu_recipes mr ON mr.id = dr.recipe_id
    WHERE dr.dish_id = p_dish_id AND dr.inclusion_type != 'upgrade'
  ),
  allergen_removability AS (
    SELECT DISTINCT bc.allergen,
      -- An allergen is removable if EVERY component containing it is either:
      -- (a) removable, or (b) in a choice group with an allergen-free alternative
      BOOL_AND(
        bc.inclusion_type = 'removable'
        OR (
          bc.inclusion_type = 'choice' AND bc.option_group IS NOT NULL
          AND EXISTS (
            -- There's another item in the same choice group without this allergen
            SELECT 1 FROM menu_dish_ingredients di2
            JOIN menu_ingredients mi2 ON mi2.id = di2.ingredient_id
            WHERE di2.dish_id = p_dish_id
              AND di2.option_group = bc.option_group
              AND di2.inclusion_type = 'choice'
              AND NOT (bc.allergen = ANY(mi2.allergens))
            UNION ALL
            SELECT 1 FROM menu_dish_recipes dr2
            JOIN menu_recipes mr2 ON mr2.id = dr2.recipe_id
            WHERE dr2.dish_id = p_dish_id
              AND dr2.option_group = bc.option_group
              AND dr2.inclusion_type = 'choice'
              AND NOT (bc.allergen = ANY(mr2.allergen_flags))
          )
        )
      ) AS is_removable
    FROM base_components bc
    WHERE bc.allergen IS NOT NULL AND bc.allergen != ''
    GROUP BY bc.allergen
  )
  SELECT
    COALESCE(ARRAY(SELECT allergen FROM allergen_removability WHERE is_removable = TRUE), '{}'::TEXT[]),
    COALESCE(
      (SELECT jsonb_object_agg(allergen || '_free', is_removable) FROM allergen_removability),
      '{}'::JSONB
    )
  INTO v_removable_allergens, v_is_modifiable_for;

  -- ── GP calculation ────────────────────────────────────────
  SELECT selling_price, target_gp_pct
  INTO v_selling_price, v_target_gp
  FROM menu_dishes
  WHERE id = p_dish_id;

  IF v_selling_price IS NOT NULL AND v_selling_price > 0 THEN
    v_gp := (v_selling_price - v_portion_cost) / v_selling_price;
  ELSE
    v_gp := NULL;
  END IF;

  -- ── Update dish row ───────────────────────────────────────
  UPDATE menu_dishes
  SET
    portion_cost = ROUND(COALESCE(v_portion_cost, 0)::NUMERIC, 4),
    gp_pct = v_gp,
    allergen_flags = COALESCE(v_allergens, '{}'::TEXT[]),
    dietary_flags = COALESCE(v_dietary, '{}'::TEXT[]),
    removable_allergens = COALESCE(v_removable_allergens, '{}'::TEXT[]),
    is_modifiable_for = COALESCE(v_is_modifiable_for, '{}'::JSONB),
    allergen_verified = FALSE,
    allergen_verified_at = NULL,
    is_gp_alert = CASE
      WHEN v_gp IS NOT NULL AND v_target_gp IS NOT NULL AND v_gp < v_target_gp THEN TRUE
      ELSE FALSE
    END,
    updated_at = NOW()
  WHERE id = p_dish_id;
END;
$$;

COMMENT ON FUNCTION menu_refresh_dish_calculations(UUID)
  IS 'Recalculates dish costing (with inclusion_type logic), GP percentage, aggregated allergen/dietary flags, and allergen removability/modifiability';

-- ============================================================
-- 6. Update create_dish_transaction to include inclusion_type and upgrade_price
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
$$;

-- ============================================================
-- 7. Update update_dish_transaction to include inclusion_type and upgrade_price
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
      option_group,
      inclusion_type,
      upgrade_price
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
      NULLIF(TRIM(item->>'option_group'), ''),
      COALESCE(NULLIF(TRIM(item->>'inclusion_type'), ''), 'included'),
      NULLIF(item->>'upgrade_price', '')::NUMERIC
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
      option_group,
      inclusion_type,
      upgrade_price
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

  -- 5. Refresh calculated fields (portion_cost, gp_pct, allergens, removability)
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
