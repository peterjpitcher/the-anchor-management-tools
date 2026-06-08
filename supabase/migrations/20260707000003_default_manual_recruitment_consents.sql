-- Manual management-created recruitment candidates are assumed to have
-- recruitment SMS and future-role consent unless a manager explicitly opts out.

BEGIN;

UPDATE public.recruitment_candidates
SET
  sms_consent = TRUE,
  sms_consent_at = COALESCE(sms_consent_at, consent_at, created_at),
  future_recruitment_consent = TRUE,
  future_recruitment_consent_at = COALESCE(future_recruitment_consent_at, consent_at, created_at),
  updated_at = now()
WHERE source = 'manual_upload'
  AND anonymised_at IS NULL
  AND (
    sms_consent IS DISTINCT FROM TRUE
    OR future_recruitment_consent IS DISTINCT FROM TRUE
  );

COMMIT;
