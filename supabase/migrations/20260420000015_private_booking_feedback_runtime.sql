-- v0.5 private-booking feedback token support

ALTER TABLE public.guest_tokens
  ADD COLUMN IF NOT EXISTS private_booking_id uuid REFERENCES public.private_bookings(id) ON DELETE CASCADE;

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

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guest_tokens_action_type_check'
  ) THEN
    ALTER TABLE public.guest_tokens
      ADD CONSTRAINT guest_tokens_action_type_check
      CHECK (
        action_type IN (
          'manage',
          'card_capture',
          'payment',
          'review_redirect',
          'charge_approval',
          'waitlist_offer',
          'private_feedback'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_guest_tokens_private_booking
  ON public.guest_tokens (private_booking_id)
  WHERE private_booking_id IS NOT NULL;
