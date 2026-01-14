-- Fix create_private_booking_transaction to correctly set end_time_next_day for overnight bookings
-- Without this, bookings like 19:00 -> 00:00 violate chk_booking_times on insert.

CREATE OR REPLACE FUNCTION create_private_booking_transaction(
  p_booking_data JSONB,
  p_items JSONB DEFAULT '[]'::JSONB,
  p_customer_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id UUID;
  v_customer_id UUID;
  v_booking_record JSONB;
  v_start_time TIME;
  v_end_time TIME;
  v_end_time_next_day BOOLEAN := false;
BEGIN
  -- 1. Handle Customer (Find or Create)
  IF p_customer_data IS NOT NULL THEN
    -- Try to find by ID if provided
    IF (p_customer_data->>'id') IS NOT NULL THEN
      v_customer_id := (p_customer_data->>'id')::UUID;
    ELSE
      -- Try to find by phone number
      SELECT id INTO v_customer_id
      FROM customers
      WHERE mobile_number = p_customer_data->>'mobile_number'
      LIMIT 1;

      -- Create if not found
      IF v_customer_id IS NULL THEN
        INSERT INTO customers (
          first_name,
          last_name,
          mobile_number,
          email,
          sms_opt_in
        ) VALUES (
          p_customer_data->>'first_name',
          p_customer_data->>'last_name',
          p_customer_data->>'mobile_number',
          NULLIF(p_customer_data->>'email', ''),
          COALESCE((p_customer_data->>'sms_opt_in')::BOOLEAN, true)
        )
        RETURNING id INTO v_customer_id;
      END IF;
    END IF;
  ELSE
    v_customer_id := (p_booking_data->>'customer_id')::UUID;
  END IF;

  -- 2. Derive time fields (handle overnight bookings)
  v_start_time := NULLIF(p_booking_data->>'start_time', '')::TIME;
  v_end_time := NULLIF(p_booking_data->>'end_time', '')::TIME;

  IF v_end_time IS NOT NULL AND v_start_time IS NOT NULL THEN
    -- If the end time is earlier than (or equal to) the start time, treat as next-day.
    v_end_time_next_day := v_end_time <= v_start_time;
  END IF;

  -- 3. Insert Private Booking
  INSERT INTO private_bookings (
    customer_id,
    event_date,
    start_time,
    end_time,
    end_time_next_day,
    setup_date,
    setup_time,
    guest_count,
    event_type,
    status,
    deposit_amount,
    balance_due_date,
    internal_notes,
    customer_requests,
    special_requirements,
    accessibility_needs,
    source,
    customer_first_name,
    customer_last_name,
    customer_name,
    contact_phone,
    contact_email,
    created_by,
    hold_expiry
  ) VALUES (
    v_customer_id,
    (p_booking_data->>'event_date')::DATE,
    v_start_time,
    v_end_time,
    v_end_time_next_day,
    NULLIF(p_booking_data->>'setup_date', '')::DATE,
    NULLIF(p_booking_data->>'setup_time', '')::TIME,
    (p_booking_data->>'guest_count')::INTEGER,
    p_booking_data->>'event_type',
    COALESCE(p_booking_data->>'status', 'draft'),
    COALESCE((p_booking_data->>'deposit_amount')::DECIMAL, 0),
    NULLIF(p_booking_data->>'balance_due_date', '')::DATE,
    p_booking_data->>'internal_notes',
    p_booking_data->>'customer_requests',
    p_booking_data->>'special_requirements',
    p_booking_data->>'accessibility_needs',
    p_booking_data->>'source',
    p_booking_data->>'customer_first_name',
    p_booking_data->>'customer_last_name',
    p_booking_data->>'customer_name',
    p_booking_data->>'contact_phone',
    NULLIF(p_booking_data->>'contact_email', ''),
    (p_booking_data->>'created_by')::UUID,
    (p_booking_data->>'hold_expiry')::TIMESTAMPTZ
  )
  RETURNING id INTO v_booking_id;

  -- 4. Insert Booking Items (if any)
  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO private_booking_items (
      booking_id,
      item_type,
      description,
      space_id,
      package_id,
      vendor_id,
      quantity,
      unit_price,
      notes,
      display_order
    )
    SELECT
      v_booking_id,
      item->>'item_type',
      item->>'description',
      (item->>'space_id')::UUID,
      (item->>'package_id')::UUID,
      (item->>'vendor_id')::UUID,
      (item->>'quantity')::INTEGER,
      (item->>'unit_price')::DECIMAL,
      item->>'notes',
      COALESCE((item->>'display_order')::INTEGER, 0)
    FROM jsonb_array_elements(p_items) AS item;
  END IF;

  -- 5. Return the created booking
  SELECT to_jsonb(pb) || jsonb_build_object('customer_id', v_customer_id)
  INTO v_booking_record
  FROM private_bookings pb
  WHERE pb.id = v_booking_id;

  RETURN v_booking_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

