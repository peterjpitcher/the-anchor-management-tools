# Database Migration — Changes Log

## Migration file created
- Path: `supabase/migrations/20260308120000_employees_constraints_and_indexes.sql`

## Fix 1 — DEF-019: employees.status CHECK constraint
- SQL added: `ALTER TABLE employees ADD CONSTRAINT employees_status_check CHECK (status IN ('Onboarding', 'Active', 'Started Separation', 'Former'))`
- Defensive: Yes — wrapped in a `DO $$ BEGIN IF NOT EXISTS ... END $$` block that queries `information_schema.table_constraints` before attempting to add the constraint, so the migration is safe to re-run and will not fail if the constraint is already present.

## Fix 2 — DEF-020: Missing indexes
- Indexes added:
  - `idx_employees_email_address` on `employees (email_address)` — covers invite duplicate checks and employee lookups by email
  - `idx_employees_auth_user_id` on `employees (auth_user_id) WHERE auth_user_id IS NOT NULL` — partial index; skips NULL rows (onboarding employees) to keep the index compact
  - `idx_employee_invite_tokens_employee_id` on `employee_invite_tokens (employee_id)` — covers token queries by employee
  - `idx_employee_invite_tokens_pending` on `employee_invite_tokens (employee_id, created_at DESC) WHERE completed_at IS NULL` — composite partial index for the invite-chase cron pattern (latest pending token per employee)
- `IF NOT EXISTS` used: Yes — all four `CREATE INDEX` statements use `IF NOT EXISTS`, making the migration safe to re-run.

## Risks
- **CHECK constraint on existing data**: If any row in `employees` currently has a `status` value outside the four valid values (`'Onboarding'`, `'Active'`, `'Started Separation'`, `'Former'`), the `ALTER TABLE` will fail with a constraint violation error. Before deploying, run the following query to check for invalid rows:
  ```sql
  SELECT id, status FROM employees
  WHERE status NOT IN ('Onboarding', 'Active', 'Started Separation', 'Former');
  ```
  If any rows are returned, correct the data first, then apply the migration.
- **Index build time**: Index creation on large tables takes an exclusive lock momentarily at the start (for btree indexes). On a moderately sized employees table this is negligible, but for `employee_invite_tokens` at scale, consider `CREATE INDEX CONCURRENTLY` if running during peak hours (cannot be used inside a transaction block).

## Rollback
To reverse both fixes:
```sql
-- Remove the CHECK constraint
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_status_check;

-- Drop the indexes
DROP INDEX IF EXISTS idx_employees_email_address;
DROP INDEX IF EXISTS idx_employees_auth_user_id;
DROP INDEX IF EXISTS idx_employee_invite_tokens_employee_id;
DROP INDEX IF EXISTS idx_employee_invite_tokens_pending;
```
