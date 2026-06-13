-- Keep recruitment candidates/applications deduped by email or phone.

ALTER TABLE public.recruitment_candidates
  ADD COLUMN IF NOT EXISTS phone_normalized text
  GENERATED ALWAYS AS (
    NULLIF(regexp_replace(COALESCE(phone_e164, phone, ''), '[^0-9]', '', 'g'), '')
  ) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitment_candidates_active_phone_normalized_unique
  ON public.recruitment_candidates (phone_normalized)
  WHERE phone_normalized IS NOT NULL AND anonymised_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_recruitment_applications_primary_candidate_posting
  ON public.recruitment_applications (candidate_id, job_posting_id)
  WHERE job_posting_id IS NOT NULL AND duplicate_of_application_id IS NULL;

WITH changed AS (
  UPDATE public.recruitment_applications
  SET
    status = 'declined_duplicate',
    updated_at = now()
  WHERE duplicate_of_application_id IS NOT NULL
    AND status <> 'declined_duplicate'
  RETURNING id, status
)
INSERT INTO public.recruitment_application_status_events (
  application_id,
  to_status,
  note,
  metadata
)
SELECT
  id,
  'declined_duplicate',
  'Duplicate application deduped',
  jsonb_build_object('dedupe_migration', '20260708000006_recruitment_duplicate_guards')
FROM changed;
