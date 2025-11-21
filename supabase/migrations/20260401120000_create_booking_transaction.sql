-- Function to handle atomic creation of table bookings with items and payment
CREATE OR REPLACE FUNCTION create_table_booking_transaction(
  p_booking_data JSONB,
  p_menu_items JSONB DEFAULT '[]'::JSONB,
  p_payment_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id UUID;
  v_booking_record JSONB;
  v_item JSONB;
  v_total_deposit DECIMAL(10,2);
BEGIN
  -- 1. Insert Booking
  INSERT INTO table_bookings (
    customer_id,
    booking_date,
    booking_time,
    party_size,
    booking_type,
    special_requirements,
    dietary_requirements,
    allergies,
    celebration_type,
    duration_minutes,
    source,
    status
  ) VALUES (
    (p_booking_data->>'customer_id')::UUID,
    (p_booking_data->>'booking_date')::DATE,
    (p_booking_data->>'booking_time')::TIME,
    (p_booking_data->>'party_size')::INTEGER,
    (p_booking_data->>'booking_type')::text,
    p_booking_data->>'special_requirements',
    CASE 
      WHEN p_booking_data->>'dietary_requirements' IS NULL THEN NULL 
      ELSE (p_booking_data->'dietary_requirements') 
    END,
    CASE 
      WHEN p_booking_data->>'allergies' IS NULL THEN NULL 
      ELSE (p_booking_data->'allergies') 
    END,
    p_booking_data->>'celebration_type',
    COALESCE((p_booking_data->>'duration_minutes')::INTEGER, 120),
    COALESCE(p_booking_data->>'source', 'phone'),
    COALESCE(p_booking_data->>'status', 'confirmed')
  )
  RETURNING id INTO v_booking_id;

  -- 2. Insert Menu Items (if any)
  IF jsonb_array_length(p_menu_items) > 0 THEN
    INSERT INTO table_booking_items (
      booking_id,
      custom_item_name,
      item_type,
      quantity,
      guest_name,
      price_at_booking,
      special_requests
    )
    SELECT
      v_booking_id,
      item->>'custom_item_name',
      (item->>'item_type')::text, -- cast to custom enum if needed, assuming text matches
      (item->>'quantity')::INTEGER,
      item->>'guest_name',
      (item->>'price_at_booking')::DECIMAL(10,2),
      item->>'special_requests'
    FROM jsonb_array_elements(p_menu_items) AS item;
  END IF;

  -- 3. Insert Payment (if provided)
  IF p_payment_data IS NOT NULL THEN
    INSERT INTO table_booking_payments (
      booking_id,
      amount,
      payment_method,
      status,
      paid_at,
      payment_metadata
    ) VALUES (
      v_booking_id,
      (p_payment_data->>'amount')::DECIMAL(10,2),
      p_payment_data->>'payment_method',
      p_payment_data->>'status',
      (p_payment_data->>'paid_at')::TIMESTAMPTZ,
      p_payment_data->'payment_metadata'
    );
  END IF;

  -- 4. Return the created booking with customer details
  SELECT to_jsonb(tb) || jsonb_build_object('customer', to_jsonb(c))
  INTO v_booking_record
  FROM table_bookings tb
  JOIN customers c ON c.id = tb.customer_id
  WHERE tb.id = v_booking_id;

  RETURN v_booking_record;

EXCEPTION WHEN OTHERS THEN
  -- Propagate error to caller
  RAISE;
END;
$$;
