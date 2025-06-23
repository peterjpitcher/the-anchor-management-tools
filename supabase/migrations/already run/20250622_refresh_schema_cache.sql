-- Force Supabase to refresh its schema cache by calling reload_schema_cache
-- This is necessary after dropping columns that might be cached

-- First, ensure is_read column is dropped if it exists
ALTER TABLE public.messages 
DROP COLUMN IF EXISTS is_read CASCADE;

-- Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';

-- Alternative method: Touch the table to force cache refresh
COMMENT ON TABLE public.messages IS 'Messages table for SMS communications - updated to remove is_read column';

-- Grant permissions again to ensure they're fresh
GRANT ALL ON public.messages TO authenticated;
GRANT ALL ON public.messages TO service_role;