-- Migration: Atomic refund balance reservation RPC
-- Fixes the race condition where two concurrent refunds could both see
-- the same balance because the advisory lock from calculate_refundable_balance
-- expires before the pending row is inserted.
--
-- This RPC acquires the lock, checks the balance, inserts the pending row,
-- and returns the new row's ID + remaining balance — all in one transaction.

CREATE OR REPLACE FUNCTION public.reserve_refund_balance(
  p_source_type TEXT,
  p_source_id UUID,
  p_original_amount NUMERIC(10,2),
  p_amount NUMERIC(10,2),
  p_refund_method TEXT,
  p_reason TEXT,
  p_initiated_by UUID,
  p_paypal_capture_id TEXT DEFAULT NULL,
  p_paypal_request_id UUID DEFAULT NULL
) RETURNS TABLE(refund_id UUID, remaining NUMERIC(10,2)) AS $$
DECLARE
  v_total_reserved NUMERIC(10,2);
  v_remaining NUMERIC(10,2);
  v_new_id UUID;
BEGIN
  -- 1. Acquire advisory lock scoped to (source_type, source_id)
  PERFORM pg_advisory_xact_lock(
    hashtext(p_source_type || ':' || p_source_id::text)
  );

  -- 2. Calculate total already reserved (completed + pending)
  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_reserved
  FROM public.payment_refunds
  WHERE source_type = p_source_type
    AND source_id = p_source_id
    AND status IN ('completed', 'pending');

  v_remaining := p_original_amount - v_total_reserved;

  -- 3. Validate the requested amount fits within the remaining balance
  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'Amount %.2f exceeds refundable balance %.2f', p_amount, v_remaining;
  END IF;

  -- 4. Insert the pending refund row
  INSERT INTO public.payment_refunds (
    source_type,
    source_id,
    paypal_capture_id,
    paypal_request_id,
    refund_method,
    amount,
    original_amount,
    reason,
    status,
    initiated_by,
    initiated_by_type
  ) VALUES (
    p_source_type,
    p_source_id,
    p_paypal_capture_id,
    p_paypal_request_id,
    p_refund_method,
    p_amount,
    p_original_amount,
    p_reason,
    'pending',
    p_initiated_by,
    'staff'
  ) RETURNING id INTO v_new_id;

  -- 5. Return the new row ID and the remaining balance AFTER this reservation
  v_remaining := v_remaining - p_amount;
  RETURN QUERY SELECT v_new_id, v_remaining;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
