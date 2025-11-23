-- Ensure outstanding totals include every invoice that is not fully paid
CREATE OR REPLACE FUNCTION public.get_invoice_summary_stats()
RETURNS TABLE(
  total_outstanding numeric,
  total_overdue numeric,
  total_draft numeric,
  total_this_month numeric,
  count_outstanding integer,
  count_overdue integer,
  count_draft integer
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off')
        THEN i.total_amount - i.paid_amount 
      ELSE 0 
    END), 0) AS total_outstanding,
    COALESCE(SUM(CASE 
      WHEN i.status = 'overdue' 
        THEN i.total_amount - i.paid_amount 
      ELSE 0 
    END), 0) AS total_overdue,
    COALESCE(SUM(CASE 
      WHEN i.status = 'draft' 
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_draft,
    COALESCE(SUM(CASE 
      WHEN i.status = 'paid' 
        AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
        THEN i.total_amount 
      ELSE 0 
    END), 0) AS total_this_month,
    COUNT(CASE 
      WHEN i.status NOT IN ('paid', 'void', 'written_off') 
        THEN 1 
    END)::INTEGER AS count_outstanding,
    COUNT(CASE 
      WHEN i.status = 'overdue' 
        THEN 1 
    END)::INTEGER AS count_overdue,
    COUNT(CASE 
      WHEN i.status = 'draft' 
        THEN 1 
    END)::INTEGER AS count_draft
  FROM invoices i
  WHERE i.deleted_at IS NULL;
END;
$$;
