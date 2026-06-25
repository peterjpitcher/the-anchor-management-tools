BEGIN;

DROP POLICY IF EXISTS "avatars_authenticated_delete_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_authenticated_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_authenticated_upload_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_public_select" ON storage.objects;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE bucket_id = 'avatars'
  ) THEN
    DELETE FROM storage.buckets
    WHERE id = 'avatars';
  END IF;
END $$;

COMMIT;
