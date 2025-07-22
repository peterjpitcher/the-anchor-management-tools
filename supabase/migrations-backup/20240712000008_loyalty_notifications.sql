-- Loyalty Notifications System
-- Tracks all loyalty-related notifications sent to members

-- Create loyalty notifications table
CREATE TABLE IF NOT EXISTS loyalty_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES loyalty_members(id) ON DELETE CASCADE,
  notification_type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'sms',
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  job_id VARCHAR(255), -- Reference to background job
  sent_at TIMESTAMPTZ,
  delivered BOOLEAN,
  failed BOOLEAN DEFAULT false,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create bulk notifications table
CREATE TABLE IF NOT EXISTS loyalty_bulk_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  filter_criteria JSONB DEFAULT '{}',
  scheduled_for TIMESTAMPTZ,
  job_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  sent_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Add notification tracking columns to loyalty_members
ALTER TABLE loyalty_members 
ADD COLUMN IF NOT EXISTS welcome_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_reward_notification TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS notification_preferences JSONB DEFAULT '{"sms": true, "email": true}';

-- Add automated notification settings to loyalty programs
UPDATE loyalty_programs 
SET settings = jsonb_set(
  COALESCE(settings, '{}'),
  '{automated_notifications}',
  '{
    "welcome_enabled": true,
    "tier_upgrade_enabled": true,
    "achievement_enabled": true,
    "points_earned_enabled": true,
    "reward_available_enabled": true,
    "challenge_update_enabled": true,
    "min_points_for_notification": 10,
    "quiet_hours_start": "21:00",
    "quiet_hours_end": "09:00"
  }'::jsonb
)
WHERE active = true;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_member_id ON loyalty_notifications(member_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_created_at ON loyalty_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_job_id ON loyalty_notifications(job_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_bulk_notifications_status ON loyalty_bulk_notifications(status);
CREATE INDEX IF NOT EXISTS idx_loyalty_bulk_notifications_scheduled ON loyalty_bulk_notifications(scheduled_for);

-- Enable RLS
ALTER TABLE loyalty_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_bulk_notifications ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
DROP POLICY IF EXISTS "Staff can view loyalty notifications" ON loyalty_notifications;
DROP POLICY IF EXISTS "Staff can manage loyalty notifications" ON loyalty_notifications;
CREATE POLICY "Staff can view loyalty notifications" ON loyalty_notifications
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage loyalty notifications" ON loyalty_notifications
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

DROP POLICY IF EXISTS "Staff can view bulk notifications" ON loyalty_bulk_notifications;
DROP POLICY IF EXISTS "Staff can manage bulk notifications" ON loyalty_bulk_notifications;
CREATE POLICY "Staff can view bulk notifications" ON loyalty_bulk_notifications
  FOR SELECT USING (user_has_permission(auth.uid(), 'loyalty', 'view'));
CREATE POLICY "Staff can manage bulk notifications" ON loyalty_bulk_notifications
  FOR ALL USING (user_has_permission(auth.uid(), 'loyalty', 'manage'));

-- Create function to update loyalty member stats after notification
CREATE OR REPLACE FUNCTION update_member_notification_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.channel = 'sms' AND NEW.delivered = true THEN
    UPDATE loyalty_members
    SET metadata = jsonb_set(
      COALESCE(metadata, '{}'),
      '{last_sms_sent}',
      to_jsonb(NEW.sent_at)
    )
    WHERE id = NEW.member_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for notification stats
DROP TRIGGER IF EXISTS update_member_notification_stats_trigger ON loyalty_notifications;
CREATE TRIGGER update_member_notification_stats_trigger
  AFTER INSERT OR UPDATE ON loyalty_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_member_notification_stats();