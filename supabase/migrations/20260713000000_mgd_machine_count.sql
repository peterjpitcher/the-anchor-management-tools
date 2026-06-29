-- MGD: per-return machine count
-- ---------------------------------------------------------------------------
-- Box 1 of the MGD7 return ("Number of machines available for play at the end
-- of the period") was previously inferred from the number of cash collections
-- recorded, which is incorrect. Store the actual machine count per return so it
-- can be set in the UI and frozen against each submitted return.
--
-- Additive and idempotent: a new column with a default does not affect the
-- mgd_collection_sync_return() trigger (it inserts only period_start/period_end)
-- and existing rows default to 1.

ALTER TABLE public.mgd_returns
  ADD COLUMN IF NOT EXISTS machine_count INTEGER NOT NULL DEFAULT 1
    CHECK (machine_count >= 0);

COMMENT ON COLUMN public.mgd_returns.machine_count IS
  'Number of dutiable machines available for play at the end of the period (MGD7 Box 1).';
