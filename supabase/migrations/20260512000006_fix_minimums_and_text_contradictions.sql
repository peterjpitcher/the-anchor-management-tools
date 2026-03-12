-- Migration: fix minimum guests and text contradictions
-- Description:
--   - Pimm's Jar: raise minimum to 30, remove "Priced per jar" text (pricing model is per_head)
--   - Kids Unlimited Squash: raise minimum to 10

BEGIN;

-- Pimm's Jar: correct minimum and remove contradictory pricing language
UPDATE catering_packages SET
  minimum_guests   = 30,
  good_to_know     = 'Perfect alongside summer events and garden parties.',
  guest_description = 'A refreshing Pimm''s jar, perfect for summer events — ready to share and always a crowd favourite.'
WHERE name = 'Pimm''s Jar';

-- Kids Unlimited Squash: correct minimum
UPDATE catering_packages SET minimum_guests = 10
WHERE name = 'Kids Unlimited Squash';

COMMIT;
