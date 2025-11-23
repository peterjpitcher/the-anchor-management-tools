-- Receipts module: transactional ledger, rule automation, storage, and RBAC

-- 1. Ensure status enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receipt_transaction_status') THEN
    CREATE TYPE receipt_transaction_status AS ENUM ('pending', 'completed', 'auto_completed', 'no_receipt_required');
  END IF;
END $$;

-- 2. Storage bucket for receipt files (idempotent)
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Receipt batches capture each bank statement import
CREATE TABLE IF NOT EXISTS receipt_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  source_hash TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Automation rules for marking transactions that do not require receipts
CREATE TABLE IF NOT EXISTS receipt_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  match_description TEXT,
  match_transaction_type TEXT,
  match_direction TEXT NOT NULL DEFAULT 'both' CHECK (match_direction IN ('in', 'out', 'both')),
  match_min_amount NUMERIC(12, 2),
  match_max_amount NUMERIC(12, 2),
  auto_status receipt_transaction_status NOT NULL DEFAULT 'no_receipt_required',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Imported transactions tracked per row with deduplication hash
CREATE TABLE IF NOT EXISTS receipt_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES receipt_batches(id) ON DELETE SET NULL,
  transaction_date DATE NOT NULL,
  details TEXT NOT NULL,
  transaction_type TEXT,
  amount_in NUMERIC(12, 2),
  amount_out NUMERIC(12, 2),
  balance NUMERIC(14, 2),
  dedupe_hash TEXT NOT NULL,
  status receipt_transaction_status NOT NULL DEFAULT 'pending',
  receipt_required BOOLEAN NOT NULL DEFAULT true,
  marked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_by_email TEXT,
  marked_by_name TEXT,
  marked_at TIMESTAMPTZ,
  marked_method TEXT,
  rule_applied_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_amount_non_negative CHECK ((amount_in IS NULL OR amount_in >= 0) AND (amount_out IS NULL OR amount_out >= 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_transactions_dedupe_hash
  ON receipt_transactions(dedupe_hash);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_date
  ON receipt_transactions(transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_receipt_transactions_status
  ON receipt_transactions(status);

-- 6. Metadata for uploaded receipt documents
CREATE TABLE IF NOT EXISTS receipt_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES receipt_transactions(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes INTEGER,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_files_transaction_path
  ON receipt_files(transaction_id, storage_path);

-- 7. Activity log to retain audit trail for manual or automated updates
CREATE TABLE IF NOT EXISTS receipt_transaction_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES receipt_transactions(id) ON DELETE CASCADE,
  previous_status receipt_transaction_status,
  new_status receipt_transaction_status,
  action_type TEXT NOT NULL,
  note TEXT,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES receipt_rules(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_receipt_transaction_logs_transaction
  ON receipt_transaction_logs(transaction_id, performed_at DESC);

-- 8. Updated-at trigger helpers
CREATE OR REPLACE FUNCTION set_receipt_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_transactions_updated_at ON receipt_transactions;
CREATE TRIGGER trg_receipt_transactions_updated_at
  BEFORE UPDATE ON receipt_transactions
  FOR EACH ROW
  EXECUTE FUNCTION set_receipt_transactions_updated_at();

CREATE OR REPLACE FUNCTION set_receipt_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_rules_updated_at ON receipt_rules;
CREATE TRIGGER trg_receipt_rules_updated_at
  BEFORE UPDATE ON receipt_rules
  FOR EACH ROW
  EXECUTE FUNCTION set_receipt_rules_updated_at();

-- 9. Enable row-level security and restrict to privileged contexts
ALTER TABLE receipt_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_transaction_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role access" ON receipt_batches
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_rules
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_transactions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_files
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role access" ON receipt_transaction_logs
  FOR ALL USING (auth.role() = 'service_role');

-- 10. Receipts module permissions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'receipts' AND action = 'view'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('receipts', 'view', 'View bank statement receipts workspace');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'receipts' AND action = 'manage'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('receipts', 'manage', 'Manage receipt workflows, including marking and rules');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'receipts' AND action = 'export'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('receipts', 'export', 'Export quarterly receipt bundles and reports');
  END IF;
END $$;

-- 11. Assign permissions to existing roles
DO $$
DECLARE
  super_admin_role_id UUID;
  finance_manager_role_id UUID;
  manager_role_id UUID;
  staff_role_id UUID;
BEGIN
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO finance_manager_role_id FROM roles WHERE name = 'finance_manager' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;
  SELECT id INTO staff_role_id FROM roles WHERE name = 'staff' LIMIT 1;

  IF super_admin_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view', 'manage', 'export')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );
  END IF;

  IF finance_manager_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT finance_manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view', 'manage', 'export')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = finance_manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  IF manager_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view', 'manage')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  IF staff_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT staff_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'receipts'
      AND p.action IN ('view')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = staff_role_id AND rp.permission_id = p.id
      );
  END IF;
END $$;

-- 12. Helper function for quarterly export windows
CREATE OR REPLACE FUNCTION get_quarter_date_range(p_year INT, p_quarter INT)
RETURNS TABLE (start_date DATE, end_date DATE) AS $$
DECLARE
  v_start_month INT;
BEGIN
  IF p_quarter NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Quarter must be between 1 and 4';
  END IF;

  v_start_month := ((p_quarter - 1) * 3) + 1;
  start_date := make_date(p_year, v_start_month, 1);
  end_date := (start_date + INTERVAL '3 months') - INTERVAL '1 day';
  RETURN QUERY SELECT start_date, end_date;
END;
$$ LANGUAGE plpgsql;

-- 13. Aggregated status counts for dashboard summaries
CREATE OR REPLACE FUNCTION count_receipt_statuses()
RETURNS TABLE (
  pending BIGINT,
  completed BIGINT,
  auto_completed BIGINT,
  no_receipt_required BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
    COUNT(*) FILTER (WHERE status = 'completed') AS completed,
    COUNT(*) FILTER (WHERE status = 'auto_completed') AS auto_completed,
    COUNT(*) FILTER (WHERE status = 'no_receipt_required') AS no_receipt_required
  FROM receipt_transactions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION count_receipt_statuses() TO authenticated, service_role;
