-- Expand allowed document types for employee right-to-work records.
-- The application supports specific document types beyond just List A/B.

ALTER TABLE IF EXISTS public.employee_right_to_work
  DROP CONSTRAINT IF EXISTS employee_right_to_work_document_type_check;

ALTER TABLE IF EXISTS public.employee_right_to_work
  ADD CONSTRAINT employee_right_to_work_document_type_check
  CHECK (
    document_type = ANY (
      ARRAY[
        'Passport'::text,
        'Biometric Residence Permit'::text,
        'Share Code'::text,
        'Other'::text,
        'List A'::text,
        'List B'::text
      ]
    )
  );

COMMENT ON COLUMN public.employee_right_to_work.document_type IS
  'Right to work document type (Passport, Biometric Residence Permit, Share Code, List A/B, Other).';

