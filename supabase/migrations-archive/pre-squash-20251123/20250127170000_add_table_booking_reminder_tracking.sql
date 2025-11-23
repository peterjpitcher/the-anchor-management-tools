-- Add reminder tracking to table bookings
-- This migration adds the missing reminder_sent column and creates a proper tracking system

-- Add reminder_sent column to table_bookings
ALTER TABLE table_bookings 
ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT FALSE;

-- Create index for efficient querying of bookings needing reminders
CREATE INDEX IF NOT EXISTS idx_table_bookings_reminder_status 
ON table_bookings (status, reminder_sent, booking_date) 
WHERE status = 'confirmed' AND reminder_sent = FALSE;

-- Create table to track reminder history (for better tracking)
CREATE TABLE IF NOT EXISTS table_booking_reminder_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
    reminder_type VARCHAR(50) NOT NULL, -- 'sms', 'email', 'both'
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) NOT NULL, -- 'sent', 'failed'
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for reminder history
CREATE INDEX IF NOT EXISTS idx_reminder_history_booking_id 
ON table_booking_reminder_history (booking_id);

-- Add RLS policies
ALTER TABLE table_booking_reminder_history ENABLE ROW LEVEL SECURITY;

-- Staff can view reminder history
CREATE POLICY "Staff can view reminder history" ON table_booking_reminder_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.name IN ('super_admin', 'manager', 'staff')
        )
    );

-- System can insert reminder history
CREATE POLICY "System can insert reminder history" ON table_booking_reminder_history
    FOR INSERT WITH CHECK (true);

-- Add comment to explain the column
COMMENT ON COLUMN table_bookings.reminder_sent IS 'Whether a reminder has been sent for this booking';
COMMENT ON TABLE table_booking_reminder_history IS 'History of reminders sent for table bookings';

-- Update any existing confirmed bookings that are in the past to have reminder_sent = true
-- This prevents sending reminders for old bookings
UPDATE table_bookings 
SET reminder_sent = TRUE 
WHERE status = 'confirmed' 
AND booking_date < CURRENT_DATE
AND reminder_sent IS NULL;