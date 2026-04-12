-- Trigger: Auto-sync start_datetime when date or time changes on events table.
--
-- Root cause: The admin event edit form submits date and time separately,
-- but the update RPC only sets start_datetime if it's explicitly in the payload.
-- This caused date drift where start_datetime showed a stale date in SMS
-- confirmations (e.g., "Wed 22 Apr" instead of "Fri 24 Apr").
--
-- This trigger treats date+time as the source of truth and recomputes
-- start_datetime on every INSERT or UPDATE that touches date or time.

CREATE OR REPLACE FUNCTION public.sync_event_start_datetime()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only recompute if date or time changed (or on INSERT)
  IF TG_OP = 'INSERT'
     OR NEW.date IS DISTINCT FROM OLD.date
     OR NEW.time IS DISTINCT FROM OLD.time
  THEN
    -- Compute start_datetime from date + time, interpreting as London local time
    -- This matches the booking RPC's COALESCE logic:
    --   (date::text || ' ' || time)::timestamp AT TIME ZONE 'Europe/London'
    IF NEW.date IS NOT NULL AND NEW.time IS NOT NULL THEN
      NEW.start_datetime := (NEW.date::text || ' ' || NEW.time)::timestamp
                            AT TIME ZONE 'Europe/London';
    ELSIF NEW.date IS NOT NULL THEN
      -- date only, no time — set to midnight London
      NEW.start_datetime := (NEW.date::text || ' 00:00')::timestamp
                            AT TIME ZONE 'Europe/London';
    END IF;
    -- If date is NULL, leave start_datetime as-is (or NULL)
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists to make migration re-runnable
DROP TRIGGER IF EXISTS trg_sync_event_start_datetime ON public.events;

CREATE TRIGGER trg_sync_event_start_datetime
  BEFORE INSERT OR UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_event_start_datetime();

-- Also fix any existing mismatches (one-time backfill)
UPDATE public.events
SET start_datetime = (date::text || ' ' || time)::timestamp AT TIME ZONE 'Europe/London'
WHERE date IS NOT NULL
  AND time IS NOT NULL
  AND start_datetime IS DISTINCT FROM
      ((date::text || ' ' || time)::timestamp AT TIME ZONE 'Europe/London');
