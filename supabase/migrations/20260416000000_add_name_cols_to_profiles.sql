-- Add first_name and last_name columns to public.profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS first_name text,
ADD COLUMN IF NOT EXISTS last_name text;

-- Backfill from auth.users metadata if available
-- effective only if the executing role has permissions on auth.users (usually true for migrations)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
    UPDATE public.profiles p
    SET
      first_name = NULLIF((u.raw_user_meta_data->>'first_name')::text, ''),
      last_name = NULLIF((u.raw_user_meta_data->>'last_name')::text, '')
    FROM auth.users u
    WHERE p.id = u.id
    AND (p.first_name IS NULL OR p.last_name IS NULL);
  END IF;
END $$;
