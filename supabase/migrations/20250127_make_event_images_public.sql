-- Make event-images bucket public so images can be accessed without authentication
-- This is needed for public website API access

-- Update the bucket to be public
UPDATE storage.buckets 
SET public = true 
WHERE id = 'event-images';

-- Note: The existing RLS policies will still control who can upload/delete images
-- But anyone will be able to view images via public URLs