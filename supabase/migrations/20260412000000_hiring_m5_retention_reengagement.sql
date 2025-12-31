-- Hiring M5 retention + re-engagement schema

ALTER TABLE public.hiring_candidates
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS retention_exempt boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.hiring_outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.hiring_jobs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.hiring_candidates(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'email',
  direction text NOT NULL DEFAULT 'outbound',
  status text NOT NULL DEFAULT 'draft',
  subject text,
  body text,
  template_key text,
  sent_via text,
  sent_at timestamptz,
  sent_by uuid REFERENCES auth.users(id),
  external_reference text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hiring_outreach_messages_direction_check
    CHECK (direction IN ('outbound', 'inbound')),
  CONSTRAINT hiring_outreach_messages_status_check
    CHECK (status IN ('draft', 'sent', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_hiring_outreach_messages_job
  ON public.hiring_outreach_messages (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hiring_outreach_messages_candidate
  ON public.hiring_outreach_messages (candidate_id, created_at DESC);

ALTER TABLE public.hiring_outreach_messages ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_hiring_outreach_messages_updated_at ON public.hiring_outreach_messages;
CREATE TRIGGER trg_hiring_outreach_messages_updated_at
  BEFORE UPDATE ON public.hiring_outreach_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP POLICY IF EXISTS "Hiring outreach messages read" ON public.hiring_outreach_messages;
DROP POLICY IF EXISTS "Hiring outreach messages create" ON public.hiring_outreach_messages;
DROP POLICY IF EXISTS "Hiring outreach messages update" ON public.hiring_outreach_messages;
DROP POLICY IF EXISTS "Hiring outreach messages delete" ON public.hiring_outreach_messages;

CREATE POLICY "Hiring outreach messages read" ON public.hiring_outreach_messages
  FOR SELECT TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'view')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring outreach messages create" ON public.hiring_outreach_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring outreach messages update" ON public.hiring_outreach_messages
  FOR UPDATE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

CREATE POLICY "Hiring outreach messages delete" ON public.hiring_outreach_messages
  FOR DELETE TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'hiring', 'send')
    OR public.user_has_permission(auth.uid(), 'hiring', 'manage')
  );

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'hiring_retention_policy',
  '{"retention_days": 730, "action": "anonymize"}'::jsonb,
  'Default retention policy for hiring records'
)
ON CONFLICT (key) DO NOTHING;
