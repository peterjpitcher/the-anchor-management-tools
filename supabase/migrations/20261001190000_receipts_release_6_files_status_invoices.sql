-- Receipts Release 6: files, status, the invoice ledger and attached invoices
-- (tasks/spec-2026-10-01-receipts-section-review.md, section 10).
--
-- Additive: two new columns on receipt_files, one on receipt_transactions, new functions, and
-- narrower grants. No table or column is dropped and no row is deleted. Two functions change
-- their argument list and are therefore dropped and recreated; the code deployed before this
-- migration keeps working, because the new arguments have defaults.
--
-- Apply after 20261001180000 (Release 4): it uses the lock date from Release 5 and the
-- "no category applies" flag from Release 4.
--
--   10.1  A file already on another payment is reported before anything is written.
--         Deleting a file is one transaction.
--   10.2  Completed means a file, or a written reason. A count of those with neither.
--   10.4  One function records an invoice payment, its match and the payment update, and will
--         not allocate more than the bank payment's amount.
--   10.5  Table privileges and function grants that only row security was holding back.
--   10.6  An invoice attached to the payment that settled it.

BEGIN;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- Why a payment is completed with no file on it. A payment with a file needs none.
ALTER TABLE public.receipt_transactions
  ADD COLUMN IF NOT EXISTS completed_reason text;

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT IF EXISTS receipt_transactions_completed_reason_length;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_completed_reason_length CHECK (
    completed_reason IS NULL OR char_length(btrim(completed_reason)) BETWEEN 1 AND 500
  );

-- Where a file came from: uploaded by a person, or a copy of one of our own invoices.
ALTER TABLE public.receipt_files
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload';
ALTER TABLE public.receipt_files
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

ALTER TABLE public.receipt_files
  DROP CONSTRAINT IF EXISTS receipt_files_source_check;
ALTER TABLE public.receipt_files
  ADD CONSTRAINT receipt_files_source_check CHECK (source IN ('upload', 'invoice'));

-- One invoice is attached to a payment once.
CREATE UNIQUE INDEX IF NOT EXISTS receipt_files_transaction_invoice_unique
  ON public.receipt_files (transaction_id, invoice_id)
  WHERE invoice_id IS NOT NULL;

-- The duplicate check looks a hash up on every upload.
CREATE INDEX IF NOT EXISTS idx_receipt_files_content_hash
  ON public.receipt_files (content_hash)
  WHERE content_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 10.1 Completing an upload, with the duplicate check
-- ---------------------------------------------------------------------------

-- `p_duplicate` says what to do about a file whose bytes are already on another payment:
--   off        no check (the code deployed before this migration)
--   check      report it and write nothing
--   confirmed  the person has seen the warning: attach it
-- With a check asked for, an upload whose bytes could not be read is refused: a file that cannot
-- be hashed cannot be checked. Invoice copies are left out of the comparison, because one invoice
-- legitimately settles several payments.
--
-- Outcomes: completed, replayed, duplicate, unreadable, already_completed, transaction_not_found,
-- not_issued.
DROP FUNCTION IF EXISTS public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text);

CREATE OR REPLACE FUNCTION public.complete_receipt_upload(
  p_transaction_id uuid,
  p_storage_path text,
  p_user_id uuid,
  p_user_email text,
  p_user_name text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_content_hash text,
  p_duplicate text DEFAULT 'off'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_intent public.receipt_upload_intents%ROWTYPE;
  v_tx public.receipt_transactions%ROWTYPE;
  v_file public.receipt_files%ROWTYPE;
  v_now timestamptz := now();
  v_mode text := COALESCE(p_duplicate, 'off');
  v_others jsonb := '[]'::jsonb;
  v_other_count integer := 0;
BEGIN
  IF v_mode NOT IN ('off', 'check', 'confirmed') THEN
    RAISE EXCEPTION 'complete_receipt_upload: unknown duplicate mode %', v_mode;
  END IF;

  SELECT * INTO v_intent
  FROM public.receipt_upload_intents
  WHERE transaction_id = p_transaction_id
    AND storage_path = p_storage_path
    AND issued_to = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_issued');
  END IF;

  IF v_intent.completed_at IS NOT NULL THEN
    SELECT * INTO v_file FROM public.receipt_files WHERE id = v_intent.receipt_file_id;
    IF FOUND THEN
      RETURN jsonb_build_object('outcome', 'replayed', 'receipt', to_jsonb(v_file));
    END IF;
    -- The upload was completed and its file has since been removed. Nothing to attach.
    RETURN jsonb_build_object('outcome', 'already_completed');
  END IF;

  IF v_mode <> 'off' THEN
    IF p_content_hash IS NULL OR btrim(p_content_hash) = '' THEN
      RETURN jsonb_build_object('outcome', 'unreadable');
    END IF;

    -- Two people attaching the same file to two payments at once are taken one at a time, so
    -- the second is told about the first.
    PERFORM pg_advisory_xact_lock(hashtextextended('receipt_file_hash:' || p_content_hash, 0));

    SELECT count(*), COALESCE(jsonb_agg(entry ORDER BY entry->>'transaction_date' DESC) FILTER (WHERE rn <= 10), '[]'::jsonb)
    INTO v_other_count, v_others
    FROM (
      SELECT
        jsonb_build_object(
          'transaction_id', t.id,
          'transaction_date', t.transaction_date,
          'details', t.details,
          'amount', COALESCE(t.amount_out, t.amount_in),
          'file_name', min(f.file_name)
        ) AS entry,
        row_number() OVER (ORDER BY t.transaction_date DESC, t.id) AS rn
      FROM public.receipt_files f
      JOIN public.receipt_transactions t ON t.id = f.transaction_id
      WHERE f.content_hash = p_content_hash
        AND f.source = 'upload'
        AND f.transaction_id <> p_transaction_id
      GROUP BY t.id, t.transaction_date, t.details, t.amount_out, t.amount_in
    ) others;

    IF v_other_count > 0 AND v_mode = 'check' THEN
      RETURN jsonb_build_object('outcome', 'duplicate', 'count', v_other_count, 'payments', v_others);
    END IF;
  END IF;

  SELECT * INTO v_tx
  FROM public.receipt_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'transaction_not_found');
  END IF;

  INSERT INTO public.receipt_files (
    transaction_id, storage_path, file_name, mime_type, file_size_bytes,
    content_hash, hash_verified_at, uploaded_by, source
  ) VALUES (
    p_transaction_id, p_storage_path, p_file_name, NULLIF(btrim(COALESCE(p_mime_type, '')), ''),
    p_file_size_bytes::integer,
    p_content_hash, CASE WHEN p_content_hash IS NULL THEN NULL ELSE v_now END, p_user_id, 'upload'
  )
  RETURNING * INTO v_file;

  UPDATE public.receipt_transactions
  SET status = 'completed',
      receipt_required = false,
      marked_by = p_user_id,
      marked_by_email = p_user_email,
      marked_by_name = p_user_name,
      marked_at = v_now,
      marked_method = 'receipt_upload',
      rule_applied_id = NULL
  WHERE id = p_transaction_id;

  INSERT INTO public.receipt_transaction_logs (
    transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
  ) VALUES (
    p_transaction_id, v_tx.status, 'completed', 'receipt_upload',
    format('Receipt uploaded (%s)', p_file_name)
      || CASE
           WHEN v_other_count > 0 THEN format('. The same file is on %s other transaction%s: confirmed', v_other_count, CASE WHEN v_other_count = 1 THEN '' ELSE 's' END)
           ELSE ''
         END,
    p_user_id, NULL, v_now
  );

  UPDATE public.receipt_upload_intents
  SET completed_at = v_now,
      receipt_file_id = v_file.id
  WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'receipt', to_jsonb(v_file),
    'previous_status', v_tx.status::text,
    'shared_with', v_other_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 10.1 and 10.2 Deleting a file
-- ---------------------------------------------------------------------------

-- The file row, the payment and its history move together under a lock on the payment. The
-- stored object is removed by the caller afterwards, and only when this says no other row
-- still points at it: a failed removal then leaves an object nothing references, which the
-- sweep collects, and never a payment marked completed with nothing behind it.
--
-- A completed payment that loses its last file goes back to pending, unless it has a written
-- reason for being complete, or was settled by one of our invoices, in which case it returns
-- to "no receipt required".
--
-- Outcomes: deleted, not_found.
CREATE OR REPLACE FUNCTION public.delete_receipt_file(
  p_file_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_file public.receipt_files%ROWTYPE;
  v_tx public.receipt_transactions%ROWTYPE;
  v_now timestamptz := now();
  v_remaining integer;
  v_still_referenced boolean;
  v_invoice_number text;
  v_new_status public.receipt_transaction_status;
BEGIN
  SELECT transaction_id INTO v_file.transaction_id FROM public.receipt_files WHERE id = p_file_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- The payment first, then the file: the same order an upload takes.
  SELECT * INTO v_tx FROM public.receipt_transactions WHERE id = v_file.transaction_id FOR UPDATE;
  SELECT * INTO v_file FROM public.receipt_files WHERE id = p_file_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  DELETE FROM public.receipt_files WHERE id = p_file_id;

  SELECT count(*) INTO v_remaining FROM public.receipt_files WHERE transaction_id = v_file.transaction_id;
  SELECT EXISTS (SELECT 1 FROM public.receipt_files WHERE storage_path = v_file.storage_path) INTO v_still_referenced;

  v_new_status := v_tx.status;

  IF v_remaining = 0 AND v_tx.status = 'completed' AND v_tx.completed_reason IS NULL THEN
    SELECT m.invoice_number INTO v_invoice_number
    FROM public.receipt_invoice_matches m
    WHERE m.receipt_transaction_id = v_tx.id
      AND m.invoice_id IS NOT NULL
      AND m.match_status IN ('matched', 'payment_recorded', 'already_paid', 'amount_mismatch', 'vendor_amount_matched')
    ORDER BY m.matched_at DESC
    LIMIT 1;

    IF v_invoice_number IS NOT NULL THEN
      v_new_status := 'no_receipt_required';
      UPDATE public.receipt_transactions
      SET status = 'no_receipt_required',
          receipt_required = false,
          marked_by = NULL,
          marked_by_email = NULL,
          marked_by_name = NULL,
          marked_at = v_now,
          marked_method = 'invoice_reconciliation',
          auto_completed_reason = 'invoice_payment:' || v_invoice_number
      WHERE id = v_tx.id;
    ELSE
      v_new_status := 'pending';
      UPDATE public.receipt_transactions
      SET status = 'pending',
          receipt_required = true,
          marked_by = NULL,
          marked_by_email = NULL,
          marked_by_name = NULL,
          marked_at = NULL,
          marked_method = NULL,
          rule_applied_id = NULL
      WHERE id = v_tx.id;
    END IF;
  END IF;

  INSERT INTO public.receipt_transaction_logs (
    transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
  ) VALUES (
    v_tx.id, v_tx.status, v_new_status, 'receipt_deleted',
    format('Receipt removed (%s)', v_file.file_name), p_user_id, NULL, v_now
  );

  RETURN jsonb_build_object(
    'outcome', 'deleted',
    'transaction_id', v_tx.id,
    'storage_path', v_file.storage_path,
    'remove_object', NOT v_still_referenced,
    'remaining_files', v_remaining,
    'previous_status', v_tx.status::text,
    'new_status', v_new_status::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_receipt_file(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_receipt_file(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 10.2 Changing a status by hand
-- ---------------------------------------------------------------------------

-- Completing a payment needs a file on it, or a reason. The check, the change and the history
-- row are one transaction under a lock on the payment, so a file removed at the same moment
-- cannot leave a completed payment with neither.
--
-- Outcomes: updated, reason_required, invalid_status, not_found.
CREATE OR REPLACE FUNCTION public.mark_receipt_transaction(
  p_transaction_id uuid,
  p_status text,
  p_reason text,
  p_user_id uuid,
  p_user_email text,
  p_user_name text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_tx public.receipt_transactions%ROWTYPE;
  v_updated public.receipt_transactions%ROWTYPE;
  v_now timestamptz := now();
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_has_file boolean;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find') THEN
    RETURN jsonb_build_object('outcome', 'invalid_status');
  END IF;

  SELECT * INTO v_tx FROM public.receipt_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.receipt_files WHERE transaction_id = p_transaction_id) INTO v_has_file;

  IF p_status = 'completed' AND NOT v_has_file AND v_reason IS NULL THEN
    RETURN jsonb_build_object('outcome', 'reason_required');
  END IF;

  UPDATE public.receipt_transactions
  SET status = p_status::public.receipt_transaction_status,
      receipt_required = (p_status = 'pending'),
      marked_by = p_user_id,
      marked_by_email = p_user_email,
      marked_by_name = p_user_name,
      marked_at = v_now,
      marked_method = 'manual',
      rule_applied_id = NULL,
      -- A reason belongs to a completed payment. Any other status clears it.
      completed_reason = CASE WHEN p_status = 'completed' THEN left(v_reason, 500) ELSE NULL END
  WHERE id = p_transaction_id
  RETURNING * INTO v_updated;

  INSERT INTO public.receipt_transaction_logs (
    transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
  ) VALUES (
    p_transaction_id, v_tx.status, v_updated.status, 'manual_update',
    CASE
      WHEN p_status = 'completed' AND NOT v_has_file THEN 'Completed without a receipt: ' || left(v_reason, 500)
      WHEN p_status = 'completed' AND v_reason IS NOT NULL THEN 'Completed: ' || left(v_reason, 500)
      ELSE NULL
    END,
    p_user_id, NULL, v_now
  );

  RETURN jsonb_build_object(
    'outcome', 'updated',
    'previous_status', v_tx.status::text,
    'transaction', to_jsonb(v_updated)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_receipt_transaction(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_receipt_transaction(uuid, text, text, uuid, text, text) TO service_role;

-- How many payments are completed with neither a file nor a reason. These are the ones to
-- review: they were completed by hand before a reason was asked for. Counted here, in one
-- statement, because the workspace shows the figure on every load.
CREATE OR REPLACE FUNCTION public.count_receipts_completed_without_receipt()
RETURNS integer
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT count(*)::integer
  FROM public.receipt_transactions t
  WHERE t.status = 'completed'
    AND t.completed_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.receipt_files f WHERE f.transaction_id = t.id);
$$;

REVOKE ALL ON FUNCTION public.count_receipts_completed_without_receipt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_receipts_completed_without_receipt() TO service_role;

-- ---------------------------------------------------------------------------
-- 10.4 Invoice pairing respects the lock date
-- ---------------------------------------------------------------------------

-- Replaces the Release 1 function with one change: a payment on or before the lock date keeps
-- its status and vendor. The match is still recorded, because it is a fact about the invoice.
CREATE OR REPLACE FUNCTION public.apply_receipt_invoice_match(
  p_transaction_id uuid,
  p_invoice_id uuid,
  p_invoice_number text,
  p_invoice_payment_id uuid,
  p_match_status text,
  p_amount_match boolean,
  p_matched_amount numeric,
  p_invoice_total numeric,
  p_invoice_paid_before numeric,
  p_payload jsonb,
  p_allow_status_change boolean,
  p_vendor_id uuid,
  p_vendor_name text,
  p_initiated_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_tx public.receipt_transactions%ROWTYPE;
  v_now timestamptz := now();
  v_vendor_name text := NULLIF(btrim(COALESCE(p_vendor_name, '')), '');
  v_status_updated boolean := false;
  v_vendor_updated boolean := false;
  v_lock date := public.receipts_locked_before();
  v_locked boolean := false;
BEGIN
  IF p_invoice_number IS NULL OR btrim(p_invoice_number) = '' THEN
    RAISE EXCEPTION 'apply_receipt_invoice_match: invoice number is required';
  END IF;

  SELECT * INTO v_tx
  FROM public.receipt_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'transaction_not_found');
  END IF;

  v_locked := v_lock IS NOT NULL AND v_tx.transaction_date <= v_lock;

  INSERT INTO public.receipt_invoice_matches AS m (
    receipt_transaction_id, invoice_id, invoice_payment_id, invoice_number, match_status,
    amount_match, transaction_date, matched_amount, invoice_total_amount,
    invoice_paid_amount_before, matched_at, payload
  ) VALUES (
    p_transaction_id, p_invoice_id, p_invoice_payment_id, p_invoice_number, p_match_status,
    COALESCE(p_amount_match, false), v_tx.transaction_date, p_matched_amount, p_invoice_total,
    p_invoice_paid_before, v_now, COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (receipt_transaction_id, invoice_number) DO UPDATE
  SET invoice_id = EXCLUDED.invoice_id,
      invoice_payment_id = COALESCE(EXCLUDED.invoice_payment_id, m.invoice_payment_id),
      match_status = CASE
        WHEN m.invoice_payment_id IS NOT NULL AND EXCLUDED.match_status = 'already_paid' THEN m.match_status
        ELSE EXCLUDED.match_status
      END,
      amount_match = EXCLUDED.amount_match,
      transaction_date = EXCLUDED.transaction_date,
      matched_amount = EXCLUDED.matched_amount,
      invoice_total_amount = EXCLUDED.invoice_total_amount,
      invoice_paid_amount_before = EXCLUDED.invoice_paid_amount_before,
      matched_at = EXCLUDED.matched_at,
      payload = EXCLUDED.payload;

  v_status_updated :=
    NOT v_locked
    AND COALESCE(p_allow_status_change, false)
    AND v_tx.status IN ('pending', 'cant_find')
    AND NOT (v_tx.status = 'pending' AND v_tx.marked_method IS NOT DISTINCT FROM 'manual');

  v_vendor_updated :=
    NOT v_locked
    AND v_vendor_name IS NOT NULL
    AND (v_tx.vendor_source IS NULL OR v_tx.vendor_source IN ('ai', 'rule', 'invoice'))
    AND (
      v_tx.vendor_name IS DISTINCT FROM v_vendor_name
      OR v_tx.vendor_id IS DISTINCT FROM p_vendor_id
      OR v_tx.vendor_source IS DISTINCT FROM 'invoice'
    );

  IF v_status_updated OR v_vendor_updated THEN
    UPDATE public.receipt_transactions
    SET status = CASE WHEN v_status_updated THEN 'no_receipt_required'::public.receipt_transaction_status ELSE status END,
        receipt_required = CASE WHEN v_status_updated THEN false ELSE receipt_required END,
        marked_by = CASE WHEN v_status_updated THEN NULL ELSE marked_by END,
        marked_by_email = CASE WHEN v_status_updated THEN NULL ELSE marked_by_email END,
        marked_by_name = CASE WHEN v_status_updated THEN NULL ELSE marked_by_name END,
        marked_at = CASE WHEN v_status_updated THEN v_now ELSE marked_at END,
        marked_method = CASE WHEN v_status_updated THEN 'invoice_reconciliation' ELSE marked_method END,
        auto_completed_reason = CASE
          WHEN v_status_updated THEN 'invoice_payment:' || p_invoice_number
          ELSE auto_completed_reason
        END,
        vendor_name = CASE WHEN v_vendor_updated THEN v_vendor_name ELSE vendor_name END,
        vendor_id = CASE WHEN v_vendor_updated THEN p_vendor_id ELSE vendor_id END,
        vendor_source = CASE WHEN v_vendor_updated THEN 'invoice' ELSE vendor_source END,
        vendor_rule_id = CASE WHEN v_vendor_updated THEN NULL ELSE vendor_rule_id END,
        vendor_updated_at = CASE WHEN v_vendor_updated THEN v_now ELSE vendor_updated_at END
    WHERE id = p_transaction_id;
  END IF;

  IF v_status_updated THEN
    INSERT INTO public.receipt_transaction_logs (
      transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
    ) VALUES (
      p_transaction_id, v_tx.status, 'no_receipt_required', 'invoice_reconciliation',
      format('Matched invoice payment %s', p_invoice_number), p_initiated_by, NULL, v_now
    );
  END IF;

  IF v_vendor_updated THEN
    INSERT INTO public.receipt_transaction_logs (
      transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
    ) VALUES (
      p_transaction_id,
      v_tx.status,
      CASE WHEN v_status_updated THEN 'no_receipt_required'::public.receipt_transaction_status ELSE v_tx.status END,
      'invoice_classification',
      format('Vendor updated from invoice %s: %s', p_invoice_number, v_vendor_name), p_initiated_by, NULL, v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'applied',
    'status_updated', v_status_updated,
    'vendor_updated', v_vendor_updated,
    'locked', v_locked,
    'previous_status', v_tx.status::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 10.4 The invoice ledger
-- ---------------------------------------------------------------------------

-- Records an invoice payment from a bank payment, stores the match and updates the bank payment,
-- as one transaction under a lock on the bank payment. Before this the ledger entry was written
-- first and the match afterwards: a failure in between, followed by a retry, could record the
-- money twice.
--
--  - Called again for the same payment and invoice, it records nothing more and answers with
--    the payment it recorded the first time.
--  - It will not allocate more than the bank payment's amount across every invoice it has paid.
--
-- Outcomes: applied (with `payment_recorded` true or false), over_allocated,
-- transaction_not_found.
CREATE OR REPLACE FUNCTION public.record_receipt_invoice_payment(
  p_transaction_id uuid,
  p_invoice_id uuid,
  p_invoice_number text,
  p_amount numeric,
  p_amount_match boolean,
  p_invoice_total numeric,
  p_invoice_paid_before numeric,
  p_payload jsonb,
  p_vendor_id uuid,
  p_vendor_name text,
  p_initiated_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_tx public.receipt_transactions%ROWTYPE;
  v_existing_payment uuid;
  v_payment_id uuid;
  v_payment jsonb;
  v_available numeric;
  v_allocated numeric;
  v_recorded boolean := false;
  v_result jsonb;
BEGIN
  IF p_invoice_id IS NULL OR p_invoice_number IS NULL OR btrim(p_invoice_number) = '' THEN
    RAISE EXCEPTION 'record_receipt_invoice_payment: an invoice is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'record_receipt_invoice_payment: the amount must be above zero';
  END IF;

  SELECT * INTO v_tx FROM public.receipt_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'transaction_not_found');
  END IF;

  SELECT m.invoice_payment_id INTO v_existing_payment
  FROM public.receipt_invoice_matches m
  WHERE m.receipt_transaction_id = p_transaction_id
    AND m.invoice_number = p_invoice_number
    AND m.invoice_payment_id IS NOT NULL;

  IF v_existing_payment IS NOT NULL THEN
    v_payment_id := v_existing_payment;
  ELSE
    v_available := GREATEST(COALESCE(v_tx.amount_in, 0), COALESCE(v_tx.amount_out, 0));

    SELECT COALESCE(SUM(ip.amount), 0) INTO v_allocated
    FROM public.receipt_invoice_matches m
    JOIN public.invoice_payments ip ON ip.id = m.invoice_payment_id
    WHERE m.receipt_transaction_id = p_transaction_id;

    IF v_allocated + p_amount > v_available + 0.005 THEN
      RETURN jsonb_build_object(
        'outcome', 'over_allocated',
        'available', v_available,
        'allocated', v_allocated,
        'requested', p_amount
      );
    END IF;

    v_payment := public.record_invoice_payment_transaction(jsonb_build_object(
      'invoice_id', p_invoice_id,
      'payment_date', v_tx.transaction_date,
      'amount', p_amount,
      'payment_method', 'bank_transfer',
      'reference', v_tx.details,
      'notes', format('Auto-matched from receipt transaction %s', p_transaction_id)
    ));
    v_payment_id := (v_payment->>'id')::uuid;
    IF v_payment_id IS NULL THEN
      RAISE EXCEPTION 'record_receipt_invoice_payment: the invoice payment was not recorded';
    END IF;
    v_recorded := true;
  END IF;

  v_result := public.apply_receipt_invoice_match(
    p_transaction_id, p_invoice_id, p_invoice_number, v_payment_id, 'payment_recorded',
    p_amount_match, GREATEST(COALESCE(v_tx.amount_in, 0), COALESCE(v_tx.amount_out, 0)),
    p_invoice_total, p_invoice_paid_before, p_payload, true, p_vendor_id, p_vendor_name, p_initiated_by
  );

  IF v_result->>'outcome' IS DISTINCT FROM 'applied' THEN
    -- Undo the ledger entry with everything else.
    RAISE EXCEPTION 'record_receipt_invoice_payment: the match could not be stored (%)', v_result->>'outcome';
  END IF;

  RETURN v_result || jsonb_build_object('invoice_payment_id', v_payment_id, 'payment_recorded', v_recorded);
END;
$$;

REVOKE ALL ON FUNCTION public.record_receipt_invoice_payment(uuid, uuid, text, numeric, boolean, numeric, numeric, jsonb, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_receipt_invoice_payment(uuid, uuid, text, numeric, boolean, numeric, numeric, jsonb, uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 10.6 An invoice attached to the payment that settled it
-- ---------------------------------------------------------------------------

-- Adds the stored copy of an invoice to a payment and marks the payment completed (W12).
--
--  - One invoice is attached to a payment once. Called again it changes nothing and says so, and
--    the caller discards the copy it has just stored. With `p_replace` it swaps the stored copy
--    for a fresh one and hands back the old path to remove.
--  - The status moves only from pending, "can't find" or "no receipt required", and never where
--    a person set it by hand. A payment on or before the lock date is left alone entirely.
--
-- Outcomes: attached, refreshed, already_attached, locked, transaction_not_found.
CREATE OR REPLACE FUNCTION public.attach_receipt_invoice_file(
  p_transaction_id uuid,
  p_invoice_id uuid,
  p_invoice_number text,
  p_storage_path text,
  p_file_name text,
  p_file_size_bytes bigint,
  p_content_hash text,
  p_replace boolean DEFAULT false,
  p_initiated_by uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_tx public.receipt_transactions%ROWTYPE;
  v_file public.receipt_files%ROWTYPE;
  v_now timestamptz := now();
  v_lock date := public.receipts_locked_before();
  v_old_path text;
  v_status_updated boolean := false;
BEGIN
  IF p_invoice_id IS NULL OR p_storage_path IS NULL OR btrim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'attach_receipt_invoice_file: an invoice and a stored file are required';
  END IF;

  SELECT * INTO v_tx FROM public.receipt_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'transaction_not_found');
  END IF;

  SELECT * INTO v_file
  FROM public.receipt_files
  WHERE transaction_id = p_transaction_id AND invoice_id = p_invoice_id
  FOR UPDATE;

  IF FOUND THEN
    IF NOT COALESCE(p_replace, false) THEN
      RETURN jsonb_build_object('outcome', 'already_attached', 'receipt', to_jsonb(v_file));
    END IF;

    v_old_path := v_file.storage_path;
    UPDATE public.receipt_files
    SET storage_path = p_storage_path,
        file_name = p_file_name,
        file_size_bytes = p_file_size_bytes::integer,
        content_hash = p_content_hash,
        hash_verified_at = CASE WHEN p_content_hash IS NULL THEN NULL ELSE v_now END,
        uploaded_at = v_now,
        uploaded_by = p_initiated_by
    WHERE id = v_file.id
    RETURNING * INTO v_file;

    INSERT INTO public.receipt_transaction_logs (
      transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
    ) VALUES (
      p_transaction_id, v_tx.status, v_tx.status, 'invoice_copy_refreshed',
      format('Invoice copy refreshed (%s)', p_invoice_number), p_initiated_by, NULL, v_now
    );

    RETURN jsonb_build_object(
      'outcome', 'refreshed',
      'receipt', to_jsonb(v_file),
      'old_storage_path', CASE WHEN v_old_path IS DISTINCT FROM p_storage_path THEN v_old_path ELSE NULL END
    );
  END IF;

  IF v_lock IS NOT NULL AND v_tx.transaction_date <= v_lock THEN
    RETURN jsonb_build_object('outcome', 'locked');
  END IF;

  INSERT INTO public.receipt_files (
    transaction_id, storage_path, file_name, mime_type, file_size_bytes,
    content_hash, hash_verified_at, uploaded_by, source, invoice_id
  ) VALUES (
    p_transaction_id, p_storage_path, p_file_name, 'application/pdf', p_file_size_bytes::integer,
    p_content_hash, CASE WHEN p_content_hash IS NULL THEN NULL ELSE v_now END, p_initiated_by, 'invoice', p_invoice_id
  )
  RETURNING * INTO v_file;

  v_status_updated :=
    v_tx.status IN ('pending', 'cant_find', 'no_receipt_required')
    AND v_tx.marked_method IS DISTINCT FROM 'manual';

  IF v_status_updated THEN
    UPDATE public.receipt_transactions
    SET status = 'completed',
        receipt_required = false,
        marked_by = NULL,
        marked_by_email = NULL,
        marked_by_name = NULL,
        marked_at = v_now,
        marked_method = 'invoice_attached',
        auto_completed_reason = 'invoice_payment:' || p_invoice_number
    WHERE id = p_transaction_id;
  END IF;

  INSERT INTO public.receipt_transaction_logs (
    transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id, performed_at
  ) VALUES (
    p_transaction_id, v_tx.status,
    CASE WHEN v_status_updated THEN 'completed'::public.receipt_transaction_status ELSE v_tx.status END,
    'invoice_attached',
    format('Invoice %s attached', p_invoice_number), p_initiated_by, NULL, v_now
  );

  RETURN jsonb_build_object(
    'outcome', 'attached',
    'receipt', to_jsonb(v_file),
    'status_updated', v_status_updated,
    'previous_status', v_tx.status::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_receipt_invoice_file(uuid, uuid, text, text, text, bigint, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_receipt_invoice_file(uuid, uuid, text, text, text, bigint, text, boolean, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 10.5 Grants that only row security was holding back (SEC-01)
-- ---------------------------------------------------------------------------

-- Every receipts table has one policy, for the service role. These six also carried table
-- privileges for the browser roles, left from before that policy. Row security already stops
-- any read or write through them; the privileges go so that it is not the only thing that does.
REVOKE ALL ON public.receipt_batches FROM anon, authenticated;
REVOKE ALL ON public.receipt_files FROM anon, authenticated;
REVOKE ALL ON public.receipt_rules FROM anon, authenticated;
REVOKE ALL ON public.receipt_transaction_logs FROM anon, authenticated;
REVOKE ALL ON public.receipt_transactions FROM anon, authenticated;
REVOKE ALL ON public.receipt_upload_intents FROM anon, authenticated;

-- Reporting functions the app calls with the service role. They run as the caller, so the
-- browser roles got nothing back from them; they could still call them.
REVOKE ALL ON FUNCTION public.get_receipt_monthly_category_breakdown(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_monthly_category_breakdown(integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_receipt_monthly_status_counts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_monthly_status_counts(integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_receipt_vendor_trends(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_trends(integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_ai_usage_breakdown() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_usage_breakdown() TO service_role;
REVOKE ALL ON FUNCTION public.get_openai_usage_total() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_openai_usage_total() TO service_role;

-- `get_receipt_detail_groups` had two forms. The three-argument one is the four-argument one
-- with its last argument left at the default, and nothing calls it by position. It goes, so a
-- call with three named arguments has one function to find.
DROP FUNCTION IF EXISTS public.get_receipt_detail_groups(integer, text[], boolean);

COMMIT;
