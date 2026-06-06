-- Staff portal shift acceptance, open-shift requests, and calendar cancellation history.

ALTER TABLE public.rota_shifts
  ADD COLUMN IF NOT EXISTS acceptance_status TEXT,
  ADD COLUMN IF NOT EXISTS acceptance_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acceptance_decided_by UUID REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acceptance_note TEXT,
  ADD COLUMN IF NOT EXISTS auto_accept_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_accept_warning_sent_at TIMESTAMPTZ;

ALTER TABLE public.rota_published_shifts
  ADD COLUMN IF NOT EXISTS acceptance_status TEXT,
  ADD COLUMN IF NOT EXISTS acceptance_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acceptance_decided_by UUID REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS acceptance_note TEXT,
  ADD COLUMN IF NOT EXISTS auto_accept_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_accept_warning_sent_at TIMESTAMPTZ;

ALTER TABLE public.rota_shifts
  DROP CONSTRAINT IF EXISTS rota_shifts_acceptance_status_check,
  ADD CONSTRAINT rota_shifts_acceptance_status_check
    CHECK (acceptance_status IS NULL OR acceptance_status IN ('pending', 'accepted', 'rejected', 'auto_accepted'));

ALTER TABLE public.rota_published_shifts
  DROP CONSTRAINT IF EXISTS rota_published_shifts_acceptance_status_check,
  ADD CONSTRAINT rota_published_shifts_acceptance_status_check
    CHECK (acceptance_status IS NULL OR acceptance_status IN ('pending', 'accepted', 'rejected', 'auto_accepted'));

ALTER TABLE public.rota_shifts
  DROP CONSTRAINT IF EXISTS rota_shifts_acceptance_open_shift_check,
  ADD CONSTRAINT rota_shifts_acceptance_open_shift_check
    CHECK (
      (is_open_shift = TRUE AND (acceptance_status IS NULL OR acceptance_status = 'rejected'))
      OR is_open_shift = FALSE
    );

ALTER TABLE public.rota_published_shifts
  DROP CONSTRAINT IF EXISTS rota_published_shifts_acceptance_open_shift_check,
  ADD CONSTRAINT rota_published_shifts_acceptance_open_shift_check
    CHECK (
      (is_open_shift = TRUE AND (acceptance_status IS NULL OR acceptance_status = 'rejected'))
      OR is_open_shift = FALSE
    );

UPDATE public.rota_shifts
SET
  acceptance_status = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date < CURRENT_DATE THEN 'accepted'
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date THEN 'auto_accepted'
    ELSE 'pending'
  END,
  acceptance_decided_at = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date < CURRENT_DATE THEN COALESCE(acceptance_decided_at, updated_at, created_at, NOW())
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date THEN COALESCE(acceptance_decided_at, NOW())
    ELSE acceptance_decided_at
  END,
  acceptance_decided_by = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date THEN COALESCE(acceptance_decided_by, employee_id)
    ELSE acceptance_decided_by
  END,
  auto_accept_reason = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date AND shift_date >= CURRENT_DATE
      THEN COALESCE(auto_accept_reason, 'In line with our policy, all shifts must be accepted or rejected no less than two weeks before the shift.')
    ELSE auto_accept_reason
  END
WHERE acceptance_status IS NULL OR is_open_shift OR employee_id IS NULL OR status <> 'scheduled';

UPDATE public.rota_published_shifts
SET
  acceptance_status = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date < CURRENT_DATE THEN 'accepted'
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date THEN 'auto_accepted'
    ELSE 'pending'
  END,
  acceptance_decided_at = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date < CURRENT_DATE THEN COALESCE(acceptance_decided_at, published_at, NOW())
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date THEN COALESCE(acceptance_decided_at, NOW())
    ELSE acceptance_decided_at
  END,
  acceptance_decided_by = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date THEN COALESCE(acceptance_decided_by, employee_id)
    ELSE acceptance_decided_by
  END,
  auto_accept_reason = CASE
    WHEN is_open_shift OR employee_id IS NULL OR status <> 'scheduled' THEN NULL
    WHEN shift_date <= (CURRENT_DATE + INTERVAL '14 days')::date AND shift_date >= CURRENT_DATE
      THEN COALESCE(auto_accept_reason, 'In line with our policy, all shifts must be accepted or rejected no less than two weeks before the shift.')
    ELSE auto_accept_reason
  END
WHERE acceptance_status IS NULL OR is_open_shift OR employee_id IS NULL OR status <> 'scheduled';

CREATE INDEX IF NOT EXISTS idx_rota_published_shifts_acceptance
  ON public.rota_published_shifts(acceptance_status, shift_date)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rota_shifts_acceptance
  ON public.rota_shifts(acceptance_status, shift_date)
  WHERE employee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.rota_open_shift_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id      UUID NOT NULL REFERENCES public.rota_shifts(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ,
  decided_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  manager_note  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rota_open_shift_requests_pending_unique
  ON public.rota_open_shift_requests(shift_id, employee_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_rota_open_shift_requests_shift
  ON public.rota_open_shift_requests(shift_id);

CREATE INDEX IF NOT EXISTS idx_rota_open_shift_requests_employee
  ON public.rota_open_shift_requests(employee_id, requested_at DESC);

DROP TRIGGER IF EXISTS trg_rota_open_shift_requests_updated_at ON public.rota_open_shift_requests;
CREATE TRIGGER trg_rota_open_shift_requests_updated_at
  BEFORE UPDATE ON public.rota_open_shift_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.rota_open_shift_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read open shift requests" ON public.rota_open_shift_requests;
CREATE POLICY "Authenticated users can read open shift requests"
  ON public.rota_open_shift_requests FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage open shift requests" ON public.rota_open_shift_requests;
CREATE POLICY "Authenticated users can manage open shift requests"
  ON public.rota_open_shift_requests FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.rota_shift_calendar_cancellations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id       UUID NOT NULL,
  employee_id    UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  week_id        UUID REFERENCES public.rota_weeks(id) ON DELETE CASCADE,
  shift_date     DATE NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  unpaid_break_minutes SMALLINT NOT NULL DEFAULT 0,
  department     TEXT NOT NULL,
  notes          TEXT,
  is_overnight   BOOLEAN NOT NULL DEFAULT FALSE,
  name           TEXT,
  cancelled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason         TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rota_shift_calendar_cancellations_unique UNIQUE (shift_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_rota_shift_calendar_cancellations_employee_date
  ON public.rota_shift_calendar_cancellations(employee_id, shift_date);

CREATE INDEX IF NOT EXISTS idx_rota_shift_calendar_cancellations_shift_employee
  ON public.rota_shift_calendar_cancellations(shift_id, employee_id);

ALTER TABLE public.rota_shift_calendar_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read rota shift calendar cancellations" ON public.rota_shift_calendar_cancellations;
CREATE POLICY "Authenticated users can read rota shift calendar cancellations"
  ON public.rota_shift_calendar_cancellations FOR SELECT
  TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.rota_shift_rejections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id       UUID NOT NULL,
  employee_id    UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  week_id        UUID REFERENCES public.rota_weeks(id) ON DELETE SET NULL,
  shift_date     DATE NOT NULL,
  start_time     TIME NOT NULL,
  end_time       TIME NOT NULL,
  unpaid_break_minutes SMALLINT NOT NULL DEFAULT 0,
  department     TEXT NOT NULL,
  notes          TEXT,
  is_overnight   BOOLEAN NOT NULL DEFAULT FALSE,
  name           TEXT,
  rejection_note TEXT,
  rejected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rejected_by    UUID REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rota_shift_rejections_employee_date
  ON public.rota_shift_rejections(employee_id, shift_date DESC, rejected_at DESC);

CREATE INDEX IF NOT EXISTS idx_rota_shift_rejections_shift
  ON public.rota_shift_rejections(shift_id, rejected_at DESC);

ALTER TABLE public.rota_shift_rejections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read rota shift rejections" ON public.rota_shift_rejections;
CREATE POLICY "Authenticated users can read rota shift rejections"
  ON public.rota_shift_rejections FOR SELECT
  TO authenticated USING (true);

INSERT INTO public.rota_shift_rejections (
  shift_id,
  employee_id,
  week_id,
  shift_date,
  start_time,
  end_time,
  unpaid_break_minutes,
  department,
  notes,
  is_overnight,
  name,
  rejection_note,
  rejected_at,
  rejected_by
)
SELECT
  c.shift_id,
  c.employee_id,
  c.week_id,
  c.shift_date,
  c.start_time,
  c.end_time,
  c.unpaid_break_minutes,
  c.department,
  c.notes,
  c.is_overnight,
  c.name,
  NULL,
  c.cancelled_at,
  c.employee_id
FROM public.rota_shift_calendar_cancellations c
WHERE c.reason = 'Rejected by staff'
  AND NOT EXISTS (
    SELECT 1
    FROM public.rota_shift_rejections r
    WHERE r.shift_id = c.shift_id
      AND r.employee_id = c.employee_id
      AND r.rejected_at = c.cancelled_at
  );

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.rota_email_log'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%email_type%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.rota_email_log DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.rota_email_log
  ADD CONSTRAINT rota_email_log_email_type_check
    CHECK (email_type IN (
      'staff_rota',
      'staff_rota_change',
      'manager_alert',
      'holiday_submitted',
      'holiday_decision',
      'holiday_manager_notify',
      'payroll_export',
      'shift_rejected',
      'shift_auto_accept_warning',
      'open_shift_requested'
    ));
