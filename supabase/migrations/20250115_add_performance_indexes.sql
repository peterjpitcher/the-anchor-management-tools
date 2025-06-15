-- Add performance indexes for employee-related tables

-- Indexes for foreign key columns (improves JOIN performance)
CREATE INDEX IF NOT EXISTS idx_employee_emergency_contacts_employee_id 
ON employee_emergency_contacts(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_financial_details_employee_id 
ON employee_financial_details(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_health_records_employee_id 
ON employee_health_records(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_notes_employee_id 
ON employee_notes(employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_attachments_employee_id 
ON employee_attachments(employee_id);

-- Indexes for commonly queried fields
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email 
ON employees(email_address);

CREATE INDEX IF NOT EXISTS idx_employees_status 
ON employees(status);

CREATE INDEX IF NOT EXISTS idx_employees_employment_dates 
ON employees(employment_start_date, employment_end_date);

-- Index for employee search by name
CREATE INDEX IF NOT EXISTS idx_employees_name_search 
ON employees(last_name, first_name);

-- Index for notes timestamp queries - only create if column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employee_notes' 
        AND column_name = 'created_at'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_employee_notes_created_at 
        ON employee_notes(created_at DESC);
    END IF;
END $$;

-- Index for attachments category queries - only create if column exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employee_attachments' 
        AND column_name = 'uploaded_at'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_employee_attachments_category 
        ON employee_attachments(category_id, uploaded_at DESC);
    END IF;
END $$;