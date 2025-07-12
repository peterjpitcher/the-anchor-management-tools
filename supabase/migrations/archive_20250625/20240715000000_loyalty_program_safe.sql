-- Loyalty Program Database Schema (SAFE VERSION - Can be run multiple times)
-- This migration creates all tables needed for The Anchor VIP Club
-- Uses IF NOT EXISTS and ON CONFLICT to handle partial migrations

-- Create loyalty programs table (for future multi-program support)
CREATE TABLE IF NOT EXISTS loyalty_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  active BOOLEAN DEFAULT true,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty tiers table
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  level INTEGER NOT NULL,
  min_events INTEGER DEFAULT 0,
  point_multiplier DECIMAL(3,2) DEFAULT 1.0,
  color VARCHAR(7),
  icon VARCHAR(10),
  benefits JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_id, level)
);

-- Create loyalty members table
CREATE TABLE IF NOT EXISTS loyalty_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES loyalty_tiers(id),
  total_points INTEGER DEFAULT 0,
  available_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  lifetime_events INTEGER DEFAULT 0,
  join_date DATE DEFAULT CURRENT_DATE,
  last_visit_date DATE,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'inactive')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, program_id)
);

-- Create event check-ins table
CREATE TABLE IF NOT EXISTS event_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id),
  check_in_time TIMESTAMPTZ DEFAULT NOW(),
  check_in_method VARCHAR(50) DEFAULT 'qr' CHECK (check_in_method IN ('qr', 'manual', 'auto')),
  points_earned INTEGER DEFAULT 0,
  staff_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, customer_id)
);

-- Create loyalty achievements table
CREATE TABLE IF NOT EXISTS loyalty_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(10),
  points_value INTEGER DEFAULT 0,
  criteria JSONB NOT NULL,
  category VARCHAR(50),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create customer achievements table
CREATE TABLE IF NOT EXISTS customer_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  achievement_id UUID REFERENCES loyalty_achievements(id) ON DELETE CASCADE,
  earned_date TIMESTAMPTZ DEFAULT NOW(),
  points_awarded INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, achievement_id)
);

-- Create loyalty rewards table
CREATE TABLE IF NOT EXISTS loyalty_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  points_cost INTEGER NOT NULL,
  tier_required UUID REFERENCES loyalty_tiers(id),
  category VARCHAR(50),
  icon VARCHAR(10),
  inventory INTEGER,
  daily_limit INTEGER,
  active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create reward redemptions table
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  reward_id UUID REFERENCES loyalty_rewards(id) ON DELETE CASCADE,
  redemption_code VARCHAR(20) UNIQUE,
  points_spent INTEGER NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  redeemed_by UUID REFERENCES auth.users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'redeemed', 'expired', 'cancelled')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty point transactions table
CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  points INTEGER NOT NULL, -- positive for earned, negative for spent
  transaction_type VARCHAR(50) NOT NULL,
  description TEXT,
  reference_type VARCHAR(50), -- 'check_in', 'achievement', 'redemption', 'adjustment', etc
  reference_id UUID, -- links to check_in, achievement, redemption, etc
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create loyalty campaigns table (for bonus point events)
CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  bonus_type VARCHAR(50) NOT NULL, -- 'multiplier', 'fixed', 'percentage'
  bonus_value DECIMAL(10,2) NOT NULL,
  criteria JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_loyalty_members_customer_id ON loyalty_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_tier_id ON loyalty_members(tier_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_event_id ON event_check_ins(event_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_customer_id ON event_check_ins(customer_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_member_id ON event_check_ins(member_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_check_in_time ON event_check_ins(check_in_time);
CREATE INDEX IF NOT EXISTS idx_customer_achievements_member_id ON customer_achievements(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member_id ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_code ON reward_redemptions(redemption_code);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_member_id ON loyalty_point_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_created_at ON loyalty_point_transactions(created_at);

-- Enable Row Level Security
ALTER TABLE loyalty_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_campaigns ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (DROP and RECREATE to ensure they're correct)
-- For now, loyalty data is viewable by staff only
DROP POLICY IF EXISTS "Members can view own loyalty data" ON loyalty_members;
CREATE POLICY "Members can view own loyalty data" ON loyalty_members
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

-- Staff can view all loyalty data
DROP POLICY IF EXISTS "Staff can view all loyalty data" ON loyalty_members;
CREATE POLICY "Staff can view all loyalty data" ON loyalty_members
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

-- Staff can manage loyalty data
DROP POLICY IF EXISTS "Staff can manage loyalty data" ON loyalty_members;
CREATE POLICY "Staff can manage loyalty data" ON loyalty_members
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Similar policies for other tables...

-- Create functions for automatic tier upgrades
CREATE OR REPLACE FUNCTION check_tier_upgrade()
RETURNS TRIGGER AS $$
DECLARE
  current_tier RECORD;
  next_tier RECORD;
BEGIN
  -- Get current tier
  SELECT * INTO current_tier 
  FROM loyalty_tiers 
  WHERE id = NEW.tier_id;
  
  -- Check if member qualifies for next tier
  SELECT * INTO next_tier
  FROM loyalty_tiers
  WHERE program_id = (SELECT program_id FROM loyalty_members WHERE id = NEW.id)
    AND level = current_tier.level + 1
    AND min_events <= NEW.lifetime_events;
  
  -- Update tier if qualified
  IF next_tier.id IS NOT NULL THEN
    UPDATE loyalty_members 
    SET tier_id = next_tier.id,
        updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic tier upgrades (DROP and RECREATE)
DROP TRIGGER IF EXISTS loyalty_tier_upgrade_trigger ON loyalty_members;
CREATE TRIGGER loyalty_tier_upgrade_trigger
  AFTER UPDATE OF lifetime_events ON loyalty_members
  FOR EACH ROW
  WHEN (NEW.lifetime_events > OLD.lifetime_events)
  EXECUTE FUNCTION check_tier_upgrade();

-- Create function to calculate points with multipliers
CREATE OR REPLACE FUNCTION calculate_event_points(
  p_base_points INTEGER,
  p_tier_id UUID,
  p_event_id UUID,
  p_member_id UUID
) RETURNS INTEGER AS $$
DECLARE
  tier_multiplier DECIMAL;
  campaign_bonus DECIMAL DEFAULT 1.0;
  final_points INTEGER;
BEGIN
  -- Get tier multiplier
  SELECT point_multiplier INTO tier_multiplier
  FROM loyalty_tiers
  WHERE id = p_tier_id;
  
  -- Check for active campaigns (simplified)
  -- In production, this would check campaign criteria
  SELECT MAX(
    CASE 
      WHEN bonus_type = 'multiplier' THEN bonus_value
      ELSE 1.0
    END
  ) INTO campaign_bonus
  FROM loyalty_campaigns
  WHERE active = true
    AND CURRENT_DATE BETWEEN start_date AND end_date;
  
  -- Calculate final points
  final_points := ROUND(p_base_points * COALESCE(tier_multiplier, 1.0) * COALESCE(campaign_bonus, 1.0));
  
  RETURN final_points;
END;
$$ LANGUAGE plpgsql;

-- Insert default data
INSERT INTO loyalty_programs (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'The Anchor VIP Club')
ON CONFLICT (id) DO NOTHING;

-- Insert default tiers
INSERT INTO loyalty_tiers (program_id, name, level, min_events, point_multiplier, color, icon) VALUES
  ('00000000-0000-0000-0000-000000000001', 'VIP Member', 1, 0, 1.0, '#9CA3AF', '🌟'),
  ('00000000-0000-0000-0000-000000000001', 'Bronze VIP', 2, 5, 2.0, '#92400E', '🥉'),
  ('00000000-0000-0000-0000-000000000001', 'Silver VIP', 3, 10, 3.0, '#6B7280', '🥈'),
  ('00000000-0000-0000-0000-000000000001', 'Gold VIP', 4, 20, 4.0, '#EAB308', '🥇'),
  ('00000000-0000-0000-0000-000000000001', 'Platinum VIP', 5, 40, 6.0, '#7C3AED', '💎')
ON CONFLICT (program_id, level) DO NOTHING;

-- Add loyalty permissions to RBAC
INSERT INTO permissions (module_name, action) VALUES
  ('loyalty', 'view'),
  ('loyalty', 'manage'),
  ('loyalty', 'redeem'),
  ('loyalty', 'enroll')
ON CONFLICT (module_name, action) DO NOTHING;

-- Grant loyalty permissions to roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' 
  AND p.module_name = 'loyalty'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager' 
  AND p.module_name = 'loyalty'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'staff' 
  AND p.module_name = 'loyalty'
  AND p.action IN ('view', 'redeem')
ON CONFLICT (role_id, permission_id) DO NOTHING;