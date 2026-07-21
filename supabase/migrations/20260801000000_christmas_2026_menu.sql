-- ============================================================================
-- DRAFT ONLY. DO NOT APPLY WITHOUT EXPLICIT OWNER APPROVAL.
-- ============================================================================
-- Christmas 2026 menu scaffolding for the public menu API (/api/menu?menu=christmas).
--
-- What this migration does:
--   1. Inserts the menu_menus row with code 'christmas'.
--   2. Inserts the menu_categories rows for the three Christmas tiers, with an
--      adult/kids split on the 1 course tier only.
--   3. Maps those categories to the christmas menu via menu_category_menus.
--
-- What this migration deliberately DOES NOT do:
--   * It does NOT insert menu_dishes rows and it does NOT insert any dish
--     prices. Dish allergen_flags and dietary_flags are COMPUTED from the
--     ingredient rows attached to each dish (see menu_refresh_dish_calculations
--     and menu_dishes_with_costs). Seeding dishes here without ingredients would
--     publish an empty allergen array, which reads to a customer as "no
--     allergens". Staff must create the dishes in /menu-management, attach
--     ingredients, and let the allergen calculation run.
--   * It does NOT touch booking RPCs, deposits, or any payment code.
--
-- Availability window: 10 November 2026 to 20 December 2026 inclusive.
-- The window is enforced per dish through
-- menu_dish_menu_assignments.available_from / available_until, which the
-- /api/menu route already filters on. A commented template for those
-- assignments is at the foot of this file.
--
-- Business facts this scaffolding encodes (owner confirmed 21 July 2026):
--   * 1 course: adult and kids tiers both exist.
--   * 2 course and 3 course: adult pricing only. There is no kids 2 or 3 course
--     tier. Children may order the adult tiers at the adult price, so no
--     separate child category exists for those two tiers by design.
--   * Weekday means Tuesday to Thursday, weekend means Friday to Saturday. That
--     split is a price attribute of the tier and is presented in page copy, not
--     modelled as separate categories.
--   * Menu dishes are not finalised. Copy says "menu released closer to the
--     time". Do not invent dish names here.
-- ============================================================================

BEGIN;

-- 1. The Christmas menu itself.
INSERT INTO menu_menus (code, name, description)
VALUES (
  'christmas',
  'Christmas Menu',
  'Festive set menu served 10 November to 20 December 2026. Bookings need 6 or more guests and at least 24 hours notice.'
)
ON CONFLICT (code) DO NOTHING;

-- 2. Tier categories.
-- sort_order continues past the existing seeded categories, which end at 130.
INSERT INTO menu_categories (code, name, description, sort_order)
VALUES
  (
    'christmas_one_course_adult',
    'Christmas 1 Course (Adults)',
    'Single course festive main for adults. Pre-book only, no pre-order. Includes a glass of prosecco, swappable for orange juice.',
    200
  ),
  (
    'christmas_one_course_kids',
    'Christmas 1 Course (Children)',
    'Single course festive main for children. Includes a Fruit Shoot or a small soft drink (Coca-Cola, Diet Coke or lemonade).',
    210
  ),
  (
    'christmas_two_course',
    'Christmas 2 Course',
    'Two course festive set menu. Pre-book and pre-order only. Adult pricing only, there is no child portion or child price for this tier. Includes a glass of prosecco, swappable for orange juice.',
    220
  ),
  (
    'christmas_three_course',
    'Christmas 3 Course',
    'Three course festive set menu. Pre-book and pre-order only. Adult pricing only, there is no child portion or child price for this tier. Includes a glass of prosecco, swappable for orange juice.',
    230
  )
ON CONFLICT (code) DO NOTHING;

-- 3. Map the tier categories onto the Christmas menu.
INSERT INTO menu_category_menus (menu_id, category_id, sort_order)
SELECT m.id, c.id, c.sort_order
FROM menu_menus m
JOIN menu_categories c ON c.code IN (
  'christmas_one_course_adult',
  'christmas_one_course_kids',
  'christmas_two_course',
  'christmas_three_course'
)
WHERE m.code = 'christmas'
ON CONFLICT (menu_id, category_id) DO NOTHING;

COMMIT;

-- ============================================================================
-- TEMPLATE, NOT EXECUTED. For staff or a follow-up migration once dishes exist.
--
-- Once each dish has been created in /menu-management WITH its ingredient rows
-- attached (so allergens compute correctly), assign it to the Christmas menu
-- and scope it to the trading window with the statement below. Prices live on
-- menu_dishes.selling_price and are served live by /api/menu. Never hardcode a
-- Christmas dish price into website page code.
--
-- INSERT INTO menu_dish_menu_assignments (
--   dish_id,
--   menu_id,
--   category_id,
--   sort_order,
--   available_from,
--   available_until
-- )
-- SELECT
--   d.id,
--   m.id,
--   c.id,
--   10,
--   DATE '2026-11-10',
--   DATE '2026-12-20'
-- FROM menu_dishes d
-- CROSS JOIN menu_menus m
-- CROSS JOIN menu_categories c
-- WHERE d.slug = '<dish-slug>'
--   AND m.code = 'christmas'
--   AND c.code = '<one of the four christmas_* category codes>'
-- ON CONFLICT (dish_id, menu_id, category_id) DO UPDATE
--   SET available_from = EXCLUDED.available_from,
--       available_until = EXCLUDED.available_until,
--       sort_order = EXCLUDED.sort_order;
--
-- 20 December 2026 is INCLUSIVE. available_until is a DATE and the API compares
-- it against "now", so DATE '2026-12-20' keeps the menu visible through that
-- day's service.
-- ============================================================================
