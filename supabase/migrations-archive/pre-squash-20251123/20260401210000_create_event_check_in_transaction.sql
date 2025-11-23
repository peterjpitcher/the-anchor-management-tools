-- Function to handle atomic event check-in (Customer Upsert + Booking + Check-in + Labels)
CREATE OR REPLACE FUNCTION register_guest_transaction(
  p_event_id UUID,
  p_customer_data JSONB,
  p_staff_id UUID,
  p_labels JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_customer_id UUID;
  v_booking_id UUID;
  v_check_in_id UUID;
  v_customer_record JSONB;
  v_check_in_record JSONB;
BEGIN
  -- 1. Upsert Customer
  IF (p_customer_data->>'id') IS NOT NULL THEN
    v_customer_id := (p_customer_data->>'id')::UUID;
    -- Update email if provided and different
    UPDATE customers 
    SET email = COALESCE(p_customer_data->>'email', email)
    WHERE id = v_customer_id;
  ELSE
    -- Try to find by phone number first
    SELECT id INTO v_customer_id
    FROM customers
    WHERE mobile_number = p_customer_data->>'mobile_number';

    IF v_customer_id IS NULL THEN
      -- Create new customer
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
        p_customer_data->>'email',
        COALESCE((p_customer_data->>'sms_opt_in')::BOOLEAN, true)
      )
      RETURNING id INTO v_customer_id;
    ELSE
      -- Update existing customer email/name if needed?
      -- For now, only email updates on "register existing" are common.
      NULL; 
    END IF;
  END IF;

  -- 2. Ensure Booking Exists
  SELECT id INTO v_booking_id
  FROM bookings
  WHERE event_id = p_event_id AND customer_id = v_customer_id
  LIMIT 1;

  IF v_booking_id IS NULL THEN
    INSERT INTO bookings (
      event_id,
      customer_id,
      seats,
      booking_source,
      notes
    ) VALUES (
      p_event_id,
      v_customer_id,
      1,
      'bulk_add', -- or 'check_in'
      'Created via event check-in'
    )
    RETURNING id INTO v_booking_id;
  END IF;

  -- 3. Record Check-in
  -- Check if already checked in
  SELECT id INTO v_check_in_id
  FROM event_check_ins
  WHERE event_id = p_event_id AND customer_id = v_customer_id
  LIMIT 1;

  IF v_check_in_id IS NULL THEN
    INSERT INTO event_check_ins (
      event_id,
      customer_id,
      booking_id,
      check_in_method,
      staff_id
    ) VALUES (
      p_event_id,
      v_customer_id,
      v_booking_id,
      'manual',
      p_staff_id
    )
    RETURNING id INTO v_check_in_id;
  ELSE
    -- Already checked in, but we can return success/data anyway
    -- or raise error if we want strict prevention.
    -- The previous logic returned error 'Guest is already checked in'.
    -- Let's raise an exception to match previous behavior if that is desired, 
    -- OR return existing record. The action handled 23505 error.
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Guest is already checked in for this event';
  END IF;

  -- 4. Assign Labels
  IF jsonb_array_length(p_labels) > 0 THEN
    INSERT INTO customer_label_assignments (
      customer_id,
      label_id,
      auto_assigned,
      assigned_by,
      notes
    )
    SELECT
      v_customer_id,
      (label->>'id')::UUID,
      true,
      p_staff_id,
      label->>'notes'
    FROM jsonb_array_elements(p_labels) AS label
    ON CONFLICT (customer_id, label_id) DO NOTHING;
  END IF;

  -- 5. Return Data
  SELECT to_jsonb(c) INTO v_customer_record FROM customers c WHERE c.id = v_customer_id;
  
  RETURN jsonb_build_object(
    'check_in_id', v_check_in_id,
    'booking_id', v_booking_id,
    'customer', v_customer_record
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;
