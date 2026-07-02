-- Review funnel: private feedback captured from the "No" path of the review landing page.
-- Public, no-auth submissions are written via the service-role (admin) client; RLS is enabled
-- with NO anon policies so the anon key can neither read nor write this PII-bearing table.
-- Staff reads happen through permission-gated server actions using the admin client.
--
-- Additive / non-destructive. Companion feature: tasks/review-landing-page-spec.md (§5).

CREATE TABLE IF NOT EXISTS public.review_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),   -- stars required
  comments text,
  customer_name text,
  customer_email text,
  customer_phone text,                                       -- E.164 via formatPhoneForStorage()
  contact_consent boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'review-funnel',
  submitted_ip text,
  user_agent text,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_progress','resolved','dismissed')),
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  staff_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- if no consent, no contact details may be stored (defence-in-depth alongside API stripping)
  CONSTRAINT review_feedback_consent_contact_check CHECK (
    contact_consent = true
    OR (customer_name IS NULL AND customer_email IS NULL AND customer_phone IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS review_feedback_created_at_idx ON public.review_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS review_feedback_status_idx ON public.review_feedback (status);

-- updated_at maintenance (reuse existing convention: public.update_updated_at_column()).
DROP TRIGGER IF EXISTS review_feedback_set_updated_at ON public.review_feedback;
CREATE TRIGGER review_feedback_set_updated_at
  BEFORE UPDATE ON public.review_feedback
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS on, no anon policies: anon key is fully denied; service-role client bypasses RLS for all access.
ALTER TABLE public.review_feedback ENABLE ROW LEVEL SECURITY;
