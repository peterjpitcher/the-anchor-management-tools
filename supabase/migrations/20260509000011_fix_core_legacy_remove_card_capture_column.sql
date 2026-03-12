-- Fix: replace create_table_booking_v05_core_legacy with a thin wrapper that
-- delegates to create_table_booking_v05.
--
-- Root cause of "no_table" on every FOH event booking:
--
--   Migration 20260509000008 tried to fix the overlap checks in
--   create_table_booking_v05_core_legacy but unknowingly reproduced the old
--   INSERT statement, which includes the column card_capture_required.  That
--   column was dropped by migration 20260508000007.  Every INSERT therefore
--   throws "column card_capture_required does not exist", which propagates up
--   through the call chain and is caught by the EXCEPTION WHEN OTHERS handler
--   in create_event_table_reservation_v05 — returning no_table.
--
--   Migration 20260509000003 already fixed the same bug in
--   create_table_booking_v05 (the 9-param FOH function): it removed the
--   card_capture_required column, replaced pending_card_capture with
--   pending_payment, and updated the overlap checks.
--
-- Fix: replace create_table_booking_v05_core_legacy with a thin wrapper that
-- calls create_table_booking_v05 directly, inheriting all its fixes.  The
-- signatures are identical (core_legacy has 8 params; create_table_booking_v05
-- has a 9th p_bypass_cutoff that defaults to false, which is the correct
-- default for event reservations created via this path).
--
-- This eliminates the broken legacy chain:
--   create_event_table_reservation_v05
--     → create_table_booking_v05_core
--     → create_table_booking_v05_core_sunday_deposit_legacy
--     → create_table_booking_v05_core_legacy  ← was broken
--
-- The chain still exists (other callers may depend on it), but each link now
-- ultimately delegates to the correct, working create_table_booking_v05.

CREATE OR REPLACE FUNCTION public.create_table_booking_v05_core_legacy(
  p_customer_id       uuid,
  p_booking_date      date,
  p_booking_time      time without time zone,
  p_party_size        integer,
  p_booking_purpose   text    DEFAULT 'food',
  p_notes             text    DEFAULT NULL,
  p_sunday_lunch      boolean DEFAULT false,
  p_source            text    DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delegate to the canonical, fully-patched implementation.
  -- p_bypass_cutoff is omitted so it defaults to false (same as the old
  -- behaviour — event reservations do not bypass the pre-close buffer).
  RETURN public.create_table_booking_v05(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05_core_legacy(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05_core_legacy(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;
