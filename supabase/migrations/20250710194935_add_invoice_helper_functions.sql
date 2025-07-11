-- Function to get and increment invoice series counter atomically
CREATE OR REPLACE FUNCTION get_and_increment_invoice_series(p_series_code VARCHAR)
RETURNS TABLE(next_sequence INTEGER) AS $$
DECLARE
  v_next_sequence INTEGER;
BEGIN
  -- Lock the row and get the next sequence
  UPDATE invoice_series
  SET current_sequence = current_sequence + 1
  WHERE series_code = p_series_code
  RETURNING current_sequence INTO v_next_sequence;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice series % not found', p_series_code;
  END IF;
  
  RETURN QUERY SELECT v_next_sequence;
END;
$$ LANGUAGE plpgsql;

-- Function to get invoice summary statistics
CREATE OR REPLACE FUNCTION get_invoice_summary_stats()
RETURNS TABLE(
  total_outstanding DECIMAL,
  total_overdue DECIMAL,
  total_draft DECIMAL,
  total_this_month DECIMAL,
  count_outstanding INTEGER,
  count_overdue INTEGER,
  count_draft INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN i.status IN ('sent', 'partially_paid', 'overdue') 
      THEN i.total_amount - i.paid_amount ELSE 0 END), 0) as total_outstanding,
    COALESCE(SUM(CASE WHEN i.status = 'overdue' 
      THEN i.total_amount - i.paid_amount ELSE 0 END), 0) as total_overdue,
    COALESCE(SUM(CASE WHEN i.status = 'draft' 
      THEN i.total_amount ELSE 0 END), 0) as total_draft,
    COALESCE(SUM(CASE WHEN i.status = 'paid' 
      AND DATE_TRUNC('month', i.invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
      THEN i.total_amount ELSE 0 END), 0) as total_this_month,
    COUNT(CASE WHEN i.status IN ('sent', 'partially_paid', 'overdue') THEN 1 END)::INTEGER as count_outstanding,
    COUNT(CASE WHEN i.status = 'overdue' THEN 1 END)::INTEGER as count_overdue,
    COUNT(CASE WHEN i.status = 'draft' THEN 1 END)::INTEGER as count_draft
  FROM invoices i
  WHERE i.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_and_increment_invoice_series(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_invoice_summary_stats() TO authenticated;