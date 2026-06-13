BEGIN;

ALTER TABLE public.recruitment_job_postings
  ADD COLUMN IF NOT EXISTS application_closing_date date;

CREATE INDEX IF NOT EXISTS idx_recruitment_job_postings_public_closing_date
  ON public.recruitment_job_postings (status, is_public, application_closing_date, opened_at DESC);

DROP POLICY IF EXISTS "Public can view open recruitment postings" ON public.recruitment_job_postings;
CREATE POLICY "Public can view open recruitment postings"
  ON public.recruitment_job_postings
  FOR SELECT
  TO anon
  USING (
    status = 'open'
    AND is_public = true
    AND (
      application_closing_date IS NULL
      OR application_closing_date >= CURRENT_DATE
    )
  );

COMMIT;
