-- Paid advertising is no longer part of event preparation. Keep the database
-- auto-close list aligned with the checklist shown in the application so the
-- retired task is not recreated for past events.
CREATE OR REPLACE FUNCTION public.auto_close_past_event_tasks()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO public.event_checklist_statuses (event_id, task_key, completed_at)
  SELECT e.id, t.key, NOW()
  FROM public.events e
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
    ('send_whatsapp_reminder')
  ) AS t(key)
  WHERE e.date < CURRENT_DATE
  ON CONFLICT (event_id, task_key) DO NOTHING;
$$;
