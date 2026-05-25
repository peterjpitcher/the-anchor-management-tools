BEGIN;

-- Imported till sales can include small refunds or correction lines on a daily category.
-- Manual cash-up sales splits remain validated separately as non-negative user input.
ALTER TABLE public.pnl_sales_imports
  DROP CONSTRAINT IF EXISTS pnl_sales_imports_drinks_sales_check,
  DROP CONSTRAINT IF EXISTS pnl_sales_imports_food_sales_check,
  DROP CONSTRAINT IF EXISTS pnl_sales_imports_other_sales_check,
  DROP CONSTRAINT IF EXISTS pnl_sales_imports_total_sales_check;

COMMIT;
