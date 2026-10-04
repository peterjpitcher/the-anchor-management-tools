-- Isolated fixture database only. Run in a fresh temporary PostgreSQL cluster.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END; $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END; $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE FUNCTION public.user_has_permission(uuid, text, text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN $3='manage' THEN false ELSE coalesce(current_setting('test.has_permission', true), 'true') = 'true' END
$$;
CREATE TABLE public.oj_vendor_recurring_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL,
  description text NOT NULL, amount_ex_vat numeric NOT NULL, vat_rate numeric NOT NULL DEFAULT 20,
  frequency text NOT NULL DEFAULT 'monthly', is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.oj_billing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL, status text NOT NULL
);
CREATE TABLE public.oj_recurring_charge_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vendor_id uuid NOT NULL,
  recurring_charge_id uuid NOT NULL REFERENCES public.oj_vendor_recurring_charges(id),
  period_yyyymm text NOT NULL, period_start date NOT NULL, period_end date NOT NULL,
  coverage_start date, coverage_end date, description_snapshot text NOT NULL,
  amount_ex_vat_snapshot numeric NOT NULL, vat_rate_snapshot numeric NOT NULL DEFAULT 20,
  sort_order_snapshot integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'unbilled'
    CHECK (status IN ('unbilled','billing_pending','billed','paid')),
  invoice_id uuid, billing_run_id uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  UNIQUE (vendor_id, recurring_charge_id, period_yyyymm)
);
CREATE TABLE public.audit_logs (
  id uuid DEFAULT gen_random_uuid(), user_id uuid, operation_type text NOT NULL,
  resource_type text NOT NULL, resource_id text, operation_status text NOT NULL, new_values jsonb, additional_info jsonb
);

ALTER TABLE public.oj_vendor_recurring_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oj_recurring_charge_instances ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.oj_vendor_recurring_charges TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.oj_recurring_charge_instances TO authenticated;
CREATE POLICY charge_edit ON public.oj_vendor_recurring_charges FOR ALL TO authenticated
 USING(public.user_has_permission(auth.uid(), 'oj_projects', 'edit'))
 WITH CHECK(public.user_has_permission(auth.uid(), 'oj_projects', 'edit'));
CREATE POLICY instances_view ON public.oj_recurring_charge_instances FOR SELECT TO authenticated USING(true);
CREATE POLICY instances_manage ON public.oj_recurring_charge_instances FOR ALL TO authenticated
 USING(public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
 WITH CHECK(public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE TABLE public.invoices(id uuid PRIMARY KEY, vendor_id uuid, deleted_at timestamptz);
CREATE FUNCTION public.reissue_oj_invoice_transaction(uuid,text,jsonb,jsonb,uuid[],uuid[],jsonb)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('stub', true) $$;
