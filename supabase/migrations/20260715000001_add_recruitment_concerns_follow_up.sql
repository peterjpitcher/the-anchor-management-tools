BEGIN;

ALTER TABLE public.recruitment_email_templates
  DROP CONSTRAINT IF EXISTS recruitment_email_templates_type_check;

ALTER TABLE public.recruitment_email_templates
  ADD CONSTRAINT recruitment_email_templates_type_check CHECK (
    type IN (
      'interview_invite',
      'concerns_follow_up',
      'rejection',
      'already_considered',
      'trial_invite',
      'offer',
      'interview_confirmation',
      'trial_confirmation',
      'reminder',
      'manager_alert'
    )
  );

INSERT INTO public.recruitment_email_templates (type, subject, body, is_active)
VALUES (
  'concerns_follow_up',
  'A few questions about your application to The Anchor',
  E'Hi {{first_name}},\n\nThank you for applying for {{role_title}} at The Anchor. Before we decide on the next step, could you please tell us a little more about your relevant experience, availability, and travel arrangements for this role?\n\nThanks,\nThe Anchor',
  true
)
ON CONFLICT DO NOTHING;

COMMIT;
