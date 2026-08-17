-- Keep the past-event auto-close task list in sync with the event checklist.
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
    ('schedule_event_email'),
    ('schedule_stories'),
    ('setup_paid_advertising'),
    ('send_whatsapp_reminder')
  ) AS t(key)
  WHERE e.date < CURRENT_DATE
  ON CONFLICT (event_id, task_key) DO NOTHING;
$$;
