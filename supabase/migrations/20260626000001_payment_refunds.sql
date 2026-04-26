-- Migration: payment_refunds table, indexes, RLS, RPC function, new columns, and RBAC permissions
-- Part of PayPal refunds feature (2026-04-26-paypal-refunds plan, Task 1)

--------------------------------------------------------------------------------
-- 1. payment_refunds table
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('private_booking', 'table_booking', 'parking')),
  source_id UUID NOT NULL,
  paypal_capture_id TEXT,
  paypal_refund_id TEXT,
  paypal_request_id UUID,
  paypal_status TEXT CHECK (paypal_status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  paypal_status_details TEXT,
  refund_method TEXT NOT NULL CHECK (refund_method IN ('paypal', 'cash', 'bank_transfer', 'other')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  original_amount NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  initiated_by UUID REFERENCES auth.users(id),
  initiated_by_type TEXT NOT NULL DEFAULT 'staff' CHECK (initiated_by_type IN ('staff', 'system')),
  notification_status TEXT CHECK (notification_status IN ('email_sent', 'sms_sent', 'skipped', 'failed')),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

--------------------------------------------------------------------------------
-- 2. Indexes
--------------------------------------------------------------------------------
CREATE INDEX idx_payment_refunds_source
  ON public.payment_refunds (source_type, source_id);

CREATE UNIQUE INDEX idx_payment_refunds_paypal_refund_id
  ON public.payment_refunds (paypal_refund_id)
  WHERE paypal_refund_id IS NOT NULL;

CREATE INDEX idx_payment_refunds_paypal_capture_id
  ON public.payment_refunds (paypal_capture_id)
  WHERE paypal_capture_id IS NOT NULL;

--------------------------------------------------------------------------------
-- 3. Row Level Security — service role only (all access via server actions)
--------------------------------------------------------------------------------
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on payment_refunds"
  ON public.payment_refunds
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

--------------------------------------------------------------------------------
-- 4. RPC: calculate_refundable_balance (advisory-lock protected)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_refundable_balance(
  p_source_type TEXT,
  p_source_id UUID,
  p_original_amount NUMERIC(10,2)
) RETURNS NUMERIC(10,2) AS $$
DECLARE
  v_total_reserved NUMERIC(10,2);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_source_type || ':' || p_source_id::text)
  );

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_reserved
  FROM public.payment_refunds
  WHERE source_type = p_source_type
    AND source_id = p_source_id
    AND status IN ('completed', 'pending');

  RETURN p_original_amount - v_total_reserved;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

--------------------------------------------------------------------------------
-- 5. Add deposit_refund_status columns to existing tables
--------------------------------------------------------------------------------
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS deposit_refund_status TEXT
  CHECK (deposit_refund_status IN ('partially_refunded', 'refunded'));

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_refund_status TEXT
  CHECK (deposit_refund_status IN ('partially_refunded', 'refunded'));

ALTER TABLE public.parking_booking_payments
  ADD COLUMN IF NOT EXISTS refund_status TEXT
  CHECK (refund_status IN ('partially_refunded', 'refunded'));

--------------------------------------------------------------------------------
-- 6. RBAC: seed 'refund' action on existing domain modules for super_admin
--    Uses the existing module names (private_bookings, table_bookings, parking)
--    with the existing 'refund' ActionType
--    Schema: permissions(id, module_name, action, description) unique on (module_name, action)
--            role_permissions(role_id, permission_id)
--------------------------------------------------------------------------------
DO $$
DECLARE
  v_super_admin_role_id UUID;
  v_perm_id UUID;
  v_module TEXT;
BEGIN
  -- Insert refund permission for each domain module (idempotent)
  FOREACH v_module IN ARRAY ARRAY['private_bookings', 'table_bookings', 'parking']
  LOOP
    INSERT INTO public.permissions (module_name, action, description)
    VALUES (v_module, 'refund', 'Process refunds (PayPal, cash, bank transfer)')
    ON CONFLICT (module_name, action) DO NOTHING;
  END LOOP;

  -- Get super_admin role ID
  SELECT id INTO v_super_admin_role_id FROM public.roles WHERE name = 'super_admin';

  -- Grant refund permissions to super_admin only
  IF v_super_admin_role_id IS NOT NULL THEN
    FOR v_perm_id IN
      SELECT p.id FROM public.permissions p
      WHERE p.module_name IN ('private_bookings', 'table_bookings', 'parking')
        AND p.action = 'refund'
    LOOP
      INSERT INTO public.role_permissions (role_id, permission_id)
      VALUES (v_super_admin_role_id, v_perm_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RAISE NOTICE 'refund permissions created for private_bookings, table_bookings, parking and assigned to super_admin';
END $$;
