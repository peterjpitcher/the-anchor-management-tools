-- Create core loyalty tables for The Anchor VIP Club
-- This migration creates the foundation for the loyalty program including members, tiers, points, and check-ins

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Staff can view loyalty campaigns" ON loyalty_campaigns;
DROP POLICY IF EXISTS "Staff can manage loyalty campaigns" ON loyalty_campaigns;
DROP POLICY IF EXISTS "Staff can view loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can manage loyalty members" ON loyalty_members;
DROP POLICY IF EXISTS "Staff can view loyalty tiers" ON loyalty_tiers;
DROP POLICY IF EXISTS "Staff can manage loyalty tiers" ON loyalty_tiers;
DROP POLICY IF EXISTS "Staff can view point transactions" ON loyalty_point_transactions;
DROP POLICY IF EXISTS "Staff can manage point transactions" ON loyalty_point_transactions;
DROP POLICY IF EXISTS "Staff can view event check-ins" ON event_check_ins;
DROP POLICY IF EXISTS "Staff can manage event check-ins" ON event_check_ins;
DROP POLICY IF EXISTS "Staff can view reward redemptions" ON reward_redemptions;
DROP POLICY IF EXISTS "Staff can manage reward redemptions" ON reward_redemptions;

-- Create loyalty_campaigns table
CREATE TABLE IF NOT EXISTS loyalty_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  bonus_type VARCHAR(50) NOT NULL CHECK (bonus_type IN ('multiplier', 'fixed', 'percentage')),
  bonus_value DECIMAL(10,2) NOT NULL,
  criteria JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty_members table
CREATE TABLE IF NOT EXISTS loyalty_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE UNIQUE NOT NULL,
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  tier_id UUID REFERENCES loyalty_tiers(id),
  total_points INTEGER DEFAULT 0,
  available_points INTEGER DEFAULT 0,
  lifetime_points INTEGER DEFAULT 0,
  lifetime_events INTEGER DEFAULT 0,
  join_date DATE DEFAULT CURRENT_DATE,
  last_activity_date DATE,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty_tiers table
CREATE TABLE IF NOT EXISTS loyalty_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  level INTEGER NOT NULL,
  min_events INTEGER NOT NULL DEFAULT 0,
  point_multiplier DECIMAL(3,2) DEFAULT 1.0,
  color VARCHAR(7), -- Hex color for UI
  icon VARCHAR(50), -- Icon/emoji
  benefits JSONB DEFAULT '[]',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create event_check_ins table
CREATE TABLE IF NOT EXISTS event_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  event_id UUID REFERENCES events(id) NOT NULL,
  customer_id UUID REFERENCES customers(id) NOT NULL,
  member_id UUID REFERENCES loyalty_members(id),
  check_in_time TIMESTAMPTZ DEFAULT NOW(),
  check_in_method VARCHAR(50) DEFAULT 'manual', -- 'qr', 'manual', 'self'
  points_earned INTEGER DEFAULT 0,
  achievements_earned UUID[] DEFAULT '{}',
  staff_id UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create loyalty_point_transactions table
CREATE TABLE IF NOT EXISTS loyalty_point_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE NOT NULL,
  points INTEGER NOT NULL, -- positive for earned, negative for spent
  balance_after INTEGER NOT NULL,
  transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('earned', 'redeemed', 'expired', 'adjusted', 'bonus')),
  description TEXT,
  reference_type VARCHAR(50), -- 'check_in', 'achievement', 'redemption', 'manual'
  reference_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Create reward_redemptions table
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE NOT NULL,
  reward_id UUID REFERENCES loyalty_rewards(id),
  points_spent INTEGER NOT NULL,
  redeemed_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,
  fulfilled_by UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_program_id ON loyalty_campaigns(program_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_start_date ON loyalty_campaigns(start_date);
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_end_date ON loyalty_campaigns(end_date);
CREATE INDEX IF NOT EXISTS idx_loyalty_campaigns_active ON loyalty_campaigns(active);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_customer_id ON loyalty_members(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_tier_id ON loyalty_members(tier_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_members_status ON loyalty_members(status);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_event_id ON event_check_ins(event_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_customer_id ON event_check_ins(customer_id);
CREATE INDEX IF NOT EXISTS idx_event_check_ins_check_in_time ON event_check_ins(check_in_time DESC);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_member_id ON loyalty_point_transactions(member_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_point_transactions_created_at ON loyalty_point_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member_id ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_status ON reward_redemptions(status);

-- Enable RLS
ALTER TABLE loyalty_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_point_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for loyalty_campaigns
CREATE POLICY "Staff can view loyalty campaigns" ON loyalty_campaigns
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage loyalty campaigns" ON loyalty_campaigns
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for loyalty_members
CREATE POLICY "Staff can view loyalty members" ON loyalty_members
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage loyalty members" ON loyalty_members
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for loyalty_tiers
CREATE POLICY "Staff can view loyalty tiers" ON loyalty_tiers
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage loyalty tiers" ON loyalty_tiers
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for event_check_ins
CREATE POLICY "Staff can view event check-ins" ON event_check_ins
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage event check-ins" ON event_check_ins
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for loyalty_point_transactions
CREATE POLICY "Staff can view point transactions" ON loyalty_point_transactions
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage point transactions" ON loyalty_point_transactions
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create RLS policies for reward_redemptions
CREATE POLICY "Staff can view reward redemptions" ON reward_redemptions
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

CREATE POLICY "Staff can manage reward redemptions" ON reward_redemptions
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create update timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_loyalty_campaigns_updated_at BEFORE UPDATE
  ON loyalty_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_loyalty_members_updated_at BEFORE UPDATE
  ON loyalty_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_loyalty_tiers_updated_at BEFORE UPDATE
  ON loyalty_tiers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default tiers for The Anchor VIP Club
INSERT INTO loyalty_tiers (program_id, name, level, min_events, point_multiplier, color, icon, benefits, sort_order)
SELECT 
  lp.id,
  tier.name,
  tier.level,
  tier.min_events,
  tier.point_multiplier,
  tier.color,
  tier.icon,
  tier.benefits,
  tier.sort_order
FROM loyalty_programs lp
CROSS JOIN (
  VALUES 
    ('VIP Member', 1, 0, 1.0, '#6B7280', '⭐', '["Welcome bonus: 50 points", "SMS event alerts", "Birthday month recognition", "Access to loyalty portal"]'::jsonb, 1),
    ('VIP Bronze', 2, 5, 2.0, '#92400E', '🥉', '["100 points per attendance", "Early access booking (24 hours)", "10% off ticketed events", "Monthly bonus challenges"]'::jsonb, 2),
    ('VIP Silver', 3, 10, 3.0, '#6B7280', '🥈', '["150 points per attendance", "Bring-a-friend bonus points", "15% off ticketed events", "Exclusive Silver-only events", "Skip-the-queue privileges"]'::jsonb, 3),
    ('VIP Gold', 4, 20, 4.0, '#F59E0B', '🥇', '["200 points per attendance", "Complimentary welcome drink each visit", "20% off ticketed events", "Influence on event planning", "Reserved Gold table option"]'::jsonb, 4),
    ('VIP Platinum', 5, 40, 6.0, '#7C3AED', '💎', '["300 points per attendance", "Free plus-one to all events", "Lifetime membership status", "Custom achievement creation", "Wall of Fame recognition"]'::jsonb, 5)
) AS tier(name, level, min_events, point_multiplier, color, icon, benefits, sort_order)
WHERE lp.name = 'The Anchor VIP Club' AND NOT EXISTS (
  SELECT 1 FROM loyalty_tiers WHERE program_id = lp.id AND name = tier.name
);

-- Create function to calculate member tier based on lifetime events
CREATE OR REPLACE FUNCTION calculate_member_tier(p_lifetime_events INTEGER, p_program_id UUID)
RETURNS UUID AS $$
DECLARE
  v_tier_id UUID;
BEGIN
  SELECT id INTO v_tier_id
  FROM loyalty_tiers
  WHERE program_id = p_program_id
    AND min_events <= p_lifetime_events
  ORDER BY min_events DESC
  LIMIT 1;
  
  RETURN v_tier_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to update member tier
CREATE OR REPLACE FUNCTION update_member_tier(p_member_id UUID)
RETURNS VOID AS $$
DECLARE
  v_member RECORD;
  v_new_tier_id UUID;
BEGIN
  SELECT * INTO v_member FROM loyalty_members WHERE id = p_member_id;
  
  v_new_tier_id := calculate_member_tier(v_member.lifetime_events, v_member.program_id);
  
  IF v_new_tier_id IS DISTINCT FROM v_member.tier_id THEN
    UPDATE loyalty_members 
    SET tier_id = v_new_tier_id
    WHERE id = p_member_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to record check-in and award points
CREATE OR REPLACE FUNCTION process_event_check_in(
  p_event_id UUID,
  p_customer_id UUID,
  p_booking_id UUID DEFAULT NULL,
  p_check_in_method VARCHAR DEFAULT 'manual',
  p_staff_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_member RECORD;
  v_tier RECORD;
  v_check_in_id UUID;
  v_points_earned INTEGER;
  v_base_points INTEGER := 50;
  v_result JSONB;
BEGIN
  -- Get member details
  SELECT m.*, t.point_multiplier 
  INTO v_member
  FROM loyalty_members m
  LEFT JOIN loyalty_tiers t ON m.tier_id = t.id
  WHERE m.customer_id = p_customer_id AND m.status = 'active';
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Customer is not a loyalty member');
  END IF;
  
  -- Check if already checked in for this event
  IF EXISTS (
    SELECT 1 FROM event_check_ins 
    WHERE event_id = p_event_id AND customer_id = p_customer_id
  ) THEN
    RETURN jsonb_build_object('error', 'Customer already checked in for this event');
  END IF;
  
  -- Calculate points earned
  v_points_earned := COALESCE(v_base_points * v_member.point_multiplier, v_base_points);
  
  -- Create check-in record
  INSERT INTO event_check_ins (
    booking_id, event_id, customer_id, member_id, 
    check_in_method, points_earned, staff_id, notes
  )
  VALUES (
    p_booking_id, p_event_id, p_customer_id, v_member.id,
    p_check_in_method, v_points_earned, p_staff_id, p_notes
  )
  RETURNING id INTO v_check_in_id;
  
  -- Update member points and stats
  UPDATE loyalty_members
  SET 
    available_points = available_points + v_points_earned,
    total_points = total_points + v_points_earned,
    lifetime_points = lifetime_points + v_points_earned,
    lifetime_events = lifetime_events + 1,
    last_activity_date = CURRENT_DATE
  WHERE id = v_member.id;
  
  -- Record point transaction
  INSERT INTO loyalty_point_transactions (
    member_id, points, balance_after, transaction_type,
    description, reference_type, reference_id, created_by
  )
  VALUES (
    v_member.id, 
    v_points_earned, 
    v_member.available_points + v_points_earned,
    'earned',
    'Event check-in',
    'check_in',
    v_check_in_id,
    p_staff_id
  );
  
  -- Update member tier if needed
  PERFORM update_member_tier(v_member.id);
  
  -- Return success with details
  RETURN jsonb_build_object(
    'success', true,
    'check_in_id', v_check_in_id,
    'points_earned', v_points_earned,
    'new_balance', v_member.available_points + v_points_earned,
    'lifetime_events', v_member.lifetime_events + 1
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;