-- Description: Add performance indexes for table bookings and service slots to optimize availability checks

-- ========================================
-- 1. TABLE BOOKINGS INDEXES
-- ========================================
-- Optimize availability checks which query by date, status and time
CREATE INDEX IF NOT EXISTS idx_table_bookings_availability 
  ON table_bookings(booking_date, status, booking_time)
  WHERE status IN ('confirmed', 'pending_payment');

-- ========================================
-- 2. SERVICE SLOTS INDEXES
-- ========================================
-- Optimize slot lookups which query by date, type and start time
CREATE INDEX IF NOT EXISTS idx_service_slots_lookup
  ON service_slots(service_date, booking_type, starts_at)
  WHERE is_active = true;
