BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  TRUE,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_public_select'
  ) THEN
    CREATE POLICY "avatars_public_select"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'avatars');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_authenticated_upload_own'
  ) THEN
    CREATE POLICY "avatars_authenticated_upload_own"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'avatars'
      AND name ~ ('^avatars/' || auth.uid()::text || '\.(jpg|png|webp)$')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_authenticated_update_own'
  ) THEN
    CREATE POLICY "avatars_authenticated_update_own"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
      bucket_id = 'avatars'
      AND name ~ ('^avatars/' || auth.uid()::text || '\.(jpg|png|webp)$')
    )
    WITH CHECK (
      bucket_id = 'avatars'
      AND name ~ ('^avatars/' || auth.uid()::text || '\.(jpg|png|webp)$')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'avatars_authenticated_delete_own'
  ) THEN
    CREATE POLICY "avatars_authenticated_delete_own"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'avatars'
      AND name ~ ('^avatars/' || auth.uid()::text || '\.(jpg|png|webp)$')
    );
  END IF;
END $$;

COMMIT;
