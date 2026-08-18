-- Link the two halves of an entry that a monthly cap cut in two.
--
-- When a capped month runs out of headroom part-way through an entry, the
-- billing run reduces the original and inserts a remainder carrying the same
-- date and the same description. Nothing connects them, so the pair is
-- indistinguishable from a duplicate. The owner had already flagged one such
-- pair as "possible duplicate" in a customer-facing description, and on the new
-- Work Record the two rows would read as double billing.
--
-- Backfills the single pair that exists: Golden Barrels, 26 May 2026, a one hour
-- Sea and Seeds call split into two halves by the May run, the remainder created
-- at 01:05:23 on 1 June inside that run's window.

ALTER TABLE public.oj_entries
  ADD COLUMN IF NOT EXISTS split_from_entry_id uuid
    REFERENCES public.oj_entries(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.oj_entries.split_from_entry_id IS
  'Set on the remainder when a monthly billing cap split an entry. Points at the entry that kept the billed portion, so the two halves can be shown as one piece of work rather than as a duplicate.';

CREATE INDEX IF NOT EXISTS oj_entries_split_from_entry_id_idx
  ON public.oj_entries (split_from_entry_id)
  WHERE split_from_entry_id IS NOT NULL;

-- The remainder is the later-created row of a same vendor, date and description
-- pair where one side is settled and the other is not. Deliberately narrow: it
-- matches the one known pair and will not sweep up a genuine repeat of the same
-- work logged twice on purpose.
UPDATE public.oj_entries remainder
   SET split_from_entry_id = parent.id
  FROM public.oj_entries parent
 WHERE remainder.split_from_entry_id IS NULL
   AND parent.id <> remainder.id
   AND parent.vendor_id = remainder.vendor_id
   AND parent.entry_date = remainder.entry_date
   AND parent.description IS NOT NULL
   AND parent.description = remainder.description
   AND parent.entry_type = remainder.entry_type
   AND parent.created_at < remainder.created_at
   AND parent.invoice_id IS NOT NULL
   AND remainder.invoice_id IS NULL;
