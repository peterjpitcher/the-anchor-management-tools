-- 2026-04-28 — Sunday service window: 12:00–17:00 → 13:00–18:00
--
-- Spec: docs/superpowers/specs/2026-04-28-sunday-walk-in-launch-and-wizard-overhaul-design.md §6, §8.3
-- Plan: docs/superpowers/plans/2026-04-28-sunday-walk-in-launch.md Task 4.4
--
-- Context: the Sunday-walk-in launch moves the kitchen window from 12:00–17:00
-- to 13:00–18:00 to align with new service patterns. Last bookable arrival is
-- 17:30 so the kitchen has 30 min to plate (slot logic enforces this — separate
-- from the kitchen window stored here).
--
-- Why this lives in scripts/one-off/ (not supabase/migrations/):
-- Wave 2 of the rollout is local-only. Peter applies this update during the
-- staged deploy window. Once executed, capture the UPDATE inside a tracked
-- migration so a fresh `npx supabase db push` reproduces the change.
--
-- POST-DEPLOY VERIFICATION (Spec §8.3 Task 4.5):
-- SELECT day_of_week, kitchen_opens, kitchen_closes, schedule_config
-- FROM public.business_hours WHERE day_of_week = 0;
-- Expected: kitchen_opens=13:00:00, kitchen_closes=18:00:00, schedule_config
--           contains a single Sunday entry with starts_at=13:00:00 and
--           ends_at=18:00:00.
--
-- If this needs to be rolled back: re-run with the legacy values
-- (kitchen_opens=12:00:00, kitchen_closes=17:00:00, schedule_config window
-- 12:00:00–17:00:00).

BEGIN;

UPDATE public.business_hours
SET
  -- Generic kitchen window. New public bookings use booking_type='regular' for
  -- both food and drinks; the legacy 'sunday_lunch' booking_type is reserved
  -- for back-fill of historical records only.
  schedule_config = '[
    {
      "starts_at": "13:00:00",
      "ends_at": "18:00:00",
      "capacity": 50,
      "booking_type": "food",
      "slot_type": "sunday_food"
    }
  ]'::jsonb,
  kitchen_opens = '13:00:00',
  kitchen_closes = '18:00:00'
WHERE
  day_of_week = 0;

-- Sanity: confirm exactly one row was updated. If 0, the table layout has
-- diverged from spec assumptions and the deployer should investigate before
-- committing.
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.business_hours
  WHERE day_of_week = 0;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 Sunday business_hours row, found %', v_count;
  END IF;
END;
$$;

COMMIT;
