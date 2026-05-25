BEGIN;

CREATE TABLE IF NOT EXISTS public.cashup_sales_breakdowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cashup_session_id UUID NOT NULL REFERENCES public.cashup_sessions(id) ON DELETE CASCADE,
  sales_category TEXT NOT NULL CHECK (sales_category IN ('drinks_sales', 'food_sales', 'other_sales')),
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cashup_session_id, sales_category)
);

ALTER TABLE public.cashup_sales_breakdowns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view sales breakdowns with permission" ON public.cashup_sales_breakdowns;
DROP POLICY IF EXISTS "Users can insert sales breakdowns with permission" ON public.cashup_sales_breakdowns;
DROP POLICY IF EXISTS "Users can update sales breakdowns with permission" ON public.cashup_sales_breakdowns;
DROP POLICY IF EXISTS "Users can delete sales breakdowns with permission" ON public.cashup_sales_breakdowns;

CREATE POLICY "Users can view sales breakdowns with permission"
  ON public.cashup_sales_breakdowns
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

CREATE POLICY "Users can insert sales breakdowns with permission"
  ON public.cashup_sales_breakdowns
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'cashing_up', 'create')
    OR public.user_has_permission(auth.uid(), 'cashing_up', 'edit')
  );

CREATE POLICY "Users can update sales breakdowns with permission"
  ON public.cashup_sales_breakdowns
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can delete sales breakdowns with permission"
  ON public.cashup_sales_breakdowns
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

REVOKE ALL ON public.cashup_sales_breakdowns FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cashup_sales_breakdowns TO authenticated;

CREATE TABLE IF NOT EXISTS public.pnl_sales_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'till_csv',
  source_section TEXT NOT NULL DEFAULT 'Net sales',
  drinks_sales NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (drinks_sales >= 0),
  food_sales NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (food_sales >= 0),
  other_sales NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (other_sales >= 0),
  total_sales NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_sales >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, sale_date, source, source_section)
);

ALTER TABLE public.pnl_sales_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Receipts users can view pnl sales imports" ON public.pnl_sales_imports;
DROP POLICY IF EXISTS "Receipts managers can modify pnl sales imports" ON public.pnl_sales_imports;

CREATE POLICY "Receipts users can view pnl sales imports"
  ON public.pnl_sales_imports
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'receipts', 'view'));

CREATE POLICY "Receipts managers can modify pnl sales imports"
  ON public.pnl_sales_imports
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'receipts', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'receipts', 'manage'));

REVOKE ALL ON public.pnl_sales_imports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pnl_sales_imports TO authenticated;

CREATE TABLE IF NOT EXISTS public.greene_king_pnl_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_key TEXT NOT NULL UNIQUE,
  pub_code TEXT NOT NULL,
  pub_name TEXT NOT NULL,
  proposal_id TEXT,
  assessment_date DATE NOT NULL,
  report_date DATE NOT NULL,
  agreement_type TEXT,
  agreement_reason TEXT,
  tie_details TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.greene_king_pnl_benchmark_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_id UUID NOT NULL REFERENCES public.greene_king_pnl_benchmarks(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('sales', 'income', 'expenses', 'profit', 'adjustments', 'rent')),
  metric_key TEXT NOT NULL,
  label TEXT NOT NULL,
  row_order INTEGER NOT NULL DEFAULT 0,
  annual_amount NUMERIC(14, 2),
  gross_profit NUMERIC(14, 2),
  gross_profit_percent NUMERIC(7, 2) CHECK (gross_profit_percent IS NULL OR gross_profit_percent BETWEEN 0 AND 100),
  sales_mix_percent NUMERIC(7, 2) CHECK (sales_mix_percent IS NULL OR sales_mix_percent BETWEEN 0 AND 150),
  percent_of_sales NUMERIC(7, 2) CHECK (percent_of_sales IS NULL OR percent_of_sales BETWEEN 0 AND 100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (benchmark_id, metric_key)
);

ALTER TABLE public.greene_king_pnl_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.greene_king_pnl_benchmark_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Receipts users can view greene king benchmarks" ON public.greene_king_pnl_benchmarks;
DROP POLICY IF EXISTS "Receipts managers can modify greene king benchmarks" ON public.greene_king_pnl_benchmarks;
DROP POLICY IF EXISTS "Receipts users can view greene king benchmark rows" ON public.greene_king_pnl_benchmark_rows;
DROP POLICY IF EXISTS "Receipts managers can modify greene king benchmark rows" ON public.greene_king_pnl_benchmark_rows;

CREATE POLICY "Receipts users can view greene king benchmarks"
  ON public.greene_king_pnl_benchmarks
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'receipts', 'view'));

CREATE POLICY "Receipts managers can modify greene king benchmarks"
  ON public.greene_king_pnl_benchmarks
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'receipts', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'receipts', 'manage'));

CREATE POLICY "Receipts users can view greene king benchmark rows"
  ON public.greene_king_pnl_benchmark_rows
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'receipts', 'view'));

CREATE POLICY "Receipts managers can modify greene king benchmark rows"
  ON public.greene_king_pnl_benchmark_rows
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'receipts', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'receipts', 'manage'));

REVOKE ALL ON public.greene_king_pnl_benchmarks FROM anon;
REVOKE ALL ON public.greene_king_pnl_benchmark_rows FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.greene_king_pnl_benchmarks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.greene_king_pnl_benchmark_rows TO authenticated;

INSERT INTO public.greene_king_pnl_benchmarks (
  benchmark_key,
  pub_code,
  pub_name,
  proposal_id,
  assessment_date,
  report_date,
  agreement_type,
  agreement_reason,
  tie_details,
  is_active
) VALUES (
  'greene-king-anchor-stanwell-moor-2023-shadow-pnl',
  '5356',
  'Anchor (Stanwell Moor)',
  '26331',
  DATE '2023-08-22',
  DATE '2023-11-27',
  'Tenancy Standard',
  'Post investment',
  'Full Tie - Access to Discounted Prices / No',
  TRUE
) ON CONFLICT (benchmark_key) DO UPDATE SET
  pub_code = EXCLUDED.pub_code,
  pub_name = EXCLUDED.pub_name,
  proposal_id = EXCLUDED.proposal_id,
  assessment_date = EXCLUDED.assessment_date,
  report_date = EXCLUDED.report_date,
  agreement_type = EXCLUDED.agreement_type,
  agreement_reason = EXCLUDED.agreement_reason,
  tie_details = EXCLUDED.tie_details,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

WITH benchmark AS (
  SELECT id
  FROM public.greene_king_pnl_benchmarks
  WHERE benchmark_key = 'greene-king-anchor-stanwell-moor-2023-shadow-pnl'
), rows(section, metric_key, label, row_order, annual_amount, gross_profit, gross_profit_percent, sales_mix_percent, percent_of_sales) AS (
  VALUES
    ('sales', 'drinks_sales', 'Total drinks sales', 10, 252313, 162049, 64.2, 78.7, NULL),
    ('sales', 'food_sales', 'Food + other sales', 20, 68293, 45833, 67.1, 21.3, NULL),
    ('sales', 'accommodation_sales', 'Accommodation', 30, 0, 0, 0, 0, NULL),
    ('income', 'total_sales', 'Total sales', 40, 320606, 207882, 64.8, 100, NULL),
    ('income', 'net_machine_income', 'Net machine income', 50, 3500, 3500, 100, 1.1, NULL),
    ('income', 'total_income', 'Total income', 60, 324106, 211382, 65.2, 101.1, NULL),
    ('expenses', 'total_staff', 'Total Staff', 100, 80684, NULL, NULL, NULL, 25.2),
    ('expenses', 'business_rate', 'Business Rate', 110, 0, NULL, NULL, NULL, 0),
    ('expenses', 'water_rates', 'Water Rates', 120, 3500, NULL, NULL, NULL, 1.1),
    ('expenses', 'heat_light_power', 'Heat/Light/Power', 130, 15820, NULL, NULL, NULL, 4.9),
    ('expenses', 'premises_repairs_maintenance', 'Premises Repairs/Maintenance', 140, 3500, NULL, NULL, NULL, 1.1),
    ('expenses', 'equipment_repairs_maintenance', 'Equipment Repairs/Maintenance', 150, 1500, NULL, NULL, NULL, 0.5),
    ('expenses', 'gardening_expenses', 'Gardening Expenses', 160, 2600, NULL, NULL, NULL, 0.8),
    ('expenses', 'buildings_insurance', 'Buildings Insurance', 170, 960, NULL, NULL, NULL, 0.3),
    ('expenses', 'maintenance_service_plans', 'Maintenance and Service Plan Charges', 180, 2829, NULL, NULL, NULL, 0.9),
    ('expenses', 'licensing', 'Licensing', 190, 180, NULL, NULL, NULL, 0.1),
    ('expenses', 'tenant_insurance', 'Tenant Insurance', 200, 3500, NULL, NULL, NULL, 1.1),
    ('expenses', 'entertainment', 'Entertainment', 210, 2600, NULL, NULL, NULL, 0.8),
    ('expenses', 'sky_prs_vidimix', 'Sky / PRS / Vidimix', 220, 9100, NULL, NULL, NULL, 2.8),
    ('expenses', 'marketing_promotion_advertising', 'Marketing/Promotion/Advertising', 230, 2200, NULL, NULL, NULL, 0.7),
    ('expenses', 'print_post_stationary', 'Print/Post Stationary', 240, 1200, NULL, NULL, NULL, 0.4),
    ('expenses', 'telephone', 'Telephone', 250, 1200, NULL, NULL, NULL, 0.4),
    ('expenses', 'travel_car', 'Travel/Car', 260, 2000, NULL, NULL, NULL, 0.6),
    ('expenses', 'waste_disposal_cleaning_hygiene', 'Waste Disposal/Cleaning/Hygiene', 270, 4500, NULL, NULL, NULL, 1.4),
    ('expenses', 'third_party_booking_fee', 'Third Party Booking Fee', 280, 0, NULL, NULL, NULL, 0),
    ('expenses', 'accountant_stocktaker_professional_fees', 'Accountant/StockTaker/Professional Fees', 290, 4500, NULL, NULL, NULL, 1.4),
    ('expenses', 'bank_charges_credit_card_commission', 'Bank Charges/Credit Card Commission', 300, 4500, NULL, NULL, NULL, 1.4),
    ('expenses', 'equipment_hire', 'Equipment Hire', 310, 750, NULL, NULL, NULL, 0.2),
    ('expenses', 'sundries_consumables', 'Sundries/Consumables', 320, 4000, NULL, NULL, NULL, 1.2),
    ('expenses', 'drinks_gas', 'Drinks Gas', 330, 750, NULL, NULL, NULL, 0.2),
    ('expenses', 'total_expenses', 'Total expenses', 340, 152373, NULL, NULL, NULL, 47.5),
    ('profit', 'net_operating_profit_before_rent', 'Net operating profit before rent', 400, 59010, NULL, NULL, NULL, NULL),
    ('adjustments', 'working_capital_interest', 'Interest on working capital @ 8%', 500, 2000, NULL, NULL, NULL, NULL),
    ('adjustments', 'total_adjustments', 'Total adjustments', 510, 2000, NULL, NULL, NULL, NULL),
    ('rent', 'divisible_balance', 'Divisible balance', 600, 57010, NULL, NULL, NULL, NULL),
    ('rent', 'rent', 'Assessed fixed rental value', 610, 28500, NULL, NULL, NULL, 8.9),
    ('rent', 'operators_retained_income', 'Operator''s retained income including machine income', 620, 28510, NULL, NULL, NULL, 8.9)
)
INSERT INTO public.greene_king_pnl_benchmark_rows (
  benchmark_id,
  section,
  metric_key,
  label,
  row_order,
  annual_amount,
  gross_profit,
  gross_profit_percent,
  sales_mix_percent,
  percent_of_sales
)
SELECT
  benchmark.id,
  rows.section,
  rows.metric_key,
  rows.label,
  rows.row_order,
  rows.annual_amount,
  rows.gross_profit,
  rows.gross_profit_percent,
  rows.sales_mix_percent,
  rows.percent_of_sales
FROM benchmark
CROSS JOIN rows
ON CONFLICT (benchmark_id, metric_key) DO UPDATE SET
  section = EXCLUDED.section,
  label = EXCLUDED.label,
  row_order = EXCLUDED.row_order,
  annual_amount = EXCLUDED.annual_amount,
  gross_profit = EXCLUDED.gross_profit,
  gross_profit_percent = EXCLUDED.gross_profit_percent,
  sales_mix_percent = EXCLUDED.sales_mix_percent,
  percent_of_sales = EXCLUDED.percent_of_sales,
  updated_at = NOW();

INSERT INTO public.pl_targets (metric_key, timeframe, target_value, updated_at)
VALUES
  ('drinks_sales', '12m', 252313, NOW()),
  ('food_sales', '12m', 68293, NOW()),
  ('accommodation_sales', '12m', 0, NOW()),
  ('net_machine_income', '12m', 3500, NOW()),
  ('draught_beer_pct', '12m', 49.5, NOW()),
  ('cask_ale_pct', '12m', 1.5, NOW()),
  ('keg_beer_pct', '12m', 24.1, NOW()),
  ('cask_beer_pct', '12m', 14.8, NOW()),
  ('total_drinks_post_wastage', '12m', 64.2, NOW()),
  ('total_food', '12m', 67.1, NOW()),
  ('total_accommodation', '12m', 0, NOW()),
  ('rent', '12m', 28500, NOW()),
  ('royalty', '12m', 0, NOW()),
  ('total_staff', '12m', 80684, NOW()),
  ('business_rate', '12m', 0, NOW()),
  ('water_rates', '12m', 3500, NOW()),
  ('heat_light_power', '12m', 15820, NOW()),
  ('premises_repairs_maintenance', '12m', 3500, NOW()),
  ('equipment_repairs_maintenance', '12m', 1500, NOW()),
  ('gardening_expenses', '12m', 2600, NOW()),
  ('buildings_insurance', '12m', 960, NOW()),
  ('maintenance_service_plans', '12m', 2829, NOW()),
  ('licensing', '12m', 180, NOW()),
  ('tenant_insurance', '12m', 3500, NOW()),
  ('entertainment', '12m', 2600, NOW()),
  ('sky_prs_vidimix', '12m', 9100, NOW()),
  ('marketing_promotion_advertising', '12m', 2200, NOW()),
  ('print_post_stationary', '12m', 1200, NOW()),
  ('telephone', '12m', 1200, NOW()),
  ('travel_car', '12m', 2000, NOW()),
  ('waste_disposal_cleaning_hygiene', '12m', 4500, NOW()),
  ('third_party_booking_fee', '12m', 0, NOW()),
  ('accountant_stocktaker_professional_fees', '12m', 4500, NOW()),
  ('bank_charges_credit_card_commission', '12m', 4500, NOW()),
  ('equipment_hire', '12m', 750, NOW()),
  ('sundries_consumables', '12m', 4000, NOW()),
  ('drinks_gas', '12m', 750, NOW())
ON CONFLICT (metric_key, timeframe) DO UPDATE SET
  target_value = EXCLUDED.target_value,
  updated_at = NOW();

COMMIT;
