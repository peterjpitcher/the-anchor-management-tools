-- This SQL will create the invoice tables and migrate the data
-- Run this in your database to fix the vendor table issue

-- First, check if invoice_vendors table exists, if not create it
CREATE TABLE IF NOT EXISTS invoice_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    contact_name VARCHAR(200),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    vat_number VARCHAR(50),
    payment_terms INTEGER DEFAULT 30,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create the helper functions if they don't exist
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

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_and_increment_invoice_series(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_invoice_summary_stats() TO authenticated;

-- Enable RLS on invoice_vendors
ALTER TABLE invoice_vendors ENABLE ROW LEVEL SECURITY;

-- Create RLS policy for invoice_vendors
DROP POLICY IF EXISTS "Superadmin access" ON invoice_vendors;
CREATE POLICY "Superadmin access" ON invoice_vendors FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

-- Create update trigger for invoice_vendors
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_invoice_vendors_updated_at ON invoice_vendors;
CREATE TRIGGER update_invoice_vendors_updated_at BEFORE UPDATE ON invoice_vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();