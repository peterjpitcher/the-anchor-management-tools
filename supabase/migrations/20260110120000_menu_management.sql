-- Menu management schema unification

-- Create enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'menu_unit') THEN
    CREATE TYPE menu_unit AS ENUM (
      'each',
      'portion',
      'gram',
      'kilogram',
      'millilitre',
      'litre',
      'ounce',
      'pound',
      'teaspoon',
      'tablespoon',
      'cup',
      'slice',
      'piece'
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'menu_storage_type') THEN
    CREATE TYPE menu_storage_type AS ENUM (
      'ambient',
      'chilled',
      'frozen',
      'dry',
      'other'
    );
  END IF;
END$$;

-- Ingredients
CREATE TABLE IF NOT EXISTS menu_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_unit menu_unit NOT NULL DEFAULT 'each',
  storage_type menu_storage_type NOT NULL DEFAULT 'ambient',
  supplier_name TEXT,
  supplier_sku TEXT,
  brand TEXT,
  pack_size NUMERIC(12,4),
  pack_size_unit menu_unit,
  pack_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  portions_per_pack NUMERIC(12,4),
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  shelf_life_days INTEGER,
  allergens TEXT[] NOT NULL DEFAULT '{}',
  dietary_flags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_ingredients IS 'Core ingredients used for menu dishes with costing metadata';

CREATE INDEX IF NOT EXISTS idx_menu_ingredients_active ON menu_ingredients(is_active);
CREATE INDEX IF NOT EXISTS idx_menu_ingredients_supplier ON menu_ingredients(LOWER(supplier_name));

-- Ingredient price history
CREATE TABLE IF NOT EXISTS menu_ingredient_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID NOT NULL REFERENCES menu_ingredients(id) ON DELETE CASCADE,
  pack_cost NUMERIC(12,4) NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supplier_name TEXT,
  supplier_sku TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_ingredient_prices IS 'Historical price records for ingredients';

CREATE INDEX IF NOT EXISTS idx_menu_ingredient_prices_ingredient ON menu_ingredient_prices(ingredient_id, effective_from DESC);

-- Menus (e.g. website food, Sunday lunch)
CREATE TABLE IF NOT EXISTS menu_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_menus IS 'Named menus that dishes can be assigned to (e.g. website food menu, Sunday lunch)';

-- Menu categories
CREATE TABLE IF NOT EXISTS menu_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_categories IS 'Standardised categories for organising dishes';

-- Menu/category mapping
CREATE TABLE IF NOT EXISTS menu_category_menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES menu_menus(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (menu_id, category_id)
);

COMMENT ON TABLE menu_category_menus IS 'Associates categories with specific menus';

-- Dishes
CREATE TABLE IF NOT EXISTS menu_dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  description TEXT,
  selling_price NUMERIC(12,4) NOT NULL DEFAULT 0,
  target_gp_pct NUMERIC(6,4) NOT NULL DEFAULT 0.70,
  portion_cost NUMERIC(12,4) NOT NULL DEFAULT 0,
  gp_pct NUMERIC(6,4),
  allergen_flags TEXT[] NOT NULL DEFAULT '{}',
  dietary_flags TEXT[] NOT NULL DEFAULT '{}',
  calories INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_sunday_lunch BOOLEAN NOT NULL DEFAULT false,
  image_url TEXT,
  notes TEXT,
  is_gp_alert BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE menu_dishes IS 'Menu-ready dishes composed of ingredients and attached to menus/categories';

CREATE INDEX IF NOT EXISTS idx_menu_dishes_active ON menu_dishes(is_active);
CREATE INDEX IF NOT EXISTS idx_menu_dishes_sunday_lunch ON menu_dishes(is_sunday_lunch);

-- Dish ingredients
CREATE TABLE IF NOT EXISTS menu_dish_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES menu_dishes(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES menu_ingredients(id),
  quantity NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit menu_unit NOT NULL,
  yield_pct NUMERIC(6,3) NOT NULL DEFAULT 100,
  wastage_pct NUMERIC(6,3) NOT NULL DEFAULT 0,
  cost_override NUMERIC(12,4),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dish_id, ingredient_id)
);

COMMENT ON TABLE menu_dish_ingredients IS 'Join table defining ingredient quantities for a dish';

CREATE INDEX IF NOT EXISTS idx_menu_dish_ingredients_dish ON menu_dish_ingredients(dish_id);
CREATE INDEX IF NOT EXISTS idx_menu_dish_ingredients_ingredient ON menu_dish_ingredients(ingredient_id);

-- Dish assignments to menus/categories
CREATE TABLE IF NOT EXISTS menu_dish_menu_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dish_id UUID NOT NULL REFERENCES menu_dishes(id) ON DELETE CASCADE,
  menu_id UUID NOT NULL REFERENCES menu_menus(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES menu_categories(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  available_from DATE,
  available_until DATE,
  is_special BOOLEAN NOT NULL DEFAULT false,
  is_default_side BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dish_id, menu_id, category_id)
);

COMMENT ON TABLE menu_dish_menu_assignments IS 'Placement of dishes within menus and categories';

CREATE INDEX IF NOT EXISTS idx_menu_dish_menu_assignments_menu ON menu_dish_menu_assignments(menu_id, category_id, sort_order);

-- Helper function to fetch latest ingredient price (pack cost)
CREATE OR REPLACE FUNCTION menu_get_latest_pack_cost(p_ingredient_id UUID)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT COALESCE(
    (
      SELECT mip.pack_cost
      FROM menu_ingredient_prices mip
      WHERE mip.ingredient_id = p_ingredient_id
      ORDER BY mip.effective_from DESC
      LIMIT 1
    ),
    mi.pack_cost
  )
  FROM menu_ingredients mi
  WHERE mi.id = p_ingredient_id;
$$;

COMMENT ON FUNCTION menu_get_latest_pack_cost(UUID) IS 'Returns the most recent pack cost for an ingredient, falling back to the base pack_cost column';

-- Helper to determine unit cost based on portions per pack or pack size
CREATE OR REPLACE FUNCTION menu_get_latest_unit_cost(p_ingredient_id UUID)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
  SELECT 
    CASE
      WHEN mi.portions_per_pack IS NOT NULL AND mi.portions_per_pack > 0
        THEN COALESCE(menu_get_latest_pack_cost(mi.id) / mi.portions_per_pack, 0)
      WHEN mi.pack_size IS NOT NULL AND mi.pack_size > 0
        THEN COALESCE(menu_get_latest_pack_cost(mi.id) / mi.pack_size, 0)
      ELSE COALESCE(menu_get_latest_pack_cost(mi.id), 0)
    END
  FROM menu_ingredients mi
  WHERE mi.id = p_ingredient_id;
$$;

COMMENT ON FUNCTION menu_get_latest_unit_cost(UUID) IS 'Returns the cost per base unit/portion for an ingredient';

-- Refresh dish costing and dietary/allergen aggregates
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
  cost_rows AS (
    SELECT
      COALESCE(SUM(
        (
          ir.quantity
          * ir.unit_cost
          * 100 / NULLIF(ir.yield_pct, 0)
          * (1 + (COALESCE(ir.dish_wastage_pct, ir.ingredient_wastage_pct, 0) / 100))
        )
      ), 0) AS portion_cost,
      COALESCE(ARRAY(
        SELECT DISTINCT TRIM(allergen)
        FROM ingredient_rows ir2,
        LATERAL UNNEST(ir2.allergens) AS allergen
        WHERE allergen IS NOT NULL AND allergen <> ''
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

COMMENT ON FUNCTION menu_refresh_dish_calculations(UUID) IS 'Recalculates dish costing, GP percentage, and aggregated allergen/dietary flags';

-- Trigger wrapper to refresh after dish ingredient changes
CREATE OR REPLACE FUNCTION menu_trigger_refresh_dish_calculations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM menu_refresh_dish_calculations(OLD.dish_id);
  ELSE
    PERFORM menu_refresh_dish_calculations(NEW.dish_id);
  END IF;
  RETURN NULL;
END;
$$;

-- Trigger to refresh when selling price or target GP changes
CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_dish_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM menu_refresh_dish_calculations(NEW.id);
  RETURN NEW;
END;
$$;

-- Trigger to refresh when ingredient pricing changes
CREATE OR REPLACE FUNCTION menu_trigger_refresh_after_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_dish_id UUID;
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

-- Attach triggers
DROP TRIGGER IF EXISTS trg_menu_dish_ingredients_refresh ON menu_dish_ingredients;
CREATE TRIGGER trg_menu_dish_ingredients_refresh
AFTER INSERT OR UPDATE OR DELETE ON menu_dish_ingredients
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_dish_calculations();

DROP TRIGGER IF EXISTS trg_menu_dishes_refresh ON menu_dishes;
CREATE TRIGGER trg_menu_dishes_refresh
AFTER INSERT OR UPDATE OF selling_price, target_gp_pct ON menu_dishes
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_dish_update();

DROP TRIGGER IF EXISTS trg_menu_ingredient_prices_refresh ON menu_ingredient_prices;
CREATE TRIGGER trg_menu_ingredient_prices_refresh
AFTER INSERT OR UPDATE ON menu_ingredient_prices
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_price_change();

DROP TRIGGER IF EXISTS trg_menu_ingredients_refresh ON menu_ingredients;
CREATE TRIGGER trg_menu_ingredients_refresh
AFTER UPDATE ON menu_ingredients
FOR EACH ROW EXECUTE FUNCTION menu_trigger_refresh_after_price_change();

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_menu_ingredients_updated_at ON menu_ingredients;
CREATE TRIGGER update_menu_ingredients_updated_at
  BEFORE UPDATE ON menu_ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_menus_updated_at ON menu_menus;
CREATE TRIGGER update_menu_menus_updated_at
  BEFORE UPDATE ON menu_menus
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_categories_updated_at ON menu_categories;
CREATE TRIGGER update_menu_categories_updated_at
  BEFORE UPDATE ON menu_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dishes_updated_at ON menu_dishes;
CREATE TRIGGER update_menu_dishes_updated_at
  BEFORE UPDATE ON menu_dishes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dish_ingredients_updated_at ON menu_dish_ingredients;
CREATE TRIGGER update_menu_dish_ingredients_updated_at
  BEFORE UPDATE ON menu_dish_ingredients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_menu_dish_menu_assignments_updated_at ON menu_dish_menu_assignments;
CREATE TRIGGER update_menu_dish_menu_assignments_updated_at
  BEFORE UPDATE ON menu_dish_menu_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views
CREATE OR REPLACE VIEW menu_dishes_with_costs AS
  SELECT
    d.id AS dish_id,
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
    dma.available_until
  FROM menu_dishes d
  JOIN menu_dish_menu_assignments dma ON dma.dish_id = d.id
  JOIN menu_menus m ON m.id = dma.menu_id
  JOIN menu_categories c ON c.id = dma.category_id;

COMMENT ON VIEW menu_dishes_with_costs IS 'Flattened view exposing dishes with menu/category placement and costing';

CREATE OR REPLACE VIEW menu_ingredients_with_prices AS
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

-- Row Level Security
ALTER TABLE menu_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_ingredient_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_category_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dish_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_dish_menu_assignments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if script rerun
DO $$
BEGIN
  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_ingredients';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu ingredients view" ON menu_ingredients;
    DROP POLICY IF EXISTS "Menu ingredients manage" ON menu_ingredients;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_ingredient_prices';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu ingredient prices view" ON menu_ingredient_prices;
    DROP POLICY IF EXISTS "Menu ingredient prices manage" ON menu_ingredient_prices;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_menus';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu menus view" ON menu_menus;
    DROP POLICY IF EXISTS "Menu menus manage" ON menu_menus;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_categories';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu categories view" ON menu_categories;
    DROP POLICY IF EXISTS "Menu categories manage" ON menu_categories;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_category_menus';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu category menus view" ON menu_category_menus;
    DROP POLICY IF EXISTS "Menu category menus manage" ON menu_category_menus;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_dishes';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu dishes view" ON menu_dishes;
    DROP POLICY IF EXISTS "Menu dishes manage" ON menu_dishes;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_dish_ingredients';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu dish ingredients view" ON menu_dish_ingredients;
    DROP POLICY IF EXISTS "Menu dish ingredients manage" ON menu_dish_ingredients;
  END IF;

  PERFORM 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'menu_dish_menu_assignments';
  IF FOUND THEN
    DROP POLICY IF EXISTS "Menu dish assignments view" ON menu_dish_menu_assignments;
    DROP POLICY IF EXISTS "Menu dish assignments manage" ON menu_dish_menu_assignments;
  END IF;
END$$;

-- Policies
CREATE POLICY "Menu ingredients view" ON menu_ingredients
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

CREATE POLICY "Menu ingredients manage" ON menu_ingredients
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

CREATE POLICY "Menu ingredient prices view" ON menu_ingredient_prices
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

CREATE POLICY "Menu ingredient prices manage" ON menu_ingredient_prices
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

CREATE POLICY "Menu menus view" ON menu_menus
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu menus manage" ON menu_menus
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

CREATE POLICY "Menu categories view" ON menu_categories
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu categories manage" ON menu_categories
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

CREATE POLICY "Menu category menus view" ON menu_category_menus
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu category menus manage" ON menu_category_menus
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

CREATE POLICY "Menu dishes view" ON menu_dishes
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

CREATE POLICY "Menu dishes manage" ON menu_dishes
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

CREATE POLICY "Menu dish ingredients view" ON menu_dish_ingredients
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

CREATE POLICY "Menu dish ingredients manage" ON menu_dish_ingredients
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

CREATE POLICY "Menu dish assignments view" ON menu_dish_menu_assignments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Menu dish assignments manage" ON menu_dish_menu_assignments
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

-- Seed menus
INSERT INTO menu_menus (code, name, description)
VALUES
  ('website_food', 'Website Food Menu', 'Primary menu for the public website'),
  ('sunday_lunch', 'Sunday Lunch', 'Pre-orderable Sunday lunch menu'),
  ('drinks', 'Drinks Menu', 'Hot and cold drink offerings')
ON CONFLICT (code) DO NOTHING;

-- Seed categories
INSERT INTO menu_categories (code, name, description, sort_order)
VALUES
  ('starters', 'Starters', 'Light dishes to start the meal', 10),
  ('light_bites', 'Light Bites', 'Smaller plates and sharers', 20),
  ('snack_pots', 'Snack Pots', 'Snacks and sharing pots', 30),
  ('burgers', 'Burgers', 'Burger selection', 40),
  ('pizza', 'Pizza', 'Stone baked pizza range', 50),
  ('chip_shop', 'Chip Shop', 'Chip shop classics', 60),
  ('mains', 'Mains', 'Main dishes', 70),
  ('sunday_lunch_mains', 'Sunday Lunch Mains', 'Sunday lunch main courses', 80),
  ('sunday_lunch_sides', 'Sunday Lunch Sides', 'Included and extra sides for Sunday lunch', 90),
  ('desserts', 'Desserts', 'Sweet finishes', 100),
  ('kids', 'Kids', 'Children''s dishes', 110),
  ('hot_drinks', 'Hot Drinks', 'Teas, coffees, and hot drinks', 120),
  ('drinks', 'Drinks', 'Cold drinks and soft drinks', 130)
ON CONFLICT (code) DO NOTHING;

-- Map categories to menus
INSERT INTO menu_category_menus (menu_id, category_id, sort_order)
SELECT m.id, c.id, c.sort_order
FROM menu_menus m
JOIN menu_categories c ON (
  (m.code = 'website_food' AND c.code IN ('starters','light_bites','snack_pots','burgers','pizza','chip_shop','mains','desserts','kids','hot_drinks','drinks')) OR
  (m.code = 'sunday_lunch' AND c.code IN ('sunday_lunch_mains','sunday_lunch_sides','desserts','drinks','hot_drinks')) OR
  (m.code = 'drinks' AND c.code IN ('drinks','hot_drinks'))
)
ON CONFLICT (menu_id, category_id) DO NOTHING;

-- Seed default ingredients for legacy mapping (placeholder, optional)
-- None for now

-- Migrate existing Sunday lunch menu items into new tables (if present)
INSERT INTO menu_dishes (
  name,
  description,
  selling_price,
  target_gp_pct,
  portion_cost,
  gp_pct,
  allergen_flags,
  dietary_flags,
  calories,
  is_active,
  is_sunday_lunch,
  image_url,
  notes,
  is_gp_alert
)
SELECT
  slmi.name,
  slmi.description,
  slmi.price,
  0.70,
  0,
  NULL,
  COALESCE(slmi.allergens, '{}'::TEXT[]),
  COALESCE(slmi.dietary_info, '{}'::TEXT[]),
  NULL,
  slmi.is_active,
  true,
  NULL,
  NULL,
  false
FROM sunday_lunch_menu_items slmi
WHERE NOT EXISTS (
  SELECT 1
  FROM menu_dishes md
  WHERE md.name = slmi.name
);

-- Assign migrated dishes to Sunday lunch menu/categories
INSERT INTO menu_dish_menu_assignments (
  dish_id,
  menu_id,
  category_id,
  sort_order,
  is_special,
  is_default_side
)
SELECT
  d.id,
  (SELECT id FROM menu_menus WHERE code = 'sunday_lunch'),
  CASE 
    WHEN slmi.category = 'main' THEN (SELECT id FROM menu_categories WHERE code = 'sunday_lunch_mains')
    WHEN slmi.category IN ('side', 'extra') THEN (SELECT id FROM menu_categories WHERE code = 'sunday_lunch_sides')
    ELSE (SELECT id FROM menu_categories WHERE code = 'sunday_lunch_mains')
  END,
  slmi.display_order,
  false,
  CASE 
    WHEN slmi.category = 'side' AND slmi.price = 0 THEN true
    ELSE false
  END
FROM sunday_lunch_menu_items slmi
JOIN menu_dishes d ON d.name = slmi.name
LEFT JOIN menu_dish_menu_assignments existing ON existing.dish_id = d.id
WHERE existing.id IS NULL;

DO $$
DECLARE
  v_dish_id UUID;
BEGIN
  FOR v_dish_id IN
    SELECT id FROM menu_dishes WHERE is_sunday_lunch = true
  LOOP
    PERFORM menu_refresh_dish_calculations(v_dish_id);
  END LOOP;
END $$;

-- Permissions for menu management
INSERT INTO permissions (module_name, action, description)
VALUES
  ('menu_management', 'view', 'View menu management tools'),
  ('menu_management', 'manage', 'Manage menu ingredients, dishes, and assignments')
ON CONFLICT (module_name, action) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.module_name = 'menu_management' AND p.action IN ('view', 'manage')
WHERE r.name IN ('super_admin', 'manager')
ON CONFLICT DO NOTHING;
