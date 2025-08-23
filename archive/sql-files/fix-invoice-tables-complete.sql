-- Complete Invoice Tables Setup
-- This migration creates all invoice-related tables with proper relationships

-- First, drop existing tables if they exist (in correct order due to dependencies)
DROP TABLE IF EXISTS invoice_email_logs CASCADE;
DROP TABLE IF EXISTS invoice_payments CASCADE;
DROP TABLE IF EXISTS invoice_line_items CASCADE;
DROP TABLE IF EXISTS recurring_invoice_line_items CASCADE;
DROP TABLE IF EXISTS quote_line_items CASCADE;
DROP TABLE IF EXISTS quotes CASCADE;
DROP TABLE IF EXISTS recurring_invoices CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS line_item_catalog CASCADE;
DROP TABLE IF EXISTS invoice_vendors CASCADE;
DROP TABLE IF EXISTS invoice_series CASCADE;

-- Create invoice vendors table
CREATE TABLE invoice_vendors (
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

-- Create invoice series table for non-sequential numbering
CREATE TABLE invoice_series (
    series_code VARCHAR(10) PRIMARY KEY,
    current_sequence INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default series
INSERT INTO invoice_series (series_code) VALUES ('INV'), ('QTE');

-- Create invoices table with proper foreign key
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    vendor_id UUID REFERENCES invoice_vendors(id) ON DELETE RESTRICT,
    invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    reference VARCHAR(200),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'void', 'written_off')),
    invoice_discount_percentage DECIMAL(5,2) DEFAULT 0,
    subtotal_amount DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    vat_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) DEFAULT 0,
    paid_amount DECIMAL(10,2) DEFAULT 0,
    notes TEXT,
    internal_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID
);

-- Create line item catalog
CREATE TABLE line_item_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    default_price DECIMAL(10,2) DEFAULT 0,
    default_vat_rate DECIMAL(5,2) DEFAULT 20,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create invoice line items
CREATE TABLE invoice_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    catalog_item_id UUID REFERENCES line_item_catalog(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(10,3) DEFAULT 1,
    unit_price DECIMAL(10,2) DEFAULT 0,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    vat_rate DECIMAL(5,2) DEFAULT 20,
    subtotal_amount DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    discount_amount DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price * discount_percentage / 100) STORED,
    vat_amount DECIMAL(10,2) GENERATED ALWAYS AS ((quantity * unit_price - quantity * unit_price * discount_percentage / 100) * vat_rate / 100) STORED,
    total_amount DECIMAL(10,2) GENERATED ALWAYS AS ((quantity * unit_price - quantity * unit_price * discount_percentage / 100) * (1 + vat_rate / 100)) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create invoice payments
CREATE TABLE invoice_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50) CHECK (payment_method IN ('bank_transfer', 'cash', 'cheque', 'card', 'other')),
    reference VARCHAR(200),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create quotes table
CREATE TABLE quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_number VARCHAR(50) UNIQUE NOT NULL,
    vendor_id UUID REFERENCES invoice_vendors(id) ON DELETE RESTRICT,
    quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE NOT NULL,
    reference VARCHAR(200),
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
    quote_discount_percentage DECIMAL(5,2) DEFAULT 0,
    subtotal_amount DECIMAL(10,2) DEFAULT 0,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    vat_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(10,2) DEFAULT 0,
    notes TEXT,
    internal_notes TEXT,
    converted_to_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create quote line items
CREATE TABLE quote_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    catalog_item_id UUID REFERENCES line_item_catalog(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(10,3) DEFAULT 1,
    unit_price DECIMAL(10,2) DEFAULT 0,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    vat_rate DECIMAL(5,2) DEFAULT 20,
    subtotal_amount DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    discount_amount DECIMAL(10,2) GENERATED ALWAYS AS (quantity * unit_price * discount_percentage / 100) STORED,
    vat_amount DECIMAL(10,2) GENERATED ALWAYS AS ((quantity * unit_price - quantity * unit_price * discount_percentage / 100) * vat_rate / 100) STORED,
    total_amount DECIMAL(10,2) GENERATED ALWAYS AS ((quantity * unit_price - quantity * unit_price * discount_percentage / 100) * (1 + vat_rate / 100)) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create recurring invoices
CREATE TABLE recurring_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id UUID REFERENCES invoice_vendors(id) ON DELETE RESTRICT,
    frequency VARCHAR(20) CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
    start_date DATE NOT NULL,
    end_date DATE,
    next_invoice_date DATE NOT NULL,
    days_before_due INTEGER DEFAULT 30,
    reference VARCHAR(200),
    invoice_discount_percentage DECIMAL(5,2) DEFAULT 0,
    notes TEXT,
    internal_notes TEXT,
    is_active BOOLEAN DEFAULT true,
    last_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create recurring invoice line items
CREATE TABLE recurring_invoice_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recurring_invoice_id UUID NOT NULL REFERENCES recurring_invoices(id) ON DELETE CASCADE,
    catalog_item_id UUID REFERENCES line_item_catalog(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    quantity DECIMAL(10,3) DEFAULT 1,
    unit_price DECIMAL(10,2) DEFAULT 0,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    vat_rate DECIMAL(5,2) DEFAULT 20,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create invoice email logs
CREATE TABLE invoice_email_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
    quote_id UUID REFERENCES quotes(id) ON DELETE CASCADE,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    sent_to VARCHAR(255),
    sent_by VARCHAR(255),
    subject TEXT,
    body TEXT,
    status VARCHAR(20) CHECK (status IN ('sent', 'failed', 'bounced')),
    error_message TEXT,
    message_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_one_reference CHECK (
        (invoice_id IS NOT NULL AND quote_id IS NULL) OR 
        (invoice_id IS NULL AND quote_id IS NOT NULL)
    )
);

-- Create indexes for performance
CREATE INDEX idx_invoices_vendor_id ON invoices(vendor_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_payments_invoice_id ON invoice_payments(invoice_id);
CREATE INDEX idx_quotes_vendor_id ON quotes(vendor_id);
CREATE INDEX idx_quote_line_items_quote_id ON quote_line_items(quote_id);
CREATE INDEX idx_recurring_invoices_vendor_id ON recurring_invoices(vendor_id);
CREATE INDEX idx_recurring_invoices_next_date ON recurring_invoices(next_invoice_date);
CREATE INDEX idx_invoice_email_logs_invoice_id ON invoice_email_logs(invoice_id);
CREATE INDEX idx_invoice_email_logs_quote_id ON invoice_email_logs(quote_id);

-- Create the helper functions
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

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_and_increment_invoice_series(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_invoice_summary_stats() TO authenticated;

-- Enable RLS on all tables
ALTER TABLE invoice_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item_catalog ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for superadmin access
CREATE POLICY "Superadmin access" ON invoice_vendors FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON invoices FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON invoice_line_items FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON invoice_payments FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON quotes FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON quote_line_items FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON recurring_invoices FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON recurring_invoice_line_items FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON invoice_email_logs FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

CREATE POLICY "Superadmin access" ON line_item_catalog FOR ALL USING (
    EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
);

-- Create update triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_invoice_vendors_updated_at BEFORE UPDATE ON invoice_vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON quotes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recurring_invoices_updated_at BEFORE UPDATE ON recurring_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_line_item_catalog_updated_at BEFORE UPDATE ON line_item_catalog
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add some sample line item catalog entries
INSERT INTO line_item_catalog (name, description, default_price, default_vat_rate) VALUES
('Consulting Services', 'Professional consulting services', 150.00, 20),
('Development Work', 'Software development services', 120.00, 20),
('Support & Maintenance', 'Ongoing support and maintenance', 80.00, 20),
('Training', 'Training and education services', 100.00, 20),
('Hosting', 'Web hosting services', 50.00, 20)
ON CONFLICT DO NOTHING;