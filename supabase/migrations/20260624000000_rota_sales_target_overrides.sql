-- Rota labour planning: date-specific sales target overrides and wage target setting.
-- Existing cashup_targets remains the default day-of-week source of truth.

CREATE TABLE IF NOT EXISTS public.cashup_target_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  target_date DATE NOT NULL,
  target_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),

  CONSTRAINT cashup_target_overrides_unique UNIQUE (site_id, target_date)
);

CREATE INDEX IF NOT EXISTS idx_cashup_target_overrides_lookup
  ON public.cashup_target_overrides(site_id, target_date);

ALTER TABLE public.cashup_target_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cashup target overrides"
  ON public.cashup_target_overrides FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cashup target overrides"
  ON public.cashup_target_overrides FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update cashup target overrides"
  ON public.cashup_target_overrides FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete cashup target overrides"
  ON public.cashup_target_overrides FOR DELETE
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.set_cashup_target_override_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cashup_target_overrides_updated_at ON public.cashup_target_overrides;
CREATE TRIGGER trg_cashup_target_overrides_updated_at
BEFORE UPDATE ON public.cashup_target_overrides
FOR EACH ROW
EXECUTE FUNCTION public.set_cashup_target_override_updated_at();

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'rota_wage_target_percent',
  '{"value": 25}',
  'Target scheduled wages as a percentage of sales target for rota planning'
)
ON CONFLICT (key) DO NOTHING;
