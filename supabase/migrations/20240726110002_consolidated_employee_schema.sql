-- This is a consolidated script to define the canonical schema for both the 'employees'
-- and 'employee_emergency_contacts' tables. It is designed to be idempotent and safe to run
-- on an existing database.

-- =================================================================
-- Schema for 'employees' table
-- =================================================================

-- Step 1.1: Add any missing columns to 'employees'.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS phone_number TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS email_address TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_start_date DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS employment_end_date DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS status TEXT;
-- ni_number was added in migration 001, but we ensure it exists here for completeness.
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS ni_number TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Step 1.2: Set default values for 'employees' timestamp columns.
ALTER TABLE public.employees ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.employees ALTER COLUMN updated_at SET DEFAULT now();

-- Step 1.3: Apply NOT NULL constraints to 'employees'.
-- WARNING: This may fail if existing rows have NULL values.
ALTER TABLE public.employees ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN last_name SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN email_address SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN job_title SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN employment_start_date SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN status SET NOT NULL;

-- Step 1.4: Set up the 'updated_at' trigger for 'employees'.
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_employees_updated ON public.employees;

CREATE TRIGGER on_employees_updated
BEFORE UPDATE ON public.employees
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();


-- =================================================================
-- Schema for 'employee_emergency_contacts' table
-- =================================================================

-- Step 2.1: Create 'employee_emergency_contacts' table if it doesn't exist.
-- The initial creation was in migration 001, this ensures it exists.
CREATE TABLE IF NOT EXISTS public.employee_emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2.2: Add any missing columns to 'employee_emergency_contacts'.
ALTER TABLE public.employee_emergency_contacts ADD COLUMN IF NOT EXISTS employee_id UUID;
ALTER TABLE public.employee_emergency_contacts ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.employee_emergency_contacts ADD COLUMN IF NOT EXISTS relationship TEXT;
ALTER TABLE public.employee_emergency_contacts ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.employee_emergency_contacts ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Step 2.3: Apply NOT NULL constraints to 'employee_emergency_contacts'.
ALTER TABLE public.employee_emergency_contacts ALTER COLUMN employee_id SET NOT NULL;
ALTER TABLE public.employee_emergency_contacts ALTER COLUMN name SET NOT NULL;

-- Step 2.4: Add the foreign key constraint if it doesn't already exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname = 'employee_emergency_contacts_employee_id_fkey'
    )
    THEN
        ALTER TABLE public.employee_emergency_contacts
        ADD CONSTRAINT employee_emergency_contacts_employee_id_fkey
        FOREIGN KEY (employee_id)
        REFERENCES public.employees(employee_id)
        ON DELETE CASCADE;
    END IF;
END;
$$; 