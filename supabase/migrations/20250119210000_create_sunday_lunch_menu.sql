-- Create sunday_lunch_menu_items table
CREATE TABLE IF NOT EXISTS sunday_lunch_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  category VARCHAR(50) NOT NULL CHECK (category IN ('main', 'side', 'dessert', 'extra')),
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  allergens TEXT[] DEFAULT '{}',
  dietary_info TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_category ON sunday_lunch_menu_items(category);
CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_display_order ON sunday_lunch_menu_items(display_order);
CREATE INDEX IF NOT EXISTS idx_sunday_lunch_menu_items_is_active ON sunday_lunch_menu_items(is_active);

-- Enable RLS
ALTER TABLE sunday_lunch_menu_items ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public can view active menu items" ON sunday_lunch_menu_items;
DROP POLICY IF EXISTS "Staff can view all menu items" ON sunday_lunch_menu_items;
DROP POLICY IF EXISTS "Managers can manage menu items" ON sunday_lunch_menu_items;

-- Create RLS policies
-- Public can view active menu items
CREATE POLICY "Public can view active menu items" ON sunday_lunch_menu_items
  FOR SELECT
  USING (is_active = true);

-- Staff can view all menu items
CREATE POLICY "Staff can view all menu items" ON sunday_lunch_menu_items
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

-- Managers can manage menu items
CREATE POLICY "Managers can manage menu items" ON sunday_lunch_menu_items
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('super_admin', 'manager')
    )
  );

-- Create updated_at trigger
DROP TRIGGER IF EXISTS update_sunday_lunch_menu_items_updated_at ON sunday_lunch_menu_items;
CREATE TRIGGER update_sunday_lunch_menu_items_updated_at
  BEFORE UPDATE ON sunday_lunch_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert default menu items
INSERT INTO sunday_lunch_menu_items (name, description, price, category, display_order, allergens, dietary_info) VALUES
  ('Roasted Chicken', 'Oven-roasted chicken breast with sage & onion stuffing balls, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 14.99, 'main', 1, ARRAY['Gluten'], ARRAY[]::text[]),
  ('Slow-Cooked Lamb Shank', 'Tender slow-braised lamb shank in rich red wine gravy, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and a Yorkshire pudding', 15.49, 'main', 2, ARRAY[]::text[], ARRAY[]::text[]),
  ('Crispy Pork Belly', 'Crispy crackling and tender slow-roasted pork belly with Bramley apple sauce, herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 15.99, 'main', 3, ARRAY[]::text[], ARRAY[]::text[]),
  ('Beetroot & Butternut Squash Wellington', 'Golden puff pastry filled with beetroot & butternut squash, served with herb and garlic-crusted roast potatoes, seasonal vegetables, and vegetarian gravy', 15.49, 'main', 4, ARRAY['Gluten'], ARRAY['Vegan']),
  ('Kids Roasted Chicken', 'A smaller portion of our roasted chicken with herb and garlic-crusted roast potatoes, seasonal vegetables, Yorkshire pudding, and red wine gravy', 9.99, 'main', 5, ARRAY['Gluten'], ARRAY[]::text[]),
  ('Herb & Garlic Roast Potatoes', 'Crispy roast potatoes with herbs and garlic', 0, 'side', 1, ARRAY[]::text[], ARRAY['Vegan', 'Gluten-free']),
  ('Yorkshire Pudding', 'Traditional Yorkshire pudding', 0, 'side', 2, ARRAY['Gluten', 'Eggs', 'Milk'], ARRAY['Vegetarian']),
  ('Seasonal Vegetables', 'Selection of fresh seasonal vegetables', 0, 'side', 3, ARRAY[]::text[], ARRAY['Vegan', 'Gluten-free']),
  ('Cauliflower Cheese', 'Creamy mature cheddar sauce, baked until golden and bubbling', 3.99, 'extra', 4, ARRAY['Milk'], ARRAY['Vegetarian', 'Gluten-free'])
ON CONFLICT DO NOTHING;