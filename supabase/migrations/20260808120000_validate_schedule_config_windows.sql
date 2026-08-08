-- Friday's schedule_config advertised a "lunch" service from 12:00 to 14:30, but
-- the pub does not open until 16:00 on a Friday and the kitchen runs 16:00-21:00.
-- The owner confirmed on 8 August 2026 that Friday food service starts at 16:00,
-- so the lunch slot is wrong. It reached Friday when the legacy per-day slot
-- configs were folded into schedule_config (see 20251123120000_squashed.sql).
--
-- Two changes:
--   1. Drop the Friday lunch entry, leaving Friday's dinner slot intact.
--   2. Add a trigger so a slot that falls outside its own day's trading hours
--      cannot be saved again. The data fix alone would drift back.

BEGIN;

-- 1. Data fix: remove the Friday lunch slot only -----------------------------

UPDATE public.business_hours
SET schedule_config = (
      SELECT COALESCE(jsonb_agg(slot ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(schedule_config) WITH ORDINALITY AS t(slot, ord)
      WHERE NOT (
        LOWER(TRIM(COALESCE(slot->>'name', ''))) = 'lunch'
        AND slot->>'starts_at' = '12:00'
        AND slot->>'ends_at' = '14:30'
      )
    ),
    updated_at = now()
WHERE day_of_week = 5
  AND jsonb_typeof(schedule_config) = 'array';

-- 2. Guard: reject slots outside the day's own trading hours -----------------
--
-- Rules, applied to business_hours and special_hours alike:
--   a. A closed day cannot carry any slots.
--   b. starts_at / ends_at must be HH:MM.
--   c. Every slot must sit inside the day's opens-closes window. This is the
--      universal rule: a slot outside it can never be honoured for any purpose.
--   d. Slots whose booking_type is food-only ('food', 'sunday_lunch') must also
--      sit inside the day's kitchen window. 'regular' is deliberately excluded:
--      it gates drinks bookings as well as food, so it may legitimately run past
--      the kitchen close.
--
-- Windows that wrap past midnight (closes <= opens) are carried into the next
-- day so late-night sessions still validate correctly.

CREATE OR REPLACE FUNCTION public.validate_schedule_config()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slot jsonb;
  v_index integer := 0;
  v_label text;
  v_slot_name text;
  v_type text;
  v_starts text;
  v_ends text;
  v_start_min integer;
  v_end_min integer;
  v_open_min integer;
  v_close_min integer;
  v_kitchen_open_min integer;
  v_kitchen_close_min integer;
BEGIN
  IF NEW.schedule_config IS NULL
     OR jsonb_typeof(NEW.schedule_config) <> 'array'
     OR jsonb_array_length(NEW.schedule_config) = 0 THEN
    RETURN NEW;
  END IF;

  -- to_jsonb keeps this usable from both tables: business_hours has
  -- day_of_week, special_hours has date.
  v_label := TG_TABLE_NAME || ' ' || COALESCE(
    'day_of_week=' || (to_jsonb(NEW) ->> 'day_of_week'),
    'date=' || (to_jsonb(NEW) ->> 'date'),
    '(unknown row)'
  );

  IF COALESCE(NEW.is_closed, false) THEN
    RAISE EXCEPTION
      'schedule_config on % must be empty because the day is marked closed', v_label
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.opens IS NULL OR NEW.closes IS NULL THEN
    RAISE EXCEPTION
      'schedule_config on % needs both opens and closes to be set', v_label
      USING ERRCODE = 'check_violation';
  END IF;

  v_open_min := (EXTRACT(HOUR FROM NEW.opens)::integer * 60)
                + EXTRACT(MINUTE FROM NEW.opens)::integer;
  v_close_min := (EXTRACT(HOUR FROM NEW.closes)::integer * 60)
                 + EXTRACT(MINUTE FROM NEW.closes)::integer;
  IF v_close_min <= v_open_min THEN
    v_close_min := v_close_min + 1440;
  END IF;

  IF NOT COALESCE(NEW.is_kitchen_closed, false)
     AND NEW.kitchen_opens IS NOT NULL
     AND NEW.kitchen_closes IS NOT NULL THEN
    v_kitchen_open_min := (EXTRACT(HOUR FROM NEW.kitchen_opens)::integer * 60)
                          + EXTRACT(MINUTE FROM NEW.kitchen_opens)::integer;
    v_kitchen_close_min := (EXTRACT(HOUR FROM NEW.kitchen_closes)::integer * 60)
                           + EXTRACT(MINUTE FROM NEW.kitchen_closes)::integer;
    IF v_kitchen_close_min <= v_kitchen_open_min THEN
      v_kitchen_close_min := v_kitchen_close_min + 1440;
    END IF;
  END IF;

  FOR v_slot IN SELECT value FROM jsonb_array_elements(NEW.schedule_config)
  LOOP
    v_index := v_index + 1;
    v_slot_name := COALESCE(NULLIF(TRIM(COALESCE(v_slot ->> 'name', '')), ''),
                            'slot ' || v_index::text);
    v_type := LOWER(TRIM(COALESCE(v_slot ->> 'booking_type', 'regular')));
    v_starts := COALESCE(v_slot ->> 'starts_at', '');
    v_ends := COALESCE(v_slot ->> 'ends_at', '');

    IF v_starts !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR v_ends !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION
        'schedule_config on %: "%" has starts_at "%" and ends_at "%"; both must be HH:MM',
        v_label, v_slot_name, v_starts, v_ends
        USING ERRCODE = 'check_violation';
    END IF;

    v_start_min := (SPLIT_PART(v_starts, ':', 1)::integer * 60)
                   + SPLIT_PART(v_starts, ':', 2)::integer;
    v_end_min := (SPLIT_PART(v_ends, ':', 1)::integer * 60)
                 + SPLIT_PART(v_ends, ':', 2)::integer;
    IF v_end_min <= v_start_min THEN
      v_end_min := v_end_min + 1440;
    END IF;

    -- On a day that trades past midnight, an early-clock slot belongs to the
    -- far end of the session rather than before opening.
    IF v_start_min < v_open_min AND v_close_min > 1440 THEN
      v_start_min := v_start_min + 1440;
      v_end_min := v_end_min + 1440;
    END IF;

    IF v_start_min < v_open_min OR v_end_min > v_close_min THEN
      RAISE EXCEPTION
        'schedule_config on %: "%" runs %-% but the venue is only open %-%',
        v_label, v_slot_name, v_starts, v_ends,
        TO_CHAR(NEW.opens, 'HH24:MI'), TO_CHAR(NEW.closes, 'HH24:MI')
        USING ERRCODE = 'check_violation',
              HINT = 'Move the slot inside opening hours, or change the opening hours.';
    END IF;

    IF v_type IN ('food', 'sunday_lunch') THEN
      IF COALESCE(NEW.is_kitchen_closed, false) THEN
        RAISE EXCEPTION
          'schedule_config on %: "%" is a % slot but the kitchen is marked closed',
          v_label, v_slot_name, v_type
          USING ERRCODE = 'check_violation';
      END IF;

      IF v_kitchen_open_min IS NULL OR v_kitchen_close_min IS NULL THEN
        RAISE EXCEPTION
          'schedule_config on %: "%" is a % slot but kitchen hours are not set',
          v_label, v_slot_name, v_type
          USING ERRCODE = 'check_violation';
      END IF;

      IF v_start_min < v_kitchen_open_min OR v_end_min > v_kitchen_close_min THEN
        RAISE EXCEPTION
          'schedule_config on %: "%" runs %-% but the kitchen is only open %-%',
          v_label, v_slot_name, v_starts, v_ends,
          TO_CHAR(NEW.kitchen_opens, 'HH24:MI'), TO_CHAR(NEW.kitchen_closes, 'HH24:MI')
          USING ERRCODE = 'check_violation',
                HINT = 'Move the slot inside kitchen hours, or change the kitchen hours.';
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_schedule_config() IS
  'Rejects business_hours/special_hours schedule_config slots that fall outside '
  'the day''s own opening hours, or outside kitchen hours for food and '
  'sunday_lunch slots. Added 8 August 2026 after a Friday lunch slot (12:00-14:30) '
  'was published on a day that does not open until 16:00.';

DROP TRIGGER IF EXISTS validate_schedule_config_trigger ON public.business_hours;
CREATE TRIGGER validate_schedule_config_trigger
  BEFORE INSERT OR UPDATE ON public.business_hours
  FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_config();

DROP TRIGGER IF EXISTS validate_schedule_config_trigger ON public.special_hours;
CREATE TRIGGER validate_schedule_config_trigger
  BEFORE INSERT OR UPDATE ON public.special_hours
  FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_config();

COMMIT;
