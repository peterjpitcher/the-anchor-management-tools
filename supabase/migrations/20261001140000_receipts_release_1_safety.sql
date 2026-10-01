-- Receipts Release 1: safety (tasks/spec-2026-10-01-receipts-section-review.md, section 5).
--
-- Additive only. Wider CHECK lists, one changed column default and three new functions. Nothing is
-- dropped and no row is changed, so the code deployed before this migration keeps working.
--
--   5.2  The reference-free invoice pairing writes match status 'vendor_amount_matched', which the
--        CHECK rejected: the job failed on 26 August and 1 October 2026 and the provenance was lost.
--   5.0  Invoice pairing records its own source ('invoice') instead of claiming to be a rule.
--   5.4  A new rule leaves the payment pending unless a closing outcome is chosen.
--   5.3  Completing an upload is one locked transaction, so two completions of one upload cannot
--        delete each other's file.

BEGIN;

ALTER TABLE public.receipt_invoice_matches
  DROP CONSTRAINT receipt_invoice_matches_match_status_check;
ALTER TABLE public.receipt_invoice_matches
  ADD CONSTRAINT receipt_invoice_matches_match_status_check CHECK (
    match_status = ANY (ARRAY[
      'matched'::text,
      'payment_recorded'::text,
      'already_paid'::text,
      'missing_invoice'::text,
      'multiple_invoice_refs'::text,
      'amount_mismatch'::text,
      'review_required'::text,
      'vendor_amount_matched'::text
    ])
  );

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT receipt_transactions_vendor_source_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_vendor_source_check CHECK (
    vendor_source IS NULL
    OR vendor_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text, 'invoice'::text])
  );

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT receipt_transactions_expense_category_source_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_expense_category_source_check CHECK (
    expense_category_source IS NULL
    OR expense_category_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text, 'invoice'::text])
  );

ALTER TABLE public.receipt_rules
  ALTER COLUMN auto_status SET DEFAULT 'pending'::public.receipt_transaction_status;

-- ---------------------------------------------------------------------------
-- complete_receipt_upload
--
-- Locks the upload intent, then attaches the file, completes the payment, writes the log and marks
-- the intent complete in one transaction. A second call for the same upload waits on the lock and
-- is answered with the file the first call stored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_receipt_upload(
  p_transaction_id uuid,
  p_storage_path text,
  p_user_id uuid,
  p_user_email text,
  p_user_name text,
  p_file_name text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_content_hash text
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
BEGIN
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

  SELECT * INTO v_tx
  FROM public.receipt_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'transaction_not_found');
  END IF;

  INSERT INTO public.receipt_files (
    transaction_id, storage_path, file_name, mime_type, file_size_bytes,
    content_hash, hash_verified_at, uploaded_by
  ) VALUES (
    p_transaction_id, p_storage_path, p_file_name, NULLIF(btrim(COALESCE(p_mime_type, '')), ''),
    p_file_size_bytes::integer,
    p_content_hash, CASE WHEN p_content_hash IS NULL THEN NULL ELSE v_now END, p_user_id
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
    format('Receipt uploaded (%s)', p_file_name), p_user_id, NULL, v_now
  );

  UPDATE public.receipt_upload_intents
  SET completed_at = v_now,
      receipt_file_id = v_file.id
  WHERE id = v_intent.id;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'receipt', to_jsonb(v_file),
    'previous_status', v_tx.status::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- release_receipt_upload_intent
--
-- Decides, under the same lock, whether a stored object may be removed. Only an open intent held
-- by the caller, whose path no file row references, is released. The caller removes the object
-- only when this returns 'released'. A completion that arrives afterwards finds no intent and
-- attaches nothing, so an attached file can never lose its object this way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_receipt_upload_intent(
  p_transaction_id uuid,
  p_storage_path text,
  p_user_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_intent public.receipt_upload_intents%ROWTYPE;
BEGIN
  SELECT * INTO v_intent
  FROM public.receipt_upload_intents
  WHERE transaction_id = p_transaction_id
    AND storage_path = p_storage_path
    AND issued_to = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_issued';
  END IF;

  IF v_intent.completed_at IS NOT NULL THEN
    RETURN 'completed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.receipt_files WHERE storage_path = p_storage_path) THEN
    RETURN 'referenced';
  END IF;

  DELETE FROM public.receipt_upload_intents WHERE id = v_intent.id;
  RETURN 'released';
END;
$$;

REVOKE ALL ON FUNCTION public.release_receipt_upload_intent(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_receipt_upload_intent(uuid, text, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- apply_receipt_invoice_match
--
-- Stores the match record, updates the payment and writes the log rows in one transaction, under a
-- lock on the payment, so the protection rules are judged against the row as it is at the write:
--   status  only pending or can't-find payments move to "no receipt required", and never a
--           pending payment a person reopened;
--   vendor  only where no source is recorded or the source is ai, rule or invoice.
-- A payment id already stored on the match is kept, and a match that recorded a payment is not
-- relabelled "already paid" by a later run.
-- ---------------------------------------------------------------------------
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
    COALESCE(p_allow_status_change, false)
    AND v_tx.status IN ('pending', 'cant_find')
    AND NOT (v_tx.status = 'pending' AND v_tx.marked_method IS NOT DISTINCT FROM 'manual');

  v_vendor_updated :=
    v_vendor_name IS NOT NULL
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
    'previous_status', v_tx.status::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid)
  TO service_role;

COMMIT;
