-- Auto-close all checklist tasks for events whose date has passed.
-- Runs nightly via pg_cron so no open tasks accumulate on past events.

CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA extensions;

CREATE OR REPLACE FUNCTION auto_close_past_event_tasks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO event_checklist_statuses (event_id, task_key, completed_at)
  SELECT e.id, t.key, NOW()
  FROM events e
  CROSS JOIN (VALUES
    ('update_event_details'),
    ('write_event_brief'),
    ('publish_event_page'),
    ('create_short_link'),
    ('design_table_talkers'),
    ('design_bar_strut_cards'),
    ('design_poster'),
    ('create_facebook_event'),
    ('add_google_business_post'),
    ('schedule_social_content'),
    ('schedule_stories'),
    ('send_whatsapp_reminder')
  ) AS t(key)
  WHERE e.date < CURRENT_DATE
  ON CONFLICT (event_id, task_key) DO NOTHING;
$$;

-- Unschedule first in case this migration is re-applied (cron job may already exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-past-event-tasks') THEN
    PERFORM cron.unschedule('auto-close-past-event-tasks');
  END IF;
END $$;

-- Schedule to run every day at 01:00 UTC (catches events that ended the previous day)
SELECT cron.schedule(
  'auto-close-past-event-tasks',
  '0 1 * * *',
  'SELECT auto_close_past_event_tasks()'
);
