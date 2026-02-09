-- v0.5 add dedicated action type for Sunday pre-order guest tokens

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
        'private_feedback'
      )
    );
END $$;
