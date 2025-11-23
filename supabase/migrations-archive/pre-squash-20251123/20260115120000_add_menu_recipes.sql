-- Menu recipes: group ingredients into reusable prep items that can be dropped into dishes

-- Core recipe table
CREATE TABLE IF NOT EXISTS menu_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  instructions TEXT,
  yield_quantity NUMERIC(12,4) NOT NULL DEFAULT 1,
  yield_unit menu_unit NOT NULL DEFAULT 'portion',
  portion_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  allergen_flags TEXT[] NOT NULL DEFAULT '{}',
  dietary_flags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_recipes IS 'Reusable prep items built from ingredients that can be embedded into dishes';

CREATE INDEX IF NOT EXISTS idx_menu_recipes_active ON menu_recipes(is_active);

-- Ingredients that make up a recipe
CREATE TABLE IF NOT EXISTS menu_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES menu_recipes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES menu_ingredients(id),
  quantity NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit menu_unit NOT NULL,
  yield_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  cost_override NUMERIC(12,4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (recipe_id, ingredient_id)
);

COMMENT ON TABLE menu_recipe_ingredients IS 'Join table linking recipes to the raw ingredients they require';

CREATE INDEX IF NOT EXISTS idx_menu_recipe_ingredients_recipe ON menu_recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_menu_recipe_ingredients_ingredient ON menu_recipe_ingredients(ingredient_id);

-- Link table assigning recipes to dishes
CREATE TABLE IF NOT EXISTS menu_dish_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES menu_dishes(id) ON DELETE CASCADE,
  recipe_id UUID NOT NULL REFERENCES menu_recipes(id),
  quantity NUMERIC(12,4) NOT NULL DEFAULT 0,
  yield_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  cost_override NUMERIC(12,4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dish_id, recipe_id)
);

COMMENT ON TABLE menu_dish_recipes IS 'Associates prepared recipes with dishes alongside direct ingredients';

CREATE INDEX IF NOT EXISTS idx_menu_dish_recipes_dish ON menu_dish_recipes(dish_id);
CREATE INDEX IF NOT EXISTS idx_menu_dish_recipes_recipe ON menu_dish_recipes(recipe_id);

-- Updated costing + aggregation for recipes
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
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM ingredient_rows ir3,
        LATERAL UNNEST(ir3.dietary_flags) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS dietary_flags
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

COMMENT ON FUNCTION menu_refresh_recipe_calculations(UUID) IS 'Calculates cost-per-yield and allergen/dietary aggregates for a recipe';

-- Replace dish refresh logic to include recipes
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
  recipe_rows AS (
    SELECT
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
  combined_rows AS (
    SELECT
      ir.quantity,
      ir.yield_pct,
      ir.dish_wastage_pct,
      ir.ingredient_wastage_pct,
      ir.unit_cost,
      ir.allergens,
      ir.dietary_flags
    FROM ingredient_rows ir
    UNION ALL
    SELECT
      rr.quantity,
      rr.yield_pct,
      rr.dish_wastage_pct,
      0::NUMERIC AS ingredient_wastage_pct,
      rr.unit_cost,
      rr.allergens,
      rr.dietary_flags
    FROM recipe_rows rr
  ),
  cost_rows AS (
    SELECT
      COALESCE(SUM(
        cr.quantity
        * cr.unit_cost
        * 100 / NULLIF(cr.yield_pct, 0)
        * (1 + (COALESCE(cr.dish_wastage_pct, cr.ingredient_wastage_pct, 0) / 100))
      ), 0) AS portion_cost,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM combined_rows cr2,
        LATERAL UNNEST(cr2.allergens) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS allergens,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(flag)
        FROM combined_rows cr3,
        LATERAL UNNEST(cr3.dietary_flags) AS flag
        WHERE flag IS NOT NULL AND flag <> ''
      ), '{}'::TEXT[]) AS dietary_flags
    FROM combined_rows cr
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

-- Trigger helpers
CREATE OR REPLACE FUNCTION menu_trigger_refresh_recipe_calculations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM menu_refresh_recipe_calculations(OLD.recipe_id);
  ELSE
    PERFORM menu_refresh_recipe_calculations(NEW.recipe_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_recipe_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_recipe_id UUID := COALESCE(NEW.id, OLD.id);
  v_dish_id UUID;
BEGIN
  IF v_recipe_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_dish_id IN
    SELECT DISTINCT dr.dish_id
    FROM menu_dish_recipes dr
    WHERE dr.recipe_id = v_recipe_id
  LOOP
    PERFORM menu_refresh_dish_calculations(v_dish_id);
  END LOOP;

  RETURN NULL;
END;
$$;

-- Refresh dishes if their recipe linkage changes
DROP TRIGGER IF EXISTS trg_menu_dish_recipes_refresh ON menu_dish_recipes;
CREATE TRIGGER trg_menu_dish_recipes_refresh
  AFTER INSERT OR UPDATE OR DELETE ON menu_dish_recipes
  FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_dish_calculations();

-- Refresh recipes when their ingredients change
DROP TRIGGER IF EXISTS trg_menu_recipe_ingredients_refresh ON menu_recipe_ingredients;
CREATE TRIGGER trg_menu_recipe_ingredients_refresh
  AFTER INSERT OR UPDATE OR DELETE ON menu_recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_recipe_calculations();

-- Propagate recipe cost changes to dishes
DROP TRIGGER IF EXISTS trg_menu_recipes_refresh_dishes ON menu_recipes;
CREATE TRIGGER trg_menu_recipes_refresh_dishes
  AFTER UPDATE ON menu_recipes
  FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_recipe_update();

-- Updated price change trigger to recalc recipes that include the ingredient
CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_dish_id UUID;
  v_recipe_id UUID;
  v_ingredient_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'menu_ingredients' THEN
    v_ingredient_id := COALESCE(NEW.id, OLD.id);
  ELSE
    v_ingredient_id := COALESCE(NEW.ingredient_id, OLD.ingredient_id);
  END IF;

  IF v_ingredient_id IS NULL THEN
    RETURN NULL;
  END IF;

  FOR v_recipe_id IN
    SELECT DISTINCT ri.recipe_id
    FROM menu_recipe_ingredients ri
    WHERE ri.ingredient_id = v_ingredient_id
  LOOP
    PERFORM menu_refresh_recipe_calculations(v_recipe_id);
  END LOOP;

  FOR v_dish_id IN
    SELECT DISTINCT di.dish_id
    FROM menu_dish_ingredients di
    WHERE di.ingredient_id = v_ingredient_id
  LOOP
    PERFORM menu_refresh_dish_calculations(v_dish_id);
  END LOOP;

  RETURN NULL;
END;
$$;

-- Enable RLS and copy policy model
ALTER TABLE menu_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dish_recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Menu recipes view" ON menu_recipes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu recipes manage" ON menu_recipes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu recipe ingredients view" ON menu_recipe_ingredients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu recipe ingredients manage" ON menu_recipe_ingredients
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

CREATE POLICY "Menu dish recipes view" ON menu_dish_recipes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Menu dish recipes manage" ON menu_dish_recipes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Keep updated_at columns current
DROP TRIGGER IF EXISTS update_menu_recipes_updated_at ON menu_recipes;
CREATE TRIGGER update_menu_recipes_updated_at
  BEFORE UPDATE ON menu_recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_recipe_ingredients_updated_at ON menu_recipe_ingredients;
CREATE TRIGGER update_menu_recipe_ingredients_updated_at
  BEFORE UPDATE ON menu_recipe_ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dish_recipes_updated_at ON menu_dish_recipes;
CREATE TRIGGER update_menu_dish_recipes_updated_at
  BEFORE UPDATE ON menu_dish_recipes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
