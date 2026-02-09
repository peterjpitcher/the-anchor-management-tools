-- Enforce card-capture only for table bookings with party size over 6
-- and set the default per-head cancellation/no-show/reduction fee to GBP 15.

DO $$
BEGIN
  IF to_regprocedure('public.create_table_booking_v05_core(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NOT NULL
     AND to_regprocedure('public.create_table_booking_v05_core_legacy(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    ALTER FUNCTION public.create_table_booking_v05_core(
      uuid,
      date,
      time without time zone,
      integer,
      text,
      text,
      boolean,
      text
    ) RENAME TO create_table_booking_v05_core_legacy;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_table_booking_v05_core(
  p_customer_id uuid,
  p_booking_date date,
  p_booking_time time without time zone,
  p_party_size integer,
  p_booking_purpose text DEFAULT 'food',
  p_notes text DEFAULT NULL,
  p_sunday_lunch boolean DEFAULT false,
  p_source text DEFAULT 'brand_site'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_state text := 'blocked';
  v_table_booking_id uuid;
BEGIN
  IF to_regprocedure('public.create_table_booking_v05_core_legacy(uuid,date,time without time zone,integer,text,text,boolean,text)') IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'hours_not_configured');
  END IF;

  v_result := public.create_table_booking_v05_core_legacy(
    p_customer_id,
    p_booking_date,
    p_booking_time,
    p_party_size,
    p_booking_purpose,
    p_notes,
    p_sunday_lunch,
    p_source
  );

  v_state := COALESCE(v_result->>'state', 'blocked');
  IF v_state <> 'pending_card_capture' THEN
    RETURN v_result;
  END IF;

  -- Card capture should only be required for table bookings where party size > 6.
  IF COALESCE(p_party_size, 0) > 6 THEN
    RETURN v_result;
  END IF;

  v_table_booking_id := NULLIF(v_result->>'table_booking_id', '')::uuid;
  IF v_table_booking_id IS NULL THEN
    RETURN v_result;
  END IF;

  UPDATE public.booking_holds
  SET status = 'released',
      released_at = NOW(),
      updated_at = NOW()
  WHERE table_booking_id = v_table_booking_id
    AND hold_type = 'card_capture_hold'
    AND status = 'active';

  UPDATE public.card_captures
  SET status = 'expired',
      expires_at = NOW(),
      updated_at = NOW()
  WHERE table_booking_id = v_table_booking_id
    AND status = 'pending';

  UPDATE public.table_bookings
  SET status = 'confirmed'::public.table_booking_status,
      confirmed_at = COALESCE(confirmed_at, NOW()),
      card_capture_required = false,
      hold_expires_at = NULL,
      updated_at = NOW()
  WHERE id = v_table_booking_id;

  RETURN v_result || jsonb_build_object(
    'state', 'confirmed',
    'status', 'confirmed',
    'hold_expires_at', NULL,
    'card_capture_required', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_table_booking_v05_core(uuid, date, time without time zone, integer, text, text, boolean, text) TO service_role;

INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES
  ('fee_per_head_amount_gbp', to_jsonb(15), 'Per-head fee cap for table booking late cancellation/no-show/reduction charges.', NOW()),
  ('table_booking_fee_per_head', to_jsonb(15), 'Per-head fee cap for table booking late cancellation/no-show/reduction charges.', NOW()),
  ('booking_fee_per_head', to_jsonb(15), 'Per-head fee cap for table booking late cancellation/no-show/reduction charges.', NOW())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = NOW(),
    description = COALESCE(public.system_settings.description, EXCLUDED.description);
