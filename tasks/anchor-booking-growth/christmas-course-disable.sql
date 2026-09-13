-- Proposed non-destructive rollback. Retains snapshots and restores the original disabled behaviour.
DO $$
BEGIN
  UPDATE public.system_settings
  SET value='{"value": false}'::jsonb, updated_at=now()
  WHERE key='christmas_course_policy_enabled' AND value='{"value": true}'::jsonb;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Christmas course setting is not in the reviewed enabled state. Re-read before changing it.';
  END IF;
END;
$$;
