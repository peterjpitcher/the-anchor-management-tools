-- Disable promotional SMS for all World Cup 2026 match events.
-- This must run after 20260615000000_add_event_promo_sms_and_bookings_enabled.sql.

BEGIN;

UPDATE public.events
SET promo_sms_enabled = false
WHERE promo_sms_enabled IS DISTINCT FROM false
  AND (
    slug LIKE 'world-cup-2026-%'
    OR lower(name) LIKE 'world cup 2026:%'
    OR lower(name) LIKE '%fifa world cup 2026%'
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_world_cup_2026_promo_sms_disabled'
      AND conrelid = 'public.events'::regclass
  ) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_world_cup_2026_promo_sms_disabled
      CHECK (
        promo_sms_enabled = false
        OR NOT (
          slug LIKE 'world-cup-2026-%'
          OR lower(name) LIKE 'world cup 2026:%'
          OR lower(name) LIKE '%fifa world cup 2026%'
        )
      );
  END IF;
END $$;

WITH world_cup_events AS (
  SELECT id::text AS id
  FROM public.events
  WHERE slug LIKE 'world-cup-2026-%'
    OR lower(name) LIKE 'world cup 2026:%'
    OR lower(name) LIKE '%fifa world cup 2026%'
)
UPDATE public.jobs
SET
  status = 'cancelled',
  error_message = 'Cancelled because promotional SMS is disabled for World Cup 2026 matches',
  processing_token = NULL,
  lease_expires_at = NULL,
  last_heartbeat_at = NULL,
  updated_at = NOW()
WHERE status IN ('pending', 'processing')
  AND type IN ('send_sms', 'send_bulk_sms')
  AND (
    payload->>'eventId' IN (SELECT id FROM world_cup_events)
    OR payload->>'event_id' IN (SELECT id FROM world_cup_events)
    OR payload->'metadata'->>'event_id' IN (SELECT id FROM world_cup_events)
  )
  AND (
    type = 'send_bulk_sms'
    OR payload->'metadata'->>'marketing' = 'true'
    OR payload->'metadata'->>'bulk_sms' = 'true'
    OR payload->'metadata'->>'template_key' = 'bulk_sms_campaign'
    OR payload->'metadata'->>'template_key' LIKE 'event_cross_promo_%'
    OR payload->'metadata'->>'template_key' LIKE 'event_general_promo_%'
    OR payload->'metadata'->>'template_key' LIKE 'event_reminder_promo_%'
  );

WITH world_cup_events AS (
  SELECT id::text AS id
  FROM public.events
  WHERE slug LIKE 'world-cup-2026-%'
    OR lower(name) LIKE 'world cup 2026:%'
    OR lower(name) LIKE '%fifa world cup 2026%'
)
UPDATE public.background_jobs
SET
  status = 'failed',
  error = 'Cancelled because promotional SMS is disabled for World Cup 2026 matches',
  processed_at = COALESCE(processed_at, NOW())
WHERE status IN ('pending', 'processing')
  AND type IN ('send_sms', 'send_bulk_sms')
  AND (
    payload->>'eventId' IN (SELECT id FROM world_cup_events)
    OR payload->>'event_id' IN (SELECT id FROM world_cup_events)
    OR payload->'metadata'->>'event_id' IN (SELECT id FROM world_cup_events)
  )
  AND (
    type = 'send_bulk_sms'
    OR payload->'metadata'->>'marketing' = 'true'
    OR payload->'metadata'->>'bulk_sms' = 'true'
    OR payload->'metadata'->>'template_key' = 'bulk_sms_campaign'
    OR payload->'metadata'->>'template_key' LIKE 'event_cross_promo_%'
    OR payload->'metadata'->>'template_key' LIKE 'event_general_promo_%'
    OR payload->'metadata'->>'template_key' LIKE 'event_reminder_promo_%'
  );

WITH world_cup_events AS (
  SELECT id::text AS id
  FROM public.events
  WHERE slug LIKE 'world-cup-2026-%'
    OR lower(name) LIKE 'world cup 2026:%'
    OR lower(name) LIKE '%fifa world cup 2026%'
)
UPDATE public.job_queue
SET
  status = 'failed',
  error = 'Cancelled because promotional SMS is disabled for World Cup 2026 matches',
  completed_at = COALESCE(completed_at, NOW())
WHERE status IN ('pending', 'processing')
  AND type IN ('send_sms', 'send_bulk_sms')
  AND (
    payload->>'eventId' IN (SELECT id FROM world_cup_events)
    OR payload->>'event_id' IN (SELECT id FROM world_cup_events)
    OR payload->'metadata'->>'event_id' IN (SELECT id FROM world_cup_events)
  )
  AND (
    type = 'send_bulk_sms'
    OR payload->'metadata'->>'marketing' = 'true'
    OR payload->'metadata'->>'bulk_sms' = 'true'
    OR payload->'metadata'->>'template_key' = 'bulk_sms_campaign'
    OR payload->'metadata'->>'template_key' LIKE 'event_cross_promo_%'
    OR payload->'metadata'->>'template_key' LIKE 'event_general_promo_%'
    OR payload->'metadata'->>'template_key' LIKE 'event_reminder_promo_%'
  );

COMMIT;
