-- Make default recruitment email drafts warmer and more encouraging.

UPDATE public.recruitment_email_templates AS template
SET
  subject = draft.subject,
  body = draft.body,
  updated_at = now()
FROM (
  VALUES
    (
      'interview_invite',
      'Interview invitation - The Anchor',
      E'Hi {{first_name}},\n\nThank you for applying for {{role_title}} at The Anchor. We enjoyed reading your application and would like to invite you for an interview.\n\nPlease choose a time using this link: {{booking_link}}\n\nPlease bring proof of your right to work in the UK.\n\nBest,\nThe Anchor'
    ),
    (
      'trial_invite',
      'Trial shift invitation - The Anchor',
      E'Hi {{first_name}},\n\nThank you for applying for {{role_title}} at The Anchor. We liked reading about your experience and would like to invite you for a short unpaid trial shift. It is around 2 hours, alongside an existing team member, with a complimentary main-menu item and soft drink.\n\nPlease bring proof of your right to work in the UK. You cannot perform duties without this check.\n\nChoose a time here: {{booking_link}}\n\nBest,\nThe Anchor'
    ),
    (
      'rejection',
      'Your application to The Anchor',
      E'Hi {{first_name}},\n\nThank you for applying for {{role_title}} at The Anchor and for taking the time to tell us about your experience. We have reviewed your application carefully and will not be taking it further this time.\n\nWe really appreciate your interest, and we wish you the very best of luck.\n\nBest,\nThe Anchor'
    ),
    (
      'already_considered',
      'Your application to The Anchor',
      E'Hi {{first_name}},\n\nThank you for applying again for {{role_title}} at The Anchor. We really appreciate your continued interest.\n\nWe have already reviewed you for this vacancy, so we will not take a second application further right now. We wish you the very best of luck.\n\nBest,\nThe Anchor'
    ),
    (
      'offer',
      'Offer to join The Anchor',
      E'Hi {{first_name}},\n\nThank you again for applying for {{role_title}} at The Anchor. We enjoyed getting to know more about you and would like to offer you the role.\n\nThe agreed details are:\n\n{{offer_terms}}\n\nBest,\nThe Anchor'
    )
) AS draft(type, subject, body)
WHERE template.type = draft.type
  AND template.is_active = true;
