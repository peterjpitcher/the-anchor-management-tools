-- Add leasing metadata to jobs and provide atomic claim RPC.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS processing_token uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_jobs_processing_lease
  ON public.jobs (lease_expires_at)
  WHERE status = 'processing';

CREATE OR REPLACE FUNCTION public.claim_jobs(
  batch_size integer,
  job_types text[] DEFAULT NULL,
  lease_seconds integer DEFAULT NULL
)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lease_interval interval;
BEGIN
  IF batch_size IS NULL OR batch_size <= 0 THEN
    RETURN;
  END IF;

  lease_interval := make_interval(secs => COALESCE(lease_seconds, 120));

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.jobs
    WHERE status = 'pending'
      AND scheduled_for <= NOW()
      AND (job_types IS NULL OR type = ANY(job_types))
      AND COALESCE(attempts, 0) < COALESCE(max_attempts, 3)
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT batch_size
  )
  UPDATE public.jobs AS j
  SET status = 'processing',
      started_at = NOW(),
      processing_token = gen_random_uuid(),
      lease_expires_at = NOW() + lease_interval,
      last_heartbeat_at = NOW(),
      attempts = COALESCE(j.attempts, 0) + 1,
      updated_at = NOW()
  FROM candidates
  WHERE j.id = candidates.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jobs(integer, text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_jobs(integer, text[], integer) TO service_role;
