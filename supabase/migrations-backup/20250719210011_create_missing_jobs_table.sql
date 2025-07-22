-- Description: Create the missing jobs table that the code expects
-- This is CRITICAL - code is referencing this table but it doesn't exist!

-- Create the jobs table only if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'jobs'
  ) THEN
    CREATE TABLE jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(50) NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      scheduled_for TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      error_message TEXT,
      result JSONB,
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    -- Enable RLS
    ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
    
    -- Only service role can access jobs
    CREATE POLICY "Service role manages jobs" ON jobs
      FOR ALL USING (auth.role() = 'service_role');
      
    RAISE NOTICE 'Created jobs table';
  ELSE
    RAISE NOTICE 'Jobs table already exists';
  END IF;
END $$;

-- Add essential indexes for performance (idempotent)
CREATE INDEX IF NOT EXISTS idx_jobs_status_scheduled ON jobs(status, scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_priority_scheduled ON jobs(priority DESC, scheduled_for) WHERE status = 'pending';

-- Add update trigger if function exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    -- Check if trigger already exists
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'update_jobs_updated_at'
    ) THEN
      CREATE TRIGGER update_jobs_updated_at
        BEFORE UPDATE ON jobs
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
  END IF;
END $$;

-- Add comment for documentation
COMMENT ON TABLE jobs IS 'Unified job queue table for all background processing';
COMMENT ON COLUMN jobs.type IS 'Job type identifier (e.g., send_sms, process_booking, generate_report)';
COMMENT ON COLUMN jobs.payload IS 'Job data as JSONB';
COMMENT ON COLUMN jobs.status IS 'Current job status';
COMMENT ON COLUMN jobs.priority IS 'Job priority (higher number = higher priority)';
COMMENT ON COLUMN jobs.result IS 'Job execution result data';