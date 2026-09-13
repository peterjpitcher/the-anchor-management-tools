-- hiring-docs has 268 objects (likely CVs/employment docs) but is public; no app code references it.
-- Flip private so direct URL access requires authentication / signed URLs.
UPDATE storage.buckets SET public = false WHERE id = 'hiring-docs';