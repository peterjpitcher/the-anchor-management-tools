-- Per-user review state for a vendor movement in a specific reporting period.

CREATE TABLE IF NOT EXISTS public.receipt_vendor_reviews (
  user_id UUID NOT NULL,
  vendor_key TEXT NOT NULL,
  vendor_label TEXT NOT NULL,
  comparison TEXT NOT NULL,
  month_start DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_vendor_reviews_pk PRIMARY KEY (user_id, vendor_key, comparison, month_start),
  CONSTRAINT receipt_vendor_reviews_vendor_key_not_empty CHECK (btrim(vendor_key) <> ''),
  CONSTRAINT receipt_vendor_reviews_vendor_label_not_empty CHECK (btrim(vendor_label) <> ''),
  CONSTRAINT receipt_vendor_reviews_comparison_valid CHECK (comparison IN ('mom', 'yoy', 'rolling_3m')),
  CONSTRAINT receipt_vendor_reviews_status_valid CHECK (status IN ('needs_review', 'expected', 'action_required', 'reviewed'))
);

CREATE INDEX IF NOT EXISTS idx_receipt_vendor_reviews_user_period
  ON public.receipt_vendor_reviews (user_id, month_start DESC, comparison);

CREATE OR REPLACE FUNCTION public.set_receipt_vendor_reviews_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_vendor_reviews_updated_at ON public.receipt_vendor_reviews;
CREATE TRIGGER trg_receipt_vendor_reviews_updated_at
BEFORE UPDATE ON public.receipt_vendor_reviews
FOR EACH ROW
EXECUTE FUNCTION public.set_receipt_vendor_reviews_updated_at();

ALTER TABLE public.receipt_vendor_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages receipt vendor reviews" ON public.receipt_vendor_reviews;
CREATE POLICY "Service role manages receipt vendor reviews"
  ON public.receipt_vendor_reviews
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.receipt_vendor_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.receipt_vendor_reviews TO service_role;
