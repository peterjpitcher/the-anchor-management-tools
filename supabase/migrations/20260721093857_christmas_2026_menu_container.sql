-- Christmas 2026 menu container: menu, tier categories, category mappings.
-- Owner-confirmed 2026-07-21. Additive and idempotent.
-- APPLIED to production (tfcasgxopxegwrabvwat) 2026-07-21 as
-- version 20260721093857 via Supabase apply_migration.
--
-- Deliberately contains NO dishes and NO prices; those are in the companion
-- migration 20260721093922_christmas_2026_dishes_and_pricing.sql.

INSERT INTO menu_menus (code, name, description)
VALUES (
  'christmas',
  'Christmas Menu',
  'Festive set menu served 10 November to 20 December 2026. Bookings need 6 or more guests and at least 24 hours notice.'
)
ON CONFLICT (code) DO NOTHING;

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
