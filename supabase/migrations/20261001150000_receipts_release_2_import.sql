-- Receipts Release 2: import (tasks/spec-2026-10-01-receipts-section-review.md, section 6).
--
-- Additive. New columns on receipt_batches, one backfill of a new column, one unique index and
-- one new function. Nothing is dropped or deleted, and the code deployed before this migration
-- keeps working: it neither reads nor writes the new columns, and its batch inserts take the
-- column defaults.
--
--   6.2 item 1  Every record in a statement is accounted for: the batch stores how many records
--               the file held, how many went in, how many were already held, and each record
--               that could not be read.
--   6.2 item 4  The batch, its lines, their history rows and the follow-up job are written in
--               one transaction. An import can no longer be half done, and the work that
--               follows it (rules, AI, invoice matching) can no longer be lost.
--   6.2 item 5  The same file can only be imported once, enforced by a unique index, without
--               deleting the empty batches left behind in 2025.

BEGIN;

ALTER TABLE public.receipt_batches
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS records_in_file integer,
  ADD COLUMN IF NOT EXISTS inserted_count integer,
  ADD COLUMN IF NOT EXISTS duplicate_count integer,
  ADD COLUMN IF NOT EXISTS rejected_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejected_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS repeated_in_file integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS followup_status text NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS followup_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS followup_error text,
  ADD COLUMN IF NOT EXISTS followup_completed_at timestamptz;

ALTER TABLE public.receipt_batches
  ADD CONSTRAINT receipt_batches_status_check
  CHECK (status = ANY (ARRAY['completed'::text, 'superseded'::text]));

ALTER TABLE public.receipt_batches
  ADD CONSTRAINT receipt_batches_followup_status_check
  CHECK (followup_status = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text]));

-- Before September 2025 every repeat upload of a file created another batch row and moved the
-- transactions to it, leaving the earlier rows with no transactions. Those empty rows are kept
-- as history and marked superseded, so one completed batch is left per file. This writes only
-- the column added above.
UPDATE public.receipt_batches b
SET status = 'superseded'
WHERE NOT EXISTS (
  SELECT 1 FROM public.receipt_transactions t WHERE t.batch_id = b.id
);

-- Refuse to go on if two completed batches still share a file. That would mean the same
-- statement holds transactions under two batches, which has to be looked at by a person.
DO $$
DECLARE
  v_duplicates integer;
BEGIN
  SELECT count(*) INTO v_duplicates
  FROM (
    SELECT source_type, source_hash
    FROM public.receipt_batches
    WHERE status = 'completed'
    GROUP BY source_type, source_hash
    HAVING count(*) > 1
  ) d;

  IF v_duplicates > 0 THEN
    RAISE EXCEPTION 'RECEIPT_BATCH_DUPLICATE_FILE: % statement files are on more than one completed batch', v_duplicates;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_receipt_batches_completed_file
  ON public.receipt_batches (source_type, source_hash)
  WHERE status = 'completed';

-- ---------------------------------------------------------------------------
-- import_receipt_statement
--
-- One transaction: the batch, its lines, a history row per line and the follow-up job.
--
-- A file that was imported before is not refused outright. Its lines are offered again and any
-- that are not already held are added to the original batch. That is how lines an earlier
-- parser skipped (the bank's own charges, which carry no description) are recovered by
-- uploading the statement again. Lines already held are untouched.
--
-- Two uploads of the same file at the same moment are serialised by an advisory lock, so only
-- one batch is ever created for a file.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_receipt_statement(
  p_batch jsonb,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_source_type text := p_batch->>'source_type';
  v_source_hash text := p_batch->>'source_hash';
  v_filename text := NULLIF(btrim(COALESCE(p_batch->>'original_filename', '')), '');
  v_uploaded_by uuid := NULLIF(p_batch->>'uploaded_by', '')::uuid;
  v_batch public.receipt_batches%ROWTYPE;
  v_already boolean := false;
  v_ids uuid[];
  v_inserted integer;
  v_offered integer;
BEGIN
  IF v_source_type IS NULL OR v_source_type NOT IN ('bank', 'amex') THEN
    RAISE EXCEPTION 'import_receipt_statement: source_type must be bank or amex';
  END IF;
  IF v_source_hash IS NULL OR btrim(v_source_hash) = '' THEN
    RAISE EXCEPTION 'import_receipt_statement: source_hash is required';
  END IF;
  IF v_filename IS NULL THEN
    RAISE EXCEPTION 'import_receipt_statement: original_filename is required';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'import_receipt_statement: rows must be an array';
  END IF;

  v_offered := jsonb_array_length(p_rows);

  PERFORM pg_advisory_xact_lock(hashtextextended('receipts:import:' || v_source_type || ':' || v_source_hash, 0));

  SELECT * INTO v_batch
  FROM public.receipt_batches
  WHERE source_type = v_source_type
    AND source_hash = v_source_hash
    AND status = 'completed'
  FOR UPDATE;
  v_already := FOUND;

  IF NOT v_already THEN
    INSERT INTO public.receipt_batches (
      original_filename, source_hash, source_type, row_count, uploaded_by, status,
      inserted_count, duplicate_count, followup_status
    ) VALUES (
      v_filename, v_source_hash, v_source_type, v_offered, v_uploaded_by, 'completed',
      0, 0, 'done'
    )
    RETURNING * INTO v_batch;
  END IF;

  WITH inserted AS (
    INSERT INTO public.receipt_transactions (
      batch_id, source_type, transaction_date, details, transaction_type,
      amount_in, amount_out, balance, dedupe_hash, status, receipt_required,
      card_member, card_account, merchant_category, merchant_town, external_reference,
      vendor_name, vendor_source, expense_category, expense_category_source
    )
    SELECT
      v_batch.id,
      COALESCE(r.source_type, v_source_type),
      r.transaction_date,
      r.details,
      r.transaction_type,
      r.amount_in,
      r.amount_out,
      r.balance,
      r.dedupe_hash,
      COALESCE(r.status, 'pending')::public.receipt_transaction_status,
      COALESCE(r.receipt_required, true),
      r.card_member,
      r.card_account,
      r.merchant_category,
      r.merchant_town,
      r.external_reference,
      r.vendor_name,
      r.vendor_source,
      r.expense_category,
      r.expense_category_source
    FROM jsonb_to_recordset(p_rows) AS r(
      source_type text,
      transaction_date date,
      details text,
      transaction_type text,
      amount_in numeric,
      amount_out numeric,
      balance numeric,
      dedupe_hash text,
      status text,
      receipt_required boolean,
      card_member text,
      card_account text,
      merchant_category text,
      merchant_town text,
      external_reference text,
      vendor_name text,
      vendor_source text,
      expense_category text,
      expense_category_source text
    )
    ON CONFLICT (dedupe_hash) DO NOTHING
    RETURNING id, status
  ),
  logged AS (
    INSERT INTO public.receipt_transaction_logs (
      transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
    )
    SELECT id, NULL, status, 'import', format('Imported via %s', v_filename), v_uploaded_by, NULL, now()
    FROM inserted
    RETURNING 1
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_ids FROM inserted;

  v_inserted := COALESCE(array_length(v_ids, 1), 0);

  UPDATE public.receipt_batches
  SET inserted_count = COALESCE(inserted_count, 0) + v_inserted,
      duplicate_count = CASE WHEN v_already THEN duplicate_count ELSE v_offered - v_inserted END,
      records_in_file = COALESCE((p_batch->>'records_in_file')::integer, records_in_file),
      rejected_count = COALESCE((p_batch->>'rejected_count')::integer, rejected_count),
      rejected_records = COALESCE(p_batch->'rejected_records', rejected_records),
      repeated_in_file = COALESCE((p_batch->>'repeated_in_file')::integer, repeated_in_file),
      followup_status = CASE WHEN v_inserted > 0 THEN 'queued' ELSE followup_status END,
      followup_state = CASE WHEN v_inserted > 0 THEN '{}'::jsonb ELSE followup_state END,
      followup_error = CASE WHEN v_inserted > 0 THEN NULL ELSE followup_error END,
      followup_completed_at = CASE WHEN v_inserted > 0 THEN NULL ELSE followup_completed_at END
  WHERE id = v_batch.id
  RETURNING * INTO v_batch;

  -- The work that follows an import is committed with it, so a process that dies straight
  -- after this call cannot leave the new lines without their rules, AI and invoice matching.
  IF v_inserted > 0 AND NOT EXISTS (
    SELECT 1 FROM public.jobs j
    WHERE j.type = 'process_receipt_batch'
      AND j.status IN ('pending', 'processing')
      AND j.payload->>'batch_id' = v_batch.id::text
  ) THEN
    INSERT INTO public.jobs (type, payload, status, priority, attempts, max_attempts, scheduled_for)
    VALUES (
      'process_receipt_batch',
      jsonb_build_object(
        'batch_id', v_batch.id,
        'initiated_by', v_uploaded_by,
        'unique_key', 'receipts:process_receipt_batch:' || v_batch.id::text
      ),
      'pending', -10, 0, 5, now()
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_already THEN 'already_imported' ELSE 'imported' END,
    'batch', to_jsonb(v_batch),
    'inserted_ids', to_jsonb(v_ids),
    'inserted_count', v_inserted,
    'duplicate_count', v_offered - v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_receipt_statement(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_receipt_statement(jsonb, jsonb) TO service_role;

COMMIT;
