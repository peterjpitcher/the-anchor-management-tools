-- M-005: Add NOT NULL constraint to committed_party_size
-- Backfill any rows where committed_party_size is NULL (fall back to party_size).
-- The code already handles NULL via ?? fallback, but this enforces the invariant at DB level.
UPDATE public.table_bookings
SET committed_party_size = party_size
WHERE committed_party_size IS NULL;

ALTER TABLE public.table_bookings
  ALTER COLUMN committed_party_size SET NOT NULL;
