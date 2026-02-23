BEGIN;

-- Expense auto-tagging should run only on outgoing transactions.
UPDATE public.receipt_rules
SET
  match_direction = 'out',
  updated_at = timezone('utc', now())
WHERE set_expense_category IS NOT NULL
  AND match_direction = 'both';

-- Remove legacy incoming-only expense tags applied by automation.
UPDATE public.receipt_transactions
SET
  expense_category = NULL,
  expense_category_source = NULL,
  expense_rule_id = NULL,
  expense_updated_at = timezone('utc', now()),
  updated_at = timezone('utc', now())
WHERE expense_category_source IN ('ai', 'rule')
  AND COALESCE(amount_in, 0) > 0
  AND COALESCE(amount_out, 0) = 0;

COMMIT;
