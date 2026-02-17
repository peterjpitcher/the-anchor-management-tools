-- Harden register_guest_transaction customer resolution around canonical phone storage.
-- - Prefer customer lookup by customers.mobile_e164
-- - Fall back to legacy customers.mobile_number matching
-- - Persist mobile_e164 on new inserts and opportunistically backfill legacy matched rows

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
  v_customer_mobile_raw TEXT;
  v_customer_mobile_e164 TEXT;
  v_customer_first_name TEXT;
  v_customer_last_name TEXT;
  v_customer_email TEXT;
BEGIN
  -- 1. Upsert Customer
  IF (p_customer_data->>'id') IS NOT NULL THEN
    v_customer_id := (p_customer_data->>'id')::UUID;

    UPDATE customers
    SET email = COALESCE(NULLIF(LOWER(BTRIM(p_customer_data->>'email')), ''), email)
    WHERE id = v_customer_id;
  ELSE
    v_customer_mobile_raw := NULLIF(
      BTRIM(
        COALESCE(
          p_customer_data->>'mobile_e164',
          p_customer_data->>'mobile_number',
          ''
        )
      ),
      ''
    );

    -- Best-effort canonicalization to E.164-style (+<country><number>)
    IF v_customer_mobile_raw IS NOT NULL THEN
      v_customer_mobile_e164 := regexp_replace(v_customer_mobile_raw, '[^0-9+]', '', 'g');

      IF LEFT(v_customer_mobile_e164, 2) = '00' THEN
        v_customer_mobile_e164 := '+' || SUBSTRING(v_customer_mobile_e164 FROM 3);
      END IF;

      IF LEFT(v_customer_mobile_e164, 1) <> '+' THEN
        IF LEFT(v_customer_mobile_e164, 1) = '0' THEN
          v_customer_mobile_e164 := '+44' || LTRIM(v_customer_mobile_e164, '0');
        ELSIF LEFT(v_customer_mobile_e164, 2) = '44' THEN
          v_customer_mobile_e164 := '+' || v_customer_mobile_e164;
        ELSE
          v_customer_mobile_e164 := '+44' || v_customer_mobile_e164;
        END IF;
      END IF;

      IF v_customer_mobile_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
        v_customer_mobile_e164 := NULL;
      END IF;
    END IF;

    -- Prefer canonical phone lookup first.
    IF v_customer_mobile_e164 IS NOT NULL THEN
      SELECT id INTO v_customer_id
      FROM customers
      WHERE mobile_e164 = v_customer_mobile_e164
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    -- Fall back to legacy mobile_number lookup.
    IF v_customer_id IS NULL AND v_customer_mobile_raw IS NOT NULL THEN
      SELECT id INTO v_customer_id
      FROM customers
      WHERE mobile_number IN (v_customer_mobile_raw, v_customer_mobile_e164)
      ORDER BY created_at ASC
      LIMIT 1;
    END IF;

    -- Backfill canonical phone for legacy matches when safe.
    IF v_customer_id IS NOT NULL AND v_customer_mobile_e164 IS NOT NULL THEN
      UPDATE customers
      SET mobile_e164 = v_customer_mobile_e164
      WHERE id = v_customer_id
        AND mobile_e164 IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM customers existing
          WHERE existing.mobile_e164 = v_customer_mobile_e164
            AND existing.id <> v_customer_id
        );
    END IF;

    IF v_customer_id IS NULL THEN
      IF v_customer_mobile_raw IS NULL AND v_customer_mobile_e164 IS NULL THEN
        RAISE EXCEPTION 'Customer mobile number is required when registering guest';
      END IF;

      v_customer_first_name := NULLIF(BTRIM(p_customer_data->>'first_name'), '');
      v_customer_last_name := NULLIF(BTRIM(p_customer_data->>'last_name'), '');
      v_customer_email := NULLIF(LOWER(BTRIM(p_customer_data->>'email')), '');

      INSERT INTO customers (
        first_name,
        last_name,
        mobile_number,
        mobile_e164,
        email,
        sms_opt_in
      ) VALUES (
        COALESCE(v_customer_first_name, 'Guest'),
        COALESCE(v_customer_last_name, 'Guest'),
        COALESCE(v_customer_mobile_e164, v_customer_mobile_raw),
        v_customer_mobile_e164,
        v_customer_email,
        COALESCE((p_customer_data->>'sms_opt_in')::BOOLEAN, true)
      )
      RETURNING id INTO v_customer_id;
    ELSE
      UPDATE customers
      SET email = COALESCE(NULLIF(LOWER(BTRIM(p_customer_data->>'email')), ''), email)
      WHERE id = v_customer_id;
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
      'bulk_add',
      'Created via event check-in'
    )
    RETURNING id INTO v_booking_id;
  END IF;

  -- 3. Record Check-in
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
