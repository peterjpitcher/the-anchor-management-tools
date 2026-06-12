ALTER TABLE public.recruitment_candidates
  ADD COLUMN IF NOT EXISTS cv_sha256 text;

CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_active_phone_e164
  ON public.recruitment_candidates (phone_e164)
  WHERE phone_e164 IS NOT NULL AND anonymised_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_active_phone
  ON public.recruitment_candidates (phone)
  WHERE phone IS NOT NULL AND anonymised_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recruitment_candidates_active_cv_sha256
  ON public.recruitment_candidates (cv_sha256)
  WHERE cv_sha256 IS NOT NULL AND anonymised_at IS NULL;
