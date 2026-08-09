-- Employee preferred name.
--
-- The name the app calls someone, as distinct from the legal name that has to
-- appear on contracts, payroll and right-to-work records. Amanda goes by Mandy;
-- two active Jacobs need to be Jacob H and Jacob W on a rota.
--
-- Nullable on purpose: most people have no preferred name and should keep
-- falling back to their first name, so this stays additive and the code can
-- ship after it without a backfill.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS preferred_name text;

COMMENT ON COLUMN public.employees.preferred_name IS
  'Display name used throughout the app. Legal first_name/last_name remain the source of truth for contracts, payroll and official records. Unique (case-insensitive) among Active employees.';

-- Blank is not a preferred name; store NULL so the fallback to first_name is
-- the single code path rather than every caller testing for empty strings.
UPDATE public.employees
SET preferred_name = NULL
WHERE preferred_name IS NOT NULL AND btrim(preferred_name) = '';

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_preferred_name_not_blank;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_preferred_name_not_blank
  CHECK (preferred_name IS NULL OR btrim(preferred_name) <> '');

-- Uniqueness is case-insensitive, so "mandy" cannot coexist with "Mandy".
--
-- The scope is every status the app still SHOWS somebody under, which is
-- 'Active' plus 'Started Separation'. Scoping it to 'Active' alone would leave a
-- hole: staff on Started Separation still appear on the rota, the clock-in
-- kiosk, the checklist attribution picker and the voucher staff picker, so
-- someone working their notice could share a name with a new starter and two
-- identical cards would sit side by side on the kiosk with nothing to tell them
-- apart. Keep this list in step with SELECTABLE_EMPLOYEE_STATUSES in
-- src/lib/employees/display-name.ts.
--
-- A Former employee is off every screen, so their name is free to reuse.
DROP INDEX IF EXISTS employees_preferred_name_active_unique;

CREATE UNIQUE INDEX employees_preferred_name_active_unique
  ON public.employees (lower(btrim(preferred_name)))
  WHERE preferred_name IS NOT NULL AND status IN ('Active', 'Started Separation');
