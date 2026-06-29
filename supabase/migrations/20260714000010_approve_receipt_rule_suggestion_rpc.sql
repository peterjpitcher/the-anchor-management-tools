-- Atomic approval: insert the rule + mark the suggestion approved in ONE transaction,
-- so a failure can't leave a rule with a still-pending suggestion. Idempotent: returns
-- the existing approved_rule_id if already approved; raises if not found/declined.
CREATE OR REPLACE FUNCTION public.approve_receipt_rule_suggestion(
  p_suggestion_id uuid,
  p_user_id uuid,
  p_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion public.receipt_rule_suggestions%ROWTYPE;
  v_vendor_id uuid;
  v_rule_id uuid;
BEGIN
  SELECT * INTO v_suggestion FROM public.receipt_rule_suggestions
  WHERE id = p_suggestion_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;
  IF v_suggestion.status = 'approved' THEN
    RETURN v_suggestion.approved_rule_id; -- idempotent
  END IF;
  IF v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'Suggestion is not pending';
  END IF;

  v_vendor_id := v_suggestion.set_vendor_id;

  INSERT INTO public.receipt_rules (
    name, description, match_description, match_transaction_type, match_direction,
    match_min_amount, match_max_amount, auto_status, set_vendor_name, set_expense_category,
    vendor_id, priority, kind, is_active, created_by, updated_by, reviewed_at, reviewed_by
  ) VALUES (
    v_suggestion.suggested_name, 'Created from receipt rule suggestion evidence.',
    v_suggestion.match_description, NULL, v_suggestion.match_direction,
    v_suggestion.match_min_amount, v_suggestion.match_max_amount, v_suggestion.auto_status,
    v_suggestion.set_vendor_name, v_suggestion.set_expense_category,
    v_vendor_id, 1000, 'standard', COALESCE(p_active, true), p_user_id, p_user_id, now(), p_user_id
  ) RETURNING id INTO v_rule_id;

  UPDATE public.receipt_rule_suggestions
  SET status = 'approved', approved_rule_id = v_rule_id, reviewed_at = now(), reviewed_by = p_user_id
  WHERE id = p_suggestion_id;

  RETURN v_rule_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_receipt_rule_suggestion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_receipt_rule_suggestion(uuid, uuid, boolean) TO service_role;
