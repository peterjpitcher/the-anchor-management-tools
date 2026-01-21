-- OJ Projects core tables + RLS
-- Creates project/time tracking tables and billing run audit/locking.

-- 1) RBAC permissions (optional if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rbac_permissions'
  ) THEN
    INSERT INTO public.rbac_permissions (module, action, description) VALUES
      ('oj_projects', 'view', 'View OJ Projects'),
      ('oj_projects', 'create', 'Create OJ Projects data'),
      ('oj_projects', 'edit', 'Edit OJ Projects data'),
      ('oj_projects', 'delete', 'Delete OJ Projects data'),
      ('oj_projects', 'manage', 'Full OJ Projects management')
    ON CONFLICT (module, action) DO NOTHING;
  END IF;
END $$;

-- 2) Work types (picklist)
CREATE TABLE IF NOT EXISTS public.oj_work_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3) Vendor billing settings
CREATE TABLE IF NOT EXISTS public.oj_vendor_billing_settings (
  vendor_id uuid PRIMARY KEY REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
  client_code text,
  billing_mode text NOT NULL DEFAULT 'full' CHECK (billing_mode IN ('full', 'cap')),
  monthly_cap_inc_vat numeric(12,2),
  hourly_rate_ex_vat numeric(12,2) NOT NULL DEFAULT 75,
  vat_rate numeric(5,2) NOT NULL DEFAULT 20,
  mileage_rate numeric(12,3) NOT NULL DEFAULT 0.420,
  retainer_included_hours_per_month numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4) Recurring charges (per invoice)
CREATE TABLE IF NOT EXISTS public.oj_vendor_recurring_charges (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount_ex_vat numeric(12,2) NOT NULL,
  vat_rate numeric(5,2) NOT NULL DEFAULT 20,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oj_vendor_recurring_charges_vendor
ON public.oj_vendor_recurring_charges(vendor_id, is_active, sort_order);

-- 5) Projects
CREATE TABLE IF NOT EXISTS public.oj_projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
  project_code text NOT NULL UNIQUE,
  project_name text NOT NULL,
  brief text,
  internal_notes text,
  deadline date,
  budget_ex_vat numeric(12,2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oj_projects_vendor
ON public.oj_projects(vendor_id, status, created_at DESC);

-- 6) Project contact tags (internal only)
CREATE TABLE IF NOT EXISTS public.oj_project_contacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.oj_projects(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.invoice_vendor_contacts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, contact_id)
);

-- 7) Billing runs (lock + audit)
CREATE TABLE IF NOT EXISTS public.oj_billing_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
  period_yyyymm text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'sent', 'failed')),
  invoice_id uuid REFERENCES public.invoices(id),
  selected_entry_ids jsonb,
  carried_forward_inc_vat numeric(12,2),
  error_message text,
  run_started_at timestamptz NOT NULL DEFAULT now(),
  run_finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, period_yyyymm)
);

CREATE INDEX IF NOT EXISTS idx_oj_billing_runs_vendor_period
ON public.oj_billing_runs(vendor_id, period_end DESC);

-- 8) Entries (time + mileage)
CREATE TABLE IF NOT EXISTS public.oj_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.oj_projects(id),
  entry_type text NOT NULL CHECK (entry_type IN ('time', 'mileage')),
  entry_date date NOT NULL,
  start_at timestamptz,
  end_at timestamptz,
  duration_minutes_raw integer,
  duration_minutes_rounded integer,
  miles numeric(12,2),
  work_type_id uuid REFERENCES public.oj_work_types(id),
  work_type_name_snapshot text,
  description text,
  internal_notes text,
  billable boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billing_pending', 'billed', 'paid')),
  billing_run_id uuid REFERENCES public.oj_billing_runs(id),
  invoice_id uuid REFERENCES public.invoices(id),
  billed_at timestamptz,
  paid_at timestamptz,
  hourly_rate_ex_vat_snapshot numeric(12,2),
  vat_rate_snapshot numeric(5,2),
  mileage_rate_snapshot numeric(12,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oj_entries_vendor_status_date
ON public.oj_entries(vendor_id, status, billable, entry_date);

CREATE INDEX IF NOT EXISTS idx_oj_entries_project_date
ON public.oj_entries(project_id, entry_date);

-- Basic integrity checks for entry types
ALTER TABLE public.oj_entries
  ADD CONSTRAINT chk_oj_entries_time_fields
  CHECK (
    (entry_type = 'time' AND start_at IS NOT NULL AND end_at IS NOT NULL AND duration_minutes_rounded IS NOT NULL AND miles IS NULL)
    OR
    (entry_type = 'mileage' AND miles IS NOT NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
  );

-- 9) Trigger: when an invoice becomes paid, mark linked OJ entries paid
CREATE OR REPLACE FUNCTION public.oj_mark_entries_paid_on_invoice_paid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.oj_entries
      SET status = 'paid',
          paid_at = now(),
          updated_at = now()
    WHERE invoice_id = NEW.id
      AND status = 'billed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oj_invoice_paid ON public.invoices;
CREATE TRIGGER trg_oj_invoice_paid
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW
EXECUTE FUNCTION public.oj_mark_entries_paid_on_invoice_paid();

-- 10) RLS
ALTER TABLE public.oj_work_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oj_vendor_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oj_vendor_recurring_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oj_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oj_project_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oj_billing_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oj_entries ENABLE ROW LEVEL SECURITY;

-- Work types
CREATE POLICY "oj_work_types_select" ON public.oj_work_types
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_work_types_insert" ON public.oj_work_types
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'create') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_work_types_update" ON public.oj_work_types
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_work_types_delete" ON public.oj_work_types
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'delete') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Vendor billing settings
CREATE POLICY "oj_vendor_billing_settings_select" ON public.oj_vendor_billing_settings
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_vendor_billing_settings_upsert" ON public.oj_vendor_billing_settings
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Recurring charges
CREATE POLICY "oj_vendor_recurring_charges_select" ON public.oj_vendor_recurring_charges
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_vendor_recurring_charges_all" ON public.oj_vendor_recurring_charges
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Projects
CREATE POLICY "oj_projects_select" ON public.oj_projects
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_projects_insert" ON public.oj_projects
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'create') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_projects_update" ON public.oj_projects
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_projects_delete" ON public.oj_projects
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'delete') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Project contacts
CREATE POLICY "oj_project_contacts_select" ON public.oj_project_contacts
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_project_contacts_all" ON public.oj_project_contacts
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Billing runs
CREATE POLICY "oj_billing_runs_select" ON public.oj_billing_runs
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_billing_runs_all" ON public.oj_billing_runs
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Entries
CREATE POLICY "oj_entries_select" ON public.oj_entries
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_entries_insert" ON public.oj_entries
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'create') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_entries_update" ON public.oj_entries
  FOR UPDATE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'edit') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_entries_delete" ON public.oj_entries
  FOR DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'delete') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- 11) Grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_work_types TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_vendor_billing_settings TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_vendor_recurring_charges TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_projects TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_project_contacts TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_billing_runs TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_entries TO authenticated;
  END IF;
END $$;

