-- Drop the hardcoded department check on department_budgets.
-- The departments table (20260301000001) is now the source of truth for valid
-- department names, so a static IN ('bar','kitchen') constraint is too restrictive.

ALTER TABLE public.department_budgets
  DROP CONSTRAINT IF EXISTS department_budgets_department_check;
