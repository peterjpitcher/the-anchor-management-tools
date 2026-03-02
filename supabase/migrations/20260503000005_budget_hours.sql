-- Rename annual_amount to annual_hours on department_budgets.
-- Budgets are compared against scheduled hours, not money, so the column
-- should reflect what it actually stores.

ALTER TABLE public.department_budgets
  RENAME COLUMN annual_amount TO annual_hours;
