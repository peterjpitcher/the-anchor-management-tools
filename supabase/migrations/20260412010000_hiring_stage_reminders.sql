-- Default hiring stage reminder configuration

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'hiring_stage_reminders',
  '{"enabled": true, "recipients": ["manager@the-anchor.pub"], "cooldown_days": 7, "thresholds": {"new": 2, "screening": 2, "screened": 5, "interview_scheduled": 2, "interviewed": 5, "offer": 5}}'::jsonb,
  'Default reminder thresholds for hiring stages'
)
ON CONFLICT (key) DO NOTHING;
