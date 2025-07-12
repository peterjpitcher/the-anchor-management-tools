-- Complete Loyalty Program Migration (Bulletproof Version)
-- This script handles partial migrations and ensures everything is properly set up
-- Run this entire script in your Supabase SQL editor

-- Start transaction for safety
BEGIN;

-- 1. CREATE ALL TABLES (with IF NOT EXISTS)
-- ==========================================

-- Create loyalty programs table
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
  points INTEGER NOT NULL,
  transaction_type VARCHAR(50) NOT NULL,
  description TEXT,
  reference_type VARCHAR(50),
  reference_id UUID,
  balance_after INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create loyalty campaigns table
CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  bonus_type VARCHAR(50) NOT NULL,
  bonus_value DECIMAL(10,2) NOT NULL,
  criteria JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CREATE ALL INDEXES (checking for existence properly)
-- =======================================================

DO $$
DECLARE
    index_exists BOOLEAN;
BEGIN
    -- idx_loyalty_members_customer_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'loyalty_members' 
        AND indexname = 'idx_loyalty_members_customer_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_loyalty_members_customer_id ON loyalty_members(customer_id)';
        RAISE NOTICE 'Created index: idx_loyalty_members_customer_id';
    END IF;

    -- idx_loyalty_members_tier_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'loyalty_members' 
        AND indexname = 'idx_loyalty_members_tier_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_loyalty_members_tier_id ON loyalty_members(tier_id)';
        RAISE NOTICE 'Created index: idx_loyalty_members_tier_id';
    END IF;

    -- idx_event_check_ins_event_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'event_check_ins' 
        AND indexname = 'idx_event_check_ins_event_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_event_check_ins_event_id ON event_check_ins(event_id)';
        RAISE NOTICE 'Created index: idx_event_check_ins_event_id';
    END IF;

    -- idx_event_check_ins_customer_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'event_check_ins' 
        AND indexname = 'idx_event_check_ins_customer_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_event_check_ins_customer_id ON event_check_ins(customer_id)';
        RAISE NOTICE 'Created index: idx_event_check_ins_customer_id';
    END IF;

    -- idx_event_check_ins_member_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'event_check_ins' 
        AND indexname = 'idx_event_check_ins_member_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_event_check_ins_member_id ON event_check_ins(member_id)';
        RAISE NOTICE 'Created index: idx_event_check_ins_member_id';
    END IF;

    -- idx_event_check_ins_check_in_time
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'event_check_ins' 
        AND indexname = 'idx_event_check_ins_check_in_time'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_event_check_ins_check_in_time ON event_check_ins(check_in_time)';
        RAISE NOTICE 'Created index: idx_event_check_ins_check_in_time';
    END IF;

    -- idx_customer_achievements_member_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'customer_achievements' 
        AND indexname = 'idx_customer_achievements_member_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_customer_achievements_member_id ON customer_achievements(member_id)';
        RAISE NOTICE 'Created index: idx_customer_achievements_member_id';
    END IF;

    -- idx_reward_redemptions_member_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'reward_redemptions' 
        AND indexname = 'idx_reward_redemptions_member_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_reward_redemptions_member_id ON reward_redemptions(member_id)';
        RAISE NOTICE 'Created index: idx_reward_redemptions_member_id';
    END IF;

    -- idx_reward_redemptions_code
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'reward_redemptions' 
        AND indexname = 'idx_reward_redemptions_code'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_reward_redemptions_code ON reward_redemptions(redemption_code)';
        RAISE NOTICE 'Created index: idx_reward_redemptions_code';
    END IF;

    -- idx_reward_redemptions_status
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'reward_redemptions' 
        AND indexname = 'idx_reward_redemptions_status'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_reward_redemptions_status ON reward_redemptions(status)';
        RAISE NOTICE 'Created index: idx_reward_redemptions_status';
    END IF;

    -- idx_loyalty_point_transactions_member_id
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'loyalty_point_transactions' 
        AND indexname = 'idx_loyalty_point_transactions_member_id'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_loyalty_point_transactions_member_id ON loyalty_point_transactions(member_id)';
        RAISE NOTICE 'Created index: idx_loyalty_point_transactions_member_id';
    END IF;

    -- idx_loyalty_point_transactions_created_at
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'loyalty_point_transactions' 
        AND indexname = 'idx_loyalty_point_transactions_created_at'
    ) INTO index_exists;
    
    IF NOT index_exists THEN
        EXECUTE 'CREATE INDEX idx_loyalty_point_transactions_created_at ON loyalty_point_transactions(created_at)';
        RAISE NOTICE 'Created index: idx_loyalty_point_transactions_created_at';
    END IF;

END $$;

-- 3. ENABLE ROW LEVEL SECURITY
-- ============================
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

-- 4. CREATE RLS POLICIES (drop and recreate for consistency)
-- ==========================================================

-- Loyalty members policies
DROP POLICY IF EXISTS "Members can view own loyalty data" ON loyalty_members;
CREATE POLICY "Members can view own loyalty data" ON loyalty_members
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage loyalty data" ON loyalty_members;
CREATE POLICY "Staff can manage loyalty data" ON loyalty_members
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty programs policies
DROP POLICY IF EXISTS "Staff can view loyalty programs" ON loyalty_programs;
CREATE POLICY "Staff can view loyalty programs" ON loyalty_programs
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage loyalty programs" ON loyalty_programs;
CREATE POLICY "Staff can manage loyalty programs" ON loyalty_programs
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty tiers policies
DROP POLICY IF EXISTS "Staff can view loyalty tiers" ON loyalty_tiers;
CREATE POLICY "Staff can view loyalty tiers" ON loyalty_tiers
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage loyalty tiers" ON loyalty_tiers;
CREATE POLICY "Staff can manage loyalty tiers" ON loyalty_tiers
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Event check-ins policies
DROP POLICY IF EXISTS "Staff can view check-ins" ON event_check_ins;
CREATE POLICY "Staff can view check-ins" ON event_check_ins
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage check-ins" ON event_check_ins;
CREATE POLICY "Staff can manage check-ins" ON event_check_ins
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty achievements policies
DROP POLICY IF EXISTS "Staff can view achievements" ON loyalty_achievements;
CREATE POLICY "Staff can view achievements" ON loyalty_achievements
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage achievements" ON loyalty_achievements;
CREATE POLICY "Staff can manage achievements" ON loyalty_achievements
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Customer achievements policies
DROP POLICY IF EXISTS "Staff can view customer achievements" ON customer_achievements;
CREATE POLICY "Staff can view customer achievements" ON customer_achievements
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage customer achievements" ON customer_achievements;
CREATE POLICY "Staff can manage customer achievements" ON customer_achievements
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty rewards policies
DROP POLICY IF EXISTS "Staff can view rewards" ON loyalty_rewards;
CREATE POLICY "Staff can view rewards" ON loyalty_rewards
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage rewards" ON loyalty_rewards;
CREATE POLICY "Staff can manage rewards" ON loyalty_rewards
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Reward redemptions policies
DROP POLICY IF EXISTS "Staff can view redemptions" ON reward_redemptions;
CREATE POLICY "Staff can view redemptions" ON reward_redemptions
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage redemptions" ON reward_redemptions;
CREATE POLICY "Staff can manage redemptions" ON reward_redemptions
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'redeem') OR user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Point transactions policies
DROP POLICY IF EXISTS "Staff can view point transactions" ON loyalty_point_transactions;
CREATE POLICY "Staff can view point transactions" ON loyalty_point_transactions
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can create point transactions" ON loyalty_point_transactions;
CREATE POLICY "Staff can create point transactions" ON loyalty_point_transactions
  FOR INSERT WITH CHECK (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Campaigns policies
DROP POLICY IF EXISTS "Staff can view campaigns" ON loyalty_campaigns;
CREATE POLICY "Staff can view campaigns" ON loyalty_campaigns
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));

DROP POLICY IF EXISTS "Staff can manage campaigns" ON loyalty_campaigns;
CREATE POLICY "Staff can manage campaigns" ON loyalty_campaigns
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- 5. CREATE FUNCTIONS
-- ===================

-- Function for automatic tier upgrades
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

-- Function to calculate points with multipliers
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
  
  -- Check for active campaigns
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

-- 6. CREATE TRIGGERS
-- ==================

-- Drop and recreate trigger for tier upgrades
DROP TRIGGER IF EXISTS loyalty_tier_upgrade_trigger ON loyalty_members;
CREATE TRIGGER loyalty_tier_upgrade_trigger
  AFTER UPDATE OF lifetime_events ON loyalty_members
  FOR EACH ROW
  WHEN (NEW.lifetime_events > OLD.lifetime_events)
  EXECUTE FUNCTION check_tier_upgrade();

-- 7. INSERT DEFAULT DATA
-- ======================

-- Insert default loyalty program
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

-- 8. ADD PERMISSIONS
-- ==================

-- Add loyalty permissions
INSERT INTO permissions (module_name, action) VALUES
  ('loyalty', 'view'),
  ('loyalty', 'manage'),
  ('loyalty', 'redeem'),
  ('loyalty', 'enroll')
ON CONFLICT (module_name, action) DO NOTHING;

-- Grant permissions to super_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'super_admin' 
  AND p.module_name = 'loyalty'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant permissions to manager
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager' 
  AND p.module_name = 'loyalty'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Grant limited permissions to staff
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'staff' 
  AND p.module_name = 'loyalty'
  AND p.action IN ('view', 'redeem')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 9. VERIFY MIGRATION COMPLETION
-- ==============================

-- Commit transaction
COMMIT;

-- Final verification queries
SELECT 'MIGRATION COMPLETE!' as status;

SELECT '--- Tables Created ---' as section;
SELECT COUNT(*) as table_count, 
       STRING_AGG(table_name, ', ' ORDER BY table_name) as tables
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND table_name IN (
    'loyalty_programs', 'loyalty_tiers', 'loyalty_members', 
    'loyalty_rewards', 'event_check_ins', 'loyalty_achievements',
    'customer_achievements', 'reward_redemptions', 
    'loyalty_point_transactions', 'loyalty_campaigns'
  );

SELECT '--- Indexes Created ---' as section;
SELECT COUNT(*) as index_count
FROM pg_indexes 
WHERE schemaname = 'public'
  AND (indexname LIKE 'idx_loyalty%' 
       OR indexname LIKE 'idx_event_check_ins%' 
       OR indexname LIKE 'idx_customer_achievements%'
       OR indexname LIKE 'idx_reward_redemptions%');

SELECT '--- Permissions Created ---' as section;
SELECT COUNT(*) as permission_count,
       STRING_AGG(action, ', ' ORDER BY action) as actions
FROM permissions 
WHERE module_name = 'loyalty';

SELECT '--- Functions Created ---' as section;
SELECT COUNT(*) as function_count,
       STRING_AGG(routine_name, ', ' ORDER BY routine_name) as functions
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_name IN ('check_tier_upgrade', 'calculate_event_points');

SELECT '--- Default Data Created ---' as section;
SELECT 
  (SELECT COUNT(*) FROM loyalty_programs) as programs,
  (SELECT COUNT(*) FROM loyalty_tiers) as tiers;