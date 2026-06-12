WITH moved AS (
  UPDATE public.recruitment_applications
  SET status = 'talent_pool',
      updated_at = now()
  WHERE job_posting_id IS NULL
    AND status = 'new'
  RETURNING id
)
INSERT INTO public.recruitment_application_status_events (
  application_id,
  from_status,
  to_status,
  changed_by,
  note,
  metadata
)
SELECT
  id,
  'new',
  'talent_pool',
  NULL,
  'Moved general talent-pool record out of new applications',
  '{"backfill":"general_applications_not_new"}'::jsonb
FROM moved;
