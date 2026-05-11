-- Sunday lunch menu refresh - 11 May 2026
--
-- Keeps the Sunday lunch menu to the approved current line-up, updates prices,
-- descriptions and ordering, and marks all other Sunday lunch items inactive.
--
-- The management app reads the menu from menu_dishes/menu_dish_menu_assignments.
-- sunday_lunch_menu_items remains populated as the legacy fallback.

BEGIN;

CREATE TEMP TABLE tmp_sunday_lunch_refresh (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10, 2) NOT NULL,
  legacy_category TEXT NOT NULL CHECK (legacy_category IN ('main', 'side')),
  menu_category_code TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  legacy_allergens TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  legacy_dietary_info TEXT[] NOT NULL DEFAULT '{}'::TEXT[]
) ON COMMIT DROP;

INSERT INTO tmp_sunday_lunch_refresh (
  slug,
  name,
  description,
  price,
  legacy_category,
  menu_category_code,
  sort_order,
  legacy_allergens,
  legacy_dietary_info
) VALUES
(
  'roasted-turkey-with-stuffing-ball',
  'Roasted Turkey with Stuffing Ball',
  'Tender roasted turkey with a sage and onion stuffing ball, served with golden triple-cooked herb-crusted roast potatoes, a fluffy Yorkshire pudding, oven-roasted carrots and parsnips, buttery sauteed cabbage and our signature gravy.',
  16.00,
  'main',
  'sunday_lunch_mains',
  1,
  ARRAY['Gluten']::TEXT[],
  ARRAY[]::TEXT[]
),
(
  'roasted-beef',
  'Roasted Beef',
  'A comforting roast beef dinner, rich and full of flavour, served with golden triple-cooked herb-crusted roast potatoes, a fluffy Yorkshire pudding, oven-roasted carrots and parsnips, buttery sauteed cabbage and our signature gravy.',
  18.00,
  'main',
  'sunday_lunch_mains',
  2,
  ARRAY['Gluten']::TEXT[],
  ARRAY[]::TEXT[]
),
(
  'roasted-pork',
  'Roasted Pork',
  'Juicy roasted pork with proper home-cooked Sunday flavour, served with golden triple-cooked herb-crusted roast potatoes, a fluffy Yorkshire pudding, oven-roasted carrots and parsnips, buttery sauteed cabbage and our signature gravy.',
  17.00,
  'main',
  'sunday_lunch_mains',
  3,
  ARRAY['Gluten']::TEXT[],
  ARRAY[]::TEXT[]
),
(
  'beef-ale-pie-roast',
  'Beef & Ale Pie Roast',
  'Beef and ale pie served as a Sunday roast with triple-cooked herb-crusted roast potatoes, oven-roasted carrots and parsnips, buttery sauteed cabbage and our signature gravy. Served without Yorkshire pudding.',
  18.00,
  'main',
  'sunday_lunch_mains',
  4,
  ARRAY['Gluten']::TEXT[],
  ARRAY[]::TEXT[]
),
(
  'chicken-wild-mushroom-pie-roast',
  'Chicken & Wild Mushroom Pie Roast',
  'Chicken and wild mushroom pie served as a Sunday roast with triple-cooked herb-crusted roast potatoes, oven-roasted carrots and parsnips, buttery sauteed cabbage and our signature gravy. Served without Yorkshire pudding.',
  18.00,
  'main',
  'sunday_lunch_mains',
  5,
  ARRAY['Gluten']::TEXT[],
  ARRAY[]::TEXT[]
),
(
  'beetroot-butternut-squash-wellington',
  'Beetroot & Butternut Squash Wellington',
  'Golden puff pastry filled with beetroot and butternut squash, served with triple-cooked herb-crusted roast potatoes, a fluffy Yorkshire pudding, oven-roasted carrots and parsnips, buttery sauteed cabbage and gravy.',
  17.00,
  'main',
  'sunday_lunch_mains',
  6,
  ARRAY['Gluten']::TEXT[],
  ARRAY['Vegetarian']::TEXT[]
),
(
  'broccoli-cheese',
  'Broccoli Cheese',
  'Broccoli baked in a creamy cheese sauce until golden and bubbling.',
  4.00,
  'side',
  'sunday_lunch_sides',
  1,
  ARRAY['Milk']::TEXT[],
  ARRAY['Vegetarian']::TEXT[]
),
(
  'gourmet-broccoli-cheese',
  'Gourmet Broccoli Cheese',
  'A richer broccoli cheese bake, finished with a hint of truffle and a crisp golden crumb.',
  6.00,
  'side',
  'sunday_lunch_sides',
  2,
  ARRAY['Gluten', 'Milk']::TEXT[],
  ARRAY['Vegetarian']::TEXT[]
);

-- Deactivate removed Sunday lunch dishes in the menu-management tables.
UPDATE menu_dishes d
SET
  is_active = false,
  updated_at = NOW()
WHERE d.is_sunday_lunch = true
  AND NOT EXISTS (
    SELECT 1
    FROM tmp_sunday_lunch_refresh f
    WHERE f.slug = d.slug
       OR LOWER(f.name) = LOWER(d.name)
  );

-- Update existing rows for the approved Sunday lunch dishes.
UPDATE menu_dishes d
SET
  name = f.name,
  slug = f.slug,
  description = f.description,
  selling_price = f.price,
  is_active = true,
  is_sunday_lunch = true,
  updated_at = NOW()
FROM tmp_sunday_lunch_refresh f
WHERE f.slug = d.slug
   OR LOWER(f.name) = LOWER(d.name);

-- Insert any approved dishes that are missing.
INSERT INTO menu_dishes (
  name,
  slug,
  description,
  selling_price,
  target_gp_pct,
  portion_cost,
  is_active,
  is_sunday_lunch
)
SELECT
  f.name,
  f.slug,
  f.description,
  f.price,
  0.70,
  0,
  true,
  true
FROM tmp_sunday_lunch_refresh f
WHERE NOT EXISTS (
  SELECT 1
  FROM menu_dishes d
  WHERE d.slug = f.slug
     OR LOWER(d.name) = LOWER(f.name)
);

-- Ensure every approved dish is assigned to the Sunday lunch menu in the right order.
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
  m.id,
  c.id,
  f.sort_order,
  false,
  false
FROM tmp_sunday_lunch_refresh f
JOIN menu_dishes d ON d.slug = f.slug OR LOWER(d.name) = LOWER(f.name)
JOIN menu_menus m ON m.code = 'sunday_lunch'
JOIN menu_categories c ON c.code = f.menu_category_code
ON CONFLICT (dish_id, menu_id, category_id) DO UPDATE
SET
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- Keep the legacy fallback table aligned.
UPDATE sunday_lunch_menu_items slmi
SET
  is_active = false,
  updated_at = NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM tmp_sunday_lunch_refresh f
  WHERE LOWER(f.name) = LOWER(slmi.name)
);

UPDATE sunday_lunch_menu_items slmi
SET
  name = f.name,
  description = f.description,
  price = f.price,
  category = f.legacy_category,
  is_active = true,
  display_order = f.sort_order,
  allergens = f.legacy_allergens,
  dietary_info = f.legacy_dietary_info,
  updated_at = NOW()
FROM tmp_sunday_lunch_refresh f
WHERE LOWER(f.name) = LOWER(slmi.name);

INSERT INTO sunday_lunch_menu_items (
  name,
  description,
  price,
  category,
  is_active,
  display_order,
  allergens,
  dietary_info
)
SELECT
  f.name,
  f.description,
  f.price,
  f.legacy_category,
  true,
  f.sort_order,
  f.legacy_allergens,
  f.legacy_dietary_info
FROM tmp_sunday_lunch_refresh f
WHERE NOT EXISTS (
  SELECT 1
  FROM sunday_lunch_menu_items slmi
  WHERE LOWER(slmi.name) = LOWER(f.name)
);

COMMIT;

-- Verify current active Sunday lunch items from both data sources.
SELECT
  d.name,
  d.selling_price,
  c.code AS category_code,
  dma.sort_order,
  d.is_active
FROM menu_dish_menu_assignments dma
JOIN menu_menus m ON m.id = dma.menu_id
JOIN menu_categories c ON c.id = dma.category_id
JOIN menu_dishes d ON d.id = dma.dish_id
WHERE m.code = 'sunday_lunch'
ORDER BY c.code, dma.sort_order, d.name;

SELECT name, price, category, is_active, display_order
FROM sunday_lunch_menu_items
ORDER BY is_active DESC, category, display_order, name;
