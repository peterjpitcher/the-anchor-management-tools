-- v0.5 waitlist offer lifecycle support

ALTER TABLE public.guest_tokens
  ADD COLUMN IF NOT EXISTS waitlist_offer_id uuid REFERENCES public.waitlist_offers(id) ON DELETE CASCADE;

DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'guest_tokens'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%action_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.guest_tokens DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guest_tokens_action_type_check'
  ) THEN
    ALTER TABLE public.guest_tokens
      ADD CONSTRAINT guest_tokens_action_type_check
      CHECK (action_type IN ('manage', 'card_capture', 'payment', 'review_redirect', 'charge_approval', 'waitlist_offer'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guest_tokens_waitlist_offer
  ON public.guest_tokens (waitlist_offer_id)
  WHERE waitlist_offer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_next_waitlist_offer_v05(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_entry RECORD;
  v_offer_id uuid;
  v_hold_id uuid;
  v_scheduled_sms_send_time timestamptz := NOW();
  v_expires_at timestamptz;
  v_event_start timestamptz;
BEGIN
  SELECT
    e.id,
    e.capacity,
    e.start_datetime,
    e.date,
    e.time,
    e.booking_open,
    e.event_status
  INTO v_event
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'not_bookable');
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[p_event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_capacity_snapshot.seats_remaining, 0) < 1 THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'no_capacity');
  END IF;

  SELECT
    we.id,
    we.customer_id,
    we.requested_seats
  INTO v_entry
  FROM public.waitlist_entries we
  WHERE we.event_id = p_event_id
    AND we.status = 'queued'
    AND we.requested_seats <= COALESCE(v_capacity_snapshot.seats_remaining, 0)
  ORDER BY we.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none', 'reason', 'no_eligible_waitlist_entry');
  END IF;

  v_expires_at := LEAST(v_event_start, v_scheduled_sms_send_time + INTERVAL '24 hours');

  INSERT INTO public.waitlist_offers (
    waitlist_entry_id,
    event_id,
    customer_id,
    seats_held,
    status,
    scheduled_sms_send_time,
    expires_at,
    created_at
  ) VALUES (
    v_entry.id,
    p_event_id,
    v_entry.customer_id,
    v_entry.requested_seats,
    'sent',
    v_scheduled_sms_send_time,
    v_expires_at,
    NOW()
  )
  RETURNING id INTO v_offer_id;

  INSERT INTO public.booking_holds (
    hold_type,
    waitlist_offer_id,
    seats_or_covers_held,
    status,
    scheduled_sms_send_time,
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    'waitlist_hold',
    v_offer_id,
    v_entry.requested_seats,
    'active',
    v_scheduled_sms_send_time,
    v_expires_at,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_hold_id;

  UPDATE public.waitlist_entries
  SET
    status = 'offered',
    offered_at = NOW(),
    updated_at = NOW()
  WHERE id = v_entry.id;

  RETURN jsonb_build_object(
    'state', 'offered',
    'waitlist_offer_id', v_offer_id,
    'waitlist_entry_id', v_entry.id,
    'hold_id', v_hold_id,
    'event_id', p_event_id,
    'customer_id', v_entry.customer_id,
    'requested_seats', v_entry.requested_seats,
    'scheduled_sms_send_time', v_scheduled_sms_send_time,
    'expires_at', v_expires_at,
    'event_start_datetime', v_event_start
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_next_waitlist_offer_v05(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_next_waitlist_offer_v05(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.accept_waitlist_offer_v05(
  p_hashed_token text,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token RECORD;
  v_offer RECORD;
  v_event RECORD;
  v_capacity_snapshot RECORD;
  v_booking_id uuid;
  v_booking_status text;
  v_hold_expires_at timestamptz;
  v_event_start timestamptz;
BEGIN
  SELECT
    gt.id,
    gt.customer_id,
    gt.waitlist_offer_id,
    gt.expires_at,
    gt.consumed_at
  INTO v_token
  FROM public.guest_tokens gt
  WHERE gt.hashed_token = p_hashed_token
    AND gt.action_type = 'waitlist_offer'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_token');
  END IF;

  IF v_token.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_used');
  END IF;

  IF v_token.expires_at <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_expired');
  END IF;

  SELECT
    wo.id,
    wo.event_id,
    wo.customer_id,
    wo.seats_held,
    wo.status,
    wo.expires_at
  INTO v_offer
  FROM public.waitlist_offers wo
  WHERE wo.id = v_token.waitlist_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_not_found');
  END IF;

  IF v_offer.customer_id <> v_token.customer_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'token_customer_mismatch');
  END IF;

  IF v_offer.status <> 'sent' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_unavailable');
  END IF;

  IF v_offer.expires_at <= NOW() THEN
    UPDATE public.waitlist_offers
    SET status = 'expired', expired_at = NOW()
    WHERE id = v_offer.id;

    UPDATE public.booking_holds
    SET status = 'expired', released_at = NOW(), updated_at = NOW()
    WHERE waitlist_offer_id = v_offer.id
      AND status = 'active';

    UPDATE public.waitlist_entries
    SET status = 'expired', expired_at = NOW(), updated_at = NOW()
    WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id)
      AND status = 'offered';

    RETURN jsonb_build_object('state', 'blocked', 'reason', 'offer_expired');
  END IF;

  SELECT
    e.id,
    e.name,
    e.payment_mode,
    e.start_datetime,
    e.date,
    e.time,
    e.booking_open,
    e.event_status
  INTO v_event
  FROM public.events e
  WHERE e.id = v_offer.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_not_found');
  END IF;

  v_event_start := COALESCE(
    v_event.start_datetime,
    ((v_event.date::text || ' ' || v_event.time)::timestamp AT TIME ZONE 'Europe/London')
  );

  IF v_event_start IS NULL OR v_event_start <= NOW() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  IF COALESCE(v_event.booking_open, true) = false THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_closed');
  END IF;

  IF COALESCE(v_event.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'not_bookable');
  END IF;

  SELECT *
  INTO v_capacity_snapshot
  FROM public.get_event_capacity_snapshot_v05(ARRAY[v_offer.event_id]::uuid[])
  LIMIT 1;

  IF COALESCE(v_capacity_snapshot.seats_remaining, 0) < v_offer.seats_held THEN
    UPDATE public.waitlist_offers
    SET status = 'expired', expired_at = NOW()
    WHERE id = v_offer.id;

    UPDATE public.booking_holds
    SET status = 'expired', released_at = NOW(), updated_at = NOW()
    WHERE waitlist_offer_id = v_offer.id
      AND status = 'active';

    UPDATE public.waitlist_entries
    SET status = 'expired', expired_at = NOW(), updated_at = NOW()
    WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id)
      AND status = 'offered';

    RETURN jsonb_build_object('state', 'blocked', 'reason', 'capacity_unavailable');
  END IF;

  v_booking_status := CASE
    WHEN COALESCE(v_event.payment_mode, 'free') = 'prepaid' THEN 'pending_payment'
    ELSE 'confirmed'
  END;

  IF v_booking_status = 'pending_payment' THEN
    v_hold_expires_at := LEAST(v_event_start, NOW() + INTERVAL '24 hours');
  END IF;

  INSERT INTO public.bookings (
    customer_id,
    event_id,
    seats,
    status,
    source,
    hold_expires_at,
    created_at,
    updated_at
  ) VALUES (
    v_offer.customer_id,
    v_offer.event_id,
    v_offer.seats_held,
    v_booking_status,
    COALESCE(NULLIF(TRIM(p_source), ''), 'brand_site'),
    v_hold_expires_at,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_booking_id;

  IF v_booking_status = 'pending_payment' THEN
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
      v_offer.seats_held,
      'active',
      v_hold_expires_at,
      NOW(),
      NOW()
    );
  END IF;

  UPDATE public.waitlist_offers
  SET status = 'accepted', accepted_at = NOW()
  WHERE id = v_offer.id;

  UPDATE public.waitlist_entries
  SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
  WHERE id = (SELECT waitlist_entry_id FROM public.waitlist_offers WHERE id = v_offer.id);

  UPDATE public.booking_holds
  SET status = 'consumed', consumed_at = NOW(), updated_at = NOW()
  WHERE waitlist_offer_id = v_offer.id
    AND status = 'active';

  UPDATE public.guest_tokens
  SET consumed_at = NOW()
  WHERE id = v_token.id;

  RETURN jsonb_build_object(
    'state', CASE WHEN v_booking_status = 'pending_payment' THEN 'pending_payment' ELSE 'confirmed' END,
    'booking_id', v_booking_id,
    'status', v_booking_status,
    'payment_mode', COALESCE(v_event.payment_mode, 'free'),
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'hold_expires_at', v_hold_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_waitlist_offer_v05(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_waitlist_offer_v05(text, text) TO service_role;
