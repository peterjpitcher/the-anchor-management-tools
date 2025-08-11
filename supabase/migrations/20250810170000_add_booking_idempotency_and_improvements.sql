-- Description: Add idempotency keys table and booking improvements for Sunday lunch API stability
-- Phase 1 & 2 improvements from senior developer review

-- ========================================
-- 1. IDEMPOTENCY KEYS TABLE
-- ========================================
-- Prevents duplicate bookings from retries/double-clicks
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  request_hash VARCHAR(64) NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours') NOT NULL
);

-- Index for cleanup job
CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys(expires_at);

-- Enable RLS
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Policy: Service role only
CREATE POLICY "Service role only" ON idempotency_keys
  FOR ALL USING (auth.role() = 'service_role');

-- ========================================
-- 2. BOOKING AUDIT TABLE
-- ========================================
-- Track all state changes for debugging and compliance
CREATE TABLE IF NOT EXISTS booking_audit (
  id BIGSERIAL PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES table_bookings(id) ON DELETE CASCADE,
  event VARCHAR(50) NOT NULL,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  created_by UUID REFERENCES auth.users(id)
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_booking_audit_booking ON booking_audit(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_audit_event ON booking_audit(event, created_at DESC);

-- Enable RLS
ALTER TABLE booking_audit ENABLE ROW LEVEL SECURITY;

-- Policy: Read own audit logs, service role sees all
CREATE POLICY "View audit logs" ON booking_audit
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    booking_id IN (
      SELECT id FROM table_bookings 
      WHERE customer_id IN (
        SELECT id FROM customers 
        WHERE auth.uid() IS NOT NULL
      )
    )
  );

-- ========================================
-- 3. SERVICE SLOTS TABLE (Capacity Management)
-- ========================================
-- Define capacity windows to prevent overbooking
CREATE TABLE IF NOT EXISTS service_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  booking_type table_booking_type NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(service_date, starts_at, booking_type)
);

-- Index for availability queries
CREATE INDEX IF NOT EXISTS idx_service_slots_date ON service_slots(service_date, booking_type) WHERE is_active = true;

-- Enable RLS
ALTER TABLE service_slots ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view active slots" ON service_slots
  FOR SELECT USING (is_active = true);

CREATE POLICY "Managers can manage slots" ON service_slots
  FOR ALL USING (
    auth.role() = 'service_role' OR
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
    )
  );

-- ========================================
-- 4. IMPROVE BOOKING ITEMS CONSTRAINTS
-- ========================================
-- Add proper enum for item_type if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_item_type') THEN
    CREATE TYPE booking_item_type AS ENUM ('main', 'side', 'extra');
  END IF;
END $$;

-- Update table_booking_items to use enum (safe migration)
DO $$
BEGIN
  -- First, check if column is already an enum
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_booking_items' 
    AND column_name = 'item_type'
    AND data_type = 'character varying'
  ) THEN
    -- Add temporary column with enum
    ALTER TABLE table_booking_items ADD COLUMN item_type_new booking_item_type;
    
    -- Copy data with validation
    UPDATE table_booking_items 
    SET item_type_new = CASE 
      WHEN item_type = 'main' THEN 'main'::booking_item_type
      WHEN item_type = 'side' THEN 'side'::booking_item_type
      WHEN item_type = 'extra' THEN 'extra'::booking_item_type
      ELSE 'main'::booking_item_type  -- Default for any invalid data
    END;
    
    -- Drop old column and rename new
    ALTER TABLE table_booking_items DROP COLUMN item_type;
    ALTER TABLE table_booking_items RENAME COLUMN item_type_new TO item_type;
    
    -- Add NOT NULL constraint
    ALTER TABLE table_booking_items ALTER COLUMN item_type SET NOT NULL;
    ALTER TABLE table_booking_items ALTER COLUMN item_type SET DEFAULT 'main'::booking_item_type;
  END IF;
END $$;

-- ========================================
-- 5. ADD CORRELATION ID TO BOOKINGS
-- ========================================
-- For request tracing through the entire flow
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'table_bookings' 
    AND column_name = 'correlation_id'
  ) THEN
    ALTER TABLE table_bookings ADD COLUMN correlation_id UUID DEFAULT gen_random_uuid();
    CREATE INDEX idx_bookings_correlation ON table_bookings(correlation_id);
  END IF;
END $$;

-- ========================================
-- 6. PHONE NUMBER NORMALIZATION
-- ========================================
-- Add normalized phone column to customers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'customers' 
    AND column_name = 'mobile_e164'
  ) THEN
    ALTER TABLE customers ADD COLUMN mobile_e164 VARCHAR(20);
    
    -- Create index for lookups
    CREATE UNIQUE INDEX idx_customers_mobile_e164 
      ON customers(mobile_e164) 
      WHERE mobile_e164 IS NOT NULL;
    
    -- Backfill with normalized numbers (UK specific)
    UPDATE customers 
    SET mobile_e164 = CASE
      WHEN mobile_number LIKE '0%' THEN '+44' || SUBSTRING(mobile_number FROM 2)
      WHEN mobile_number LIKE '44%' THEN '+' || mobile_number
      WHEN mobile_number LIKE '+44%' THEN mobile_number
      ELSE mobile_number
    END
    WHERE mobile_e164 IS NULL;
  END IF;
END $$;

-- ========================================
-- 7. FUNCTION: Check booking capacity atomically
-- ========================================
CREATE OR REPLACE FUNCTION check_and_reserve_capacity(
  p_service_date DATE,
  p_booking_time TIME,
  p_party_size INTEGER,
  p_booking_type table_booking_type,
  p_duration_minutes INTEGER DEFAULT 120
) RETURNS TABLE (
  available BOOLEAN,
  available_capacity INTEGER,
  message TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot RECORD;
  v_current_usage INTEGER;
  v_available_capacity INTEGER;
BEGIN
  -- Find applicable service slot (with lock)
  SELECT * INTO v_slot
  FROM service_slots
  WHERE service_date = p_service_date
    AND booking_type = p_booking_type
    AND p_booking_time >= starts_at
    AND p_booking_time < ends_at
    AND is_active = true
  FOR UPDATE;  -- Lock the row
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false, 
      0, 
      'No service slot configured for this time'::TEXT;
    RETURN;
  END IF;
  
  -- Calculate current usage (while holding lock)
  SELECT COALESCE(SUM(party_size), 0) INTO v_current_usage
  FROM table_bookings
  WHERE booking_date = p_service_date
    AND booking_type = p_booking_type
    AND status IN ('confirmed', 'pending_payment')
    AND booking_time >= v_slot.starts_at
    AND booking_time < v_slot.ends_at;
  
  v_available_capacity := v_slot.capacity - v_current_usage;
  
  IF v_available_capacity >= p_party_size THEN
    RETURN QUERY SELECT 
      true, 
      v_available_capacity, 
      'Capacity available'::TEXT;
  ELSE
    RETURN QUERY SELECT 
      false, 
      v_available_capacity, 
      FORMAT('Insufficient capacity. Only %s seats available', v_available_capacity)::TEXT;
  END IF;
END;
$$;

-- ========================================
-- 8. FUNCTION: Create booking transactionally
-- ========================================
CREATE OR REPLACE FUNCTION create_sunday_lunch_booking(
  p_customer_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_party_size INTEGER,
  p_special_requirements TEXT DEFAULT NULL,
  p_dietary_requirements TEXT[] DEFAULT NULL,
  p_allergies TEXT[] DEFAULT NULL,
  p_correlation_id UUID DEFAULT gen_random_uuid()
) RETURNS TABLE (
  booking_id UUID,
  booking_reference VARCHAR,
  status table_booking_status,
  message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_capacity_check RECORD;
  v_booking RECORD;
BEGIN
  -- Check capacity with lock
  SELECT * INTO v_capacity_check
  FROM check_and_reserve_capacity(
    p_booking_date,
    p_booking_time,
    p_party_size,
    'sunday_lunch'::table_booking_type
  );
  
  IF NOT v_capacity_check.available THEN
    RETURN QUERY SELECT 
      NULL::UUID,
      NULL::VARCHAR, 
      NULL::table_booking_status,
      v_capacity_check.message;
    RETURN;
  END IF;
  
  -- Create booking
  INSERT INTO table_bookings (
    customer_id,
    booking_date,
    booking_time,
    party_size,
    booking_type,
    status,
    special_requirements,
    dietary_requirements,
    allergies,
    correlation_id,
    booking_reference
  ) VALUES (
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    'sunday_lunch'::table_booking_type,
    'pending_payment'::table_booking_status,
    p_special_requirements,
    p_dietary_requirements,
    p_allergies,
    p_correlation_id,
    'SL' || TO_CHAR(CURRENT_DATE, 'YY') || '-' || LPAD(NEXTVAL('booking_reference_seq')::TEXT, 6, '0')
  )
  RETURNING * INTO v_booking;
  
  -- Log audit event
  INSERT INTO booking_audit (
    booking_id,
    event,
    new_status,
    meta
  ) VALUES (
    v_booking.id,
    'booking_created',
    'pending_payment',
    jsonb_build_object(
      'party_size', p_party_size,
      'booking_date', p_booking_date,
      'correlation_id', p_correlation_id
    )
  );
  
  RETURN QUERY SELECT 
    v_booking.id,
    v_booking.booking_reference,
    v_booking.status,
    'Booking created successfully'::TEXT;
END;
$$;

-- ========================================
-- 9. CREATE SEQUENCE FOR BOOKING REFERENCES
-- ========================================
CREATE SEQUENCE IF NOT EXISTS booking_reference_seq START 1000;

-- ========================================
-- 10. CLEANUP JOB FOR EXPIRED IDEMPOTENCY KEYS
-- ========================================
-- Run this periodically (via cron or scheduled function)
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM idempotency_keys
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- ========================================
-- 11. INDEXES FOR PERFORMANCE
-- ========================================
-- Add missing indexes identified in discovery
CREATE INDEX IF NOT EXISTS idx_bookings_date_status 
  ON table_bookings(booking_date, status) 
  WHERE status IN ('confirmed', 'pending_payment');

CREATE INDEX IF NOT EXISTS idx_booking_items_booking 
  ON table_booking_items(booking_id);

CREATE INDEX IF NOT EXISTS idx_customers_mobile 
  ON customers(mobile_number);

-- ========================================
-- MIGRATION COMPLETE
-- ========================================
-- This migration adds:
-- 1. Idempotency protection
-- 2. Booking audit trail
-- 3. Service slots for capacity management
-- 4. Atomic capacity checking function
-- 5. Transactional booking creation function
-- 6. Phone number normalization
-- 7. Performance indexes
-- 8. Proper enum types for item_type