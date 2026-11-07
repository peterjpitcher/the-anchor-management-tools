-- One-tap rebook link after a website event hold lapses unpaid (event checkout spec, Piece 4.2,
-- owner approval 7 November 2026).
--
-- The "held places released" email used to link to the event page, and the guest started again
-- from an empty form. It now carries a single-purpose link token instead: the website swaps it,
-- server side and with its API key, for the details the guest typed last time
-- (GET /api/external/event-bookings/rebook/<token>) and fills the form in. Places are not held.
--
-- The token lives in guest_tokens, beside every other guest link, as action_type 'event_rebook':
--  - only a SHA-256 hash of the token is stored, as for every guest link (src/lib/guest/tokens.ts);
--  - event_booking_id names the expired booking it was issued for, and must be set;
--  - guest_tokens_event_rebook_once allows one rebook token per booking. The token is written
--    BEFORE the email is sent and never deleted, so it is also the claim that stops a second
--    recovery email for the same booking (src/lib/events/rebook-link.ts);
--  - consumed_at stays NULL: the link may be read again (a reload) until the guest has booked again
--    or it expires, which the API works out from the live bookings.
--
-- Every reader of guest_tokens filters on action_type or on its own hash (checked on
-- 7 November 2026: twelve SQL functions and every src/ reader), so a new action type is seen by
-- nothing else.
--
-- Access: guest_tokens already has RLS on, no policies and no anon or authenticated privileges;
-- only the service role reads it. This migration creates no table, view or function and grants
-- nothing. The check below refuses to run if that has changed, so a later grant is never carried
-- forward silently.
--
-- Live data this changes: none. No row is written, updated or deleted.
--
-- Rollback (once no event_rebook row exists, or after deleting them):
--   DROP INDEX IF EXISTS public.guest_tokens_event_rebook_once;
--   ALTER TABLE public.guest_tokens DROP CONSTRAINT IF EXISTS guest_tokens_event_rebook_scope_check;
--   ALTER TABLE public.guest_tokens DROP CONSTRAINT guest_tokens_action_type_check;
--   ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_action_type_check CHECK (action_type = ANY (ARRAY[
--     'manage', 'sunday_preorder', 'card_capture', 'payment', 'review_redirect', 'charge_approval',
--     'waitlist_offer', 'private_feedback', 'private_booking_outcome', 'booking_confirm',
--     'email_capture', 'preorder_guest']));
--
-- Tested by scripts/testing/event-rebook-link-token-postgres.py.

DO $guard$
DECLARE
  v_check text;
  v_role text;
BEGIN
  IF to_regclass('public.guest_tokens') IS NULL THEN
    RAISE EXCEPTION 'event_rebook_link_token: public.guest_tokens is missing';
  END IF;

  SELECT pg_get_constraintdef(c.oid)
  INTO v_check
  FROM pg_constraint c
  WHERE c.conrelid = 'public.guest_tokens'::regclass
    AND c.conname = 'guest_tokens_action_type_check';

  IF v_check IS NULL THEN
    RAISE EXCEPTION 'event_rebook_link_token: guest_tokens_action_type_check is missing';
  END IF;

  -- Production's list on 7 November 2026, or this migration's own (a second run). Anything else
  -- means the list has moved on, and replacing it would drop an action type someone added.
  IF v_check NOT IN (
    'CHECK ((action_type = ANY (ARRAY[''manage''::text, ''sunday_preorder''::text, ''card_capture''::text, ''payment''::text, ''review_redirect''::text, ''charge_approval''::text, ''waitlist_offer''::text, ''private_feedback''::text, ''private_booking_outcome''::text, ''booking_confirm''::text, ''email_capture''::text, ''preorder_guest''::text])))',
    'CHECK ((action_type = ANY (ARRAY[''manage''::text, ''sunday_preorder''::text, ''card_capture''::text, ''payment''::text, ''review_redirect''::text, ''charge_approval''::text, ''waitlist_offer''::text, ''private_feedback''::text, ''private_booking_outcome''::text, ''booking_confirm''::text, ''email_capture''::text, ''preorder_guest''::text, ''event_rebook''::text])))'
  ) THEN
    RAISE EXCEPTION 'event_rebook_link_token: guest_tokens_action_type_check has moved on (%); rebuild this migration from the live definition', v_check;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.guest_tokens'::regclass) THEN
    RAISE EXCEPTION 'event_rebook_link_token: RLS is off on public.guest_tokens';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role)
      AND has_table_privilege(v_role, 'public.guest_tokens', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    THEN
      RAISE EXCEPTION 'event_rebook_link_token: % holds a privilege on public.guest_tokens', v_role;
    END IF;
  END LOOP;
END
$guard$;

ALTER TABLE public.guest_tokens DROP CONSTRAINT guest_tokens_action_type_check;
ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_action_type_check CHECK (action_type = ANY (ARRAY[
  'manage'::text, 'sunday_preorder'::text, 'card_capture'::text, 'payment'::text, 'review_redirect'::text,
  'charge_approval'::text, 'waitlist_offer'::text, 'private_feedback'::text, 'private_booking_outcome'::text,
  'booking_confirm'::text, 'email_capture'::text, 'preorder_guest'::text, 'event_rebook'::text]));

-- A rebook token always names its booking. action_type is NOT NULL, so this never passes on NULL.
ALTER TABLE public.guest_tokens DROP CONSTRAINT IF EXISTS guest_tokens_event_rebook_scope_check;
ALTER TABLE public.guest_tokens ADD CONSTRAINT guest_tokens_event_rebook_scope_check
  CHECK (action_type <> 'event_rebook' OR event_booking_id IS NOT NULL);

-- One rebook token, and so one recovery email, per booking.
CREATE UNIQUE INDEX IF NOT EXISTS guest_tokens_event_rebook_once
  ON public.guest_tokens (event_booking_id)
  WHERE action_type = 'event_rebook';
