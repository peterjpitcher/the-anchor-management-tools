-- Complete Loyalty Migration Script
-- This script checks what exists and only creates what's missing

DO $$
BEGIN
    -- Create indexes only if they don't exist
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_loyalty_members_customer_id') THEN
        CREATE INDEX idx_loyalty_members_customer_id ON loyalty_members(customer_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_loyalty_members_tier_id') THEN
        CREATE INDEX idx_loyalty_members_tier_id ON loyalty_members(tier_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_event_check_ins_event_id') THEN
        CREATE INDEX idx_event_check_ins_event_id ON event_check_ins(event_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_event_check_ins_customer_id') THEN
        CREATE INDEX idx_event_check_ins_customer_id ON event_check_ins(customer_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_event_check_ins_member_id') THEN
        CREATE INDEX idx_event_check_ins_member_id ON event_check_ins(member_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_event_check_ins_check_in_time') THEN
        CREATE INDEX idx_event_check_ins_check_in_time ON event_check_ins(check_in_time);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_customer_achievements_member_id') THEN
        CREATE INDEX idx_customer_achievements_member_id ON customer_achievements(member_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reward_redemptions_member_id') THEN
        CREATE INDEX idx_reward_redemptions_member_id ON reward_redemptions(member_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reward_redemptions_code') THEN
        CREATE INDEX idx_reward_redemptions_code ON reward_redemptions(redemption_code);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reward_redemptions_status') THEN
        CREATE INDEX idx_reward_redemptions_status ON reward_redemptions(status);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_loyalty_point_transactions_member_id') THEN
        CREATE INDEX idx_loyalty_point_transactions_member_id ON loyalty_point_transactions(member_id);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_loyalty_point_transactions_created_at') THEN
        CREATE INDEX idx_loyalty_point_transactions_created_at ON loyalty_point_transactions(created_at);
    END IF;
END $$;

-- Enable Row Level Security (safe to run multiple times)
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

-- Create RLS policies (safe with DROP IF EXISTS)
DROP POLICY IF EXISTS "Members can view own loyalty data" ON loyalty_members;
CREATE POLICY "Members can view own loyalty data" ON loyalty_members
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

DROP POLICY IF EXISTS "Staff can view all loyalty data" ON loyalty_members;
CREATE POLICY "Staff can view all loyalty data" ON loyalty_members
  FOR SELECT USING (
    user_has_permission(auth.uid(), 'loyalty', 'view')
  );

DROP POLICY IF EXISTS "Staff can manage loyalty data" ON loyalty_members;
CREATE POLICY "Staff can manage loyalty data" ON loyalty_members
  FOR ALL USING (
    user_has_permission(auth.uid(), 'loyalty', 'manage')
  );

-- Create or replace functions (safe to run multiple times)
CREATE OR REPLACE FUNCTION check_tier_upgrade()
RETURNS TRIGGER AS $$
DECLARE
  current_tier RECORD;
  next_tier RECORD;
BEGIN
  SELECT * INTO current_tier 
  FROM loyalty_tiers 
  WHERE id = NEW.tier_id;
  
  SELECT * INTO next_tier
  FROM loyalty_tiers
  WHERE program_id = (SELECT program_id FROM loyalty_members WHERE id = NEW.id)
    AND level = current_tier.level + 1
    AND min_events <= NEW.lifetime_events;
  
  IF next_tier.id IS NOT NULL THEN
    UPDATE loyalty_members 
    SET tier_id = next_tier.id,
        updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (safe with DROP IF EXISTS)
DROP TRIGGER IF EXISTS loyalty_tier_upgrade_trigger ON loyalty_members;
CREATE TRIGGER loyalty_tier_upgrade_trigger
  AFTER UPDATE OF lifetime_events ON loyalty_members
  FOR EACH ROW
  WHEN (NEW.lifetime_events > OLD.lifetime_events)
  EXECUTE FUNCTION check_tier_upgrade();

-- Create points calculation function
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
  SELECT point_multiplier INTO tier_multiplier
  FROM loyalty_tiers
  WHERE id = p_tier_id;
  
  SELECT MAX(
    CASE 
      WHEN bonus_type = 'multiplier' THEN bonus_value
      ELSE 1.0
    END
  ) INTO campaign_bonus
  FROM loyalty_campaigns
  WHERE active = true
    AND CURRENT_DATE BETWEEN start_date AND end_date;
  
  final_points := ROUND(p_base_points * COALESCE(tier_multiplier, 1.0) * COALESCE(campaign_bonus, 1.0));
  
  RETURN final_points;
END;
$$ LANGUAGE plpgsql;

-- Insert default data (safe with ON CONFLICT)
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

-- Add loyalty permissions
INSERT INTO permissions (module_name, action) VALUES
  ('loyalty', 'view'),
  ('loyalty', 'manage'),
  ('loyalty', 'redeem'),
  ('loyalty', 'enroll')
ON CONFLICT (module_name, action) DO NOTHING;

-- Grant permissions to roles
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

-- Final status check
SELECT 'Migration complete!' as status;
SELECT COUNT(*) as tables_created FROM information_schema.tables 
WHERE table_name IN ('loyalty_programs', 'loyalty_tiers', 'loyalty_members', 'loyalty_rewards', 'event_check_ins');
SELECT COUNT(*) as indexes_created FROM pg_indexes 
WHERE indexname LIKE 'idx_loyalty%' OR indexname LIKE 'idx_%check_in%' OR indexname LIKE 'idx_%achievement%';
SELECT COUNT(*) as permissions_created FROM permissions WHERE module_name = 'loyalty';