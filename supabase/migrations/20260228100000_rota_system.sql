-- =============================================================================
-- Rota, Leave, Timeclock, Budget and Payroll System
-- Migration: 20260228100000_rota_system.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ROTA WEEKS
-- Tracks draft/publish state for a given calendar week (Mon–Sun).
-- Created automatically when the first shift is added to a week.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rota_weeks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start     DATE NOT NULL UNIQUE,  -- always a Monday
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at   TIMESTAMPTZ,
  published_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  has_unpublished_changes BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rota_weeks IS 'One row per calendar week (Mon–Sun) tracking draft/publish state.';
COMMENT ON COLUMN public.rota_weeks.week_start IS 'Monday of the rota week (ISO date).';
COMMENT ON COLUMN public.rota_weeks.has_unpublished_changes IS 'Set TRUE when shifts are edited after publishing; reset on re-publish.';

-- ---------------------------------------------------------------------------
-- 2. ROTA SHIFT TEMPLATES
-- Reusable shift definitions dragged onto the rota grid.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rota_shift_templates (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  start_time             TIME NOT NULL,
  end_time               TIME NOT NULL,
  unpaid_break_minutes   SMALLINT NOT NULL DEFAULT 0 CHECK (unpaid_break_minutes >= 0),
  department             TEXT NOT NULL CHECK (department IN ('bar', 'kitchen')),
  colour                 TEXT,           -- hex colour for the UI palette
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rota_shift_templates IS 'Reusable shift templates shown in the rota palette.';

-- ---------------------------------------------------------------------------
-- 3. ROTA SHIFTS
-- Individual scheduled shifts per employee per day, linked to a week.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rota_shifts (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id                UUID NOT NULL REFERENCES public.rota_weeks(id) ON DELETE CASCADE,
  employee_id            UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  template_id            UUID REFERENCES public.rota_shift_templates(id) ON DELETE SET NULL,
  shift_date             DATE NOT NULL,
  start_time             TIME NOT NULL,
  end_time               TIME NOT NULL,
  unpaid_break_minutes   SMALLINT NOT NULL DEFAULT 0 CHECK (unpaid_break_minutes >= 0),
  department             TEXT NOT NULL CHECK (department IN ('bar', 'kitchen')),
  status                 TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sick', 'cancelled')),
  notes                  TEXT,           -- internal shift-level note
  is_overnight           BOOLEAN NOT NULL DEFAULT FALSE,
  -- Reassignment tracking
  original_employee_id   UUID REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  reassigned_from_id     UUID REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  reassigned_at          TIMESTAMPTZ,
  reassigned_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reassignment_reason    TEXT,
  created_by             UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rota_shifts IS 'Individual scheduled shifts per employee per calendar day.';
COMMENT ON COLUMN public.rota_shifts.is_overnight IS 'TRUE when end_time is on the following calendar day.';
COMMENT ON COLUMN public.rota_shifts.original_employee_id IS 'Set on first reassignment to preserve original assignment.';

CREATE INDEX idx_rota_shifts_week_id      ON public.rota_shifts(week_id);
CREATE INDEX idx_rota_shifts_employee_id  ON public.rota_shifts(employee_id);
CREATE INDEX idx_rota_shifts_shift_date   ON public.rota_shifts(shift_date);
CREATE INDEX idx_rota_shifts_department   ON public.rota_shifts(department);

-- ---------------------------------------------------------------------------
-- 4. LEAVE REQUESTS
-- Holiday request header submitted by employee or created by manager.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  manager_note   TEXT,
  reviewed_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  holiday_year   SMALLINT NOT NULL,  -- e.g. 2026 for any dates in the holiday year starting 2026
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- null if submitted by employee
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_dates_valid CHECK (end_date >= start_date)
);

COMMENT ON TABLE public.leave_requests IS 'Holiday request header. One row per request regardless of day count.';
COMMENT ON COLUMN public.leave_requests.holiday_year IS 'The holiday year this request counts against (configurable year start).';

CREATE INDEX idx_leave_requests_employee_id  ON public.leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status       ON public.leave_requests(status);
CREATE INDEX idx_leave_requests_holiday_year ON public.leave_requests(holiday_year);

-- ---------------------------------------------------------------------------
-- 5. LEAVE DAYS
-- One row per calendar day of a request. Populated on creation (pending/approved).
-- Used for rota overlay and holiday count queries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leave_days (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id     UUID NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  leave_date     DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT leave_days_unique UNIQUE (employee_id, leave_date)
);

COMMENT ON TABLE public.leave_days IS 'Expanded per-day rows for a leave request. Enables fast rota overlay and count queries.';
COMMENT ON CONSTRAINT leave_days_unique ON public.leave_days IS 'An employee cannot have two approved leave days on the same calendar date.';

CREATE INDEX idx_leave_days_employee_date ON public.leave_days(employee_id, leave_date);
CREATE INDEX idx_leave_days_request_id   ON public.leave_days(request_id);

-- ---------------------------------------------------------------------------
-- 6. TIMECLOCK SESSIONS
-- Clock-in / clock-out records from the FOH timeclock page.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.timeclock_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  work_date           DATE NOT NULL,      -- clock_in_at converted to Europe/London date
  clock_in_at         TIMESTAMPTZ NOT NULL,
  clock_out_at        TIMESTAMPTZ,        -- NULL = still clocked in
  linked_shift_id     UUID REFERENCES public.rota_shifts(id) ON DELETE SET NULL,
  is_unscheduled      BOOLEAN NOT NULL DEFAULT FALSE,
  is_auto_close       BOOLEAN NOT NULL DEFAULT FALSE,
  auto_close_reason   TEXT CHECK (auto_close_reason IN ('scheduled_end', 'fallback_0500')),
  is_reviewed         BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_by         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.timeclock_sessions IS 'Clock-in/out records. NULL clock_out_at means session is open.';
COMMENT ON COLUMN public.timeclock_sessions.work_date IS 'Date of clock_in_at in Europe/London timezone.';
COMMENT ON COLUMN public.timeclock_sessions.is_auto_close IS 'TRUE if closed by the 05:00 auto-close cron job.';

CREATE INDEX idx_timeclock_sessions_employee_id ON public.timeclock_sessions(employee_id);
CREATE INDEX idx_timeclock_sessions_work_date   ON public.timeclock_sessions(work_date);
CREATE INDEX idx_timeclock_sessions_open        ON public.timeclock_sessions(employee_id) WHERE clock_out_at IS NULL;

-- ---------------------------------------------------------------------------
-- 7. PAY AGE BANDS
-- Age band definitions for the national/living wage pay structure.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pay_age_bands (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT NOT NULL,              -- e.g. "Under 18", "18–20", "21–22", "23+"
  min_age     SMALLINT NOT NULL CHECK (min_age >= 0),
  max_age     SMALLINT CHECK (max_age > min_age),  -- NULL = no upper bound (open-ended band)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pay_age_bands IS 'Age band definitions used for minimum/living wage tier lookup.';
COMMENT ON COLUMN public.pay_age_bands.max_age IS 'NULL means no upper bound (oldest/default band).';

-- ---------------------------------------------------------------------------
-- 8. PAY BAND RATES
-- Effective-dated hourly rates per age band. Append-only — no updates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pay_band_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  band_id         UUID NOT NULL REFERENCES public.pay_age_bands(id) ON DELETE RESTRICT,
  hourly_rate     NUMERIC(6,2) NOT NULL CHECK (hourly_rate > 0),
  effective_from  DATE NOT NULL,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pay_band_rates_unique UNIQUE (band_id, effective_from)
);

COMMENT ON TABLE public.pay_band_rates IS 'Effective-dated hourly rates per age band. Append-only — never update past rows.';

CREATE INDEX idx_pay_band_rates_band_id        ON public.pay_band_rates(band_id);
CREATE INDEX idx_pay_band_rates_effective_from ON public.pay_band_rates(band_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- 9. EMPLOYEE PAY SETTINGS
-- One row per employee: pay type and max weekly hours guideline.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_pay_settings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL UNIQUE REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  pay_type          TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'salaried')),
  max_weekly_hours  NUMERIC(4,1) CHECK (max_weekly_hours > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.employee_pay_settings IS 'Pay type (hourly/salaried) and max weekly hours guideline per employee.';
COMMENT ON COLUMN public.employee_pay_settings.max_weekly_hours IS 'Guideline only — exceeded hours display a warning, not a block.';

-- ---------------------------------------------------------------------------
-- 10. EMPLOYEE RATE OVERRIDES
-- Individual hourly rate history, taking precedence over age bands.
-- Append-only — no updates to past rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employee_rate_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  hourly_rate     NUMERIC(6,2) NOT NULL CHECK (hourly_rate > 0),
  effective_from  DATE NOT NULL,
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_rate_overrides_unique UNIQUE (employee_id, effective_from)
);

COMMENT ON TABLE public.employee_rate_overrides IS 'Employee-specific hourly rate overrides. Append-only. Takes precedence over age band rates.';

CREATE INDEX idx_employee_rate_overrides_employee ON public.employee_rate_overrides(employee_id, effective_from DESC);

-- ---------------------------------------------------------------------------
-- 11. DEPARTMENT BUDGETS
-- Annual payroll budget per department per year.
-- Monthly = annual/12, Weekly = annual/52.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.department_budgets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department      TEXT NOT NULL CHECK (department IN ('bar', 'kitchen')),
  budget_year     SMALLINT NOT NULL CHECK (budget_year >= 2020),
  annual_amount   NUMERIC(10,2) NOT NULL CHECK (annual_amount > 0),
  created_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT department_budgets_unique UNIQUE (department, budget_year)
);

COMMENT ON TABLE public.department_budgets IS 'Annual payroll budget per department. Monthly = annual/12, Weekly = annual/52.';

-- ---------------------------------------------------------------------------
-- 12. RECONCILIATION NOTES
-- Internal manager notes on planned vs actual variances. Never sent externally.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reconciliation_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL,   -- 'shift', 'session', 'employee_day', 'week', 'month'
  entity_id    UUID NOT NULL,
  note         TEXT NOT NULL,
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.reconciliation_notes IS 'Internal reconciliation notes. Never included in accountant email or Excel export.';

CREATE INDEX idx_reconciliation_notes_entity ON public.reconciliation_notes(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 13. ROTA EMAIL LOG
-- Audit trail for all rota-related outgoing emails.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rota_email_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type    TEXT NOT NULL CHECK (email_type IN (
                  'staff_rota',
                  'manager_alert',
                  'holiday_submitted',
                  'holiday_decision',
                  'holiday_manager_notify',
                  'payroll_export'
                )),
  entity_type   TEXT,           -- 'leave_request', 'rota_week', 'payroll_month'
  entity_id     UUID,
  to_addresses  TEXT[] NOT NULL,
  cc_addresses  TEXT[],
  subject       TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message TEXT,
  message_id    TEXT,           -- returned by Graph API
  sent_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- NULL = automated
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.rota_email_log IS 'Audit log for all rota-related outgoing emails including cron-triggered sends.';

CREATE INDEX idx_rota_email_log_email_type ON public.rota_email_log(email_type);
CREATE INDEX idx_rota_email_log_entity     ON public.rota_email_log(entity_type, entity_id);
CREATE INDEX idx_rota_email_log_sent_at    ON public.rota_email_log(sent_at DESC);

-- ---------------------------------------------------------------------------
-- 14. PAYROLL MONTH APPROVALS
-- Locks a payroll month snapshot after manager approval.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payroll_month_approvals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year            SMALLINT NOT NULL,
  month           SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  approved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  snapshot        JSONB NOT NULL,   -- calculated per-employee totals at approval time
  email_sent_at   TIMESTAMPTZ,
  email_sent_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT payroll_month_approvals_unique UNIQUE (year, month)
);

COMMENT ON TABLE public.payroll_month_approvals IS 'Locks payroll calculations for a month via a JSON snapshot. Once approved, the snapshot is the source of truth for accountant emails.';

-- ---------------------------------------------------------------------------
-- 15. TRIGGERS: updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'rota_weeks',
    'rota_shift_templates',
    'rota_shifts',
    'leave_requests',
    'timeclock_sessions',
    'employee_pay_settings',
    'department_budgets',
    'reconciliation_notes'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 16. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

-- Enable RLS on all new tables
ALTER TABLE public.rota_weeks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rota_shift_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rota_shifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_days                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeclock_sessions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_age_bands              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pay_band_rates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_pay_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_rate_overrides    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.department_budgets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rota_email_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_month_approvals    ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user an authenticated admin/manager?
-- Reuses existing user_has_permission RPC for module-level checks.
-- For RLS policies we use a simpler "is authenticated" check + rely on
-- server-side permission checks in Next.js server actions.

-- Authenticated users (admin/manager): full access to management tables
CREATE POLICY "Authenticated users can manage rota_weeks"
  ON public.rota_weeks FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage rota_shift_templates"
  ON public.rota_shift_templates FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage rota_shifts"
  ON public.rota_shifts FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage leave_requests"
  ON public.leave_requests FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage leave_days"
  ON public.leave_days FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage timeclock_sessions"
  ON public.timeclock_sessions FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read pay_age_bands"
  ON public.pay_age_bands FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read pay_band_rates"
  ON public.pay_band_rates FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage employee_pay_settings"
  ON public.employee_pay_settings FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage employee_rate_overrides"
  ON public.employee_rate_overrides FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage department_budgets"
  ON public.department_budgets FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage reconciliation_notes"
  ON public.reconciliation_notes FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage rota_email_log"
  ON public.rota_email_log FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage payroll_month_approvals"
  ON public.payroll_month_approvals FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Anon (FOH timeclock page): can INSERT timeclock_sessions only
-- The timeclock page uses the anon key — no auth required
CREATE POLICY "Anon can clock in/out"
  ON public.timeclock_sessions FOR INSERT
  TO anon WITH CHECK (true);

CREATE POLICY "Anon can read open sessions for display"
  ON public.timeclock_sessions FOR SELECT
  TO anon USING (clock_out_at IS NULL);

-- Anon can read active employees for the name selector
-- (employees table policy likely already exists; this is a note only)

-- ---------------------------------------------------------------------------
-- 17. PERMISSIONS SEED — new RBAC modules
-- Insert permissions for rota, leave, timeclock, payroll modules.
-- Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (module_name, action, description)
VALUES
  -- rota
  ('rota', 'view',    'View the weekly rota grid'),
  ('rota', 'create',  'Create shifts on the rota'),
  ('rota', 'edit',    'Edit existing shifts'),
  ('rota', 'delete',  'Delete shifts'),
  ('rota', 'publish', 'Publish a rota week for staff to view'),
  -- leave
  ('leave', 'view',    'View all leave requests'),
  ('leave', 'create',  'Add leave on behalf of an employee (manager)'),
  ('leave', 'request', 'Submit a holiday request (employee)'),
  ('leave', 'approve', 'Approve or decline leave requests'),
  -- timeclock
  ('timeclock', 'view',  'View timeclock sessions and history'),
  ('timeclock', 'clock', 'Use the FOH clock in/out interface'),
  ('timeclock', 'edit',  'Edit timeclock sessions (manager correction)'),
  -- payroll
  ('payroll', 'view',    'View payroll review and month-end data'),
  ('payroll', 'approve', 'Approve a payroll month'),
  ('payroll', 'export',  'Download payroll Excel export'),
  ('payroll', 'send',    'Send accountant email with payroll attachment')
ON CONFLICT (module_name, action) DO NOTHING;

-- Assign new permissions to super_admin (all) and manager (operational subset)
DO $$
DECLARE
  role_super_admin UUID;
  role_manager     UUID;
  role_employee    UUID;
BEGIN
  SELECT id INTO role_super_admin FROM public.roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO role_manager     FROM public.roles WHERE name = 'manager'     LIMIT 1;
  SELECT id INTO role_employee    FROM public.roles WHERE name = 'employee'    LIMIT 1;

  -- super_admin gets every new permission
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT role_super_admin, p.id
  FROM public.permissions p
  WHERE p.module_name IN ('rota', 'leave', 'timeclock', 'payroll')
    AND role_super_admin IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- manager gets all rota, leave, timeclock, payroll permissions
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT role_manager, p.id
  FROM public.permissions p
  WHERE p.module_name IN ('rota', 'leave', 'timeclock', 'payroll')
    AND role_manager IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- employee role (if it exists) gets: rota/view, leave/request, leave/view, timeclock/clock
  IF role_employee IS NOT NULL THEN
    INSERT INTO public.role_permissions (role_id, permission_id)
    SELECT role_employee, p.id
    FROM public.permissions p
    WHERE (p.module_name = 'rota'      AND p.action = 'view')
       OR (p.module_name = 'leave'     AND p.action IN ('view', 'request'))
       OR (p.module_name = 'timeclock' AND p.action = 'clock')
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$;
