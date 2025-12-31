-- Add structured outcome reason categories for hiring applications

ALTER TABLE public.hiring_applications
  ADD COLUMN IF NOT EXISTS outcome_reason_category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'hiring_applications_outcome_reason_category_check'
  ) THEN
    ALTER TABLE public.hiring_applications
      ADD CONSTRAINT hiring_applications_outcome_reason_category_check
      CHECK (
        outcome_reason_category IS NULL
        OR outcome_reason_category IN (
          'experience',
          'skills',
          'availability',
          'right_to_work',
          'culture_fit',
          'communication',
          'compensation',
          'role_closed',
          'other'
        )
      );
  END IF;
END $$;
