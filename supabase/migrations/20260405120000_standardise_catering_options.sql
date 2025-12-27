-- Migration: Standardise catering options and descriptions
-- Description: Standardises package names and descriptions, adds variable pricing options, and fixes pricing models according to new spec.

BEGIN;

-- 0. Update Constraint to allow new pricing models (Fix for when previous migration was already applied without these)
ALTER TABLE catering_packages DROP CONSTRAINT IF EXISTS catering_packages_pricing_model_check;
ALTER TABLE catering_packages 
  ADD CONSTRAINT catering_packages_pricing_model_check 
  CHECK (pricing_model IN ('per_head', 'total_value', 'variable', 'per_jar', 'per_tray', 'menu_priced', 'free'));

-- 1. Standardise Descriptions, Pricing Models, and Categories based on user spec

-- Welcome Drinks (058c7b0b-f3cb-4f06-9c56-6e3060a28f35 or closest match if relying on name, but we will use name matching for safety or exact IDs if known. 
-- Since I don't have the UUIDs guaranteed in dev env to match prod exactly without lookup, I will use Name matching where possible or insert if new, but the user provided IDs.)
-- Ideally I would use the IDs provided by the user if I am sure they match the production DB.
-- The user provided "Full updated dataset output (same IDs)". 
-- I will assume the IDs in the user prompt match the DB.

-- Update using a temporary table or VALUES list for clean bulk update if supported, or individual updates.
-- Individual updates are safer for migration scripts if IDs might not exist in all envs (e.g. local vs prod).
-- However, strict ID matching is requested. I'll use IDs but fallback to Name matching if ID fails? No, migration scripts should be determinstic.
-- I will use the IDs provided.

-- 058c7b0b... Welcome Drinks
UPDATE catering_packages SET
  name = 'Welcome Drinks',
  description = E'Summary: A simple welcome drink served on arrival.\nIncludes: Prosecco, house wine or bottled beer.\nServed: On arrival.\nGood to know: Non-alcoholic alternatives available on request (minimum 10 guests).',
  serving_style = 'drinks',
  cost_per_head = 6.99,
  minimum_guests = 10,
  pricing_model = 'per_head',
  category = 'drink'
WHERE id = '058c7b0b-f3cb-4f06-9c56-6e3060a28f35';

-- 5f10ea45... Welcome Prosecco/Orange Juice
UPDATE catering_packages SET
  name = 'Welcome Prosecco/Orange Juice',
  description = E'Summary: A classic mixed-group welcome drink option.\nIncludes: Prosecco for adults or orange juice for children/non-drinkers.\nServed: On arrival.\nGood to know: Ideal for family parties (minimum 10 guests).',
  serving_style = 'drinks',
  cost_per_head = 6.99,
  minimum_guests = 10,
  pricing_model = 'per_head',
  category = 'drink'
WHERE id = '5f10ea45-14b2-47d4-9d3a-605375bfab77';

-- 2cb8ce9a... Unlimited Tea & Coffee
UPDATE catering_packages SET
  name = 'Unlimited Tea & Coffee',
  description = E'Summary: Unlimited hot drinks throughout your event.\nIncludes: Unlimited tea and coffee.\nServed: Available throughout your booking.\nGood to know: Great for daytime events and meetings (minimum 10 guests).',
  serving_style = 'drinks',
  cost_per_head = 4.49,
  minimum_guests = 10,
  pricing_model = 'per_head',
  category = 'drink'
WHERE id = '2cb8ce9a-c181-4c8f-bf6f-5b0a4de849c9';

-- 64f05d5c... Unlimited Kids Squash
UPDATE catering_packages SET
  name = 'Unlimited Kids Squash',
  description = E'Summary: Unlimited squash for children during the event.\nIncludes: Unlimited squash.\nServed: Available throughout your booking.\nGood to know: Perfect alongside kids’ meals.',
  serving_style = 'drinks',
  cost_per_head = 3.50,
  minimum_guests = 1,
  pricing_model = 'per_head',
  category = 'drink'
WHERE id = '64f05d5c-f68a-4261-8705-3a8ce09416a5';

-- 7423d70e... Pimms Jar
UPDATE catering_packages SET
  name = 'Pimms Jar',
  description = E'Summary: A refreshing Pimm’s jar, ideal for sunny days.\nIncludes: 1 jar of Pimm’s.\nServed: Ready to share.\nGood to know: Priced per jar.',
  serving_style = 'drinks',
  cost_per_head = 4.99,
  minimum_guests = 1,
  pricing_model = 'per_jar',
  category = 'drink'
WHERE id = '7423d70e-2627-4e8e-b8e1-a7b5fa91600c';

-- 10b9ef30... Sandwich Buffet
UPDATE catering_packages SET
  name = 'Sandwich Buffet',
  description = E'Summary: A simple, satisfying buffet with classic sandwiches.\nIncludes: A selection of sandwiches, crisps and crudités.\nServed: Buffet-style.\nGood to know: Vegetarian options included; dietary requirements can be catered for with advance notice (minimum 10 guests).',
  serving_style = 'buffet',
  cost_per_head = 8.50,
  minimum_guests = 10,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = '10b9ef30-b53e-4d57-a3d8-14644676336e';

-- 10e7153e... Finger Buffet
UPDATE catering_packages SET
  name = 'Finger Buffet',
  description = E'Summary: A hot finger buffet packed with party favourites.\nIncludes: A selection such as sandwiches, chicken goujons, cocktail sausages, sausage rolls, mini pizzas and spring rolls.\nServed: Buffet-style (served warm).\nGood to know: Selection may vary; dietary requirements can be catered for with advance notice (minimum 10 guests).',
  serving_style = 'buffet',
  cost_per_head = 9.50,
  minimum_guests = 10,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = '10e7153e-3bfc-4791-8f2a-02981d72fed0';

-- 5e8dba3d... Premium Buffet
UPDATE catering_packages SET
  name = 'Premium Buffet',
  description = E'Summary: A fuller buffet spread with grazing boards and hot favourites.\nIncludes: Charcuterie/cheese boards, ham, beef, rolls, salads and hot finger foods.\nServed: Buffet-style.\nGood to know: Menu may vary; dietary requirements can be catered for with advance notice (minimum 10 guests).',
  serving_style = 'buffet',
  cost_per_head = 11.99,
  minimum_guests = 10,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = '5e8dba3d-8c50-473f-9a4f-c09299dd23c2';

-- 7fddf321... Burger Buffet
UPDATE catering_packages SET
  name = 'Burger Buffet',
  description = E'Summary: A build-your-own burger buffet that works for everyone.\nIncludes: Beef, chicken and vegetarian burgers, toppings and fries.\nServed: Buffet-style.\nGood to know: Dietary requirements can be catered for with advance notice (minimum 10 guests).',
  serving_style = 'buffet',
  cost_per_head = 8.99,
  minimum_guests = 10,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = '7fddf321-91f6-48a2-9758-64c02f4bab7a';

-- 4596dd6f... Chicken Goujon Sharing Tray
UPDATE catering_packages SET
  name = 'Chicken Goujon Sharing Tray',
  description = E'Summary: A warm sharing tray that’s always a crowd-pleaser.\nIncludes: Chicken goujons with dips/condiments.\nServed: As a sharing tray.\nGood to know: Serves approx. 10 people (priced per tray).',
  serving_style = 'buffet',
  cost_per_head = 25.00,
  minimum_guests = 1,
  pricing_model = 'per_tray',
  category = 'food'
WHERE id = '4596dd6f-df49-4090-9ccc-bf60f734c3fe';

-- 8bb92d1f... Pizza
UPDATE catering_packages SET
  name = 'Pizza (Ordered from our Menu)',
  description = E'Summary: Choose pizzas from our menu for your event.\nIncludes: Pizzas selected from our pizza menu.\nServed: Prepared fresh for your booking.\nGood to know: Pricing is based on what you order from our menu (no fixed per-head price).',
  serving_style = 'pizza',
  cost_per_head = 0.00, -- Set to 0.00 as column is NOT NULL. Managed by pricing_model.
  minimum_guests = 1,
  pricing_model = 'menu_priced',
  category = 'food'
WHERE id = '8bb92d1f-3150-473f-b558-153a5bf58aae';

-- 0b31b557... Kids Chicken Nuggets
UPDATE catering_packages SET
  name = 'Kids Chicken Nuggets & Chips',
  description = E'Summary: A simple kids’ party classic.\nIncludes: Chicken nuggets and chips.\nServed: Plated per child.\nGood to know: Great for children’s parties and family events.',
  serving_style = 'other',
  cost_per_head = 7.00,
  minimum_guests = 1,
  pricing_model = 'per_head',
  category = 'addon'
WHERE id = '0b31b557-f70c-44af-8a83-fbcae0b0157f';

-- 5dbf956f... Kids Burger
UPDATE catering_packages SET
  name = 'Kids Burger & Chips',
  description = E'Summary: A kids’ favourite, perfectly portioned for parties.\nIncludes: Beef burger and chips.\nServed: Plated per child.\nGood to know: Great for children’s parties and family events.',
  serving_style = 'other',
  cost_per_head = 7.00,
  minimum_guests = 1,
  pricing_model = 'per_head',
  category = 'addon'
WHERE id = '5dbf956f-8859-4072-bb6b-e715c736c1d1';

-- c0f62610... Kids Mini Pizza
UPDATE catering_packages SET
  name = 'Kids Mini Pizza & Chips',
  description = E'Summary: A fun, kid-sized pizza meal that always goes down well.\nIncludes: Mini pizza and chips.\nServed: Plated per child.\nGood to know: Great for parties and family events.',
  serving_style = 'other',
  cost_per_head = 7.00,
  minimum_guests = 1,
  pricing_model = 'per_head',
  category = 'addon'
WHERE id = 'c0f62610-9cab-4ba4-bc83-785ef436a608';

-- 9fdbf82b... BYOF
UPDATE catering_packages SET
  name = 'Bring Your Own Food',
  description = E'Summary: Prefer to bring your own food? That’s absolutely fine.\nIncludes: Bringing your own food for your booking.\nServed: You provide and manage your own catering.\nGood to know: A waiver is required before the event.',
  serving_style = 'other',
  cost_per_head = 0.00,
  minimum_guests = 1,
  pricing_model = 'free',
  category = 'addon'
WHERE id = '9fdbf82b-6717-4bff-8af6-8865cb5bfe21';

-- 629353c6... Festive Menu
UPDATE catering_packages SET
  name = 'Festive Menu',
  description = E'Summary: A festive sit-down set menu for Christmas parties.\nIncludes: Seasonal set menu (menu varies).\nServed: Sit-down meal.\nGood to know: Dietary requirements can be catered for with advance notice (minimum 6 guests).',
  serving_style = 'sit-down',
  cost_per_head = 39.95,
  minimum_guests = 6,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = '629353c6-472b-4bfc-85b8-23643d74d9d8';

-- dc29c1f5... Festive Menu (weekday)
UPDATE catering_packages SET
  name = 'Festive Menu (weekday)',
  description = E'Summary: A festive sit-down set menu for weekday Christmas parties.\nIncludes: Seasonal set menu (menu varies).\nServed: Sit-down meal.\nGood to know: Dietary requirements can be catered for with advance notice (minimum 6 guests).',
  serving_style = 'sit-down',
  cost_per_head = 36.95,
  minimum_guests = 6,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = 'dc29c1f5-9417-4d2b-ae9d-87b35183c5af';

-- cdc720e2... Festive Sandwich
UPDATE catering_packages SET
  name = 'Festive Sandwich & Salad',
  description = E'Summary: A festive cold buffet option for larger groups.\nIncludes: Festive sandwich selection and seasonal salads (menu varies).\nServed: Buffet-style.\nGood to know: Minimum 25 guests; dietary requirements can be catered for with advance notice.',
  serving_style = 'buffet',
  cost_per_head = 10.95,
  minimum_guests = 25,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = 'cdc720e2-56da-47b1-a691-543490ec2fc7';

-- 8d7ae1fa... Festive Hot Finger
UPDATE catering_packages SET
  name = 'Festive Hot Finger',
  description = E'Summary: A festive hot finger buffet for Christmas parties.\nIncludes: Warm festive finger food selection (menu varies).\nServed: Buffet-style (served warm).\nGood to know: Minimum 25 guests; dietary requirements can be catered for with advance notice.',
  serving_style = 'buffet',
  cost_per_head = 13.95,
  minimum_guests = 25,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = '8d7ae1fa-aceb-46e4-8183-99002b095314';

-- f680eadd... Festive Premium
UPDATE catering_packages SET
  name = 'Festive Premium Grazing',
  description = E'Summary: A premium festive grazing spread for larger celebrations.\nIncludes: Premium festive grazing selection (menu varies).\nServed: Buffet-style.\nGood to know: Minimum 25 guests; dietary requirements can be catered for with advance notice.',
  serving_style = 'buffet',
  cost_per_head = 16.95,
  minimum_guests = 25,
  pricing_model = 'per_head',
  category = 'food'
WHERE id = 'f680eadd-f877-453a-8c31-f094016b454b';


-- 2. Add 'Bar Tab' if it doesn't exist (Requested in previous turn, not in JSON but implied as needed "Standardise to the below" might just be the ones that exist. 
-- However, "I want you to add a bar tab" was in the user prompt. I will add it using the 'variable' or new model.
-- The user didn't specify 'Bar Tab' in the JSON list of updates. 
-- But in the text: "I want you to add a bar tab... I also want a welcome drink package".
-- "Welcome Drinks" is in the JSON. "Bar Tab" is NOT.
-- I will add "Bar Tab" as a new item.
INSERT INTO catering_packages (
  name, 
  description, 
  serving_style, 
  category, 
  pricing_model, 
  cost_per_head, 
  active, 
  display_order
) 
SELECT 
  'Bar Tab',
  E'Summary: A flexible tab for your guests to enjoy drinks at the bar.\nIncludes: Beverages up to a pre-paid limit.\nServed: At the bar.\nGood to know: Limit and restrictions can be customised.',
  'drinks',
  'drink',
  'variable', -- Using variable for Bar Tab as it fits "variable cost"
  0,
  true,
  90
WHERE NOT EXISTS (SELECT 1 FROM catering_packages WHERE name = 'Bar Tab');


COMMIT;
