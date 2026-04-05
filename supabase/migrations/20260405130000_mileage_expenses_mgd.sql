-- =============================================================
-- Migration: Mileage, Expenses & Machine Games Duty
-- Spec: docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md
-- =============================================================

-- -------------------------------------------------------
-- Shared: is_super_admin() function for RLS
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin(check_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = check_user_id
      AND r.name = 'super_admin'
  );
$$;

-- -------------------------------------------------------
-- Mileage: Destinations
-- -------------------------------------------------------
CREATE TABLE public.mileage_destinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  postcode TEXT,
  is_home_base BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one home base allowed
CREATE UNIQUE INDEX idx_mileage_destinations_home_base
  ON public.mileage_destinations (is_home_base)
  WHERE is_home_base = TRUE;

ALTER TABLE public.mileage_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.mileage_destinations
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- Seed The Anchor as home base
INSERT INTO public.mileage_destinations (name, postcode, is_home_base)
VALUES ('The Anchor', 'TW19 6AQ', TRUE);

-- -------------------------------------------------------
-- Mileage: Distance Cache
-- -------------------------------------------------------
CREATE TABLE public.mileage_destination_distances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_destination_id UUID NOT NULL REFERENCES public.mileage_destinations(id) ON DELETE CASCADE,
  to_destination_id UUID NOT NULL REFERENCES public.mileage_destinations(id) ON DELETE CASCADE,
  miles NUMERIC(8,1) NOT NULL CHECK (miles > 0),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_destination_pair UNIQUE (from_destination_id, to_destination_id),
  CONSTRAINT chk_canonical_order CHECK (from_destination_id < to_destination_id)
);

ALTER TABLE public.mileage_destination_distances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.mileage_destination_distances
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- -------------------------------------------------------
-- Mileage: Trips
-- -------------------------------------------------------
CREATE TABLE public.mileage_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_date DATE NOT NULL,
  description TEXT,
  total_miles NUMERIC(8,1) NOT NULL CHECK (total_miles > 0),
  miles_at_standard_rate NUMERIC(8,1) NOT NULL DEFAULT 0 CHECK (miles_at_standard_rate >= 0),
  miles_at_reduced_rate NUMERIC(8,1) NOT NULL DEFAULT 0 CHECK (miles_at_reduced_rate >= 0),
  amount_due NUMERIC(10,2) NOT NULL CHECK (amount_due >= 0),
  source TEXT NOT NULL CHECK (source IN ('manual', 'oj_projects')),
  oj_entry_id UUID REFERENCES public.oj_entries(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_miles_split CHECK (total_miles = miles_at_standard_rate + miles_at_reduced_rate),
  CONSTRAINT uq_oj_entry UNIQUE (oj_entry_id)
);

CREATE INDEX idx_mileage_trips_date ON public.mileage_trips (trip_date DESC);
CREATE INDEX idx_mileage_trips_source ON public.mileage_trips (source);

ALTER TABLE public.mileage_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.mileage_trips
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- -------------------------------------------------------
-- Mileage: Trip Legs
-- -------------------------------------------------------
CREATE TABLE public.mileage_trip_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES public.mileage_trips(id) ON DELETE CASCADE,
  leg_order SMALLINT NOT NULL CHECK (leg_order > 0),
  from_destination_id UUID NOT NULL REFERENCES public.mileage_destinations(id),
  to_destination_id UUID NOT NULL REFERENCES public.mileage_destinations(id),
  miles NUMERIC(8,1) NOT NULL CHECK (miles > 0),
  CONSTRAINT uq_trip_leg_order UNIQUE (trip_id, leg_order)
);

ALTER TABLE public.mileage_trip_legs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.mileage_trip_legs
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- -------------------------------------------------------
-- Expenses
-- -------------------------------------------------------
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date DATE NOT NULL,
  company_ref TEXT NOT NULL,
  justification TEXT NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  vat_applicable BOOLEAN NOT NULL DEFAULT FALSE,
  vat_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_date ON public.expenses (expense_date DESC);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.expenses
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- -------------------------------------------------------
-- Expense Files
-- -------------------------------------------------------
CREATE TABLE public.expense_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_files_expense ON public.expense_files (expense_id);

ALTER TABLE public.expense_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.expense_files
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- -------------------------------------------------------
-- MGD: Collections
-- -------------------------------------------------------
CREATE TABLE public.mgd_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_date DATE NOT NULL,
  net_take NUMERIC(10,2) NOT NULL CHECK (net_take >= 0),
  mgd_amount NUMERIC(10,2) GENERATED ALWAYS AS (net_take * 0.20) STORED,
  vat_on_supplier NUMERIC(10,2) NOT NULL CHECK (vat_on_supplier >= 0),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mgd_collections_date ON public.mgd_collections (collection_date DESC);

ALTER TABLE public.mgd_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.mgd_collections
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- -------------------------------------------------------
-- MGD: Returns
-- -------------------------------------------------------
CREATE TABLE public.mgd_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_net_take NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_mgd NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_vat_on_supplier NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'paid')),
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES auth.users(id),
  date_paid DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_mgd_return_period UNIQUE (period_start, period_end),
  CONSTRAINT chk_period_order CHECK (period_start < period_end)
);

ALTER TABLE public.mgd_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_all" ON public.mgd_returns
  FOR ALL USING (public.is_super_admin(auth.uid()));

-- -------------------------------------------------------
-- updated_at triggers for all new tables
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'mileage_destinations',
      'mileage_trips',
      'expenses',
      'mgd_collections',
      'mgd_returns'
    ])
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- -------------------------------------------------------
-- MGD: Auto-create return + recalculate totals
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mgd_collection_sync_return()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start DATE;
  v_period_end DATE;
  v_month INTEGER;
  v_year INTEGER;
BEGIN
  -- Determine which row to use for period calculation
  IF TG_OP = 'DELETE' THEN
    v_month := EXTRACT(MONTH FROM OLD.collection_date);
    v_year := EXTRACT(YEAR FROM OLD.collection_date);
  ELSE
    v_month := EXTRACT(MONTH FROM NEW.collection_date);
    v_year := EXTRACT(YEAR FROM NEW.collection_date);
  END IF;

  -- Map month to MGD quarter
  -- Feb-Apr, May-Jul, Aug-Oct, Nov-Jan
  CASE
    WHEN v_month IN (2, 3, 4) THEN
      v_period_start := make_date(v_year, 2, 1);
      v_period_end := make_date(v_year, 4, 30);
    WHEN v_month IN (5, 6, 7) THEN
      v_period_start := make_date(v_year, 5, 1);
      v_period_end := make_date(v_year, 7, 31);
    WHEN v_month IN (8, 9, 10) THEN
      v_period_start := make_date(v_year, 8, 1);
      v_period_end := make_date(v_year, 10, 31);
    WHEN v_month IN (11, 12) THEN
      v_period_start := make_date(v_year, 11, 1);
      v_period_end := make_date(v_year + 1, 1, 31);
    WHEN v_month = 1 THEN
      v_period_start := make_date(v_year - 1, 11, 1);
      v_period_end := make_date(v_year, 1, 31);
  END CASE;

  -- Upsert the return row
  INSERT INTO public.mgd_returns (period_start, period_end)
  VALUES (v_period_start, v_period_end)
  ON CONFLICT (period_start, period_end) DO NOTHING;

  -- Recalculate totals for the affected period
  UPDATE public.mgd_returns
  SET
    total_net_take = COALESCE((
      SELECT SUM(net_take) FROM public.mgd_collections
      WHERE collection_date >= v_period_start AND collection_date <= v_period_end
    ), 0),
    total_mgd = COALESCE((
      SELECT SUM(mgd_amount) FROM public.mgd_collections
      WHERE collection_date >= v_period_start AND collection_date <= v_period_end
    ), 0),
    total_vat_on_supplier = COALESCE((
      SELECT SUM(vat_on_supplier) FROM public.mgd_collections
      WHERE collection_date >= v_period_start AND collection_date <= v_period_end
    ), 0)
  WHERE period_start = v_period_start AND period_end = v_period_end;

  -- If UPDATE changed the date across periods, also recalculate the old period
  IF TG_OP = 'UPDATE' AND OLD.collection_date <> NEW.collection_date THEN
    DECLARE
      v_old_start DATE;
      v_old_end DATE;
      v_old_month INTEGER := EXTRACT(MONTH FROM OLD.collection_date);
      v_old_year INTEGER := EXTRACT(YEAR FROM OLD.collection_date);
    BEGIN
      CASE
        WHEN v_old_month IN (2, 3, 4) THEN
          v_old_start := make_date(v_old_year, 2, 1);
          v_old_end := make_date(v_old_year, 4, 30);
        WHEN v_old_month IN (5, 6, 7) THEN
          v_old_start := make_date(v_old_year, 5, 1);
          v_old_end := make_date(v_old_year, 7, 31);
        WHEN v_old_month IN (8, 9, 10) THEN
          v_old_start := make_date(v_old_year, 8, 1);
          v_old_end := make_date(v_old_year, 10, 31);
        WHEN v_old_month IN (11, 12) THEN
          v_old_start := make_date(v_old_year, 11, 1);
          v_old_end := make_date(v_old_year + 1, 1, 31);
        WHEN v_old_month = 1 THEN
          v_old_start := make_date(v_old_year - 1, 11, 1);
          v_old_end := make_date(v_old_year, 1, 31);
      END CASE;

      IF v_old_start <> v_period_start THEN
        UPDATE public.mgd_returns
        SET
          total_net_take = COALESCE((
            SELECT SUM(net_take) FROM public.mgd_collections
            WHERE collection_date >= v_old_start AND collection_date <= v_old_end
          ), 0),
          total_mgd = COALESCE((
            SELECT SUM(mgd_amount) FROM public.mgd_collections
            WHERE collection_date >= v_old_start AND collection_date <= v_old_end
          ), 0),
          total_vat_on_supplier = COALESCE((
            SELECT SUM(vat_on_supplier) FROM public.mgd_collections
            WHERE collection_date >= v_old_start AND collection_date <= v_old_end
          ), 0)
        WHERE period_start = v_old_start AND period_end = v_old_end;
      END IF;
    END;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_mgd_collection_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.mgd_collections
  FOR EACH ROW EXECUTE FUNCTION public.mgd_collection_sync_return();

-- -------------------------------------------------------
-- Storage bucket: expense-receipts
-- -------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-receipts',
  'expense-receipts',
  FALSE,
  20971520, -- 20MB
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: super_admin only
CREATE POLICY "super_admin_upload_expense_receipts"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'expense-receipts'
  AND public.is_super_admin(auth.uid())
);

CREATE POLICY "super_admin_select_expense_receipts"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'expense-receipts'
  AND public.is_super_admin(auth.uid())
);

CREATE POLICY "super_admin_delete_expense_receipts"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'expense-receipts'
  AND public.is_super_admin(auth.uid())
);

-- -------------------------------------------------------
-- RBAC: Seed permissions
-- -------------------------------------------------------
INSERT INTO public.permissions (module_name, action, description) VALUES
  ('mileage', 'view', 'View mileage trips and destinations'),
  ('mileage', 'manage', 'Create, edit, and delete mileage trips and destinations'),
  ('expenses', 'view', 'View expenses'),
  ('expenses', 'manage', 'Create, edit, and delete expenses and receipt files'),
  ('mgd', 'view', 'View MGD collections and returns'),
  ('mgd', 'manage', 'Create, edit, and delete MGD collections; manage return status')
ON CONFLICT DO NOTHING;

-- Assign all new permissions to super_admin role
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin'
  AND p.module_name IN ('mileage', 'expenses', 'mgd')
ON CONFLICT DO NOTHING;

-- -------------------------------------------------------
-- Seed: 43 destinations from mileage spreadsheet
-- -------------------------------------------------------
INSERT INTO public.mileage_destinations (name, postcode) VALUES
  ('Ansell', 'UB7 0AE'),
  ('B&M', 'UB4 9SN'),
  ('B&M Cylex', 'KT6 7BB'),
  ('B&Q Hayes', 'UB4 9SN'),
  ('B&Q Slough', 'SL1 4DX'),
  ('Boatman', 'SL4 1QN'),
  ('Bookers', 'TW16 7HB'),
  ('Bookers Byfleet', 'WK14 7JW'),
  ('BP M&S', 'TW15 1RA'),
  ('Chessington World of Adventures', 'KT9 2NE'),
  ('Costco', 'TW16 5LN'),
  ('Currys Staines', 'TW18 4WA'),
  ('Currys Weybridge', 'KT13 0XR'),
  ('Edwards and Taylor Bedfront', 'TW14 8BN'),
  ('Egham United Services Club', 'TW20 9PE'),
  ('Greggs Petrol St', 'TW6 3PF'),
  ('Homebase', 'TW18 3AP'),
  ('Homebase Staines', 'TW18 3AP'),
  ('Ikea Reading', 'RG31 7SD'),
  ('Ikea Wembley', 'NW10 0TH'),
  ('Lock and Quay', 'UB4 9TB'),
  ('London Centre Wembley', 'HA9 0FD'),
  ('McDonald Bath Rd', 'UB7 0EA'),
  ('Mexicanos Staines', 'TW18 4LH'),
  ('Notcutts', 'TW19 2SF'),
  ('Oak Farm Mr Fizz', 'UB8 2EQ'),
  ('Portsmouth GWQ', 'PO1 3TZ'),
  ('Q Park London', 'WC2H 7PR'),
  ('Richardsons Feltham', 'TW13 4DX'),
  ('Screwfix', 'TW20 8RJ'),
  ('Screwfix Hayes', 'UB4 0TU'),
  ('Screwfix TW4', 'TW4 6NF'),
  ('Screwfix West Drayton', 'UB7 8HP'),
  ('Tesco - Ashford', 'TW19 7PZ'),
  ('Tesco - Bedfont', 'TW14 8BN'),
  ('The Chimes', 'UB8 1LA'),
  ('The Jolly Butcher', 'TW18 1PE'),
  ('Two Rivers Car Park', 'TW18 4WB'),
  ('Waitrose-West Byfleet', 'KT14 6NE'),
  ('West International Market', 'UB2 5XJ'),
  ('Westfield', 'W12 7GF'),
  ('Wickes', 'TW14 8AY'),
  ('Windsor Car Park', 'SL4 1TH')
ON CONFLICT DO NOTHING;

-- Seed distance cache: Anchor → each destination (from spreadsheet lookup)
WITH anchor AS (
  SELECT id FROM public.mileage_destinations WHERE is_home_base = TRUE LIMIT 1
),
destinations AS (
  SELECT id, name FROM public.mileage_destinations WHERE is_home_base = FALSE
),
distances_data (dest_name, miles) AS (VALUES
  ('Ansell', 8.0), ('B&M', 20.0), ('B&M Cylex', 44.0), ('B&Q Hayes', 34.0),
  ('B&Q Slough', 24.0), ('Boatman', 25.2), ('Bookers', 13.6), ('Bookers Byfleet', 22.4),
  ('BP M&S', 11.6), ('Chessington World of Adventures', 40.0), ('Costco', 2.4),
  ('Currys Staines', 4.9), ('Currys Weybridge', 23.8), ('Edwards and Taylor Bedfront', 8.4),
  ('Egham United Services Club', 12.4), ('Greggs Petrol St', 6.0), ('Homebase', 4.3),
  ('Homebase Staines', 8.6), ('Ikea Reading', 62.0), ('Ikea Wembley', 43.2),
  ('Lock and Quay', 19.4), ('London Centre Wembley', 44.0), ('McDonald Bath Rd', 4.6),
  ('Mexicanos Staines', 6.0), ('Notcutts', 9.4), ('Oak Farm Mr Fizz', 7.3),
  ('Portsmouth GWQ', 132.0), ('Q Park London', 39.4), ('Richardsons Feltham', 5.3),
  ('Screwfix', 5.4), ('Screwfix Hayes', 17.2), ('Screwfix TW4', 11.0),
  ('Screwfix West Drayton', 12.6), ('Tesco - Ashford', 3.4), ('Tesco - Bedfont', 8.4),
  ('The Chimes', 15.0), ('The Jolly Butcher', 12.2), ('Two Rivers Car Park', 7.4),
  ('Waitrose-West Byfleet', 24.0), ('West International Market', 14.6),
  ('Westfield', 32.0), ('Wickes', 8.2), ('Windsor Car Park', 17.6)
)
INSERT INTO public.mileage_destination_distances (from_destination_id, to_destination_id, miles)
SELECT
  LEAST(a.id, d.id),
  GREATEST(a.id, d.id),
  dd.miles
FROM distances_data dd
JOIN destinations d ON d.name = dd.dest_name
CROSS JOIN anchor a
ON CONFLICT (from_destination_id, to_destination_id) DO NOTHING;
