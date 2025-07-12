-- Complete Loyalty System Database Schema
-- This migration creates all tables needed for The Anchor VIP Club
-- Including rewards, achievements, and challenges

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
  sort_order INTEGER DEFAULT 0,
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
  reference_type VARCHAR(50), -- 'check_in', 'achievement', 'redemption', 'adjustment', 'challenge'
  reference_id UUID, -- links to check_in, achievement, redemption, challenge, etc
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

-- Create loyalty challenges table (time-limited achievements)
CREATE TABLE IF NOT EXISTS loyalty_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(10),
  points_value INTEGER DEFAULT 0,
  criteria JSONB NOT NULL,
  category VARCHAR(50), -- 'monthly', 'seasonal', 'special'
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  max_completions INTEGER DEFAULT 1, -- How many times can be completed
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create customer challenges table (tracking challenge progress)
CREATE TABLE IF NOT EXISTS customer_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  challenge_id UUID REFERENCES loyalty_challenges(id) ON DELETE CASCADE,
  progress JSONB DEFAULT '{}', -- Stores progress data
  completed_count INTEGER DEFAULT 0,
  last_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, challenge_id)
);

-- Create achievement progress table (for multi-step achievements)
CREATE TABLE IF NOT EXISTS achievement_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  achievement_id UUID REFERENCES loyalty_achievements(id) ON DELETE CASCADE,
  progress JSONB DEFAULT '{}', -- Stores progress data
  current_value INTEGER DEFAULT 0,
  target_value INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(member_id, achievement_id)
);

-- Create indexes for performance
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
CREATE INDEX IF NOT EXISTS idx_loyalty_challenges_active ON loyalty_challenges(active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_customer_challenges_member_id ON customer_challenges(member_id);
CREATE INDEX IF NOT EXISTS idx_achievement_progress_member_id ON achievement_progress(member_id);

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
ALTER TABLE loyalty_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement_progress ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for staff access (drop existing policies first to avoid conflicts)
-- Loyalty Programs
DROP POLICY IF EXISTS "Staff can view loyalty programs" ON loyalty_programs;
DROP POLICY IF EXISTS "Staff can manage loyalty programs" ON loyalty_programs;
CREATE POLICY "Staff can view loyalty programs" ON loyalty_programs
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty programs" ON loyalty_programs
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Tiers
DROP POLICY IF EXISTS "Staff can view loyalty tiers" ON loyalty_tiers;
DROP POLICY IF EXISTS "Staff can manage loyalty tiers" ON loyalty_tiers;
CREATE POLICY "Staff can view loyalty tiers" ON loyalty_tiers
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty tiers" ON loyalty_tiers
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Members
DROP POLICY IF EXISTS "Staff can view loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can manage loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Members can view own loyalty data" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can view all loyalty data" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can manage loyalty data" ON loyalty_members;
CREATE POLICY "Staff can view loyalty members" ON loyalty_members
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty members" ON loyalty_members
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Event Check-ins
DROP POLICY IF EXISTS "Staff can view event check-ins" ON event_check_ins;
DROP POLICY IF EXISTS "Staff can manage event check-ins" ON event_check_ins;
CREATE POLICY "Staff can view event check-ins" ON event_check_ins
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage event check-ins" ON event_check_ins
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Achievements
DROP POLICY IF EXISTS "Staff can view achievements" ON loyalty_achievements;
DROP POLICY IF EXISTS "Staff can manage achievements" ON loyalty_achievements;
CREATE POLICY "Staff can view achievements" ON loyalty_achievements
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage achievements" ON loyalty_achievements
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Customer Achievements
DROP POLICY IF EXISTS "Staff can view customer achievements" ON customer_achievements;
DROP POLICY IF EXISTS "Staff can manage customer achievements" ON customer_achievements;
CREATE POLICY "Staff can view customer achievements" ON customer_achievements
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage customer achievements" ON customer_achievements
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Rewards
DROP POLICY IF EXISTS "Staff can view rewards" ON loyalty_rewards;
DROP POLICY IF EXISTS "Staff can manage rewards" ON loyalty_rewards;
CREATE POLICY "Staff can view rewards" ON loyalty_rewards
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage rewards" ON loyalty_rewards
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Reward Redemptions
DROP POLICY IF EXISTS "Staff can view redemptions" ON reward_redemptions;
DROP POLICY IF EXISTS "Staff can manage redemptions" ON reward_redemptions;
CREATE POLICY "Staff can view redemptions" ON reward_redemptions
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage redemptions" ON reward_redemptions
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Point Transactions
DROP POLICY IF EXISTS "Staff can view point transactions" ON loyalty_point_transactions;
DROP POLICY IF EXISTS "Staff can manage point transactions" ON loyalty_point_transactions;
CREATE POLICY "Staff can view point transactions" ON loyalty_point_transactions
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage point transactions" ON loyalty_point_transactions
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Campaigns
DROP POLICY IF EXISTS "Staff can view campaigns" ON loyalty_campaigns;
DROP POLICY IF EXISTS "Staff can manage campaigns" ON loyalty_campaigns;
CREATE POLICY "Staff can view campaigns" ON loyalty_campaigns
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage campaigns" ON loyalty_campaigns
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Loyalty Challenges
DROP POLICY IF EXISTS "Staff can view challenges" ON loyalty_challenges;
DROP POLICY IF EXISTS "Staff can manage challenges" ON loyalty_challenges;
CREATE POLICY "Staff can view challenges" ON loyalty_challenges
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage challenges" ON loyalty_challenges
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Customer Challenges
DROP POLICY IF EXISTS "Staff can view customer challenges" ON customer_challenges;
DROP POLICY IF EXISTS "Staff can manage customer challenges" ON customer_challenges;
CREATE POLICY "Staff can view customer challenges" ON customer_challenges
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage customer challenges" ON customer_challenges
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Achievement Progress
DROP POLICY IF EXISTS "Staff can view achievement progress" ON achievement_progress;
DROP POLICY IF EXISTS "Staff can manage achievement progress" ON achievement_progress;
CREATE POLICY "Staff can view achievement progress" ON achievement_progress
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage achievement progress" ON achievement_progress
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Create update triggers for updated_at columns
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_loyalty_programs_updated_at BEFORE UPDATE ON loyalty_programs 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_tiers_updated_at BEFORE UPDATE ON loyalty_tiers 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_members_updated_at BEFORE UPDATE ON loyalty_members 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_achievements_updated_at BEFORE UPDATE ON loyalty_achievements 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_rewards_updated_at BEFORE UPDATE ON loyalty_rewards 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_campaigns_updated_at BEFORE UPDATE ON loyalty_campaigns 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_loyalty_challenges_updated_at BEFORE UPDATE ON loyalty_challenges 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_customer_challenges_updated_at BEFORE UPDATE ON customer_challenges 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_achievement_progress_updated_at BEFORE UPDATE ON achievement_progress 
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Insert default loyalty program and tiers
INSERT INTO loyalty_programs (id, name, active, settings)
VALUES ('550e8400-e29b-41d4-a716-446655440000', 'The Anchor VIP Club', true, '{
  "points_per_check_in": 10,
  "welcome_bonus": 50,
  "birthday_bonus": 100,
  "referral_bonus": 50
}')
ON CONFLICT (id) DO NOTHING;

-- Insert default tiers
INSERT INTO loyalty_tiers (program_id, name, level, min_events, point_multiplier, color, icon)
VALUES 
  ('550e8400-e29b-41d4-a716-446655440000', 'Member', 0, 0, 1.0, '#9CA3AF', '🟢'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Bronze', 1, 5, 1.1, '#B87333', '🥉'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Silver', 2, 15, 1.25, '#C0C0C0', '🥈'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Gold', 3, 30, 1.5, '#FFD700', '🥇'),
  ('550e8400-e29b-41d4-a716-446655440000', 'Platinum', 4, 50, 2.0, '#E5E4E2', '💎')
ON CONFLICT DO NOTHING;