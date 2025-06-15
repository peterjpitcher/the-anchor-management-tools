-- Storage bucket setup for employee attachments
-- Note: This migration requires manual execution or Supabase CLI/API

-- Create storage bucket for employee attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'employee-attachments',
  'employee-attachments',
  false,
  5242880, -- 5MB limit
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed'
  ]
) ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies for employee attachments
CREATE POLICY "Allow authenticated users to upload employee attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'employee-attachments');

CREATE POLICY "Allow authenticated users to view employee attachments"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'employee-attachments');

CREATE POLICY "Allow authenticated users to delete employee attachments"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'employee-attachments');

CREATE POLICY "Allow authenticated users to update employee attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'employee-attachments')
WITH CHECK (bucket_id = 'employee-attachments');

-- Add trigger for validating employee attachments on upload
CREATE OR REPLACE TRIGGER validate_employee_attachment_upload_trigger
BEFORE INSERT ON storage.objects
FOR EACH ROW
WHEN (NEW.bucket_id = 'employee-attachments')
EXECUTE FUNCTION public.validate_employee_attachment_upload();

-- Insert default attachment categories
INSERT INTO public.attachment_categories (category_name) VALUES
  ('Contract'),
  ('ID Documents'),
  ('Certificates'),
  ('Training Records'),
  ('Performance Reviews'),
  ('Disciplinary Records'),
  ('Medical Records'),
  ('Other')
ON CONFLICT (category_name) DO NOTHING;