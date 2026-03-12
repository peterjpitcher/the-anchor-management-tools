-- Migration: fill all catering package structured fields
-- Description:
--   - Fills in Fish & Chip Van description fields
--   - Removes Cocktail Pitchers
--   - Fills guest_description for all packages
--   - Cleans up stale minimum-guest references in good_to_know
--   - Fixes Pizza Buffet minimum guests (previously targeted wrong name)

BEGIN;

-- ============================================================
-- FIX: Pizza Buffet minimum guests (earlier migration used wrong name)
-- ============================================================
UPDATE catering_packages SET minimum_guests = 30 WHERE name = 'Pizza Buffet';

-- ============================================================
-- REMOVE: Cocktail Pitchers
-- ============================================================
DELETE FROM catering_packages WHERE name = 'Cocktail Pitchers';

-- ============================================================
-- FISH & CHIP VAN: fill all description fields
-- ============================================================
UPDATE catering_packages SET
  summary      = 'A fresh fish and chip experience served on-site from a van.',
  includes     = 'One portion per person chosen from a standard fish and chip menu, all cooked fresh to order.',
  served       = 'Served from a van on-site — guests go up, place their order and enjoy it straight away in takeaway containers.',
  good_to_know = 'The van will be set up on-site on the day. All food is cooked to order. Dietary requirements can be discussed in advance.'
WHERE name = 'Fish & Chip Van';

-- ============================================================
-- CLEAN UP: remove stale minimum-guest references from good_to_know
-- ============================================================
UPDATE catering_packages SET good_to_know = 'Great for daytime events and meetings.'
  WHERE name = 'Unlimited Tea & Coffee';

UPDATE catering_packages SET good_to_know = 'Non-alcoholic alternatives available on request.'
  WHERE name = 'Welcome Drinks';

UPDATE catering_packages SET good_to_know = 'Ideal for family parties and mixed-age groups.'
  WHERE name = 'Welcome Prosecco/Orange Juice';

UPDATE catering_packages SET good_to_know = 'Vegetarian options included. Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Sandwich Buffet';

UPDATE catering_packages SET good_to_know = 'Selection may vary. Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Finger Buffet';

UPDATE catering_packages SET good_to_know = 'Menu may vary. Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Premium Buffet';

UPDATE catering_packages SET good_to_know = 'Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Burger Buffet';

UPDATE catering_packages SET good_to_know = 'Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Festive Hot Finger';

UPDATE catering_packages SET good_to_know = 'Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Festive Premium Grazing';

UPDATE catering_packages SET good_to_know = 'Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Festive Sandwich & Salad';

UPDATE catering_packages SET good_to_know = 'Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Festive Menu';

UPDATE catering_packages SET good_to_know = 'Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Festive Menu (weekday)';

UPDATE catering_packages SET good_to_know = 'Vegetarian option available at the same price per head — beef burger replaced with a vegetarian burger and pork sausage replaced with a vegetarian sausage (chicken drumstick is not replaced). Dietary requirements can be catered for with advance notice.'
  WHERE name = 'Indoor BBQ';

-- ============================================================
-- GUEST DESCRIPTIONS: all packages
-- ============================================================

-- Food
UPDATE catering_packages SET guest_description =
  'A classic sandwich buffet with something for everyone — a generous selection of sandwiches, crisps and crudités. Vegetarian options are included as standard.'
  WHERE name = 'Sandwich Buffet';

UPDATE catering_packages SET guest_description =
  'A crowd-pleasing hot finger buffet featuring party classics like chicken goujons, sausage rolls, cocktail sausages and mini pizzas — perfect for keeping guests fuelled throughout your event.'
  WHERE name = 'Finger Buffet';

UPDATE catering_packages SET guest_description =
  'Elevate your event with our premium spread — beautiful charcuterie and cheese boards alongside hot finger food favourites, all laid out for guests to graze and enjoy.'
  WHERE name = 'Premium Buffet';

UPDATE catering_packages SET guest_description =
  'Build your perfect burger from our laid-out spread — beef, chicken and vegetarian burgers with all the toppings and fries. Relaxed, sociable and always a hit.'
  WHERE name = 'Burger Buffet';

UPDATE catering_packages SET guest_description =
  'A generous warm sharing tray of crispy chicken goujons served with dips — ideal as a centrepiece snack or alongside other food. Each tray serves approximately 10 people.'
  WHERE name = 'Chicken Goujon Sharing Tray';

UPDATE catering_packages SET guest_description =
  'Choose your favourite pizzas from our menu, cooked fresh for your event. Just let us know your selection in advance and we''ll take care of the rest.'
  WHERE name = 'Pizza Buffet';

UPDATE catering_packages SET guest_description =
  'Celebrate in style with our festive sit-down set menu — a seasonal spread designed for Christmas parties. Please let us know about any dietary requirements when you book.'
  WHERE name = 'Festive Menu';

UPDATE catering_packages SET guest_description =
  'All the magic of a festive celebration at a special weekday price — our sit-down set menu is perfect for office parties and daytime Christmas events.'
  WHERE name = 'Festive Menu (weekday)';

UPDATE catering_packages SET guest_description =
  'A lighter festive buffet option for larger groups — seasonal sandwiches and fresh salads served cold, perfect for daytime celebrations.'
  WHERE name = 'Festive Sandwich & Salad';

UPDATE catering_packages SET guest_description =
  'Get into the Christmas spirit with a warm selection of festive finger food — a hot buffet full of seasonal favourites, great for winter parties.'
  WHERE name = 'Festive Hot Finger';

UPDATE catering_packages SET guest_description =
  'Our premium festive grazing spread is perfect for larger celebrations — an impressive seasonal selection that guests can enjoy throughout your event.'
  WHERE name = 'Festive Premium Grazing';

UPDATE catering_packages SET guest_description =
  'Enjoy a delicious spread of BBQ classics including beef burgers, chicken drumsticks, pork sausages and fresh salads — all laid out for guests to help themselves. Vegetarian options are available at no extra charge.'
  WHERE name = 'Indoor BBQ';

UPDATE catering_packages SET guest_description =
  'Treat your guests to freshly cooked fish and chips served straight from our on-site van. Each person orders their meal at the van and receives it piping hot in takeaway packaging — a fun and memorable addition to any event.'
  WHERE name = 'Fish & Chip Van';

-- Drinks
UPDATE catering_packages SET guest_description =
  'Welcome your guests with a drink on arrival — choose from prosecco, house wine or bottled beer. Non-alcoholic alternatives are available on request.'
  WHERE name = 'Welcome Drinks';

UPDATE catering_packages SET guest_description =
  'A thoughtful welcome for mixed groups — prosecco for the adults and fresh orange juice for children or non-drinkers. Perfect for family parties.'
  WHERE name = 'Welcome Prosecco/Orange Juice';

UPDATE catering_packages SET guest_description =
  'Keep your guests refreshed throughout the day with unlimited tea and coffee — ideal for daytime events, meetings and celebrations.'
  WHERE name = 'Unlimited Tea & Coffee';

UPDATE catering_packages SET guest_description =
  'Keep the little ones happy with unlimited squash throughout your event — great alongside any of our kids'' meal options.'
  WHERE name = 'Kids Unlimited Squash';

UPDATE catering_packages SET guest_description =
  'A refreshing Pimm''s jar, perfect for summer events — ready to share and always a crowd favourite. Priced per jar.'
  WHERE name = 'Pimm''s Jar';

UPDATE catering_packages SET guest_description =
  'Set up a bar tab for your guests and let them enjoy drinks at the bar up to a pre-agreed limit. We''ll work with you on the details to suit your budget and group.'
  WHERE name = 'Bar Tab';

-- Add-ons
UPDATE catering_packages SET guest_description =
  'A classic kids'' favourite — crispy chicken nuggets served with chips, plated individually for each child.'
  WHERE name = 'Kids Chicken Nuggets & Chips';

UPDATE catering_packages SET guest_description =
  'A perfectly portioned kids'' burger with chips — a firm favourite with younger guests, plated individually.'
  WHERE name = 'Kids Burger & Chips';

UPDATE catering_packages SET guest_description =
  'A fun mini pizza with chips for the younger guests — always a hit at parties and family events, plated individually.'
  WHERE name = 'Kids Mini Pizza & Chips';

UPDATE catering_packages SET guest_description =
  'Prefer to organise your own catering? That''s absolutely fine — a waiver will be required before the event.'
  WHERE name = 'Bring Your Own Food';

COMMIT;
