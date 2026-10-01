-- Rollback for the receipts overhaul, all six migrations together:
--   20261001140000_receipts_release_1_safety.sql
--   20261001150000_receipts_release_2_import.sql
--   20261001160000_receipts_release_3_vendors.sql
--   20261001170000_receipts_release_5_rules.sql
--   20261001180000_receipts_release_4_ai.sql
--   20261001190000_receipts_release_6_files_status_invoices.sql
--
-- Takes the database from "after 20261001190000" back to "before 20261001140000". It is one
-- unit: later migrations replace functions the earlier ones create, so they are not undone
-- one at a time. To undo only part, apply this and then re-apply the migrations to keep.
--
-- Read before running:
--   * The code deployed before the overhaul works against the new schema, so rolling the
--     application back does NOT need this. Prefer that, and a forward fix.
--   * This DROPS columns and tables. Whatever the new screens wrote into them is lost: vendor
--     kinds and merge history, rule runs and their undo records, the lock date, AI attempts,
--     "no category applies" marks, completed reasons, import counts, and the link between a
--     payment and its invoice copy. It does not undo invoice payments recorded, vendors merged
--     or files removed.
--   * It stops, changing nothing, if any payment or match carries a value the old rules do
--     not allow. Those rows must be dealt with by a person first.
--   * The table and function privileges that 20261001190000 took away from anon and
--     authenticated are deliberately NOT given back: nothing used them.

BEGIN;

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad FROM public.receipt_transactions
  WHERE vendor_source IN ('invoice', 'ai_accepted') OR expense_category_source IN ('invoice', 'ai_accepted');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'RECEIPTS_ROLLBACK_BLOCKED: % payments carry a source the old rules do not allow', v_bad;
  END IF;
  SELECT count(*) INTO v_bad FROM public.receipt_invoice_matches WHERE match_status = 'vendor_amount_matched';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'RECEIPTS_ROLLBACK_BLOCKED: % invoice matches carry a status the old rules do not allow', v_bad;
  END IF;
  SELECT count(*) INTO v_bad FROM public.receipt_files WHERE source = 'invoice';
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'RECEIPTS_ROLLBACK_BLOCKED: % invoice copies are attached to payments; remove them through the app first', v_bad;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Functions the overhaul added
-- ---------------------------------------------------------------------------
-- The view goes first: it calls one of them.
DROP VIEW IF EXISTS public.receipt_transaction_vendors;
DROP FUNCTION IF EXISTS public.attach_receipt_invoice_file(uuid, uuid, text, text, text, bigint, text, boolean, uuid);
DROP FUNCTION IF EXISTS public.record_receipt_invoice_payment(uuid, uuid, text, numeric, boolean, numeric, numeric, jsonb, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.count_receipts_completed_without_receipt();
DROP FUNCTION IF EXISTS public.mark_receipt_transaction(uuid, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS public.delete_receipt_file(uuid, uuid);
DROP FUNCTION IF EXISTS public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text, text);
DROP FUNCTION IF EXISTS public.get_receipt_ai_usage();
DROP FUNCTION IF EXISTS public.approve_receipt_rule_category_suggestion(uuid, uuid);
DROP FUNCTION IF EXISTS public.decide_receipt_ai_category(uuid, text, text, boolean, uuid);
DROP FUNCTION IF EXISTS public.undo_receipt_rule_run(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.apply_receipt_rule_run(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.apply_receipt_rule_change(uuid, timestamptz, jsonb, jsonb, uuid);
DROP FUNCTION IF EXISTS public.receipt_payment_holds_fields(uuid, jsonb);
DROP FUNCTION IF EXISTS public.receipt_payment_field_image(uuid, jsonb);
DROP FUNCTION IF EXISTS public.receipt_write_payment_fields(uuid, jsonb);
DROP FUNCTION IF EXISTS public.set_receipts_locked_before(date, uuid);
DROP FUNCTION IF EXISTS public.receipts_locked_before();
DROP FUNCTION IF EXISTS public.get_receipt_vendor_directory();
DROP FUNCTION IF EXISTS public.undo_receipt_vendor_operation(uuid, uuid);
DROP FUNCTION IF EXISTS public.rename_receipt_vendor(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.merge_receipt_vendor(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.resolve_receipt_vendor(text, uuid, boolean, text, text);
DROP FUNCTION IF EXISTS public.receipt_vendor_survivor(uuid);
DROP FUNCTION IF EXISTS public.import_receipt_statement(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.release_receipt_upload_intent(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text);

-- ---------------------------------------------------------------------------
-- Functions that were there before, as they stood on 1 October 2026 (taken from the live
-- database with pg_get_functiondef, checked byte for byte by md5)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_receipt_vendor_monthly_totals(range_months integer DEFAULT NULL::integer)
 RETURNS TABLE(vendor_key text, vendor_label text, month_start date, total_outgoing numeric, total_income numeric, transaction_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH source AS (
    SELECT
      rt.transaction_date,
      COALESCE(NULLIF(BTRIM(rv.canonical_name), ''), NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')) AS vendor_value,
      COALESCE(rv.vendor_key, public.normalize_receipt_vendor_key(COALESCE(NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')))) AS vendor_key,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_vendors rv ON rv.id = rt.vendor_id
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  ), canonical AS (
    SELECT
      vendor_key,
      vendor_value,
      DATE_TRUNC('month', transaction_date)::DATE AS month_start,
      amount_out,
      amount_in
    FROM source
    WHERE vendor_value IS NOT NULL
      AND vendor_key IS NOT NULL
  ), bounds AS (
    SELECT MAX(month_start) AS latest_month
    FROM canonical
  ), filtered AS (
    SELECT canonical.*
    FROM canonical
    CROSS JOIN bounds
    WHERE range_months IS NULL
      OR canonical.month_start >= (
        bounds.latest_month - ((GREATEST(range_months, 1) - 1) || ' months')::INTERVAL
      )::DATE
  ), summarized AS (
    SELECT
      filtered.vendor_key,
      filtered.month_start,
      SUM(filtered.amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(filtered.amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count,
      MIN(filtered.vendor_value) AS vendor_label
    FROM filtered
    GROUP BY filtered.vendor_key, filtered.month_start
  )
  SELECT
    summarized.vendor_key,
    summarized.vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  ORDER BY summarized.vendor_label, summarized.month_start;
$function$;

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_transactions(target_vendor_label text)
 RETURNS TABLE(id uuid, transaction_date date, details text, amount_in numeric, amount_out numeric, status text, vendor_name text, vendor_source text, transaction_type text, expense_category text, expense_category_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH target AS (
    SELECT public.normalize_receipt_vendor_key(target_vendor_label) AS vendor_key
  ), source AS (
    SELECT
      rt.id,
      rt.transaction_date,
      rt.details,
      rt.amount_in,
      rt.amount_out,
      rt.status::TEXT AS status,
      COALESCE(NULLIF(BTRIM(rv.canonical_name), ''), NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')) AS canonical_vendor_name,
      COALESCE(rv.vendor_key, public.normalize_receipt_vendor_key(COALESCE(NULLIF(BTRIM(rr.set_vendor_name), ''), NULLIF(BTRIM(rt.vendor_name), '')))) AS canonical_vendor_key,
      rt.vendor_source,
      rt.transaction_type,
      rt.expense_category,
      rt.expense_category_source,
      rt.created_at
    FROM public.receipt_transactions rt
    LEFT JOIN public.receipt_vendors rv ON rv.id = rt.vendor_id
    LEFT JOIN public.receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  )
  SELECT
    source.id,
    source.transaction_date,
    source.details,
    source.amount_in,
    source.amount_out,
    source.status,
    source.canonical_vendor_name AS vendor_name,
    source.vendor_source,
    source.transaction_type,
    source.expense_category,
    source.expense_category_source
  FROM source
  CROSS JOIN target
  WHERE target.vendor_key IS NOT NULL
    AND source.canonical_vendor_key = target.vendor_key
  ORDER BY source.transaction_date DESC, source.created_at DESC, source.id DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_trends(month_window integer DEFAULT 12)
 RETURNS TABLE(vendor_label text, month_start date, total_outgoing numeric, total_income numeric, transaction_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH source AS (
    SELECT
      rt.transaction_date,
      COALESCE(NULLIF(TRIM(rr.set_vendor_name), ''), NULLIF(TRIM(rt.vendor_name), '')) AS vendor_value,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM receipt_transactions rt
    LEFT JOIN receipt_rules rr ON rr.id = rt.vendor_rule_id
    WHERE rt.transaction_date IS NOT NULL
  ), canonical AS (
    SELECT
      LOWER(REGEXP_REPLACE(vendor_value, '\\s+', ' ', 'g')) AS vendor_key,
      vendor_value,
      date_trunc('month', transaction_date)::DATE AS month_start,
      amount_out,
      amount_in
    FROM source
    WHERE vendor_value IS NOT NULL
  ), filtered AS (
    SELECT *
    FROM canonical
    WHERE month_start >= (date_trunc('month', NOW())::date - ((GREATEST(month_window, 1) - 1) || ' months')::interval)
  ), summarized AS (
    SELECT
      vendor_key,
      month_start,
      SUM(amount_out)::NUMERIC(14, 2) AS total_outgoing,
      SUM(amount_in)::NUMERIC(14, 2) AS total_income,
      COUNT(*) AS transaction_count,
      MIN(vendor_value) AS vendor_label
    FROM filtered
    GROUP BY vendor_key, month_start
  )
  SELECT
    summarized.vendor_label,
    summarized.month_start,
    summarized.total_outgoing,
    summarized.total_income,
    summarized.transaction_count
  FROM summarized
  ORDER BY summarized.vendor_label, summarized.month_start;
$function$;

CREATE OR REPLACE FUNCTION public.apply_receipt_group_classification_atomic(p_details text, p_statuses receipt_transaction_status[], p_vendor_provided boolean, p_vendor_id uuid, p_vendor_name text, p_expense_provided boolean, p_expense_category text, p_user_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_now timestamptz := now();
  v_updated integer := 0;
  v_skipped_incoming integer := 0;
  v_is_incoming_only boolean;
  v_should_update boolean;
  v_new_vendor_id uuid;
  v_new_vendor_name text;
  v_new_expense_category text;
BEGIN
  IF NOT p_vendor_provided AND NOT p_expense_provided THEN
    RAISE EXCEPTION 'Nothing to update';
  END IF;

  FOR v_row IN
    SELECT
      id,
      status,
      amount_in,
      amount_out,
      vendor_id,
      vendor_name,
      vendor_source,
      vendor_rule_id,
      vendor_updated_at,
      expense_category
    FROM public.receipt_transactions
    WHERE details = p_details
      AND status = ANY(p_statuses)
    FOR UPDATE
  LOOP
    v_is_incoming_only := COALESCE(v_row.amount_in, 0) > 0 AND NOT (COALESCE(v_row.amount_out, 0) > 0);
    IF p_expense_provided AND v_is_incoming_only THEN
      v_skipped_incoming := v_skipped_incoming + 1;
    END IF;

    v_should_update := p_vendor_provided OR (p_expense_provided AND NOT v_is_incoming_only);
    IF NOT v_should_update THEN
      CONTINUE;
    END IF;

    v_new_vendor_id := CASE WHEN p_vendor_provided THEN p_vendor_id ELSE v_row.vendor_id END;
    v_new_vendor_name := CASE WHEN p_vendor_provided THEN p_vendor_name ELSE v_row.vendor_name END;
    v_new_expense_category := CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN p_expense_category ELSE v_row.expense_category END;

    UPDATE public.receipt_transactions
    SET updated_at = v_now,
        vendor_id = CASE WHEN p_vendor_provided THEN p_vendor_id ELSE vendor_id END,
        vendor_name = CASE WHEN p_vendor_provided THEN p_vendor_name ELSE vendor_name END,
        vendor_source = CASE WHEN p_vendor_provided THEN CASE WHEN p_vendor_name IS NULL THEN NULL ELSE 'manual' END ELSE vendor_source END,
        vendor_rule_id = CASE WHEN p_vendor_provided THEN NULL ELSE vendor_rule_id END,
        vendor_updated_at = CASE WHEN p_vendor_provided THEN v_now ELSE vendor_updated_at END,
        expense_category = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN p_expense_category ELSE expense_category END,
        expense_category_source = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN CASE WHEN p_expense_category IS NULL THEN NULL ELSE 'manual' END ELSE expense_category_source END,
        expense_rule_id = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN NULL ELSE expense_rule_id END,
        expense_updated_at = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN v_now ELSE expense_updated_at END
    WHERE id = v_row.id;

    INSERT INTO public.receipt_transaction_logs (
      transaction_id,
      previous_status,
      new_status,
      action_type,
      note,
      performed_by,
      rule_id,
      performed_at
    )
    VALUES (
      v_row.id,
      v_row.status,
      v_row.status,
      'bulk_classification',
      p_note,
      p_user_id,
      NULL,
      v_now
    );

    INSERT INTO public.receipt_classification_signals (
      transaction_id,
      source,
      signal_type,
      prior_vendor_id,
      new_vendor_id,
      prior_vendor_name,
      new_vendor_name,
      prior_expense_category,
      new_expense_category,
      prior_status,
      new_status,
      rule_id,
      ai_confidence,
      performed_by,
      performed_at,
      payload
    )
    VALUES (
      v_row.id,
      'human',
      'bulk_classification',
      v_row.vendor_id,
      v_new_vendor_id,
      v_row.vendor_name,
      v_new_vendor_name,
      v_row.expense_category,
      v_new_expense_category,
      v_row.status,
      v_row.status,
      NULL,
      NULL,
      p_user_id,
      v_now,
      jsonb_build_object('note', p_note)
    );

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'updated', v_updated,
    'skippedIncomingCount', v_skipped_incoming
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_receipt_detail_groups(limit_groups integer DEFAULT 10, include_statuses text[] DEFAULT ARRAY['pending'::text], only_unclassified boolean DEFAULT true, use_fuzzy_grouping boolean DEFAULT false)
 RETURNS TABLE(details text, transaction_ids text[], transaction_count bigint, needs_vendor_count bigint, needs_expense_count bigint, total_in numeric, total_out numeric, first_date date, last_date date, dominant_vendor text, dominant_expense text, sample_transaction jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH grouped AS (
    SELECT
      CASE WHEN use_fuzzy_grouping
        THEN public.normalize_receipt_details(rt.details)
        ELSE rt.details
      END AS group_key,
      rt.id,
      rt.details,
      rt.transaction_date,
      rt.amount_in,
      rt.amount_out,
      rt.vendor_name,
      rt.vendor_source,
      rt.expense_category,
      rt.expense_category_source,
      rt.transaction_type
    FROM public.receipt_transactions rt
    WHERE rt.status::TEXT = ANY(include_statuses)
      AND (
        NOT only_unclassified
        OR rt.vendor_name IS NULL
        OR rt.expense_category IS NULL
      )
  ),
  aggregated AS (
    SELECT
      g.group_key AS grp_details,
      ARRAY_AGG(g.id::TEXT ORDER BY g.transaction_date DESC) AS grp_ids,
      COUNT(*)::BIGINT AS grp_count,
      COUNT(*) FILTER (WHERE g.vendor_name IS NULL)::BIGINT AS grp_needs_vendor,
      COUNT(*) FILTER (WHERE g.expense_category IS NULL AND g.amount_out > 0)::BIGINT AS grp_needs_expense,
      SUM(COALESCE(g.amount_in, 0)) AS grp_total_in,
      SUM(COALESCE(g.amount_out, 0)) AS grp_total_out,
      MIN(g.transaction_date) AS grp_first_date,
      MAX(g.transaction_date) AS grp_last_date,
      (
        SELECT g2.vendor_name
        FROM grouped g2
        WHERE g2.group_key = g.group_key
          AND g2.vendor_name IS NOT NULL
        GROUP BY g2.vendor_name
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS grp_dominant_vendor,
      (
        SELECT g2.expense_category
        FROM grouped g2
        WHERE g2.group_key = g.group_key
          AND g2.expense_category IS NOT NULL
        GROUP BY g2.expense_category
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS grp_dominant_expense,
      (
        SELECT jsonb_build_object(
          'id', g2.id,
          'transaction_date', g2.transaction_date,
          'transaction_type', g2.transaction_type,
          'amount_in', g2.amount_in,
          'amount_out', g2.amount_out,
          'vendor_name', g2.vendor_name,
          'vendor_source', g2.vendor_source,
          'expense_category', g2.expense_category,
          'expense_category_source', g2.expense_category_source
        )
        FROM grouped g2
        WHERE g2.group_key = g.group_key
        ORDER BY g2.transaction_date DESC
        LIMIT 1
      ) AS grp_sample
    FROM grouped g
    WHERE g.group_key IS NOT NULL
      AND g.group_key <> ''
    GROUP BY g.group_key
  )
  SELECT
    a.grp_details,
    a.grp_ids,
    a.grp_count,
    a.grp_needs_vendor,
    a.grp_needs_expense,
    a.grp_total_in,
    a.grp_total_out,
    a.grp_first_date,
    a.grp_last_date,
    a.grp_dominant_vendor,
    a.grp_dominant_expense,
    a.grp_sample
  FROM aggregated a
  ORDER BY a.grp_count DESC
  LIMIT limit_groups;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_receipt_detail_groups(limit_groups integer DEFAULT 100, include_statuses text[] DEFAULT ARRAY['pending'::text, 'auto_completed'::text, 'completed'::text, 'no_receipt_required'::text, 'cant_find'::text], only_unclassified boolean DEFAULT true)
 RETURNS TABLE(details text, transaction_ids uuid[], transaction_count bigint, needs_vendor_count bigint, needs_expense_count bigint, total_in numeric, total_out numeric, first_date date, last_date date, dominant_vendor text, dominant_expense text, sample_transaction jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH filtered AS (
    SELECT *
    FROM receipt_transactions
    WHERE details IS NOT NULL
      AND details <> ''
      AND (include_statuses IS NULL OR status::text = ANY(include_statuses))
      AND (
        NOT only_unclassified
        OR (
          (vendor_name IS NULL OR btrim(vendor_name) = '')
          AND expense_category IS NULL
        )
      )
  ), grouped AS (
    SELECT
      details,
      ARRAY_AGG(id ORDER BY transaction_date DESC) AS transaction_ids,
      COUNT(*) AS transaction_count,
      COUNT(*) FILTER (WHERE vendor_name IS NULL OR btrim(vendor_name) = '') AS needs_vendor_count,
      COUNT(*) FILTER (WHERE expense_category IS NULL) AS needs_expense_count,
      SUM(COALESCE(amount_in, 0))::NUMERIC(14, 2) AS total_in,
      SUM(COALESCE(amount_out, 0))::NUMERIC(14, 2) AS total_out,
      MIN(transaction_date)::DATE AS first_date,
      MAX(transaction_date)::DATE AS last_date,
      MODE() WITHIN GROUP (ORDER BY vendor_name) FILTER (WHERE vendor_name IS NOT NULL AND btrim(vendor_name) <> '') AS dominant_vendor,
      MODE() WITHIN GROUP (ORDER BY expense_category) FILTER (WHERE expense_category IS NOT NULL) AS dominant_expense,
      (
        SELECT jsonb_build_object(
          'id', t.id,
          'transaction_date', t.transaction_date,
          'transaction_type', t.transaction_type,
          'amount_in', t.amount_in,
          'amount_out', t.amount_out,
          'vendor_name', t.vendor_name,
          'vendor_source', t.vendor_source,
          'expense_category', t.expense_category,
          'expense_category_source', t.expense_category_source
        )
        FROM filtered t
        WHERE t.details = rt.details
        ORDER BY
          CASE
            WHEN (t.vendor_name IS NULL OR btrim(t.vendor_name) = '') AND t.expense_category IS NULL THEN 0
            WHEN (t.vendor_name IS NULL OR btrim(t.vendor_name) = '') OR t.expense_category IS NULL THEN 1
            ELSE 2
          END,
          t.transaction_date DESC
        LIMIT 1
      ) AS sample_transaction
    FROM filtered rt
    GROUP BY details
    ORDER BY transaction_count DESC, details ASC
    LIMIT GREATEST(limit_groups, 1)
  )
  SELECT * FROM grouped;
$function$;

REVOKE ALL ON FUNCTION public.get_receipt_detail_groups(integer, text[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_detail_groups(integer, text[], boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Tables, indexes, columns
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.receipt_ai_attempts;
DROP TABLE IF EXISTS public.receipt_rule_run_changes;
DROP TABLE IF EXISTS public.receipt_rule_runs;
DROP TABLE IF EXISTS public.receipt_settings;
DROP TABLE IF EXISTS public.receipt_vendor_operations;

DROP INDEX IF EXISTS public.receipt_files_transaction_invoice_unique;
DROP INDEX IF EXISTS public.idx_receipt_files_content_hash;
DROP INDEX IF EXISTS public.ux_receipt_batches_completed_file;
DROP INDEX IF EXISTS public.idx_receipt_vendor_watchlist_vendor_id;
DROP INDEX IF EXISTS public.idx_receipt_vendor_reviews_vendor_id;
DROP INDEX IF EXISTS public.idx_receipt_vendors_merged_into;

ALTER TABLE public.receipt_files
  DROP CONSTRAINT IF EXISTS receipt_files_source_check,
  DROP COLUMN IF EXISTS invoice_id,
  DROP COLUMN IF EXISTS source;

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT IF EXISTS receipt_transactions_completed_reason_length,
  DROP CONSTRAINT IF EXISTS receipt_transactions_no_category_consistent,
  DROP COLUMN IF EXISTS completed_reason,
  DROP COLUMN IF EXISTS no_category_applies;

ALTER TABLE public.receipt_rules
  DROP CONSTRAINT IF EXISTS receipt_rules_no_category_consistent,
  DROP COLUMN IF EXISTS set_no_category;

ALTER TABLE public.receipt_vendor_watchlist DROP COLUMN IF EXISTS vendor_id;
ALTER TABLE public.receipt_vendor_reviews DROP COLUMN IF EXISTS vendor_id;

ALTER TABLE public.receipt_vendors
  DROP CONSTRAINT IF EXISTS receipt_vendors_kind_check,
  DROP CONSTRAINT IF EXISTS receipt_vendors_origin_check,
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS origin;

ALTER TABLE public.receipt_batches
  DROP CONSTRAINT IF EXISTS receipt_batches_status_check,
  DROP CONSTRAINT IF EXISTS receipt_batches_followup_status_check,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS records_in_file,
  DROP COLUMN IF EXISTS inserted_count,
  DROP COLUMN IF EXISTS duplicate_count,
  DROP COLUMN IF EXISTS rejected_count,
  DROP COLUMN IF EXISTS rejected_records,
  DROP COLUMN IF EXISTS repeated_in_file,
  DROP COLUMN IF EXISTS followup_status,
  DROP COLUMN IF EXISTS followup_state,
  DROP COLUMN IF EXISTS followup_error,
  DROP COLUMN IF EXISTS followup_completed_at;

-- ---------------------------------------------------------------------------
-- The three CHECK lists and the rule default, as they stood
-- ---------------------------------------------------------------------------
ALTER TABLE public.receipt_invoice_matches
  DROP CONSTRAINT receipt_invoice_matches_match_status_check;
ALTER TABLE public.receipt_invoice_matches
  ADD CONSTRAINT receipt_invoice_matches_match_status_check CHECK (
    match_status = ANY (ARRAY['matched'::text, 'payment_recorded'::text, 'already_paid'::text, 'missing_invoice'::text, 'multiple_invoice_refs'::text, 'amount_mismatch'::text, 'review_required'::text])
  );

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT receipt_transactions_vendor_source_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_vendor_source_check CHECK (
    vendor_source IS NULL OR vendor_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text])
  );

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT receipt_transactions_expense_category_source_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_expense_category_source_check CHECK (
    expense_category_source IS NULL OR expense_category_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text])
  );

ALTER TABLE public.receipt_rules
  ALTER COLUMN auto_status SET DEFAULT 'no_receipt_required'::public.receipt_transaction_status;

COMMIT;
