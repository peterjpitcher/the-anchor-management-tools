-- Make duplicate-candidate detection source-aware.
-- A bank-statement row and an Amex row that happen to share a date/amount are
-- NOT the same payment (Amex is reimbursed via the bank feed), so they must not
-- be flagged as duplicate candidates. We add a source_type equality predicate to
-- the self-join so only same-source pairs are considered.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.receipt_duplicate_candidates;
CREATE MATERIALIZED VIEW public.receipt_duplicate_candidates AS
WITH candidate_pairs AS (
  SELECT
    t1.id AS transaction_id,
    t2.id AS duplicate_transaction_id,
    ABS(t1.transaction_date - t2.transaction_date)::INTEGER AS days_apart,
    ABS((COALESCE(t1.amount_total, 0) - COALESCE(t2.amount_total, 0)) * 100)::INTEGER AS amount_diff_pence,
    COALESCE(t1.details, '') AS details_a,
    COALESCE(t2.details, '') AS details_b
  FROM public.receipt_transactions t1
  JOIN public.receipt_transactions t2
    ON t1.id::TEXT < t2.id::TEXT
   AND t1.source_type = t2.source_type
   AND t2.transaction_date BETWEEN t1.transaction_date - 3 AND t1.transaction_date + 3
   AND COALESCE(t2.amount_total, 0) BETWEEN COALESCE(t1.amount_total, 0) - 0.50
     AND COALESCE(t1.amount_total, 0) + 0.50
)
SELECT
  transaction_id,
  duplicate_transaction_id,
  days_apart,
  amount_diff_pence,
  similarity(details_a, details_b) AS detail_similarity
FROM candidate_pairs
WHERE similarity(details_a, details_b) >= 0.70
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipt_duplicate_candidates_pair
  ON public.receipt_duplicate_candidates(transaction_id, duplicate_transaction_id);

-- Recreate the refresh function (idempotent) so it targets the rebuilt view.
CREATE OR REPLACE FUNCTION public.refresh_receipt_duplicate_candidates()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.receipt_duplicate_candidates;
END;
$$;

REVOKE ALL ON public.receipt_duplicate_candidates FROM anon, authenticated;
GRANT SELECT ON public.receipt_duplicate_candidates TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_receipt_duplicate_candidates() TO service_role;

COMMIT;
