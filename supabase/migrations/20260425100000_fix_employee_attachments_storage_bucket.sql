-- Fix employee-attachments storage bucket configuration.
-- The bucket was created manually without proper allowed_mime_types or file_size_limit,
-- causing P0001 errors when uploading files (e.g. P60 documents).
-- This migration ensures the bucket exists with correct settings and binds
-- the validation trigger that was defined but never attached.

-- 1. Upsert the storage bucket with correct settings
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-attachments',
  'employee-attachments',
  FALSE,
  10485760, -- 10MB
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/tiff',
    'image/tif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Drop and re-create the custom validation trigger on storage.objects.
--    The validate_employee_attachment_upload() function was defined in the squashed
--    migration but never bound to a trigger. Now that bucket-level constraints
--    handle validation via allowed_mime_types, this custom trigger is redundant
--    and could conflict. Remove any manual binding if it exists.
-- NOTE: The actual trigger name has a _trigger suffix. This statement used the
-- wrong name and silently did nothing. Fixed in 20260425200000.
DROP TRIGGER IF EXISTS validate_employee_attachment_upload ON storage.objects;

-- 3. Storage RLS policies — signed-URL uploads bypass RLS, but these policies
--    allow the admin client (service_role) and authenticated users to manage
--    objects in this bucket for download/delete operations.
DO $$
BEGIN
  -- INSERT policy for authenticated users
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload employee attachments'
  ) THEN
    CREATE POLICY "Authenticated users can upload employee attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'employee-attachments');
  END IF;

  -- SELECT policy for authenticated users
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can view employee attachments'
  ) THEN
    CREATE POLICY "Authenticated users can view employee attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'employee-attachments');
  END IF;

  -- DELETE policy for authenticated users
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Authenticated users can delete employee attachments'
  ) THEN
    CREATE POLICY "Authenticated users can delete employee attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'employee-attachments');
  END IF;
END $$;
