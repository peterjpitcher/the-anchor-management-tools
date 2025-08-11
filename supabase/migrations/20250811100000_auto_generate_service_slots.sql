-- Description: Automated service slot generation for table bookings
-- This ensures capacity slots are always available without manual intervention

-- ========================================
-- 1. FUNCTION: Auto-generate service slots
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
BEGIN
  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    
    -- Sunday lunch slots (Sunday = 0)
    IF v_day_of_week = 0 THEN
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

-- ========================================
-- 2. WEEKLY CRON JOB: Auto-generate slots
-- ========================================
-- This function will be called by your cron job
CREATE OR REPLACE FUNCTION auto_generate_weekly_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slots_created INTEGER;
  v_result JSONB;
BEGIN
  -- Generate slots for the next 90 days
  v_slots_created := generate_service_slots_for_period(CURRENT_DATE, 90);
  
  -- Log the result
  INSERT INTO audit_logs (
    entity_type,
    entity_id,
    operation_type,
    operation_status,
    additional_info
  ) VALUES (
    'service_slots',
    NULL,
    'auto_generate',
    'success',
    jsonb_build_object(
      'slots_created', v_slots_created,
      'run_date', CURRENT_DATE,
      'period_days', 90
    )
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'slots_created', v_slots_created,
    'message', format('Generated %s service slots for the next 90 days', v_slots_created)
  );
  
  RETURN v_result;
END;
$$;

-- ========================================
-- 3. CONFIGURATION TABLE FOR SLOT SETTINGS
-- ========================================
-- This allows you to customize capacity and times without changing code
CREATE TABLE IF NOT EXISTS service_slot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  slot_type VARCHAR(50) NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 50,
  booking_type table_booking_type NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(day_of_week, starts_at, booking_type)
);

-- Insert default configuration
INSERT INTO service_slot_config (day_of_week, slot_type, starts_at, ends_at, capacity, booking_type) VALUES
-- Sunday lunch
(0, 'sunday_lunch_early', '12:00:00', '14:30:00', 50, 'sunday_lunch'),
(0, 'sunday_lunch_late', '14:30:00', '17:00:00', 50, 'sunday_lunch'),
-- Tuesday dinner
(2, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Wednesday dinner
(3, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Thursday dinner
(4, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Friday lunch and dinner
(5, 'lunch', '12:00:00', '14:30:00', 50, 'regular'),
(5, 'dinner', '17:00:00', '21:00:00', 50, 'regular'),
-- Saturday lunch and dinner
(6, 'lunch', '12:00:00', '14:30:00', 50, 'regular'),
(6, 'dinner', '17:00:00', '21:00:00', 50, 'regular')
ON CONFLICT (day_of_week, starts_at, booking_type) DO NOTHING;

-- ========================================
-- 4. IMPROVED GENERATOR USING CONFIG
-- ========================================
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
BEGIN
  v_end_date := start_date + days_ahead;
  v_current_date := start_date;
  
  WHILE v_current_date <= v_end_date LOOP
    v_day_of_week := EXTRACT(DOW FROM v_current_date);
    
    -- Get all configs for this day of week
    FOR v_config IN 
      SELECT * FROM service_slot_config 
      WHERE day_of_week = v_day_of_week 
      AND is_active = true
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

-- ========================================
-- 5. SPECIAL DATES HANDLING (Bank Holidays, etc)
-- ========================================
CREATE TABLE IF NOT EXISTS service_slot_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  override_date DATE NOT NULL,
  reason VARCHAR(255),
  is_closed BOOLEAN DEFAULT false,
  custom_capacity INTEGER,
  custom_hours JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(override_date)
);

-- Example: Christmas Day - closed
-- INSERT INTO service_slot_overrides (override_date, reason, is_closed) 
-- VALUES ('2025-12-25', 'Christmas Day', true);

-- ========================================
-- 6. CLEANUP OLD SLOTS (Optional)
-- ========================================
CREATE OR REPLACE FUNCTION cleanup_old_service_slots()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Delete service slots older than 1 month
  DELETE FROM service_slots
  WHERE service_date < CURRENT_DATE - INTERVAL '1 month';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$;

-- ========================================
-- 7. RUN INITIAL GENERATION
-- ========================================
-- Generate slots for the next 90 days immediately
SELECT generate_service_slots_from_config(CURRENT_DATE, 90);

-- ========================================
-- INSTRUCTIONS FOR CRON JOB SETUP
-- ========================================
-- Add this to your API cron endpoint (weekly run):
-- 
-- export async function GET(request: Request) {
--   const supabase = createAdminClient();
--   const { data, error } = await supabase.rpc('auto_generate_weekly_slots');
--   return NextResponse.json(data || { error: error?.message });
-- }
--
-- Then add to vercel.json:
-- {
--   "crons": [{
--     "path": "/api/cron/generate-slots",
--     "schedule": "0 2 * * 1"  // Every Monday at 2 AM
--   }]
-- }