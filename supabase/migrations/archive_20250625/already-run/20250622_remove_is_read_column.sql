-- Remove is_read column if it exists (it might be a generated column causing issues)
ALTER TABLE public.messages 
DROP COLUMN IF EXISTS is_read CASCADE;