-- Stand-in for the production objects the receipts migrations touch. Table shapes, defaults,
-- constraints, unique indexes and triggers copied from the live catalogue on 1 October 2026
-- (project tfcasgxopxegwrabvwat). Non-unique indexes are left out: they change no behaviour.
-- Throwaway test harness only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Supabase grants EXECUTE on new public functions to anon and authenticated by name, so a
-- REVOKE from PUBLIC alone leaves them callable. Reproduce that, or grant tests prove nothing.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);

CREATE TYPE public.receipt_transaction_status AS ENUM (
  'pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find'
);

-- Minimal stand-ins for the invoice tables the receipts tables reference.
CREATE TABLE public.invoice_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name character varying(200) NOT NULL
);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  vendor_id uuid REFERENCES public.invoice_vendors(id),
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'sent',
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  deleted_at timestamptz
);
CREATE TABLE public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id),
  amount numeric(12,2) NOT NULL,
  payment_date date NOT NULL,
  payment_method text,
  reference text,
  notes text
);

-- Stand-in for the invoice ledger function (20260918124021). The real one also checks the
-- caller's permission, takes the invoice settlement lock and lets triggers work out the paid
-- amount. What the receipts functions rely on is kept: one payment row per call, a refusal when
-- the invoice cannot take the money, and the payment returned as JSON.
CREATE FUNCTION public.record_invoice_payment_transaction(p_payment_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_payment public.invoice_payments%ROWTYPE;
  v_invoice_id uuid := (p_payment_data->>'invoice_id')::uuid;
  v_amount numeric := (p_payment_data->>'amount')::numeric;
  v_paid numeric;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = v_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice.deleted_at IS NOT NULL OR v_invoice.status IN ('void', 'written_off') THEN
    RAISE EXCEPTION 'invoice_not_payable';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM public.invoice_payments WHERE invoice_id = v_invoice_id;
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'invalid_payment_amount';
  END IF;
  IF v_amount > v_invoice.total_amount - v_paid THEN
    RAISE EXCEPTION 'Payment amount exceeds outstanding balance';
  END IF;
  INSERT INTO public.invoice_payments (invoice_id, payment_date, amount, payment_method, reference, notes)
  VALUES (v_invoice_id, (p_payment_data->>'payment_date')::date, v_amount,
    p_payment_data->>'payment_method', p_payment_data->>'reference', p_payment_data->>'notes')
  RETURNING * INTO v_payment;
  UPDATE public.invoices
  SET paid_amount = v_paid + v_amount,
      status = CASE WHEN v_paid + v_amount >= total_amount THEN 'paid' ELSE 'partially_paid' END
  WHERE id = v_invoice_id;
  RETURN to_jsonb(v_payment);
END;
$$;

-- The shared job queue table, as the live catalogue has it.
CREATE TABLE public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type character varying(50) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status character varying(20) DEFAULT 'pending'::character varying,
  attempts integer DEFAULT 0,
  max_attempts integer DEFAULT 3,
  scheduled_for timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  failed_at timestamp with time zone,
  error_message text,
  result jsonb,
  priority integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  processing_token uuid,
  lease_expires_at timestamp with time zone,
  last_heartbeat_at timestamp with time zone,
  CONSTRAINT jobs_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text, ('cancelled'::character varying)::text])))
);

CREATE FUNCTION public.set_receipt_row_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- As in production (pg_get_functiondef, 1 October 2026).
CREATE FUNCTION public.normalize_receipt_vendor_key(input text) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
  SELECT NULLIF(LOWER(REGEXP_REPLACE(BTRIM(COALESCE(input, '')), '[[:space:]]+', ' ', 'g')), '');
$$;

CREATE FUNCTION public.normalize_receipt_details(p_details text) RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result TEXT;
BEGIN
  IF p_details IS NULL THEN
    RETURN NULL;
  END IF;
  v_result := p_details;
  v_result := regexp_replace(v_result, '[*/][A-Z0-9]{4,10}\s*$', '', 'i');
  v_result := regexp_replace(v_result, '\s+\d{6,}\s*$', '');
  RETURN TRIM(v_result);
END;
$function$;

CREATE TABLE public.receipt_batches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  uploaded_by uuid,
  original_filename text NOT NULL,
  source_hash text NOT NULL,
  row_count integer DEFAULT 0 NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  source_type text DEFAULT 'bank'::text NOT NULL
);
CREATE TABLE public.receipt_classification_signals (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  transaction_id uuid NOT NULL,
  source text NOT NULL,
  signal_type text NOT NULL,
  prior_vendor_id uuid,
  new_vendor_id uuid,
  prior_vendor_name text,
  new_vendor_name text,
  prior_expense_category text,
  new_expense_category text,
  prior_status receipt_transaction_status,
  new_status receipt_transaction_status,
  rule_id uuid,
  ai_confidence integer,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  performed_by uuid,
  performed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.receipt_files (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  transaction_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes integer,
  uploaded_by uuid,
  uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
  content_hash text,
  hash_verified_at timestamp with time zone
);
CREATE TABLE public.receipt_invoice_matches (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  receipt_transaction_id uuid NOT NULL,
  invoice_id uuid,
  invoice_payment_id uuid,
  invoice_number text NOT NULL,
  match_status text DEFAULT 'matched'::text NOT NULL,
  amount_match boolean DEFAULT false NOT NULL,
  transaction_date date NOT NULL,
  matched_amount numeric(12,2),
  invoice_total_amount numeric(12,2),
  invoice_paid_amount_before numeric(12,2),
  matched_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE TABLE public.receipt_rule_conflicts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  rule_id uuid NOT NULL,
  overlapping_rule_id uuid NOT NULL,
  overlap_count integer DEFAULT 0 NOT NULL,
  same_priority boolean DEFAULT false NOT NULL,
  sample_transaction_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
  detected_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone
);
CREATE TABLE public.receipt_rule_suggestions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  suggested_name text NOT NULL,
  match_description text,
  match_transaction_type text,
  match_direction text DEFAULT 'both'::text NOT NULL,
  match_min_amount numeric(12,2),
  match_max_amount numeric(12,2),
  set_vendor_id uuid,
  set_vendor_name text,
  set_expense_category text,
  auto_status receipt_transaction_status DEFAULT 'pending'::receipt_transaction_status NOT NULL,
  evidence_transaction_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
  evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
  approved_rule_id uuid,
  declined_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  reviewed_at timestamp with time zone,
  reviewed_by uuid
);
CREATE TABLE public.receipt_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  match_description text,
  match_transaction_type text,
  match_direction text DEFAULT 'both'::text NOT NULL,
  match_min_amount numeric(12,2),
  match_max_amount numeric(12,2),
  auto_status receipt_transaction_status DEFAULT 'no_receipt_required'::receipt_transaction_status NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  set_vendor_name text,
  set_expense_category text,
  priority integer DEFAULT 1000 NOT NULL,
  kind text DEFAULT 'standard'::text NOT NULL,
  vendor_id uuid,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  deactivated_at timestamp with time zone,
  deactivated_by uuid
);
CREATE TABLE public.receipt_transaction_logs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  transaction_id uuid NOT NULL,
  previous_status receipt_transaction_status,
  new_status receipt_transaction_status,
  action_type text NOT NULL,
  note text,
  performed_by uuid,
  rule_id uuid,
  performed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.receipt_transactions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  batch_id uuid,
  transaction_date date NOT NULL,
  details text NOT NULL,
  transaction_type text,
  amount_in numeric(12,2),
  amount_out numeric(12,2),
  balance numeric(14,2),
  dedupe_hash text NOT NULL,
  status receipt_transaction_status DEFAULT 'pending'::receipt_transaction_status NOT NULL,
  receipt_required boolean DEFAULT true NOT NULL,
  marked_by uuid,
  marked_by_email text,
  marked_by_name text,
  marked_at timestamp with time zone,
  marked_method text,
  rule_applied_id uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  vendor_name text,
  vendor_source text,
  vendor_rule_id uuid,
  vendor_updated_at timestamp with time zone,
  expense_category text,
  expense_category_source text,
  expense_rule_id uuid,
  expense_updated_at timestamp with time zone,
  amount_total numeric(12,2) GENERATED ALWAYS AS (COALESCE(amount_out, amount_in)) STORED,
  ai_confidence smallint,
  ai_suggested_keywords text,
  vendor_id uuid,
  auto_completed_reason text,
  source_type text DEFAULT 'bank'::text NOT NULL,
  card_member text,
  card_account text,
  merchant_category text,
  merchant_town text,
  external_reference text
);
CREATE TABLE public.receipt_upload_intents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  transaction_id uuid NOT NULL,
  storage_path text NOT NULL,
  issued_to uuid NOT NULL,
  original_file_name text,
  file_type text,
  file_size_bytes bigint,
  issued_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  receipt_file_id uuid
);
CREATE TABLE public.receipt_vendor_aliases (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  vendor_id uuid NOT NULL,
  alias text NOT NULL,
  alias_key text NOT NULL,
  source text DEFAULT 'migration'::text NOT NULL,
  confidence smallint,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.receipt_vendor_reviews (
  user_id uuid NOT NULL,
  vendor_key text NOT NULL,
  vendor_label text NOT NULL,
  comparison text NOT NULL,
  month_start date NOT NULL,
  status text DEFAULT 'needs_review'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.receipt_vendor_watchlist (
  user_id uuid NOT NULL,
  vendor_key text NOT NULL,
  vendor_label text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.receipt_vendors (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  canonical_name text NOT NULL,
  vendor_key text NOT NULL,
  status text DEFAULT 'unconfirmed'::text NOT NULL,
  invoice_vendor_id uuid,
  merged_into_vendor_id uuid,
  category_hint text,
  default_expense_category text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.receipt_batches ADD CONSTRAINT receipt_batches_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_batches ADD CONSTRAINT receipt_batches_source_type_check CHECK ((source_type = ANY (ARRAY['bank'::text, 'amex'::text])));
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_ai_confidence_check CHECK (((ai_confidence IS NULL) OR ((ai_confidence >= 0) AND (ai_confidence <= 100))));
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_source_check CHECK ((source = ANY (ARRAY['rule'::text, 'ai'::text, 'human'::text, 'migration'::text, 'system'::text])));
ALTER TABLE public.receipt_files ADD CONSTRAINT receipt_files_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_invoice_matches ADD CONSTRAINT receipt_invoice_matches_match_status_check CHECK ((match_status = ANY (ARRAY['matched'::text, 'payment_recorded'::text, 'already_paid'::text, 'missing_invoice'::text, 'multiple_invoice_refs'::text, 'amount_mismatch'::text, 'review_required'::text])));
ALTER TABLE public.receipt_invoice_matches ADD CONSTRAINT receipt_invoice_matches_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_rule_conflicts ADD CONSTRAINT receipt_rule_conflicts_pair_order CHECK (((rule_id)::text < (overlapping_rule_id)::text));
ALTER TABLE public.receipt_rule_conflicts ADD CONSTRAINT receipt_rule_conflicts_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_rule_conflicts ADD CONSTRAINT receipt_rule_conflicts_unique_pair UNIQUE (rule_id, overlapping_rule_id);
ALTER TABLE public.receipt_rule_suggestions ADD CONSTRAINT receipt_rule_suggestions_match_direction_check CHECK ((match_direction = ANY (ARRAY['in'::text, 'out'::text, 'both'::text])));
ALTER TABLE public.receipt_rule_suggestions ADD CONSTRAINT receipt_rule_suggestions_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_rule_suggestions ADD CONSTRAINT receipt_rule_suggestions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'expired'::text])));
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_expense_category_valid CHECK (((set_expense_category IS NULL) OR (set_expense_category = ANY (ARRAY['Total Staff'::text, 'Business Rate'::text, 'Water Rates'::text, 'Heat/Light/Power'::text, 'Premises Repairs/Maintenance'::text, 'Equipment Repairs/Maintenance'::text, 'Gardening Expenses'::text, 'Buildings Insurance'::text, 'Maintenance and Service Plan Charges'::text, 'Licensing'::text, 'Tenant Insurance'::text, 'Entertainment'::text, 'Sky / PRS / Vidimix'::text, 'Marketing/Promotion/Advertising'::text, 'Print/Post Stationary'::text, 'Telephone'::text, 'Travel/Car'::text, 'Waste Disposal/Cleaning/Hygiene'::text, 'Third Party Booking Fee'::text, 'Accountant/StockTaker/Professional Fees'::text, 'Bank Charges/Credit Card Commission'::text, 'Equipment Hire'::text, 'Sundries/Consumables'::text, 'Drinks Gas'::text]))));
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_kind_check CHECK ((kind = ANY (ARRAY['standard'::text, 'payroll'::text, 'tax'::text, 'income_settlement'::text, 'utility'::text, 'bank_fee'::text, 'receipt_not_required'::text])));
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_match_direction_check CHECK ((match_direction = ANY (ARRAY['in'::text, 'out'::text, 'both'::text])));
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_transaction_logs ADD CONSTRAINT receipt_transaction_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_amount_non_negative CHECK ((((amount_in IS NULL) OR (amount_in >= (0)::numeric)) AND ((amount_out IS NULL) OR (amount_out >= (0)::numeric))));
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_ai_confidence_check CHECK (((ai_confidence IS NULL) OR ((ai_confidence >= 0) AND (ai_confidence <= 100))));
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_expense_category_source_check CHECK (((expense_category_source IS NULL) OR (expense_category_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text]))));
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_expense_category_valid CHECK (((expense_category IS NULL) OR (expense_category = ANY (ARRAY['Total Staff'::text, 'Business Rate'::text, 'Water Rates'::text, 'Heat/Light/Power'::text, 'Premises Repairs/Maintenance'::text, 'Equipment Repairs/Maintenance'::text, 'Gardening Expenses'::text, 'Buildings Insurance'::text, 'Maintenance and Service Plan Charges'::text, 'Licensing'::text, 'Tenant Insurance'::text, 'Entertainment'::text, 'Sky / PRS / Vidimix'::text, 'Marketing/Promotion/Advertising'::text, 'Print/Post Stationary'::text, 'Telephone'::text, 'Travel/Car'::text, 'Waste Disposal/Cleaning/Hygiene'::text, 'Third Party Booking Fee'::text, 'Accountant/StockTaker/Professional Fees'::text, 'Bank Charges/Credit Card Commission'::text, 'Equipment Hire'::text, 'Sundries/Consumables'::text, 'Drinks Gas'::text]))));
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_source_type_check CHECK ((source_type = ANY (ARRAY['bank'::text, 'amex'::text])));
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_vendor_source_check CHECK (((vendor_source IS NULL) OR (vendor_source = ANY (ARRAY['ai'::text, 'manual'::text, 'rule'::text, 'import'::text]))));
ALTER TABLE public.receipt_upload_intents ADD CONSTRAINT receipt_upload_intents_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_vendor_aliases ADD CONSTRAINT receipt_vendor_aliases_alias_key_key UNIQUE (alias_key);
ALTER TABLE public.receipt_vendor_aliases ADD CONSTRAINT receipt_vendor_aliases_alias_not_empty CHECK ((btrim(alias) <> ''::text));
ALTER TABLE public.receipt_vendor_aliases ADD CONSTRAINT receipt_vendor_aliases_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= 0) AND (confidence <= 100))));
ALTER TABLE public.receipt_vendor_aliases ADD CONSTRAINT receipt_vendor_aliases_key_not_empty CHECK ((btrim(alias_key) <> ''::text));
ALTER TABLE public.receipt_vendor_aliases ADD CONSTRAINT receipt_vendor_aliases_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_vendor_aliases ADD CONSTRAINT receipt_vendor_aliases_source_check CHECK ((source = ANY (ARRAY['migration'::text, 'manual'::text, 'rule'::text, 'ai'::text, 'system'::text])));
ALTER TABLE public.receipt_vendor_reviews ADD CONSTRAINT receipt_vendor_reviews_comparison_valid CHECK ((comparison = ANY (ARRAY['mom'::text, 'yoy'::text, 'rolling_3m'::text])));
ALTER TABLE public.receipt_vendor_reviews ADD CONSTRAINT receipt_vendor_reviews_pk PRIMARY KEY (user_id, vendor_key, comparison, month_start);
ALTER TABLE public.receipt_vendor_reviews ADD CONSTRAINT receipt_vendor_reviews_status_valid CHECK ((status = ANY (ARRAY['needs_review'::text, 'expected'::text, 'action_required'::text, 'reviewed'::text])));
ALTER TABLE public.receipt_vendor_reviews ADD CONSTRAINT receipt_vendor_reviews_vendor_key_not_empty CHECK ((btrim(vendor_key) <> ''::text));
ALTER TABLE public.receipt_vendor_reviews ADD CONSTRAINT receipt_vendor_reviews_vendor_label_not_empty CHECK ((btrim(vendor_label) <> ''::text));
ALTER TABLE public.receipt_vendor_watchlist ADD CONSTRAINT receipt_vendor_watchlist_pk PRIMARY KEY (user_id, vendor_key);
ALTER TABLE public.receipt_vendor_watchlist ADD CONSTRAINT receipt_vendor_watchlist_vendor_key_not_empty CHECK ((btrim(vendor_key) <> ''::text));
ALTER TABLE public.receipt_vendor_watchlist ADD CONSTRAINT receipt_vendor_watchlist_vendor_label_not_empty CHECK ((btrim(vendor_label) <> ''::text));
ALTER TABLE public.receipt_vendors ADD CONSTRAINT receipt_vendors_key_not_empty CHECK ((btrim(vendor_key) <> ''::text));
ALTER TABLE public.receipt_vendors ADD CONSTRAINT receipt_vendors_name_not_empty CHECK ((btrim(canonical_name) <> ''::text));
ALTER TABLE public.receipt_vendors ADD CONSTRAINT receipt_vendors_pkey PRIMARY KEY (id);
ALTER TABLE public.receipt_vendors ADD CONSTRAINT receipt_vendors_status_check CHECK ((status = ANY (ARRAY['unconfirmed'::text, 'confirmed'::text, 'merged'::text, 'inactive'::text])));
ALTER TABLE public.receipt_vendors ADD CONSTRAINT receipt_vendors_vendor_key_key UNIQUE (vendor_key);

ALTER TABLE public.receipt_batches ADD CONSTRAINT receipt_batches_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_new_vendor_id_fkey FOREIGN KEY (new_vendor_id) REFERENCES receipt_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_prior_vendor_id_fkey FOREIGN KEY (prior_vendor_id) REFERENCES receipt_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES receipt_rules(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_classification_signals ADD CONSTRAINT receipt_classification_signals_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES receipt_transactions(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_files ADD CONSTRAINT receipt_files_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES receipt_transactions(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_files ADD CONSTRAINT receipt_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_invoice_matches ADD CONSTRAINT receipt_invoice_matches_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_invoice_matches ADD CONSTRAINT receipt_invoice_matches_invoice_payment_id_fkey FOREIGN KEY (invoice_payment_id) REFERENCES invoice_payments(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_invoice_matches ADD CONSTRAINT receipt_invoice_matches_receipt_transaction_id_fkey FOREIGN KEY (receipt_transaction_id) REFERENCES receipt_transactions(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_rule_conflicts ADD CONSTRAINT receipt_rule_conflicts_overlapping_rule_id_fkey FOREIGN KEY (overlapping_rule_id) REFERENCES receipt_rules(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_rule_conflicts ADD CONSTRAINT receipt_rule_conflicts_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES receipt_rules(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_rule_suggestions ADD CONSTRAINT receipt_rule_suggestions_approved_rule_id_fkey FOREIGN KEY (approved_rule_id) REFERENCES receipt_rules(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_rule_suggestions ADD CONSTRAINT receipt_rule_suggestions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_rule_suggestions ADD CONSTRAINT receipt_rule_suggestions_set_vendor_id_fkey FOREIGN KEY (set_vendor_id) REFERENCES receipt_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_deactivated_by_fkey FOREIGN KEY (deactivated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_rules ADD CONSTRAINT receipt_rules_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES receipt_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transaction_logs ADD CONSTRAINT receipt_transaction_logs_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transaction_logs ADD CONSTRAINT receipt_transaction_logs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES receipt_rules(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transaction_logs ADD CONSTRAINT receipt_transaction_logs_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES receipt_transactions(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES receipt_batches(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_expense_rule_id_fkey FOREIGN KEY (expense_rule_id) REFERENCES receipt_rules(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_rule_applied_id_fkey FOREIGN KEY (rule_applied_id) REFERENCES receipt_rules(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES receipt_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_transactions ADD CONSTRAINT receipt_transactions_vendor_rule_id_fkey FOREIGN KEY (vendor_rule_id) REFERENCES receipt_rules(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_upload_intents ADD CONSTRAINT receipt_upload_intents_receipt_file_id_fkey FOREIGN KEY (receipt_file_id) REFERENCES receipt_files(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_upload_intents ADD CONSTRAINT receipt_upload_intents_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES receipt_transactions(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_vendor_aliases ADD CONSTRAINT receipt_vendor_aliases_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES receipt_vendors(id) ON DELETE CASCADE;
ALTER TABLE public.receipt_vendors ADD CONSTRAINT receipt_vendors_invoice_vendor_id_fkey FOREIGN KEY (invoice_vendor_id) REFERENCES invoice_vendors(id) ON DELETE SET NULL;
ALTER TABLE public.receipt_vendors ADD CONSTRAINT receipt_vendors_merged_into_vendor_id_fkey FOREIGN KEY (merged_into_vendor_id) REFERENCES receipt_vendors(id) ON DELETE SET NULL;

CREATE INDEX idx_receipt_batches_source_hash ON public.receipt_batches USING btree (source_hash);
CREATE UNIQUE INDEX idx_receipt_files_transaction_path ON public.receipt_files USING btree (transaction_id, storage_path);
CREATE UNIQUE INDEX ux_receipt_invoice_matches_transaction_invoice_number ON public.receipt_invoice_matches USING btree (receipt_transaction_id, invoice_number);
CREATE UNIQUE INDEX idx_receipt_transactions_dedupe_hash ON public.receipt_transactions USING btree (dedupe_hash);
CREATE UNIQUE INDEX idx_receipt_upload_intents_storage_path ON public.receipt_upload_intents USING btree (storage_path);

CREATE TRIGGER trg_receipt_invoice_matches_updated_at BEFORE UPDATE ON public.receipt_invoice_matches FOR EACH ROW EXECUTE FUNCTION set_receipt_row_updated_at();
CREATE TRIGGER trg_receipt_rules_updated_at BEFORE UPDATE ON public.receipt_rules FOR EACH ROW EXECUTE FUNCTION set_receipt_row_updated_at();
CREATE TRIGGER trg_receipt_transactions_updated_at BEFORE UPDATE ON public.receipt_transactions FOR EACH ROW EXECUTE FUNCTION set_receipt_row_updated_at();
CREATE TRIGGER trg_receipt_vendor_reviews_updated_at BEFORE UPDATE ON public.receipt_vendor_reviews FOR EACH ROW EXECUTE FUNCTION set_receipt_row_updated_at();
CREATE TRIGGER trg_receipt_vendor_watchlist_updated_at BEFORE UPDATE ON public.receipt_vendor_watchlist FOR EACH ROW EXECUTE FUNCTION set_receipt_row_updated_at();
CREATE TRIGGER trg_receipt_vendors_updated_at BEFORE UPDATE ON public.receipt_vendors FOR EACH ROW EXECUTE FUNCTION set_receipt_row_updated_at();

-- What each model call cost, for every part of the app. The receipts cost tile reads its own rows.
CREATE TABLE public.ai_usage_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  context TEXT,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(12, 6) NOT NULL DEFAULT 0
);

-- Reporting functions as production has them on 1 October 2026: they run as the caller and the
-- browser roles may call them (the default grant above). Release 6 takes that away. The bodies
-- are not under test.
CREATE FUNCTION public.get_receipt_monthly_category_breakdown(limit_months integer DEFAULT 12, top_categories integer DEFAULT 6)
RETURNS TABLE(month_start date) LANGUAGE sql STABLE AS $$ SELECT NULL::date WHERE false $$;
CREATE FUNCTION public.get_receipt_monthly_status_counts(limit_months integer DEFAULT 12)
RETURNS TABLE(month_start date) LANGUAGE sql STABLE AS $$ SELECT NULL::date WHERE false $$;
CREATE FUNCTION public.get_ai_usage_breakdown() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.get_openai_usage_total() RETURNS numeric LANGUAGE sql STABLE AS $$ SELECT 0::numeric $$;
-- The older, three-argument form of the bulk grouping function, which production still carries.
CREATE FUNCTION public.get_receipt_detail_groups(limit_groups integer, include_statuses text[], only_unclassified boolean)
RETURNS TABLE(details text) LANGUAGE sql STABLE AS $$ SELECT NULL::text WHERE false $$;

-- Every receipts table is service-role only in production.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'receipt_batches', 'receipt_classification_signals', 'receipt_files', 'receipt_invoice_matches',
    'receipt_rule_conflicts', 'receipt_rule_suggestions', 'receipt_rules', 'receipt_transaction_logs',
    'receipt_transactions', 'receipt_upload_intents', 'receipt_vendor_aliases', 'receipt_vendor_reviews',
    'receipt_vendor_watchlist', 'receipt_vendors'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;

  -- Six of them still carry table privileges for the browser roles, from before row security
  -- was the rule. Row security blocks every use of them. Release 6 revokes them.
  FOREACH t IN ARRAY ARRAY[
    'receipt_batches', 'receipt_files', 'receipt_rules', 'receipt_transaction_logs',
    'receipt_transactions', 'receipt_upload_intents'
  ] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
