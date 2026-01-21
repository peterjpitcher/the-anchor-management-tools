-- Fix retainer period check to be safer against escape sequences
ALTER TABLE public.oj_projects
  DROP CONSTRAINT IF EXISTS chk_oj_projects_retainer_period;

ALTER TABLE public.oj_projects
  ADD CONSTRAINT chk_oj_projects_retainer_period
  CHECK (
    is_retainer = false
    OR (
      retainer_period_yyyymm IS NOT NULL
      AND retainer_period_yyyymm ~ '^[0-9]{4}-[0-9]{2}$'
    )
  );
