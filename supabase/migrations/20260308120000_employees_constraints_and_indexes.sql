-- DEF-019 / DEF-020: employees table — add status CHECK constraint and missing indexes
--
-- DEF-019: employees.status had no database-level enforcement. Any string value
--          could be inserted directly. This migration adds a CHECK constraint for
--          the four valid status values.
--
-- DEF-020: Three high-traffic columns (employees.email_address, employees.auth_user_id,
--          employee_invite_tokens.employee_id) had no indexes, causing sequential scans
--          on invite duplicate checks, onboarding link lookups, and token queries.
--          A partial composite index on invite_tokens is also added to accelerate the
--          invite-chase cron's pending-token queries.

-- ============================================================
-- FIX 1 — DEF-019: employees.status CHECK constraint
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'employees_status_check'
      AND table_name = 'employees'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_status_check
      CHECK (status IN ('Onboarding', 'Active', 'Started Separation', 'Former'));
  END IF;
END $$;

-- ============================================================
-- FIX 2 — DEF-020: Missing indexes on high-traffic columns
-- ============================================================

-- employees.email_address — used in invite duplicate checks and employee lookups
CREATE INDEX IF NOT EXISTS idx_employees_email_address
  ON employees (email_address);

-- employees.auth_user_id — used in onboarding link checks; partial index excludes NULLs
CREATE INDEX IF NOT EXISTS idx_employees_auth_user_id
  ON employees (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- employee_invite_tokens.employee_id — used in token queries by employee
CREATE INDEX IF NOT EXISTS idx_employee_invite_tokens_employee_id
  ON employee_invite_tokens (employee_id);

-- Composite partial index: supports the invite-chase cron pattern
-- (fetch latest pending token per employee, ordered by created_at DESC)
CREATE INDEX IF NOT EXISTS idx_employee_invite_tokens_pending
  ON employee_invite_tokens (employee_id, created_at DESC)
  WHERE completed_at IS NULL;
