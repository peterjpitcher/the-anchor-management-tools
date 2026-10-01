-- Receipts Release 4: AI classification and vendor naming
-- (tasks/spec-2026-10-01-receipts-section-review.md, section 8).
--
-- Additive. One new table, one new column on each of receipt_transactions and receipt_rules,
-- two wider CHECK lists, two new functions, and five functions replaced with bodies that know
-- about the new column. Nothing is dropped or deleted. The code deployed before this migration
-- keeps working: it neither reads nor writes the new column, which defaults to false.
--
-- Apply after 20261001170000 (Release 5): the three field functions replaced here were created
-- there.
--
--   8.2 item 1  One record per payment of what the AI did, so a payment is asked about once.
--   8.2 item 4  A category the AI suggests is a proposal. Accepting it is one transaction that
--               checks the payment is still uncategorised, writes it as `ai_accepted` and
--               closes the proposal. "No category applies" is a real answer, stored as a flag.

BEGIN;

-- ---------------------------------------------------------------------------
-- Sources: a suggestion a person accepted
-- ---------------------------------------------------------------------------
-- `ai_accepted` ranks with `manual`: a person looked at it and said yes.

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT receipt_transactions_vendor_source_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_vendor_source_check CHECK (
    vendor_source IS NULL
    OR vendor_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text, 'invoice'::text, 'ai_accepted'::text])
  );

ALTER TABLE public.receipt_transactions
  DROP CONSTRAINT receipt_transactions_expense_category_source_check;
ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_expense_category_source_check CHECK (
    expense_category_source IS NULL
    OR expense_category_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text, 'invoice'::text, 'ai_accepted'::text])
  );

-- ---------------------------------------------------------------------------
-- "No category applies"
-- ---------------------------------------------------------------------------
-- Payments such as drawings, tax and the brewery account take no expense category. Until now
-- that looked the same as "nobody has categorised this yet". The flag says it has been decided.

ALTER TABLE public.receipt_transactions
  ADD COLUMN IF NOT EXISTS no_category_applies boolean NOT NULL DEFAULT false;

ALTER TABLE public.receipt_transactions
  ADD CONSTRAINT receipt_transactions_no_category_consistent
  CHECK (NOT no_category_applies OR expense_category IS NULL);

ALTER TABLE public.receipt_rules
  ADD COLUMN IF NOT EXISTS set_no_category boolean NOT NULL DEFAULT false;

ALTER TABLE public.receipt_rules
  ADD CONSTRAINT receipt_rules_no_category_consistent
  CHECK (NOT set_no_category OR set_expense_category IS NULL);

-- ---------------------------------------------------------------------------
-- What the AI did, once per payment and prompt version
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.receipt_ai_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  -- Changing the prompt in a way that could change answers bumps this, and payments are asked again.
  prompt_version text NOT NULL,
  outcome text NOT NULL CHECK (outcome = ANY (ARRAY[
    'vendor_written'::text,      -- the vendor was written onto the payment (a category may have been too)
    'category_written'::text,    -- only a category was written onto the payment
    'category_proposed'::text,   -- only "no category applies" was proposed
    'nothing_identified'::text,  -- the model could not tell
    'low_confidence'::text,      -- it answered below the confidence floor
    'skipped_protected'::text,   -- a person or a rule had decided by the time it answered
    'payroll_local'::text,       -- recognised as a wage payment here, never sent to the model
    'payroll_check'::text,       -- looks like a wage payment but is not certain: for a person to check
    'failed_retryable'::text,    -- the call failed and will be tried again
    'failed_final'::text         -- the call failed and trying again will not help
  ])),
  vendor_id uuid REFERENCES public.receipt_vendors(id) ON DELETE SET NULL,
  vendor_written boolean NOT NULL DEFAULT false,
  proposed_expense_category text,
  proposed_no_category boolean NOT NULL DEFAULT false,
  category_state text NOT NULL DEFAULT 'none' CHECK (category_state = ANY (ARRAY[
    'proposed'::text, 'written'::text, 'accepted'::text, 'edited'::text, 'dismissed'::text, 'superseded'::text, 'none'::text
  ])),
  confidence smallint CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  reasoning text,
  model text,
  error text,
  -- How many times this payment has been asked about under this prompt version.
  tries integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  CONSTRAINT receipt_ai_attempts_once UNIQUE (transaction_id, prompt_version),
  CONSTRAINT receipt_ai_attempts_proposal_consistent CHECK (NOT proposed_no_category OR proposed_expense_category IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_receipt_ai_attempts_open_proposals
  ON public.receipt_ai_attempts (transaction_id) WHERE category_state = 'proposed';
CREATE INDEX IF NOT EXISTS idx_receipt_ai_attempts_outcome
  ON public.receipt_ai_attempts (outcome, prompt_version);
CREATE INDEX IF NOT EXISTS idx_receipt_ai_attempts_vendor
  ON public.receipt_ai_attempts (vendor_id) WHERE vendor_id IS NOT NULL;

ALTER TABLE public.receipt_ai_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_ai_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.receipt_ai_attempts TO service_role;

-- ---------------------------------------------------------------------------
-- The field writers learn the new column
-- ---------------------------------------------------------------------------
-- Same names, arguments and grants as in 20261001170000. `no_category_applies` is added to the
-- fields that can be written, recorded and compared.

CREATE OR REPLACE FUNCTION public.receipt_write_payment_fields(p_transaction_id uuid, p_fields jsonb)
RETURNS void
LANGUAGE sql
SET search_path TO 'public', 'pg_catalog'
AS $$
  UPDATE public.receipt_transactions t
  SET
    status = CASE WHEN p_fields ? 'status' THEN (p_fields->>'status')::public.receipt_transaction_status ELSE t.status END,
    receipt_required = CASE WHEN p_fields ? 'receipt_required' THEN (p_fields->>'receipt_required')::boolean ELSE t.receipt_required END,
    marked_by = CASE WHEN p_fields ? 'marked_by' THEN NULLIF(p_fields->>'marked_by', '')::uuid ELSE t.marked_by END,
    marked_by_email = CASE WHEN p_fields ? 'marked_by_email' THEN p_fields->>'marked_by_email' ELSE t.marked_by_email END,
    marked_by_name = CASE WHEN p_fields ? 'marked_by_name' THEN p_fields->>'marked_by_name' ELSE t.marked_by_name END,
    marked_at = CASE WHEN p_fields ? 'marked_at' THEN NULLIF(p_fields->>'marked_at', '')::timestamptz ELSE t.marked_at END,
    marked_method = CASE WHEN p_fields ? 'marked_method' THEN p_fields->>'marked_method' ELSE t.marked_method END,
    rule_applied_id = CASE WHEN p_fields ? 'rule_applied_id' THEN NULLIF(p_fields->>'rule_applied_id', '')::uuid ELSE t.rule_applied_id END,
    auto_completed_reason = CASE WHEN p_fields ? 'auto_completed_reason' THEN p_fields->>'auto_completed_reason' ELSE t.auto_completed_reason END,
    vendor_id = CASE WHEN p_fields ? 'vendor_id' THEN NULLIF(p_fields->>'vendor_id', '')::uuid ELSE t.vendor_id END,
    vendor_name = CASE WHEN p_fields ? 'vendor_name' THEN p_fields->>'vendor_name' ELSE t.vendor_name END,
    vendor_source = CASE WHEN p_fields ? 'vendor_source' THEN p_fields->>'vendor_source' ELSE t.vendor_source END,
    vendor_rule_id = CASE WHEN p_fields ? 'vendor_rule_id' THEN NULLIF(p_fields->>'vendor_rule_id', '')::uuid ELSE t.vendor_rule_id END,
    vendor_updated_at = CASE WHEN p_fields ? 'vendor_updated_at' THEN NULLIF(p_fields->>'vendor_updated_at', '')::timestamptz ELSE t.vendor_updated_at END,
    expense_category = CASE WHEN p_fields ? 'expense_category' THEN p_fields->>'expense_category' ELSE t.expense_category END,
    no_category_applies = CASE WHEN p_fields ? 'no_category_applies' THEN COALESCE((p_fields->>'no_category_applies')::boolean, false) ELSE t.no_category_applies END,
    expense_category_source = CASE WHEN p_fields ? 'expense_category_source' THEN p_fields->>'expense_category_source' ELSE t.expense_category_source END,
    expense_rule_id = CASE WHEN p_fields ? 'expense_rule_id' THEN NULLIF(p_fields->>'expense_rule_id', '')::uuid ELSE t.expense_rule_id END,
    expense_updated_at = CASE WHEN p_fields ? 'expense_updated_at' THEN NULLIF(p_fields->>'expense_updated_at', '')::timestamptz ELSE t.expense_updated_at END
  WHERE t.id = p_transaction_id;
$$;

CREATE OR REPLACE FUNCTION public.receipt_payment_field_image(p_transaction_id uuid, p_fields jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT COALESCE(jsonb_object_agg(field.key, to_jsonb(t) -> field.key), '{}'::jsonb)
  FROM public.receipt_transactions t
  CROSS JOIN LATERAL jsonb_object_keys(p_fields) AS field(key)
  WHERE t.id = p_transaction_id
    AND field.key = ANY (ARRAY[
      'status', 'receipt_required', 'marked_by', 'marked_by_email', 'marked_by_name', 'marked_at',
      'marked_method', 'rule_applied_id', 'auto_completed_reason',
      'vendor_id', 'vendor_name', 'vendor_source', 'vendor_rule_id', 'vendor_updated_at',
      'expense_category', 'no_category_applies', 'expense_category_source', 'expense_rule_id', 'expense_updated_at'
    ]);
$$;

CREATE OR REPLACE FUNCTION public.receipt_payment_holds_fields(p_transaction_id uuid, p_fields jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT COALESCE(bool_and((to_jsonb(t) -> field.key) IS NOT DISTINCT FROM (p_fields -> field.key)), false)
  FROM public.receipt_transactions t
  CROSS JOIN LATERAL jsonb_object_keys(p_fields) AS field(key)
  WHERE t.id = p_transaction_id
    AND field.key = ANY (ARRAY[
      'status', 'vendor_id', 'vendor_name', 'vendor_source', 'vendor_rule_id',
      'expense_category', 'no_category_applies', 'expense_category_source', 'expense_rule_id'
    ]);
$$;

REVOKE ALL ON FUNCTION public.receipt_write_payment_fields(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipt_payment_field_image(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipt_payment_holds_fields(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_write_payment_fields(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.receipt_payment_field_image(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.receipt_payment_holds_fields(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- Accept, edit or dismiss a suggested category
-- ---------------------------------------------------------------------------

-- One transaction, under a lock on the payment: checks the payment is still uncategorised,
-- writes the category (or the "no category applies" flag) and closes the proposal.
--   accept   writes what was proposed, with source `ai_accepted`
--   edit     writes what the person chose instead (p_category or p_no_category), source `manual`
--   dismiss  writes nothing to the payment
-- Outcomes: accepted, edited, dismissed, no_proposal, already_classified, not_outgoing,
-- invalid, not_found.
CREATE OR REPLACE FUNCTION public.decide_receipt_ai_category(
  p_transaction_id uuid,
  p_decision text,
  p_category text DEFAULT NULL,
  p_no_category boolean DEFAULT false,
  p_user uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_payment public.receipt_transactions%ROWTYPE;
  v_attempt public.receipt_ai_attempts%ROWTYPE;
  v_category text;
  v_none boolean;
  v_source text;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('accept', 'edit', 'dismiss') THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  SELECT * INTO v_payment FROM public.receipt_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT * INTO v_attempt
  FROM public.receipt_ai_attempts
  WHERE transaction_id = p_transaction_id AND category_state = 'proposed'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_proposal');
  END IF;

  IF p_decision = 'dismiss' THEN
    UPDATE public.receipt_ai_attempts
    SET category_state = 'dismissed', reviewed_by = p_user, reviewed_at = now(), updated_at = now()
    WHERE id = v_attempt.id;
    RETURN jsonb_build_object('outcome', 'dismissed');
  END IF;

  -- A rule or a person got there first. The proposal is closed and the payment is left alone.
  IF v_payment.expense_category IS NOT NULL OR v_payment.no_category_applies THEN
    UPDATE public.receipt_ai_attempts
    SET category_state = 'superseded', updated_at = now()
    WHERE id = v_attempt.id;
    RETURN jsonb_build_object('outcome', 'already_classified');
  END IF;

  IF COALESCE(v_payment.amount_out, 0) <= 0 THEN
    RETURN jsonb_build_object('outcome', 'not_outgoing');
  END IF;

  IF p_decision = 'accept' THEN
    v_category := v_attempt.proposed_expense_category;
    v_none := v_attempt.proposed_no_category;
    v_source := 'ai_accepted';
  ELSE
    v_category := NULLIF(BTRIM(COALESCE(p_category, '')), '');
    v_none := COALESCE(p_no_category, false);
    v_source := 'manual';
  END IF;

  IF v_none THEN
    v_category := NULL;
  ELSIF v_category IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid');
  END IF;

  UPDATE public.receipt_transactions
  SET expense_category = v_category,
      no_category_applies = v_none,
      expense_category_source = v_source,
      expense_rule_id = NULL,
      expense_updated_at = now()
  WHERE id = p_transaction_id;

  UPDATE public.receipt_ai_attempts
  SET category_state = CASE WHEN p_decision = 'accept' THEN 'accepted' ELSE 'edited' END,
      reviewed_by = p_user, reviewed_at = now(), updated_at = now()
  WHERE id = v_attempt.id;

  INSERT INTO public.receipt_transaction_logs (transaction_id, previous_status, new_status, action_type, note, performed_by)
  VALUES (
    p_transaction_id, v_payment.status, v_payment.status,
    CASE WHEN p_decision = 'accept' THEN 'ai_category_accepted' ELSE 'ai_category_edited' END,
    CASE
      WHEN v_none THEN 'Expense: no category applies'
      ELSE format('Expense: %s', v_category)
    END || CASE WHEN p_decision = 'accept' THEN ' (suggestion accepted)' ELSE ' (suggestion changed)' END,
    p_user
  );

  RETURN jsonb_build_object(
    'outcome', CASE WHEN p_decision = 'accept' THEN 'accepted' ELSE 'edited' END,
    'expense_category', v_category,
    'no_category_applies', v_none
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decide_receipt_ai_category(uuid, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_receipt_ai_category(uuid, text, text, boolean, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Approving "add this category to the existing rule"
-- ---------------------------------------------------------------------------

-- Some proposals do not ask for a new rule: they ask for a category to be added to a rule that
-- already names the vendor. The rule and the suggestion are changed together.
--   approved          the rule now sets the category
--   not_found         no such suggestion
--   not_pending       it has already been approved or declined
--   rule_unavailable  the rule is gone or switched off
--   rule_has_category the rule sets a different category already
CREATE OR REPLACE FUNCTION public.approve_receipt_rule_category_suggestion(
  p_suggestion_id uuid,
  p_user uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_suggestion public.receipt_rule_suggestions%ROWTYPE;
  v_rule public.receipt_rules%ROWTYPE;
  v_rule_id uuid;
BEGIN
  SELECT * INTO v_suggestion FROM public.receipt_rule_suggestions WHERE id = p_suggestion_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_suggestion.status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'not_pending');
  END IF;

  v_rule_id := NULLIF(v_suggestion.evidence->>'target_rule_id', '')::uuid;
  IF v_rule_id IS NULL OR v_suggestion.set_expense_category IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT * INTO v_rule FROM public.receipt_rules WHERE id = v_rule_id FOR UPDATE;
  IF NOT FOUND OR NOT v_rule.is_active THEN
    RETURN jsonb_build_object('outcome', 'rule_unavailable');
  END IF;
  IF v_rule.set_no_category
     OR (v_rule.set_expense_category IS NOT NULL AND v_rule.set_expense_category <> v_suggestion.set_expense_category) THEN
    RETURN jsonb_build_object('outcome', 'rule_has_category', 'rule_name', v_rule.name);
  END IF;

  -- What the rule does has changed, so it needs looking at again.
  UPDATE public.receipt_rules
  SET set_expense_category = v_suggestion.set_expense_category,
      updated_by = p_user,
      reviewed_at = NULL,
      reviewed_by = NULL
  WHERE id = v_rule_id;

  UPDATE public.receipt_rule_suggestions
  SET status = 'approved', approved_rule_id = v_rule_id, reviewed_at = now(), reviewed_by = p_user
  WHERE id = p_suggestion_id;

  RETURN jsonb_build_object('outcome', 'approved', 'rule_id', v_rule_id, 'rule_name', v_rule.name);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_receipt_rule_category_suggestion(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_receipt_rule_category_suggestion(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Bulk classification clears the flag when it sets a category
-- ---------------------------------------------------------------------------
-- The same function as before with one line added: a payment marked "no category applies"
-- that is then given a category in bulk has the flag cleared, as the new CHECK requires.
-- Clearing the category in bulk clears the flag too.

CREATE OR REPLACE FUNCTION public.apply_receipt_group_classification_atomic(
  p_details text,
  p_statuses public.receipt_transaction_status[],
  p_vendor_provided boolean,
  p_vendor_id uuid,
  p_vendor_name text,
  p_expense_provided boolean,
  p_expense_category text,
  p_user_id uuid,
  p_note text
)
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
        no_category_applies = CASE WHEN p_expense_provided AND NOT v_is_incoming_only THEN false ELSE no_category_applies END,
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

REVOKE ALL ON FUNCTION public.apply_receipt_group_classification_atomic(text, public.receipt_transaction_status[], boolean, uuid, text, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_receipt_group_classification_atomic(text, public.receipt_transaction_status[], boolean, uuid, text, boolean, text, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- The bulk review groups
-- ---------------------------------------------------------------------------
-- "Needs a category" now means a money-out payment with no category that has not been marked
-- "no category applies". A money-in payment never needs one: it used to count as unclassified
-- for ever, whatever its vendor.

CREATE OR REPLACE FUNCTION public.get_receipt_detail_groups(
  limit_groups integer DEFAULT 10,
  include_statuses text[] DEFAULT ARRAY['pending'::text],
  only_unclassified boolean DEFAULT true,
  use_fuzzy_grouping boolean DEFAULT false
)
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
      rt.transaction_type,
      (rt.expense_category IS NULL AND NOT rt.no_category_applies AND COALESCE(rt.amount_out, 0) > 0) AS needs_expense
    FROM public.receipt_transactions rt
    WHERE rt.status::TEXT = ANY(include_statuses)
      AND (
        NOT only_unclassified
        OR rt.vendor_name IS NULL
        OR (rt.expense_category IS NULL AND NOT rt.no_category_applies AND COALESCE(rt.amount_out, 0) > 0)
      )
  ),
  aggregated AS (
    SELECT
      g.group_key AS grp_details,
      ARRAY_AGG(g.id::TEXT ORDER BY g.transaction_date DESC) AS grp_ids,
      COUNT(*)::BIGINT AS grp_count,
      COUNT(*) FILTER (WHERE g.vendor_name IS NULL)::BIGINT AS grp_needs_vendor,
      COUNT(*) FILTER (WHERE g.needs_expense)::BIGINT AS grp_needs_expense,
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

-- The app calls this with the service role. It ran as the caller already; anon could execute it
-- and was stopped only by row security on the table. That grant is removed.
REVOKE ALL ON FUNCTION public.get_receipt_detail_groups(integer, text[], boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_detail_groups(integer, text[], boolean, boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- What the receipts AI has cost
-- ---------------------------------------------------------------------------

-- 8.2 item 11. The receipts tile summed every row of `ai_usage_events`, so it included what
-- recruitment spends, and it printed the US dollar figure with a pound sign. This counts the
-- receipts contexts only (they all begin `receipt_`). The month starts at midnight in London.
CREATE OR REPLACE FUNCTION public.get_receipt_ai_usage()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT jsonb_build_object(
    'currency', 'USD',
    'total_cost', COALESCE(SUM(e.cost), 0),
    'this_month_cost', COALESCE(SUM(e.cost) FILTER (WHERE e.occurred_at >= m.month_start), 0),
    'total_calls', COUNT(*),
    'this_month_calls', COUNT(*) FILTER (WHERE e.occurred_at >= m.month_start)
  )
  FROM public.ai_usage_events e
  CROSS JOIN (
    SELECT date_trunc('month', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' AS month_start
  ) m
  WHERE starts_with(e.context, 'receipt_');
$$;

REVOKE ALL ON FUNCTION public.get_receipt_ai_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_ai_usage() TO service_role;

COMMIT;
