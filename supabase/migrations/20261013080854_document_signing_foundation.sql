-- Document signing and agreement: foundation (tasks/plan-2026-10-12-document-signing.md).
--
-- Additive. Four new tables, two functions, one trigger function and one private storage bucket.
-- Nothing existing is altered, dropped or deleted, so the code deployed before this migration
-- keeps working unchanged.
--
--   signing_templates   Wording for the document kinds that have no generator of their own, and
--                       one row per staff policy. A template cannot be sent until it is active.
--   signing_documents   One row per document sent for signature, with the fingerprint of the
--                       exact PDF the signers were shown.
--   signing_parties     One row per person who must sign, with the evidence of how they did.
--   signing_events      The evidence trail. Append-only: a trigger refuses UPDATE and DELETE.
--
-- Every table has row security on and no policy, so only the service role can read or write.
-- Staff reach this data through server actions that check the permission of the record the
-- document belongs to. Nothing here is granted to anon or authenticated, and the public signing
-- page writes with the service role (CLAUDE.md, Security rules).
--
-- The functions run as the caller (SECURITY INVOKER) and are granted to the service role only.
-- They need no more than the service role already has, so there is nothing to elevate.

BEGIN;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind = ANY (ARRAY[
    'terms_variation'::text, 'policy_acknowledgement'::text, 'deduction_consent'::text,
    'working_time_opt_out'::text, 'guardian_consent'::text, 'job_offer'::text,
    'client_agreement'::text, 'supplier_confirmation'::text
  ])),
  -- Stable name for the template. Policies have one row each (staff-handbook, allergens, ...).
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  -- Plain text with a small set of markers (## heading, - bullet, {{merge_field}}).
  body text NOT NULL,
  -- Raised by one every time the body or title changes. Each document records the version sent.
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  -- Off until the owner has approved the wording. An inactive template cannot be sent.
  is_active boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  activated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.signing_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signing_templates FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signing_templates TO service_role;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind = ANY (ARRAY[
    'employment_agreement'::text, 'terms_variation'::text, 'policy_acknowledgement'::text,
    'deduction_consent'::text, 'working_time_opt_out'::text, 'guardian_consent'::text,
    'job_offer'::text, 'private_booking_contract'::text, 'private_booking_waiver'::text,
    'quote_acceptance'::text, 'client_agreement'::text, 'supplier_confirmation'::text
  ])),
  mode text NOT NULL CHECK (mode = ANY (ARRAY['sign'::text, 'acknowledge'::text])),
  brand text NOT NULL CHECK (brand = ANY (ARRAY['staff'::text, 'guest'::text])),
  title text NOT NULL,
  -- Short plain-English description shown above the document on the signing page.
  summary text,
  -- The record this document belongs to. No foreign key: the kinds span six tables, and a signed
  -- document must outlive the record it was signed against.
  subject_type text NOT NULL CHECK (subject_type = ANY (ARRAY[
    'employee'::text, 'private_booking'::text, 'quote'::text,
    'recruitment_application'::text, 'invoice_vendor'::text, 'vendor'::text
  ])),
  subject_id uuid NOT NULL,
  -- Which run of versions this belongs to. Usually the kind, but one employee can hold several
  -- policies and one supplier can confirm several bookings, so those carry their own key
  -- ('policy:staff-handbook', 'booking:<id>'). A new version replaces earlier ones in its series.
  series_key text NOT NULL,
  -- Counts up per subject and series, so "version 2 of the contract" means something.
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  template_id uuid REFERENCES public.signing_templates(id) ON DELETE SET NULL,
  template_version integer,
  -- Anything a completion hook needs (the booking's contract version, a related booking id).
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'sent' CHECK (status = ANY (ARRAY[
    'sent'::text, 'part_signed'::text, 'completed'::text, 'declined'::text,
    'voided'::text, 'expired'::text, 'superseded'::text
  ])),
  -- The exact PDF the signers were shown, and its SHA-256.
  source_pdf_path text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  -- The same PDF with the signing record page added, written once every party has signed.
  final_pdf_path text,
  final_sha256 text CHECK (final_sha256 IS NULL OR final_sha256 ~ '^[0-9a-f]{64}$'),
  supersedes_id uuid REFERENCES public.signing_documents(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  -- Set once the completion hook has updated the record the document belongs to, so a retry
  -- after a failure runs the hook exactly once.
  completion_applied_at timestamptz,
  -- Set when the signed copies were handed to the email provider, so they go out exactly once
  -- however many times the finishing step is retried.
  copies_sent_at timestamptz,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signing_documents_subject
  ON public.signing_documents (subject_type, subject_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_signing_documents_series_version
  ON public.signing_documents (subject_type, subject_id, series_key, version);
CREATE INDEX IF NOT EXISTS idx_signing_documents_open
  ON public.signing_documents (expires_at)
  WHERE status = ANY (ARRAY['sent'::text, 'part_signed'::text]);
CREATE INDEX IF NOT EXISTS idx_signing_documents_kind_status
  ON public.signing_documents (kind, status, created_at DESC);

ALTER TABLE public.signing_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signing_documents FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signing_documents TO service_role;

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signing_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.signing_documents(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role = ANY (ARRAY[
    'worker'::text, 'guardian'::text, 'candidate'::text, 'customer'::text,
    'client'::text, 'supplier'::text, 'company'::text
  ])),
  name text NOT NULL,
  -- Where the link was sent. Null for a party who signs in person or as the company.
  email text,
  phone text,
  employee_id uuid,
  customer_id uuid,
  -- SHA-256 of the one-time link token. The raw token is never stored.
  hashed_token text UNIQUE,
  token_expires_at timestamptz,
  -- A new starter signing by link must give the date of birth we hold before they can sign.
  identity_check text NOT NULL DEFAULT 'none' CHECK (identity_check = ANY (ARRAY['none'::text, 'date_of_birth'::text])),
  identity_check_failures integer NOT NULL DEFAULT 0,
  identity_checked_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'signed'::text, 'declined'::text])),
  first_opened_at timestamptz,
  document_viewed_at timestamptz,
  last_reminded_at timestamptz,
  reminder_count integer NOT NULL DEFAULT 0,
  -- How they signed, and the evidence.
  method text CHECK (method IS NULL OR method = ANY (ARRAY['link'::text, 'portal'::text, 'in_person'::text, 'sender'::text])),
  typed_name text,
  agreed_text text,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  signed_city text,
  signed_region text,
  signed_country text,
  -- The signed-in user, for portal signing and for the company side.
  auth_user_id uuid,
  -- The manager who handed over the device, for in-person signing.
  witnessed_by uuid,
  declined_at timestamptz,
  decline_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signing_parties_signed_has_evidence CHECK (
    status <> 'signed'
    OR (signed_at IS NOT NULL AND typed_name IS NOT NULL AND agreed_text IS NOT NULL AND method IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_signing_parties_document ON public.signing_parties (document_id);
CREATE INDEX IF NOT EXISTS idx_signing_parties_employee
  ON public.signing_parties (employee_id, status) WHERE employee_id IS NOT NULL;

ALTER TABLE public.signing_parties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signing_parties FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signing_parties TO service_role;

-- ---------------------------------------------------------------------------
-- Evidence trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.signing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.signing_documents(id) ON DELETE RESTRICT,
  party_id uuid REFERENCES public.signing_parties(id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event = ANY (ARRAY[
    'created'::text, 'sent'::text, 'opened'::text, 'document_viewed'::text,
    'identity_check_passed'::text, 'identity_check_failed'::text, 'signed'::text,
    'declined'::text, 'completed'::text, 'finalised'::text, 'reminded'::text,
    'resent'::text, 'voided'::text, 'superseded'::text, 'expired'::text, 'downloaded'::text
  ])),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- The staff member who did it, when a staff member did.
  actor_user_id uuid,
  ip text,
  user_agent text,
  city text,
  region text,
  country text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_signing_events_document ON public.signing_events (document_id, occurred_at);

ALTER TABLE public.signing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signing_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.signing_events TO service_role;

-- The trail is evidence. Once written, a row is never changed or removed, by anyone, through
-- any client. Removing records at the end of their retention period is a deliberate act by a
-- database owner, who must switch this trigger off to do it.
CREATE OR REPLACE FUNCTION public.signing_events_refuse_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION 'signing_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.signing_events_refuse_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS signing_events_append_only ON public.signing_events;
CREATE TRIGGER signing_events_append_only
  BEFORE UPDATE OR DELETE ON public.signing_events
  FOR EACH ROW EXECUTE FUNCTION public.signing_events_refuse_change();

-- ---------------------------------------------------------------------------
-- Recording a signature
-- ---------------------------------------------------------------------------

-- One transaction: lock the document, check it can still be signed, record this party's
-- signature and its event, and complete the document when nobody is left to sign. Locking the
-- document row is what makes two people signing at the same moment produce exactly one
-- completion.
--
-- Returns {ok, reason, document_id, document_status, completed}. A refusal is a normal answer,
-- not an exception, so the caller can tell the signer why in plain words.
CREATE OR REPLACE FUNCTION public.signing_record_signature(
  p_party_id uuid,
  p_typed_name text,
  p_agreed_text text,
  p_method text,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_auth_user_id uuid DEFAULT NULL,
  p_witnessed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_party public.signing_parties%ROWTYPE;
  v_doc public.signing_documents%ROWTYPE;
  v_now timestamptz := now();
  v_remaining integer;
  v_status text;
BEGIN
  IF p_typed_name IS NULL OR btrim(p_typed_name) = '' OR p_agreed_text IS NULL OR btrim(p_agreed_text) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_name_or_agreement');
  END IF;

  SELECT document_id INTO v_doc.id FROM public.signing_parties WHERE id = p_party_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_doc FROM public.signing_documents WHERE id = v_doc.id FOR UPDATE;
  SELECT * INTO v_party FROM public.signing_parties WHERE id = p_party_id FOR UPDATE;

  IF v_party.status = 'signed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_signed', 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;
  IF v_party.status = 'declined' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_declined', 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;
  IF v_doc.status <> ALL (ARRAY['sent'::text, 'part_signed'::text]) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'document_' || v_doc.status, 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;
  IF v_doc.expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'document_expired', 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;
  -- An in-person session is a short-lived link on a device a manager handed over, so it expires
  -- like any other link. Only portal signing (a signed-in worker) and the sender have no link.
  IF p_method = ANY (ARRAY['link'::text, 'in_person'::text]) AND (v_party.token_expires_at IS NULL OR v_party.token_expires_at <= v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'link_expired', 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;
  IF v_party.identity_check <> 'none' AND v_party.identity_checked_at IS NULL AND p_method = 'link' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'identity_not_checked', 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;
  -- The company side signs as it sends, before anyone has opened anything. Everyone else must
  -- have opened the document first.
  IF p_method <> 'sender' AND v_party.document_viewed_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'document_not_viewed', 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;

  UPDATE public.signing_parties
  SET status = 'signed',
      method = p_method,
      typed_name = btrim(p_typed_name),
      agreed_text = p_agreed_text,
      signed_at = v_now,
      signed_ip = p_ip,
      signed_user_agent = p_user_agent,
      signed_city = p_city,
      signed_region = p_region,
      signed_country = p_country,
      auth_user_id = COALESCE(p_auth_user_id, auth_user_id),
      witnessed_by = p_witnessed_by,
      -- A signed link is spent.
      token_expires_at = CASE WHEN hashed_token IS NULL THEN token_expires_at ELSE v_now END,
      updated_at = v_now
  WHERE id = p_party_id;

  INSERT INTO public.signing_events (document_id, party_id, event, occurred_at, actor_user_id, ip, user_agent, city, region, country, meta)
  VALUES (v_doc.id, p_party_id, 'signed', v_now, COALESCE(p_witnessed_by, p_auth_user_id), p_ip, p_user_agent, p_city, p_region, p_country,
          jsonb_build_object('method', p_method, 'typed_name', btrim(p_typed_name)));

  SELECT count(*) INTO v_remaining
  FROM public.signing_parties
  WHERE document_id = v_doc.id AND status <> 'signed';

  IF v_remaining = 0 THEN
    v_status := 'completed';
    UPDATE public.signing_documents
    SET status = 'completed', completed_at = v_now, updated_at = v_now
    WHERE id = v_doc.id;
    INSERT INTO public.signing_events (document_id, event, occurred_at)
    VALUES (v_doc.id, 'completed', v_now);
  ELSE
    v_status := 'part_signed';
    UPDATE public.signing_documents
    SET status = 'part_signed', updated_at = v_now
    WHERE id = v_doc.id AND status = 'sent';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'document_id', v_doc.id,
    'document_status', v_status,
    'completed', v_remaining = 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.signing_record_signature(uuid, text, text, text, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signing_record_signature(uuid, text, text, text, text, text, text, text, text, uuid, uuid) TO service_role;

-- A signer saying no. The document stops there: one refusal means it cannot complete, so the
-- other parties are not left signing something that will never take effect.
CREATE OR REPLACE FUNCTION public.signing_record_decline(
  p_party_id uuid,
  p_reason text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_country text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_party public.signing_parties%ROWTYPE;
  v_doc public.signing_documents%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT document_id INTO v_doc.id FROM public.signing_parties WHERE id = p_party_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT * INTO v_doc FROM public.signing_documents WHERE id = v_doc.id FOR UPDATE;
  SELECT * INTO v_party FROM public.signing_parties WHERE id = p_party_id FOR UPDATE;

  IF v_party.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_' || v_party.status, 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;
  IF v_doc.status <> ALL (ARRAY['sent'::text, 'part_signed'::text]) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'document_' || v_doc.status, 'document_id', v_doc.id, 'document_status', v_doc.status);
  END IF;

  UPDATE public.signing_parties
  SET status = 'declined',
      declined_at = v_now,
      decline_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
      token_expires_at = CASE WHEN hashed_token IS NULL THEN token_expires_at ELSE v_now END,
      updated_at = v_now
  WHERE id = p_party_id;

  UPDATE public.signing_documents
  SET status = 'declined', updated_at = v_now
  WHERE id = v_doc.id;

  INSERT INTO public.signing_events (document_id, party_id, event, occurred_at, ip, user_agent, city, region, country, meta)
  VALUES (v_doc.id, p_party_id, 'declined', v_now, p_ip, p_user_agent, p_city, p_region, p_country,
          jsonb_build_object('reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));

  RETURN jsonb_build_object('ok', true, 'document_id', v_doc.id, 'document_status', 'declined');
END;
$$;

REVOKE ALL ON FUNCTION public.signing_record_decline(uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.signing_record_decline(uuid, text, text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Private bucket for the PDFs sent for signature and the signed copies. No storage policies are
-- created: access is service-role only, through server code that has already checked who is
-- asking (row security denies anon and authenticated by default). Same arrangement as
-- private-booking-documents.
INSERT INTO storage.buckets (id, name, public)
VALUES ('signed-documents', 'signed-documents', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
