-- Migration: split catering package description into structured fields
-- Description: Adds summary, includes, served, good_to_know, and guest_description
--              columns, parses existing description text into them, then drops the
--              old description column.

BEGIN;

ALTER TABLE catering_packages
  ADD COLUMN summary text,
  ADD COLUMN includes text,
  ADD COLUMN served text,
  ADD COLUMN good_to_know text,
  ADD COLUMN guest_description text;

-- Parse the structured "Summary: ...\nIncludes: ...\nServed: ...\nGood to know: ..."
-- format from the existing description column into the new dedicated columns.
UPDATE catering_packages
SET
  summary      = (regexp_match(description, 'Summary: ([^\n]+)'))[1],
  includes     = (regexp_match(description, 'Includes: ([^\n]+)'))[1],
  served       = (regexp_match(description, 'Served: ([^\n]+)'))[1],
  good_to_know = (regexp_match(description, 'Good to know: ([^\n]+)'))[1]
WHERE description IS NOT NULL;

ALTER TABLE catering_packages DROP COLUMN description;

COMMIT;
