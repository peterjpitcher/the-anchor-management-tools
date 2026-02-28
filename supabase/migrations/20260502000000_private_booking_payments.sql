-- Create private_booking_payments table for tracking individual balance payments
CREATE TABLE public.private_booking_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.private_bookings(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'invoice')),
  notes TEXT,
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.private_booking_payments ENABLE ROW LEVEL SECURITY;

-- SELECT: users with private_bookings/view permission
CREATE POLICY "Users can view booking payments with booking view permission"
  ON public.private_booking_payments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.private_bookings pb
      WHERE pb.id = private_booking_payments.booking_id
        AND public.user_has_permission(auth.uid(), 'private_bookings', 'view')
    )
  );

-- INSERT: users with private_bookings/manage_deposits permission
CREATE POLICY "Users can insert booking payments with manage_deposits permission"
  ON public.private_booking_payments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'private_bookings', 'manage_deposits')
  );

-- Grants
GRANT SELECT, INSERT ON public.private_booking_payments TO authenticated;
GRANT ALL ON public.private_booking_payments TO service_role;

-- Update calculate_private_booking_balance to deduct SUM of payments
-- Note: the security deposit is a returnable bond, NOT applied to the event cost
CREATE OR REPLACE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  v_total NUMERIC;
  v_payments_sum NUMERIC;
BEGIN
  -- Get total from booking items
  SELECT COALESCE(SUM(line_total), 0) INTO v_total
  FROM private_booking_items
  WHERE booking_id = p_booking_id;

  -- Sum of balance payments recorded
  SELECT COALESCE(SUM(amount), 0) INTO v_payments_sum
  FROM private_booking_payments
  WHERE booking_id = p_booking_id;

  -- Return remaining balance (never negative)
  RETURN GREATEST(0, v_total - v_payments_sum);
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_private_booking_balance(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.calculate_private_booking_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_private_booking_balance(uuid) TO service_role;
