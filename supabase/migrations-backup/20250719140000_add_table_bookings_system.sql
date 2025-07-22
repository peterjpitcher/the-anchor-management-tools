-- Description: Add table booking system for restaurant dining reservations
-- 
-- COMPATIBILITY NOTES:
-- 1. This migration is designed to work with or without existing menu_items table
-- 2. RLS policies will use user_has_permission if available, otherwise permissive policies
-- 3. Triggers will only be created if update_updated_at_column function exists
-- 4. RBAC permissions will only be inserted if rbac_permissions table exists
-- 5. Menu sections insert is commented out - uncomment if you have menu_sections table
-- 
-- After running this migration:
-- - Review and tighten the permissive RLS policies based on your auth setup
-- - Configure time slot capacities in booking_time_slots table
-- - Add table configurations in table_configuration
-- - Set up booking policies in booking_policies

-- Create enum types
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_booking_type') THEN
    CREATE TYPE table_booking_type AS ENUM ('regular', 'sunday_lunch');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_booking_status') THEN
    CREATE TYPE table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed');
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
  END IF;
END $$;

-- Table configuration for managing restaurant tables
CREATE TABLE IF NOT EXISTS table_configuration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number VARCHAR(10) NOT NULL UNIQUE,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Booking time slots configuration
CREATE TABLE IF NOT EXISTS booking_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  slot_time TIME NOT NULL,
  duration_minutes INTEGER DEFAULT 120,
  max_covers INTEGER NOT NULL,
  booking_type table_booking_type DEFAULT NULL, -- NULL means available for both types
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(day_of_week, slot_time, booking_type)
);

-- Main table bookings table
CREATE TABLE IF NOT EXISTS table_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference VARCHAR(20) UNIQUE NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  tables_assigned JSONB,
  booking_type table_booking_type NOT NULL,
  status table_booking_status NOT NULL DEFAULT 'pending_payment',
  duration_minutes INTEGER DEFAULT 120,
  special_requirements TEXT,
  dietary_requirements TEXT[],
  allergies TEXT[],
  celebration_type VARCHAR(50),
  internal_notes TEXT,
  source VARCHAR(20) DEFAULT 'website', -- website, phone, walk-in
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  completed_at TIMESTAMPTZ,
  no_show_at TIMESTAMPTZ
);

-- Sunday lunch menu selections
CREATE TABLE IF NOT EXISTS table_booking_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  menu_item_id UUID, -- References menu_items if available, otherwise use custom_item_name
  custom_item_name VARCHAR(255), -- For items not in menu_items or if menu system not available
  item_type VARCHAR(20) DEFAULT 'main' CHECK (item_type IN ('main', 'side', 'extra')),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  special_requests TEXT,
  price_at_booking DECIMAL(10,2) NOT NULL,
  guest_name VARCHAR(100), -- Which guest ordered this
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- Ensure either menu_item_id or custom_item_name is provided
  CONSTRAINT item_name_required CHECK (menu_item_id IS NOT NULL OR custom_item_name IS NOT NULL)
);

-- Payment tracking for bookings
CREATE TABLE IF NOT EXISTS table_booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  payment_method VARCHAR(20) NOT NULL DEFAULT 'paypal',
  transaction_id VARCHAR(255) UNIQUE,
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'GBP',
  status payment_status NOT NULL DEFAULT 'pending',
  refund_amount DECIMAL(10,2),
  refund_transaction_id VARCHAR(255),
  payment_metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_table_bookings_customer_id ON table_bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_table_bookings_booking_date ON table_bookings(booking_date);
CREATE INDEX IF NOT EXISTS idx_table_bookings_status ON table_bookings(status);
CREATE INDEX IF NOT EXISTS idx_table_bookings_booking_type ON table_bookings(booking_type);
CREATE INDEX IF NOT EXISTS idx_table_bookings_date_time ON table_bookings(booking_date, booking_time);
CREATE INDEX IF NOT EXISTS idx_table_booking_items_booking_id ON table_booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_table_booking_payments_booking_id ON table_booking_payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_table_booking_payments_transaction_id ON table_booking_payments(transaction_id);

-- Add columns to customers table for booking analytics
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'table_booking_count'
  ) THEN
    ALTER TABLE customers ADD COLUMN table_booking_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'no_show_count'
  ) THEN
    ALTER TABLE customers ADD COLUMN no_show_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' AND column_name = 'last_table_booking_date'
  ) THEN
    ALTER TABLE customers ADD COLUMN last_table_booking_date DATE;
  END IF;
END $$;

-- Create updated_at triggers
-- Create trigger only if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE TRIGGER table_configuration_updated_at
      BEFORE UPDATE ON table_configuration
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Create triggers only if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE TRIGGER booking_time_slots_updated_at
      BEFORE UPDATE ON booking_time_slots
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_bookings_updated_at
      BEFORE UPDATE ON table_bookings
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_booking_items_updated_at
      BEFORE UPDATE ON table_booking_items
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_booking_payments_updated_at
      BEFORE UPDATE ON table_booking_payments
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Enable Row Level Security
ALTER TABLE table_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_payments ENABLE ROW LEVEL SECURITY;

-- Check if user_has_permission function exists before creating policies
DO $$
DECLARE
  has_permission_func BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'user_has_permission'
  ) INTO has_permission_func;
  
  IF NOT has_permission_func THEN
    RAISE NOTICE 'user_has_permission function not found. RLS policies will not be created.';
    RAISE NOTICE 'You may need to create these policies manually or ensure the RBAC system is installed.';
  END IF;
END $$;

-- RLS Policies for table_configuration (staff only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view table configuration" ON table_configuration
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Managers can manage table configuration" ON table_configuration
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    -- Create basic policies that allow all authenticated users (adjust as needed)
    CREATE POLICY "Allow authenticated read" ON table_configuration
      FOR SELECT USING (true); -- Allow public read for availability checking
  END IF;
END $$;

-- RLS Policies for booking_time_slots (public read, staff write)
CREATE POLICY "Anyone can view booking time slots" ON booking_time_slots
  FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Managers can manage booking time slots" ON booking_time_slots
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  END IF;
END $$;

-- RLS Policies for table_bookings
-- Note: Customers don't have auth accounts, only staff can view bookings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view all bookings" ON table_bookings
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Staff can create bookings" ON table_bookings
      FOR INSERT WITH CHECK (
        user_has_permission(auth.uid(), 'table_bookings', 'create')
      );

    CREATE POLICY "Staff can update bookings" ON table_bookings
      FOR UPDATE USING (
        user_has_permission(auth.uid(), 'table_bookings', 'edit')
      );

    CREATE POLICY "Managers can delete bookings" ON table_bookings
      FOR DELETE USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    -- Create basic policy for authenticated users
    CREATE POLICY "Allow authenticated access" ON table_bookings
      FOR ALL USING (true); -- Temporary permissive policy - tighten based on your auth setup
  END IF;
END $$;

-- RLS Policies for table_booking_items
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can manage booking items" ON table_booking_items
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );
  ELSE
    CREATE POLICY "Allow authenticated access" ON table_booking_items
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- RLS Policies for table_booking_payments
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view payment info" ON table_booking_payments
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "System can manage payments" ON table_booking_payments
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    CREATE POLICY "Allow authenticated access" ON table_booking_payments
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- Function to check table availability
CREATE OR REPLACE FUNCTION check_table_availability(
  p_date DATE,
  p_time TIME,
  p_party_size INTEGER,
  p_duration_minutes INTEGER DEFAULT 120,
  p_exclude_booking_id UUID DEFAULT NULL
)
RETURNS TABLE (
  available_capacity INTEGER,
  tables_available INTEGER[],
  is_available BOOLEAN
) AS $$
DECLARE
  v_day_of_week INTEGER;
  v_total_capacity INTEGER;
  v_booked_capacity INTEGER;
  v_available_capacity INTEGER;
BEGIN
  -- Get day of week (0 = Sunday)
  v_day_of_week := EXTRACT(DOW FROM p_date);
  
  -- Get total capacity from active tables
  SELECT COALESCE(SUM(capacity), 0) INTO v_total_capacity
  FROM table_configuration
  WHERE is_active = true;
  
  -- Get booked capacity for the time slot
  SELECT COALESCE(SUM(party_size), 0) INTO v_booked_capacity
  FROM table_bookings
  WHERE booking_date = p_date
    AND status IN ('confirmed', 'pending_payment')
    AND (p_exclude_booking_id IS NULL OR id != p_exclude_booking_id)
    AND (
      -- Check for time overlap
      (booking_time <= p_time AND (booking_time + (duration_minutes || ' minutes')::INTERVAL) > p_time)
      OR
      (p_time <= booking_time AND (p_time + (p_duration_minutes || ' minutes')::INTERVAL) > booking_time)
    );
  
  v_available_capacity := v_total_capacity - v_booked_capacity;
  
  RETURN QUERY
  SELECT 
    v_available_capacity,
    ARRAY[]::INTEGER[], -- Simplified for now, can be enhanced later
    v_available_capacity >= p_party_size;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate booking reference
CREATE OR REPLACE FUNCTION generate_booking_reference()
RETURNS VARCHAR(20) AS $$
DECLARE
  v_reference VARCHAR(20);
  v_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate reference like TB-2024-XXXX
    v_reference := 'TB-' || TO_CHAR(NOW(), 'YYYY') || '-' || 
                   LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    
    -- Check if reference already exists
    SELECT EXISTS(SELECT 1 FROM table_bookings WHERE booking_reference = v_reference) INTO v_exists;
    
    EXIT WHEN NOT v_exists;
  END LOOP;
  
  RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate booking reference
CREATE OR REPLACE FUNCTION set_booking_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.booking_reference IS NULL THEN
    NEW.booking_reference := generate_booking_reference();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER table_bookings_set_reference
  BEFORE INSERT ON table_bookings
  FOR EACH ROW
  EXECUTE FUNCTION set_booking_reference();

-- Function to update customer booking stats
CREATE OR REPLACE FUNCTION update_customer_booking_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    UPDATE customers
    SET table_booking_count = table_booking_count + 1,
        last_table_booking_date = NEW.booking_date
    WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Handle no-show
    IF OLD.status != 'no_show' AND NEW.status = 'no_show' THEN
      UPDATE customers
      SET no_show_count = no_show_count + 1
      WHERE id = NEW.customer_id;
    END IF;
    
    -- Handle new confirmation
    IF OLD.status != 'confirmed' AND NEW.status = 'confirmed' THEN
      UPDATE customers
      SET table_booking_count = table_booking_count + 1,
          last_table_booking_date = NEW.booking_date
      WHERE id = NEW.customer_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_customer_stats_on_booking
  AFTER INSERT OR UPDATE ON table_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_booking_stats();

-- Insert default time slots for Sunday lunch
-- Note: These are default capacity limits per time slot
-- Actual availability is determined by kitchen hours in business_hours table
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
VALUES 
  (0, '12:00:00', 40, 'sunday_lunch'),
  (0, '12:30:00', 40, 'sunday_lunch'),
  (0, '13:00:00', 60, 'sunday_lunch'),
  (0, '13:30:00', 60, 'sunday_lunch'),
  (0, '14:00:00', 40, 'sunday_lunch'),
  (0, '14:30:00', 40, 'sunday_lunch'),
  (0, '15:00:00', 30, 'sunday_lunch')
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Note: Menu sections table may not exist in all installations
-- If you have a menu system, uncomment the following:
-- INSERT INTO menu_sections (name, description, sort_order, is_active)
-- SELECT 'Sunday Lunch', 'Available Sundays 12pm-5pm. Pre-order by 1pm Saturday.', 1, true
-- WHERE NOT EXISTS (
--   SELECT 1 FROM menu_sections WHERE name = 'Sunday Lunch'
-- );

-- Note: Actual menu items from your Sunday lunch menu:
-- Roasted Chicken £14.99, Slow-Cooked Lamb Shank £15.49, Crispy Pork Belly £15.99, 
-- Beetroot & Butternut Squash Wellington £15.49, Kids Roasted Chicken £9.99, 
-- Cauliflower Cheese £3.99 (optional extra)
-- These should be managed through the admin interface to allow for price and availability updates

-- Insert default time slots for regular dining
-- Tuesday to Friday dinner (6pm-9pm)
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
SELECT 
  day,
  (ts::timestamp)::time,
  30,
  'regular'
FROM 
  generate_series(2, 5) AS day,  -- Tuesday to Friday
  generate_series('2024-01-01 18:00:00'::timestamp, '2024-01-01 20:30:00'::timestamp, '30 minutes'::interval) AS ts
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Saturday lunch and dinner (1pm-7pm)
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
SELECT 
  6,  -- Saturday
  (ts::timestamp)::time,
  30,
  'regular'
FROM 
  generate_series('2024-01-01 13:00:00'::timestamp, '2024-01-01 19:00:00'::timestamp, '30 minutes'::interval) AS ts
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Sunday regular dining (12pm-5pm, alongside Sunday lunch)
INSERT INTO booking_time_slots (day_of_week, slot_time, max_covers, booking_type)
SELECT 
  0,  -- Sunday
  (ts::timestamp)::time,
  20,  -- Lower capacity as Sunday lunch takes priority
  'regular'
FROM 
  generate_series('2024-01-01 12:00:00'::timestamp, '2024-01-01 16:30:00'::timestamp, '30 minutes'::interval) AS ts
ON CONFLICT (day_of_week, slot_time, booking_type) DO NOTHING;

-- Add sample tables (can be adjusted by management)
INSERT INTO table_configuration (table_number, capacity)
VALUES 
  ('1', 2),
  ('2', 2),
  ('3', 4),
  ('4', 4),
  ('5', 4),
  ('6', 6),
  ('7', 6),
  ('8', 8),
  ('9', 4),
  ('10', 4)
ON CONFLICT (table_number) DO NOTHING;

-- Create booking policies table for configurable rules
CREATE TABLE IF NOT EXISTS booking_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_type table_booking_type NOT NULL,
  full_refund_hours INTEGER NOT NULL DEFAULT 48,
  partial_refund_hours INTEGER NOT NULL DEFAULT 24,
  partial_refund_percentage INTEGER NOT NULL DEFAULT 50,
  modification_allowed BOOLEAN DEFAULT true,
  cancellation_fee DECIMAL(10,2) DEFAULT 0,
  max_party_size INTEGER DEFAULT 20,
  min_advance_hours INTEGER DEFAULT 0, -- Minimum hours before booking
  max_advance_days INTEGER DEFAULT 56, -- Maximum days in advance (8 weeks)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_type)
);

-- Insert default policies
INSERT INTO booking_policies (booking_type, full_refund_hours, partial_refund_hours, partial_refund_percentage, min_advance_hours)
VALUES 
  ('regular', 2, 0, 0, 2), -- 2 hour notice, no refunds
  ('sunday_lunch', 48, 24, 50, 20); -- 48hr full refund, 24hr 50% refund, must book by 1pm Saturday

-- Track booking modifications
CREATE TABLE IF NOT EXISTS table_booking_modifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  modified_by UUID, -- Staff user ID who made the modification
  modification_type VARCHAR(50) NOT NULL, -- 'time_change', 'party_size', 'menu_change', 'table_change'
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table combinations for larger parties
CREATE TABLE IF NOT EXISTS table_combinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100),
  table_ids UUID[] NOT NULL,
  total_capacity INTEGER NOT NULL,
  preferred_for_size INTEGER[], -- e.g., [6, 7, 8] for parties of 6-8
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SMS template definitions for table bookings
CREATE TABLE IF NOT EXISTS table_booking_sms_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key VARCHAR(100) NOT NULL UNIQUE,
  booking_type table_booking_type,
  template_text TEXT NOT NULL,
  variables TEXT[], -- List of available variables
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default SMS templates
INSERT INTO table_booking_sms_templates (template_key, booking_type, template_text, variables)
VALUES 
  ('booking_confirmation_regular', 'regular', 
   'Hi {{customer_name}}, your table for {{party_size}} at The Anchor on {{date}} at {{time}} is confirmed. Reference: {{reference}}. Reply STOP to opt out.',
   ARRAY['customer_name', 'party_size', 'date', 'time', 'reference']),
  
  ('booking_confirmation_sunday_lunch', 'sunday_lunch',
   'Hi {{customer_name}}, your Sunday lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. We have your roast selections ready! Reference: {{reference}}.',
   ARRAY['customer_name', 'party_size', 'date', 'time', 'reference']),
  
  ('reminder_regular', 'regular',
   'Reminder: Your table at The Anchor is booked for today at {{time}}. Party of {{party_size}}. We look forward to seeing you! Ref: {{reference}}',
   ARRAY['time', 'party_size', 'reference']),
  
  ('reminder_sunday_lunch', 'sunday_lunch',
   'Sunday Lunch Reminder: Table for {{party_size}} at {{time}} today. {{roast_summary}}. Allergies noted: {{allergies}}. See you soon! Ref: {{reference}}',
   ARRAY['party_size', 'time', 'roast_summary', 'allergies', 'reference']),
  
  ('cancellation', NULL,
   'Your booking {{reference}} at The Anchor has been cancelled. {{refund_message}} For assistance call {{contact_phone}}.',
   ARRAY['reference', 'refund_message', 'contact_phone']),
  
  ('review_request', NULL,
   'Thanks for dining at The Anchor today! We''d love your feedback: {{review_link}} Reply STOP to opt out.',
   ARRAY['review_link']);

-- Add columns to track modifications and verification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'modification_count'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN modification_count INTEGER DEFAULT 0;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'original_booking_data'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN original_booking_data JSONB;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'email_verification_token'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN email_verification_token UUID;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN email_verified_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add indexes for new tables
CREATE INDEX IF NOT EXISTS idx_booking_policies_type ON booking_policies(booking_type);
CREATE INDEX IF NOT EXISTS idx_booking_modifications_booking_id ON table_booking_modifications(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_modifications_created_at ON table_booking_modifications(created_at);
CREATE INDEX IF NOT EXISTS idx_table_combinations_active ON table_combinations(is_active);
CREATE INDEX IF NOT EXISTS idx_sms_templates_key ON table_booking_sms_templates(template_key);

-- Triggers for new tables
-- Create triggers only if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE TRIGGER booking_policies_updated_at
      BEFORE UPDATE ON booking_policies
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_combinations_updated_at
      BEFORE UPDATE ON table_combinations
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
      
    CREATE TRIGGER table_booking_sms_templates_updated_at
      BEFORE UPDATE ON table_booking_sms_templates
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Enable RLS on new tables
ALTER TABLE booking_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_booking_sms_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for booking_policies (public read, admin write)
CREATE POLICY "Anyone can view booking policies" ON booking_policies
  FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Admins can manage booking policies" ON booking_policies
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  END IF;
END $$;

-- RLS Policies for modifications
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view all modifications" ON table_booking_modifications
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Staff can create modifications" ON table_booking_modifications
      FOR INSERT WITH CHECK (
        user_has_permission(auth.uid(), 'table_bookings', 'edit')
      );
  ELSE
    CREATE POLICY "Allow authenticated access" ON table_booking_modifications
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- RLS for table combinations and SMS templates (admin only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'user_has_permission') THEN
    CREATE POLICY "Staff can view table combinations" ON table_combinations
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Admins manage table combinations" ON table_combinations
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );

    CREATE POLICY "Staff can view SMS templates" ON table_booking_sms_templates
      FOR SELECT USING (
        user_has_permission(auth.uid(), 'table_bookings', 'view')
      );

    CREATE POLICY "Admins manage SMS templates" ON table_booking_sms_templates
      FOR ALL USING (
        user_has_permission(auth.uid(), 'table_bookings', 'manage')
      );
  ELSE
    CREATE POLICY "Allow authenticated access to combinations" ON table_combinations
      FOR ALL USING (true); -- Temporary permissive policy
    CREATE POLICY "Allow authenticated access to templates" ON table_booking_sms_templates
      FOR ALL USING (true); -- Temporary permissive policy
  END IF;
END $$;

-- Function to validate booking against policies
CREATE OR REPLACE FUNCTION validate_booking_against_policy(
  p_booking_type table_booking_type,
  p_booking_date DATE,
  p_booking_time TIME,
  p_party_size INTEGER
) RETURNS TABLE (
  is_valid BOOLEAN,
  error_message TEXT
) AS $$
DECLARE
  v_policy booking_policies;
  v_hours_until_booking NUMERIC;
  v_days_until_booking NUMERIC;
BEGIN
  -- Get policy for booking type
  SELECT * INTO v_policy FROM booking_policies WHERE booking_type = p_booking_type;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'No policy found for booking type';
    RETURN;
  END IF;
  
  -- Calculate time until booking
  v_hours_until_booking := EXTRACT(EPOCH FROM (p_booking_date + p_booking_time - NOW())) / 3600;
  v_days_until_booking := p_booking_date - CURRENT_DATE;
  
  -- Check minimum advance hours
  IF v_hours_until_booking < v_policy.min_advance_hours THEN
    RETURN QUERY SELECT false, format('Bookings must be made at least %s hours in advance', v_policy.min_advance_hours);
    RETURN;
  END IF;
  
  -- Check maximum advance days
  IF v_days_until_booking > v_policy.max_advance_days THEN
    RETURN QUERY SELECT false, format('Bookings cannot be made more than %s days in advance', v_policy.max_advance_days);
    RETURN;
  END IF;
  
  -- Check party size
  IF p_party_size > v_policy.max_party_size THEN
    RETURN QUERY SELECT false, format('Maximum party size is %s', v_policy.max_party_size);
    RETURN;
  END IF;
  
  -- Special check for Sunday lunch - must be before 1pm Saturday
  IF p_booking_type = 'sunday_lunch' AND EXTRACT(DOW FROM p_booking_date) = 0 THEN
    -- If booking is for this Sunday and it's past 1pm Saturday
    IF p_booking_date - CURRENT_DATE <= 1 AND 
       (EXTRACT(DOW FROM CURRENT_DATE) = 6 AND CURRENT_TIME > '13:00:00'::TIME) THEN
      RETURN QUERY SELECT false, 'Sunday lunch bookings must be made before 1pm on Saturday';
      RETURN;
    END IF;
  END IF;
  
  RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate refund amount
CREATE OR REPLACE FUNCTION calculate_refund_amount(
  p_booking_id UUID
) RETURNS TABLE (
  refund_percentage INTEGER,
  refund_amount DECIMAL(10,2),
  refund_reason TEXT
) AS $$
DECLARE
  v_booking table_bookings;
  v_payment table_booking_payments;
  v_policy booking_policies;
  v_hours_until_booking NUMERIC;
BEGIN
  -- Get booking details
  SELECT * INTO v_booking FROM table_bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0.00::DECIMAL, 'Booking not found';
    RETURN;
  END IF;
  
  -- Get payment details
  SELECT * INTO v_payment FROM table_booking_payments 
  WHERE booking_id = p_booking_id AND status = 'completed'
  ORDER BY created_at DESC LIMIT 1;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0.00::DECIMAL, 'No payment found';
    RETURN;
  END IF;
  
  -- Get policy
  SELECT * INTO v_policy FROM booking_policies WHERE booking_type = v_booking.booking_type;
  
  -- Calculate hours until booking
  v_hours_until_booking := EXTRACT(EPOCH FROM (v_booking.booking_date + v_booking.booking_time - NOW())) / 3600;
  
  -- Determine refund percentage
  IF v_hours_until_booking >= v_policy.full_refund_hours THEN
    RETURN QUERY SELECT 100, v_payment.amount, 'Full refund - cancelled with sufficient notice';
  ELSIF v_hours_until_booking >= v_policy.partial_refund_hours THEN
    RETURN QUERY SELECT 
      v_policy.partial_refund_percentage, 
      (v_payment.amount * v_policy.partial_refund_percentage / 100)::DECIMAL(10,2),
      format('%s%% refund - cancelled with %s hours notice', v_policy.partial_refund_percentage, round(v_hours_until_booking));
  ELSE
    RETURN QUERY SELECT 0, 0.00::DECIMAL, 'No refund - insufficient cancellation notice';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert table booking permissions into RBAC system
DO $$
BEGIN
  -- Only insert permissions if rbac_permissions table exists
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'rbac_permissions'
  ) THEN
    INSERT INTO rbac_permissions (module, action, description) VALUES
      ('table_bookings', 'view', 'View table bookings'),
      ('table_bookings', 'create', 'Create table bookings'),
      ('table_bookings', 'edit', 'Edit table bookings'),
      ('table_bookings', 'delete', 'Delete table bookings'),
      ('table_bookings', 'manage', 'Full table booking management')
    ON CONFLICT (module, action) DO NOTHING;
  END IF;
  
  -- Only grant permissions if both tables exist
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'rbac_role_permissions'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'rbac_roles'
  ) THEN
    -- Manager role gets all permissions
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM rbac_roles r
    CROSS JOIN rbac_permissions p
    WHERE r.role_name = 'manager'
      AND p.module = 'table_bookings'
    ON CONFLICT (role_id, permission_id) DO NOTHING;
    
    -- Staff role gets view and create permissions
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM rbac_roles r
    CROSS JOIN rbac_permissions p
    WHERE r.role_name = 'staff'
      AND p.module = 'table_bookings'
      AND p.action IN ('view', 'create')
    ON CONFLICT (role_id, permission_id) DO NOTHING;
  END IF;
END $$;

-- Super admin already has all permissions by default

-- Grant necessary permissions to authenticated users for API access
DO $$
BEGIN
  -- Check if 'authenticated' role exists before granting
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON booking_time_slots TO authenticated;
    GRANT SELECT ON table_configuration TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON table_bookings TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON table_booking_items TO authenticated;
    GRANT SELECT, INSERT, UPDATE ON table_booking_payments TO authenticated;
    GRANT SELECT ON booking_policies TO authenticated;
    GRANT SELECT ON table_booking_sms_templates TO authenticated;
    GRANT SELECT, INSERT ON table_booking_modifications TO authenticated;
    GRANT EXECUTE ON FUNCTION check_table_availability TO authenticated;
    GRANT EXECUTE ON FUNCTION generate_booking_reference TO authenticated;
    GRANT EXECUTE ON FUNCTION validate_booking_against_policy TO authenticated;
    GRANT EXECUTE ON FUNCTION calculate_refund_amount TO authenticated;
  END IF;
END $$;