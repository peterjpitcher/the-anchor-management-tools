-- Script to clean up a partially applied loyalty migration
-- ⚠️ WARNING: This will DELETE all loyalty-related tables and data!
-- Only run this if you want to start fresh with the loyalty program

-- First, check what will be deleted
SELECT 'This script will delete the following tables:' as warning;
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND (
    table_name LIKE 'loyalty%' 
    OR table_name IN ('event_check_ins', 'customer_achievements', 'reward_redemptions')
);

-- Uncomment the lines below to actually perform the cleanup
-- Make sure you understand what will be deleted first!

/*
-- Drop tables in correct order (respecting foreign key constraints)
DROP TABLE IF EXISTS loyalty_campaigns CASCADE;
DROP TABLE IF EXISTS loyalty_point_transactions CASCADE;
DROP TABLE IF EXISTS reward_redemptions CASCADE;
DROP TABLE IF EXISTS loyalty_rewards CASCADE;
DROP TABLE IF EXISTS customer_achievements CASCADE;
DROP TABLE IF EXISTS loyalty_achievements CASCADE;
DROP TABLE IF EXISTS event_check_ins CASCADE;
DROP TABLE IF EXISTS loyalty_members CASCADE;
DROP TABLE IF EXISTS loyalty_tiers CASCADE;
DROP TABLE IF EXISTS loyalty_programs CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS check_tier_upgrade() CASCADE;
DROP FUNCTION IF EXISTS calculate_event_points(INTEGER, UUID, UUID, UUID) CASCADE;

-- Remove loyalty permissions
DELETE FROM role_permissions 
WHERE permission_id IN (
    SELECT id FROM permissions WHERE module_name = 'loyalty'
);

DELETE FROM permissions WHERE module_name = 'loyalty';

-- Confirmation
SELECT 'Cleanup complete. You can now run the migration fresh.' as status;
*/