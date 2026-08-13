-- B2B marketing email: core tables.
--
-- Design notes that matter for anyone changing this later:
--
-- * business_contacts is deliberately NOT linked to customers. Customers are consumers
--   with their own consent columns; these are businesses. Mixing them was how the venue
--   would have ended up marketing to guests who only ever booked a table.
--
-- * eligibility_status defaults to 'pending_review', not 'eligible'. An email domain
--   cannot tell you whether the subscriber is a limited company (no PECR consent needed)
--   or a sole trader (consent or a full soft opt-in needed), so an import is never
--   allowed to decide that on its own. A human sets eligibility before anything sends.
--
-- * marketing_do_not_contact keeps a hash of the address after an objection so a later
--   import cannot resurrect someone who unsubscribed. It is deliberately separate from
--   email_suppressions: that table blocks ALL mail including booking confirmations, and
--   an unsubscribe from marketing must never do that.

BEGIN;

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.business_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stored already normalised (lower/trim) by normalise_business_contact_email().
  email text NOT NULL,
  contact_name text,
  first_name text,
  company_name text,
  job_title text,
  invoice_vendor_id uuid REFERENCES public.invoice_vendors(id) ON DELETE SET NULL,

  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('csv_import', 'manual', 'invoice_vendor')),
  source_detail text,
  collected_at timestamptz,
  tags text[] NOT NULL DEFAULT '{}',

  -- Eligibility: who they are and whether we may lawfully market to them.
  subscriber_type text NOT NULL DEFAULT 'unknown'
    CHECK (subscriber_type IN ('corporate', 'individual', 'unknown')),
  subscriber_type_verified_at timestamptz,
  marketing_basis text
    CHECK (marketing_basis IS NULL OR marketing_basis IN ('legitimate_interest', 'consent', 'soft_opt_in')),
  basis_evidence text,
  privacy_notice_sent_at timestamptz,
  eligibility_status text NOT NULL DEFAULT 'pending_review'
    CHECK (eligibility_status IN ('pending_review', 'eligible', 'excluded')),
  eligibility_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  eligibility_reviewed_at timestamptz,
  eligibility_note text,
  -- Review hint only. A free-mail domain does not prove a sole trader, and a company
  -- domain does not prove a limited company, so this never gates a send on its own.
  is_freemail boolean NOT NULL DEFAULT false,

  -- Marketing state.
  marketing_status text NOT NULL DEFAULT 'subscribed'
    CHECK (marketing_status IN ('subscribed', 'unsubscribed', 'bounced', 'complained')),
  unsubscribed_at timestamptz,
  resubscribed_at timestamptz,
  resubscribe_note text,
  last_marketing_email_at timestamptz,
  last_marketing_campaign_id uuid,
  unsubscribe_campaign_id uuid,

  -- Frequency-cap reservation. Held across the provider call so two campaigns due in the
  -- same window cannot both send to this contact.
  marketing_reserved_until timestamptz,

  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT business_contacts_email_len CHECK (char_length(email) BETWEEN 3 AND 320),
  CONSTRAINT business_contacts_email_shape CHECK (email LIKE '%_@_%'),
  CONSTRAINT business_contacts_email_normalised CHECK (email = lower(btrim(email))),
  CONSTRAINT business_contacts_notes_len CHECK (notes IS NULL OR char_length(notes) <= 4000),
  CONSTRAINT business_contacts_tags_len CHECK (array_length(tags, 1) IS NULL OR array_length(tags, 1) <= 40),
  -- An unsubscribed or objecting contact must carry the timestamp that proves when.
  CONSTRAINT business_contacts_unsub_timestamp
    CHECK (marketing_status <> 'unsubscribed' OR unsubscribed_at IS NOT NULL),
  -- Eligible contacts must record who decided and on what basis.
  CONSTRAINT business_contacts_eligible_evidence
    CHECK (
      eligibility_status <> 'eligible'
      OR (marketing_basis IS NOT NULL AND eligibility_reviewed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS business_contacts_email_key
  ON public.business_contacts (email);
CREATE INDEX IF NOT EXISTS business_contacts_tags_idx
  ON public.business_contacts USING gin (tags);
CREATE INDEX IF NOT EXISTS business_contacts_sendable_idx
  ON public.business_contacts (eligibility_status, marketing_status);
CREATE INDEX IF NOT EXISTS business_contacts_unsub_attribution_idx
  ON public.business_contacts (unsubscribe_campaign_id, unsubscribed_at)
  WHERE unsubscribe_campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Do-not-contact: survives erasure so an objection cannot be undone by a re-import
-- ---------------------------------------------------------------------------

-- Retaining the address itself is the point of this table: you cannot screen a new import
-- against an objection you can no longer recognise. Keeping it is a different purpose from
-- marketing (it exists to STOP marketing), which is why erasure empties the contact record
-- but leaves this row standing. email_hash is a stable secondary key so the row still
-- identifies the objection if the address is ever redacted.
CREATE TABLE IF NOT EXISTS public.marketing_do_not_contact (
  email_normalised text PRIMARY KEY,
  email_hash text NOT NULL,
  reason text NOT NULL
    CHECK (reason IN ('unsubscribe', 'complaint', 'bounce', 'manual', 'erasure')),
  source text,
  campaign_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  removed_at timestamptz,
  removed_by uuid,
  removal_note text,
  CONSTRAINT marketing_dnc_email_normalised CHECK (email_normalised = lower(btrim(email_normalised))),
  CONSTRAINT marketing_dnc_hash_shape CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  -- Removing an entry means someone has re-consented; make them say why.
  CONSTRAINT marketing_dnc_removal_note CHECK (removed_at IS NULL OR removal_note IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS marketing_dnc_active_idx
  ON public.marketing_do_not_contact (email_normalised) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  subject text NOT NULL,
  preheader text NOT NULL,

  -- Block JSON validated in code against the renderer's schema. No default: an empty
  -- object is not renderable, and a default that cannot render is a trap.
  content jsonb NOT NULL,
  content_schema_version integer NOT NULL DEFAULT 1,
  renderer_version text NOT NULL DEFAULT 'v1',
  content_hash text,

  -- { "include_tags": [...], "exclude_tags": [...] }
  -- Include tags match on ANY (OR). Exclude tags remove on ANY match. Empty include list
  -- means every eligible contact.
  audience jsonb NOT NULL DEFAULT '{"include_tags": [], "exclude_tags": []}'::jsonb,
  audience_version integer NOT NULL DEFAULT 1,
  approved_recipient_count integer,

  -- Short links provisioned at schedule time: { "<destination>": "<short url>" }.
  -- Resolved before sending so rendering stays pure and offline.
  link_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  utm_campaign text,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'paused', 'completed', 'cancelled')),
  scheduled_for timestamptz,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paused_at timestamptz,
  paused_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT marketing_campaigns_name_len CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT marketing_campaigns_subject_len CHECK (char_length(subject) BETWEEN 1 AND 300),
  CONSTRAINT marketing_campaigns_preheader_len CHECK (char_length(preheader) BETWEEN 1 AND 300),
  CONSTRAINT marketing_campaigns_content_size CHECK (pg_column_size(content) <= 1048576),
  -- Anything past draft must carry its send time and be frozen.
  CONSTRAINT marketing_campaigns_scheduled_fields
    CHECK (
      status IN ('draft', 'cancelled')
      OR (scheduled_for IS NOT NULL AND locked_at IS NOT NULL AND content_hash IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS marketing_campaigns_due_idx
  ON public.marketing_campaigns (status, scheduled_for);

ALTER TABLE public.business_contacts
  ADD CONSTRAINT business_contacts_last_campaign_fk
  FOREIGN KEY (last_marketing_campaign_id)
  REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL;

ALTER TABLE public.business_contacts
  ADD CONSTRAINT business_contacts_unsub_campaign_fk
  FOREIGN KEY (unsubscribe_campaign_id)
  REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Per-recipient send state, which doubles as the send queue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketing_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.business_contacts(id) ON DELETE CASCADE,
  -- Snapshot of the address at audience time, so a later edit cannot silently redirect a
  -- send that a human already approved.
  email text NOT NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'needs_review')),
  skip_reason text
    CHECK (skip_reason IS NULL OR skip_reason IN (
      'unsubscribed', 'suppressed', 'do_not_contact', 'frequency_cap',
      'not_eligible', 'campaign_cancelled'
    )),

  -- Linkage for statistics and webhook attribution.
  email_message_id uuid REFERENCES public.email_messages(id) ON DELETE SET NULL,
  provider_message_id text,

  -- Retry/lease state.
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  failure_class text
    CHECK (failure_class IS NULL OR failure_class IN ('retryable', 'terminal', 'unknown')),
  error text,

  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (campaign_id, contact_id),
  CONSTRAINT mcr_error_len CHECK (error IS NULL OR char_length(error) <= 2000),
  CONSTRAINT mcr_sent_has_timestamp CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT mcr_skipped_has_reason CHECK (status <> 'skipped' OR skip_reason IS NOT NULL)
);

-- Claim path: oldest pending first, only rows whose backoff has elapsed.
CREATE INDEX IF NOT EXISTS mcr_pending_claim_idx
  ON public.marketing_campaign_recipients (created_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS mcr_lease_recovery_idx
  ON public.marketing_campaign_recipients (lease_expires_at)
  WHERE status = 'sending';
CREATE INDEX IF NOT EXISTS mcr_campaign_status_idx
  ON public.marketing_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS mcr_email_message_idx
  ON public.marketing_campaign_recipients (email_message_id)
  WHERE email_message_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Settings: the kill switch. One row, enforced.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Ships OFF. Sending stays impossible until a human turns it on in the UI.
  sends_enabled boolean NOT NULL DEFAULT false,
  send_window_start_hour integer NOT NULL DEFAULT 9
    CHECK (send_window_start_hour BETWEEN 0 AND 23),
  send_window_end_hour integer NOT NULL DEFAULT 18
    CHECK (send_window_end_hour BETWEEN 1 AND 24),
  send_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  frequency_cap_days integer NOT NULL DEFAULT 7
    CHECK (frequency_cap_days BETWEEN 0 AND 365),
  batch_size integer NOT NULL DEFAULT 25
    CHECK (batch_size BETWEEN 1 AND 200),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_settings_window_order CHECK (send_window_end_hour > send_window_start_hour)
);

INSERT INTO public.marketing_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Import audit: every row's decision, so a bad import can be explained and undone
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.marketing_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text,
  row_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.marketing_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.marketing_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  email text,
  decision text NOT NULL
    CHECK (decision IN ('imported', 'updated', 'skipped_duplicate', 'skipped_do_not_contact', 'skipped_invalid')),
  reason text,
  contact_id uuid REFERENCES public.business_contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_import_rows_batch_idx
  ON public.marketing_import_rows (batch_id, row_number);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.touch_marketing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalise_business_contact_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.email = lower(btrim(NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_contacts_normalise_email ON public.business_contacts;
CREATE TRIGGER business_contacts_normalise_email
  BEFORE INSERT OR UPDATE OF email ON public.business_contacts
  FOR EACH ROW EXECUTE FUNCTION public.normalise_business_contact_email();

DROP TRIGGER IF EXISTS business_contacts_touch_updated_at ON public.business_contacts;
CREATE TRIGGER business_contacts_touch_updated_at
  BEFORE UPDATE ON public.business_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_marketing_updated_at();

DROP TRIGGER IF EXISTS marketing_campaigns_touch_updated_at ON public.marketing_campaigns;
CREATE TRIGGER marketing_campaigns_touch_updated_at
  BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_marketing_updated_at();

DROP TRIGGER IF EXISTS mcr_touch_updated_at ON public.marketing_campaign_recipients;
CREATE TRIGGER mcr_touch_updated_at
  BEFORE UPDATE ON public.marketing_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.touch_marketing_updated_at();

-- ---------------------------------------------------------------------------
-- Access: service-role only. All reads go through server actions that check RBAC first,
-- so there is no reason to expose contact data to every signed-in browser session.
-- ---------------------------------------------------------------------------

ALTER TABLE public.business_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_do_not_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_import_rows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_contacts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_do_not_contact FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_campaigns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_campaign_recipients FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_import_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.marketing_import_rows FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.business_contacts TO service_role;
GRANT ALL ON public.marketing_do_not_contact TO service_role;
GRANT ALL ON public.marketing_campaigns TO service_role;
GRANT ALL ON public.marketing_campaign_recipients TO service_role;
GRANT ALL ON public.marketing_settings TO service_role;
GRANT ALL ON public.marketing_import_batches TO service_role;
GRANT ALL ON public.marketing_import_rows TO service_role;

COMMIT;
