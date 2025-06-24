-- Check if RLS is enabled on api_keys table
SELECT 
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables 
WHERE tablename = 'api_keys';

-- Check what policies exist on api_keys table
SELECT 
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies 
WHERE tablename = 'api_keys';

-- Try to select from api_keys as the anon role would
SET ROLE anon;
SELECT * FROM api_keys WHERE key_hash = '33d30abf849cac33c3537d83fae428d1a38b6c2fb41dea79fb8d4fc872ff64a5';
RESET ROLE;

-- Check if we need to grant permissions
SELECT 
    grantee,
    table_schema,
    table_name,
    privilege_type
FROM information_schema.table_privileges
WHERE table_name = 'api_keys'
ORDER BY grantee;