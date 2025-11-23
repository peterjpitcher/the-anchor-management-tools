-- Migration: Add Slot Generator Function
-- Description: Implements the smart slot generation logic using business_hours as the source of truth.

CREATE OR REPLACE FUNCTION generate_slots_from_business_hours(
  p_start_date DATE DEFAULT CURRENT_DATE,
  p_days_ahead INTEGER DEFAULT 90
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_date DATE;
  v_end_date DATE;
  v_day_of_week INTEGER;
  v_special_config JSONB;
  v_regular_config JSONB;
  v_active_config JSONB;
  v_is_closed BOOLEAN;
  v_slot RECORD;
  v_slots_generated INTEGER := 0;
  v_slots_deactivated INTEGER := 0;
BEGIN
  v_end_date := p_start_date + p_days_ahead;
  v_current_date := p_start_date;

  -- Loop through each day in the range
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_active_config := NULL;
    v_is_closed := false;

    -- 1. Check Special Hours (Exceptions)
    SELECT schedule_config, is_closed INTO v_special_config, v_is_closed
    FROM special_hours
    WHERE date = v_current_date;

    IF FOUND THEN
      -- If special hours exist for this date, they take ABSOLUTE precedence
      IF v_is_closed THEN
        v_active_config := '[]'::JSONB;
      ELSE
        v_active_config := v_special_config;
      END IF;
    ELSE
      -- 2. Fallback to Business Hours (Standard Schedule)
      SELECT schedule_config, is_closed INTO v_regular_config, v_is_closed
      FROM business_hours
      WHERE day_of_week = v_day_of_week;

      IF FOUND AND NOT v_is_closed THEN
        v_active_config := v_regular_config;
      ELSE
        v_active_config := '[]'::JSONB;
      END IF;
    END IF;

    -- 3. Apply to Service Slots
    
    -- A. If config is empty, deactivate all slots for this day
    IF v_active_config IS NULL OR jsonb_array_length(v_active_config) = 0 THEN
      WITH deactivated AS (
        UPDATE service_slots
        SET is_active = false, updated_at = NOW()
        WHERE service_date = v_current_date AND is_active = true
        RETURNING 1
      )
      SELECT count(*) INTO v_slots_deactivated FROM deactivated;
      
    ELSE
      -- B. Upsert slots from config
      FOR v_slot IN SELECT * FROM jsonb_to_recordset(v_active_config) AS x(
        starts_at TIME,
        ends_at TIME,
        capacity INTEGER,
        booking_type table_booking_type
      )
      LOOP
        INSERT INTO service_slots (
          service_date,
          starts_at,
          ends_at,
          capacity,
          booking_type,
          is_active
        ) VALUES (
          v_current_date,
          v_slot.starts_at,
          v_slot.ends_at,
          v_slot.capacity,
          v_slot.booking_type,
          true
        )
        ON CONFLICT (service_date, starts_at, booking_type) DO UPDATE
        SET 
          ends_at = EXCLUDED.ends_at,
          capacity = EXCLUDED.capacity,
          is_active = true,
          updated_at = NOW();
          
        v_slots_generated := v_slots_generated + 1;
      END LOOP;
      
      -- C. Cleanup: Deactivate slots that exist for this date but are NOT in the current config
      -- This handles cases where shifts change (e.g. Lunch was 12:00, now it is 12:30)
      WITH active_starts AS (
        SELECT (x.starts_at)::TIME as s, (x.booking_type)::table_booking_type as b
        FROM jsonb_to_recordset(v_active_config) AS x(starts_at TIME, booking_type text)
      )
      UPDATE service_slots s
      SET is_active = false, updated_at = NOW()
      WHERE s.service_date = v_current_date 
      AND s.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM active_starts a WHERE a.s = s.starts_at AND a.b = s.booking_type
      );
      
    END IF;

    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'message', format('Generated slots from %s to %s', p_start_date, v_end_date),
    'slots_processed', v_slots_generated,
    'slots_deactivated', v_slots_deactivated
  );
END;
$$;

-- Update the legacy wrapper to use the new logic
CREATE OR REPLACE FUNCTION auto_generate_weekly_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Generate slots for the next 90 days using the new unified logic
  v_result := generate_slots_from_business_hours(CURRENT_DATE, 90);
  
  -- Log audit
  INSERT INTO audit_logs (
    entity_type,
    entity_id,
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
  
  RETURN v_result;
END;
$$;
