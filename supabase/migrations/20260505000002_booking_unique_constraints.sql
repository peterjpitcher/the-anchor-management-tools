-- Add missing unique constraints noted in the QA review.
--
-- booking_reference: unique constraint already existed in the DB.
-- table_join_groups.name: prevents duplicate group names in the settings UI.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'table_join_groups_name_key'
      AND table_name = 'table_join_groups'
  ) THEN
    ALTER TABLE public.table_join_groups
      ADD CONSTRAINT table_join_groups_name_key UNIQUE (name);
  END IF;
END $$;
