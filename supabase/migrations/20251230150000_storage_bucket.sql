
-- Create storage bucket for hiring documents (CVs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hiring-docs', 
  'hiring-docs', 
  true, -- Needs to be public for now for easier download/parsing URL generation, or private with signed URLs
  10485760, -- 10mb limit
  ARRAY['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for Storage
-- Grant access to authenticated users (Staff) to upload and read
CREATE POLICY "Authenticated users can upload CVs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'hiring-docs' );

CREATE POLICY "Authenticated users can select CVs"
ON storage.objects FOR SELECT
TO authenticated
USING ( bucket_id = 'hiring-docs' );

CREATE POLICY "Authenticated users can update CVs"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'hiring-docs' );

CREATE POLICY "Authenticated users can delete CVs"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'hiring-docs' );

-- Optionally allow public uploads if we want public application form to upload directly to supersupabase
-- But for now, we use server actions (authenticated context usually?)
-- Wait, public application form is unauthenticated.
-- So we might need public INSERT access if the client uploads directly.
-- But currently, uploadCandidateCVAction is a Server Action which runs on server.
-- Does it run as 'authenticated' (if user is logged in) or SERVICE_ROLE? 
-- createAdminClient() uses service role, so it bypasses RLS.
-- But standard client side upload would need RLS.
-- `uploadCandidateCVAction` uses `createAdminClient`, so RLS is bypassed for the INSERT.
-- BUT `getPublicUrl` requires the bucket to be public for the URL to work without signing.
-- If we want signed URLs, we keep it private. 
-- The code uses `getPublicUrl`. So bucket must be public.
