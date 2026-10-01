-- Committed before the Release 2 migration, so its backfill has something to work on: the
-- shape production is in, where an old repeat upload left an empty batch beside the batch that
-- holds the file's transactions.
\set ON_ERROR_STOP on

INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-0000000000d1');

INSERT INTO public.receipt_batches (id, original_filename, source_hash, row_count, uploaded_at)
VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'legacy.csv', 'legacy-hash', 2, TIMESTAMPTZ '2025-09-28 10:00+00'),
  ('00000000-0000-0000-0000-0000000000e2', 'legacy.csv', 'legacy-hash', 2, TIMESTAMPTZ '2025-10-03 10:00+00');

INSERT INTO public.receipt_transactions (batch_id, transaction_date, details, amount_out, dedupe_hash)
VALUES
  ('00000000-0000-0000-0000-0000000000e2', DATE '2025-09-01', 'LEGACY ONE', 10, 'legacy-1'),
  ('00000000-0000-0000-0000-0000000000e2', DATE '2025-09-02', 'LEGACY TWO', 20, 'legacy-2');

\echo 'RECEIPTS BEFORE RELEASE 2 TESTS PASSED'
