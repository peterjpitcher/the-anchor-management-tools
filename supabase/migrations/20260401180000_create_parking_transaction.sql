-- Function to handle atomic creation of parking booking and payment order
CREATE OR REPLACE FUNCTION create_parking_booking_transaction(
  p_booking_data JSONB,
  p_payment_order_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id UUID;
  v_booking_record JSONB;
  v_order_id UUID;
BEGIN
  -- 1. Insert Parking Booking
  INSERT INTO parking_bookings (
    customer_id,
    vehicle_registration,
    vehicle_make,
    vehicle_model,
    vehicle_colour,
    start_at,
    end_at,
    status,
    total_price,
    notes,
    override_price,
    override_reason,
    capacity_override,
    capacity_override_reason
  ) VALUES (
    (p_booking_data->>'customer_id')::UUID,
    p_booking_data->>'vehicle_registration',
    p_booking_data->>'vehicle_make',
    p_booking_data->>'vehicle_model',
    p_booking_data->>'vehicle_colour',
    (p_booking_data->>'start_at')::TIMESTAMPTZ,
    (p_booking_data->>'end_at')::TIMESTAMPTZ,
    (p_booking_data->>'status')::parking_booking_status,
    (p_booking_data->>'total_price')::DECIMAL,
    p_booking_data->>'notes',
    (p_booking_data->>'override_price')::DECIMAL,
    p_booking_data->>'override_reason',
    COALESCE((p_booking_data->>'capacity_override')::BOOLEAN, false),
    p_booking_data->>'capacity_override_reason'
  )
  RETURNING id INTO v_booking_id;

  -- 2. Insert Payment Order (if provided)
  IF p_payment_order_data IS NOT NULL THEN
    INSERT INTO parking_payment_orders (
      booking_id,
      amount,
      status,
      order_reference,
      expires_at
    ) VALUES (
      v_booking_id,
      (p_payment_order_data->>'amount')::DECIMAL,
      (p_payment_order_data->>'status')::parking_payment_status,
      p_payment_order_data->>'order_reference',
      (p_payment_order_data->>'expires_at')::TIMESTAMPTZ
    )
    RETURNING id INTO v_order_id;
  END IF;

  -- 3. Return the created booking record (with payment order ID if created)
  SELECT to_jsonb(pb) || 
    CASE WHEN v_order_id IS NOT NULL 
      THEN jsonb_build_object('payment_order_id', v_order_id) 
      ELSE '{}'::JSONB 
    END
  INTO v_booking_record
  FROM parking_bookings pb
  WHERE pb.id = v_booking_id;

  RETURN v_booking_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
