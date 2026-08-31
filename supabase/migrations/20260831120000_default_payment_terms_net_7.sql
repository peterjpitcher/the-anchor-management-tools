-- Owner decision, 2026-08-31: seven days is the default payment term for any
-- customer who has not been given longer. The column defaulted to 30, which
-- quietly gave every new customer four times the intended credit.
--
-- Only `invoice_vendors` changes. `vendors` is the private-booking supplier
-- list (DJs, bands, photographers) whose terms are THEIRS and dictate when we
-- pay them, so its default is deliberately left at 30.
--
-- Existing rows are untouched. Four customers are already on 7; the one on 25
-- and the two on 30 are treated as terms that were actually agreed, and
-- rewriting them here would silently change a commercial arrangement.

ALTER TABLE public.invoice_vendors
  ALTER COLUMN payment_terms SET DEFAULT 7;
