-- v0.5 foundations for bookings, payments, messaging, and analytics
-- This migration extends existing event/table/private booking structures without replacing them.
-- It keeps event bookings and table bookings separate.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS mobile_number_raw text,
  ADD COLUMN IF NOT EXISTS sms_status text,
  ADD COLUMN IF NOT EXISTS marketing_sms_opt_in boolean,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

UPDATE public.customers
SET mobile_number_raw = mobile_number
WHERE mobile_number_raw IS NULL;

UPDATE public.customers
SET sms_status = CASE
  WHEN COALESCE(sms_opt_in, true) = false THEN 'opted_out'
  WHEN sms_deactivated_at IS NOT NULL THEN 'sms_deactivated'
  ELSE 'active'
END
WHERE sms_status IS NULL;

UPDATE public.customers
SET marketing_sms_opt_in = COALESCE(marketing_sms_opt_in, COALESCE(sms_opt_in, false))
WHERE marketing_sms_opt_in IS NULL;

WITH mobile_candidates AS (
  SELECT
    c.id,
    c.mobile_number AS candidate_mobile_e164,
    ROW_NUMBER() OVER (
      PARTITION BY c.mobile_number
      ORDER BY c.created_at ASC, c.id ASC
    ) AS candidate_rank
  FROM public.customers c
  WHERE c.mobile_e164 IS NULL
    AND c.mobile_number LIKE '+%'
)
UPDATE public.customers target
SET mobile_e164 = mobile_candidates.candidate_mobile_e164
FROM mobile_candidates
WHERE target.id = mobile_candidates.id
  AND mobile_candidates.candidate_rank = 1
  AND NOT EXISTS (
    SELECT 1
    FROM public.customers existing
    WHERE existing.mobile_e164 = mobile_candidates.candidate_mobile_e164
      AND existing.id <> target.id
  );

ALTER TABLE public.customers
  ALTER COLUMN sms_status SET DEFAULT 'active',
  ALTER COLUMN sms_status SET NOT NULL,
  ALTER COLUMN marketing_sms_opt_in SET DEFAULT false,
  ALTER COLUMN marketing_sms_opt_in SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_sms_status_check'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_sms_status_check
      CHECK (sms_status IN ('active', 'opted_out', 'sms_deactivated'));
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.idx_customers_mobile_e164') IS NULL
     AND to_regclass('public.idx_customers_mobile_e164_unique') IS NULL THEN
    CREATE UNIQUE INDEX idx_customers_mobile_e164_unique
      ON public.customers (mobile_e164)
      WHERE mobile_e164 IS NOT NULL;
  END IF;
END $$;

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS start_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS price_per_seat numeric(10, 2),
  ADD COLUMN IF NOT EXISTS booking_open boolean,
  ADD COLUMN IF NOT EXISTS event_type text;

UPDATE public.events
SET start_datetime = ((date::text || ' ' || time)::timestamp AT TIME ZONE 'Europe/London')
WHERE start_datetime IS NULL;

UPDATE public.events
SET payment_mode = CASE
  WHEN COALESCE(is_free, false) = true OR COALESCE(price, 0) = 0 THEN 'free'
  ELSE 'cash_only'
END
WHERE payment_mode IS NULL;

UPDATE public.events
SET price_per_seat = COALESCE(price_per_seat, price)
WHERE price_per_seat IS NULL
  AND price IS NOT NULL;

UPDATE public.events
SET booking_open = true
WHERE booking_open IS NULL;

ALTER TABLE public.events
  ALTER COLUMN payment_mode SET DEFAULT 'free',
  ALTER COLUMN payment_mode SET NOT NULL,
  ALTER COLUMN booking_open SET DEFAULT true,
  ALTER COLUMN booking_open SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_payment_mode_check'
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_payment_mode_check
      CHECK (payment_mode IN ('free', 'cash_only', 'prepaid'));
  END IF;
END $$;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;

UPDATE public.bookings
SET status = CASE
  WHEN is_reminder_only THEN 'confirmed'
  ELSE 'confirmed'
END
WHERE status IS NULL;

UPDATE public.bookings
SET source = COALESCE(source, booking_source, 'brand_site')
WHERE source IS NULL;

UPDATE public.bookings
SET seats = 1
WHERE seats IS NULL OR seats < 1;

ALTER TABLE public.bookings
  ALTER COLUMN status SET DEFAULT 'confirmed',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'brand_site',
  ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bookings_status_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_status_check
      CHECK (status IN ('pending_payment', 'confirmed', 'cancelled', 'expired'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS set_bookings_updated_at ON public.bookings;
    CREATE TRIGGER set_bookings_updated_at
      BEFORE UPDATE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER TYPE public.table_booking_status ADD VALUE IF NOT EXISTS 'pending_card_capture';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TYPE public.table_booking_status ADD VALUE IF NOT EXISTS 'visited_waiting_for_review';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TYPE public.table_booking_status ADD VALUE IF NOT EXISTS 'review_clicked';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS is_bookable boolean,
  ADD COLUMN IF NOT EXISTS area text;

UPDATE public.tables
SET name = COALESCE(name, table_number)
WHERE name IS NULL;

UPDATE public.tables
SET is_bookable = true
WHERE is_bookable IS NULL;

ALTER TABLE public.tables
  ALTER COLUMN is_bookable SET DEFAULT true,
  ALTER COLUMN is_bookable SET NOT NULL;

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS booking_purpose text,
  ADD COLUMN IF NOT EXISTS committed_party_size integer,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS card_capture_required boolean,
  ADD COLUMN IF NOT EXISTS card_capture_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_marked_by uuid,
  ADD COLUMN IF NOT EXISTS left_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS sunday_preorder_cutoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS sunday_preorder_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS start_datetime timestamptz,
  ADD COLUMN IF NOT EXISTS end_datetime timestamptz;

UPDATE public.table_bookings
SET booking_purpose = COALESCE(booking_purpose, 'food')
WHERE booking_purpose IS NULL;

UPDATE public.table_bookings
SET committed_party_size = COALESCE(committed_party_size, party_size)
WHERE committed_party_size IS NULL;

UPDATE public.table_bookings
SET card_capture_required = CASE
  WHEN booking_type = 'sunday_lunch' THEN true
  WHEN party_size BETWEEN 7 AND 20 THEN true
  ELSE false
END
WHERE card_capture_required IS NULL;

UPDATE public.table_bookings
SET start_datetime = (booking_date::text || ' ' || booking_time)::timestamp AT TIME ZONE 'Europe/London'
WHERE start_datetime IS NULL;

UPDATE public.table_bookings
SET end_datetime = (
  (booking_date::text || ' ' || booking_time)::timestamp +
  make_interval(mins => COALESCE(duration_minutes, CASE WHEN booking_type = 'sunday_lunch' THEN 120 ELSE 90 END))
) AT TIME ZONE 'Europe/London'
WHERE end_datetime IS NULL;

ALTER TABLE public.table_bookings
  ALTER COLUMN booking_purpose SET DEFAULT 'food',
  ALTER COLUMN booking_purpose SET NOT NULL,
  ALTER COLUMN committed_party_size SET NOT NULL,
  ALTER COLUMN card_capture_required SET DEFAULT false,
  ALTER COLUMN card_capture_required SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'table_bookings_booking_purpose_check'
  ) THEN
    ALTER TABLE public.table_bookings
      ADD CONSTRAINT table_bookings_booking_purpose_check
      CHECK (booking_purpose IN ('food', 'drinks'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.booking_table_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE RESTRICT,
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_table_assignments_table_time
  ON public.booking_table_assignments (table_id, start_datetime, end_datetime);

CREATE INDEX IF NOT EXISTS idx_booking_table_assignments_booking
  ON public.booking_table_assignments (table_booking_id);

CREATE TABLE IF NOT EXISTS public.waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  requested_seats integer NOT NULL CHECK (requested_seats > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'offered', 'accepted', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  offered_at timestamptz,
  accepted_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_event_status_created
  ON public.waitlist_entries (event_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_waitlist_entries_customer
  ON public.waitlist_entries (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.waitlist_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_entry_id uuid NOT NULL REFERENCES public.waitlist_entries(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  seats_held integer NOT NULL CHECK (seats_held > 0),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'accepted', 'expired', 'cancelled')),
  scheduled_sms_send_time timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  expired_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_offers_entry
  ON public.waitlist_offers (waitlist_entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_offers_event_status_expires
  ON public.waitlist_offers (event_id, status, expires_at);

CREATE TABLE IF NOT EXISTS public.booking_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hold_type text NOT NULL CHECK (hold_type IN ('payment_hold', 'waitlist_hold', 'card_capture_hold')),
  event_booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  waitlist_offer_id uuid REFERENCES public.waitlist_offers(id) ON DELETE CASCADE,
  seats_or_covers_held integer NOT NULL CHECK (seats_or_covers_held > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  scheduled_sms_send_time timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  released_at timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'booking_holds_reference_check'
  ) THEN
    ALTER TABLE public.booking_holds
      ADD CONSTRAINT booking_holds_reference_check
      CHECK (
        event_booking_id IS NOT NULL
        OR table_booking_id IS NOT NULL
        OR waitlist_offer_id IS NOT NULL
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_booking_holds_expires_status
  ON public.booking_holds (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_booking_holds_event_booking
  ON public.booking_holds (event_booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_holds_table_booking
  ON public.booking_holds (table_booking_id);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  charge_type text NOT NULL CHECK (charge_type IN ('prepaid_event', 'seat_increase', 'refund', 'approved_fee', 'walkout')),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'GBP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'payments_booking_reference_check'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_booking_reference_check
      CHECK (event_booking_id IS NOT NULL OR table_booking_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payments_event_booking
  ON public.payments (event_booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_table_booking
  ON public.payments (table_booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_intent
  ON public.payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.card_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  stripe_setup_intent_id text,
  stripe_payment_method_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
  expires_at timestamptz,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_card_captures_booking_status
  ON public.card_captures (table_booking_id, status);

CREATE INDEX IF NOT EXISTS idx_card_captures_expires
  ON public.card_captures (expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.charge_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('late_cancel', 'no_show', 'reduction_fee', 'walkout')),
  amount numeric(10, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'GBP',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by text NOT NULL DEFAULT 'system' CHECK (requested_by IN ('system', 'foh')),
  requested_by_user_id uuid,
  manager_decision text CHECK (manager_decision IN ('approved', 'waived')),
  decided_at timestamptz,
  stripe_payment_intent_id text,
  charge_status text NOT NULL DEFAULT 'pending' CHECK (charge_status IN ('pending', 'succeeded', 'failed', 'waived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_charge_requests_booking_created
  ON public.charge_requests (table_booking_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_charge_requests_status
  ON public.charge_requests (charge_status, manager_decision);

CREATE TABLE IF NOT EXISTS public.guest_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hashed_token text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  event_booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  charge_request_id uuid REFERENCES public.charge_requests(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('manage', 'card_capture', 'payment', 'review_redirect', 'charge_approval')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_tokens_customer_action
  ON public.guest_tokens (customer_id, action_type, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_guest_tokens_expiry
  ON public.guest_tokens (expires_at);

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS event_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS private_booking_id uuid REFERENCES public.private_bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_key text;

CREATE INDEX IF NOT EXISTS idx_messages_event_booking_id
  ON public.messages (event_booking_id)
  WHERE event_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_table_booking_id
  ON public.messages (table_booking_id)
  WHERE table_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_private_booking_id
  ON public.messages (private_booking_id)
  WHERE private_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  private_booking_id uuid REFERENCES public.private_bookings(id) ON DELETE CASCADE,
  rating_overall integer CHECK (rating_overall BETWEEN 1 AND 5),
  rating_food integer CHECK (rating_food BETWEEN 1 AND 5),
  rating_service integer CHECK (rating_service BETWEEN 1 AND 5),
  comments text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'feedback_reference_check'
  ) THEN
    ALTER TABLE public.feedback
      ADD CONSTRAINT feedback_reference_check
      CHECK (
        event_booking_id IS NOT NULL
        OR table_booking_id IS NOT NULL
        OR private_booking_id IS NOT NULL
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_feedback_created_at
  ON public.feedback (created_at DESC);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  event_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  table_booking_id uuid REFERENCES public.table_bookings(id) ON DELETE SET NULL,
  private_booking_id uuid REFERENCES public.private_bookings(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_customer_created
  ON public.analytics_events (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type_created
  ON public.analytics_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_scores (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  total_score integer NOT NULL DEFAULT 0,
  last_booking_date date,
  bookings_last_30 integer NOT NULL DEFAULT 0,
  bookings_last_90 integer NOT NULL DEFAULT 0,
  bookings_last_365 integer NOT NULL DEFAULT 0,
  booking_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS set_waitlist_entries_updated_at ON public.waitlist_entries;
    CREATE TRIGGER set_waitlist_entries_updated_at
      BEFORE UPDATE ON public.waitlist_entries
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS set_booking_holds_updated_at ON public.booking_holds;
    CREATE TRIGGER set_booking_holds_updated_at
      BEFORE UPDATE ON public.booking_holds
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS set_card_captures_updated_at ON public.card_captures;
    CREATE TRIGGER set_card_captures_updated_at
      BEFORE UPDATE ON public.card_captures
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS set_charge_requests_updated_at ON public.charge_requests;
    CREATE TRIGGER set_charge_requests_updated_at
      BEFORE UPDATE ON public.charge_requests
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

    DROP TRIGGER IF EXISTS set_customer_scores_updated_at ON public.customer_scores;
    CREATE TRIGGER set_customer_scores_updated_at
      BEFORE UPDATE ON public.customer_scores
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
