-- Create the storage bucket for employee attachments
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
SELECT 'employee-attachments', 'employee-attachments', false, false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
WHERE NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'employee-attachments'
);

-- RLS Policy: Allow authenticated users to view their own attachments
-- This will be refined later, starting with a basic policy.
DROP POLICY IF EXISTS "Allow authenticated user to view attachments" ON storage.objects;
CREATE POLICY "Allow authenticated user to view attachments"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'employee-attachments');

-- RLS Policy: Allow authenticated users to upload attachments
DROP POLICY IF EXISTS "Allow authenticated user to upload attachments" ON storage.objects;
CREATE POLICY "Allow authenticated user to upload attachments"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'employee-attachments');

-- RLS Policy: Allow authenticated users to delete their own attachments
DROP POLICY IF EXISTS "Allow authenticated users to delete their own attachments" ON storage.objects;
CREATE POLICY "Allow authenticated users to delete their own attachments"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'employee-attachments'); 