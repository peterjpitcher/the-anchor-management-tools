-- Add email-on-upload flag for attachment categories
ALTER TABLE public.attachment_categories
  ADD COLUMN IF NOT EXISTS email_on_upload boolean NOT NULL DEFAULT false;

-- Align employee attachment validation with app limits (10MB) and TIFF support
CREATE OR REPLACE FUNCTION public.validate_employee_attachment_upload() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Check file size (10MB limit)
  IF NEW.metadata->>'size' IS NOT NULL AND (NEW.metadata->>'size')::bigint > 10485760 THEN
    RAISE EXCEPTION 'File size exceeds 10MB limit';
  END IF;

  -- Check file type (optional - add allowed mime types)
  IF NEW.metadata->>'mimetype' IS NOT NULL AND NEW.metadata->>'mimetype' NOT IN (
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
  ) THEN
    RAISE EXCEPTION 'File type not allowed. Supported types: PDF, images (JPG, PNG, GIF, WebP, TIFF), Word documents, Excel spreadsheets, text files, and ZIP archives.';
  END IF;

  RETURN NEW;
END;
$$;
