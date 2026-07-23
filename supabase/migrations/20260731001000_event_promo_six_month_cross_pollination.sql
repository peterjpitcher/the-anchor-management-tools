-- Event promo audience: six month cross pollination and a gentler frequency policy.
--
-- Three defects are fixed here, all of which silently shrank the invite audience:
--
-- 1. FREQUENCY BLACKOUT WAS EVENT AGNOSTIC. The old rule was "no promo at all if
--    this customer received any promo in the last N days". Because the venue runs
--    events every few days, a text about one event routinely swallowed the invite
--    for the next one. On 22 Jul 2026 this cost Quiz Night ten of its thirteen
--    eligible invites: all ten had been texted about Music Bingo five days earlier.
--    Replaced by a count of DISTINCT EVENTS promoted in a rolling window, so a
--    customer hears about a couple of different events a fortnight rather than
--    being silenced by the first one. The day before nudge for an event they were
--    already told about no longer consumes the budget a second time.
--
-- 2. ATTENDING AN EVENT REMOVED YOU FROM THE AUDIENCE. valid_attendance only
--    counted bookings with status 'confirmed'. After an event the review flow moves
--    a booking to 'visited_waiting_for_review' and then 'review_clicked', so the
--    most engaged customers, the ones who came and left a review, dropped out of
--    every future invite. Those statuses (and 'completed') now count as attendance.
--
-- 3. THE RECIPIENT LIMIT CUT BY UUID, NOT RECENCY. DISTINCT ON (customer_id) forces
--    an ORDER BY starting with customer_id, so the outer LIMIT was slicing an
--    effectively random set once the pool exceeded the cap. Deduplication now
--    happens in a subquery so the outer query can order by priority and recency,
--    meaning the cap keeps the most recent guests.
--
-- Recency defaults move from 90/42 days to 180/180 (six months) at the call site in
-- src/lib/sms/cross-promo.ts. This function keeps taking them as parameters.
--
-- The signature changes (p_frequency_cap_days becomes p_frequency_window_days plus
-- p_max_events_per_window), so the old function is dropped and recreated. Nothing
-- else calls it: the sole caller is sendCrossPromoForEvent, updated in the same
-- change.

DROP FUNCTION IF EXISTS public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.get_cross_promo_audience(
  p_event_id uuid,
  p_category_id uuid,
  p_recency_days integer DEFAULT 180,
  p_general_recency_days integer DEFAULT 180,
  p_frequency_window_days integer DEFAULT 14,
  p_max_events_per_window integer DEFAULT 2,
  p_max_recipients integer DEFAULT 30
)
RETURNS TABLE(
  customer_id uuid,
  first_name text,
  last_name text,
  phone_number text,
  last_event_category text,
  times_attended bigint,
  audience_type text,
  last_event_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH valid_attendance AS (
    SELECT
      b.customer_id,
      e.category_id,
      e.name::TEXT AS event_name,
      e.date
    FROM bookings b
    JOIN events e ON e.id = b.event_id
    WHERE e.category_id IS NOT NULL
      AND b.seats > 0
      -- Attendance survives the post event review lifecycle. Previously only
      -- 'confirmed' counted, so attending and reviewing removed you from the pool.
      AND b.status IN ('confirmed', 'completed', 'visited_waiting_for_review', 'review_clicked')
      AND (b.is_reminder_only IS NULL OR b.is_reminder_only = FALSE)
      AND e.date < CURRENT_DATE
      AND (e.event_status IS NULL OR e.event_status NOT IN ('cancelled', 'draft'))
  ),
  category_attendance AS (
    SELECT
      va.customer_id,
      va.category_id,
      COUNT(*)::BIGINT AS times_attended,
      MAX(va.date) AS last_attended_date
    FROM valid_attendance va
    GROUP BY va.customer_id, va.category_id
  ),
  recent_attendance AS (
    SELECT
      ca.customer_id,
      MAX(ca.last_attended_date) AS last_attended_date
    FROM category_attendance ca
    GROUP BY ca.customer_id
  ),
  last_attended_event AS (
    SELECT DISTINCT ON (va.customer_id)
      va.customer_id,
      va.event_name AS last_event_name
    FROM valid_attendance va
    ORDER BY va.customer_id, va.date DESC, va.event_name ASC
  ),
  -- Customers who have already been told about enough DISTINCT events recently.
  -- Counting events rather than messages means the intro and the day before nudge
  -- for the same event together consume one slot, not two.
  frequency_blocked AS (
    SELECT spc.customer_id
    FROM sms_promo_context spc
    WHERE spc.created_at > (NOW() - (p_frequency_window_days * INTERVAL '1 day'))
      AND spc.event_id IS DISTINCT FROM p_event_id
    GROUP BY spc.customer_id
    HAVING COUNT(DISTINCT spc.event_id) >= p_max_events_per_window
  ),
  category_pool AS (
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      ec.name::TEXT AS last_event_category,
      ca.times_attended,
      'category_match'::TEXT AS audience_type,
      ec.name::TEXT AS last_event_name,
      1 AS priority,
      ca.last_attended_date
    FROM category_attendance ca
    JOIN customers c ON c.id = ca.customer_id
    JOIN event_categories ec ON ec.id = ca.category_id
    WHERE ca.category_id = p_category_id
      AND ca.last_attended_date >= (CURRENT_DATE - (p_recency_days * INTERVAL '1 day'))
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.event_id = p_event_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM frequency_blocked fb WHERE fb.customer_id = c.id
      )
  ),
  general_pool AS (
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      NULL::TEXT AS last_event_category,
      NULL::BIGINT AS times_attended,
      'general_recent'::TEXT AS audience_type,
      lae.last_event_name,
      2 AS priority,
      ra.last_attended_date
    FROM recent_attendance ra
    JOIN customers c ON c.id = ra.customer_id
    LEFT JOIN last_attended_event lae ON lae.customer_id = c.id
    WHERE ra.last_attended_date >= (CURRENT_DATE - (p_general_recency_days * INTERVAL '1 day'))
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.event_id = p_event_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM frequency_blocked fb WHERE fb.customer_id = c.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM category_attendance ca2
        WHERE ca2.customer_id = c.id
          AND ca2.category_id = p_category_id
          AND ca2.last_attended_date >= (CURRENT_DATE - (p_recency_days * INTERVAL '1 day'))
      )
  ),
  combined AS (
    SELECT * FROM category_pool
    UNION ALL
    SELECT * FROM general_pool
  ),
  -- Deduplicate first, so the outer LIMIT can order by priority and recency.
  -- DISTINCT ON forces customer_id to lead the ORDER BY, which previously meant the
  -- cap sliced by UUID (effectively at random) rather than keeping recent guests.
  deduped AS (
    SELECT DISTINCT ON (combined.customer_id)
      combined.customer_id,
      combined.first_name,
      combined.last_name,
      combined.phone_number,
      combined.last_event_category,
      combined.times_attended,
      combined.audience_type,
      combined.last_event_name,
      combined.priority,
      combined.last_attended_date
    FROM combined
    ORDER BY combined.customer_id, combined.priority ASC, combined.last_attended_date DESC
  )
  SELECT
    d.customer_id,
    d.first_name,
    d.last_name,
    d.phone_number,
    d.last_event_category,
    d.times_attended,
    d.audience_type,
    d.last_event_name
  FROM deduped d
  ORDER BY d.priority ASC, d.last_attended_date DESC, d.customer_id ASC
  LIMIT p_max_recipients;
END;
$function$;

-- New public functions are granted EXECUTE to anon and authenticated by default.
-- This one reads customer contact details, so lock it to the service role that the
-- cron uses. REVOKE FROM PUBLIC alone would not be enough (see the workspace note
-- on Supabase function grants).
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer, integer) TO service_role;

COMMENT ON FUNCTION public.get_cross_promo_audience(uuid, uuid, integer, integer, integer, integer, integer) IS
  'Selects the SMS invite audience for an upcoming event. Cross pollinates across event categories using a six month attendance window, and limits how many distinct events a customer is told about per rolling window.';
