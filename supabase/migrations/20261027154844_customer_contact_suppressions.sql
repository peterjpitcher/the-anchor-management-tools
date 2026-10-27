-- BK-161 (customer bookings review of 24 October 2026): deleting or erasing a customer keeps their
-- opt-outs.
--
-- 'Delete customer' and the GDPR erasure both clear a customer's phone number and email. The
-- opt-outs on that record (said STOP, unsubscribed from marketing) stayed with the anonymised row,
-- so if the same person booked again they came back as a brand new, SMS-active customer with no
-- record that they had opted out. That risks a PECR breach for marketing.
--
-- This keeps a suppression list that holds no readable contact details:
--
--   customer_contact_suppressions   one row per contact, keyed on a SHA-256 hash of the phone
--                                   number (E.164) or the lower-cased email, with the opt-outs
--                                   that contact carried. Only explicit opt-outs are kept; a
--                                   contact that never opted out of anything gets no row.
--   customer_contact_hash(kind, v)  the hash, in one place for the writer and the trigger.
--   record_customer_contact_suppression(ids, source)
--                                   called by the app before it erases or merges a customer
--                                   (while the contact details are still on the row). Merges
--                                   with any existing row, keeping the most restrictive state.
--   apply_customer_contact_suppression  BEFORE INSERT OR UPDATE OF mobile_e164, email ON
--                                   customers: a new customer, or a phone or email changed to a
--                                   suppressed one, starts with those opt-outs. It covers every
--                                   way a customer row is written (the app, the import RPC, the
--                                   booking functions), so no code path can skip it.
--
-- Fresh consent still wins: the trigger only acts when the row is created or its phone or email
-- changes, so a guest who opts in again later (recorded as an update) keeps that opt-in.
--
-- Access: the table and all three functions are service_role only (anon and authenticated hold
-- nothing, and the table has row level security on with no policies). The trigger function is
-- SECURITY DEFINER so a staff session that inserts a customer (customers create) can still read
-- the list through it. Nothing is backfilled: no customer has been deleted through the new path
-- yet, and the one "Deleted Customer" row in production (26 October 2026) no longer holds its
-- contact details, so there is nothing to hash.
--
-- Rollback: tasks/customer-contact-suppressions/rollback.sql. Tested by
-- scripts/testing/customer-contact-suppressions-postgres.py.

CREATE TABLE public.customer_contact_suppressions (
  contact_kind text NOT NULL CHECK (contact_kind IN ('phone', 'email')),
  contact_hash text NOT NULL CHECK (contact_hash ~ '^[0-9a-f]{64}$'),
  sms_opted_out boolean NOT NULL DEFAULT false,
  whatsapp_opted_out boolean NOT NULL DEFAULT false,
  marketing_sms_opted_out boolean NOT NULL DEFAULT false,
  marketing_email_opted_out boolean NOT NULL DEFAULT false,
  marketing_whatsapp_opted_out boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('customer_deleted', 'gdpr_erasure', 'customer_merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_kind, contact_hash)
);

COMMENT ON TABLE public.customer_contact_suppressions IS
  'Opt-outs of deleted, erased and merged customers, keyed on a SHA-256 hash of the phone or email so no contact detail is kept (BK-161). A new customer with a listed contact starts opted out.';

ALTER TABLE public.customer_contact_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_contact_suppressions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_contact_suppressions TO service_role;

CREATE FUNCTION public.customer_contact_hash(p_kind text, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' AND NULLIF(regexp_replace(COALESCE(p_value, ''), '\s', '', 'g'), '') IS NOT NULL
      THEN encode(sha256(convert_to('phone:' || regexp_replace(p_value, '\s', '', 'g'), 'UTF8')), 'hex')
    WHEN p_kind = 'email' AND NULLIF(lower(btrim(COALESCE(p_value, ''))), '') IS NOT NULL
      THEN encode(sha256(convert_to('email:' || lower(btrim(p_value)), 'UTF8')), 'hex')
    ELSE NULL
  END
$function$;

CREATE FUNCTION public.record_customer_contact_suppression(p_customer_ids uuid[], p_source text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_rows integer;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('customer_deleted', 'gdpr_erasure', 'customer_merged') THEN
    RAISE EXCEPTION 'record_customer_contact_suppression: unknown source %', p_source USING ERRCODE = '22023';
  END IF;

  IF p_customer_ids IS NULL OR cardinality(p_customer_ids) = 0 THEN
    RETURN 0;
  END IF;

  WITH customer_flags AS (
    SELECT
      c.mobile_e164,
      c.email,
      (c.sms_status = 'opted_out' OR c.messaging_status = 'opted_out') AS sms_out,
      (c.whatsapp_status = 'opted_out' OR c.whatsapp_opted_out_at IS NOT NULL
        OR c.messaging_status = 'opted_out') AS whatsapp_out,
      (c.marketing_sms_opted_out_at IS NOT NULL) AS marketing_sms_out,
      (c.marketing_email_opted_out_at IS NOT NULL) AS marketing_email_out,
      (c.marketing_whatsapp_opted_out_at IS NOT NULL) AS marketing_whatsapp_out
    FROM public.customers c
    WHERE c.id = ANY (p_customer_ids)
  ),
  contacts AS (
    SELECT 'phone'::text AS kind, public.customer_contact_hash('phone', f.mobile_e164) AS hash, f.*
      FROM customer_flags f
    UNION ALL
    SELECT 'email'::text, public.customer_contact_hash('email', f.email), f.*
      FROM customer_flags f
  )
  INSERT INTO public.customer_contact_suppressions AS s (
    contact_kind, contact_hash, sms_opted_out, whatsapp_opted_out, marketing_sms_opted_out,
    marketing_email_opted_out, marketing_whatsapp_opted_out, source
  )
  SELECT kind, hash, bool_or(sms_out), bool_or(whatsapp_out), bool_or(marketing_sms_out),
         bool_or(marketing_email_out), bool_or(marketing_whatsapp_out), p_source
    FROM contacts
   WHERE hash IS NOT NULL
     AND (sms_out OR whatsapp_out OR marketing_sms_out OR marketing_email_out OR marketing_whatsapp_out)
   GROUP BY kind, hash
  ON CONFLICT (contact_kind, contact_hash) DO UPDATE SET
    sms_opted_out = s.sms_opted_out OR EXCLUDED.sms_opted_out,
    whatsapp_opted_out = s.whatsapp_opted_out OR EXCLUDED.whatsapp_opted_out,
    marketing_sms_opted_out = s.marketing_sms_opted_out OR EXCLUDED.marketing_sms_opted_out,
    marketing_email_opted_out = s.marketing_email_opted_out OR EXCLUDED.marketing_email_opted_out,
    marketing_whatsapp_opted_out = s.marketing_whatsapp_opted_out OR EXCLUDED.marketing_whatsapp_opted_out,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$function$;

CREATE FUNCTION public.apply_customer_contact_suppression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone_hash text;
  v_email_hash text;
  v_now timestamptz := now();
  v_sms boolean;
  v_whatsapp boolean;
  v_marketing_sms boolean;
  v_marketing_email boolean;
  v_marketing_whatsapp boolean;
BEGIN
  -- Only a contact that is new on this row counts, so an opt-in recorded later stands.
  IF TG_OP = 'INSERT' OR NEW.mobile_e164 IS DISTINCT FROM OLD.mobile_e164 THEN
    v_phone_hash := public.customer_contact_hash('phone', NEW.mobile_e164);
  END IF;
  IF TG_OP = 'INSERT' OR lower(btrim(NEW.email)) IS DISTINCT FROM lower(btrim(OLD.email)) THEN
    v_email_hash := public.customer_contact_hash('email', NEW.email);
  END IF;

  IF v_phone_hash IS NULL AND v_email_hash IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT bool_or(s.sms_opted_out), bool_or(s.whatsapp_opted_out), bool_or(s.marketing_sms_opted_out),
         bool_or(s.marketing_email_opted_out), bool_or(s.marketing_whatsapp_opted_out)
    INTO v_sms, v_whatsapp, v_marketing_sms, v_marketing_email, v_marketing_whatsapp
    FROM public.customer_contact_suppressions s
   WHERE (s.contact_kind = 'phone' AND s.contact_hash = v_phone_hash)
      OR (s.contact_kind = 'email' AND s.contact_hash = v_email_hash);

  IF v_sms IS TRUE THEN
    NEW.sms_opt_in := false;
    NEW.sms_status := 'opted_out';
    NEW.sms_opted_out_at := COALESCE(NEW.sms_opted_out_at, v_now);
  END IF;
  IF v_whatsapp IS TRUE THEN
    NEW.whatsapp_opt_in := false;
    NEW.whatsapp_status := 'opted_out';
    NEW.whatsapp_opted_out_at := COALESCE(NEW.whatsapp_opted_out_at, v_now);
  END IF;
  IF v_marketing_sms IS TRUE THEN
    NEW.marketing_sms_opt_in := false;
    NEW.marketing_sms_opted_out_at := COALESCE(NEW.marketing_sms_opted_out_at, v_now);
  END IF;
  IF v_marketing_email IS TRUE THEN
    NEW.marketing_email_opt_in := false;
    NEW.marketing_email_opted_out_at := COALESCE(NEW.marketing_email_opted_out_at, v_now);
  END IF;
  IF v_marketing_whatsapp IS TRUE THEN
    NEW.marketing_whatsapp_opt_in := false;
    NEW.marketing_whatsapp_opted_out_at := COALESCE(NEW.marketing_whatsapp_opted_out_at, v_now);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER customers_apply_contact_suppression
  BEFORE INSERT OR UPDATE OF mobile_e164, email ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.apply_customer_contact_suppression();

REVOKE ALL ON FUNCTION public.customer_contact_hash(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_customer_contact_suppression(uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_customer_contact_suppression() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_contact_hash(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_customer_contact_suppression(uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_customer_contact_suppression() TO service_role;

-- Prove it: nothing here is reachable by anon or a signed-in session.
DO $assert$
BEGIN
  IF has_table_privilege('anon', 'public.customer_contact_suppressions', 'SELECT')
     OR has_table_privilege('authenticated', 'public.customer_contact_suppressions', 'SELECT')
     OR has_function_privilege('anon', 'public.record_customer_contact_suppression(uuid[], text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_customer_contact_suppression(uuid[], text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.customer_contact_hash(text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_customer_contact_suppression()', 'EXECUTE') THEN
    RAISE EXCEPTION 'customer_contact_suppressions: reachable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.record_customer_contact_suppression(uuid[], text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'customer_contact_suppressions: service_role cannot record a suppression';
  END IF;
END
$assert$;
