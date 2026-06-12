-- Fix menu dietary claims so one vegan/vegetarian component cannot label the whole dish.

CREATE OR REPLACE FUNCTION menu_resolve_dietary_claims(p_component_flags JSONB)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  WITH components AS (
    SELECT
      CASE
        WHEN jsonb_typeof(value) = 'array' THEN value
        ELSE '[]'::JSONB
      END AS flags
    FROM jsonb_array_elements(COALESCE(p_component_flags, '[]'::JSONB))
  ),
  status AS (
    SELECT
      COUNT(*) AS component_count,
      BOOL_AND(flags ? 'vegan') AS is_vegan,
      BOOL_AND((flags ? 'vegetarian') OR (flags ? 'vegan')) AS is_vegetarian,
      BOOL_AND(flags ? 'gluten_free') AS is_gluten_free,
      BOOL_AND(flags ? 'dairy_free') AS is_dairy_free,
      BOOL_OR(flags ? 'halal') AS has_halal
    FROM components
  )
  SELECT ARRAY_REMOVE(ARRAY[
    CASE WHEN component_count > 0 AND is_vegan THEN 'vegan' END,
    CASE WHEN component_count > 0 AND is_vegetarian THEN 'vegetarian' END,
    CASE WHEN component_count > 0 AND is_gluten_free THEN 'gluten_free' END,
    CASE WHEN component_count > 0 AND is_dairy_free THEN 'dairy_free' END,
    CASE WHEN has_halal THEN 'halal' END
  ], NULL)::TEXT[]
  FROM status;
$$;

COMMENT ON FUNCTION menu_resolve_dietary_claims(JSONB)
  IS 'Conservatively resolves component dietary flags into menu-safe claims';

CREATE OR REPLACE FUNCTION menu_refresh_recipe_calculations(p_recipe_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_cost NUMERIC(12,4) := 0;
  v_yield_quantity NUMERIC(12,4) := 1;
  v_allergens TEXT[];
  v_dietary TEXT[];
BEGIN
  SELECT COALESCE(yield_quantity, 1)
  INTO v_yield_quantity
  FROM menu_recipes
  WHERE id = p_recipe_id
  FOR UPDATE;

  WITH ingredient_rows AS (
    SELECT
      ri.quantity,
      COALESCE(NULLIF(ri.yield_pct, 0), 100)::NUMERIC AS yield_pct,
      COALESCE(ri.wastage_pct, mi.wastage_pct, 0)::NUMERIC AS wastage_pct,
      COALESCE(ri.cost_override, menu_get_latest_unit_cost(mi.id)) AS unit_cost,
      mi.allergens,
      mi.dietary_flags
    FROM menu_recipe_ingredients ri
    JOIN menu_ingredients mi ON mi.id = ri.ingredient_id
    WHERE ri.recipe_id = p_recipe_id
  ),
  aggregate_rows AS (
    SELECT
      COALESCE(SUM(
        ir.quantity
        * ir.unit_cost
        * 100 / NULLIF(ir.yield_pct, 0)
        * (1 + (COALESCE(ir.wastage_pct, 0) / 100))
      ), 0) AS total_cost,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM ingredient_rows ir2,
        LATERAL UNNEST(ir2.allergens) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS allergens,
      menu_resolve_dietary_claims(
        COALESCE(JSONB_AGG(TO_JSONB(ir.dietary_flags)), '[]'::JSONB)
      ) AS dietary_flags
    FROM ingredient_rows ir
  )
  SELECT
    ar.total_cost,
    ar.allergens,
    ar.dietary_flags
  INTO
    v_total_cost,
    v_allergens,
    v_dietary
  FROM aggregate_rows ar;

  UPDATE menu_recipes
  SET
    portion_cost = ROUND(
      COALESCE(
        v_total_cost / NULLIF(v_yield_quantity, 0),
        v_total_cost,
        0
      )::NUMERIC,
      4
    ),
    allergen_flags = COALESCE(v_allergens, '{}'::TEXT[]),
    dietary_flags = COALESCE(v_dietary, '{}'::TEXT[]),
    updated_at = NOW()
  WHERE id = p_recipe_id;
END;
$$;

COMMENT ON FUNCTION menu_refresh_recipe_calculations(UUID)
  IS 'Calculates cost-per-yield and conservative allergen/dietary aggregates for a recipe';

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
  all_line_costs AS (
    SELECT inclusion_type, option_group, line_cost FROM ingredient_line_costs
    UNION ALL
    SELECT inclusion_type, option_group, line_cost FROM recipe_line_costs
  ),
  base_cost AS (
    SELECT COALESCE(SUM(line_cost), 0) AS total
    FROM all_line_costs
    WHERE inclusion_type IN ('included', 'removable')
  ),
  choice_cost AS (
    SELECT COALESCE(SUM(max_cost), 0) AS total
    FROM (
      SELECT MAX(line_cost) AS max_cost
      FROM all_line_costs
      WHERE inclusion_type = 'choice'
      GROUP BY option_group
    ) per_group
  ),
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
      menu_resolve_dietary_claims(
        COALESCE(
          (SELECT JSONB_AGG(TO_JSONB(af2.dietary_flags)) FROM all_flags af2),
          '[]'::JSONB
        )
      ) AS dietary_flags
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
      BOOL_AND(
        bc.inclusion_type = 'removable'
        OR (
          bc.inclusion_type = 'choice' AND bc.option_group IS NOT NULL
          AND EXISTS (
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
  IS 'Recalculates dish costing, GP percentage, allergen flags, and conservative dietary claims';

UPDATE menu_ingredients
SET dietary_flags = ARRAY['vegetarian']::TEXT[]
WHERE name = 'Vegetable Burger Patty'
  AND NOT ('vegetarian' = ANY(dietary_flags));
