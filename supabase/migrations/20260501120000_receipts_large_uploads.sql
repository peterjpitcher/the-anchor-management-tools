-- Allow receipt files to be uploaded directly to Storage without hitting
-- Vercel's function payload limit. Keep bank statement imports capped in app
-- code, but allow larger receipt PDFs/images in the private receipts bucket.
UPDATE storage.buckets
SET
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
WHERE id = 'receipts';
