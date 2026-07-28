-- Minimal stand-in for the parts of the AMS schema the new migrations touch.
-- Mirrors production shapes verified on 2026-07-27 (see tasks/artefacts/2026-07-27/baseline.md).
-- Throwaway validation harness only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;         EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated;EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE public.table_booking_status AS ENUM
  ('pending_payment','confirmed','cancelled','no_show','completed',
   'pending_card_capture','visited_waiting_for_review','review_clicked');

CREATE TYPE public.payment_status AS ENUM
  ('pending','completed','failed','refunded','partial_refund');

CREATE TABLE public.tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number text NOT NULL,
  name text,
  capacity integer NOT NULL,
  is_active boolean DEFAULT true,
  is_bookable boolean NOT NULL DEFAULT true,
  notes text,
  area text,
  area_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.table_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid,
  booking_reference text UNIQUE,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  party_size integer NOT NULL,
  committed_party_size integer,
  status public.table_booking_status NOT NULL DEFAULT 'confirmed',
  payment_status public.payment_status DEFAULT 'pending',
  booking_purpose text DEFAULT 'food',
  booking_type text DEFAULT 'regular',
  is_outside_seating boolean NOT NULL DEFAULT false,
  high_chair_count integer DEFAULT 0,
  start_datetime timestamptz,
  end_datetime timestamptz,
  left_at timestamptz,
  seated_at timestamptz,
  hold_expires_at timestamptz,
  source varchar,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.booking_table_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.tables(id),
  start_datetime timestamptz NOT NULL,
  end_datetime timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_booking_table_assignments_table_window
  ON public.booking_table_assignments (table_id, start_datetime, end_datetime);

CREATE TABLE public.event_communal_seat_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid,
  event_booking_id uuid,
  table_booking_id uuid,
  table_id uuid REFERENCES public.tables(id),
  seats integer,
  start_datetime timestamptz,
  end_datetime timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.table_join_links (
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  join_table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  created_by uuid,
  PRIMARY KEY (table_id, join_table_id)
);

CREATE TABLE public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  user_id uuid,
  user_email text,
  operation_type text,
  resource_type text,
  resource_id text,
  operation_status text,
  ip_address inet,
  user_agent text,
  old_values jsonb,
  new_values jsonb,
  error_message text,
  additional_info jsonb
);

-- Stand-in for the real private-booking block check. The real one joins
-- tables -> venue_space_table_areas -> private_booking_items -> private_bookings
-- with a 30 minute buffer. Here it is driven by a fixture table so tests can
-- switch it on for a specific table and window.
CREATE TABLE public.test_private_blocks (
  table_id uuid,
  starts_at timestamptz,
  ends_at timestamptz
);

CREATE OR REPLACE FUNCTION public.is_table_blocked_by_private_booking_v05(
  p_table_id uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.test_private_blocks b
    WHERE b.table_id = p_table_id
      AND b.starts_at < p_end AND b.ends_at > p_start
  );
$$;

-- The real floor, by UUID, exactly as production had it on 2026-07-27.
INSERT INTO public.tables (id, table_number, name, capacity, is_bookable) VALUES
  ('23d64766-a079-4700-9a07-708e3de2c8f6','1','Electric Cupbard',4,false),
  ('d0b22c8d-ac37-41b3-9c8b-45eb174f29c6','2','Big Bay',6,true),
  ('37d61f34-0eed-4a97-9e8c-aa868fdfe779','3','Small Bay',5,true),
  ('ea61faf9-ebfc-4964-bd60-ef907af36848','4','Low 4a',4,true),
  ('8ff55f2a-86cb-4b2d-ae74-2d8cae44499b','5','Low 4b',4,true),
  ('8f573b96-a337-4d6f-b21c-a7577471cec2','6','High 4',4,true),
  ('ce917bec-36e8-472c-acfd-87f0d58f7d32','7','High 2',4,false),
  ('39350c06-d5ea-4cea-a742-9ea78ebc0557','8','Dining Room 4a',4,true),
  ('f16044f7-8dcf-4403-8e89-02992fdc9532','9','Dining Room 4b',4,true),
  ('5deb3b97-1f18-4ee7-97c9-887b47ff504e','10','Dining Room 6a',6,true),
  ('eca30e1a-9000-410a-97f3-c7bda2ed538b','11','Dining Room 6b',6,true),
  ('fc306a12-0cb2-4692-bf3f-cfb89466abb6','12','Dining Room 6c',6,true);

-- The 11 real join links, stored directionally exactly as production has them.
INSERT INTO public.table_join_links (table_id, join_table_id) VALUES
  ('39350c06-d5ea-4cea-a742-9ea78ebc0557','f16044f7-8dcf-4403-8e89-02992fdc9532'),
  ('39350c06-d5ea-4cea-a742-9ea78ebc0557','5deb3b97-1f18-4ee7-97c9-887b47ff504e'),
  ('39350c06-d5ea-4cea-a742-9ea78ebc0557','eca30e1a-9000-410a-97f3-c7bda2ed538b'),
  ('39350c06-d5ea-4cea-a742-9ea78ebc0557','fc306a12-0cb2-4692-bf3f-cfb89466abb6'),
  ('f16044f7-8dcf-4403-8e89-02992fdc9532','fc306a12-0cb2-4692-bf3f-cfb89466abb6'),
  ('5deb3b97-1f18-4ee7-97c9-887b47ff504e','f16044f7-8dcf-4403-8e89-02992fdc9532'),
  ('5deb3b97-1f18-4ee7-97c9-887b47ff504e','eca30e1a-9000-410a-97f3-c7bda2ed538b'),
  ('5deb3b97-1f18-4ee7-97c9-887b47ff504e','fc306a12-0cb2-4692-bf3f-cfb89466abb6'),
  ('eca30e1a-9000-410a-97f3-c7bda2ed538b','f16044f7-8dcf-4403-8e89-02992fdc9532'),
  ('eca30e1a-9000-410a-97f3-c7bda2ed538b','fc306a12-0cb2-4692-bf3f-cfb89466abb6'),
  ('8ff55f2a-86cb-4b2d-ae74-2d8cae44499b','ea61faf9-ebfc-4964-bd60-ef907af36848');

-- Live settings as production had them.
INSERT INTO public.system_settings (key, value) VALUES
  ('kitchen_pacing_enabled','{"value": true}'),
  ('kitchen_pacing_window_minutes','{"value": 30}'),
  ('kitchen_walk_in_reserve_regular','{"value": 6}'),
  ('kitchen_walk_in_reserve_sunday','{"value": 6}'),
  ('high_chair_inventory','{"value": 2}'),
  ('pacing_busy_threshold_covers','{"value": 30}'),
  ('pacing_filling_threshold_covers','{"value": 20}'),
  ('pacing_window_minutes','{"value": 60}');

-- Event-side stand-ins, needed by allocate_event_communal_seats_v02.
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text,
  hold_expires_at timestamptz
);

CREATE OR REPLACE FUNCTION public.is_active_event_booking_for_capacity_v01(
  p_status text, p_hold_expires_at timestamptz
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_status IS DISTINCT FROM 'cancelled'
     AND (p_hold_expires_at IS NULL OR p_hold_expires_at > now());
$$;

-- The production assignment trigger is attached here on purpose. Without it the harness
-- could not see a selection-versus-enforcement disagreement (review finding F8), which is
-- exactly the class of bug that let the private-booking regression survive.
-- The function body itself is installed by migration 20260801001000.
CREATE OR REPLACE FUNCTION public.enforce_booking_table_assignment_integrity_v05()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;

CREATE TRIGGER trg_enforce_booking_table_assignment_integrity_v05
  BEFORE INSERT OR UPDATE ON public.booking_table_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_booking_table_assignment_integrity_v05();
