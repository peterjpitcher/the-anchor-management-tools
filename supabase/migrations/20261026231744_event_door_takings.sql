-- A pay-on-arrival night's door money, kept as one till total per event (BK-118, customer bookings
-- review of 24 October 2026; owner decision D13).
--
-- Bookings for pay-on-arrival nights (quiz, bingo and similar) are confirmed when made, and nothing
-- records what the door took: the event page's 'Paid' figure is always 0 for them. The owner chose
-- a till total over a payment per guest, because it adds no work at the door. After the night,
-- staff enter what the till took for the event, how many guests were let in free and why. The page
-- sets that against the seats that came at the ticket price.
--
-- The money itself is already in the till and so in the cash-up and the P&L. This row explains it;
-- it is never added to sales, which would count it twice.
--
-- One row per event. Only the server reads or writes it, through the service role after the app's
-- events 'manage' check, so anon and authenticated hold nothing and there is no policy.
--
-- Deploy: apply before the code that reads it (the event page loads it once the night has
-- started). Rollback: tasks/event-door-takings/rollback.sql (drops the table and anything recorded
-- in it). Tested by scripts/testing/event-door-takings-postgres.py.

CREATE TABLE public.event_door_takings (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  till_total numeric(10,2) NOT NULL CHECK (till_total >= 0),
  free_entries integer NOT NULL DEFAULT 0 CHECK (free_entries >= 0 AND free_entries <= 1000),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- A free entry needs a reason, so a comp can be explained later (BK-217).
  CONSTRAINT event_door_takings_free_entries_need_reason
    CHECK (free_entries = 0 OR length(btrim(coalesce(note, ''))) > 0)
);

COMMENT ON TABLE public.event_door_takings IS
  'Door money for a pay-on-arrival event, kept as one till total (BK-118, D13). Already in the till and cash-up: never add it to sales.';

ALTER TABLE public.event_door_takings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_door_takings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_door_takings TO service_role;

-- Prove it, so a later migration cannot quietly open the table.
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.event_door_takings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.event_door_takings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.event_door_takings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.event_door_takings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.event_door_takings', 'DELETE') THEN
    RAISE EXCEPTION 'event_door_takings is reachable by anon or authenticated';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.event_door_takings', 'INSERT') THEN
    RAISE EXCEPTION 'event_door_takings is not writable by service_role';
  END IF;
END $$;
