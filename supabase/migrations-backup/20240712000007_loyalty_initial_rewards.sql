-- Insert initial loyalty rewards

-- First, get the active program ID
DO $$
DECLARE
  program_id UUID;
BEGIN
  -- Get the active loyalty program
  SELECT id INTO program_id FROM loyalty_programs WHERE active = true LIMIT 1;
  
  -- Only proceed if we have an active program
  IF program_id IS NOT NULL THEN
    -- Insert initial rewards
    INSERT INTO loyalty_rewards (program_id, name, description, points_cost, category, icon, active, metadata)
    VALUES
      -- Drinks
      (program_id, 'Free Coffee', 'Enjoy a complimentary coffee on us', 100, 'drinks', '☕', true, '{}'),
      (program_id, 'Free Pint', 'A refreshing pint of your choice', 200, 'drinks', '🍺', true, '{}'),
      (program_id, 'Premium Cocktail', 'Choose from our signature cocktail menu', 400, 'drinks', '🍸', true, '{}'),
      (program_id, 'Bottle of House Wine', 'Red or white house wine', 800, 'drinks', '🍷', true, '{}'),
      
      -- Food
      (program_id, '10% Off Food', '10% discount on your food bill', 300, 'food', '🍽️', true, '{}'),
      (program_id, 'Free Starter', 'Any starter from our menu', 350, 'food', '🥗', true, '{}'),
      (program_id, 'Free Main Course', 'Choose any main course', 600, 'food', '🍖', true, '{}'),
      (program_id, '25% Off Food Bill', '25% off your entire food order', 700, 'food', '💰', true, '{}'),
      
      -- Special
      (program_id, 'Birthday Treat', 'Free dessert or shot on your birthday', 0, 'special', '🎂', true, '{"birthday_only": true}'),
      (program_id, 'Priority Booking', 'Jump the queue for event bookings', 500, 'special', '⚡', true, '{}'),
      (program_id, 'VIP Table Service', 'Dedicated table service for the evening', 1000, 'special', '👑', true, '{}'),
      (program_id, 'Private Event Discount', '20% off private venue hire', 1500, 'special', '🎉', true, '{}')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;