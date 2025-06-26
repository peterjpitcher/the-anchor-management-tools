-- Create background jobs table
CREATE TABLE IF NOT EXISTS background_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  result JSONB,
  duration_ms INTEGER
);

-- Indexes for efficient job processing
CREATE INDEX idx_background_jobs_status_scheduled ON background_jobs(status, scheduled_for) 
  WHERE status = 'pending';
CREATE INDEX idx_background_jobs_priority ON background_jobs(priority DESC, created_at ASC) 
  WHERE status = 'pending';
CREATE INDEX idx_background_jobs_type ON background_jobs(type);
CREATE INDEX idx_background_jobs_created_at ON background_jobs(created_at);

-- RLS policies
ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;

-- Only service role can access background jobs
CREATE POLICY "Service role can manage jobs" ON background_jobs
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Function to cleanup old completed/failed jobs
CREATE OR REPLACE FUNCTION cleanup_old_jobs()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM background_jobs
  WHERE (status = 'completed' AND completed_at < NOW() - INTERVAL '7 days')
     OR (status = 'failed' AND created_at < NOW() - INTERVAL '30 days');
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comment on table and columns
COMMENT ON TABLE background_jobs IS 'Queue for background job processing';
COMMENT ON COLUMN background_jobs.type IS 'Job type identifier';
COMMENT ON COLUMN background_jobs.payload IS 'Job-specific data';
COMMENT ON COLUMN background_jobs.status IS 'Current job status';
COMMENT ON COLUMN background_jobs.priority IS 'Higher number = higher priority';
COMMENT ON COLUMN background_jobs.attempts IS 'Number of processing attempts';
COMMENT ON COLUMN background_jobs.scheduled_for IS 'When the job should be processed';
COMMENT ON COLUMN background_jobs.duration_ms IS 'How long the job took to process';