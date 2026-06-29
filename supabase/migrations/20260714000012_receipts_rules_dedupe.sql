WITH dupes AS (
  SELECT id, row_number() OVER (
    PARTITION BY lower(coalesce(match_description,'')), match_direction, match_min_amount, match_max_amount,
                 match_transaction_type, coalesce(set_vendor_name,''), set_vendor_id, coalesce(set_expense_category,''),
                 auto_status, kind
    ORDER BY priority ASC, created_at ASC
  ) AS rn
  FROM public.receipt_rules WHERE is_active
)
UPDATE public.receipt_rules r
SET is_active = false, deactivated_at = now()
FROM dupes WHERE r.id = dupes.id AND dupes.rn > 1;
