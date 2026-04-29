-- Sunday roast menu refresh — 28 April 2026
--
-- Replaces the launch menu with the new line-up:
--   - Drops adult Roasted Chicken (replaced by chicken & wild mushroom pie).
--   - Drops Slow-Cooked Lamb Shank entirely (no longer offered).
--   - Drops Crispy Pork Belly (replaced by sliced roast pork leg).
--   - Drops Cauliflower Cheese side (no longer offered).
--   - Updates Beetroot & Butternut Squash Wellington to £20, vegan,
--     regular vegan gravy by default with free signature-gravy upgrade.
--   - Updates the kids meal to "Kids Roast" at £14 with choice of pork,
--     turkey or wellington.
--   - Adds 5 new mains: Roast Beef Topside (£22), Roast Pork Leg (£20),
--     Roast Turkey w/ Stuffing Ball (£19), Beef & Ale Pie (£21),
--     Chicken & Wild Mushroom Pie (£21).
--
-- All deactivations use is_active=false (soft delete) because
-- table_booking_items has FKs into this table — historical bookings
-- still need their menu_item rows to resolve.
--
-- All descriptions reference: triple-cooked herb-and-garlic crusted
-- potatoes (NOT beef dripping), seasonal veg, signature gravy
-- (secret recipe made from scratch). Pies do NOT come with a
-- Yorkshire pudding; the three sliced roasts and kids roast do.

BEGIN;

-- Deactivate items that are off the menu
UPDATE sunday_lunch_menu_items
SET is_active = false, updated_at = NOW()
WHERE id IN (
  '492a0f9b-0a25-4c7f-a4ab-365de41a8288', -- Roasted Chicken (adult)
  '0c8054cb-ad07-4bbe-a730-48279ab1b615', -- Slow-Cooked Lamb Shank
  '7991bf75-2a41-44b4-808b-2c4947b9e4a7', -- Crispy Pork Belly
  '15bc01a7-3649-4153-9b21-7d2f6838c7d6'  -- Cauliflower Cheese (side)
);

-- Update Wellington: £20, vegan, regular vegan gravy default, signature upgrade option
UPDATE sunday_lunch_menu_items
SET
  description = 'Golden puff pastry filled with roasted beetroot and butternut squash, served with triple-cooked, herb-and-garlic crusted roast potatoes, seasonal vegetables and our regular vegan gravy. Free upgrade to our signature gravy on request (note: the signature gravy contains meat stock, so it makes the dish non-vegan).',
  price = 20.00,
  display_order = 6,
  dietary_info = ARRAY['Vegan']::text[],
  allergens = ARRAY['Gluten']::text[],
  updated_at = NOW()
WHERE id = '7da6244a-1588-44fc-ae2c-94c077ae844f';

-- Update Kids: "Kids Roast" with choice of pork/turkey/wellington at £14
UPDATE sunday_lunch_menu_items
SET
  name = 'Kids Roast',
  description = 'A smaller plate of any of our roasts — your child''s choice of roast pork, roast turkey or beetroot & butternut squash wellington — served with triple-cooked, herb-and-garlic crusted roast potatoes, seasonal vegetables, a Yorkshire pudding (with the pork or turkey) and our signature gravy.',
  price = 14.00,
  display_order = 7,
  dietary_info = ARRAY[]::text[],
  allergens = ARRAY['Gluten']::text[],
  updated_at = NOW()
WHERE id = '22e48acc-800f-41df-8cb1-c95a82294310';

-- Insert new mains
INSERT INTO sunday_lunch_menu_items (
  name, description, price, category, is_active, display_order, allergens, dietary_info
) VALUES
(
  'Roast Beef Topside',
  'Slow-roasted topside of beef carved fresh on the day, served with triple-cooked, herb-and-garlic crusted roast potatoes, seasonal vegetables, a fluffy Yorkshire pudding and a generous pour of our signature gravy — a secret recipe we''ve refined ourselves over the years.',
  22.00,
  'main',
  true,
  1,
  ARRAY['Gluten']::text[],
  ARRAY[]::text[]
),
(
  'Roast Pork Leg',
  'Tender roasted pork leg sliced to order with Bramley apple sauce, triple-cooked, herb-and-garlic crusted roast potatoes, seasonal vegetables, a fluffy Yorkshire pudding and our signature gravy — a secret recipe we''ve refined ourselves over the years.',
  20.00,
  'main',
  true,
  2,
  ARRAY['Gluten']::text[],
  ARRAY[]::text[]
),
(
  'Roast Turkey with Stuffing Ball',
  'Roasted turkey carved fresh, served with a sage and onion stuffing ball, triple-cooked, herb-and-garlic crusted roast potatoes, seasonal vegetables, a fluffy Yorkshire pudding and our signature gravy — a secret recipe we''ve refined ourselves over the years.',
  19.00,
  'main',
  true,
  3,
  ARRAY['Gluten']::text[],
  ARRAY[]::text[]
),
(
  'Beef & Ale Pie',
  'Slow-cooked British beef in a rich ale gravy, topped with golden short-crust pastry. Served with triple-cooked, herb-and-garlic crusted roast potatoes, seasonal vegetables and our signature gravy — a secret recipe we''ve refined ourselves over the years. (No Yorkshire pudding with the pies.)',
  21.00,
  'main',
  true,
  4,
  ARRAY['Gluten']::text[],
  ARRAY[]::text[]
),
(
  'Chicken & Wild Mushroom Pie',
  'Tender chicken and wild mushrooms in a creamy sauce, topped with golden short-crust pastry. Served with triple-cooked, herb-and-garlic crusted roast potatoes, seasonal vegetables and our signature gravy — a secret recipe we''ve refined ourselves over the years. (No Yorkshire pudding with the pies.)',
  21.00,
  'main',
  true,
  5,
  ARRAY['Gluten']::text[],
  ARRAY[]::text[]
);

COMMIT;

-- Verify
SELECT name, price, category, is_active, display_order
FROM sunday_lunch_menu_items
ORDER BY is_active DESC, category, display_order, name;
