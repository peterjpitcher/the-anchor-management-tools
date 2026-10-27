-- BK-088 (customer bookings review of 24 October 2026; owner decision D16): one reminder before an
-- unpaid table deposit hold runs out.
--
-- A party of 15 or more, and every Christmas booking, gets one deposit request when it is made.
-- Nothing reminded them before the hold ended (24 hours, or the booking start if sooner), and then
-- the booking was cancelled. api/cron/table-booking-deposit-timeout now sends one reminder about
-- six hours before the hold ends, behind the messaging flag table_deposit_hold_reminder, which is
-- off until the owner has read the wording.
--
-- The ledger IS the idempotency, as table_booking_confirm_reminders is for the day-before
-- reminder: the row is claimed BEFORE anything is sent, so two runs racing, or one running twice,
-- both lose at the primary key and send nothing. A claimed row is never removed on a failed send,
-- because deleting it to retry turns an ambiguous failure (email delivered, log write did not) into
-- a second message to the guest.
--
-- Keyed on the booking AND the hold it reminds about: a booking whose deposit is asked for again
-- (a party grown past the threshold after an earlier hold) has a new hold, and may be reminded
-- about that one once.
--
-- service_role only, like the other booking ledgers: only the cron writes it, and nothing a
-- browser or a signed-in account holds may read or write it. A new table in public otherwise
-- inherits full access for authenticated from the default privileges.
--
-- Rollback: tasks/table-booking-deposit-reminders/rollback.sql (drops the table).

CREATE TABLE public.table_booking_deposit_reminders (
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  hold_expires_at  timestamptz NOT NULL,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_booking_deposit_reminders_pkey PRIMARY KEY (table_booking_id, hold_expires_at)
);

COMMENT ON TABLE public.table_booking_deposit_reminders IS
  'One row per deposit hold reminded about (BK-088). Claimed before the reminder is sent, never removed on a failed send.';

ALTER TABLE public.table_booking_deposit_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.table_booking_deposit_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.table_booking_deposit_reminders TO service_role;
