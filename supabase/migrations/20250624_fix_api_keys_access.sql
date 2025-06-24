-- Fix API keys access for public API authentication
-- The api_keys table needs to be accessible by the anon role for API authentication

-- First, check if RLS is enabled
DO $$
BEGIN
    -- If RLS is enabled, we need to create a policy
    IF EXISTS (
        SELECT 1 
        FROM pg_tables 
        WHERE tablename = 'api_keys' 
        AND rowsecurity = true
    ) THEN
        -- Drop existing policies if any
        DROP POLICY IF EXISTS "Public can read active API keys" ON api_keys;
        DROP POLICY IF EXISTS "Service role can manage API keys" ON api_keys;
        
        -- Create a policy that allows reading active API keys
        -- This is safe because we only expose the hashed key, not the actual key
        CREATE POLICY "Public can read active API keys" ON api_keys
            FOR SELECT
            USING (is_active = true);
            
        -- Ensure service role can still manage API keys
        CREATE POLICY "Service role can manage API keys" ON api_keys
            FOR ALL
            USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Grant SELECT permission to anon role (if not already granted)
GRANT SELECT ON api_keys TO anon;

-- Also ensure authenticated role has access
GRANT SELECT ON api_keys TO authenticated;