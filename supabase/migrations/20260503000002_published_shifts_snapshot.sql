-- Snapshot table: holds the last-published version of shifts for each week.
-- Staff portal reads from here; managers edit rota_shifts (live draft).
-- On publish, this table is replaced with the current rota_shifts for the week.

CREATE TABLE IF NOT EXISTS rota_published_shifts (
  id            UUID        PRIMARY KEY, -- same UUID as rota_shifts.id
  week_id       UUID        NOT NULL REFERENCES rota_weeks(id) ON DELETE CASCADE,
  employee_id   UUID        REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  shift_date    DATE        NOT NULL,
  start_time    TIME        NOT NULL,
  end_time      TIME        NOT NULL,
  unpaid_break_minutes SMALLINT NOT NULL DEFAULT 0,
  department    TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'scheduled',
  notes         TEXT,
  is_overnight  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_open_shift BOOLEAN     NOT NULL DEFAULT FALSE,
  name          TEXT,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rota_published_shifts_week_idx
  ON rota_published_shifts(week_id);

CREATE INDEX IF NOT EXISTS rota_published_shifts_employee_date_idx
  ON rota_published_shifts(employee_id, shift_date);

CREATE INDEX IF NOT EXISTS rota_published_shifts_open_date_idx
  ON rota_published_shifts(shift_date) WHERE is_open_shift = TRUE;

-- Enable RLS
ALTER TABLE rota_published_shifts ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read (staff portal + admin)
CREATE POLICY "authenticated users can read published shifts"
  ON rota_published_shifts FOR SELECT
  TO authenticated
  USING (true);
