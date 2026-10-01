-- Receipts Release 5: rules management (tasks/spec-2026-10-01-receipts-section-review.md, section 9).
--
-- Additive. Three new tables and new functions. Nothing existing is changed, dropped or
-- deleted, and the code deployed before this migration neither reads nor writes any of it.
--
--   9.2 item 1  A run over history applies exactly what its preview showed: the preview is
--               stored with each payment's version, and the run stops if the rules or the
--               lock date have changed since.
--   9.2 item 2  Every change a rule makes is written together with the values it replaced,
--               in one transaction, so a change without history cannot exist. A run can be
--               undone: only payments still holding the applied values are put back.
--   9.2 item 3  A lock date. Payments dated on or before it are left alone by every
--               automatic or bulk writer.
--
-- The functions run as the caller (SECURITY INVOKER) and are granted to the service role only.

BEGIN;

-- ---------------------------------------------------------------------------
-- Settings for the receipts section
-- ---------------------------------------------------------------------------
-- Not system_settings: that table can be written by any manager through its row policies, and
-- the lock date must only move when a super admin moves it through the app.

CREATE TABLE IF NOT EXISTS public.receipt_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.receipt_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.receipt_settings TO service_role;

-- Payments dated on or before this are locked. Null when no lock is set.
CREATE OR REPLACE FUNCTION public.receipts_locked_before()
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  SELECT NULLIF(value->>'date', '')::date FROM public.receipt_settings WHERE key = 'locked_before';
$$;

REVOKE ALL ON FUNCTION public.receipts_locked_before() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipts_locked_before() TO service_role;

CREATE OR REPLACE FUNCTION public.set_receipts_locked_before(p_date date, p_user uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_previous date;
BEGIN
  -- Serialised, so two people setting it at once leave one clear answer.
  PERFORM pg_advisory_xact_lock(hashtextextended('receipts:locked_before', 0));
  v_previous := public.receipts_locked_before();

  INSERT INTO public.receipt_settings (key, value, updated_by, updated_at)
  VALUES ('locked_before', jsonb_build_object('date', p_date), p_user, now())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('previous', v_previous, 'current', p_date);
END;
$$;

REVOKE ALL ON FUNCTION public.set_receipts_locked_before(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_receipts_locked_before(date, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Runs and their changes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.receipt_rule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A rule run over history, a bulk change to a group, or accepting a set of AI suggestions.
  kind text NOT NULL DEFAULT 'rule_run'
    CHECK (kind = ANY (ARRAY['rule_run'::text, 'bulk_apply'::text, 'ai_accept_all'::text])),
  rule_id uuid REFERENCES public.receipt_rules(id) ON DELETE SET NULL,
  label text,
  scope text NOT NULL DEFAULT 'pending' CHECK (scope = ANY (ARRAY['pending'::text, 'all'::text])),
  -- What the preview was worked out from. A run stops if any of these has moved.
  rule_updated_at timestamptz,
  ruleset_updated_at timestamptz,
  ruleset_count integer,
  lock_date date,
  -- drafting: the preview is still being written. previewed: ready to apply.
  status text NOT NULL DEFAULT 'drafting'
    CHECK (status = ANY (ARRAY['drafting'::text, 'previewed'::text, 'running'::text, 'completed'::text, 'stopped'::text, 'undone'::text])),
  stop_reason text,
  reviewed_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  protected_count integer NOT NULL DEFAULT 0,
  locked_count integer NOT NULL DEFAULT 0,
  planned_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  skipped_changed_count integer NOT NULL DEFAULT 0,
  skipped_locked_count integer NOT NULL DEFAULT 0,
  undone_count integer NOT NULL DEFAULT 0,
  undo_conflict_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  undone_by uuid,
  undone_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_receipt_rule_runs_recent ON public.receipt_rule_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_rule_runs_rule ON public.receipt_rule_runs (rule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.receipt_rule_run_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.receipt_rule_runs(id) ON DELETE CASCADE,
  transaction_id uuid NOT NULL REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  -- The payment's version when the preview was made. A payment that has moved on is skipped.
  expected_updated_at timestamptz NOT NULL,
  -- The fields to write, and (once applied) what they held before.
  after jsonb NOT NULL,
  before jsonb,
  -- History rows to write with the change: [{action_type, note, rule_id}].
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'planned'
    CHECK (state = ANY (ARRAY['planned'::text, 'applied'::text, 'skipped_changed'::text, 'skipped_locked'::text, 'undone'::text, 'undo_conflict'::text])),
  applied_at timestamptz,
  undone_at timestamptz,
  CONSTRAINT receipt_rule_run_changes_once UNIQUE (run_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_receipt_rule_run_changes_state ON public.receipt_rule_run_changes (run_id, state);
CREATE INDEX IF NOT EXISTS idx_receipt_rule_run_changes_transaction ON public.receipt_rule_run_changes (transaction_id);

ALTER TABLE public.receipt_rule_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_rule_run_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_rule_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.receipt_rule_run_changes FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.receipt_rule_runs TO service_role;
GRANT ALL ON public.receipt_rule_run_changes TO service_role;

-- ---------------------------------------------------------------------------
-- Writing fields onto a payment
-- ---------------------------------------------------------------------------

-- Writes the fields named in p_fields onto one payment. A key that is present is written, even
-- when its value is null; a key that is absent is left alone. Only the columns listed here can
-- be written this way.
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
    expense_category_source = CASE WHEN p_fields ? 'expense_category_source' THEN p_fields->>'expense_category_source' ELSE t.expense_category_source END,
    expense_rule_id = CASE WHEN p_fields ? 'expense_rule_id' THEN NULLIF(p_fields->>'expense_rule_id', '')::uuid ELSE t.expense_rule_id END,
    expense_updated_at = CASE WHEN p_fields ? 'expense_updated_at' THEN NULLIF(p_fields->>'expense_updated_at', '')::timestamptz ELSE t.expense_updated_at END
  WHERE t.id = p_transaction_id;
$$;

-- What the fields named in p_fields hold on the payment now.
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
      'expense_category', 'expense_category_source', 'expense_rule_id', 'expense_updated_at'
    ]);
$$;

-- Whether the payment still holds what a change wrote. Only the fields that say what the
-- payment is are compared; the timestamps that travel with them are not.
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
      'expense_category', 'expense_category_source', 'expense_rule_id'
    ]);
$$;

REVOKE ALL ON FUNCTION public.receipt_write_payment_fields(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipt_payment_field_image(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.receipt_payment_holds_fields(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_write_payment_fields(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.receipt_payment_field_image(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.receipt_payment_holds_fields(uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- One change, with its history, in one transaction
-- ---------------------------------------------------------------------------

-- Used by the rule engine for everything that is not part of a recorded run: the work after an
-- import and the refresh of pending payments. The payment is written only if it is still as it
-- was read, and its history rows are written in the same transaction.
--   'applied'    written
--   'changed'    someone else changed the payment first; nothing written
--   'locked'     the payment is dated on or before the lock date; nothing written
--   'not_found'  no such payment
CREATE OR REPLACE FUNCTION public.apply_receipt_rule_change(
  p_transaction_id uuid,
  p_expected_updated_at timestamptz,
  p_after jsonb,
  p_logs jsonb DEFAULT '[]'::jsonb,
  p_performed_by uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_updated_at timestamptz;
  v_date date;
  v_previous_status public.receipt_transaction_status;
  v_new_status public.receipt_transaction_status;
  v_lock date := public.receipts_locked_before();
BEGIN
  SELECT updated_at, transaction_date, status INTO v_updated_at, v_date, v_previous_status
  FROM public.receipt_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN 'changed';
  END IF;
  IF v_lock IS NOT NULL AND v_date <= v_lock THEN
    RETURN 'locked';
  END IF;

  PERFORM public.receipt_write_payment_fields(p_transaction_id, p_after);
  SELECT status INTO v_new_status FROM public.receipt_transactions WHERE id = p_transaction_id;

  INSERT INTO public.receipt_transaction_logs (transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id)
  SELECT p_transaction_id, v_previous_status, v_new_status, entry->>'action_type', entry->>'note', p_performed_by,
         NULLIF(entry->>'rule_id', '')::uuid
  FROM jsonb_array_elements(COALESCE(p_logs, '[]'::jsonb)) entry
  WHERE COALESCE(entry->>'action_type', '') <> '';

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_receipt_rule_change(uuid, timestamptz, jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_receipt_rule_change(uuid, timestamptz, jsonb, jsonb, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Applying a previewed run
-- ---------------------------------------------------------------------------

-- Applies up to p_limit of a run's planned changes and says how many are left, so a long run
-- is done in steps. Each change is written with what it replaced. The run stops, changing
-- nothing more, if the rule, any other rule or the lock date has changed since the preview.
CREATE OR REPLACE FUNCTION public.apply_receipt_rule_run(
  p_run_id uuid,
  p_user uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_run public.receipt_rule_runs%ROWTYPE;
  v_change public.receipt_rule_run_changes%ROWTYPE;
  v_rule_updated_at timestamptz;
  v_rule_active boolean;
  v_ruleset_updated_at timestamptz;
  v_ruleset_count integer;
  v_lock date := public.receipts_locked_before();
  v_updated_at timestamptz;
  v_date date;
  v_previous_status public.receipt_transaction_status;
  v_new_status public.receipt_transaction_status;
  v_before jsonb;
  v_applied integer := 0;
  v_skipped_changed integer := 0;
  v_skipped_locked integer := 0;
  v_remaining integer;
  v_stop text;
BEGIN
  SELECT * INTO v_run FROM public.receipt_rule_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_run.status = 'drafting' THEN
    RETURN jsonb_build_object('outcome', 'not_ready');
  END IF;
  IF v_run.status = 'stopped' THEN
    RETURN jsonb_build_object('outcome', 'stale_preview', 'reason', v_run.stop_reason);
  END IF;
  IF v_run.status IN ('completed', 'undone') THEN
    RETURN jsonb_build_object(
      'outcome', CASE WHEN v_run.status = 'completed' THEN 'completed' ELSE 'undone' END,
      'applied', 0, 'skipped_changed', 0, 'skipped_locked', 0, 'remaining', 0,
      'applied_total', v_run.applied_count,
      'skipped_changed_total', v_run.skipped_changed_count,
      'skipped_locked_total', v_run.skipped_locked_count
    );
  END IF;

  -- Still what was previewed?
  IF v_run.kind = 'rule_run' THEN
    SELECT updated_at, is_active INTO v_rule_updated_at, v_rule_active FROM public.receipt_rules WHERE id = v_run.rule_id;
    IF NOT FOUND OR NOT v_rule_active OR v_rule_updated_at IS DISTINCT FROM v_run.rule_updated_at THEN
      v_stop := 'rule_changed';
    END IF;
  END IF;
  IF v_stop IS NULL AND v_run.ruleset_count IS NOT NULL THEN
    SELECT max(updated_at), count(*) INTO v_ruleset_updated_at, v_ruleset_count FROM public.receipt_rules WHERE is_active;
    IF v_ruleset_updated_at IS DISTINCT FROM v_run.ruleset_updated_at OR v_ruleset_count IS DISTINCT FROM v_run.ruleset_count THEN
      v_stop := 'rules_changed';
    END IF;
  END IF;
  IF v_stop IS NULL AND v_lock IS DISTINCT FROM v_run.lock_date THEN
    v_stop := 'lock_date_changed';
  END IF;

  IF v_stop IS NOT NULL THEN
    UPDATE public.receipt_rule_runs SET status = 'stopped', stop_reason = v_stop WHERE id = p_run_id;
    RETURN jsonb_build_object('outcome', 'stale_preview', 'reason', v_stop);
  END IF;

  UPDATE public.receipt_rule_runs
  SET status = 'running', started_at = COALESCE(started_at, now())
  WHERE id = p_run_id;

  FOR v_change IN
    SELECT * FROM public.receipt_rule_run_changes
    WHERE run_id = p_run_id AND state = 'planned'
    ORDER BY id
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
    FOR UPDATE
  LOOP
    SELECT updated_at, transaction_date, status INTO v_updated_at, v_date, v_previous_status
    FROM public.receipt_transactions WHERE id = v_change.transaction_id FOR UPDATE;

    IF NOT FOUND OR v_updated_at IS DISTINCT FROM v_change.expected_updated_at THEN
      UPDATE public.receipt_rule_run_changes SET state = 'skipped_changed' WHERE id = v_change.id;
      v_skipped_changed := v_skipped_changed + 1;
      CONTINUE;
    END IF;
    IF v_lock IS NOT NULL AND v_date <= v_lock THEN
      UPDATE public.receipt_rule_run_changes SET state = 'skipped_locked' WHERE id = v_change.id;
      v_skipped_locked := v_skipped_locked + 1;
      CONTINUE;
    END IF;

    v_before := public.receipt_payment_field_image(v_change.transaction_id, v_change.after);
    PERFORM public.receipt_write_payment_fields(v_change.transaction_id, v_change.after);
    SELECT status INTO v_new_status FROM public.receipt_transactions WHERE id = v_change.transaction_id;

    INSERT INTO public.receipt_transaction_logs (transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id)
    SELECT v_change.transaction_id, v_previous_status, v_new_status, entry->>'action_type', entry->>'note', p_user,
           NULLIF(entry->>'rule_id', '')::uuid
    FROM jsonb_array_elements(v_change.logs) entry
    WHERE COALESCE(entry->>'action_type', '') <> '';

    UPDATE public.receipt_rule_run_changes
    SET state = 'applied', before = v_before, applied_at = now()
    WHERE id = v_change.id;
    v_applied := v_applied + 1;
  END LOOP;

  SELECT count(*) INTO v_remaining FROM public.receipt_rule_run_changes WHERE run_id = p_run_id AND state = 'planned';

  UPDATE public.receipt_rule_runs
  SET applied_count = applied_count + v_applied,
      skipped_changed_count = skipped_changed_count + v_skipped_changed,
      skipped_locked_count = skipped_locked_count + v_skipped_locked,
      status = CASE WHEN v_remaining = 0 THEN 'completed' ELSE 'running' END,
      completed_at = CASE WHEN v_remaining = 0 THEN now() ELSE completed_at END
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_remaining = 0 THEN 'completed' ELSE 'in_progress' END,
    'applied', v_applied,
    'skipped_changed', v_skipped_changed,
    'skipped_locked', v_skipped_locked,
    'remaining', v_remaining,
    'applied_total', v_run.applied_count,
    'skipped_changed_total', v_run.skipped_changed_count,
    'skipped_locked_total', v_run.skipped_locked_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_receipt_rule_run(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_receipt_rule_run(uuid, uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Undoing a run
-- ---------------------------------------------------------------------------

-- Puts back, in steps, what a run changed. A payment is put back only if it still holds what
-- the run wrote and is not behind the lock date; otherwise it is left alone and counted. Calling
-- it again once it has finished changes nothing.
CREATE OR REPLACE FUNCTION public.undo_receipt_rule_run(
  p_run_id uuid,
  p_user uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_run public.receipt_rule_runs%ROWTYPE;
  v_change public.receipt_rule_run_changes%ROWTYPE;
  v_lock date := public.receipts_locked_before();
  v_date date;
  v_previous_status public.receipt_transaction_status;
  v_new_status public.receipt_transaction_status;
  v_restored integer := 0;
  v_conflicts integer := 0;
  v_remaining integer;
BEGIN
  SELECT * INTO v_run FROM public.receipt_rule_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_run.status = 'undone' THEN
    RETURN jsonb_build_object(
      'outcome', 'already_undone', 'restored', 0, 'conflicts', 0, 'remaining', 0,
      'restored_total', v_run.undone_count, 'conflict_total', v_run.undo_conflict_count
    );
  END IF;
  IF v_run.status IN ('drafting', 'previewed') OR v_run.applied_count = 0 THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_undo');
  END IF;

  FOR v_change IN
    SELECT * FROM public.receipt_rule_run_changes
    WHERE run_id = p_run_id AND state = 'applied'
    ORDER BY id
    LIMIT GREATEST(COALESCE(p_limit, 200), 1)
    FOR UPDATE
  LOOP
    SELECT transaction_date, status INTO v_date, v_previous_status
    FROM public.receipt_transactions WHERE id = v_change.transaction_id FOR UPDATE;

    IF NOT FOUND
       OR (v_lock IS NOT NULL AND v_date <= v_lock)
       OR NOT public.receipt_payment_holds_fields(v_change.transaction_id, v_change.after) THEN
      UPDATE public.receipt_rule_run_changes SET state = 'undo_conflict' WHERE id = v_change.id;
      v_conflicts := v_conflicts + 1;
      CONTINUE;
    END IF;

    PERFORM public.receipt_write_payment_fields(v_change.transaction_id, v_change.before);
    SELECT status INTO v_new_status FROM public.receipt_transactions WHERE id = v_change.transaction_id;

    INSERT INTO public.receipt_transaction_logs (transaction_id, previous_status, new_status, action_type, note, performed_by, rule_id)
    VALUES (
      v_change.transaction_id, v_previous_status, v_new_status, 'rule_run_undone',
      format('Run undone%s', CASE WHEN v_run.label IS NOT NULL THEN ': ' || v_run.label ELSE '' END),
      p_user, v_run.rule_id
    );

    UPDATE public.receipt_rule_run_changes SET state = 'undone', undone_at = now() WHERE id = v_change.id;
    v_restored := v_restored + 1;
  END LOOP;

  SELECT count(*) INTO v_remaining FROM public.receipt_rule_run_changes WHERE run_id = p_run_id AND state = 'applied';

  UPDATE public.receipt_rule_runs
  SET undone_count = undone_count + v_restored,
      undo_conflict_count = undo_conflict_count + v_conflicts,
      status = CASE WHEN v_remaining = 0 THEN 'undone' ELSE status END,
      undone_at = CASE WHEN v_remaining = 0 THEN now() ELSE undone_at END,
      undone_by = CASE WHEN v_remaining = 0 THEN p_user ELSE undone_by END
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_remaining = 0 THEN 'undone' ELSE 'in_progress' END,
    'restored', v_restored,
    'conflicts', v_conflicts,
    'remaining', v_remaining,
    'restored_total', v_run.undone_count,
    'conflict_total', v_run.undo_conflict_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.undo_receipt_rule_run(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_receipt_rule_run(uuid, uuid, integer) TO service_role;

COMMIT;
