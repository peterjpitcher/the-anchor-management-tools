-- Retire the four policy acknowledgement drafts that the staff training courses replace
-- (tasks/plan-2026-11-02-staff-training-build.md, section 2.4; owner decision, 2 November 2026).
--
--   health-and-safety, allergens, challenge-25, data-protection
--
-- The Essentials and Team training courses teach these and end with a confirmation through the
-- signing feature, so a separate "I have read the policy" acknowledgement for each would ask
-- staff to confirm the same thing twice. The staff handbook (staff-handbook) is untouched.
--
-- signing_templates has no retired state: a template is switched on (is_active) or off. So each
-- of the four is:
--   1. switched off (all four already are in production, checked 2 November 2026, and none has
--      ever been sent), and
--   2. given a first line [[RETIRED: ...]] in its wording. The app refuses to switch a template
--      on, or to send it, while any [[...]] marker remains (templateActivationBlocker), so the
--      line also tells whoever opens it in Settings, Signing templates why it is off.
-- The version goes up by one, as it does for any change of wording. Nothing else changes, and no
-- document is touched.
--
-- A marker can be deleted by someone editing the wording, so this is a soft stop. The hard stop,
-- refusing these four slugs in code, belongs to the signing feature (reported to the owner).
--
-- Data only: no table, column, function, grant or policy is added, changed or removed. Safe to
-- run twice: a template that already carries the line is not changed again.
--
-- Rollback (only if the owner wants a policy acknowledgement back):
--
--   BEGIN;
--   UPDATE public.signing_templates
--   SET body = substr(body, strpos(body, ']]') + 4), version = version + 1, updated_at = now(), updated_by = NULL
--   WHERE kind = 'policy_acknowledgement'
--     AND slug IN ('health-and-safety', 'allergens', 'challenge-25', 'data-protection')
--     AND body LIKE '[[RETIRED:%';
--   COMMIT;

BEGIN;

UPDATE public.signing_templates
SET body = '[[RETIRED: replaced by the staff training courses (Essentials and Team training). Do not switch this policy on.]]'
           || E'\n\n' || body,
    is_active = false,
    version = version + 1,
    updated_at = now(),
    updated_by = NULL
WHERE kind = 'policy_acknowledgement'
  AND slug IN ('health-and-safety', 'allergens', 'challenge-25', 'data-protection')
  AND body NOT LIKE '[[RETIRED:%';

-- Already marked, but switched on again by hand since: switch it off.
UPDATE public.signing_templates
SET is_active = false,
    updated_at = now(),
    updated_by = NULL
WHERE kind = 'policy_acknowledgement'
  AND slug IN ('health-and-safety', 'allergens', 'challenge-25', 'data-protection')
  AND is_active;

COMMIT;
