-- Receipts v2: invoice-payment reconciliation and rule maintenance.
-- Idempotent by design so it can be applied directly to linked databases and
-- later replayed through migration history without duplicating rules.

CREATE TABLE IF NOT EXISTS public.receipt_invoice_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_transaction_id UUID NOT NULL REFERENCES public.receipt_transactions(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_payment_id UUID REFERENCES public.invoice_payments(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  match_status TEXT NOT NULL DEFAULT 'matched' CHECK (match_status IN (
    'matched',
    'payment_recorded',
    'already_paid',
    'missing_invoice',
    'multiple_invoice_refs',
    'amount_mismatch',
    'review_required'
  )),
  amount_match BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_date DATE NOT NULL,
  matched_amount NUMERIC(12, 2),
  invoice_total_amount NUMERIC(12, 2),
  invoice_paid_amount_before NUMERIC(12, 2),
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_receipt_invoice_matches_transaction_invoice_number
  ON public.receipt_invoice_matches(receipt_transaction_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_receipt_invoice_matches_invoice
  ON public.receipt_invoice_matches(invoice_id, transaction_date DESC)
  WHERE invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_invoice_matches_payment
  ON public.receipt_invoice_matches(invoice_payment_id)
  WHERE invoice_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_invoice_matches_status
  ON public.receipt_invoice_matches(match_status, transaction_date DESC);

CREATE OR REPLACE FUNCTION public.set_receipt_invoice_matches_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_invoice_matches_updated_at ON public.receipt_invoice_matches;
CREATE TRIGGER trg_receipt_invoice_matches_updated_at
BEFORE UPDATE ON public.receipt_invoice_matches
FOR EACH ROW
EXECUTE FUNCTION public.set_receipt_invoice_matches_updated_at();

ALTER TABLE public.receipt_invoice_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages receipt invoice matches" ON public.receipt_invoice_matches;
CREATE POLICY "Service role manages receipt invoice matches"
  ON public.receipt_invoice_matches
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.receipt_invoice_matches FROM anon, authenticated;
GRANT ALL ON public.receipt_invoice_matches TO service_role;

CREATE OR REPLACE FUNCTION pg_temp.receipt_vendor_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT public.normalize_receipt_vendor_key(p_name);
$$;

CREATE OR REPLACE FUNCTION pg_temp.ensure_receipt_vendor(
  p_name TEXT,
  p_invoice_vendor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_name TEXT := NULLIF(TRIM(COALESCE(p_name, '')), '');
  v_key TEXT := pg_temp.receipt_vendor_key(p_name);
  v_id UUID;
BEGIN
  IF v_name IS NULL OR v_key IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_id
  FROM public.receipt_vendors
  WHERE vendor_key = v_key
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.receipt_vendors (
      canonical_name,
      vendor_key,
      status,
      invoice_vendor_id
    )
    VALUES (
      v_name,
      v_key,
      'confirmed',
      p_invoice_vendor_id
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.receipt_vendors
    SET
      invoice_vendor_id = COALESCE(public.receipt_vendors.invoice_vendor_id, p_invoice_vendor_id),
      updated_at = NOW()
    WHERE id = v_id;
  END IF;

  INSERT INTO public.receipt_vendor_aliases (
    vendor_id,
    alias,
    alias_key,
    source,
    confidence
  )
  VALUES (
    v_id,
    v_name,
    v_key,
    'system',
    100
  )
  ON CONFLICT (alias_key) DO NOTHING;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.upsert_receipt_rule(
  p_name TEXT,
  p_match_description TEXT,
  p_match_transaction_type TEXT,
  p_match_direction TEXT,
  p_vendor_name TEXT,
  p_expense_category TEXT,
  p_auto_status TEXT,
  p_kind TEXT,
  p_priority INTEGER DEFAULT 1000
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_rule_id UUID;
  v_vendor_id UUID;
BEGIN
  v_vendor_id := pg_temp.ensure_receipt_vendor(p_vendor_name);

  SELECT id INTO v_rule_id
  FROM public.receipt_rules
  WHERE LOWER(name) = LOWER(p_name)
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_rule_id IS NULL THEN
    INSERT INTO public.receipt_rules (
      name,
      description,
      match_description,
      match_transaction_type,
      match_direction,
      auto_status,
      is_active,
      set_vendor_name,
      vendor_id,
      set_expense_category,
      priority,
      kind,
      reviewed_at,
      created_at,
      updated_at
    )
    VALUES (
      p_name,
      'Receipts v2 governed rule seeded from live transaction evidence.',
      p_match_description,
      p_match_transaction_type,
      p_match_direction,
      p_auto_status::public.receipt_transaction_status,
      TRUE,
      p_vendor_name,
      v_vendor_id,
      p_expense_category,
      p_priority,
      p_kind,
      NOW(),
      NOW(),
      NOW()
    )
    RETURNING id INTO v_rule_id;
  ELSE
    UPDATE public.receipt_rules
    SET
      description = COALESCE(description, 'Receipts v2 governed rule seeded from live transaction evidence.'),
      match_description = p_match_description,
      match_transaction_type = p_match_transaction_type,
      match_direction = p_match_direction,
      auto_status = p_auto_status::public.receipt_transaction_status,
      is_active = TRUE,
      set_vendor_name = p_vendor_name,
      vendor_id = v_vendor_id,
      set_expense_category = p_expense_category,
      priority = p_priority,
      kind = p_kind,
      reviewed_at = COALESCE(reviewed_at, NOW()),
      deactivated_at = NULL,
      deactivated_by = NULL,
      updated_at = NOW()
    WHERE id = v_rule_id;
  END IF;

  RETURN v_rule_id;
END;
$$;

-- Conflict cleanup and rule corrections
UPDATE public.receipt_rules
SET
  name = 'Amazon purchases',
  match_description = 'amazon,amznmktplace',
  match_transaction_type = 'Card Transaction',
  match_direction = 'out',
  set_vendor_name = 'Amazon',
  vendor_id = pg_temp.ensure_receipt_vendor('Amazon'),
  set_expense_category = NULL,
  auto_status = 'pending',
  kind = 'standard',
  priority = 1000,
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = 'c01fb199-9858-4f67-98e8-e07243f83c36';

UPDATE public.receipt_rules
SET
  is_active = FALSE,
  deactivated_at = COALESCE(deactivated_at, NOW()),
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = '57156498-1f2d-4002-9c0d-4c474a56c1b4';

UPDATE public.receipt_rules
SET
  name = 'Bidfood purchases',
  match_description = 'BIDFOOD',
  match_transaction_type = NULL,
  match_direction = 'out',
  set_vendor_name = 'Bidfood',
  vendor_id = pg_temp.ensure_receipt_vendor('Bidfood'),
  set_expense_category = NULL,
  auto_status = 'pending',
  kind = 'standard',
  priority = 1000,
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = '68f8d728-4554-48c4-803d-2d9c6ec0f3b6';

UPDATE public.receipt_rules
SET
  is_active = FALSE,
  deactivated_at = COALESCE(deactivated_at, NOW()),
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = '2cc57423-3ead-4403-a63f-b2686e313643';

UPDATE public.receipt_rules
SET
  priority = 900,
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = 'cf29dbd9-a30f-4423-9cdc-e0a2bc9b51b1';

UPDATE public.receipt_rules
SET
  match_description = 'quality plants,qualityplants',
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = 'fa438a54-95f3-4dc4-a651-300561feb7ad';

UPDATE public.receipt_rules
SET
  match_description = 'T K Maxx,TKMAXX,TKMAXX UK',
  set_vendor_name = 'TK Maxx',
  vendor_id = pg_temp.ensure_receipt_vendor('TK Maxx'),
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = '0a7320b4-1c75-4208-86bf-36e0c09299b2';

UPDATE public.receipt_rules
SET
  match_description = 'asml,ASML Accounting',
  match_transaction_type = NULL,
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = '6e0e29e4-8474-4575-9280-058f3816510d';

UPDATE public.receipt_rules
SET
  match_description = 'Simon Whitney Fridge Maintenance,Simon Witney Fridge maintenance',
  reviewed_at = COALESCE(reviewed_at, NOW()),
  updated_at = NOW()
WHERE id = '7bcbaa5e-161a-4757-ad28-e8e8cafff2e9';

-- Settlement and recurring operational rules
SELECT pg_temp.upsert_receipt_rule('Paymentsense EPOS settlement deposits', 'Paymentsense Limited', 'Inward Payment', 'in', 'Paymentsense', NULL, 'no_receipt_required', 'income_settlement', 1000);
SELECT pg_temp.upsert_receipt_rule('Stripe settlement deposits', 'Stripe Payments UK Ltd STRIPE', 'Inward Payment', 'in', 'Stripe', NULL, 'no_receipt_required', 'income_settlement', 1000);
SELECT pg_temp.upsert_receipt_rule('Sky Business Direct Debit', 'SKY BUSINESS', 'Direct Debit', 'out', 'Sky', 'Sky / PRS / Vidimix', 'no_receipt_required', 'standard', 1000);
SELECT pg_temp.upsert_receipt_rule('Vodafone telephone charges', 'VODAFONE LTD', NULL, 'out', 'Vodafone', 'Telephone', 'pending', 'utility', 1000);
SELECT pg_temp.upsert_receipt_rule('Virgin Media telephone charges', 'VIRGIN MEDIA PYMTS', 'Direct Debit', 'out', 'Virgin Media', 'Telephone', 'pending', 'utility', 1000);
SELECT pg_temp.upsert_receipt_rule('OpenTable booking fees', 'OPENTABLE INTERNAT', 'Direct Debit', 'out', 'OpenTable', 'Third Party Booking Fee', 'pending', 'standard', 1000);
SELECT pg_temp.upsert_receipt_rule('Vercel hosting charges', 'VERCEL INC', 'Card Transaction', 'out', 'Vercel', NULL, 'pending', 'standard', 1000);
SELECT pg_temp.upsert_receipt_rule('Barclays Partner Finance Direct Debit', 'BARCLAYS PRTNR FIN', 'Direct Debit', 'out', 'Barclays', 'Bank Charges/Credit Card Commission', 'pending', 'bank_fee', 1000);

-- Refund rules are intentionally separate from purchase rules so direction stays meaningful.
SELECT pg_temp.upsert_receipt_rule('Amazon refunds', 'Card Purchase Refund AMZNMktplace,Card Purchase Refund AMAZON', 'Card Transaction', 'in', 'Amazon', NULL, 'no_receipt_required', 'receipt_not_required', 1000);
SELECT pg_temp.upsert_receipt_rule('Bidfood refunds', 'Card Purchase Refund BIDFOOD', 'Card Transaction', 'in', 'Bidfood', NULL, 'no_receipt_required', 'receipt_not_required', 1000);
SELECT pg_temp.upsert_receipt_rule('Tesco refunds', 'Card Purchase Refund TESCO', 'Card Transaction', 'in', 'Tesco', NULL, 'no_receipt_required', 'receipt_not_required', 1000);
SELECT pg_temp.upsert_receipt_rule('Microsoft refunds', 'Card Purchase Refund MICROSOFT', 'Card Transaction', 'in', 'Microsoft', NULL, 'no_receipt_required', 'receipt_not_required', 1000);
SELECT pg_temp.upsert_receipt_rule('Apple refunds', 'Card Purchase Refund APPLE.COM UK', 'Card Transaction', 'in', 'Apple', NULL, 'no_receipt_required', 'receipt_not_required', 1000);
SELECT pg_temp.upsert_receipt_rule('Screwfix refunds', 'Card Purchase Refund SCREWFIX', 'Card Transaction', 'in', 'Screwfix', NULL, 'no_receipt_required', 'receipt_not_required', 1000);
SELECT pg_temp.upsert_receipt_rule('Domain Network Solutions refunds', 'Card Purchase Refund WEB DOMAIN-NETWORKSOL,Card Purchase Refund DOMAIN-NETWORKSOL', 'Card Transaction', 'in', 'Domain Network Solutions', NULL, 'no_receipt_required', 'receipt_not_required', 1000);

-- Payroll aliases. Keep aliases explicit to avoid a broad "The Anchor" rule.
SELECT pg_temp.upsert_receipt_rule('Sharon Morris Latham payroll', 'Sharon Morris Latham,Sharon Morris-Latham', NULL, 'out', 'Sharon Morris Latham', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Miss L L Hardring payroll', 'MISS L L HARDRING', NULL, 'out', 'Miss L L Hardring', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Katie Williams payroll', 'Katie Williams', NULL, 'out', 'Katie Williams', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Ravnish Sohanpal payroll', 'Ravnish Sohanpal', NULL, 'out', 'Ravnish Sohanpal', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('N O Johnson payroll', 'MISS N O Johnson', NULL, 'out', 'N O Johnson', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Clare Rackley Coller payroll', 'Clare Rackley Coller', NULL, 'out', 'Clare Rackley Coller', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('E L Fowles payroll', 'MRS E L FOWLES', NULL, 'out', 'E L Fowles', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Jessica Lovelock payroll', 'Jessica Lovelock', NULL, 'out', 'Jessica Lovelock', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Tina Mead payroll', 'Tina Mead', NULL, 'out', 'Tina Mead', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Charlotte Peake payroll', 'Charlotte Peake', NULL, 'out', 'Charlotte Peake', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Charly Buck payroll', 'Charly Buck', NULL, 'out', 'Charly Buck', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Marty Pitcher-Summers payroll', 'MR P J PITCHER The Anchor', NULL, 'out', 'Marty Pitcher-Summers', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Ryan Bond payroll', 'Ryan Bond', NULL, 'out', 'Ryan Bond', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Ellie Chaplin payroll', 'Ellie Chaplin', NULL, 'out', 'Ellie Chaplin', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Leanne Breech payroll', 'Leanne Breech', NULL, 'out', 'Leanne Breech', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Louise Kitchener payroll', 'Louise Kitchener', NULL, 'out', 'Louise Kitchener', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
SELECT pg_temp.upsert_receipt_rule('Nicholas McLernon payroll', 'Nicholas McLernon The Anchor', NULL, 'out', 'Nicholas McLernon', 'Total Staff', 'no_receipt_required', 'payroll', 1000);
