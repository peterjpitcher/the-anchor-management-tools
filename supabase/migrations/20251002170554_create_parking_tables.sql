-- Parking module core schema

-- enums for booking and payment status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_booking_status') THEN
    CREATE TYPE parking_booking_status AS ENUM ('pending_payment', 'confirmed', 'completed', 'cancelled', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_payment_status') THEN
    CREATE TYPE parking_payment_status AS ENUM ('pending', 'paid', 'refunded', 'failed', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_notification_channel') THEN
    CREATE TYPE parking_notification_channel AS ENUM ('sms', 'email');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parking_notification_event') THEN
    CREATE TYPE parking_notification_event AS ENUM (
      'payment_request',
      'payment_reminder',
      'payment_confirmation',
      'session_start',
      'session_end',
      'payment_overdue',
      'refund_confirmation'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.parking_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from timestamptz NOT NULL DEFAULT timezone('utc', now()),
  hourly_rate numeric(12, 2) NOT NULL,
  daily_rate numeric(12, 2) NOT NULL,
  weekly_rate numeric(12, 2) NOT NULL,
  monthly_rate numeric(12, 2) NOT NULL,
  capacity_override integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.parking_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text UNIQUE NOT NULL,
  customer_id uuid REFERENCES public.customers (id) ON DELETE RESTRICT,
  customer_first_name text NOT NULL,
  customer_last_name text,
  customer_mobile text NOT NULL,
  customer_email text,
  vehicle_registration text NOT NULL,
  vehicle_make text,
  vehicle_model text,
  vehicle_colour text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  calculated_price numeric(12,2) NOT NULL,
  pricing_breakdown jsonb NOT NULL,
  override_price numeric(12,2),
  override_reason text,
  capacity_override boolean DEFAULT false,
  capacity_override_reason text,
  status parking_booking_status NOT NULL DEFAULT 'pending_payment',
  payment_status parking_payment_status NOT NULL DEFAULT 'pending',
  payment_due_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_by uuid REFERENCES auth.users (id),
  updated_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.parking_booking_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.parking_bookings (id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'paypal',
  status parking_payment_status NOT NULL DEFAULT 'pending',
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'GBP',
  paypal_order_id text,
  transaction_id text,
  expires_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.parking_booking_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.parking_bookings (id) ON DELETE CASCADE,
  channel parking_notification_channel NOT NULL,
  event_type parking_notification_event NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  message_sid text,
  email_message_id text,
  payload jsonb,
  error text,
  sent_at timestamptz,
  retries integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE OR REPLACE FUNCTION public.generate_parking_reference()
RETURNS trigger AS $$
DECLARE
  prefix text := 'PAR';
  today text := to_char(timezone('Europe/London', now()), 'YYYYMMDD');
  seq int;
  candidate text;
BEGIN
  IF NEW.reference IS NOT NULL THEN
    RETURN NEW;
  END IF;

  LOOP
    SELECT COALESCE(MAX(split_part(reference, '-', 3)::int), 0) + 1
      INTO seq
      FROM public.parking_bookings
      WHERE split_part(reference, '-', 1) = prefix
        AND split_part(reference, '-', 2) = today;

    candidate := prefix || '-' || today || '-' || lpad(seq::text, 4, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.parking_bookings WHERE reference = candidate
    );
  END LOOP;

  NEW.reference := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_parking_reference
BEFORE INSERT ON public.parking_bookings
FOR EACH ROW
EXECUTE FUNCTION public.generate_parking_reference();

CREATE OR REPLACE FUNCTION public.set_parking_booking_timestamps()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, timezone('utc', now()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_parking_booking_timestamps
BEFORE INSERT OR UPDATE ON public.parking_bookings
FOR EACH ROW
EXECUTE FUNCTION public.set_parking_booking_timestamps();

CREATE OR REPLACE FUNCTION public.set_parking_payment_timestamps()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := timezone('utc', now());
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, timezone('utc', now()));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_set_parking_payment_timestamps
BEFORE INSERT OR UPDATE ON public.parking_booking_payments
FOR EACH ROW
EXECUTE FUNCTION public.set_parking_payment_timestamps();

CREATE INDEX IF NOT EXISTS parking_bookings_customer_idx
  ON public.parking_bookings (customer_id);

CREATE INDEX IF NOT EXISTS parking_bookings_time_range_idx
  ON public.parking_bookings USING gist (tstzrange(start_at, end_at));

CREATE INDEX IF NOT EXISTS parking_bookings_status_idx
  ON public.parking_bookings (status, payment_status);

CREATE INDEX IF NOT EXISTS parking_booking_payments_booking_idx
  ON public.parking_booking_payments (booking_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS parking_booking_payments_unique_pending
  ON public.parking_booking_payments (booking_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS parking_booking_notifications_booking_idx
  ON public.parking_booking_notifications (booking_id);

-- Capacity enforcement helper
CREATE OR REPLACE FUNCTION public.check_parking_capacity(
  p_start timestamptz,
  p_end timestamptz,
  p_ignore_booking uuid DEFAULT NULL
)
RETURNS TABLE (
  remaining integer,
  capacity integer,
  active integer
)
LANGUAGE plpgsql
AS $$
DECLARE
  active_capacity integer;
  active_bookings integer;
BEGIN
  SELECT COALESCE(capacity_override, 10)
    INTO active_capacity
  FROM public.parking_rates
  WHERE effective_from <= timezone('utc', now())
  ORDER BY effective_from DESC
  LIMIT 1;

  active_capacity := COALESCE(active_capacity, 10);

  SELECT COUNT(*)
    INTO active_bookings
  FROM public.parking_bookings
  WHERE status IN ('pending_payment', 'confirmed')
    AND tstzrange(start_at, end_at, '[]') && tstzrange(p_start, p_end, '[]')
    AND (p_ignore_booking IS NULL OR id <> p_ignore_booking);

  RETURN QUERY SELECT active_capacity - active_bookings, active_capacity, active_bookings;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_parking_capacity()
RETURNS trigger AS $$
DECLARE
  remaining integer;
BEGIN
  IF NEW.capacity_override THEN
    RETURN NEW;
  END IF;

  SELECT remaining INTO remaining
  FROM public.check_parking_capacity(NEW.start_at, NEW.end_at, CASE WHEN TG_OP = 'UPDATE' THEN NEW.id ELSE NULL END);

  IF remaining < 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'Parking capacity exceeded';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_parking_capacity
BEFORE INSERT OR UPDATE ON public.parking_bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_parking_capacity();

-- Seed initial rates if none exist
INSERT INTO public.parking_rates (hourly_rate, daily_rate, weekly_rate, monthly_rate, notes)
SELECT 5, 15, 75, 265, 'Initial standard rates'
WHERE NOT EXISTS (SELECT 1 FROM public.parking_rates);

-- RLS & Policies
ALTER TABLE public.parking_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parking_booking_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY parking_rates_read ON public.parking_rates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_bookings_read ON public.parking_bookings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_bookings_modify ON public.parking_bookings
  FOR INSERT, UPDATE, DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'parking', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_booking_payments_read ON public.parking_booking_payments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_booking_payments_modify ON public.parking_booking_payments
  FOR INSERT, UPDATE, DELETE TO authenticated
  USING (public.user_has_permission(auth.uid(), 'parking', 'manage'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

CREATE POLICY parking_notifications_read ON public.parking_booking_notifications
  FOR SELECT TO authenticated USING (true);

CREATE POLICY parking_notifications_insert ON public.parking_booking_notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'parking', 'manage'));

GRANT ALL ON public.parking_rates TO service_role;
GRANT ALL ON public.parking_bookings TO service_role;
GRANT ALL ON public.parking_booking_payments TO service_role;
GRANT ALL ON public.parking_booking_notifications TO service_role;

-- Parking module permissions seeded for RBAC
DO $$
DECLARE
  perm_view UUID;
  perm_manage UUID;
  perm_refund UUID;
  role_super_admin UUID;
  role_manager UUID;
  role_staff UUID;
BEGIN
  INSERT INTO permissions (module_name, action, description)
  VALUES ('parking', 'view', 'View parking bookings and availability')
  ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO perm_view;

  IF perm_view IS NULL THEN
    SELECT id INTO perm_view FROM permissions WHERE module_name = 'parking' AND action = 'view' LIMIT 1;
  END IF;

  INSERT INTO permissions (module_name, action, description)
  VALUES ('parking', 'manage', 'Create and manage parking bookings')
  ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO perm_manage;

  IF perm_manage IS NULL THEN
    SELECT id INTO perm_manage FROM permissions WHERE module_name = 'parking' AND action = 'manage' LIMIT 1;
  END IF;

  INSERT INTO permissions (module_name, action, description)
  VALUES ('parking', 'refund', 'Process parking payment refunds')
  ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description
  RETURNING id INTO perm_refund;

  IF perm_refund IS NULL THEN
    SELECT id INTO perm_refund FROM permissions WHERE module_name = 'parking' AND action = 'refund' LIMIT 1;
  END IF;

  SELECT id INTO role_super_admin FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO role_manager FROM roles WHERE name = 'manager' LIMIT 1;
  SELECT id INTO role_staff FROM roles WHERE name = 'staff' LIMIT 1;

  IF role_super_admin IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_super_admin, p_id
    FROM (VALUES (perm_view), (perm_manage), (perm_refund)) AS perms(p_id)
    WHERE p_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.role_id = role_super_admin AND rp.permission_id = p_id
      );
  END IF;

  IF role_manager IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT role_manager, p_id
    FROM (VALUES (perm_view), (perm_manage)) AS perms(p_id)
    WHERE p_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp WHERE rp.role_id = role_manager AND rp.permission_id = p_id
      );
  END IF;

  IF role_staff IS NOT NULL AND perm_view IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (role_staff, perm_view)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
