-- Private Bookings SOP compliance (pack 2026-07-05), part 1 of 2:
--   A. Balance & final details due 14 calendar days before the event (was 7).
--   B. VAT: stored prices are net; add vat_rate columns and make all
--      customer-payable totals VAT-aware (gross = net after discount + VAT).
--   C. Function audit fallout: balance/payment functions and views that
--      reference the old net totals are updated in the same migration.

-- ---------------------------------------------------------------------------
-- A. 14-day due date
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_balance_due_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.date_tbd = true THEN
    NEW.balance_due_date := NULL;
    RETURN NEW;
  END IF;
  IF NEW.event_date IS NOT NULL AND NEW.balance_due_date IS NULL THEN
    -- SOP: balance and final details are due 14 calendar days before the event.
    NEW.balance_due_date := NEW.event_date - INTERVAL '14 days';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON COLUMN public.private_bookings.balance_due_date IS
  'Balance and final details due date. Auto-calculated as event_date - 14 days when not set explicitly (SOP 2026-07).';

-- Backfill (approved 2026-07-05): only future, live bookings whose due date
-- still equals the old auto-set value (event - 7 days). Staff-set dates are
-- left alone. Events already inside 14 days become due today.
UPDATE public.private_bookings
SET balance_due_date = GREATEST((event_date - INTERVAL '14 days')::date, CURRENT_DATE)
WHERE status IN ('draft', 'confirmed')
  AND COALESCE(date_tbd, false) = false
  AND event_date IS NOT NULL
  AND event_date > CURRENT_DATE
  AND balance_due_date = (event_date - INTERVAL '7 days')::date;

-- ---------------------------------------------------------------------------
-- B. VAT columns (stored prices are net; default UK standard rate)
-- ---------------------------------------------------------------------------

ALTER TABLE public.catering_packages
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 20;
ALTER TABLE public.venue_spaces
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 20;
ALTER TABLE public.private_booking_items
  ADD COLUMN IF NOT EXISTS vat_rate numeric(5,2) NOT NULL DEFAULT 20;

COMMENT ON COLUMN public.private_booking_items.vat_rate IS
  'VAT rate (%) snapshotted from the source package/space at the time the line was added. Stored unit prices are net.';

-- Explicit deposit waiver (a £0 deposit no longer silently auto-confirms)
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS deposit_waived boolean NOT NULL DEFAULT false;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS deposit_waived_reason text;

COMMENT ON COLUMN public.private_bookings.deposit_waived IS
  'General Manager approved a no-deposit booking (venue-hosted/internal events). Required for a £0-deposit booking to confirm.';

-- SMS trigger types: 'booking_cancelled_partial_refund' was already queued by
-- the app but missing from this CHECK (silent failure); add it plus the new
-- SOP cancellation/reminder trigger types.
ALTER TABLE public.private_booking_sms_queue
  DROP CONSTRAINT IF EXISTS private_booking_sms_queue_trigger_type_check;
ALTER TABLE public.private_booking_sms_queue
  ADD CONSTRAINT private_booking_sms_queue_trigger_type_check
  CHECK (trigger_type = ANY (ARRAY[
    'status_change'::text, 'deposit_received'::text, 'payment_received'::text,
    'final_payment_received'::text, 'reminder'::text, 'payment_due'::text,
    'urgent'::text, 'manual'::text, 'booking_created'::text, 'date_changed'::text,
    'booking_cancelled'::text, 'booking_cancelled_hold'::text,
    'booking_cancelled_refundable'::text, 'booking_cancelled_partial_refund'::text,
    'booking_cancelled_non_refundable'::text, 'booking_cancelled_manual_review'::text,
    'booking_cancelled_retention'::text, 'booking_cancelled_review_pending'::text,
    'booking_confirmed'::text, 'booking_expired'::text, 'booking_completed'::text,
    'hold_extended'::text,
    'deposit_reminder_7day'::text, 'deposit_reminder_3day'::text, 'deposit_reminder_1day'::text,
    'balance_reminder_21day'::text, 'balance_reminder_16day'::text, 'balance_reminder_15day'::text,
    'balance_reminder_due'::text,
    'balance_reminder_14day'::text, 'balance_reminder_7day'::text, 'balance_reminder_1day'::text,
    'event_reminder_14d'::text, 'event_reminder_1d'::text, 'setup_reminder'::text,
    'post_event_followup'::text, 'review_request'::text
  ]));

-- ---------------------------------------------------------------------------
-- C. VAT-aware totals
-- ---------------------------------------------------------------------------

-- VAT on the discounted net total. Booking-level discounts apply to net
-- before VAT; fixed discounts are spread pro-rata across lines.
CREATE OR REPLACE FUNCTION public.get_booking_vat_amount(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_items_total NUMERIC;
  v_vat_raw NUMERIC;
  v_discount_type TEXT;
  v_discount_amount NUMERIC;
  v_factor NUMERIC := 1;
BEGIN
  SELECT COALESCE(SUM(line_total), 0), COALESCE(SUM(line_total * COALESCE(vat_rate, 20) / 100), 0)
  INTO v_items_total, v_vat_raw
  FROM public.private_booking_items
  WHERE booking_id = p_booking_id;

  IF v_items_total <= 0 THEN
    RETURN 0;
  END IF;

  SELECT discount_type, COALESCE(discount_amount, 0)
  INTO v_discount_type, v_discount_amount
  FROM public.private_bookings
  WHERE id = p_booking_id;

  IF v_discount_type = 'percent' AND v_discount_amount > 0 THEN
    v_factor := GREATEST(0, 1 - v_discount_amount / 100);
  ELSIF v_discount_type = 'fixed' AND v_discount_amount > 0 THEN
    v_factor := GREATEST(0, v_items_total - v_discount_amount) / v_items_total;
  END IF;

  RETURN ROUND(v_vat_raw * v_factor, 2);
END;
$function$;

-- Customer-payable total: discounted net + VAT. The deposit is separate.
CREATE OR REPLACE FUNCTION public.get_booking_gross_total(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN ROUND(public.get_booking_discounted_total(p_booking_id), 2)
       + public.get_booking_vat_amount(p_booking_id);
END;
$function$;

-- Remaining balance is now against the gross (VAT-inclusive) total.
CREATE OR REPLACE FUNCTION public.calculate_private_booking_balance(p_booking_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total NUMERIC;
  v_payments_sum NUMERIC;
BEGIN
  -- Customer-payable total including VAT (stored prices are net)
  v_total := public.get_booking_gross_total(p_booking_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_payments_sum
  FROM public.private_booking_payments
  WHERE booking_id = p_booking_id;

  -- Security deposit is a returnable bond — it does NOT reduce the event cost.
  RETURN GREATEST(0, v_total - v_payments_sum);
END;
$function$;

-- Function audit: apply_balance_payment_status used the net total to decide
-- "fully paid" — must use the gross total now.
CREATE OR REPLACE FUNCTION public.apply_balance_payment_status(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_total        numeric;
  v_paid         numeric;
  v_remaining    numeric;
  v_last_method  text;
BEGIN
  -- Customer-payable total including VAT
  v_total := public.get_booking_gross_total(p_booking_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.private_booking_payments WHERE booking_id = p_booking_id;

  v_remaining := GREATEST(0, v_total - v_paid);

  IF v_remaining = 0 AND v_total > 0 THEN
    SELECT method INTO v_last_method
    FROM public.private_booking_payments
    WHERE booking_id = p_booking_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;

    UPDATE public.private_bookings
    SET final_payment_date   = now(),
        final_payment_method = v_last_method
    WHERE id = p_booking_id
      AND final_payment_date IS NULL;

  ELSIF v_remaining > 0 THEN
    UPDATE public.private_bookings
    SET final_payment_date   = NULL,
        final_payment_method = NULL
    WHERE id = p_booking_id
      AND final_payment_date IS NOT NULL;
  END IF;
END;
$function$;

-- Function audit: record_balance_payment capped payments at the net total —
-- must cap at the gross total now.
CREATE OR REPLACE FUNCTION public.record_balance_payment(p_booking_id uuid, p_amount numeric, p_method text, p_recorded_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_booking RECORD;
  v_gross_total NUMERIC;
  v_payments_total NUMERIC;
  v_remaining NUMERIC;
BEGIN
  -- SEC-001: Permission check — prevent direct RPC calls by unprivileged users
  IF NOT public.user_has_permission(auth.uid(), 'private_bookings', 'manage_deposits') THEN
    RAISE EXCEPTION 'Permission denied: manage_deposits required';
  END IF;

  -- Fetch booking with a row-level lock to prevent concurrent payment races
  SELECT id, status, event_date, start_time, end_time, customer_first_name, customer_last_name,
         customer_name, contact_phone, customer_id, calendar_event_id, guest_count, event_type,
         deposit_paid_date, deposit_amount, total_amount
  INTO v_booking
  FROM public.private_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;

  -- ID-6: Block payments on cancelled or completed bookings
  IF v_booking.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'Cannot record payment on a % booking', v_booking.status;
  END IF;

  -- Customer-payable total including VAT (stored prices are net)
  v_gross_total := public.get_booking_gross_total(p_booking_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_payments_total
  FROM public.private_booking_payments
  WHERE booking_id = p_booking_id;

  -- ID-2: Reject overpayment
  v_remaining := GREATEST(0, v_gross_total - v_payments_total);
  IF p_amount > v_remaining + 0.005 THEN
    RAISE EXCEPTION 'Amount (%) exceeds remaining balance (%)', p_amount, v_remaining;
  END IF;

  INSERT INTO public.private_booking_payments (booking_id, amount, method, recorded_by)
  VALUES (p_booking_id, p_amount, p_method, p_recorded_by);

  v_payments_total := v_payments_total + p_amount;
  v_remaining := GREATEST(0, v_gross_total - v_payments_total);

  IF v_remaining <= 0 THEN
    UPDATE public.private_bookings
    SET final_payment_date = NOW(),
        final_payment_method = p_method,
        updated_at = NOW()
    WHERE id = p_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'total_paid', v_payments_total,
    'remaining_balance', v_remaining,
    'is_fully_paid', v_remaining <= 0
  );
END;
$function$;

-- View audit: append VAT columns (new columns must come last for
-- CREATE OR REPLACE VIEW). balance_remaining / payment_status become
-- gross-based automatically via calculate_private_booking_balance.
CREATE OR REPLACE VIEW public.private_bookings_with_details AS
 SELECT pb.id,
    pb.customer_id,
    pb.customer_name,
    pb.contact_phone,
    pb.contact_email,
    pb.event_date,
    pb.start_time,
    pb.setup_time,
    pb.end_time,
    pb.end_time_next_day,
    pb.guest_count,
    pb.event_type,
    pb.status,
    pb.deposit_amount,
    pb.deposit_paid_date,
    pb.deposit_payment_method,
    pb.total_amount,
    pb.balance_due_date,
    pb.final_payment_date,
    pb.final_payment_method,
    pb.calendar_event_id,
    pb.contract_version,
    pb.internal_notes,
    pb.customer_requests,
    pb.created_by,
    pb.created_at,
    pb.updated_at,
    pb.setup_date,
    pb.discount_type,
    pb.discount_amount,
    pb.discount_reason,
    pb.customer_first_name,
    pb.customer_last_name,
    pb.customer_full_name,
    pb.date_tbd,
    c.mobile_number AS customer_mobile,
    get_booking_discounted_total(pb.id) AS calculated_total,
        CASE
            WHEN pb.deposit_paid_date IS NOT NULL THEN 'Paid'::text
            WHEN COALESCE(pb.deposit_amount, 0::numeric) <= 0::numeric THEN 'Not Required'::text
            WHEN pb.status = 'confirmed'::text THEN 'Required'::text
            ELSE 'Not Required'::text
        END AS deposit_status,
    pb.event_date - CURRENT_DATE AS days_until_event,
    pb.contract_note,
    pb.hold_expiry,
    ( SELECT COALESCE(sum(pbp.amount), 0::numeric) AS "coalesce"
           FROM private_booking_payments pbp
          WHERE pbp.booking_id = pb.id) AS total_balance_paid,
    calculate_private_booking_balance(pb.id) AS balance_remaining,
        CASE
            WHEN calculate_private_booking_balance(pb.id) <= 0::numeric THEN 'Fully Paid'::text
            WHEN (( SELECT COALESCE(sum(pbp.amount), 0::numeric) AS "coalesce"
               FROM private_booking_payments pbp
              WHERE pbp.booking_id = pb.id)) > 0::numeric THEN 'Partially Paid'::text
            ELSE 'Unpaid'::text
        END AS payment_status,
    get_booking_vat_amount(pb.id) AS vat_amount,
    get_booking_gross_total(pb.id) AS gross_total
   FROM private_bookings pb
     LEFT JOIN customers c ON pb.customer_id = c.id;

-- Function audit: booking-creation RPC now snapshots vat_rate onto items.
CREATE OR REPLACE FUNCTION public.create_private_booking_transaction(p_booking_data jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_customer_data jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_booking_id UUID;
  v_customer_id UUID;
  v_booking_record JSONB;
  v_start_time TIME;
  v_end_time TIME;
  v_end_time_next_day BOOLEAN := false;
  v_customer_mobile_raw TEXT;
  v_customer_mobile_e164 TEXT;
  v_customer_first_name TEXT;
  v_customer_last_name TEXT;
  v_customer_email TEXT;
BEGIN
  -- 1. Handle Customer (Find or Create)
  IF p_customer_data IS NOT NULL THEN
    IF (p_customer_data->>'id') IS NOT NULL THEN
      v_customer_id := (p_customer_data->>'id')::UUID;
    ELSE
      v_customer_mobile_raw := NULLIF(
        BTRIM(
          COALESCE(
            p_customer_data->>'mobile_e164',
            p_customer_data->>'mobile_number',
            ''
          )
        ),
        ''
      );

      IF v_customer_mobile_raw IS NOT NULL THEN
        v_customer_mobile_e164 := regexp_replace(v_customer_mobile_raw, '[^0-9+]', '', 'g');

        IF LEFT(v_customer_mobile_e164, 2) = '00' THEN
          v_customer_mobile_e164 := '+' || SUBSTRING(v_customer_mobile_e164 FROM 3);
        END IF;

        IF LEFT(v_customer_mobile_e164, 1) <> '+' THEN
          IF LEFT(v_customer_mobile_e164, 1) = '0' THEN
            v_customer_mobile_e164 := '+44' || LTRIM(v_customer_mobile_e164, '0');
          ELSIF LEFT(v_customer_mobile_e164, 2) = '44' THEN
            v_customer_mobile_e164 := '+' || v_customer_mobile_e164;
          ELSE
            v_customer_mobile_e164 := '+44' || v_customer_mobile_e164;
          END IF;
        END IF;

        IF v_customer_mobile_e164 !~ '^\+[1-9][0-9]{7,14}$' THEN
          v_customer_mobile_e164 := NULL;
        END IF;
      END IF;

      IF v_customer_mobile_e164 IS NOT NULL THEN
        SELECT id INTO v_customer_id
        FROM customers
        WHERE mobile_e164 = v_customer_mobile_e164
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      IF v_customer_id IS NULL AND v_customer_mobile_raw IS NOT NULL THEN
        SELECT id INTO v_customer_id
        FROM customers
        WHERE mobile_number IN (v_customer_mobile_raw, v_customer_mobile_e164)
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      IF v_customer_id IS NOT NULL AND v_customer_mobile_e164 IS NOT NULL THEN
        UPDATE customers
        SET mobile_e164 = v_customer_mobile_e164
        WHERE id = v_customer_id
          AND mobile_e164 IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM customers existing
            WHERE existing.mobile_e164 = v_customer_mobile_e164
              AND existing.id <> v_customer_id
          );
      END IF;

      IF v_customer_id IS NULL THEN
        IF v_customer_mobile_raw IS NULL AND v_customer_mobile_e164 IS NULL THEN
          RAISE EXCEPTION 'Customer mobile number is required when creating a new customer';
        END IF;

        v_customer_first_name := NULLIF(BTRIM(p_customer_data->>'first_name'), '');
        v_customer_last_name := NULLIF(BTRIM(p_customer_data->>'last_name'), '');
        v_customer_email := NULLIF(LOWER(BTRIM(p_customer_data->>'email')), '');

        INSERT INTO customers (
          first_name,
          last_name,
          mobile_number,
          mobile_e164,
          email,
          sms_opt_in
        ) VALUES (
          COALESCE(v_customer_first_name, 'Guest'),
          COALESCE(v_customer_last_name, 'Guest'),
          COALESCE(v_customer_mobile_e164, v_customer_mobile_raw),
          v_customer_mobile_e164,
          v_customer_email,
          COALESCE((p_customer_data->>'sms_opt_in')::BOOLEAN, true)
        )
        RETURNING id INTO v_customer_id;
      END IF;
    END IF;
  ELSE
    v_customer_id := (p_booking_data->>'customer_id')::UUID;
  END IF;

  -- 2. Derive time fields (handle overnight bookings)
  v_start_time := NULLIF(p_booking_data->>'start_time', '')::TIME;
  v_end_time := NULLIF(p_booking_data->>'end_time', '')::TIME;

  IF v_end_time IS NOT NULL AND v_start_time IS NOT NULL THEN
    v_end_time_next_day := v_end_time <= v_start_time;
  END IF;

  -- 3. Insert Private Booking (now includes date_tbd)
  INSERT INTO private_bookings (
    customer_id,
    event_date,
    start_time,
    end_time,
    end_time_next_day,
    setup_date,
    setup_time,
    guest_count,
    event_type,
    status,
    deposit_amount,
    balance_due_date,
    internal_notes,
    contract_note,
    customer_requests,
    special_requirements,
    accessibility_needs,
    source,
    customer_first_name,
    customer_last_name,
    customer_name,
    contact_phone,
    contact_email,
    created_by,
    hold_expiry,
    date_tbd,
    deposit_waived,
    deposit_waived_reason
  ) VALUES (
    v_customer_id,
    (p_booking_data->>'event_date')::DATE,
    v_start_time,
    v_end_time,
    v_end_time_next_day,
    NULLIF(p_booking_data->>'setup_date', '')::DATE,
    NULLIF(p_booking_data->>'setup_time', '')::TIME,
    (p_booking_data->>'guest_count')::INTEGER,
    p_booking_data->>'event_type',
    COALESCE(p_booking_data->>'status', 'draft'),
    COALESCE((p_booking_data->>'deposit_amount')::DECIMAL, 0),
    NULLIF(p_booking_data->>'balance_due_date', '')::DATE,
    p_booking_data->>'internal_notes',
    p_booking_data->>'contract_note',
    p_booking_data->>'customer_requests',
    p_booking_data->>'special_requirements',
    p_booking_data->>'accessibility_needs',
    p_booking_data->>'source',
    p_booking_data->>'customer_first_name',
    p_booking_data->>'customer_last_name',
    p_booking_data->>'customer_name',
    p_booking_data->>'contact_phone',
    NULLIF(p_booking_data->>'contact_email', ''),
    (p_booking_data->>'created_by')::UUID,
    (p_booking_data->>'hold_expiry')::TIMESTAMPTZ,
    COALESCE((p_booking_data->>'date_tbd')::BOOLEAN, false),
    COALESCE((p_booking_data->>'deposit_waived')::BOOLEAN, false),
    p_booking_data->>'deposit_waived_reason'
  )
  RETURNING id INTO v_booking_id;

  -- 4. Insert Booking Items (if any) — vat_rate snapshotted (stored prices are net)
  IF jsonb_array_length(p_items) > 0 THEN
    INSERT INTO private_booking_items (
      booking_id,
      item_type,
      description,
      space_id,
      package_id,
      vendor_id,
      quantity,
      unit_price,
      vat_rate,
      notes,
      display_order
    )
    SELECT
      v_booking_id,
      item->>'item_type',
      item->>'description',
      (item->>'space_id')::UUID,
      (item->>'package_id')::UUID,
      (item->>'vendor_id')::UUID,
      (item->>'quantity')::INTEGER,
      (item->>'unit_price')::DECIMAL,
      COALESCE((item->>'vat_rate')::NUMERIC, 20),
      item->>'notes',
      COALESCE((item->>'display_order')::INTEGER, 0)
    FROM jsonb_array_elements(p_items) AS item;
  END IF;

  -- 5. Return the created booking
  SELECT to_jsonb(pb) || jsonb_build_object('customer_id', v_customer_id)
  INTO v_booking_record
  FROM private_bookings pb
  WHERE pb.id = v_booking_id;

  RETURN v_booking_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$function$;
