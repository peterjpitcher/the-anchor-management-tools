-- Christmas 2026 dishes and confirmed prices. Owner-confirmed 2026-07-21.
-- APPLIED to production (tfcasgxopxegwrabvwat) 2026-07-21 as
-- version 20260721093922 via Supabase apply_migration.
--
-- Allergen flags are deliberately left empty and allergen_verified false:
-- allergens are computed from ingredient rows which staff attach in menu
-- management. The website renders an empty allergen list as
-- "See menu or contact us for allergen information", never as "no allergens",
-- so publishing these before ingredients exist is safe.
--
-- Price provenance (NOT computed at runtime, recorded for humans only):
--   adult 1 course = adult Sunday roast + 7   (16/17/18 -> 23/24/25)
--   kids  1 course = kids  Sunday roast + 4   (14/15/16 -> 18/19/20)
--   2 course = 3 course minus 3
-- Never compute these on the website; a roast price change must not silently
-- move a Christmas price the till does not charge.

INSERT INTO menu_dishes (name, slug, description, selling_price, is_active)
VALUES
  ('Christmas Dinner, Turkey', 'christmas-dinner-turkey',
   'Roast turkey with all the Christmas trimmings, including pigs in blankets, stuffing and brussels sprouts. Served with a glass of prosecco, swappable for orange juice.',
   23.00, true),
  ('Christmas Dinner, Pork', 'christmas-dinner-pork',
   'Roast pork with all the Christmas trimmings, including pigs in blankets, stuffing and brussels sprouts. Served with a glass of prosecco, swappable for orange juice.',
   24.00, true),
  ('Christmas Dinner, Beef', 'christmas-dinner-beef',
   'Roast beef with all the Christmas trimmings, including pigs in blankets, stuffing and brussels sprouts. Served with a glass of prosecco, swappable for orange juice.',
   25.00, true),
  ('Kids Christmas Dinner, Turkey', 'kids-christmas-dinner-turkey',
   'A child sized roast turkey dinner with the Christmas trimmings. Served with a Fruit Shoot or a small soft drink (Coca-Cola, Diet Coke or lemonade).',
   18.00, true),
  ('Kids Christmas Dinner, Pork', 'kids-christmas-dinner-pork',
   'A child sized roast pork dinner with the Christmas trimmings. Served with a Fruit Shoot or a small soft drink (Coca-Cola, Diet Coke or lemonade).',
   19.00, true),
  ('Kids Christmas Dinner, Beef', 'kids-christmas-dinner-beef',
   'A child sized roast beef dinner with the Christmas trimmings. Served with a Fruit Shoot or a small soft drink (Coca-Cola, Diet Coke or lemonade).',
   20.00, true),
  ('Two Course Festive Menu, Tuesday to Thursday', 'christmas-two-course-weekday',
   'Two course festive set menu on Tuesday to Thursday. Pre-book and pre-order only. Includes a glass of prosecco, swappable for orange juice. Full dish list released closer to the time.',
   33.95, true),
  ('Two Course Festive Menu, Friday to Saturday', 'christmas-two-course-weekend',
   'Two course festive set menu on Friday and Saturday. Pre-book and pre-order only. Includes a glass of prosecco, swappable for orange juice. Full dish list released closer to the time.',
   36.95, true),
  ('Three Course Festive Menu, Tuesday to Thursday', 'christmas-three-course-weekday',
   'Three course festive set menu on Tuesday to Thursday. Pre-book and pre-order only. Includes a glass of prosecco, swappable for orange juice. Full dish list released closer to the time.',
   36.95, true),
  ('Three Course Festive Menu, Friday to Saturday', 'christmas-three-course-weekend',
   'Three course festive set menu on Friday and Saturday. Pre-book and pre-order only. Includes a glass of prosecco, swappable for orange juice. Full dish list released closer to the time.',
   39.95, true)
ON CONFLICT (slug) DO UPDATE
  SET selling_price = EXCLUDED.selling_price,
      description   = EXCLUDED.description,
      is_active     = EXCLUDED.is_active,
      updated_at    = now();

INSERT INTO menu_dish_menu_assignments
  (dish_id, menu_id, category_id, sort_order, available_from, available_until)
SELECT d.id, m.id, c.id, v.sort_order, DATE '2026-11-10', DATE '2026-12-20'
FROM (VALUES
  ('christmas-dinner-turkey',            'christmas_one_course_adult', 10),
  ('christmas-dinner-pork',              'christmas_one_course_adult', 20),
  ('christmas-dinner-beef',              'christmas_one_course_adult', 30),
  ('kids-christmas-dinner-turkey',       'christmas_one_course_kids',  10),
  ('kids-christmas-dinner-pork',         'christmas_one_course_kids',  20),
  ('kids-christmas-dinner-beef',         'christmas_one_course_kids',  30),
  ('christmas-two-course-weekday',       'christmas_two_course',       10),
  ('christmas-two-course-weekend',       'christmas_two_course',       20),
  ('christmas-three-course-weekday',     'christmas_three_course',     10),
  ('christmas-three-course-weekend',     'christmas_three_course',     20)
) AS v(dish_slug, category_code, sort_order)
JOIN menu_dishes d      ON d.slug = v.dish_slug
JOIN menu_categories c  ON c.code = v.category_code
CROSS JOIN menu_menus m
WHERE m.code = 'christmas'
ON CONFLICT (dish_id, menu_id, category_id) DO UPDATE
  SET available_from  = EXCLUDED.available_from,
      available_until = EXCLUDED.available_until,
      sort_order      = EXCLUDED.sort_order,
      updated_at      = now();
