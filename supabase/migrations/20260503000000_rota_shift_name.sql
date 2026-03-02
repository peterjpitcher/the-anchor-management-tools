-- Add an optional name field to rota_shifts (populated from template name or entered manually)
ALTER TABLE rota_shifts
  ADD COLUMN IF NOT EXISTS name TEXT;
