-- Private Bookings SOP compliance: conflict prevention and supplier documents.
--   A. Space model: Entire-Pub style spaces block all others (pack §6/§28).
--   B. Conflict detection function: holds and confirmed bookings block their
--      spaces (incl. setup/clear-down windows) against other bookings.
--   C. Supplier records with document/approval status and the 14-day deadline
--      (pack §20/§28.18).

-- ---------------------------------------------------------------------------
-- A. Space model
-- ---------------------------------------------------------------------------

ALTER TABLE public.venue_spaces
  ADD COLUMN IF NOT EXISTS blocks_all_spaces boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venue_spaces.blocks_all_spaces IS
  'Whole-venue spaces (e.g. Entire Pub) conflict with every other space for the booking period plus setup and clear-down (SOP §6).';

UPDATE public.venue_spaces
SET blocks_all_spaces = true
WHERE name ~* 'entire pub|whole pub|whole venue|entire venue|exclusive';

-- ---------------------------------------------------------------------------
-- B. Conflict detection
-- ---------------------------------------------------------------------------

-- Effective occupancy window of a booking:
--   starts at setup (setup_date/setup_time when given, else one hour before
--   start per the standard setup access) and ends at clear-down
--   (cleardown_time when given, else one hour after the booked end time).
-- Bookings block while draft-with-live-hold or confirmed.
CREATE OR REPLACE FUNCTION public.get_private_booking_conflicts(
  p_event_date date,
  p_start_time time,
  p_end_time time,
  p_setup_date date DEFAULT NULL,
  p_setup_time time DEFAULT NULL,
  p_cleardown_time time DEFAULT NULL,
  p_space_ids uuid[] DEFAULT '{}',
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS TABLE (
  booking_id uuid,
  customer_name text,
  booking_status text,
  space_name text,
  blocks_all boolean,
  occupies_from timestamptz,
  occupies_until timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
WITH candidate_window AS (
  SELECT
    COALESCE(p_setup_date, p_event_date)::timestamp
      + CASE
          WHEN p_setup_time IS NOT NULL THEN p_setup_time::interval
          WHEN p_start_time IS NOT NULL THEN p_start_time::interval - INTERVAL '1 hour'
          ELSE INTERVAL '0'
        END AS win_start,
    p_event_date::timestamp
      + CASE
          WHEN p_cleardown_time IS NOT NULL THEN p_cleardown_time::interval
          WHEN p_end_time IS NOT NULL THEN p_end_time::interval + INTERVAL '1 hour'
          ELSE INTERVAL '23 hours 59 minutes'
        END
      + CASE
          WHEN p_end_time IS NOT NULL AND p_start_time IS NOT NULL AND p_end_time <= p_start_time
            THEN INTERVAL '1 day'
          ELSE INTERVAL '0'
        END AS win_end
),
candidate_blocks_all AS (
  SELECT COALESCE(bool_or(vs.blocks_all_spaces), false) AS blocks_all
  FROM public.venue_spaces vs
  WHERE vs.id = ANY (p_space_ids)
),
other_bookings AS (
  SELECT
    pb.id,
    pb.customer_name,
    pb.status,
    COALESCE(pb.setup_date, pb.event_date)::timestamp
      + CASE
          WHEN pb.setup_time IS NOT NULL THEN pb.setup_time::interval
          WHEN pb.start_time IS NOT NULL THEN pb.start_time::interval - INTERVAL '1 hour'
          ELSE INTERVAL '0'
        END AS occ_start,
    pb.event_date::timestamp
      + CASE
          WHEN pb.cleardown_time IS NOT NULL THEN pb.cleardown_time::interval
          WHEN pb.end_time IS NOT NULL THEN pb.end_time::interval + INTERVAL '1 hour'
          ELSE INTERVAL '23 hours 59 minutes'
        END
      + CASE
          WHEN pb.end_time IS NOT NULL AND pb.start_time IS NOT NULL
               AND (pb.end_time_next_day OR pb.end_time <= pb.start_time)
            THEN INTERVAL '1 day'
          ELSE INTERVAL '0'
        END AS occ_end
  FROM public.private_bookings pb
  WHERE pb.event_date IS NOT NULL
    AND COALESCE(pb.date_tbd, false) = false
    AND (p_exclude_booking_id IS NULL OR pb.id <> p_exclude_booking_id)
    AND (
      pb.status = 'confirmed'
      OR (pb.status = 'draft' AND pb.hold_expiry IS NOT NULL AND pb.hold_expiry > now())
    )
    -- Only bookings within a day either side can possibly overlap
    AND pb.event_date BETWEEN p_event_date - 1 AND p_event_date + 1
)
SELECT
  ob.id AS booking_id,
  ob.customer_name,
  ob.status AS booking_status,
  vs.name AS space_name,
  vs.blocks_all_spaces AS blocks_all,
  ob.occ_start AS occupies_from,
  ob.occ_until AS occupies_until
FROM (
  SELECT o.*, o.occ_end AS occ_until FROM other_bookings o
) ob
JOIN public.private_booking_items i
  ON i.booking_id = ob.id AND i.item_type = 'space' AND i.space_id IS NOT NULL
JOIN public.venue_spaces vs ON vs.id = i.space_id
CROSS JOIN candidate_window cw
CROSS JOIN candidate_blocks_all cba
WHERE ob.occ_start < cw.win_end
  AND ob.occ_until > cw.win_start
  AND (
    vs.blocks_all_spaces          -- other booking holds a whole-venue space
    OR cba.blocks_all             -- candidate wants the whole venue
    OR i.space_id = ANY (p_space_ids)  -- direct space clash
  )
GROUP BY ob.id, ob.customer_name, ob.status, vs.name, vs.blocks_all_spaces, ob.occ_start, ob.occ_until;
$function$;

-- Server-side callers only (service role / authenticated staff via actions)
REVOKE ALL ON FUNCTION public.get_private_booking_conflicts(date, time, time, date, time, time, uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_private_booking_conflicts(date, time, time, date, time, time, uuid[], uuid) FROM anon;

-- ---------------------------------------------------------------------------
-- C. Suppliers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.private_booking_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id),
  name text NOT NULL,
  supplier_type text,
  contact_details text,
  arrival_time time,
  departure_time time,
  vehicle_notes text,
  power_requirements text,
  documents_required text[] NOT NULL DEFAULT '{}',
  documents_received text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'incomplete', 'approved', 'rejected')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.private_booking_suppliers IS
  'External suppliers per booking (SOP §20): pre-approved, documents (PLI, PAT, risk assessment, food hygiene…) due no later than 14 calendar days before the event.';

CREATE INDEX IF NOT EXISTS idx_pb_suppliers_booking ON public.private_booking_suppliers (booking_id);

ALTER TABLE public.private_booking_suppliers ENABLE ROW LEVEL SECURITY;
