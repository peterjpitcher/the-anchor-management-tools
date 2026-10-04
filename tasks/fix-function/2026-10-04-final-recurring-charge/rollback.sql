-- Before first use only. After any charge has ended, preserve the end dates,
-- instance snapshots and audit trail and ship a forward fix instead.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.oj_vendor_recurring_charges WHERE end_date IS NOT NULL) THEN
    RAISE EXCEPTION 'An ended charge exists. Do not remove billing protection; use a forward fix.';
  END IF;
END; $$;
DROP TRIGGER oj_lock_recurring_charges_for_billing ON public.oj_billing_runs;
DROP TRIGGER oj_guard_ended_charge_instance ON public.oj_recurring_charge_instances;
DROP TRIGGER oj_guard_ended_charge_definition ON public.oj_vendor_recurring_charges;
DROP FUNCTION public.oj_reissue_invoice_with_charge_versions(uuid,text,jsonb,jsonb,uuid[],uuid[],jsonb,jsonb);
DROP FUNCTION public.oj_end_recurring_charge(uuid,date,boolean,jsonb);
DROP FUNCTION public.oj_lock_recurring_charges_for_billing();
DROP FUNCTION public.oj_guard_ended_charge_instance();
DROP FUNCTION public.oj_guard_ended_charge_definition();
ALTER TABLE public.oj_vendor_recurring_charges DROP COLUMN end_date;
COMMIT;
