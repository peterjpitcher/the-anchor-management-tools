-- Add expired job status, in_conversation stage, and interview questions fields

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'hiring_job_status'
      AND e.enumlabel = 'expired'
  ) THEN
    ALTER TYPE public.hiring_job_status ADD VALUE 'expired';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'hiring_application_stage'
      AND e.enumlabel = 'in_conversation'
  ) THEN
    ALTER TYPE public.hiring_application_stage ADD VALUE 'in_conversation';
  END IF;
END $$;

ALTER TABLE public.hiring_job_templates
  ADD COLUMN IF NOT EXISTS interview_questions jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.hiring_jobs
  ADD COLUMN IF NOT EXISTS interview_questions jsonb NOT NULL DEFAULT '[]'::jsonb;
