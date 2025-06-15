-- Fix storage bucket policies to be more restrictive
-- This migration updates the overly permissive policies from the previous migration

-- First, drop the existing policies
DROP POLICY IF EXISTS "Authenticated users can view employee attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload employee attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete employee attachments" ON storage.objects;

-- Create more secure policies that check ownership through the employee_attachments table

-- Policy for viewing attachments
-- Users can only view attachments that have a corresponding record in employee_attachments table
CREATE POLICY "Users can view employee attachments with valid record"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'employee-attachments' 
  AND EXISTS (
    SELECT 1 
    FROM employee_attachments ea
    WHERE ea.storage_path = objects.name
  )
);

-- Policy for uploading attachments
-- Users can upload, but the path must follow a specific pattern
-- Format: employee_id/timestamp_filename
CREATE POLICY "Users can upload employee attachments with proper path"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'employee-attachments'
  AND (storage.foldername(name))[1] IS NOT NULL -- Must have employee_id folder
  AND LENGTH((storage.foldername(name))[1]) = 36 -- UUID length
  AND (storage.filename(name) ~ '^\d{13}_.*') -- Filename must start with timestamp
);

-- Policy for deleting attachments
-- Users can only delete attachments that have a corresponding record they can access
CREATE POLICY "Users can delete employee attachments with valid record"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'employee-attachments'
  AND EXISTS (
    SELECT 1 
    FROM employee_attachments ea
    WHERE ea.storage_path = objects.name
  )
);

-- Add a function to validate file uploads
CREATE OR REPLACE FUNCTION validate_employee_attachment_upload()
RETURNS trigger AS $$
BEGIN
  -- Check file size (5MB limit)
  IF NEW.metadata->>'size' IS NOT NULL AND (NEW.metadata->>'size')::bigint > 5242880 THEN
    RAISE EXCEPTION 'File size exceeds 5MB limit';
  END IF;
  
  -- Check file type (optional - add allowed mime types)
  IF NEW.metadata->>'mimetype' IS NOT NULL AND NEW.metadata->>'mimetype' NOT IN (
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
  ) THEN
    RAISE EXCEPTION 'File type not allowed. Supported types: PDF, images (JPG, PNG, GIF, WebP), Word documents, Excel spreadsheets, text files, and ZIP archives.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for upload validation (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'validate_employee_attachment_upload_trigger'
  ) THEN
    CREATE TRIGGER validate_employee_attachment_upload_trigger
    BEFORE INSERT ON storage.objects
    FOR EACH ROW
    WHEN (NEW.bucket_id = 'employee-attachments')
    EXECUTE FUNCTION validate_employee_attachment_upload();
  END IF;
END $$;