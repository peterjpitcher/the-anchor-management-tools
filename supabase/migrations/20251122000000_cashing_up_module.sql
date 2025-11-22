-- Create sites table if it doesn't exist (as per spec requirements)
CREATE TABLE IF NOT EXISTS sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default site if not exists
INSERT INTO sites (name)
SELECT 'The Anchor'
WHERE NOT EXISTS (SELECT 1 FROM sites);

-- 3.1.1 cashup_sessions
CREATE TABLE cashup_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id UUID NOT NULL REFERENCES sites(id),
    session_date DATE NOT NULL,
    shift_code TEXT NULL,

    status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'locked')),

    prepared_by_user_id UUID NOT NULL,
    approved_by_user_id UUID NULL,

    total_expected_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_counted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_variance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

    notes TEXT NULL,

    workbook_payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_user_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_user_id UUID NOT NULL
);

-- Unique index to handle NULL shift_code as distinct value 'NONE' for uniqueness
CREATE UNIQUE INDEX cashup_sessions_site_date_shift_idx ON cashup_sessions (site_id, session_date, COALESCE(shift_code, 'NONE'));

-- 3.1.2 cashup_payment_breakdowns
CREATE TABLE cashup_payment_breakdowns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cashup_session_id UUID NOT NULL REFERENCES cashup_sessions(id) ON DELETE CASCADE,

    payment_type_code TEXT NOT NULL,
    payment_type_label TEXT NOT NULL,

    expected_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    counted_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    variance_amount NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- 3.1.3 cashup_cash_counts
CREATE TABLE cashup_cash_counts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cashup_session_id UUID NOT NULL REFERENCES cashup_sessions(id) ON DELETE CASCADE,

    denomination NUMERIC(6,2) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0
);

-- 3.1.4 cashup_config
CREATE TABLE cashup_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL
);

-- 3.1.5 cashup_weekly_view
CREATE OR REPLACE VIEW cashup_weekly_view AS
SELECT
    cs.site_id,
    date_trunc('week', cs.session_date)::date AS week_start_date,
    cs.session_date,
    cs.shift_code,
    cs.status,
    cs.total_expected_amount,
    cs.total_counted_amount,
    cs.total_variance_amount
FROM cashup_sessions cs;

-- RLS Policies
ALTER TABLE cashup_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashup_payment_breakdowns ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashup_cash_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashup_config ENABLE ROW LEVEL SECURITY;

-- Basic permissive policies for authenticated users (to be refined)
CREATE POLICY "Authenticated users can view sites" ON sites FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can view sessions" ON cashup_sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert sessions" ON cashup_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update sessions" ON cashup_sessions FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view breakdowns" ON cashup_payment_breakdowns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert breakdowns" ON cashup_payment_breakdowns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update breakdowns" ON cashup_payment_breakdowns FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete breakdowns" ON cashup_payment_breakdowns FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view counts" ON cashup_cash_counts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert counts" ON cashup_cash_counts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update counts" ON cashup_cash_counts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete counts" ON cashup_cash_counts FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view config" ON cashup_config FOR SELECT TO authenticated USING (true);
