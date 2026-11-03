-- Rollback for 20261103070932_employee_rate_overrides_rls.sql: restores the policy and grants production held on 2 November 2026.

DROP POLICY employee_rate_overrides_select ON public.employee_rate_overrides;
DROP POLICY employee_rate_overrides_insert ON public.employee_rate_overrides;
DROP POLICY employee_rate_overrides_update ON public.employee_rate_overrides;
DROP POLICY employee_rate_overrides_delete ON public.employee_rate_overrides;

CREATE POLICY "Authenticated users can manage employee_rate_overrides" ON public.employee_rate_overrides
  AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));

GRANT SELECT ON public.employee_rate_overrides TO anon;
