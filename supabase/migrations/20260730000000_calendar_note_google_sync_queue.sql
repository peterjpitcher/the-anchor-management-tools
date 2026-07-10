-- Durable Pub Ops Google Calendar sync queue for calendar notes.
--
-- The trigger keeps queue creation in the same transaction as the note write,
-- including hard deletes. A generation counter prevents a completed sync from
-- clearing a newer update which arrived while Google was being called.

CREATE TABLE IF NOT EXISTS public.calendar_note_google_sync_queue (
  note_id uuid PRIMARY KEY,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced')),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  available_at timestamptz NOT NULL DEFAULT now(),
  processing_token uuid,
  lease_expires_at timestamptz,
  replay_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_note_google_sync_queue_available
  ON public.calendar_note_google_sync_queue (available_at, updated_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_calendar_note_google_sync_queue_reconciliation
  ON public.calendar_note_google_sync_queue (updated_at, note_id)
  WHERE status = 'synced' AND operation = 'upsert';

ALTER TABLE public.calendar_note_google_sync_queue ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.calendar_note_google_sync_queue FROM anon, authenticated;
GRANT ALL ON TABLE public.calendar_note_google_sync_queue TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_calendar_note_google_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_note_id uuid;
  target_operation text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_note_id := OLD.id;
    target_operation := 'delete';
  ELSE
    target_note_id := NEW.id;
    target_operation := 'upsert';
  END IF;

  INSERT INTO public.calendar_note_google_sync_queue AS queue (
    note_id,
    operation,
    status,
    generation,
    attempts,
    last_error,
    available_at,
    updated_at
  )
  VALUES (
    target_note_id,
    target_operation,
    'pending',
    1,
    0,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (note_id) DO UPDATE
  SET operation = EXCLUDED.operation,
      status = 'pending',
      generation = queue.generation + 1,
      attempts = 0,
      last_error = NULL,
      available_at = now(),
      replay_requested = false,
      updated_at = now();

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_calendar_note_google_sync() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.claim_calendar_note_google_sync(
  p_note_id uuid,
  p_expected_generation bigint DEFAULT NULL,
  p_lease_seconds integer DEFAULT 600
)
RETURNS TABLE (
  note_id uuid,
  operation text,
  generation bigint,
  attempts integer,
  processing_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claim_token uuid := gen_random_uuid();
  lease_seconds integer := GREATEST(COALESCE(p_lease_seconds, 600), 60);
BEGIN
  RETURN QUERY
  UPDATE public.calendar_note_google_sync_queue AS queue
  SET processing_token = claim_token,
      lease_expires_at = now() + make_interval(secs => lease_seconds),
      updated_at = now()
  WHERE queue.note_id = p_note_id
    AND queue.status = 'pending'
    AND queue.available_at <= now()
    AND (p_expected_generation IS NULL OR queue.generation = p_expected_generation)
    AND (
      queue.processing_token IS NULL OR
      queue.lease_expires_at IS NULL OR
      queue.lease_expires_at <= now()
    )
  RETURNING
    queue.note_id,
    queue.operation,
    queue.generation,
    queue.attempts,
    queue.processing_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_calendar_note_google_sync(uuid, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_calendar_note_google_sync(uuid, bigint, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_calendar_note_google_sync(
  p_note_id uuid,
  p_processing_token uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_generation bigint;
BEGIN
  UPDATE public.calendar_note_google_sync_queue AS queue
  SET status = CASE
        WHEN queue.processing_token IS NOT NULL
          AND queue.processing_token IS DISTINCT FROM p_processing_token
          AND queue.lease_expires_at IS NOT NULL
          AND queue.lease_expires_at > now()
        THEN queue.status
        ELSE 'pending'
      END,
      generation = CASE
        WHEN queue.processing_token IS NOT NULL
          AND queue.processing_token IS DISTINCT FROM p_processing_token
          AND queue.lease_expires_at IS NOT NULL
          AND queue.lease_expires_at > now()
        THEN queue.generation
        ELSE queue.generation + 1
      END,
      attempts = CASE
        WHEN queue.processing_token IS NOT NULL
          AND queue.processing_token IS DISTINCT FROM p_processing_token
          AND queue.lease_expires_at IS NOT NULL
          AND queue.lease_expires_at > now()
        THEN queue.attempts
        ELSE 0
      END,
      last_error = CASE
        WHEN queue.processing_token IS NOT NULL
          AND queue.processing_token IS DISTINCT FROM p_processing_token
          AND queue.lease_expires_at IS NOT NULL
          AND queue.lease_expires_at > now()
        THEN queue.last_error
        ELSE NULL
      END,
      available_at = CASE
        WHEN queue.processing_token IS NOT NULL
          AND queue.processing_token IS DISTINCT FROM p_processing_token
          AND queue.lease_expires_at IS NOT NULL
          AND queue.lease_expires_at > now()
        THEN queue.available_at
        ELSE now()
      END,
      replay_requested = CASE
        WHEN queue.processing_token IS NOT NULL
          AND queue.processing_token IS DISTINCT FROM p_processing_token
          AND queue.lease_expires_at IS NOT NULL
          AND queue.lease_expires_at > now()
        THEN true
        ELSE false
      END,
      updated_at = now()
  WHERE queue.note_id = p_note_id
  RETURNING CASE
    WHEN queue.replay_requested THEN NULL
    ELSE queue.generation
  END INTO next_generation;

  RETURN next_generation;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_calendar_note_google_sync(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_calendar_note_google_sync(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.requeue_stale_calendar_note_google_sync(
  p_today date,
  p_synced_before timestamptz,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  note_id uuid,
  operation text,
  generation bigint,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reconciliation_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 25);
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT queue.note_id
    FROM public.calendar_note_google_sync_queue AS queue
    INNER JOIN public.calendar_notes AS notes ON notes.id = queue.note_id
    WHERE queue.status = 'synced'
      AND queue.operation = 'upsert'
      AND COALESCE(notes.end_date, notes.note_date) >= p_today
      AND queue.updated_at <= p_synced_before
    ORDER BY queue.updated_at ASC, queue.note_id ASC
    LIMIT reconciliation_limit
    FOR UPDATE OF queue SKIP LOCKED
  )
  UPDATE public.calendar_note_google_sync_queue AS queue
  SET status = 'pending',
      generation = queue.generation + 1,
      attempts = 0,
      last_error = NULL,
      available_at = now(),
      processing_token = NULL,
      lease_expires_at = NULL,
      replay_requested = false,
      updated_at = now()
  FROM candidates
  WHERE queue.note_id = candidates.note_id
  RETURNING
    queue.note_id,
    queue.operation,
    queue.generation,
    queue.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.requeue_stale_calendar_note_google_sync(date, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.requeue_stale_calendar_note_google_sync(date, timestamptz, integer) TO service_role;

DROP TRIGGER IF EXISTS queue_calendar_note_google_sync ON public.calendar_notes;
CREATE TRIGGER queue_calendar_note_google_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.calendar_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.enqueue_calendar_note_google_sync();

-- Backfill every existing note, including historical entries. Completed rows
-- remain as compact sync markers so generation numbers never reset.
INSERT INTO public.calendar_note_google_sync_queue (note_id, operation)
SELECT id, 'upsert'
FROM public.calendar_notes
ON CONFLICT (note_id) DO NOTHING;
