-- OJ Projects: retainer (monthly) projects
-- Adds fields to identify and budget retainer projects and enforce 1/month per vendor.

ALTER TABLE public.oj_projects
  ADD COLUMN IF NOT EXISTS is_retainer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retainer_period_yyyymm text,
  ADD COLUMN IF NOT EXISTS budget_hours numeric(12,2);

-- Ensure retainer projects have a period key (YYYY-MM).
ALTER TABLE public.oj_projects
  DROP CONSTRAINT IF EXISTS chk_oj_projects_retainer_period;

ALTER TABLE public.oj_projects
  ADD CONSTRAINT chk_oj_projects_retainer_period
  CHECK (
    is_retainer = false
    OR (
      retainer_period_yyyymm IS NOT NULL
      AND retainer_period_yyyymm ~ '^\\d{4}-\\d{2}$'
    )
  );

-- One retainer project per vendor per month.
CREATE UNIQUE INDEX IF NOT EXISTS ux_oj_projects_retainer_vendor_period
ON public.oj_projects (vendor_id, retainer_period_yyyymm)
WHERE is_retainer = true;

CREATE INDEX IF NOT EXISTS idx_oj_projects_retainer_lookup
ON public.oj_projects (vendor_id, is_retainer, retainer_period_yyyymm);
