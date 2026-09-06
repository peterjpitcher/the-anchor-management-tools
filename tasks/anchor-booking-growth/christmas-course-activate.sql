-- Proposed only. Apply after the paired deployments and approved migration pass verification.
-- Verified starting state: this key did not exist in tfcasgxopxegwrabvwat on 5 September 2026.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.system_settings WHERE key='christmas_course_policy_enabled') THEN
    RAISE EXCEPTION 'Christmas course setting changed since review. Re-read and approve its current state.';
  END IF;
  INSERT INTO public.system_settings(key, value, description)
  VALUES ('christmas_course_policy_enabled', '{"value": true}'::jsonb,
    'Enable per-guest Christmas course selection after the compatible booking and staff amendment deployments.');
END;
$$;
