-- This migration adds dedicated tables for sensitive employee data:
-- 1. `employee_financial_details`: For bank details and NI number.
-- 2. `employee_health_records`: For confidential medical information.
-- It also moves the `ni_number` from the `employees` table to the new financial details table.

-- =================================================================
-- Table: employee_financial_details
-- =================================================================

CREATE TABLE IF NOT EXISTS public.employee_financial_details (
    employee_id uuid NOT NULL PRIMARY KEY,
    ni_number text NULL,
    bank_account_number text NULL,
    bank_sort_code text NULL,
    bank_name text NULL,
    payee_name text NULL,
    branch_address text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_financial_details_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.employee_financial_details IS 'Stores confidential financial details for employees.';

-- =================================================================
-- Table: employee_health_records
-- =================================================================

CREATE TABLE IF NOT EXISTS public.employee_health_records (
    employee_id uuid NOT NULL PRIMARY KEY,
    doctor_name text NULL,
    doctor_address text NULL,
    allergies text NULL,
    illness_history text NULL,
    recent_treatment text NULL,
    has_diabetes boolean NOT NULL DEFAULT false,
    has_epilepsy boolean NOT NULL DEFAULT false,
    has_skin_condition boolean NOT NULL DEFAULT false,
    has_depressive_illness boolean NOT NULL DEFAULT false,
    has_bowel_problems boolean NOT NULL DEFAULT false,
    has_ear_problems boolean NOT NULL DEFAULT false,
    is_registered_disabled boolean NOT NULL DEFAULT false,
    disability_reg_number text NULL,
    disability_reg_expiry_date date NULL,
    disability_details text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT employee_health_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(employee_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.employee_health_records IS 'Stores confidential health and medical records for employees.';

-- =================================================================
-- Data Migration and Schema Cleanup
-- =================================================================

-- Step 1: Copy existing NI numbers to the new table.
-- This block will only execute if the `ni_number` column exists on the `employees` table.
DO $$
BEGIN
   IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='ni_number') THEN
      -- Insert financial detail records for all existing employees, transferring their NI number.
      INSERT INTO public.employee_financial_details (employee_id, ni_number)
      SELECT employee_id, ni_number FROM public.employees
      ON CONFLICT (employee_id) DO UPDATE SET ni_number = EXCLUDED.ni_number;
   END IF;
END $$;

-- Step 2: Remove the old `ni_number` column from the `employees` table.
ALTER TABLE public.employees DROP COLUMN IF EXISTS ni_number;

-- =================================================================
-- Triggers for 'updated_at' columns
-- =================================================================

-- Trigger for financial details
CREATE OR REPLACE TRIGGER on_financial_details_updated
BEFORE UPDATE ON public.employee_financial_details
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Trigger for health records
CREATE OR REPLACE TRIGGER on_health_records_updated
BEFORE UPDATE ON public.employee_health_records
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at(); 