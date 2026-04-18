-- supabase/migrations/20260418120100_pb_outcome_token_action.sql
--
-- Phase 1, Task 1.2 — Private Bookings SMS Redesign
-- Extends the guest_tokens.action_type CHECK constraint to include the new
-- 'private_booking_outcome' action, which is used by the manager outcome
-- email link (Phase 4, Pass 5a) to let the manager decide went_well / issues
-- without logging in.
--
-- IMPORTANT: the column is named `action_type` (not `action`) and the
-- existing constraint is `guest_tokens_action_type_check`, established by
-- 20260420000016_guest_token_sunday_preorder_action.sql. All existing action
-- values are preserved; this migration only ADDS 'private_booking_outcome'.
--
-- Authoritative list (from 20260420000016):
--   manage, sunday_preorder, card_capture, payment, review_redirect,
--   charge_approval, waitlist_offer, private_feedback
-- Card_capture is intentionally retained even though the feature was retired
-- (see 20260508000007) because 2 live rows still exist; dropping it would
-- violate the constraint.
BEGIN;

-- Defensive drop: match any constraint on action_type regardless of exact
-- name so this migration is resilient to historical naming drift.
DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'guest_tokens'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%action_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.guest_tokens DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;

  ALTER TABLE public.guest_tokens
    ADD CONSTRAINT guest_tokens_action_type_check
    CHECK (
      action_type IN (
        'manage',
        'sunday_preorder',
        'card_capture',
        'payment',
        'review_redirect',
        'charge_approval',
        'waitlist_offer',
        'private_feedback',
        'private_booking_outcome'  -- NEW: manager outcome decision link
      )
    );
END $$;

COMMIT;
