-- Allow manual/admin recruitment intake to create a candidate from a CV before
-- an email address is known or when no email exists in the CV.

BEGIN;

ALTER TABLE public.recruitment_candidates
  DROP CONSTRAINT IF EXISTS recruitment_candidates_email_required_active;

COMMIT;
