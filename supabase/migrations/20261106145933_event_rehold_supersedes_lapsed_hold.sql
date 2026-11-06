-- "Hold them again" is refused for up to 15 minutes after a ticket hold ends (6 November 2026).
--
-- When a website ticket hold ends unpaid, the website offers "Hold them again", which sends the
-- same details under a fresh idempotency key. create_event_booking_v05, which every booking
-- version and wrapper reaches (v06 to v09 and the request and attendee wrappers), refused it as
-- customer_conflict: its duplicate check counts every pending_payment booking for the guest and
-- event, a lapsed one included, and idx_bookings_customer_event_active_unique would refuse a second
-- one anyway. The lapsed hold stays pending_payment until api/cron/event-booking-holds expires it,
-- which it does only 10 minutes after hold_expires_at, every 5 minutes. Capacity already ignores a
-- lapsed hold (is_active_event_booking_for_capacity_v01, is_booking_live): the check is the block.
--
-- create_event_booking_v05: the guest's own lapsed hold for the event now gives way to the new one
-- in the same transaction, before capacity is read, when nothing is still being paid or decided on
-- it: the guest is not checked in, no payment exception is open, and its only payment rows are
-- declined or written-off ones and PayPal orders nobody captured. It is expired with its payment
-- hold and its table booking is cancelled ('event_booking_rehold_superseded'), as the hold job
-- does, with no message. Its uncaptured PayPal order is written off (payments.status 'failed',
-- abandoned_reason in metadata), as api/cron/event-paypal-reconciliation does after a day, so
-- captureEventPayPalOrderFromPreview refuses a capture started on the old hold from then on before
-- it asks PayPal. A confirmed booking, a hold still running, a checked-in guest or a payment in
-- flight is refused as customer_conflict exactly as before. A successful answer carries
-- superseded_booking_id when a hold gave way; nothing reads it yet.
--
-- confirm_event_paypal_payment_v01: the write-off does not stop a capture already under way when
-- the hold gives way (the capture step read the pending row first). Both capture paths accept an
-- expired booking for 10 minutes after expired_at, and this function then put the booking back to
-- pending_payment, which beside the new hold broke idx_bookings_customer_event_active_unique after
-- PayPal had taken the money; the capture step only logged it, and the webhook and reconciliation
-- retries failed the same way. Now an expired booking is not put back while the same guest has
-- another booking for the event that is pending_payment or confirmed: the payment row is recorded
-- as before (matched by order or capture id, so a written-off row becomes succeeded with the
-- capture id), a booking_expired_after_capture exception is opened and the answer is
-- manual_review, which both callers send to staff. The same applies to a booking the hold job
-- expired before the guest booked again. With no such booking an expired booking within 10 minutes
-- is put back and confirmed exactly as before. Nothing else in the function changes.
--
-- Live data this changes: none when applied. Checked on 6 November 2026: no booking is
-- pending_payment.
--
-- Both functions are built from production's pg_get_functiondef on 6 November 2026:
-- create_event_booking_v05 (md5 583e6a10e772ab1f5b608cb6c102b5be, md5(prosrc)
-- 7ee06c16846fa8a22e57382a6ad37db5) and confirm_event_paypal_payment_v01 (md5
-- 07f7ec5d7433bc1560e5bad4b108edd7, md5(prosrc) b4383073beac5fb260d712695782d86b); only the
-- passages described above change. The guard refuses to replace any other body, so a definition
-- that has moved on fails loudly instead of being overwritten, and a second run is a no-op.
-- Production's grants are restated for both: service_role only, no anon or authenticated access,
-- so no anon grant is issued.
--
-- Rollback: supabase/rollbacks/20261106112933_event_rehold_supersedes_lapsed_hold.sql. Tested by
-- scripts/testing/event-rehold-supersedes-lapsed-hold-postgres.py.

DO $guard$
DECLARE
  v_booking_src text;
  v_confirm_src text;
BEGIN
  SELECT md5(p.prosrc)
  INTO v_booking_src
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.create_event_booking_v05(uuid,uuid,integer,text,text)');

  SELECT md5(p.prosrc)
  INTO v_confirm_src
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.confirm_event_paypal_payment_v01(uuid,text,text,numeric,text,text)');

  IF v_booking_src IS NULL THEN
    RAISE EXCEPTION 'event_rehold_supersedes_lapsed_hold: create_event_booking_v05 is missing';
  END IF;

  IF v_confirm_src IS NULL THEN
    RAISE EXCEPTION 'event_rehold_supersedes_lapsed_hold: confirm_event_paypal_payment_v01 is missing';
  END IF;

  -- Production's bodies on 6 November 2026, or this migration's own (a second run).
  IF v_booking_src NOT IN ('7ee06c16846fa8a22e57382a6ad37db5', 'b7a32755d11ae1d0462bd292ee8d1e74') THEN
    RAISE EXCEPTION 'event_rehold_supersedes_lapsed_hold: create_event_booking_v05 has moved on (md5(prosrc) %); rebuild this migration from the live definition', v_booking_src;
  END IF;

  IF v_confirm_src NOT IN ('b4383073beac5fb260d712695782d86b', '150d23fd2333edc403b5dd2241690fa2') THEN
    RAISE EXCEPTION 'event_rehold_supersedes_lapsed_hold: confirm_event_paypal_payment_v01 has moved on (md5(prosrc) %); rebuild this migration from the live definition', v_confirm_src;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.create_event_booking_v05(p_event_id uuid, p_customer_id uuid, p_seats integer, p_source text DEFAULT 'brand_site'::text, p_seating_preference text DEFAULT 'seated'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_after_snapshot RECORD;
  v_existing_active RECORD;
  v_status text;
  v_booking_id uuid;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
  v_event_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_requested_seating text := CASE WHEN p_seating_preference = 'standing' THEN 'standing' ELSE 'seated' END;
  v_effective_seating text := 'seated';
  v_allocation jsonb := '{}'::jsonb;
  v_superseded_booking_id uuid;
BEGIN
  IF p_seats IS NULL OR p_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  END IF;

  SELECT
    e.id,
    e.name,
    e.capacity,
    e.payment_mode,
    e.booking_mode,
    e.booking_open,
    e.bookings_enabled,
    e.booking_cutoff_at,
    e.event_status,
    e.start_datetime,
    e.date,
    e.time,
    e.end_time,
    e.duration_minutes
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END
  );

  IF v_event_start IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_datetime_missing');
  END IF;

  v_event_end := COALESCE(
    CASE
      WHEN v_event.date IS NOT NULL AND v_event.end_time IS NOT NULL
        THEN ((v_event.date::text || ' ' || v_event.end_time::text)::timestamp AT TIME ZONE 'Europe/London')
      ELSE NULL
    END,
    v_event_start + make_interval(mins => GREATEST(COALESCE(v_event.duration_minutes, 180), 30))
  );

  IF v_event_end <= v_event_start THEN
    v_event_end := v_event_end + INTERVAL '1 day';
  END IF;

  SELECT start_datetime, end_datetime
  INTO v_window_start, v_window_end
  FROM public.event_communal_window_v01(p_event_id);

  IF v_window_start IS NULL OR v_window_end IS NULL THEN
    v_window_start := v_event_start;
    v_window_end := v_event_end;
  END IF;

  IF v_event_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  -- Owner decision D24 (customer bookings review, 24 October 2026): a whole-pub private hire
  -- stops ticket sales for an event it overlaps. The guest is told booking has closed.
  IF EXISTS (SELECT 1 FROM public.events_closed_by_whole_pub_hire(ARRAY[p_event_id])) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  -- BK-089: a postponed night has no date to book.
  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft', 'postponed') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  -- BK-035, owner decision D11: Accept bookings and the online sales close time apply to the
  -- website, waitlist acceptances and text replies. Staff and FOH bookings are not limited by them.
  IF COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site') IN ('brand_site', 'sms_reply') THEN
    IF COALESCE(v_event.bookings_enabled, true) = false THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'bookings_disabled');
    END IF;
    IF v_event.booking_cutoff_at IS NOT NULL AND v_event.booking_cutoff_at <= now() THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'sales_closed');
    END IF;
  END IF;

  SELECT b.id, b.status, b.hold_expires_at
  INTO v_existing_active
  FROM public.bookings b
  WHERE b.event_id = p_event_id
    AND b.customer_id = p_customer_id
    AND b.status IN ('pending_payment', 'confirmed')
  ORDER BY b.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- "Hold them again" (6 November 2026): this guest's own unpaid hold for this event has run
    -- out, so it gives way to the new one here instead of refusing it as customer_conflict until
    -- the hold job expires it, up to 15 minutes later. Only when nothing is still being paid or
    -- decided on it: the guest is not checked in (BK-032), no payment exception is open, and no
    -- payment is recorded beyond a PayPal order nobody captured (BK-019: a capture PayPal is
    -- holding, or a payment that went through, keeps the hold). It is expired, released and its
    -- table booking cancelled as the hold job would, but with no message: the guest is booking
    -- again now. Its uncaptured order is written off as the PayPal reconciliation does for an
    -- abandoned checkout, so a capture started on the old hold from now on is refused before
    -- PayPal is asked. A capture already under way can still take the money: then
    -- confirm_event_paypal_payment_v01 finds this new booking, leaves the old one expired,
    -- records the payment against it and opens a booking_expired_after_capture exception, so it
    -- lands in manual review for staff to refund. Anything else, a confirmed booking or a hold
    -- still running included, is refused exactly as before.
    IF v_existing_active.status = 'pending_payment'
       AND v_existing_active.hold_expires_at IS NOT NULL
       AND v_existing_active.hold_expires_at <= now()
       AND NOT EXISTS (
         SELECT 1
         FROM public.event_check_ins ci
         WHERE ci.booking_id = v_existing_active.id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.event_payment_exceptions x
         WHERE x.event_booking_id = v_existing_active.id
           AND x.status = 'open'
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.payments p
         WHERE p.event_booking_id = v_existing_active.id
           AND p.status <> 'failed'
           AND NOT (
             p.charge_type = 'prepaid_event'
             AND p.status = 'pending'
             AND p.paypal_capture_id IS NULL
           )
       ) THEN
      UPDATE public.bookings
      SET status = 'expired', expired_at = now(), updated_at = now()
      WHERE id = v_existing_active.id;

      UPDATE public.booking_holds
      SET status = 'expired', released_at = now(), updated_at = now()
      WHERE event_booking_id = v_existing_active.id
        AND hold_type = 'payment_hold'
        AND status = 'active';

      UPDATE public.table_bookings
      SET status = 'cancelled',
          cancellation_reason = 'event_booking_rehold_superseded',
          cancelled_at = now(),
          updated_at = now(),
          hold_expires_at = NULL
      WHERE event_booking_id = v_existing_active.id
        AND status <> 'cancelled';

      UPDATE public.payments
      SET status = 'failed',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'abandoned_at', now(),
            'abandoned_reason', 'event_booking_rehold_superseded'
          ),
          updated_at = now()
      WHERE event_booking_id = v_existing_active.id
        AND charge_type = 'prepaid_event'
        AND status = 'pending'
        AND paypal_capture_id IS NULL;

      v_superseded_booking_id := v_existing_active.id;
    ELSE
      RETURN jsonb_build_object(
        'state', 'blocked',
        'reason', 'customer_conflict',
        'booking_id', v_existing_active.id,
        'status', v_existing_active.status
      );
    END IF;
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' THEN
    IF v_requested_seating = 'standing' THEN
      -- Only staff may choose standing while seated places remain.
      IF COALESCE(p_source, '') NOT IN ('admin', 'foh', 'walk-in')
         AND v_capacity_snapshot.seated_remaining IS DISTINCT FROM 0 THEN
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'standing_not_available_until_seated_full',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_capacity, 0) <= 0 THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'standing_capacity_not_configured');
      END IF;

      IF COALESCE(v_capacity_snapshot.standing_remaining, 0) < p_seats THEN
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;

      v_effective_seating := 'standing';
    ELSE
      IF COALESCE(v_capacity_snapshot.seated_remaining, 0) >= p_seats THEN
        v_effective_seating := 'seated';
      ELSIF (COALESCE(v_capacity_snapshot.seated_remaining, 0) > 0
              OR COALESCE(v_capacity_snapshot.standing_remaining, 0) > 0) THEN
        -- The guest must review standing tickets before making a new request.
        RETURN jsonb_build_object(
          'state', 'blocked', 'reason', 'seated_capacity_changed',
          'seated_remaining', v_capacity_snapshot.seated_remaining,
          'standing_remaining', v_capacity_snapshot.standing_remaining,
          'total_remaining', v_capacity_snapshot.total_remaining
        );
      ELSE
        RETURN jsonb_build_object(
          'state', 'full_with_waitlist_option',
          'reason', 'insufficient_capacity',
          'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
          'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
          'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
          'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
        );
      END IF;
    END IF;
  ELSE
    IF v_capacity_snapshot.capacity IS NOT NULL
       AND (v_capacity_snapshot.seats_remaining IS NULL OR v_capacity_snapshot.seats_remaining < p_seats) THEN
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', 'insufficient_capacity',
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0)
      );
    END IF;
  END IF;

  v_status := CASE
    WHEN COALESCE(v_event.payment_mode, 'free') = 'prepaid' THEN 'pending_payment'
    ELSE 'confirmed'
  END;

  IF v_status = 'pending_payment' THEN
    v_hold_expires_at := LEAST(v_event_start, now() + INTERVAL '24 hours');
    IF v_hold_expires_at <= now() THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
    END IF;
  END IF;

  INSERT INTO public.bookings (
    customer_id,
    event_id,
    seats,
    status,
    source,
    event_seating_type,
    hold_expires_at,
    created_at,
    updated_at
  ) VALUES (
    p_customer_id,
    p_event_id,
    p_seats,
    v_status,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
    v_effective_seating,
    v_hold_expires_at,
    now(),
    now()
  )
  RETURNING id INTO v_booking_id;

  IF v_status = 'pending_payment' THEN
    INSERT INTO public.booking_holds (
      hold_type,
      event_booking_id,
      seats_or_covers_held,
      status,
      expires_at,
      created_at,
      updated_at
    ) VALUES (
      'payment_hold',
      v_booking_id,
      p_seats,
      'active',
      v_hold_expires_at,
      now(),
      now()
    );
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') = 'communal' AND v_effective_seating = 'seated' THEN
    v_allocation := public.allocate_event_communal_seats_v01(
      p_event_id,
      v_booking_id,
      p_seats,
      v_window_start,
      v_window_end
    );

    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      DELETE FROM public.booking_holds WHERE event_booking_id = v_booking_id;
      DELETE FROM public.bookings WHERE id = v_booking_id;
      RETURN jsonb_build_object(
        'state', 'full_with_waitlist_option',
        'reason', COALESCE(v_allocation->>'reason', 'insufficient_seated_capacity'),
        'seats_remaining', COALESCE(v_capacity_snapshot.seats_remaining, 0),
        'seated_remaining', COALESCE(v_capacity_snapshot.seated_remaining, 0),
        'standing_remaining', COALESCE(v_capacity_snapshot.standing_remaining, 0),
        'total_remaining', COALESCE(v_capacity_snapshot.total_remaining, 0)
      );
    END IF;
  END IF;

  IF COALESCE(v_event.booking_mode, 'table') IN ('table', 'mixed') THEN
    v_allocation := public.create_event_table_reservation_v05(
      p_event_id, v_booking_id, p_customer_id, p_seats, p_source,
      'Event booking ' || v_booking_id::text
    );
    IF COALESCE(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE = 'P2002',
        MESSAGE = COALESCE(v_allocation->>'reason', 'no_table');
    END IF;
  END IF;

  SELECT *
  INTO v_after_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_status = 'pending_payment' THEN 'pending_payment' ELSE 'confirmed' END,
    'booking_id', v_booking_id,
    'status', v_status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'hold_expires_at', v_hold_expires_at,
    'event_seating_type', v_effective_seating,
    'seats_remaining', v_after_snapshot.seats_remaining,
    'seated_remaining', v_after_snapshot.seated_remaining,
    'standing_remaining', v_after_snapshot.standing_remaining,
    'total_remaining', v_after_snapshot.total_remaining,
    'table_booking_id', v_allocation->>'table_booking_id',
    'table_name', v_allocation->>'table_name',
    'table_names', COALESCE(v_allocation->'table_names', '[]'::jsonb),
    'table_ids', COALESCE(v_allocation->'table_ids', '[]'::jsonb)
  ) || CASE
    WHEN v_superseded_booking_id IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('superseded_booking_id', v_superseded_booking_id)
  END;
EXCEPTION
  WHEN SQLSTATE 'P2002' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', SQLERRM);
  WHEN unique_violation THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'customer_conflict');
END;
$function$;

-- Production's grants on 6 November 2026, restated: service_role only.
REVOKE ALL ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_event_booking_v05(uuid,uuid,integer,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_event_paypal_payment_v01(p_event_booking_id uuid, p_paypal_order_id text, p_paypal_capture_id text, p_amount numeric, p_currency text DEFAULT 'GBP'::text, p_source text DEFAULT 'paypal_capture'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_event RECORD;
  v_payment_id uuid;
  v_now timestamptz := now();
  v_table_result jsonb := NULL;
  v_table_state text := NULL;
  v_table_reason text := NULL;
  v_exception_reason text := NULL;
  v_event_status text;
  v_capacity RECORD;
  v_own_seats integer;
BEGIN
  SELECT
    b.id,
    b.customer_id,
    b.event_id,
    b.status,
    b.seats,
    b.expired_at,
    b.hold_expires_at,
    b.event_seating_type
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_event_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found');
  END IF;

  SELECT e.id, e.name, e.booking_mode
  INTO v_event
  FROM public.events e
  WHERE e.id = v_booking.event_id;

  UPDATE public.payments
  SET
    status = 'succeeded',
    payment_provider = 'paypal',
    payment_method = 'paypal',
    paypal_order_id = COALESCE(NULLIF(TRIM(p_paypal_order_id), ''), paypal_order_id),
    paypal_capture_id = COALESCE(NULLIF(TRIM(p_paypal_capture_id), ''), paypal_capture_id),
    amount = COALESCE(p_amount, amount),
    currency = COALESCE(NULLIF(TRIM(p_currency), ''), currency),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'confirmed_at', v_now,
      'source', COALESCE(NULLIF(TRIM(p_source), ''), 'paypal_capture')
    ),
    updated_at = v_now
  WHERE event_booking_id = p_event_booking_id
    AND charge_type = 'prepaid_event'
    AND (
      paypal_capture_id = NULLIF(TRIM(p_paypal_capture_id), '')
      OR paypal_order_id = NULLIF(TRIM(p_paypal_order_id), '')
    )
  RETURNING id INTO v_payment_id;

  IF NOT FOUND THEN
    INSERT INTO public.payments (
      event_booking_id,
      charge_type,
      payment_provider,
      payment_method,
      paypal_order_id,
      paypal_capture_id,
      amount,
      currency,
      status,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      p_event_booking_id,
      'prepaid_event',
      'paypal',
      'paypal',
      NULLIF(TRIM(p_paypal_order_id), ''),
      NULLIF(TRIM(p_paypal_capture_id), ''),
      COALESCE(p_amount, 0),
      COALESCE(NULLIF(TRIM(p_currency), ''), 'GBP'),
      'succeeded',
      jsonb_build_object(
        'confirmed_at', v_now,
        'source', COALESCE(NULLIF(TRIM(p_source), ''), 'paypal_capture')
      ),
      v_now,
      v_now
    )
    RETURNING id INTO v_payment_id;
  END IF;

  IF v_booking.status = 'confirmed' THEN
    RETURN jsonb_build_object(
      'state', 'already_confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id
    );
  END IF;

  IF v_booking.status = 'expired' THEN
    -- 6 November 2026: an expired booking is not put back while the same guest has another
    -- booking for the event held or confirmed (a hold that replaced it through "Hold them again",
    -- or one made after the hold job expired it). Beside that booking it would break
    -- idx_bookings_customer_event_active_unique after PayPal has taken the money, and every retry
    -- would fail the same way. The payment is recorded above; it goes to manual review instead.
    IF v_booking.expired_at IS NULL OR v_booking.expired_at < v_now - INTERVAL '10 minutes'
       OR EXISTS (
         SELECT 1
         FROM public.bookings other_booking
         WHERE other_booking.customer_id = v_booking.customer_id
           AND other_booking.event_id = v_booking.event_id
           AND other_booking.id <> v_booking.id
           AND other_booking.status IN ('pending_payment', 'confirmed')
       ) THEN
      v_exception_reason := 'booking_expired_after_capture';
    ELSE
      UPDATE public.bookings
      SET status = 'pending_payment', expired_at = NULL, updated_at = v_now
      WHERE id = v_booking.id;
      v_booking.status := 'pending_payment';
    END IF;
  END IF;

  IF v_booking.status = 'pending_payment'
     AND v_booking.hold_expires_at IS NOT NULL
     AND v_booking.hold_expires_at < v_now - INTERVAL '10 minutes' THEN
    v_exception_reason := 'booking_expired_after_capture';
  END IF;

  IF v_exception_reason IS NULL AND v_booking.status = 'pending_payment' THEN
    IF COALESCE(v_event.booking_mode, 'table') IN ('table', 'mixed') THEN
      BEGIN
        v_table_result := public.create_event_table_reservation_v05(
          v_booking.event_id,
          v_booking.id,
          v_booking.customer_id,
          COALESCE(v_booking.seats, 1),
          'paypal_capture',
          'Payment confirmed'
        );
        v_table_state := COALESCE(v_table_result->>'state', NULL);
        v_table_reason := COALESCE(v_table_result->>'reason', NULL);
        IF v_table_state IS NOT NULL AND v_table_state <> 'confirmed' THEN
          v_exception_reason := 'table_unavailable_after_capture';
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          v_exception_reason := 'table_unavailable_after_capture';
          v_table_state := 'blocked';
          v_table_reason := 'no_table';
      END;
    ELSIF v_event.booking_mode = 'communal' THEN
      -- Shared seating holds seats, never a whole table. Lock the event row (as
      -- the table step did, so other bookings and seat changes for this event wait)
      -- and, for seated guests, every table in the order
      -- allocate_event_communal_seats_v01 takes them, so nothing can claim these
      -- seats while the payment is decided. A cancelled or draft event goes to
      -- review, as the table step sent it. Then judge the hold by the clock, not the
      -- transaction start: seats under a live hold counted against capacity all
      -- along, but once it lapses another guest may have taken them, so the event's
      -- limits and the physical seats are checked again. If Postgres cancels this
      -- check to break a deadlock with another booking (a joined-table booking can
      -- lock tables in a different order), the other side finishes and the check
      -- is retried rather than sending a paid booking to review.
      FOR v_attempt IN 1..3 LOOP
        v_exception_reason := NULL;
        v_table_result := NULL;
        v_table_state := NULL;
        v_table_reason := NULL;
        BEGIN
          SELECT e.event_status
          INTO v_event_status
          FROM public.events e
          WHERE e.id = v_booking.event_id
          FOR UPDATE;

          IF COALESCE(v_event_status, 'scheduled') IN ('cancelled', 'draft') THEN
            v_exception_reason := 'capacity_unavailable_after_capture';
            v_table_state := 'blocked';
            v_table_reason := 'not_bookable';
          ELSE
            IF v_booking.event_seating_type = 'seated' THEN
              PERFORM 1
              FROM public.tables t
              WHERE (COALESCE(t.is_bookable, true) AND t.capacity > 0)
                OR t.id IN (
                  SELECT a.table_id
                  FROM public.event_communal_seat_allocations a
                  WHERE a.event_booking_id = v_booking.id
                )
              ORDER BY t.bar_priority ASC, t.capacity ASC,
                COALESCE(NULLIF(regexp_replace(t.table_number, '\D', '', 'g'), '')::integer, 9999), t.id
              FOR UPDATE OF t;
            END IF;

            IF v_booking.hold_expires_at <= clock_timestamp()
              OR (
                v_booking.event_seating_type = 'seated'
                AND COALESCE((
                  SELECT SUM(a.seats)
                  FROM public.event_communal_seat_allocations a
                  WHERE a.event_booking_id = v_booking.id
                ), 0) <> COALESCE(v_booking.seats, 1)
              ) THEN
              SELECT s.seated_remaining, s.standing_remaining, s.total_remaining
              INTO v_capacity
              FROM public.get_event_capacity_snapshot_v05(ARRAY[v_booking.event_id]) s;

              -- The snapshot judges holds by the transaction start, so it may still
              -- count this booking; add its own seats back in that case.
              v_own_seats := CASE
                WHEN public.is_active_event_booking_for_capacity_v01(v_booking.status, v_booking.hold_expires_at)
                  THEN COALESCE(v_booking.seats, 1)
                ELSE 0
              END;

              IF COALESCE(LEAST(
                   CASE WHEN v_booking.event_seating_type = 'standing'
                     THEN v_capacity.standing_remaining
                     ELSE v_capacity.seated_remaining
                   END,
                   v_capacity.total_remaining
                 ), 0) + v_own_seats < COALESCE(v_booking.seats, 1) THEN
                v_exception_reason := 'capacity_unavailable_after_capture';
                v_table_state := 'blocked';
                v_table_reason := 'event_full';
              ELSIF v_booking.event_seating_type = 'seated' THEN
                v_table_result := public.reallocate_event_communal_booking_v01(
                  v_booking.id,
                  COALESCE(v_booking.seats, 1)
                );
                v_table_state := COALESCE(v_table_result->>'state', 'blocked');
                v_table_reason := COALESCE(v_table_result->>'reason', NULL);
                IF v_table_state <> 'confirmed' THEN
                  v_exception_reason := 'capacity_unavailable_after_capture';
                END IF;
              END IF;
            END IF;
          END IF;
          EXIT;
        EXCEPTION
          WHEN deadlock_detected OR lock_not_available THEN
            IF v_attempt = 3 THEN
              v_exception_reason := 'capacity_unavailable_after_capture';
              v_table_state := 'blocked';
              v_table_reason := 'seat_check_' || SQLSTATE;
            END IF;
          WHEN OTHERS THEN
            v_exception_reason := 'capacity_unavailable_after_capture';
            v_table_state := 'blocked';
            v_table_reason := 'seat_check_' || SQLSTATE;
            EXIT;
        END;
      END LOOP;
    ELSE
      -- 'general' events (and any other mode) place no table and no seats, only the event's
      -- own limit. Lock the event row, as the table and shared-seating steps do, so a booking
      -- for this event waits while the payment is decided. Seats under a live hold counted
      -- against the limit all along; once the hold has lapsed by the clock another guest may
      -- have taken them, so the limit is checked again and a payment that no longer fits goes
      -- to manual review as capacity_unavailable_after_capture (BK-020). A deadlock with
      -- another booking is retried rather than sending a paid booking to review.
      FOR v_attempt IN 1..3 LOOP
        v_exception_reason := NULL;
        v_table_state := NULL;
        v_table_reason := NULL;
        BEGIN
          PERFORM 1
          FROM public.events e
          WHERE e.id = v_booking.event_id
          FOR UPDATE;

          IF v_booking.hold_expires_at IS NOT NULL
             AND v_booking.hold_expires_at <= clock_timestamp() THEN
            SELECT s.total_remaining
            INTO v_capacity
            FROM public.get_event_capacity_snapshot_v05(ARRAY[v_booking.event_id]) s;

            -- The snapshot judges holds by the transaction start, so it may still
            -- count this booking; add its own seats back in that case.
            v_own_seats := CASE
              WHEN public.is_active_event_booking_for_capacity_v01(v_booking.status, v_booking.hold_expires_at)
                THEN COALESCE(v_booking.seats, 1)
              ELSE 0
            END;

            -- No limit (NULL) means the event cannot fill.
            IF v_capacity.total_remaining IS NOT NULL
               AND v_capacity.total_remaining + v_own_seats < COALESCE(v_booking.seats, 1) THEN
              v_exception_reason := 'capacity_unavailable_after_capture';
              v_table_state := 'blocked';
              v_table_reason := 'event_full';
            END IF;
          END IF;
          EXIT;
        EXCEPTION
          WHEN deadlock_detected OR lock_not_available THEN
            IF v_attempt = 3 THEN
              v_exception_reason := 'capacity_unavailable_after_capture';
              v_table_state := 'blocked';
              v_table_reason := 'seat_check_' || SQLSTATE;
            END IF;
          WHEN OTHERS THEN
            v_exception_reason := 'capacity_unavailable_after_capture';
            v_table_state := 'blocked';
            v_table_reason := 'seat_check_' || SQLSTATE;
            EXIT;
        END;
      END LOOP;
    END IF;
  END IF;

  IF v_exception_reason IS NOT NULL THEN
    INSERT INTO public.event_payment_exceptions (
      event_booking_id,
      payment_id,
      reason,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      v_payment_id,
      v_exception_reason,
      jsonb_build_object(
        'paypal_order_id', NULLIF(TRIM(p_paypal_order_id), ''),
        'paypal_capture_id', NULLIF(TRIM(p_paypal_capture_id), ''),
        'amount', p_amount,
        'currency', p_currency,
        'table_state', v_table_state,
        'table_reason', v_table_reason
      ),
      v_now,
      v_now
    )
    ON CONFLICT (event_booking_id, reason) WHERE status = 'open'
    DO UPDATE SET
      payment_id = EXCLUDED.payment_id,
      metadata = public.event_payment_exceptions.metadata || EXCLUDED.metadata,
      updated_at = v_now;

    RETURN jsonb_build_object(
      'state', 'manual_review',
      'reason', v_exception_reason,
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id,
      'table_state', v_table_state,
      'table_reason', v_table_reason
    );
  END IF;

  IF v_booking.status = 'pending_payment' THEN
    UPDATE public.bookings
    SET
      status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = v_now
    WHERE id = v_booking.id;

    UPDATE public.booking_holds
    SET
      status = 'consumed',
      consumed_at = v_now,
      updated_at = v_now
    WHERE event_booking_id = v_booking.id
      AND hold_type = 'payment_hold'
      AND status = 'active';

    UPDATE public.guest_tokens
    SET consumed_at = v_now
    WHERE event_booking_id = v_booking.id
      AND action_type = 'payment'
      AND consumed_at IS NULL;

    RETURN jsonb_build_object(
      'state', 'confirmed',
      'booking_id', v_booking.id,
      'customer_id', v_booking.customer_id,
      'event_id', v_booking.event_id,
      'event_name', COALESCE(v_event.name, 'Event booking'),
      'seats', COALESCE(v_booking.seats, 1),
      'payment_id', v_payment_id,
      'table_state', v_table_state,
      'table_reason', v_table_reason,
      'table_booking_id', COALESCE(v_table_result->>'table_booking_id', NULL)
    );
  END IF;

  RETURN jsonb_build_object(
    'state', 'blocked',
    'reason', 'booking_not_pending_payment',
    'booking_id', v_booking.id,
    'payment_id', v_payment_id
  );
END;
$function$;

-- Production's grants on 6 November 2026, restated: service_role only.
REVOKE ALL ON FUNCTION public.confirm_event_paypal_payment_v01(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_event_paypal_payment_v01(uuid,text,text,numeric,text,text) TO service_role;
