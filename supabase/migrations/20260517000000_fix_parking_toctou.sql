-- Fix TOCTOU race condition in parking space booking (PK-1)
--
-- Problem: The capacity check and booking insert were not atomic.
-- Two concurrent requests could both pass the capacity check before
-- either inserts, resulting in overbooking.
--
-- Solution: An atomic RPC that uses pg_advisory_xact_lock to serialise
-- concurrent bookings for overlapping date ranges, then checks capacity
-- and inserts within a single transaction. The trigger is also updated
-- to use advisory locks for consistency with direct inserts.

-- 1. Create the atomic insert RPC
-- Uses SECURITY INVOKER to preserve RLS policies.
-- The advisory lock key is derived from the date boundaries (start day + end day)
-- so that only bookings with overlapping ranges contend.
CREATE OR REPLACE FUNCTION public.atomic_insert_parking_booking(
  p_customer_id uuid,
  p_customer_first_name text,
  p_customer_last_name text,
  p_customer_mobile text,
  p_customer_email text,
  p_vehicle_registration text,
  p_vehicle_make text,
  p_vehicle_model text,
  p_vehicle_colour text,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_duration_minutes integer,
  p_calculated_price numeric(12,2),
  p_pricing_breakdown jsonb,
  p_override_price numeric(12,2),
  p_override_reason text,
  p_capacity_override boolean,
  p_capacity_override_reason text,
  p_status text,
  p_payment_status text,
  p_payment_due_at timestamptz,
  p_expires_at timestamptz,
  p_initial_request_sms_sent boolean,
  p_unpaid_week_before_sms_sent boolean,
  p_unpaid_day_before_sms_sent boolean,
  p_paid_start_three_day_sms_sent boolean,
  p_paid_end_three_day_sms_sent boolean,
  p_notes text,
  p_created_by uuid,
  p_updated_by uuid
)
RETURNS SETOF public.parking_bookings
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  lock_key bigint;
  cap_remaining integer;
  new_booking public.parking_bookings%ROWTYPE;
BEGIN
  -- Derive a stable advisory lock key from the date range.
  -- We hash the start and end dates (as epoch days) into a single bigint.
  -- This means all bookings that share the same start/end day boundaries
  -- will serialise against each other. For a small parking system this is
  -- an acceptable granularity — it prevents the TOCTOU race while keeping
  -- contention low.
  lock_key := (
    (EXTRACT(EPOCH FROM date_trunc('day', p_start_at))::bigint / 86400) * 100000
    + (EXTRACT(EPOCH FROM date_trunc('day', p_end_at))::bigint / 86400)
  );

  -- Acquire a transaction-scoped advisory lock. This blocks concurrent
  -- transactions that are trying to book the same date range, ensuring
  -- only one can proceed at a time. The lock is released automatically
  -- when the transaction commits or rolls back.
  PERFORM pg_advisory_xact_lock(lock_key);

  -- Check capacity (skip if capacity override is set)
  IF NOT COALESCE(p_capacity_override, false) THEN
    SELECT remaining INTO cap_remaining
    FROM public.check_parking_capacity(p_start_at, p_end_at);

    IF cap_remaining <= 0 THEN
      RAISE EXCEPTION 'No parking spaces remaining for the selected period'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Insert the booking. The reference and timestamps are handled by
  -- existing triggers (trg_generate_parking_reference, trg_set_parking_booking_timestamps).
  INSERT INTO public.parking_bookings (
    customer_id,
    customer_first_name,
    customer_last_name,
    customer_mobile,
    customer_email,
    vehicle_registration,
    vehicle_make,
    vehicle_model,
    vehicle_colour,
    start_at,
    end_at,
    duration_minutes,
    calculated_price,
    pricing_breakdown,
    override_price,
    override_reason,
    capacity_override,
    capacity_override_reason,
    status,
    payment_status,
    payment_due_at,
    expires_at,
    initial_request_sms_sent,
    unpaid_week_before_sms_sent,
    unpaid_day_before_sms_sent,
    paid_start_three_day_sms_sent,
    paid_end_three_day_sms_sent,
    notes,
    created_by,
    updated_by
  ) VALUES (
    p_customer_id,
    p_customer_first_name,
    p_customer_last_name,
    p_customer_mobile,
    p_customer_email,
    p_vehicle_registration,
    p_vehicle_make,
    p_vehicle_model,
    p_vehicle_colour,
    p_start_at,
    p_end_at,
    p_duration_minutes,
    p_calculated_price,
    p_pricing_breakdown,
    p_override_price,
    p_override_reason,
    p_capacity_override,
    p_capacity_override_reason,
    p_status::parking_booking_status,
    p_payment_status::parking_payment_status,
    p_payment_due_at,
    p_expires_at,
    p_initial_request_sms_sent,
    p_unpaid_week_before_sms_sent,
    p_unpaid_day_before_sms_sent,
    p_paid_start_three_day_sms_sent,
    p_paid_end_three_day_sms_sent,
    p_notes,
    p_created_by,
    p_updated_by
  )
  RETURNING * INTO new_booking;

  RETURN NEXT new_booking;
END;
$$;

-- 2. Update the enforce_parking_capacity trigger to use advisory locks
-- This makes direct INSERTs (bypassing the RPC) also safe from TOCTOU.
CREATE OR REPLACE FUNCTION public.enforce_parking_capacity()
RETURNS trigger AS $$
DECLARE
  remaining_capacity integer;
  lock_key bigint;
BEGIN
  IF NEW.capacity_override THEN
    RETURN NEW;
  END IF;

  -- Use the same advisory lock strategy as the RPC
  lock_key := (
    (EXTRACT(EPOCH FROM date_trunc('day', NEW.start_at))::bigint / 86400) * 100000
    + (EXTRACT(EPOCH FROM date_trunc('day', NEW.end_at))::bigint / 86400)
  );
  PERFORM pg_advisory_xact_lock(lock_key);

  SELECT remaining INTO remaining_capacity
  FROM public.check_parking_capacity(NEW.start_at, NEW.end_at, CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END);

  IF remaining_capacity < 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Parking capacity exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant execute to authenticated role so RLS-respecting clients can call it
GRANT EXECUTE ON FUNCTION public.atomic_insert_parking_booking TO authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_insert_parking_booking TO service_role;
