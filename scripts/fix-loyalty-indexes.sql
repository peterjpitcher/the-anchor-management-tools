-- Fix Loyalty Indexes - Handles existing indexes properly
-- This script safely creates only missing indexes

DO $$
DECLARE
    index_exists BOOLEAN;
BEGIN
    -- Check and create each index individually
    
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_loyalty_members_customer_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_loyalty_members_tier_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_event_check_ins_event_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_event_check_ins_customer_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_event_check_ins_member_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_event_check_ins_check_in_time';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_customer_achievements_member_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_reward_redemptions_member_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_reward_redemptions_code';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_reward_redemptions_status';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_loyalty_point_transactions_member_id';
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
    ELSE
        RAISE NOTICE 'Index already exists: idx_loyalty_point_transactions_created_at';
    END IF;

END $$;

-- Show final index count
SELECT COUNT(*) as loyalty_indexes_count
FROM pg_indexes 
WHERE schemaname = 'public'
AND (indexname LIKE 'idx_loyalty%' 
     OR indexname LIKE 'idx_event_check_ins%' 
     OR indexname LIKE 'idx_customer_achievements%'
     OR indexname LIKE 'idx_reward_redemptions%');