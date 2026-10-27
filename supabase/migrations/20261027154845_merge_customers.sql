-- BK-164 (customer bookings review of 24 October 2026): managers can merge duplicate customers.
--
-- When a guest changes phone, staff end up with two customer records, and the app refuses to give
-- one the other's number or email (unique indexes on mobile_e164 and lower(email)). There was no
-- merge: the only in-app route was deleting the duplicate, which lost its bookings and consent
-- history. scripts/cleanup/merge-duplicate-customers.ts could only merge rows sharing a phone and
-- moved only some tables; it is retired in the same change.
--
-- merge_customers(keep, merge, dry_run) moves everything that points at the duplicate onto the
-- record being kept, in one transaction, then anonymises the duplicate:
--
--   * Refuses (state 'blocked', nothing changed) when the two records cannot be combined safely:
--     the same record twice, either one missing or already anonymised, both holding a live
--     booking for the same event, both linked to an invoice vendor, or both members of the same
--     loyalty programme. Staff sort those out first.
--   * Tables where a row says only "this customer is in this set" (labels, an event's manual
--     interest list, the engagement score) drop the duplicate's copy when the kept record already
--     has one. Event category stats are added together.
--   * History rows that would clash on a unique index (a check-in for the same event, the same
--     marketing campaign, the same promotion sequence, a second unsubscribe token) stay with the
--     anonymised duplicate and are counted as left behind, so nothing is lost or invented.
--   * Every other foreign key to customers is found from the catalogue at run time, so a table
--     added later is moved without changing this function. The three customer_id columns with no
--     foreign key (signing_parties, private_booking_complaints, webhook_logs) and the holding
--     queue's candidate list are moved by name. Signed documents and their evidence are not
--     edited: only the party's link to the customer moves.
--   * Consent keeps the most restrictive state: an opt-out on either record (STOP, a marketing
--     unsubscribe, WhatsApp) applies to the kept record, and the merge never adds an opt-in the
--     kept record did not already have. The duplicate's contact details go on the suppression
--     list (record_customer_contact_suppression, source customer_merged) before they are cleared.
--   * The kept record takes the duplicate's email (with its delivery health) when it has none, the
--     duplicate's notes are added to its notes, no-show counts are added, and it keeps the earlier
--     created date.
--   * The duplicate is anonymised like an erased record ("Merged Customer", no phone or email,
--     every channel off, is_placeholder set so lists and counts leave it out) and its notes
--     say which record it was merged into. No customers row is
--     deleted.
--
-- dry_run true runs the whole merge inside a savepoint, reports exactly what it would move and
-- rolls it back, so the preview staff see is the merge itself rather than an estimate.
--
-- Access: service_role only. The app calls it from a server action that checks customers delete
-- (managers and super admins) and writes the audit row.
--
-- Depends on 20261027154844_customer_contact_suppressions. Rollback:
-- tasks/merge-customers/rollback.sql. Tested by scripts/testing/merge-customers-postgres.py.

CREATE FUNCTION public.merge_customers_apply(p_keep_id uuid, p_merge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_keep public.customers%ROWTYPE;
  v_merge public.customers%ROWTYPE;
  v_now timestamptz := now();
  v_moved jsonb := '{}'::jsonb;
  v_left jsonb := '{}'::jsonb;
  v_dropped jsonb := '{}'::jsonb;
  v_n integer;
  v_clash integer;
  v_fk record;
  v_table text;
  v_email_moved boolean := false;
  v_sms_out boolean;
  v_whatsapp_out boolean;
  -- Tables handled one by one below, because a row can clash with the kept record's.
  v_handled text[] := ARRAY[
    'customer_category_stats', 'customer_label_assignments', 'customer_scores',
    'email_unsubscribe_tokens', 'event_check_ins', 'event_interest_manual_recipients',
    'invoice_vendors', 'loyalty_members', 'marketing_campaign_recipients', 'promo_sequence'
  ];
BEGIN
  IF p_keep_id IS NULL OR p_merge_id IS NULL OR p_keep_id = p_merge_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'same_customer');
  END IF;

  -- Both rows locked, in a fixed order so two merges cannot deadlock.
  PERFORM 1 FROM public.customers WHERE id IN (p_keep_id, p_merge_id) ORDER BY id FOR UPDATE;

  SELECT * INTO v_keep FROM public.customers WHERE id = p_keep_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'keep_not_found');
  END IF;
  SELECT * INTO v_merge FROM public.customers WHERE id = p_merge_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'merge_not_found');
  END IF;
  IF v_keep.first_name || ' ' || v_keep.last_name IN ('Erased Customer', 'Deleted Customer', 'Merged Customer') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'keep_anonymised');
  END IF;
  IF v_merge.first_name || ' ' || v_merge.last_name IN ('Erased Customer', 'Deleted Customer', 'Merged Customer') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'merge_anonymised');
  END IF;

  SELECT count(*) INTO v_clash
    FROM public.bookings m
    JOIN public.bookings k ON k.event_id = m.event_id
   WHERE m.customer_id = p_merge_id AND k.customer_id = p_keep_id
     AND m.status IN ('pending_payment', 'confirmed') AND k.status IN ('pending_payment', 'confirmed');
  IF v_clash > 0 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'both_booked_same_event', 'count', v_clash);
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoice_vendors WHERE customer_id = p_keep_id)
     AND EXISTS (SELECT 1 FROM public.invoice_vendors WHERE customer_id = p_merge_id) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'both_invoice_vendors');
  END IF;
  SELECT count(*) INTO v_clash
    FROM public.loyalty_members m
    JOIN public.loyalty_members k ON k.program_id = m.program_id
   WHERE m.customer_id = p_merge_id AND k.customer_id = p_keep_id;
  IF v_clash > 0 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'both_loyalty_members');
  END IF;

  -- The duplicate's opt-outs, by contact, before its phone and email are cleared.
  PERFORM public.record_customer_contact_suppression(ARRAY[p_merge_id], 'customer_merged');

  -- Sets: the duplicate's copy goes when the kept record already has the same entry.
  DELETE FROM public.customer_label_assignments m
   WHERE m.customer_id = p_merge_id
     AND EXISTS (SELECT 1 FROM public.customer_label_assignments k WHERE k.customer_id = p_keep_id AND k.label_id = m.label_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_dropped := v_dropped || jsonb_build_object('customer_label_assignments', v_n); END IF;
  UPDATE public.customer_label_assignments SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('customer_label_assignments', v_n); END IF;

  DELETE FROM public.event_interest_manual_recipients m
   WHERE m.customer_id = p_merge_id
     AND EXISTS (SELECT 1 FROM public.event_interest_manual_recipients k WHERE k.customer_id = p_keep_id AND k.event_id = m.event_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_dropped := v_dropped || jsonb_build_object('event_interest_manual_recipients', v_n); END IF;
  UPDATE public.event_interest_manual_recipients SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('event_interest_manual_recipients', v_n); END IF;

  -- The engagement score is worked out again by its cron, so the kept record's own one stays.
  DELETE FROM public.customer_scores m
   WHERE m.customer_id = p_merge_id AND EXISTS (SELECT 1 FROM public.customer_scores k WHERE k.customer_id = p_keep_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_dropped := v_dropped || jsonb_build_object('customer_scores', v_n); END IF;
  UPDATE public.customer_scores SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('customer_scores', v_n); END IF;

  -- Event category stats are added together.
  UPDATE public.customer_category_stats k
     SET times_attended = COALESCE(k.times_attended, 0) + COALESCE(m.times_attended, 0),
         first_attended_date = LEAST(k.first_attended_date, m.first_attended_date),
         last_attended_date = GREATEST(k.last_attended_date, m.last_attended_date),
         updated_at = v_now
    FROM public.customer_category_stats m
   WHERE k.customer_id = p_keep_id AND m.customer_id = p_merge_id AND m.category_id = k.category_id;
  DELETE FROM public.customer_category_stats m
   WHERE m.customer_id = p_merge_id
     AND EXISTS (SELECT 1 FROM public.customer_category_stats k WHERE k.customer_id = p_keep_id AND k.category_id = m.category_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_dropped := v_dropped || jsonb_build_object('customer_category_stats', v_n); END IF;
  UPDATE public.customer_category_stats SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('customer_category_stats', v_n); END IF;

  -- History that would clash stays with the anonymised duplicate.
  UPDATE public.event_check_ins m SET customer_id = p_keep_id
   WHERE m.customer_id = p_merge_id
     AND NOT EXISTS (SELECT 1 FROM public.event_check_ins k WHERE k.customer_id = p_keep_id AND k.event_id = m.event_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('event_check_ins', v_n); END IF;

  UPDATE public.marketing_campaign_recipients m SET customer_id = p_keep_id
   WHERE m.customer_id = p_merge_id
     AND NOT EXISTS (SELECT 1 FROM public.marketing_campaign_recipients k WHERE k.customer_id = p_keep_id AND k.campaign_id = m.campaign_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('marketing_campaign_recipients', v_n); END IF;

  UPDATE public.promo_sequence m SET customer_id = p_keep_id
   WHERE m.customer_id = p_merge_id
     AND NOT EXISTS (SELECT 1 FROM public.promo_sequence k WHERE k.customer_id = p_keep_id AND k.event_id = m.event_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('promo_sequence', v_n); END IF;

  UPDATE public.email_unsubscribe_tokens m SET customer_id = p_keep_id
   WHERE m.customer_id = p_merge_id
     AND NOT EXISTS (SELECT 1 FROM public.email_unsubscribe_tokens k WHERE k.customer_id = p_keep_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('email_unsubscribe_tokens', v_n); END IF;

  -- No clash is possible here once the blocks above have passed.
  UPDATE public.invoice_vendors SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('invoice_vendors', v_n); END IF;
  UPDATE public.loyalty_members SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('loyalty_members', v_n); END IF;

  -- Every other foreign key to customers, read from the catalogue.
  FOR v_fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.customers'::regclass
       AND cardinality(c.conkey) = 1
       AND c.conrelid <> 'public.customers'::regclass
     ORDER BY 1, 2
  LOOP
    v_table := v_fk.tbl::text;
    CONTINUE WHEN v_table = ANY (v_handled);
    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_fk.tbl, v_fk.col, v_fk.col) USING p_keep_id, p_merge_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      v_moved := v_moved || jsonb_build_object(v_table, COALESCE((v_moved ->> v_table)::integer, 0) + v_n);
    END IF;
  END LOOP;

  -- customer_id columns with no foreign key.
  UPDATE public.signing_parties SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('signing_parties', v_n); END IF;
  UPDATE public.private_booking_complaints SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('private_booking_complaints', v_n); END IF;
  UPDATE public.webhook_logs SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN v_moved := v_moved || jsonb_build_object('webhook_logs', v_n); END IF;
  UPDATE public.unmatched_communications
     SET candidate_customer_ids = ARRAY(
       SELECT DISTINCT x FROM unnest(array_replace(candidate_customer_ids, p_merge_id, p_keep_id)) AS x)
   WHERE p_merge_id = ANY (candidate_customer_ids);

  -- What stays with the duplicate.
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'event_check_ins', NULLIF((SELECT count(*) FROM public.event_check_ins WHERE customer_id = p_merge_id), 0),
    'marketing_campaign_recipients', NULLIF((SELECT count(*) FROM public.marketing_campaign_recipients WHERE customer_id = p_merge_id), 0),
    'promo_sequence', NULLIF((SELECT count(*) FROM public.promo_sequence WHERE customer_id = p_merge_id), 0),
    'email_unsubscribe_tokens', NULLIF((SELECT count(*) FROM public.email_unsubscribe_tokens WHERE customer_id = p_merge_id), 0)
  )) INTO v_left;

  -- The duplicate is anonymised first, so its email is free for the kept record.
  UPDATE public.customers SET
    first_name = 'Merged',
    last_name = 'Customer',
    -- Kept out of customer lists, counts and insights, like every anonymised record (BK-082).
    is_placeholder = true,
    email = NULL,
    mobile_number = '07700900000',
    mobile_e164 = NULL,
    mobile_number_raw = NULL,
    internal_notes = 'Merged into customer ' || p_keep_id::text || ' on '
      || to_char(v_now AT TIME ZONE 'Europe/London', 'DD Mon YYYY') || '.',
    stripe_customer_id = NULL,
    last_sms_failure_reason = NULL,
    sms_deactivation_reason = NULL,
    last_email_failure_reason = NULL,
    last_whatsapp_failure_reason = NULL,
    whatsapp_deactivation_reason = NULL,
    sms_opt_in_source = NULL,
    whatsapp_opt_in_source = NULL,
    sms_opt_in = false,
    sms_status = 'opted_out',
    marketing_sms_opt_in = false,
    marketing_email_opt_in = false,
    marketing_email_opted_out_at = COALESCE(marketing_email_opted_out_at, v_now),
    whatsapp_opt_in = false,
    marketing_whatsapp_opt_in = false,
    whatsapp_status = 'opted_out',
    whatsapp_opted_out_at = COALESCE(whatsapp_opted_out_at, v_now)
  WHERE id = p_merge_id;

  v_sms_out := v_keep.sms_status = 'opted_out' OR v_merge.sms_status = 'opted_out';
  v_whatsapp_out := v_keep.whatsapp_status = 'opted_out' OR v_merge.whatsapp_status = 'opted_out'
    OR v_merge.whatsapp_opted_out_at IS NOT NULL;
  v_email_moved := v_keep.email IS NULL AND v_merge.email IS NOT NULL;

  UPDATE public.customers k SET
    sms_opt_in = CASE WHEN v_sms_out THEN false ELSE k.sms_opt_in END,
    sms_status = CASE WHEN v_sms_out THEN 'opted_out' ELSE k.sms_status END,
    sms_opted_out_at = CASE WHEN v_sms_out THEN COALESCE(k.sms_opted_out_at, v_merge.sms_opted_out_at, v_now) ELSE k.sms_opted_out_at END,
    messaging_status = CASE WHEN v_merge.messaging_status = 'opted_out' THEN 'opted_out' ELSE k.messaging_status END,
    whatsapp_opt_in = CASE WHEN v_whatsapp_out THEN false ELSE k.whatsapp_opt_in END,
    whatsapp_status = CASE WHEN v_whatsapp_out THEN 'opted_out' ELSE k.whatsapp_status END,
    whatsapp_opted_out_at = CASE WHEN v_whatsapp_out THEN COALESCE(k.whatsapp_opted_out_at, v_merge.whatsapp_opted_out_at, v_now) ELSE k.whatsapp_opted_out_at END,
    marketing_sms_opt_in = k.marketing_sms_opt_in AND v_merge.marketing_sms_opted_out_at IS NULL,
    marketing_sms_opted_out_at = COALESCE(k.marketing_sms_opted_out_at, v_merge.marketing_sms_opted_out_at),
    marketing_email_opt_in = k.marketing_email_opt_in AND v_merge.marketing_email_opted_out_at IS NULL,
    marketing_email_opted_out_at = COALESCE(k.marketing_email_opted_out_at, v_merge.marketing_email_opted_out_at),
    marketing_whatsapp_opt_in = k.marketing_whatsapp_opt_in AND v_merge.marketing_whatsapp_opted_out_at IS NULL,
    marketing_whatsapp_opted_out_at = COALESCE(k.marketing_whatsapp_opted_out_at, v_merge.marketing_whatsapp_opted_out_at),
    email = CASE WHEN v_email_moved THEN v_merge.email ELSE k.email END,
    email_status = CASE WHEN v_email_moved THEN v_merge.email_status ELSE k.email_status END,
    email_delivery_failures = CASE WHEN v_email_moved THEN v_merge.email_delivery_failures ELSE k.email_delivery_failures END,
    last_email_failure_reason = CASE WHEN v_email_moved THEN v_merge.last_email_failure_reason ELSE k.last_email_failure_reason END,
    last_successful_email_at = CASE WHEN v_email_moved THEN v_merge.last_successful_email_at ELSE k.last_successful_email_at END,
    email_deactivated_at = CASE WHEN v_email_moved THEN v_merge.email_deactivated_at ELSE k.email_deactivated_at END,
    internal_notes = CASE
      WHEN NULLIF(btrim(v_merge.internal_notes), '') IS NULL THEN k.internal_notes
      WHEN NULLIF(btrim(k.internal_notes), '') IS NULL THEN 'From merged record: ' || v_merge.internal_notes
      ELSE k.internal_notes || E'\n\nFrom merged record: ' || v_merge.internal_notes
    END,
    no_show_count = COALESCE(k.no_show_count, 0) + COALESCE(v_merge.no_show_count, 0),
    stripe_customer_id = COALESCE(k.stripe_customer_id, v_merge.stripe_customer_id),
    created_at = LEAST(k.created_at, v_merge.created_at)
  WHERE k.id = p_keep_id;

  RETURN jsonb_build_object(
    'state', 'merged',
    'keep_id', p_keep_id,
    'merge_id', p_merge_id,
    'moved', v_moved,
    'duplicates_dropped', v_dropped,
    'left_behind', v_left,
    'email_moved', v_email_moved,
    'sms_opted_out', v_sms_out,
    'whatsapp_opted_out', v_whatsapp_out
  );
END;
$function$;

CREATE FUNCTION public.merge_customers(p_keep_id uuid, p_merge_id uuid, p_dry_run boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_dry_run IS DISTINCT FROM false THEN
    -- The merge itself, inside a savepoint that is always rolled back: the preview is exact.
    BEGIN
      v_result := public.merge_customers_apply(p_keep_id, p_merge_id);
      RAISE EXCEPTION 'merge_customers_preview_rollback';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM IS DISTINCT FROM 'merge_customers_preview_rollback' THEN
        RAISE;
      END IF;
    END;
    RETURN v_result || jsonb_build_object('preview', true);
  END IF;

  RETURN public.merge_customers_apply(p_keep_id, p_merge_id) || jsonb_build_object('preview', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.merge_customers_apply(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.merge_customers(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_customers_apply(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.merge_customers(uuid, uuid, boolean) TO service_role;

-- Prove it: only the service role can merge.
DO $assert$
BEGIN
  IF has_function_privilege('anon', 'public.merge_customers(uuid, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.merge_customers(uuid, uuid, boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.merge_customers_apply(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.merge_customers_apply(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'merge_customers: executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.merge_customers(uuid, uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'merge_customers: service_role cannot merge';
  END IF;
END
$assert$;
