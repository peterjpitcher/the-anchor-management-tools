-- Description: Manage Sunday lunch service availability and integrate with slot generation

-- ========================================
-- 1. SERVICE STATUS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS service_statuses (
  service_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE service_statuses ENABLE ROW LEVEL SECURITY;

-- Allow service role full access; other roles will be governed via Supabase policies in app
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'service_statuses'
      AND policyname = 'Service role manage service statuses'
  ) THEN
    CREATE POLICY "Service role manage service statuses"
      ON service_statuses
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- Seed Sunday lunch status if it does not already exist
INSERT INTO service_statuses (service_code, display_name, is_enabled, message)
VALUES (
  'sunday_lunch',
  'Sunday Lunch Service',
  true,
  'Sunday lunch bookings require pre-order with £5 per person deposit by 1pm Saturday.'
)
ON CONFLICT (service_code) DO NOTHING;

-- ========================================
-- 1B. SERVICE STATUS OVERRIDES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS service_status_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_code TEXT NOT NULL REFERENCES service_statuses(service_code) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  message TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT service_status_overrides_date_check CHECK (end_date >= start_date),
  UNIQUE (service_code, start_date, end_date)
);

CREATE INDEX IF NOT EXISTS idx_service_status_overrides_service_date
  ON service_status_overrides(service_code, start_date, end_date);

ALTER TABLE service_status_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'service_status_overrides'
      AND policyname = 'Service role manage service status overrides'
  ) THEN
    CREATE POLICY "Service role manage service status overrides"
      ON service_status_overrides
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- ========================================
-- 2. UPDATE SLOT GENERATION FUNCTIONS TO RESPECT SERVICE STATUS
-- ========================================
CREATE OR REPLACE FUNCTION generate_service_slots_for_period(
  start_date DATE DEFAULT CURRENT_DATE,
  days_ahead INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date DATE;
  v_current_date DATE;
  v_day_of_week INTEGER;
  v_slots_created INTEGER := 0;
  v_sunday_enabled BOOLEAN := true;
  v_override_enabled BOOLEAN;
  v_effective_enabled BOOLEAN;
BEGIN
  -- Determine if Sunday lunch service is currently enabled
  SELECT COALESCE(is_enabled, true)
    INTO v_sunday_enabled
  FROM service_statuses
  WHERE service_code = 'sunday_lunch';

  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
    
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_override_enabled := NULL;
    v_effective_enabled := v_sunday_enabled;
    
    IF v_day_of_week = 0 THEN
      SELECT is_enabled
        INTO v_override_enabled
      FROM service_status_overrides
      WHERE service_code = 'sunday_lunch'
        AND start_date <= v_current_date
        AND end_date >= v_current_date
      ORDER BY start_date DESC, end_date DESC
      LIMIT 1;
      
      IF v_override_enabled IS NOT NULL THEN
        v_effective_enabled := v_override_enabled;
      END IF;
    END IF;
    
    -- Sunday lunch slots (Sunday = 0)
    IF v_day_of_week = 0 AND v_effective_enabled THEN
      -- Early Sunday lunch sitting
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '12:00:00'::TIME,
        '14:30:00'::TIME,
        50,
        'sunday_lunch'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      -- Late Sunday lunch sitting
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '14:30:00'::TIME,
        '17:00:00'::TIME,
        50,
        'sunday_lunch'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 2;
    END IF;
    
    -- Regular dinner service (Tuesday = 2 to Saturday = 6)
    IF v_day_of_week >= 2 AND v_day_of_week <= 6 THEN
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '17:00:00'::TIME,
        '21:00:00'::TIME,
        50,
        'regular'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 1;
    END IF;
    
    -- Friday and Saturday lunch (Friday = 5, Saturday = 6)
    IF v_day_of_week = 5 OR v_day_of_week = 6 THEN
      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        '12:00:00'::TIME,
        '14:30:00'::TIME,
        50,
        'regular'::table_booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO NOTHING;
      
      v_slots_created := v_slots_created + 1;
    END IF;
    
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN v_slots_created;
END;
$$;

CREATE OR REPLACE FUNCTION generate_service_slots_from_config(
  start_date DATE DEFAULT CURRENT_DATE,
  days_ahead INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_end_date DATE;
  v_current_date DATE;
  v_day_of_week INTEGER;
  v_config RECORD;
  v_slots_created INTEGER := 0;
  v_sunday_enabled BOOLEAN := true;
  v_override_enabled BOOLEAN;
  v_effective_enabled BOOLEAN;
BEGIN
  -- Determine if Sunday lunch service is currently enabled
  SELECT COALESCE(is_enabled, true)
    INTO v_sunday_enabled
  FROM service_statuses
  WHERE service_code = 'sunday_lunch';

  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
    
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    v_override_enabled := NULL;
    v_effective_enabled := v_sunday_enabled;
    
    IF v_day_of_week = 0 THEN
      SELECT is_enabled
        INTO v_override_enabled
      FROM service_status_overrides
      WHERE service_code = 'sunday_lunch'
        AND start_date <= v_current_date
        AND end_date >= v_current_date
      ORDER BY start_date DESC, end_date DESC
      LIMIT 1;
      
      IF v_override_enabled IS NOT NULL THEN
        v_effective_enabled := v_override_enabled;
      END IF;
    END IF;
    
    -- Get all configs for this day of week
    FOR v_config IN 
      SELECT * FROM service_slot_config 
      WHERE day_of_week = v_day_of_week 
      AND is_active = true
    LOOP
      -- Skip Sunday lunch templates when service is disabled
      IF v_config.booking_type = 'sunday_lunch'::table_booking_type AND NOT v_effective_enabled THEN
        CONTINUE;
      END IF;

      INSERT INTO service_slots (
        service_date,
        starts_at,
        ends_at,
        capacity,
        booking_type,
        is_active
      ) VALUES (
        v_current_date,
        v_config.starts_at,
        v_config.ends_at,
        v_config.capacity,
        v_config.booking_type,
        true
      ) ON CONFLICT (service_date, starts_at, booking_type) DO UPDATE
      SET capacity = EXCLUDED.capacity,
          ends_at = EXCLUDED.ends_at,
          updated_at = NOW();
      
      v_slots_created := v_slots_created + 1;
    END LOOP;
    
    v_current_date := v_current_date + 1;
  END LOOP;
  
  RETURN v_slots_created;
END;
$$;
