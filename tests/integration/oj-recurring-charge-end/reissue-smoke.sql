-- Exercise the existing, verified-live reissue transaction inside a rollback.
\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.invoices
 ADD COLUMN invoice_number text, ADD COLUMN invoice_date date, ADD COLUMN due_date date,
 ADD COLUMN reference text, ADD COLUMN invoice_discount_percentage numeric DEFAULT 0,
 ADD COLUMN subtotal_amount numeric, ADD COLUMN discount_amount numeric, ADD COLUMN vat_amount numeric,
 ADD COLUMN total_amount numeric, ADD COLUMN notes text, ADD COLUMN internal_notes text,
 ADD COLUMN status text DEFAULT 'draft', ADD COLUMN paid_amount numeric DEFAULT 0,
 ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.invoices ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.oj_recurring_charge_instances ADD COLUMN billed_at timestamptz, ADD COLUMN paid_at timestamptz;
CREATE TABLE public.invoice_payments(invoice_id uuid);
CREATE TABLE public.invoice_line_items(invoice_id uuid, catalog_item_id uuid, description text,
 quantity numeric, unit_price numeric, discount_percentage numeric, vat_rate numeric);
CREATE TABLE public.oj_entries(id uuid, vendor_id uuid, invoice_id uuid, billing_run_id uuid,
 status text, billed_at timestamptz, paid_at timestamptz, updated_at timestamptz);
\ir ../../../supabase/migrations/20260703002000_reissue_oj_invoice_transaction.sql
SET request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
SET test.has_permission = 'true';
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,created_at)
VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Final fixture',100,'2026-10-01');
INSERT INTO public.invoices(id,vendor_id,invoice_number,invoice_date,due_date)
VALUES ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000020','FIXTURE-ONLY','2026-11-01','2026-11-08');
DO $$ DECLARE preview jsonb; versions jsonb; final_id uuid; result jsonb;
BEGIN
 preview := public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15');
 PERFORM public.oj_end_recurring_charge('00000000-0000-4000-8000-000000000010','2026-10-15',false,preview);
 SELECT id INTO final_id FROM public.oj_recurring_charge_instances WHERE recurring_charge_id='00000000-0000-4000-8000-000000000010';
 SELECT jsonb_object_agg(id::text,updated_at) INTO versions FROM public.oj_vendor_recurring_charges;
 result := public.oj_reissue_invoice_with_charge_versions('00000000-0000-4000-8000-000000000030', 'rebuild_draft',
  '{"subtotal_amount":48.39,"discount_amount":0,"vat_amount":9.68,"total_amount":58.07}',
  '[{"description":"Final fixture","quantity":1,"unit_price":48.39,"discount_percentage":0,"vat_rate":20}]',
  '{}', array[final_id], '[]', versions);
 IF NOT EXISTS (SELECT 1 FROM public.oj_recurring_charge_instances WHERE id=final_id AND invoice_id='00000000-0000-4000-8000-000000000030'
   AND status='billing_pending' AND coverage_end='2026-10-15' AND amount_ex_vat_snapshot=48.39) THEN
   RAISE EXCEPTION 'FAILED: actual reissue did not attach the final prorated charge';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.invoice_line_items WHERE unit_price=48.39 AND vat_rate=20) THEN
   RAISE EXCEPTION 'FAILED: final invoice line amount';
 END IF;
END; $$;
-- A virtual annual charge must retain the full service span through the wrapper.
INSERT INTO public.oj_vendor_recurring_charges(id,vendor_id,description,amount_ex_vat,frequency,created_at)
VALUES ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000020','Annual fixture',1200,'annually','2026-10-01');
DO $$ DECLARE versions jsonb; result jsonb;
BEGIN
 SELECT jsonb_object_agg(id::text,updated_at) INTO versions FROM public.oj_vendor_recurring_charges;
 result := public.oj_reissue_invoice_with_charge_versions('00000000-0000-4000-8000-000000000030','rebuild_draft',
  '{"subtotal_amount":1200,"discount_amount":0,"vat_amount":240,"total_amount":1440}',
  '[{"description":"Annual fixture","quantity":1,"unit_price":1200,"discount_percentage":0,"vat_rate":20}]',
  '{}','{}','[{"vendor_id":"00000000-0000-4000-8000-000000000020","recurring_charge_id":"00000000-0000-4000-8000-000000000011", "period_yyyymm":"2026-10","period_start":"2026-10-01","period_end":"2026-10-31","coverage_start":"2026-10-01","coverage_end":"2027-09-30","description_snapshot":"Annual fixture","amount_ex_vat_snapshot":1200,"vat_rate_snapshot":20,"sort_order_snapshot":0}]', versions);
 IF NOT EXISTS (SELECT 1 FROM public.oj_recurring_charge_instances WHERE recurring_charge_id='00000000-0000-4000-8000-000000000011'
  AND coverage_start='2026-10-01' AND coverage_end='2027-09-30' AND status='billing_pending') THEN
  RAISE EXCEPTION 'FAILED: virtual coverage was not retained';
 END IF;
END; $$;
ROLLBACK;
