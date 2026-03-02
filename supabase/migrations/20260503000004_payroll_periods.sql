-- Stores the custom start/end dates for each named payroll period.
-- Payrolls are named by their close month (e.g. "March payroll" = Feb 25 – Mar 24).
-- Defaults to 25th of the previous month → 24th of the close month, but can be overridden.

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  year         SMALLINT    NOT NULL,
  month        SMALLINT    NOT NULL CHECK (month BETWEEN 1 AND 12),
  period_start DATE        NOT NULL,
  period_end   DATE        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payroll_periods_year_month UNIQUE (year, month),
  CONSTRAINT payroll_period_dates_valid CHECK (period_end > period_start)
);

ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage payroll_periods"
  ON public.payroll_periods FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- updated_at trigger
CREATE TRIGGER trg_payroll_periods_updated_at
  BEFORE UPDATE ON public.payroll_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
