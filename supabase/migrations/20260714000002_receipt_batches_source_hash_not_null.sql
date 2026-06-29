-- FF-017: make receipt_batches.source_hash NOT NULL so the duplicate-file import
-- guard is reliable for every batch (a NULL source_hash can never match the guard's
-- equality check and silently disables dedup for that batch).
--
-- Safe backfill first: any legacy row with a NULL source_hash is given a unique,
-- clearly-marked placeholder. The 'legacy-' prefix cannot collide with a real
-- SHA-256 hash (64 lowercase hex chars), and id is unique, so each placeholder is
-- distinct — preserving the uniqueness the guard relies on. No data is lost.

UPDATE public.receipt_batches
SET source_hash = 'legacy-' || id::text
WHERE source_hash IS NULL;

ALTER TABLE public.receipt_batches
  ALTER COLUMN source_hash SET NOT NULL;
