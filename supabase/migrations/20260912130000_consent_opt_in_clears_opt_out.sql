-- Opting back in clears the old opt-out, 12 September 2026.
--
-- APPLIED to production project tfcasgxopxegwrabvwat on 12 September 2026 as migration version
-- 20260912191542 (name: consent_opt_in_clears_opt_out), after validation against a throwaway
-- local Postgres. Verified after apply with a smoke test that rolled itself back: a throwaway
-- customer opted out, then opted back in, finished with marketing_email_opt_in true and
-- marketing_email_opted_out_at NULL, the ledger kept both events, an unknown customer id still
-- raised P0002, and nothing was left behind. Rollback:
-- supabase/rollbacks/20260912130000_consent_opt_in_clears_opt_out.sql
--
-- WHY
--
-- `record_customer_consent` sets the opt-in flag and the opt-in timestamp when somebody opts
-- in, and never clears the matching `*_opted_out_at` column. `marketing_email_opted_out_at`
-- is an absolute gate on the marketing audience: a set value excludes the guest whatever else
-- is true of them, including the opt-in flag and the soft opt-in a prior booking gives them
-- (`src/lib/notifications/notify.ts` line 209, `src/lib/sms/event-promo-policy.ts` line 671
-- and the campaign SQL they describe). So a guest who unsubscribed and later ticked the box
-- reads as opted in on every screen and is never actually sent to. They would never know, and
-- neither would we.
--
-- Only the guest email-capture link cleared it, inline in its own UPDATE, which is why the
-- defect was invisible: the one path anybody tested worked.
--
-- NOBODY IS AFFECTED TODAY. Measured 12 September 2026: 0 customers have
-- `marketing_email_opt_in = true` with `marketing_email_opted_out_at` set. This is a
-- correctness fix, not an incident, which is why it is drafted rather than rushed.
--
-- ALL THREE MARKETING CHANNELS, not just email. The same two lines are missing from the SMS
-- and WhatsApp marketing branches. Only the email column is read as a gate today, so only
-- email is broken today, but leaving the other two would be the same defect waiting for the
-- next person to add the same gate. This workspace has fixed the same bug twice, days apart,
-- four times; once is enough.
--
-- WHY CLEARING THE COLUMN IS SAFE. `customer_consents` is the audit trail and it is
-- append-only: every opt-out keeps its own row, with its timestamp, its source, its capture
-- method and the exact text the guest was shown. The `customers` columns are a summary of
-- CURRENT state, and a stale opt-out date on a customer who has since opted back in is not
-- history, it is a wrong answer to "are they opted out". Nothing in the codebase reads
-- `marketing_*_opted_out_at` as a historical record; every reader treats it as current state.
--
-- WHAT IS DELIBERATELY NOT CHANGED. The service branches (`sms`/`service`,
-- `whatsapp`/`service`) already clear what they need to and are left exactly as they are. The
-- opted_out and objected branches are untouched. Nothing about the insert changes.

-- No explicit BEGIN/COMMIT: the Supabase migration runner wraps each file in its own
-- transaction, and committing early inside that would break its error handling.

CREATE OR REPLACE FUNCTION public.record_customer_consent(
  p_customer_id UUID,
  p_channel TEXT,
  p_purpose TEXT,
  p_status TEXT,
  p_legal_basis TEXT,
  p_source TEXT,
  p_capture_method TEXT,
  p_consent_text_version TEXT DEFAULT NULL,
  p_consent_text TEXT DEFAULT NULL,
  p_captured_by_user_id UUID DEFAULT NULL,
  p_source_url TEXT DEFAULT NULL,
  p_ip_hash TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_related_entity_type TEXT DEFAULT NULL,
  p_related_entity_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_update_summary BOOLEAN DEFAULT TRUE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_consent_id UUID;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found', p_customer_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.customer_consents (
    customer_id,
    channel,
    purpose,
    status,
    legal_basis,
    source,
    capture_method,
    consent_text_version,
    consent_text,
    captured_at,
    captured_by_user_id,
    source_url,
    ip_hash,
    user_agent,
    related_entity_type,
    related_entity_id,
    metadata
  ) VALUES (
    p_customer_id,
    p_channel,
    p_purpose,
    p_status,
    p_legal_basis,
    p_source,
    p_capture_method,
    p_consent_text_version,
    p_consent_text,
    v_now,
    p_captured_by_user_id,
    p_source_url,
    p_ip_hash,
    p_user_agent,
    p_related_entity_type,
    p_related_entity_id,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_consent_id;

  IF p_update_summary IS TRUE THEN
    IF p_channel = 'sms' AND p_purpose = 'service' THEN
      IF p_status = 'opted_in' THEN
        UPDATE public.customers
        SET sms_opt_in = TRUE,
            sms_status = 'active',
            sms_opt_in_at = v_now,
            sms_opt_in_source = p_source,
            sms_delivery_failures = 0,
            sms_deactivated_at = NULL,
            sms_deactivation_reason = NULL
        WHERE id = p_customer_id;
      ELSIF p_status IN ('opted_out', 'objected') THEN
        UPDATE public.customers
        SET sms_opt_in = FALSE,
            sms_status = 'opted_out',
            sms_opted_out_at = v_now,
            marketing_sms_opt_in = FALSE,
            marketing_sms_opted_out_at = v_now,
            sms_deactivated_at = NULL,
            sms_deactivation_reason = NULL
        WHERE id = p_customer_id;
      END IF;
    ELSIF p_channel = 'sms' AND p_purpose = 'marketing' THEN
      IF p_status = 'opted_in' THEN
        UPDATE public.customers
        SET marketing_sms_opt_in = TRUE,
            marketing_sms_opt_in_at = v_now,
            -- Cleared, so a guest who opted back in is not left reading as both.
            marketing_sms_opted_out_at = NULL
        WHERE id = p_customer_id;
      ELSIF p_status IN ('opted_out', 'objected') THEN
        UPDATE public.customers
        SET marketing_sms_opt_in = FALSE,
            marketing_sms_opted_out_at = v_now
        WHERE id = p_customer_id;
      END IF;
    ELSIF p_channel = 'email' AND p_purpose = 'marketing' THEN
      IF p_status = 'opted_in' THEN
        UPDATE public.customers
        SET marketing_email_opt_in = TRUE,
            marketing_email_opt_in_at = v_now,
            -- THE ONE THAT ACTUALLY BITES. The marketing audience requires this to be NULL,
            -- so leaving it set made the opt-in cosmetic: opted in on every screen, sent to
            -- never. The append-only consent ledger above still holds the original opt-out.
            marketing_email_opted_out_at = NULL
        WHERE id = p_customer_id;
      ELSIF p_status IN ('opted_out', 'objected') THEN
        UPDATE public.customers
        SET marketing_email_opt_in = FALSE,
            marketing_email_opted_out_at = v_now
        WHERE id = p_customer_id;
      END IF;
    ELSIF p_channel = 'whatsapp' AND p_purpose = 'service' THEN
      IF p_status = 'opted_in' THEN
        UPDATE public.customers
        SET whatsapp_opt_in = TRUE,
            whatsapp_status = 'active',
            whatsapp_opt_in_at = v_now,
            whatsapp_opted_out_at = NULL,
            whatsapp_opt_in_source = p_source,
            whatsapp_delivery_failures = 0,
            last_whatsapp_failure_reason = NULL,
            whatsapp_deactivated_at = NULL,
            whatsapp_deactivation_reason = NULL
        WHERE id = p_customer_id;
      ELSIF p_status IN ('opted_out', 'objected') THEN
        UPDATE public.customers
        SET whatsapp_opt_in = FALSE,
            whatsapp_status = 'opted_out',
            whatsapp_opted_out_at = v_now,
            marketing_whatsapp_opt_in = FALSE,
            marketing_whatsapp_opted_out_at = v_now,
            whatsapp_deactivated_at = NULL,
            whatsapp_deactivation_reason = NULL
        WHERE id = p_customer_id;
      END IF;
    ELSIF p_channel = 'whatsapp' AND p_purpose = 'marketing' THEN
      IF p_status = 'opted_in' THEN
        UPDATE public.customers
        SET marketing_whatsapp_opt_in = TRUE,
            marketing_whatsapp_opt_in_at = v_now,
            -- Same reasoning as the other two marketing branches.
            marketing_whatsapp_opted_out_at = NULL
        WHERE id = p_customer_id;
      ELSIF p_status IN ('opted_out', 'objected') THEN
        UPDATE public.customers
        SET marketing_whatsapp_opt_in = FALSE,
            marketing_whatsapp_opted_out_at = v_now
        WHERE id = p_customer_id;
      END IF;
    END IF;
  END IF;

  RETURN v_consent_id;
END;
$$;

COMMENT ON FUNCTION public.record_customer_consent(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN
) IS
  'Appends a consent row and, unless p_update_summary is false, refreshes the summary flags on customers. A marketing opt-in clears the matching marketing_*_opted_out_at (added 2026-09-12): the audience filters require it to be NULL, so leaving it set made the opt-in cosmetic. The append-only customer_consents ledger remains the audit trail.';

-- Grants are unchanged by CREATE OR REPLACE, and the 20260811100100 revoke stands:
-- service_role only. Restated so a reader does not have to go and check.
REVOKE ALL ON FUNCTION public.record_customer_consent(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_customer_consent(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN
) TO service_role;

-- ROLLBACK
--
-- supabase/rollbacks/20260912130000_consent_opt_in_clears_opt_out.sql holds the previous body
-- verbatim, copied from 20260708000012_customer_consent_audit.sql, which is identical apart
-- from the three cleared columns. No table, column, index, policy or grant is touched, so
-- there is nothing else to undo.
--
-- APPLY NOTE
--
-- Applied while the app was running, which is safe: CREATE OR REPLACE FUNCTION takes a short
-- lock on the function only, and an in-flight call finishes on the old body. It backfills
-- nothing.
--
-- THE BACKFILL IS A SEPARATE OWNER DECISION, and there was nothing to backfill when this ran:
-- 0 customers had marketing_email_opt_in = true with marketing_email_opted_out_at set, on any
-- of the three marketing channels, so no summary row was rewritten by the apply itself. From
-- here the function keeps that state from recurring. If rows ever appear, the question of
-- whether those guests should be treated as opted in is the owner's, not this migration's:
--
--   SELECT count(*) FROM public.customers
--   WHERE marketing_email_opt_in IS TRUE AND marketing_email_opted_out_at IS NOT NULL;
