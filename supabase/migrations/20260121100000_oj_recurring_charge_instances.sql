-- OJ Projects: recurring charge instances (per period) to support cap carry-forward.
-- Tracks billed status and allows deferred recurring charges to be billed in later runs.

CREATE TABLE IF NOT EXISTS public.oj_recurring_charge_instances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES public.invoice_vendors(id) ON DELETE CASCADE,
  recurring_charge_id uuid NOT NULL REFERENCES public.oj_vendor_recurring_charges(id) ON DELETE CASCADE,
  period_yyyymm text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  description_snapshot text NOT NULL,
  amount_ex_vat_snapshot numeric(12,2) NOT NULL,
  vat_rate_snapshot numeric(5,2) NOT NULL DEFAULT 20,
  sort_order_snapshot integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billing_pending', 'billed', 'paid')),
  billing_run_id uuid REFERENCES public.oj_billing_runs(id),
  invoice_id uuid REFERENCES public.invoices(id),
  billed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, recurring_charge_id, period_yyyymm)
);

CREATE INDEX IF NOT EXISTS idx_oj_recurring_charge_instances_vendor_status_period
ON public.oj_recurring_charge_instances(vendor_id, status, period_end);

CREATE INDEX IF NOT EXISTS idx_oj_recurring_charge_instances_billing_run
ON public.oj_recurring_charge_instances(billing_run_id);

CREATE INDEX IF NOT EXISTS idx_oj_recurring_charge_instances_invoice
ON public.oj_recurring_charge_instances(invoice_id);

ALTER TABLE public.oj_recurring_charge_instances ENABLE ROW LEVEL SECURITY;

-- Policies: instances are system-managed; require manage for writes.
CREATE POLICY "oj_recurring_charge_instances_select" ON public.oj_recurring_charge_instances
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'view') OR public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

CREATE POLICY "oj_recurring_charge_instances_all" ON public.oj_recurring_charge_instances
  FOR ALL TO authenticated
  USING (public.user_has_permission(auth.uid(), 'oj_projects', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'oj_projects', 'manage'));

-- Extend the existing invoice-paid trigger to also mark recurring charge instances as paid.
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

    UPDATE public.oj_recurring_charge_instances
      SET status = 'paid',
          paid_at = now(),
          updated_at = now()
    WHERE invoice_id = NEW.id
      AND status = 'billed';
  END IF;

  RETURN NEW;
END;
$$;

-- Grants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.oj_recurring_charge_instances TO authenticated;
  END IF;
END $$;

