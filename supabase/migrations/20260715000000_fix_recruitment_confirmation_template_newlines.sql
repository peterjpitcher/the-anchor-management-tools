-- Fix recruitment confirmation/reminder templates that were seeded with the
-- two-character sequence backslash+n (a standard SQL string literal) instead of
-- real newlines. The earlier "warmer templates" migration
-- (20260708000004_warmer_recruitment_email_templates.sql) corrected the invite,
-- rejection and offer templates with E'...' escape strings but skipped
-- interview_confirmation, trial_confirmation and reminder, so those still render
-- with literal "\n" and break the signature de-duplication logic (which keys off
-- real newlines), producing a duplicated sign-off.
--
-- Only rows that still have NO real newline are updated, so any properly formatted
-- or manually customised template is left untouched. Idempotent.

BEGIN;

UPDATE public.recruitment_email_templates AS template
SET
  body = draft.body,
  updated_at = now()
FROM (
  VALUES
    (
      'interview_confirmation',
      E'Hi {{first_name}},\n\nYour interview is confirmed for {{appointment_time}} at The Anchor.\n\nPlease bring proof of your right to work in the UK.\n\nBest,\nThe Anchor'
    ),
    (
      'trial_confirmation',
      E'Hi {{first_name}},\n\nYour trial shift is confirmed for {{appointment_time}} at The Anchor.\n\nPlease bring proof of your right to work in the UK. You cannot perform duties without this check.\n\nBest,\nThe Anchor'
    ),
    (
      'reminder',
      E'Hi {{first_name}},\n\nReminder: your {{appointment_type}} is tomorrow at {{appointment_time}} at The Anchor.\n\nBest,\nThe Anchor'
    )
) AS draft(type, body)
WHERE template.type = draft.type
  AND strpos(template.body, chr(10)) = 0;

COMMIT;
