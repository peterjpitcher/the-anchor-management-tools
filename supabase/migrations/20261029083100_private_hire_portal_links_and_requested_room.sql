-- Private hire booking links and website enquiry choices (release 26 of the customer bookings review
-- of 24 October 2026: BK-204 and BK-188).
--
--   * BK-204. A private booking portal link was a signed link valid for a year, and the app never
--     checked it against the booking, so a forwarded or leaked link could not be switched off on its
--     own. Links now carry the moment they were issued; private_bookings.portal_links_revoked_at is
--     set by the staff action "Switch Off Old Links", and the booking page refuses any link issued
--     before it. NULL means no link has been switched off.
--   * BK-188. The website enquiry forms squashed the chosen room into a free-text note.
--     private_bookings.requested_space_id keeps the room the guest asked for. It is a request only:
--     nothing that decides whether a room is free reads it (rooms are held by private_booking_items),
--     so it never blocks the diary. ON DELETE SET NULL, so removing a room never fails on an old
--     enquiry. The reply choice and the hours use columns that already exist
--     (communication_preference, end_time).
--
-- Live data this changes: none. Both columns are added empty. No function, view, trigger or grant
-- is changed; the new columns take the table's existing grants.
--
-- Rollback: tasks/private-hire-tidy/rollback.sql (part 2). Tested by
-- scripts/testing/private-hire-portal-links-postgres.py.

ALTER TABLE public.private_bookings ADD COLUMN IF NOT EXISTS portal_links_revoked_at timestamptz;

COMMENT ON COLUMN public.private_bookings.portal_links_revoked_at IS
  'Booking page links issued before this moment are refused (BK-204). Set by staff with Switch Off Old Links; NULL when none has been switched off.';

ALTER TABLE public.private_bookings ADD COLUMN IF NOT EXISTS requested_space_id uuid;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.private_bookings'::regclass
       AND conname = 'private_bookings_requested_space_id_fkey'
  ) THEN
    ALTER TABLE public.private_bookings
      ADD CONSTRAINT private_bookings_requested_space_id_fkey
      FOREIGN KEY (requested_space_id) REFERENCES public.venue_spaces(id) ON DELETE SET NULL;
  END IF;
END
$fk$;

COMMENT ON COLUMN public.private_bookings.requested_space_id IS
  'The room a website enquiry asked for (BK-188). A request only: it holds nothing and blocks nothing; rooms are booked through private_booking_items.';
