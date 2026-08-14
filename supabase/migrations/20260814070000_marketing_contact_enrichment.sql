-- Keeps the enrichment the owner researched for each business contact.
--
-- The curated spreadsheet carries far more than a name and an address: how far away they
-- are, which walking round they sit in, how many staff, whether they fit the room, the angle
-- to lead with, an opening line and when to make contact. The first import kept only the
-- fields the sender needs, which quietly threw away the part that took the most work to
-- produce and is the reason the list is worth anything.
--
-- All text rather than typed columns, because the source values are prose. "Staff (est)"
-- holds things like "~2000 at LHR" and "Gateway to 300+ businesses", so an integer column
-- would have silently dropped most of them.

BEGIN;

ALTER TABLE public.business_contacts
  ADD COLUMN IF NOT EXISTS distance_note text,
  ADD COLUMN IF NOT EXISTS cluster text,
  ADD COLUMN IF NOT EXISTS staff_estimate text,
  ADD COLUMN IF NOT EXISTS room_fit text,
  ADD COLUMN IF NOT EXISTS room_fit_note text,
  ADD COLUMN IF NOT EXISTS angle text,
  ADD COLUMN IF NOT EXISTS opening_line text,
  ADD COLUMN IF NOT EXISTS send_timing text;

COMMENT ON COLUMN public.business_contacts.cluster IS
  'Walkable round this business belongs to, so several nearby firms can be visited in one trip.';
COMMENT ON COLUMN public.business_contacts.room_fit IS
  'Whether the venue suits their likely group size: Perfect, Good, Too big whole, or Unknown.';
COMMENT ON COLUMN public.business_contacts.angle IS
  'The reason this particular business should care, used when writing to them.';
COMMENT ON COLUMN public.business_contacts.opening_line IS
  'Researched opening line for one-to-one outreach. Not used by campaign sending.';

-- Cluster is the one that gets filtered on, when planning a round of visits.
CREATE INDEX IF NOT EXISTS business_contacts_cluster_idx
  ON public.business_contacts (cluster) WHERE cluster IS NOT NULL;

COMMIT;
