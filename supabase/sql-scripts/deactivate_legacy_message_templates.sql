-- Deactivate legacy reminder templates to reduce confusion
-- Dry-run by default; set v_dry_run := FALSE to apply

DO $$
DECLARE
  v_dry_run boolean := TRUE;
  n_event_templates integer := 0;
  n_global_templates integer := 0;
  has_event_updated boolean := FALSE;
  has_global_updated boolean := FALSE;
BEGIN
  -- Counts
  SELECT COUNT(*) INTO n_event_templates
  FROM event_message_templates
  WHERE is_active = TRUE AND template_type IN (
    'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
  );

  SELECT COUNT(*) INTO n_global_templates
  FROM message_templates
  WHERE is_active = TRUE AND template_type IN (
    'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
  );

  RAISE NOTICE 'Active legacy event templates: %; global templates: %', n_event_templates, n_global_templates;

  -- Check if updated_at columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'event_message_templates' AND column_name = 'updated_at'
  ) INTO has_event_updated;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'message_templates' AND column_name = 'updated_at'
  ) INTO has_global_updated;

  IF NOT v_dry_run THEN
    IF has_event_updated THEN
      UPDATE event_message_templates
      SET is_active = FALSE, updated_at = now()
      WHERE is_active = TRUE AND template_type IN (
        'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
      );
    ELSE
      UPDATE event_message_templates
      SET is_active = FALSE
      WHERE is_active = TRUE AND template_type IN (
        'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
      );
    END IF;

    IF has_global_updated THEN
      UPDATE message_templates
      SET is_active = FALSE, updated_at = now()
      WHERE is_active = TRUE AND template_type IN (
        'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
      );
    ELSE
      UPDATE message_templates
      SET is_active = FALSE
      WHERE is_active = TRUE AND template_type IN (
        'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
      );
    END IF;
  END IF;
END $$;

-- Show active legacy templates (should be 0 after apply)
SELECT 'event_message_templates' AS table_name, template_type, COUNT(*) AS active_count
FROM event_message_templates
WHERE is_active = TRUE AND template_type IN (
  'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
)
GROUP BY 1, 2
UNION ALL
SELECT 'message_templates' AS table_name, template_type, COUNT(*) AS active_count
FROM message_templates
WHERE is_active = TRUE AND template_type IN (
  'reminder_24_hour','reminder_7_day','booking_reminder_24_hour','booking_reminder_7_day'
)
GROUP BY 1, 2
ORDER BY table_name, template_type;
