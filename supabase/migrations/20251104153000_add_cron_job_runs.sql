-- Guard table for cron executions to prevent duplicate reminder sends

CREATE TABLE IF NOT EXISTS cron_job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  run_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_job_runs_job_key
  ON cron_job_runs (job_name, run_key);

CREATE OR REPLACE FUNCTION cron_job_runs_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cron_job_runs_set_updated_at_trigger ON cron_job_runs;
CREATE TRIGGER cron_job_runs_set_updated_at_trigger
  BEFORE UPDATE ON cron_job_runs
  FOR EACH ROW
  EXECUTE FUNCTION cron_job_runs_set_updated_at();

ALTER TABLE cron_job_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages cron job runs"
  ON cron_job_runs
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
