-- Fix references and conflicts in loyalty system
-- This migration ensures all tables exist and references are correct

-- First, ensure we have the users table reference correct
-- The baseline migration should have created profiles, not users
-- So we need to check what exists

-- Fix the event_check_ins table to use auth.users instead of users
DO $$
BEGIN
  -- Check if event_check_ins exists and has the wrong reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'event_check_ins' 
    AND column_name = 'staff_id'
  ) THEN
    -- Drop the existing constraint if it exists
    ALTER TABLE event_check_ins 
    DROP CONSTRAINT IF EXISTS event_check_ins_staff_id_fkey;
    
    -- Add the correct constraint
    ALTER TABLE event_check_ins 
    ADD CONSTRAINT event_check_ins_staff_id_fkey 
    FOREIGN KEY (staff_id) REFERENCES auth.users(id);
  END IF;
END $$;

-- Fix the loyalty_point_transactions table to use auth.users instead of users
DO $$
BEGIN
  -- Check if loyalty_point_transactions exists and has the wrong reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_point_transactions' 
    AND column_name = 'created_by'
  ) THEN
    -- Drop the existing constraint if it exists
    ALTER TABLE loyalty_point_transactions 
    DROP CONSTRAINT IF EXISTS loyalty_point_transactions_created_by_fkey;
    
    -- Add the correct constraint
    ALTER TABLE loyalty_point_transactions 
    ADD CONSTRAINT loyalty_point_transactions_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES auth.users(id);
  END IF;
END $$;

-- Fix the reward_redemptions table to use auth.users instead of users
DO $$
BEGIN
  -- Check if reward_redemptions exists and has the wrong reference
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'reward_redemptions' 
    AND column_name = 'fulfilled_by'
  ) THEN
    -- Drop the existing constraint if it exists
    ALTER TABLE reward_redemptions 
    DROP CONSTRAINT IF EXISTS reward_redemptions_fulfilled_by_fkey;
    
    -- Add the correct constraint
    ALTER TABLE reward_redemptions 
    ADD CONSTRAINT reward_redemptions_fulfilled_by_fkey 
    FOREIGN KEY (fulfilled_by) REFERENCES auth.users(id);
  END IF;
END $$;

-- Add any missing columns to loyalty_members that differ between migrations
DO $$
BEGIN
  -- Add last_visit_date if it doesn't exist (from first migration)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' 
    AND column_name = 'last_visit_date'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN last_visit_date DATE;
  END IF;
  
  -- Add metadata if it doesn't exist (from first migration)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' 
    AND column_name = 'metadata'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
  
  -- Add last_activity_date if it doesn't exist (from second migration)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'loyalty_members' 
    AND column_name = 'last_activity_date'
  ) THEN
    ALTER TABLE loyalty_members ADD COLUMN last_activity_date DATE;
  END IF;
END $$;

-- Ensure unique constraints exist
DO $$
BEGIN
  -- Add unique constraint on loyalty_members(customer_id, program_id) if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'loyalty_members' 
    AND constraint_type = 'UNIQUE'
    AND constraint_name = 'loyalty_members_customer_id_program_id_key'
  ) THEN
    ALTER TABLE loyalty_members 
    ADD CONSTRAINT loyalty_members_customer_id_program_id_key 
    UNIQUE(customer_id, program_id);
  END IF;
  
  -- Add unique constraint on event_check_ins(event_id, customer_id) if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'event_check_ins' 
    AND constraint_type = 'UNIQUE'
    AND constraint_name = 'event_check_ins_event_id_customer_id_key'
  ) THEN
    ALTER TABLE event_check_ins 
    ADD CONSTRAINT event_check_ins_event_id_customer_id_key 
    UNIQUE(event_id, customer_id);
  END IF;
END $$;

-- Add comment to track migration status
COMMENT ON SCHEMA public IS 'Loyalty system tables reconciled and references fixed';