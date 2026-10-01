-- Receipts Release 3: vendors (tasks/spec-2026-10-01-receipts-section-review.md, section 7).
--
-- Additive. Two columns on receipt_vendors, one on each of the watchlist and review tables, one
-- new table, one view and new functions. Three reporting functions are replaced with bodies that
-- read the new view; their names, arguments and return columns are unchanged, so the code
-- deployed before this migration keeps working. Nothing is dropped or deleted.
--
--   7.2 item 2  One resolver: a name or an id always comes back as the surviving vendor.
--   7.2 item 3  Merge and rename, each in one transaction, each leaving a record of every value
--               it replaced, and an undo that puts back only what still holds the applied value.
--   7.2 item 6  One view gives every payment its surviving vendor, and the reports read it.
--
-- The new functions run as the caller (SECURITY INVOKER) and are granted to the service role
-- only. They need no more than the service role already has, so there is nothing to elevate.

BEGIN;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.receipt_vendors
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.receipt_vendors
  ADD CONSTRAINT receipt_vendors_kind_check
  CHECK (kind = ANY (ARRAY['business'::text, 'person'::text]));

-- Where the vendor came from. Vendors that exist today were created as a side effect of saving
-- a name, with no record of who or what did it, so they stay 'unknown'.
ALTER TABLE public.receipt_vendors
  ADD CONSTRAINT receipt_vendors_origin_check
  CHECK (origin = ANY (ARRAY['unknown'::text, 'manual'::text, 'rule'::text, 'invoice'::text, 'ai'::text, 'payroll'::text]));

-- Watch entries and reviews were keyed on the vendor's text alone. They keep that key, which the
-- reports use, and gain the vendor itself so a merge or rename can carry them along.
ALTER TABLE public.receipt_vendor_watchlist
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.receipt_vendors(id) ON DELETE SET NULL;

ALTER TABLE public.receipt_vendor_reviews
  ADD COLUMN IF NOT EXISTS vendor_id uuid REFERENCES public.receipt_vendors(id) ON DELETE SET NULL;

UPDATE public.receipt_vendor_watchlist w
SET vendor_id = v.id
FROM public.receipt_vendors v
WHERE w.vendor_id IS NULL AND v.vendor_key = w.vendor_key;

UPDATE public.receipt_vendor_reviews r
SET vendor_id = v.id
FROM public.receipt_vendors v
WHERE r.vendor_id IS NULL AND v.vendor_key = r.vendor_key;

CREATE INDEX IF NOT EXISTS idx_receipt_vendor_watchlist_vendor_id ON public.receipt_vendor_watchlist (vendor_id);
CREATE INDEX IF NOT EXISTS idx_receipt_vendor_reviews_vendor_id ON public.receipt_vendor_reviews (vendor_id);
CREATE INDEX IF NOT EXISTS idx_receipt_vendors_merged_into ON public.receipt_vendors (merged_into_vendor_id) WHERE merged_into_vendor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The record of each merge and rename
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.receipt_vendor_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL CHECK (operation = ANY (ARRAY['merge'::text, 'rename'::text])),
  -- The vendor that survives a merge, or the vendor that was renamed.
  vendor_id uuid NOT NULL REFERENCES public.receipt_vendors(id) ON DELETE CASCADE,
  -- The vendor that was merged away. Null for a rename.
  source_vendor_id uuid REFERENCES public.receipt_vendors(id) ON DELETE CASCADE,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now(),
  -- Counts and the values the operation wrote, for the screen and for undo.
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Every value the operation replaced, row by row.
  before_image jsonb NOT NULL DEFAULT '{}'::jsonb,
  undone_at timestamptz,
  undone_by uuid,
  undo_result jsonb
);

CREATE INDEX IF NOT EXISTS idx_receipt_vendor_operations_vendor ON public.receipt_vendor_operations (vendor_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_vendor_operations_recent ON public.receipt_vendor_operations (performed_at DESC);

-- Row security on with no policy: only the service role, which bypasses it, can read or write.
ALTER TABLE public.receipt_vendor_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.receipt_vendor_operations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.receipt_vendor_operations TO service_role;

-- ---------------------------------------------------------------------------
-- Survivor lookup and the payment view
-- ---------------------------------------------------------------------------

-- Follows merged_into_vendor_id to the vendor that is still standing. A merge re-points earlier
-- merges at the new survivor, so this is normally one step; the loop is a guard.
CREATE OR REPLACE FUNCTION public.receipt_vendor_survivor(p_vendor_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_id uuid := p_vendor_id;
  v_next uuid;
  v_hops integer := 0;
BEGIN
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;
  LOOP
    SELECT merged_into_vendor_id INTO v_next FROM public.receipt_vendors WHERE id = v_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF v_next IS NULL OR v_hops >= 20 THEN
      RETURN v_id;
    END IF;
    v_id := v_next;
    v_hops := v_hops + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.receipt_vendor_survivor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_vendor_survivor(uuid) TO service_role;

-- Each payment with the vendor it belongs to now. A payment that names a vendor in text only is
-- matched to the vendor with that exact key, so both spellings report together.
CREATE OR REPLACE VIEW public.receipt_transaction_vendors
WITH (security_invoker = true) AS
SELECT
  rt.id AS transaction_id,
  sv.id AS vendor_id,
  COALESCE(NULLIF(BTRIM(sv.canonical_name), ''), NULLIF(BTRIM(rt.vendor_name), '')) AS vendor_label,
  COALESCE(sv.vendor_key, public.normalize_receipt_vendor_key(rt.vendor_name)) AS vendor_key,
  sv.kind AS vendor_kind,
  sv.status AS vendor_status
FROM public.receipt_transactions rt
LEFT JOIN public.receipt_vendors nv
  ON rt.vendor_id IS NULL
 AND nv.vendor_key = public.normalize_receipt_vendor_key(rt.vendor_name)
LEFT JOIN public.receipt_vendors sv
  ON sv.id = public.receipt_vendor_survivor(COALESCE(rt.vendor_id, nv.id));

REVOKE ALL ON public.receipt_transaction_vendors FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.receipt_transaction_vendors TO service_role;

-- ---------------------------------------------------------------------------
-- The resolver every writer uses
-- ---------------------------------------------------------------------------

-- Give it an id, a name or both. It answers with the surviving vendor. A name is looked up by
-- its key, then among the aliases. Nothing is created unless p_create is true.
CREATE OR REPLACE FUNCTION public.resolve_receipt_vendor(
  p_name text,
  p_vendor_id uuid DEFAULT NULL,
  p_create boolean DEFAULT false,
  p_origin text DEFAULT 'manual',
  p_kind text DEFAULT 'business'
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_name text := NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g')), '');
  v_key text := public.normalize_receipt_vendor_key(p_name);
  v_id uuid;
  v_created boolean := false;
  v_vendor public.receipt_vendors%ROWTYPE;
BEGIN
  IF p_vendor_id IS NOT NULL THEN
    v_id := public.receipt_vendor_survivor(p_vendor_id);
  END IF;

  IF v_id IS NULL AND v_key IS NOT NULL THEN
    SELECT public.receipt_vendor_survivor(id) INTO v_id FROM public.receipt_vendors WHERE vendor_key = v_key;
    IF v_id IS NULL THEN
      SELECT public.receipt_vendor_survivor(vendor_id) INTO v_id FROM public.receipt_vendor_aliases WHERE alias_key = v_key;
    END IF;
  END IF;

  IF v_id IS NULL AND p_create AND v_key IS NOT NULL THEN
    INSERT INTO public.receipt_vendors (canonical_name, vendor_key, status, origin, kind)
    VALUES (v_name, v_key, 'unconfirmed', COALESCE(p_origin, 'manual'), COALESCE(p_kind, 'business'))
    ON CONFLICT (vendor_key) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      -- Someone else created it in the same moment.
      SELECT public.receipt_vendor_survivor(id) INTO v_id FROM public.receipt_vendors WHERE vendor_key = v_key;
    ELSE
      v_created := true;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_vendor FROM public.receipt_vendors WHERE id = v_id;

  RETURN jsonb_build_object(
    'vendor_id', v_vendor.id,
    'canonical_name', v_vendor.canonical_name,
    'vendor_key', v_vendor.vendor_key,
    'status', v_vendor.status,
    'kind', v_vendor.kind,
    'default_expense_category', v_vendor.default_expense_category,
    'created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_receipt_vendor(text, uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_receipt_vendor(text, uuid, boolean, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Merge
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merge_receipt_vendor(
  p_from uuid,
  p_into uuid,
  p_performed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_from public.receipt_vendors%ROWTYPE;
  v_into public.receipt_vendors%ROWTYPE;
  v_transactions jsonb;
  v_rules jsonb;
  v_suggestions jsonb;
  v_ai_attempts jsonb := '[]'::jsonb;
  v_aliases jsonb;
  v_merged_vendors jsonb;
  v_watch_dropped jsonb;
  v_watch_moved jsonb;
  v_review_escalated jsonb;
  v_review_dropped jsonb;
  v_review_moved jsonb;
  v_alias_created uuid;
  v_invoice_carried boolean := false;
  v_operation_id uuid;
  v_summary jsonb;
BEGIN
  IF p_from IS NULL OR p_into IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF p_from = p_into THEN
    RETURN jsonb_build_object('outcome', 'same_vendor');
  END IF;

  -- Both vendors are locked in id order, so two merges the other way round cannot deadlock.
  PERFORM 1 FROM public.receipt_vendors WHERE id IN (p_from, p_into) ORDER BY id FOR UPDATE;

  SELECT * INTO v_from FROM public.receipt_vendors WHERE id = p_from;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  SELECT * INTO v_into FROM public.receipt_vendors WHERE id = p_into;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_from.status = 'merged' OR v_from.merged_into_vendor_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'already_merged');
  END IF;
  -- The survivor must itself be standing. This is also what makes a cycle impossible.
  IF v_into.status = 'merged' OR v_into.merged_into_vendor_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'target_merged');
  END IF;

  -- Payments. Each UPDATE reads the old values under a row lock and returns them, so the
  -- before-image is exactly what was replaced.
  WITH prior AS (
    SELECT id, vendor_id, vendor_name
    FROM public.receipt_transactions
    WHERE vendor_id = p_from
       OR (vendor_id IS NULL AND public.normalize_receipt_vendor_key(vendor_name) = v_from.vendor_key)
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_transactions t
    SET vendor_id = p_into, vendor_name = v_into.canonical_name
    FROM prior
    WHERE t.id = prior.id
    RETURNING prior.id, prior.vendor_id, prior.vendor_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'vendor_id', vendor_id, 'vendor_name', vendor_name)), '[]'::jsonb)
  INTO v_transactions FROM moved;

  INSERT INTO public.receipt_transaction_logs (transaction_id, action_type, note, performed_by)
  SELECT (e->>'id')::uuid, 'vendor_merge',
         format('Vendor "%s" merged into "%s"', v_from.canonical_name, v_into.canonical_name),
         p_performed_by
  FROM jsonb_array_elements(v_transactions) e;

  WITH prior AS (
    SELECT id, vendor_id, set_vendor_name
    FROM public.receipt_rules
    WHERE vendor_id = p_from
       OR (vendor_id IS NULL AND public.normalize_receipt_vendor_key(set_vendor_name) = v_from.vendor_key)
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_rules r
    SET vendor_id = p_into, set_vendor_name = v_into.canonical_name
    FROM prior
    WHERE r.id = prior.id
    RETURNING prior.id, prior.vendor_id, prior.set_vendor_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'vendor_id', vendor_id, 'set_vendor_name', set_vendor_name)), '[]'::jsonb)
  INTO v_rules FROM moved;

  WITH prior AS (
    SELECT id, set_vendor_id, set_vendor_name
    FROM public.receipt_rule_suggestions
    WHERE set_vendor_id = p_from
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_rule_suggestions s
    SET set_vendor_id = p_into, set_vendor_name = v_into.canonical_name
    FROM prior
    WHERE s.id = prior.id
    RETURNING prior.id, prior.set_vendor_id, prior.set_vendor_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'set_vendor_id', set_vendor_id, 'set_vendor_name', set_vendor_name)), '[]'::jsonb)
  INTO v_suggestions FROM moved;

  -- What the AI recorded against the old vendor (Release 4). That table arrives in a later
  -- migration, and this one must work on its own, so the statement is built only if it exists.
  IF to_regclass('public.receipt_ai_attempts') IS NOT NULL THEN
    EXECUTE 'WITH moved AS (
               UPDATE public.receipt_ai_attempts SET vendor_id = $2 WHERE vendor_id = $1 RETURNING id
             )
             SELECT COALESCE(jsonb_agg(id), ''[]''::jsonb) FROM moved'
    INTO v_ai_attempts
    USING p_from, p_into;
  END IF;

  -- The old vendor's spellings become spellings of the survivor.
  WITH moved AS (
    UPDATE public.receipt_vendor_aliases SET vendor_id = p_into WHERE vendor_id = p_from RETURNING id
  )
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_aliases FROM moved;

  INSERT INTO public.receipt_vendor_aliases (vendor_id, alias, alias_key, source, confidence)
  VALUES (p_into, v_from.canonical_name, v_from.vendor_key, 'manual', 100)
  ON CONFLICT (alias_key) DO NOTHING
  RETURNING id INTO v_alias_created;

  -- Vendors merged into the old one earlier now point straight at the survivor.
  WITH moved AS (
    UPDATE public.receipt_vendors SET merged_into_vendor_id = p_into WHERE merged_into_vendor_id = p_from RETURNING id
  )
  SELECT COALESCE(jsonb_agg(id), '[]'::jsonb) INTO v_merged_vendors FROM moved;

  -- Watch entries are combined: someone watching both keeps one entry, on the survivor.
  WITH dropped AS (
    DELETE FROM public.receipt_vendor_watchlist w
    WHERE (w.vendor_id = p_from OR w.vendor_key = v_from.vendor_key)
      AND EXISTS (
        SELECT 1 FROM public.receipt_vendor_watchlist o
        WHERE o.user_id = w.user_id AND o.vendor_key = v_into.vendor_key
      )
    RETURNING w.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(dropped)), '[]'::jsonb) INTO v_watch_dropped FROM dropped;

  WITH prior AS (
    SELECT user_id, vendor_key, vendor_label, vendor_id
    FROM public.receipt_vendor_watchlist
    WHERE vendor_id = p_from OR vendor_key = v_from.vendor_key
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_vendor_watchlist w
    SET vendor_key = v_into.vendor_key, vendor_label = v_into.canonical_name, vendor_id = p_into
    FROM prior
    WHERE w.user_id = prior.user_id AND w.vendor_key = prior.vendor_key
    RETURNING prior.user_id, prior.vendor_key, prior.vendor_label, prior.vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'vendor_key', vendor_key, 'vendor_label', vendor_label, 'vendor_id', vendor_id)), '[]'::jsonb)
  INTO v_watch_moved FROM moved;

  -- Reviews. Where both vendors have a review for the same person, comparison and month, the
  -- survivor's is kept, and "action required" on either side wins.
  WITH escalated AS (
    UPDATE public.receipt_vendor_reviews o
    SET status = 'action_required'
    FROM public.receipt_vendor_reviews r
    WHERE (r.vendor_id = p_from OR r.vendor_key = v_from.vendor_key)
      AND r.status = 'action_required'
      AND o.user_id = r.user_id AND o.vendor_key = v_into.vendor_key
      AND o.comparison = r.comparison AND o.month_start = r.month_start
      AND o.status <> 'action_required'
    RETURNING o.user_id, o.comparison, o.month_start,
      (SELECT p.status FROM public.receipt_vendor_reviews p
       WHERE p.user_id = o.user_id AND p.vendor_key = o.vendor_key
         AND p.comparison = o.comparison AND p.month_start = o.month_start) AS prior_status
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'comparison', comparison, 'month_start', month_start, 'prior_status', prior_status)), '[]'::jsonb)
  INTO v_review_escalated FROM escalated;

  WITH dropped AS (
    DELETE FROM public.receipt_vendor_reviews r
    WHERE (r.vendor_id = p_from OR r.vendor_key = v_from.vendor_key)
      AND EXISTS (
        SELECT 1 FROM public.receipt_vendor_reviews o
        WHERE o.user_id = r.user_id AND o.vendor_key = v_into.vendor_key
          AND o.comparison = r.comparison AND o.month_start = r.month_start
      )
    RETURNING r.*
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(dropped)), '[]'::jsonb) INTO v_review_dropped FROM dropped;

  WITH prior AS (
    SELECT user_id, vendor_key, vendor_label, comparison, month_start, vendor_id
    FROM public.receipt_vendor_reviews
    WHERE vendor_id = p_from OR vendor_key = v_from.vendor_key
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_vendor_reviews r
    SET vendor_key = v_into.vendor_key, vendor_label = v_into.canonical_name, vendor_id = p_into
    FROM prior
    WHERE r.user_id = prior.user_id AND r.vendor_key = prior.vendor_key
      AND r.comparison = prior.comparison AND r.month_start = prior.month_start
    RETURNING prior.user_id, prior.vendor_key, prior.vendor_label, prior.comparison, prior.month_start, prior.vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'vendor_key', vendor_key, 'vendor_label', vendor_label, 'comparison', comparison, 'month_start', month_start, 'vendor_id', vendor_id)), '[]'::jsonb)
  INTO v_review_moved FROM moved;

  -- The link to an invoicing customer is carried over when the survivor has none.
  IF v_into.invoice_vendor_id IS NULL AND v_from.invoice_vendor_id IS NOT NULL THEN
    UPDATE public.receipt_vendors SET invoice_vendor_id = v_from.invoice_vendor_id WHERE id = p_into;
    v_invoice_carried := true;
  END IF;

  UPDATE public.receipt_vendors
  SET status = 'merged', merged_into_vendor_id = p_into
  WHERE id = p_from;

  v_summary := jsonb_build_object(
    'from_name', v_from.canonical_name,
    'into_name', v_into.canonical_name,
    'transactions', jsonb_array_length(v_transactions),
    'rules', jsonb_array_length(v_rules),
    'suggestions', jsonb_array_length(v_suggestions),
    'aliases', jsonb_array_length(v_aliases),
    'alias_created', v_alias_created,
    'invoice_vendor_carried', v_invoice_carried
  );

  INSERT INTO public.receipt_vendor_operations (operation, vendor_id, source_vendor_id, performed_by, summary, before_image)
  VALUES (
    'merge', p_into, p_from, p_performed_by, v_summary,
    jsonb_build_object(
      'from', jsonb_build_object(
        'status', v_from.status,
        'merged_into_vendor_id', v_from.merged_into_vendor_id,
        'vendor_key', v_from.vendor_key,
        'canonical_name', v_from.canonical_name,
        'invoice_vendor_id', v_from.invoice_vendor_id
      ),
      'into', jsonb_build_object(
        'vendor_key', v_into.vendor_key,
        'canonical_name', v_into.canonical_name,
        'invoice_vendor_id', v_into.invoice_vendor_id
      ),
      'transactions', v_transactions,
      'rules', v_rules,
      'suggestions', v_suggestions,
      'ai_attempts', v_ai_attempts,
      'aliases', v_aliases,
      'merged_vendors', v_merged_vendors,
      'watch_dropped', v_watch_dropped,
      'watch_moved', v_watch_moved,
      'review_escalated', v_review_escalated,
      'review_dropped', v_review_dropped,
      'review_moved', v_review_moved
    )
  )
  RETURNING id INTO v_operation_id;

  RETURN v_summary || jsonb_build_object('outcome', 'merged', 'operation_id', v_operation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_receipt_vendor(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_receipt_vendor(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Rename
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rename_receipt_vendor(
  p_vendor_id uuid,
  p_name text,
  p_performed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_vendor public.receipt_vendors%ROWTYPE;
  v_name text := NULLIF(BTRIM(REGEXP_REPLACE(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g')), '');
  v_key text := public.normalize_receipt_vendor_key(p_name);
  v_other uuid;
  v_transactions jsonb;
  v_rules jsonb;
  v_suggestions jsonb;
  v_watch_dropped jsonb := '[]'::jsonb;
  v_watch_moved jsonb := '[]'::jsonb;
  v_review_dropped jsonb := '[]'::jsonb;
  v_review_moved jsonb := '[]'::jsonb;
  v_alias_created uuid;
  v_operation_id uuid;
  v_summary jsonb;
BEGIN
  IF v_name IS NULL OR v_key IS NULL THEN
    RETURN jsonb_build_object('outcome', 'invalid_name');
  END IF;

  SELECT * INTO v_vendor FROM public.receipt_vendors WHERE id = p_vendor_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_vendor.status = 'merged' OR v_vendor.merged_into_vendor_id IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'vendor_merged');
  END IF;
  IF v_vendor.canonical_name = v_name THEN
    RETURN jsonb_build_object('outcome', 'unchanged');
  END IF;

  -- A name another vendor already answers to, as its own name or as one of its spellings, is
  -- refused. The answer names that vendor so the screen can offer a merge.
  IF v_key <> v_vendor.vendor_key THEN
    SELECT id INTO v_other FROM public.receipt_vendors WHERE vendor_key = v_key AND id <> p_vendor_id;
    IF v_other IS NULL THEN
      SELECT vendor_id INTO v_other FROM public.receipt_vendor_aliases WHERE alias_key = v_key AND vendor_id <> p_vendor_id;
    END IF;
    IF v_other IS NOT NULL THEN
      v_other := public.receipt_vendor_survivor(v_other);
      IF v_other IS DISTINCT FROM p_vendor_id THEN
        RETURN jsonb_build_object(
          'outcome', 'name_taken',
          'vendor_id', v_other,
          'canonical_name', (SELECT canonical_name FROM public.receipt_vendors WHERE id = v_other)
        );
      END IF;
    END IF;
  END IF;

  BEGIN
    UPDATE public.receipt_vendors SET canonical_name = v_name, vendor_key = v_key WHERE id = p_vendor_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('outcome', 'name_taken');
  END;

  WITH prior AS (
    SELECT id, vendor_name FROM public.receipt_transactions
    WHERE vendor_id = p_vendor_id AND vendor_name IS DISTINCT FROM v_name
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_transactions t SET vendor_name = v_name
    FROM prior WHERE t.id = prior.id
    RETURNING prior.id, prior.vendor_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'vendor_name', vendor_name)), '[]'::jsonb)
  INTO v_transactions FROM moved;

  INSERT INTO public.receipt_transaction_logs (transaction_id, action_type, note, performed_by)
  SELECT (e->>'id')::uuid, 'vendor_rename',
         format('Vendor renamed from "%s" to "%s"', COALESCE(e->>'vendor_name', ''), v_name),
         p_performed_by
  FROM jsonb_array_elements(v_transactions) e;

  WITH prior AS (
    SELECT id, set_vendor_name FROM public.receipt_rules
    WHERE vendor_id = p_vendor_id AND set_vendor_name IS DISTINCT FROM v_name
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_rules r SET set_vendor_name = v_name
    FROM prior WHERE r.id = prior.id
    RETURNING prior.id, prior.set_vendor_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'set_vendor_name', set_vendor_name)), '[]'::jsonb)
  INTO v_rules FROM moved;

  WITH prior AS (
    SELECT id, set_vendor_name FROM public.receipt_rule_suggestions
    WHERE set_vendor_id = p_vendor_id AND set_vendor_name IS DISTINCT FROM v_name
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_rule_suggestions s SET set_vendor_name = v_name
    FROM prior WHERE s.id = prior.id
    RETURNING prior.id, prior.set_vendor_name
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'set_vendor_name', set_vendor_name)), '[]'::jsonb)
  INTO v_suggestions FROM moved;

  -- The old name is kept as a spelling of this vendor, so anything still using it resolves here.
  INSERT INTO public.receipt_vendor_aliases (vendor_id, alias, alias_key, source, confidence)
  VALUES (p_vendor_id, v_vendor.canonical_name, v_vendor.vendor_key, 'manual', 100)
  ON CONFLICT (alias_key) DO NOTHING
  RETURNING id INTO v_alias_created;

  IF v_key <> v_vendor.vendor_key THEN
    WITH dropped AS (
      DELETE FROM public.receipt_vendor_watchlist w
      WHERE (w.vendor_id = p_vendor_id OR w.vendor_key = v_vendor.vendor_key)
        AND EXISTS (SELECT 1 FROM public.receipt_vendor_watchlist o WHERE o.user_id = w.user_id AND o.vendor_key = v_key)
      RETURNING w.*
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(dropped)), '[]'::jsonb) INTO v_watch_dropped FROM dropped;

    WITH dropped AS (
      DELETE FROM public.receipt_vendor_reviews r
      WHERE (r.vendor_id = p_vendor_id OR r.vendor_key = v_vendor.vendor_key)
        AND EXISTS (
          SELECT 1 FROM public.receipt_vendor_reviews o
          WHERE o.user_id = r.user_id AND o.vendor_key = v_key
            AND o.comparison = r.comparison AND o.month_start = r.month_start
        )
      RETURNING r.*
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(dropped)), '[]'::jsonb) INTO v_review_dropped FROM dropped;
  END IF;

  WITH prior AS (
    SELECT user_id, vendor_key, vendor_label, vendor_id FROM public.receipt_vendor_watchlist
    WHERE vendor_id = p_vendor_id OR vendor_key = v_vendor.vendor_key
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_vendor_watchlist w
    SET vendor_key = v_key, vendor_label = v_name, vendor_id = p_vendor_id
    FROM prior
    WHERE w.user_id = prior.user_id AND w.vendor_key = prior.vendor_key
    RETURNING prior.user_id, prior.vendor_key, prior.vendor_label, prior.vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'vendor_key', vendor_key, 'vendor_label', vendor_label, 'vendor_id', vendor_id)), '[]'::jsonb)
  INTO v_watch_moved FROM moved;

  WITH prior AS (
    SELECT user_id, vendor_key, vendor_label, comparison, month_start, vendor_id FROM public.receipt_vendor_reviews
    WHERE vendor_id = p_vendor_id OR vendor_key = v_vendor.vendor_key
    FOR UPDATE
  ), moved AS (
    UPDATE public.receipt_vendor_reviews r
    SET vendor_key = v_key, vendor_label = v_name, vendor_id = p_vendor_id
    FROM prior
    WHERE r.user_id = prior.user_id AND r.vendor_key = prior.vendor_key
      AND r.comparison = prior.comparison AND r.month_start = prior.month_start
    RETURNING prior.user_id, prior.vendor_key, prior.vendor_label, prior.comparison, prior.month_start, prior.vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', user_id, 'vendor_key', vendor_key, 'vendor_label', vendor_label, 'comparison', comparison, 'month_start', month_start, 'vendor_id', vendor_id)), '[]'::jsonb)
  INTO v_review_moved FROM moved;

  v_summary := jsonb_build_object(
    'from_name', v_vendor.canonical_name,
    'to_name', v_name,
    'to_key', v_key,
    'transactions', jsonb_array_length(v_transactions),
    'rules', jsonb_array_length(v_rules),
    'suggestions', jsonb_array_length(v_suggestions),
    'alias_created', v_alias_created
  );

  INSERT INTO public.receipt_vendor_operations (operation, vendor_id, performed_by, summary, before_image)
  VALUES (
    'rename', p_vendor_id, p_performed_by, v_summary,
    jsonb_build_object(
      'vendor', jsonb_build_object('canonical_name', v_vendor.canonical_name, 'vendor_key', v_vendor.vendor_key),
      'transactions', v_transactions,
      'rules', v_rules,
      'suggestions', v_suggestions,
      'watch_dropped', v_watch_dropped,
      'watch_moved', v_watch_moved,
      'review_dropped', v_review_dropped,
      'review_moved', v_review_moved
    )
  )
  RETURNING id INTO v_operation_id;

  RETURN v_summary || jsonb_build_object('outcome', 'renamed', 'operation_id', v_operation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rename_receipt_vendor(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rename_receipt_vendor(uuid, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Undo
-- ---------------------------------------------------------------------------

-- Puts back what a merge or rename replaced, but only where the row still holds the value the
-- operation wrote. A row someone has changed since is left alone and counted as a conflict.
-- Calling it again returns the first result and changes nothing.
CREATE OR REPLACE FUNCTION public.undo_receipt_vendor_operation(
  p_operation_id uuid,
  p_performed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_op public.receipt_vendor_operations%ROWTYPE;
  v_before jsonb;
  v_vendor public.receipt_vendors%ROWTYPE;
  v_from public.receipt_vendors%ROWTYPE;
  v_applied_name text;
  v_applied_key text;
  v_old_name text;
  v_old_key text;
  v_other uuid;
  v_tx_total integer;
  v_tx_restored integer;
  v_rule_total integer;
  v_rule_restored integer;
  v_suggestion_total integer;
  v_suggestion_restored integer;
  v_result jsonb;
BEGIN
  SELECT * INTO v_op FROM public.receipt_vendor_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;
  IF v_op.undone_at IS NOT NULL THEN
    RETURN COALESCE(v_op.undo_result, '{}'::jsonb) || jsonb_build_object('outcome', 'already_undone');
  END IF;

  v_before := v_op.before_image;
  v_tx_total := jsonb_array_length(COALESCE(v_before->'transactions', '[]'::jsonb));
  v_rule_total := jsonb_array_length(COALESCE(v_before->'rules', '[]'::jsonb));
  v_suggestion_total := jsonb_array_length(COALESCE(v_before->'suggestions', '[]'::jsonb));

  IF v_op.operation = 'merge' THEN
    PERFORM 1 FROM public.receipt_vendors WHERE id IN (v_op.vendor_id, v_op.source_vendor_id) ORDER BY id FOR UPDATE;
    SELECT * INTO v_vendor FROM public.receipt_vendors WHERE id = v_op.vendor_id;
    SELECT * INTO v_from FROM public.receipt_vendors WHERE id = v_op.source_vendor_id;
    v_applied_name := v_op.summary->>'into_name';

    -- If either vendor has been merged or renamed since, that later change is undone first.
    IF v_from.id IS NULL OR v_vendor.id IS NULL
       OR v_from.status <> 'merged'
       OR v_from.merged_into_vendor_id IS DISTINCT FROM v_op.vendor_id
       OR v_vendor.canonical_name IS DISTINCT FROM v_applied_name THEN
      RETURN jsonb_build_object('outcome', 'blocked', 'reason', 'changed_since');
    END IF;

    WITH prior AS (
      SELECT (e->>'id')::uuid AS id, NULLIF(e->>'vendor_id', '')::uuid AS vendor_id, e->>'vendor_name' AS vendor_name
      FROM jsonb_array_elements(v_before->'transactions') e
    ), restored AS (
      UPDATE public.receipt_transactions t
      SET vendor_id = prior.vendor_id, vendor_name = prior.vendor_name
      FROM prior
      WHERE t.id = prior.id AND t.vendor_id = v_op.vendor_id AND t.vendor_name IS NOT DISTINCT FROM v_applied_name
      RETURNING t.id
    ), logged AS (
      INSERT INTO public.receipt_transaction_logs (transaction_id, action_type, note, performed_by)
      SELECT id, 'vendor_merge_undone', format('Merge of "%s" into "%s" undone', v_from.canonical_name, v_applied_name), p_performed_by
      FROM restored
      RETURNING 1
    )
    SELECT count(*) INTO v_tx_restored FROM logged;

    WITH prior AS (
      SELECT (e->>'id')::uuid AS id, NULLIF(e->>'vendor_id', '')::uuid AS vendor_id, e->>'set_vendor_name' AS set_vendor_name
      FROM jsonb_array_elements(v_before->'rules') e
    ), restored AS (
      UPDATE public.receipt_rules r
      SET vendor_id = prior.vendor_id, set_vendor_name = prior.set_vendor_name
      FROM prior
      WHERE r.id = prior.id AND r.vendor_id = v_op.vendor_id AND r.set_vendor_name IS NOT DISTINCT FROM v_applied_name
      RETURNING r.id
    )
    SELECT count(*) INTO v_rule_restored FROM restored;

    WITH prior AS (
      SELECT (e->>'id')::uuid AS id, NULLIF(e->>'set_vendor_id', '')::uuid AS set_vendor_id, e->>'set_vendor_name' AS set_vendor_name
      FROM jsonb_array_elements(v_before->'suggestions') e
    ), restored AS (
      UPDATE public.receipt_rule_suggestions s
      SET set_vendor_id = prior.set_vendor_id, set_vendor_name = prior.set_vendor_name
      FROM prior
      WHERE s.id = prior.id AND s.set_vendor_id = v_op.vendor_id AND s.set_vendor_name IS NOT DISTINCT FROM v_applied_name
      RETURNING s.id
    )
    SELECT count(*) INTO v_suggestion_restored FROM restored;

    IF to_regclass('public.receipt_ai_attempts') IS NOT NULL
       AND jsonb_array_length(COALESCE(v_before->'ai_attempts', '[]'::jsonb)) > 0 THEN
      EXECUTE 'UPDATE public.receipt_ai_attempts
               SET vendor_id = $1
               WHERE vendor_id = $2
                 AND id IN (SELECT (value #>> ''{}'')::uuid FROM jsonb_array_elements($3))'
      USING v_op.source_vendor_id, v_op.vendor_id, v_before->'ai_attempts';
    END IF;

    -- Spellings go back to the vendor they came from; the one the merge added is removed.
    UPDATE public.receipt_vendor_aliases a
    SET vendor_id = v_op.source_vendor_id
    WHERE a.vendor_id = v_op.vendor_id
      AND a.id IN (SELECT (value #>> '{}')::uuid FROM jsonb_array_elements(v_before->'aliases'));

    DELETE FROM public.receipt_vendor_aliases
    WHERE id = NULLIF(v_op.summary->>'alias_created', '')::uuid AND vendor_id = v_op.vendor_id;

    UPDATE public.receipt_vendors
    SET merged_into_vendor_id = v_op.source_vendor_id
    WHERE merged_into_vendor_id = v_op.vendor_id
      AND id IN (SELECT (value #>> '{}')::uuid FROM jsonb_array_elements(v_before->'merged_vendors'));

    -- Watch entries and reviews that were moved go back; ones that were folded away return.
    UPDATE public.receipt_vendor_watchlist w
    SET vendor_key = e->>'vendor_key', vendor_label = e->>'vendor_label', vendor_id = NULLIF(e->>'vendor_id', '')::uuid
    FROM jsonb_array_elements(v_before->'watch_moved') e
    WHERE w.user_id = (e->>'user_id')::uuid AND w.vendor_key = v_vendor.vendor_key AND w.vendor_id = v_op.vendor_id;

    INSERT INTO public.receipt_vendor_watchlist (user_id, vendor_key, vendor_label, vendor_id, created_at, updated_at)
    SELECT (e->>'user_id')::uuid, e->>'vendor_key', e->>'vendor_label', NULLIF(e->>'vendor_id', '')::uuid,
           (e->>'created_at')::timestamptz, (e->>'updated_at')::timestamptz
    FROM jsonb_array_elements(v_before->'watch_dropped') e
    ON CONFLICT (user_id, vendor_key) DO NOTHING;

    UPDATE public.receipt_vendor_reviews r
    SET vendor_key = e->>'vendor_key', vendor_label = e->>'vendor_label', vendor_id = NULLIF(e->>'vendor_id', '')::uuid
    FROM jsonb_array_elements(v_before->'review_moved') e
    WHERE r.user_id = (e->>'user_id')::uuid AND r.vendor_key = v_vendor.vendor_key AND r.vendor_id = v_op.vendor_id
      AND r.comparison = e->>'comparison' AND r.month_start = (e->>'month_start')::date;

    INSERT INTO public.receipt_vendor_reviews (user_id, vendor_key, vendor_label, comparison, month_start, status, vendor_id, created_at, updated_at)
    SELECT (e->>'user_id')::uuid, e->>'vendor_key', e->>'vendor_label', e->>'comparison', (e->>'month_start')::date, e->>'status',
           NULLIF(e->>'vendor_id', '')::uuid, (e->>'created_at')::timestamptz, (e->>'updated_at')::timestamptz
    FROM jsonb_array_elements(v_before->'review_dropped') e
    ON CONFLICT (user_id, vendor_key, comparison, month_start) DO NOTHING;

    UPDATE public.receipt_vendor_reviews r
    SET status = e->>'prior_status'
    FROM jsonb_array_elements(v_before->'review_escalated') e
    WHERE r.user_id = (e->>'user_id')::uuid AND r.vendor_key = v_vendor.vendor_key
      AND r.comparison = e->>'comparison' AND r.month_start = (e->>'month_start')::date
      AND r.status = 'action_required' AND e->>'prior_status' IS NOT NULL;

    IF COALESCE((v_op.summary->>'invoice_vendor_carried')::boolean, false)
       AND v_vendor.invoice_vendor_id IS NOT DISTINCT FROM NULLIF(v_before->'from'->>'invoice_vendor_id', '')::uuid THEN
      UPDATE public.receipt_vendors SET invoice_vendor_id = NULL WHERE id = v_op.vendor_id;
    END IF;

    UPDATE public.receipt_vendors
    SET status = v_before->'from'->>'status',
        merged_into_vendor_id = NULLIF(v_before->'from'->>'merged_into_vendor_id', '')::uuid
    WHERE id = v_op.source_vendor_id;

  ELSE
    SELECT * INTO v_vendor FROM public.receipt_vendors WHERE id = v_op.vendor_id FOR UPDATE;
    v_applied_name := v_op.summary->>'to_name';
    v_applied_key := v_op.summary->>'to_key';
    v_old_name := v_before->'vendor'->>'canonical_name';
    v_old_key := v_before->'vendor'->>'vendor_key';

    IF v_vendor.id IS NULL
       OR v_vendor.status = 'merged'
       OR v_vendor.canonical_name IS DISTINCT FROM v_applied_name THEN
      RETURN jsonb_build_object('outcome', 'blocked', 'reason', 'changed_since');
    END IF;

    -- The old name may have been given to another vendor in the meantime.
    IF v_old_key <> v_vendor.vendor_key THEN
      SELECT id INTO v_other FROM public.receipt_vendors WHERE vendor_key = v_old_key AND id <> v_op.vendor_id;
      IF v_other IS NULL THEN
        SELECT vendor_id INTO v_other FROM public.receipt_vendor_aliases WHERE alias_key = v_old_key AND vendor_id <> v_op.vendor_id;
      END IF;
      IF v_other IS NOT NULL THEN
        RETURN jsonb_build_object('outcome', 'blocked', 'reason', 'name_taken');
      END IF;
    END IF;

    UPDATE public.receipt_vendors SET canonical_name = v_old_name, vendor_key = v_old_key WHERE id = v_op.vendor_id;

    WITH prior AS (
      SELECT (e->>'id')::uuid AS id, e->>'vendor_name' AS vendor_name
      FROM jsonb_array_elements(v_before->'transactions') e
    ), restored AS (
      UPDATE public.receipt_transactions t
      SET vendor_name = prior.vendor_name
      FROM prior
      WHERE t.id = prior.id AND t.vendor_id = v_op.vendor_id AND t.vendor_name IS NOT DISTINCT FROM v_applied_name
      RETURNING t.id
    ), logged AS (
      INSERT INTO public.receipt_transaction_logs (transaction_id, action_type, note, performed_by)
      SELECT id, 'vendor_rename_undone', format('Rename of "%s" to "%s" undone', v_old_name, v_applied_name), p_performed_by
      FROM restored
      RETURNING 1
    )
    SELECT count(*) INTO v_tx_restored FROM logged;

    WITH prior AS (
      SELECT (e->>'id')::uuid AS id, e->>'set_vendor_name' AS set_vendor_name
      FROM jsonb_array_elements(v_before->'rules') e
    ), restored AS (
      UPDATE public.receipt_rules r
      SET set_vendor_name = prior.set_vendor_name
      FROM prior
      WHERE r.id = prior.id AND r.vendor_id = v_op.vendor_id AND r.set_vendor_name IS NOT DISTINCT FROM v_applied_name
      RETURNING r.id
    )
    SELECT count(*) INTO v_rule_restored FROM restored;

    WITH prior AS (
      SELECT (e->>'id')::uuid AS id, e->>'set_vendor_name' AS set_vendor_name
      FROM jsonb_array_elements(v_before->'suggestions') e
    ), restored AS (
      UPDATE public.receipt_rule_suggestions s
      SET set_vendor_name = prior.set_vendor_name
      FROM prior
      WHERE s.id = prior.id AND s.set_vendor_id = v_op.vendor_id AND s.set_vendor_name IS NOT DISTINCT FROM v_applied_name
      RETURNING s.id
    )
    SELECT count(*) INTO v_suggestion_restored FROM restored;

    DELETE FROM public.receipt_vendor_aliases
    WHERE id = NULLIF(v_op.summary->>'alias_created', '')::uuid AND vendor_id = v_op.vendor_id;

    UPDATE public.receipt_vendor_watchlist w
    SET vendor_key = e->>'vendor_key', vendor_label = e->>'vendor_label', vendor_id = NULLIF(e->>'vendor_id', '')::uuid
    FROM jsonb_array_elements(v_before->'watch_moved') e
    WHERE w.user_id = (e->>'user_id')::uuid AND w.vendor_key = v_applied_key AND w.vendor_id = v_op.vendor_id;

    INSERT INTO public.receipt_vendor_watchlist (user_id, vendor_key, vendor_label, vendor_id, created_at, updated_at)
    SELECT (e->>'user_id')::uuid, e->>'vendor_key', e->>'vendor_label', NULLIF(e->>'vendor_id', '')::uuid,
           (e->>'created_at')::timestamptz, (e->>'updated_at')::timestamptz
    FROM jsonb_array_elements(v_before->'watch_dropped') e
    ON CONFLICT (user_id, vendor_key) DO NOTHING;

    UPDATE public.receipt_vendor_reviews r
    SET vendor_key = e->>'vendor_key', vendor_label = e->>'vendor_label', vendor_id = NULLIF(e->>'vendor_id', '')::uuid
    FROM jsonb_array_elements(v_before->'review_moved') e
    WHERE r.user_id = (e->>'user_id')::uuid AND r.vendor_key = v_applied_key AND r.vendor_id = v_op.vendor_id
      AND r.comparison = e->>'comparison' AND r.month_start = (e->>'month_start')::date;

    INSERT INTO public.receipt_vendor_reviews (user_id, vendor_key, vendor_label, comparison, month_start, status, vendor_id, created_at, updated_at)
    SELECT (e->>'user_id')::uuid, e->>'vendor_key', e->>'vendor_label', e->>'comparison', (e->>'month_start')::date, e->>'status',
           NULLIF(e->>'vendor_id', '')::uuid, (e->>'created_at')::timestamptz, (e->>'updated_at')::timestamptz
    FROM jsonb_array_elements(v_before->'review_dropped') e
    ON CONFLICT (user_id, vendor_key, comparison, month_start) DO NOTHING;
  END IF;

  v_result := jsonb_build_object(
    'operation', v_op.operation,
    'transactions_restored', v_tx_restored,
    'transaction_conflicts', v_tx_total - v_tx_restored,
    'rules_restored', v_rule_restored,
    'rule_conflicts', v_rule_total - v_rule_restored,
    'suggestions_restored', v_suggestion_restored,
    'suggestion_conflicts', v_suggestion_total - v_suggestion_restored
  );

  UPDATE public.receipt_vendor_operations
  SET undone_at = now(), undone_by = p_performed_by, undo_result = v_result
  WHERE id = p_operation_id;

  RETURN v_result || jsonb_build_object('outcome', 'undone');
END;
$$;

REVOKE ALL ON FUNCTION public.undo_receipt_vendor_operation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.undo_receipt_vendor_operation(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The vendor list for the management screen
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_directory()
RETURNS TABLE (
  id uuid,
  canonical_name text,
  vendor_key text,
  status text,
  kind text,
  origin text,
  default_expense_category text,
  merged_into_vendor_id uuid,
  invoice_vendor_id uuid,
  created_at timestamptz,
  payment_count bigint,
  total_outgoing numeric,
  total_income numeric,
  last_transaction_date date,
  rule_count bigint,
  aliases text[]
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH usage AS (
    SELECT
      v.vendor_id,
      COUNT(*) AS payment_count,
      SUM(COALESCE(rt.amount_out, 0))::numeric(14, 2) AS total_outgoing,
      SUM(COALESCE(rt.amount_in, 0))::numeric(14, 2) AS total_income,
      MAX(rt.transaction_date) AS last_transaction_date
    FROM public.receipt_transaction_vendors v
    JOIN public.receipt_transactions rt ON rt.id = v.transaction_id
    WHERE v.vendor_id IS NOT NULL
    GROUP BY v.vendor_id
  ), rules AS (
    SELECT vendor_id, COUNT(*) AS rule_count
    FROM public.receipt_rules
    WHERE vendor_id IS NOT NULL
    GROUP BY vendor_id
  ), spellings AS (
    SELECT a.vendor_id, ARRAY_AGG(a.alias ORDER BY a.alias) AS aliases
    FROM public.receipt_vendor_aliases a
    JOIN public.receipt_vendors rv ON rv.id = a.vendor_id
    WHERE a.alias_key <> rv.vendor_key
    GROUP BY a.vendor_id
  )
  SELECT
    rv.id, rv.canonical_name, rv.vendor_key, rv.status, rv.kind, rv.origin,
    rv.default_expense_category, rv.merged_into_vendor_id, rv.invoice_vendor_id, rv.created_at,
    COALESCE(usage.payment_count, 0),
    COALESCE(usage.total_outgoing, 0),
    COALESCE(usage.total_income, 0),
    usage.last_transaction_date,
    COALESCE(rules.rule_count, 0),
    COALESCE(spellings.aliases, ARRAY[]::text[])
  FROM public.receipt_vendors rv
  LEFT JOIN usage ON usage.vendor_id = rv.id
  LEFT JOIN rules ON rules.vendor_id = rv.id
  LEFT JOIN spellings ON spellings.vendor_id = rv.id
  ORDER BY rv.canonical_name, rv.id;
$$;

REVOKE ALL ON FUNCTION public.get_receipt_vendor_directory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_directory() TO service_role;

-- ---------------------------------------------------------------------------
-- Reports read the one view
-- ---------------------------------------------------------------------------
-- The three functions below grouped vendors three different ways (by the payment's vendor, by
-- the rule's vendor name, or by the payment's text). They now all take the vendor from the
-- view. Names, arguments and return columns are unchanged.

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_monthly_totals(range_months integer DEFAULT NULL::integer)
RETURNS TABLE(vendor_key text, vendor_label text, month_start date, total_outgoing numeric, total_income numeric, transaction_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH canonical AS (
    SELECT
      v.vendor_key,
      v.vendor_label AS vendor_value,
      DATE_TRUNC('month', rt.transaction_date)::DATE AS month_start,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM public.receipt_transactions rt
    JOIN public.receipt_transaction_vendors v ON v.transaction_id = rt.id
    WHERE rt.transaction_date IS NOT NULL
      AND v.vendor_label IS NOT NULL
      AND v.vendor_key IS NOT NULL
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
$$;

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_transactions(target_vendor_label text)
RETURNS TABLE(id uuid, transaction_date date, details text, amount_in numeric, amount_out numeric, status text, vendor_name text, vendor_source text, transaction_type text, expense_category text, expense_category_source text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
  -- The label may be the vendor's current name or any spelling it has answered to.
  WITH target AS (
    SELECT COALESCE(
      (public.resolve_receipt_vendor(target_vendor_label)->>'vendor_key'),
      public.normalize_receipt_vendor_key(target_vendor_label)
    ) AS vendor_key
  )
  SELECT
    rt.id,
    rt.transaction_date,
    rt.details,
    rt.amount_in,
    rt.amount_out,
    rt.status::TEXT AS status,
    v.vendor_label AS vendor_name,
    rt.vendor_source,
    rt.transaction_type,
    rt.expense_category,
    rt.expense_category_source
  FROM public.receipt_transactions rt
  JOIN public.receipt_transaction_vendors v ON v.transaction_id = rt.id
  CROSS JOIN target
  WHERE rt.transaction_date IS NOT NULL
    AND target.vendor_key IS NOT NULL
    AND v.vendor_key = target.vendor_key
  ORDER BY rt.transaction_date DESC, rt.created_at DESC, rt.id DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_receipt_vendor_trends(month_window integer DEFAULT 12)
RETURNS TABLE(vendor_label text, month_start date, total_outgoing numeric, total_income numeric, transaction_count bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
  WITH canonical AS (
    SELECT
      v.vendor_key,
      v.vendor_label AS vendor_value,
      DATE_TRUNC('month', rt.transaction_date)::DATE AS month_start,
      COALESCE(rt.amount_out, 0)::NUMERIC(14, 2) AS amount_out,
      COALESCE(rt.amount_in, 0)::NUMERIC(14, 2) AS amount_in
    FROM public.receipt_transactions rt
    JOIN public.receipt_transaction_vendors v ON v.transaction_id = rt.id
    WHERE rt.transaction_date IS NOT NULL
      AND v.vendor_label IS NOT NULL
      AND v.vendor_key IS NOT NULL
  ), filtered AS (
    SELECT *
    FROM canonical
    WHERE month_start >= (DATE_TRUNC('month', NOW())::DATE - ((GREATEST(month_window, 1) - 1) || ' months')::INTERVAL)
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
$$;

-- CREATE OR REPLACE keeps the grants these three already had. They are stated again so the
-- result does not depend on history: the app calls all three with the service role.
REVOKE ALL ON FUNCTION public.get_receipt_vendor_monthly_totals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_monthly_totals(integer) TO service_role;
REVOKE ALL ON FUNCTION public.get_receipt_vendor_transactions(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_transactions(text) TO service_role;
REVOKE ALL ON FUNCTION public.get_receipt_vendor_trends(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_vendor_trends(integer) TO service_role;

COMMIT;
