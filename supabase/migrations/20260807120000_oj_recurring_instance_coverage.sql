-- OJ Projects: record the span of service each recurring charge instance covers.
--
-- Monthly charges cover their own billing period. Quarterly and annual charges
-- cover the 3 or 12 months starting at the period they are billed in, so the
-- invoice line can state exactly what the client is paying for, for example
-- "mitchmckee.co.uk Domain Renewal (1 Aug 2026 to 31 Jul 2027)".
--
-- Nullable so rows written by the previous code keep working; readers fall back
-- to period_start / period_end.

ALTER TABLE public.oj_recurring_charge_instances
  ADD COLUMN IF NOT EXISTS coverage_start date,
  ADD COLUMN IF NOT EXISTS coverage_end date;

UPDATE public.oj_recurring_charge_instances
   SET coverage_start = period_start,
       coverage_end = period_end
 WHERE coverage_start IS NULL
    OR coverage_end IS NULL;
