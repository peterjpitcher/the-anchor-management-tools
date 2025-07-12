-- Script to safely apply the loyalty program migration to production
-- Run this in your Supabase SQL editor

-- First, check if the tables already exist to avoid errors
DO $$
BEGIN
    -- Check if loyalty_programs table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'loyalty_programs') THEN
        RAISE NOTICE 'Creating loyalty tables...';
        
        -- Run the migration SQL here
        -- Copy the entire content of supabase/migrations/20240715000000_loyalty_program.sql
        -- and paste it below this line
        
    ELSE
        RAISE NOTICE 'Loyalty tables already exist, skipping migration.';
    END IF;
END $$;