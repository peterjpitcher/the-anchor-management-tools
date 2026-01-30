-- Add contract note field to private bookings and surface it in related views/RPC

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS contract_note text;

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
          COALESCE(p_customer_data->>'last_name', ''),
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
    contract_note,
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
    p_booking_data->>'contract_note',
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

CREATE OR REPLACE VIEW public.private_bookings_with_details AS
 SELECT
  pb.id,
  pb.customer_id,
  pb.customer_name,
  pb.contact_phone,
  pb.contact_email,
  pb.event_date,
  pb.start_time,
  pb.setup_time,
  pb.end_time,
  pb.end_time_next_day,
  pb.guest_count,
  pb.event_type,
  pb.status,
  pb.deposit_amount,
  pb.deposit_paid_date,
  pb.deposit_payment_method,
  pb.total_amount,
  pb.balance_due_date,
  pb.final_payment_date,
  pb.final_payment_method,
  pb.calendar_event_id,
  pb.contract_version,
  pb.internal_notes,
  pb.customer_requests,
  pb.created_by,
  pb.created_at,
  pb.updated_at,
  pb.setup_date,
  pb.discount_type,
  pb.discount_amount,
  pb.discount_reason,
  pb.customer_first_name,
  pb.customer_last_name,
  pb.customer_full_name,
  c.mobile_number AS customer_mobile,
  (
    SELECT COALESCE(sum(pbi.line_total), (0)::numeric)
    FROM public.private_booking_items pbi
    WHERE pbi.booking_id = pb.id
  ) AS calculated_total,
  CASE
    WHEN pb.deposit_paid_date IS NOT NULL THEN 'Paid'::text
    WHEN pb.status = 'confirmed'::text THEN 'Required'::text
    ELSE 'Not Required'::text
  END AS deposit_status,
  (pb.event_date - CURRENT_DATE) AS days_until_event,
  pb.contract_note
 FROM public.private_bookings pb
 LEFT JOIN public.customers c ON pb.customer_id = c.id;

ALTER VIEW public.private_bookings_with_details SET (security_invoker = true);
REVOKE ALL ON public.private_bookings_with_details FROM anon;
GRANT SELECT ON public.private_bookings_with_details TO authenticated;
GRANT SELECT ON public.private_bookings_with_details TO service_role;
