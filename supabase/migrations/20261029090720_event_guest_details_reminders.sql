-- Event guest details chase ledger (BK-132, customer bookings review of 24 October 2026; owner
-- decision D5: remind the booker 3 days before, and give the manager a list the day before).
--
-- A paid event booking taken by phone, at the bar or by text can be saved with guest details "to
-- follow" (release 14). Nothing asked again, so the gaps were found at the door. The daily cron
-- /api/cron/event-guest-details-reminders now chases them, and this table is its ledger:
--
--   * one 'booker_reminder' row per booking, ever, claimed BEFORE the message is sent, so two runs
--     racing, or one run twice, lose at the unique index and send nothing;
--   * one 'manager_list' row per event, ever, for the day-before email to the manager.
--
-- A claimed row is never rolled back when a send fails: a send whose outcome is unknown may have
-- reached the guest, and a second message is worse than a phone call from the pub.
--
-- Data: a new, empty table. No existing table, function or row is changed.
--
-- GRANTS. Since 20260828120356 a new table in public no longer inherits anon access, and this one
-- must never have it: it is written by the cron with the service role only. RLS is on with a
-- service_role policy, anon and authenticated are revoked by name, and the migration ends with an
-- assertion that fails rather than reporting success on a half-closed door.

BEGIN;

CREATE TABLE IF NOT EXISTS public.event_guest_details_reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('booker_reminder', 'manager_list')),
  event_id         uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  -- Counts, ids and outcomes only: never a name, a number, an answer or a link.
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT event_guest_details_reminders_booking_shape CHECK (
    (kind = 'booker_reminder' AND event_booking_id IS NOT NULL)
    OR (kind = 'manager_list' AND event_booking_id IS NULL)
  )
);

COMMENT ON TABLE public.event_guest_details_reminders IS
  'Chase ledger for missing event guest details (BK-132). One booker reminder per booking and one manager list per event, ever. Claim the row before sending; the unique indexes are the idempotency.';

-- The cron claims with a plain INSERT and reads a unique violation (23505) as "already done". It
-- never upserts, so the partial index for the manager rows is safe here (an ON CONFLICT upsert
-- cannot name a partial index through PostgREST). A NULL booking id never collides, so the manager
-- rows rely on the second index alone.
CREATE UNIQUE INDEX IF NOT EXISTS event_guest_details_reminders_booking_kind_key
  ON public.event_guest_details_reminders (event_booking_id, kind);
CREATE UNIQUE INDEX IF NOT EXISTS event_guest_details_reminders_manager_event_key
  ON public.event_guest_details_reminders (event_id)
  WHERE kind = 'manager_list';
CREATE INDEX IF NOT EXISTS event_guest_details_reminders_event_idx
  ON public.event_guest_details_reminders (event_id);

ALTER TABLE public.event_guest_details_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS event_guest_details_reminders_service_role_all ON public.event_guest_details_reminders;
CREATE POLICY event_guest_details_reminders_service_role_all ON public.event_guest_details_reminders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.event_guest_details_reminders FROM PUBLIC;
REVOKE ALL ON TABLE public.event_guest_details_reminders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.event_guest_details_reminders TO service_role;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.event_guest_details_reminders', 'SELECT')
     OR has_table_privilege('anon', 'public.event_guest_details_reminders', 'INSERT')
     OR has_table_privilege('authenticated', 'public.event_guest_details_reminders', 'SELECT')
     OR has_table_privilege('authenticated', 'public.event_guest_details_reminders', 'INSERT') THEN
    RAISE EXCEPTION 'event_guest_details_reminders is reachable by anon or authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.event_guest_details_reminders', 'INSERT') THEN
    RAISE EXCEPTION 'event_guest_details_reminders is not writable by service_role';
  END IF;
END $$;

COMMIT;
