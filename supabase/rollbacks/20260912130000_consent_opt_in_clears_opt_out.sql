-- Rollback for 20260912130000_consent_opt_in_clears_opt_out.sql
--
-- Restores record_customer_consent to the definition that was live before the change: the
-- body from 20260708000012_customer_consent_audit.sql, copied verbatim below, with its
-- REVOKE and GRANT restated. That live definition was fingerprinted immediately before the
-- apply, 12 September 2026: md5(pg_get_functiondef) = 3c9e05c3496762ed3fc84cb716ae2977,
-- length 5081.
--
-- No data needs undoing. The migration changed only the function body, and it was applied
-- when 0 customers had marketing_email_opt_in = true with marketing_email_opted_out_at set,
-- so it rewrote no summary row at apply time. Any row the new body has cleared since is a
-- guest who opted back in after an earlier opt-out, and the append-only customer_consents
-- ledger still holds both events with their timestamps and sources. This rollback
-- deliberately does not reinstate stale opt-out dates from that ledger: doing so would
-- re-suppress guests who have since asked to hear from us.

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
            marketing_sms_opt_in_at = v_now
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
            marketing_email_opt_in_at = v_now
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
            marketing_whatsapp_opt_in_at = v_now
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

REVOKE ALL ON FUNCTION public.record_customer_consent(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_customer_consent(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN
) TO service_role;
