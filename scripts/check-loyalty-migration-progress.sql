-- Script to check which parts of the loyalty migration have already been applied
-- Run this in your Supabase SQL editor to see what exists

-- Check which loyalty tables exist
SELECT 'TABLES CREATED:' as section;
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'loyalty%' 
OR table_name IN ('event_check_ins', 'customer_achievements', 'reward_redemptions')
ORDER BY table_name;

-- Check which indexes exist
SELECT '---' as divider;
SELECT 'INDEXES CREATED:' as section;
SELECT indexname 
FROM pg_indexes 
WHERE schemaname = 'public' 
AND indexname LIKE '%loyalty%' 
OR indexname LIKE '%check_in%' 
OR indexname LIKE '%achievement%' 
OR indexname LIKE '%redemption%'
ORDER BY indexname;

-- Check if loyalty permissions exist
SELECT '---' as divider;
SELECT 'PERMISSIONS CREATED:' as section;
SELECT module_name, action 
FROM permissions 
WHERE module_name = 'loyalty'
ORDER BY action;

-- Check if functions exist
SELECT '---' as divider;
SELECT 'FUNCTIONS CREATED:' as section;
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND (routine_name LIKE '%tier%' OR routine_name LIKE '%points%')
ORDER BY routine_name;

-- Check if triggers exist
SELECT '---' as divider;
SELECT 'TRIGGERS CREATED:' as section;
SELECT trigger_name, event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public' 
AND trigger_name LIKE '%loyalty%' OR trigger_name LIKE '%tier%'
ORDER BY trigger_name;