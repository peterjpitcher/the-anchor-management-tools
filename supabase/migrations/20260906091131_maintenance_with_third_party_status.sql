-- Adds a "with_third_party" status to maintenance items.
--
-- Two of the highest priority items are stuck with the council: the Hithermoor Road
-- hedge (Surrey Highways enquiry 345992) and the neglected land behind the pub. Neither
-- fits an existing status. "awaiting_landlord" renders as "With Greene King", which is
-- simply wrong for Surrey Highways, and "reported" claims nothing has happened when in
-- fact a request is logged and being chased. Both were therefore sitting under a status
-- that misrepresented them.
--
-- Deliberately generic rather than "with_council": the same situation arises with an
-- insurer, a neighbouring freeholder or a utility, and a value named for one of them
-- would need renaming later.
--
-- Purely additive: this widens a CHECK constraint and changes no existing row. Apply
-- BEFORE deploying the code that can write the new value.

ALTER TABLE public.maintenance_items
  DROP CONSTRAINT IF EXISTS maintenance_items_status_check;

ALTER TABLE public.maintenance_items
  ADD CONSTRAINT maintenance_items_status_check
  CHECK (status IN (
    'reported',
    'quoting',
    'awaiting_landlord',
    'with_third_party',
    'scheduled',
    'in_progress',
    'on_hold',
    'done',
    'cancelled'
  ));

COMMENT ON COLUMN public.maintenance_items.status IS
  'Open means any status other than done and cancelled. awaiting_landlord displays as "With Greene King"; with_third_party covers anyone who is neither us nor the landlord, such as the council, Highways or an insurer. The stored values are tenancy neutral on purpose.';
