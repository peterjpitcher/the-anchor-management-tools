-- Drop unused tables that have no corresponding UI functionality

-- Drop messages table and its related objects
DO $$ 
BEGIN
    -- First, check if the table exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'messages'
    ) THEN
        -- Remove from realtime publication if it's included
        IF EXISTS (
            SELECT 1 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
            AND schemaname = 'public' 
            AND tablename = 'messages'
        ) THEN
            ALTER PUBLICATION supabase_realtime DROP TABLE public.messages;
        END IF;
        
        -- Drop any triggers
        DROP TRIGGER IF EXISTS update_messages_updated_at ON public.messages;
        
        -- Drop the table (this will also drop indexes and constraints)
        DROP TABLE public.messages CASCADE;
        
        RAISE NOTICE 'Dropped messages table and related objects';
    END IF;
END $$;

-- Drop the unused update_messages_updated_at function if it exists
DROP FUNCTION IF EXISTS public.update_messages_updated_at() CASCADE;

-- Note: We're keeping the profiles table because it's required by Supabase Auth
-- Even though we don't have UI for it, it's used for user authentication
-- and the handle_new_user trigger depends on it

-- However, let's add a comment to clarify its purpose
COMMENT ON TABLE public.profiles IS 'Required by Supabase Auth. Stores basic user profile data. No UI currently implemented but kept for authentication purposes.';