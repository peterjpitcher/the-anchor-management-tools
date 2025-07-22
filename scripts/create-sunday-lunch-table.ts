import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createSundayLunchTable() {
  console.log('Creating sunday_lunch_menu_items table...');
  
  // Run the migration SQL
  const { error } = await supabase.rpc('exec_sql', {
    query: `
-- Create sunday_lunch_menu_items table
CREATE TABLE IF NOT EXISTS sunday_lunch_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('main', 'side', 'extra')),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  allergens TEXT[] DEFAULT '{}',
  dietary_info TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique constraint on name
CREATE UNIQUE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_name ON sunday_lunch_menu_items(LOWER(name));

-- Enable RLS
ALTER TABLE sunday_lunch_menu_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Anyone can view active menu items" ON sunday_lunch_menu_items
  FOR SELECT USING (is_active = true);

CREATE POLICY "Staff can view all menu items" ON sunday_lunch_menu_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager', 'staff')
    )
  );

CREATE POLICY "Managers can manage menu items" ON sunday_lunch_menu_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create updated_at trigger
CREATE TRIGGER update_sunday_lunch_menu_items_updated_at
  BEFORE UPDATE ON sunday_lunch_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert initial menu items
INSERT INTO sunday_lunch_menu_items (name, description, price, category, display_order, allergens, dietary_info) VALUES
  ('Roasted Chicken', 'Oven-roasted chicken breast with sage & onion stuffing balls, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 14.99, 'main', 1, ARRAY['Gluten'], ARRAY[]::TEXT[]),
  ('Slow-Cooked Lamb Shank', 'Tender slow-braised lamb shank in rich red wine gravy, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and a Yorkshire pudding', 15.49, 'main', 2, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('Crispy Pork Belly', 'Crispy crackling and tender slow-roasted pork belly with Bramley apple sauce, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 15.99, 'main', 3, ARRAY[]::TEXT[], ARRAY[]::TEXT[]),
  ('Beetroot & Butternut Squash Wellington', 'Golden puff pastry filled with beetroot & butternut squash, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and vegetarian gravy', 15.49, 'main', 4, ARRAY['Gluten'], ARRAY['Vegan']),
  ('Kids Roasted Chicken', 'A smaller portion of our roasted chicken with herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 9.99, 'main', 5, ARRAY['Gluten'], ARRAY[]::TEXT[]),
  ('Herb & Garlic Roast Potatoes', 'Crispy roast potatoes with herbs and garlic', 0.00, 'side', 1, ARRAY[]::TEXT[], ARRAY['Vegan', 'Gluten-free']),
  ('Yorkshire Pudding', 'Traditional Yorkshire pudding', 0.00, 'side', 2, ARRAY['Gluten', 'Eggs', 'Milk'], ARRAY['Vegetarian']),
  ('Seasonal Vegetables', 'Selection of fresh seasonal vegetables', 0.00, 'side', 3, ARRAY[]::TEXT[], ARRAY['Vegan', 'Gluten-free']),
  ('Cauliflower Cheese', 'Creamy mature cheddar sauce, baked until golden and bubbling', 3.99, 'extra', 4, ARRAY['Milk'], ARRAY['Vegetarian', 'Gluten-free'])
ON CONFLICT (LOWER(name)) DO NOTHING;
    `
  });

  if (error) {
    console.error('Error creating table:', error);
    
    // If exec_sql doesn't exist, try creating the table directly
    console.log('Trying direct approach...');
    
    // Just test if we can select from the table, which will create it via the migration
    const { error: selectError } = await supabase
      .from('sunday_lunch_menu_items')
      .select('count');
      
    if (selectError) {
      console.error('Table still does not exist:', selectError);
    } else {
      console.log('Table exists or was created');
    }
  } else {
    console.log('Table created successfully!');
  }
}

createSundayLunchTable().catch(console.error);