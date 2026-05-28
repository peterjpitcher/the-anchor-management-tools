-- Fix production log error causes:
-- 1. Ensure the latest auto_generate_weekly_slots wrapper writes canonical audit_logs columns.
-- 2. Track repeated PayPal order lookup failures so reconciliation can stop retrying orphan orders.

CREATE OR REPLACE FUNCTION public.auto_generate_weekly_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Generate slots for the next 90 days using the unified logic.
  v_result := public.generate_slots_from_business_hours(CURRENT_DATE, 90);

  -- Audit logging must not make slot generation fail.
  BEGIN
    INSERT INTO public.audit_logs (
      resource_type,
      resource_id,
      operation_type,
      operation_status,
      additional_info
    ) VALUES (
      'service_slots',
      NULL,
      'auto_generate_unified',
      'success',
      v_result
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_result := v_result || jsonb_build_object('audit_log_error', SQLERRM);
  END;

  RETURN v_result;
END;
$$;

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS paypal_reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paypal_reconciliation_last_error TEXT;

COMMENT ON COLUMN public.private_bookings.paypal_reconciliation_attempts
  IS 'Consecutive failed PayPal deposit reconciliation order lookups.';

COMMENT ON COLUMN public.private_bookings.paypal_reconciliation_last_error
  IS 'Last PayPal deposit reconciliation lookup error summary.';
