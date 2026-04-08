-- Fix: Drop the employee attachment validation trigger from storage.objects.
--
-- Root cause: The trigger was named 'validate_employee_attachment_upload_trigger'
-- but the previous migration attempted to drop 'validate_employee_attachment_upload'
-- (without the _trigger suffix), so the DROP silently did nothing.
--
-- This trigger fires on ALL storage.objects inserts (every bucket, not just
-- employee-attachments) and raises P0001 when file metadata doesn't match its
-- allowlist. Bucket-level allowed_mime_types and file_size_limit now handle
-- this validation correctly, so the trigger is redundant and harmful.

DROP TRIGGER IF EXISTS validate_employee_attachment_upload_trigger ON storage.objects;
