-- Makes the resend_message_id unique index inferable by ON CONFLICT.
--
-- URGENT FIX. `recordEmailMessage` was changed to upsert on `resend_message_id` so a send the
-- provider had deduplicated would map back onto one log row instead of claiming a second
-- delivery. The index it targets is PARTIAL (`WHERE resend_message_id IS NOT NULL`), and
-- Postgres cannot infer a partial index from `ON CONFLICT (resend_message_id)` unless the
-- statement repeats the index predicate, which PostgREST has no way to emit. Every upsert
-- therefore raised:
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
--
-- `recordEmailMessage` swallows that and returns null, so the email still went out but was
-- never logged. That affected EVERY email on the Resend path, not just marketing: booking
-- confirmations, event tickets and the rest were all sending unlogged.
--
-- A plain unique index fixes the inference. NULLs are distinct in a unique index by default,
-- so the rows with no provider id (173 at the time of writing) behave exactly as before; the
-- index simply also covers them. The existing partial index already guarantees uniqueness
-- across every non-null value, so this cannot fail on duplicate data.

BEGIN;

-- Created before the old one is dropped so uniqueness is never unenforced, even briefly.
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_resend_message_id_unique
  ON public.email_messages (resend_message_id);

DROP INDEX IF EXISTS public.email_messages_resend_message_id_key;

COMMENT ON INDEX public.email_messages_resend_message_id_unique IS
  'Deliberately NOT partial: ON CONFLICT (resend_message_id) cannot infer a partial index, and '
  'the email log upsert depends on that inference. NULLs remain distinct, so unsent-provider '
  'rows are unaffected.';

COMMIT;
