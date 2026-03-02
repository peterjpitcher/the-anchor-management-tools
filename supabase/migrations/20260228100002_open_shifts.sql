-- Allow "open" shifts that are not assigned to a specific employee.
-- employee_id becomes nullable; is_open_shift = TRUE means the shift is available.

ALTER TABLE rota_shifts
  ALTER COLUMN employee_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_open_shift BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforce consistency: open shifts must have no employee; assigned shifts must have one.
ALTER TABLE rota_shifts
  ADD CONSTRAINT rota_shifts_open_shift_check
  CHECK (
    (is_open_shift = TRUE  AND employee_id IS NULL)
    OR
    (is_open_shift = FALSE AND employee_id IS NOT NULL)
  );

-- Existing shifts are all assigned, so the default FALSE is correct.
