-- Receipt vendor watchlist for focused supplier cost review.

CREATE TABLE IF NOT EXISTS public.receipt_vendor_watchlist (
  user_id UUID NOT NULL,
  vendor_key TEXT NOT NULL,
  vendor_label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT receipt_vendor_watchlist_pk PRIMARY KEY (user_id, vendor_key),
  CONSTRAINT receipt_vendor_watchlist_vendor_key_not_empty CHECK (btrim(vendor_key) <> ''),
  CONSTRAINT receipt_vendor_watchlist_vendor_label_not_empty CHECK (btrim(vendor_label) <> '')
);

CREATE INDEX IF NOT EXISTS idx_receipt_vendor_watchlist_label
  ON public.receipt_vendor_watchlist (vendor_label);

CREATE OR REPLACE FUNCTION public.set_receipt_vendor_watchlist_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_vendor_watchlist_updated_at ON public.receipt_vendor_watchlist;
CREATE TRIGGER trg_receipt_vendor_watchlist_updated_at
BEFORE UPDATE ON public.receipt_vendor_watchlist
FOR EACH ROW
EXECUTE FUNCTION public.set_receipt_vendor_watchlist_updated_at();

ALTER TABLE public.receipt_vendor_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages receipt vendor watchlist" ON public.receipt_vendor_watchlist;
CREATE POLICY "Service role manages receipt vendor watchlist"
  ON public.receipt_vendor_watchlist
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON public.receipt_vendor_watchlist FROM anon;
REVOKE ALL ON public.receipt_vendor_watchlist FROM authenticated;
